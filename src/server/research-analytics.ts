import { sql, type SQL } from 'drizzle-orm';
import { db } from '@workspace/db';
import { NextResponse, type NextRequest } from 'next/server';
import { RESEARCH_WORKFLOW_STAGES, parseResearchFilters, researchDate, researchFinancialStatus, researchWorkflowStage, type ResearchFilters } from '@/lib/research-contract';
import { createApiErrorPayload, makeRequestId } from './write-safety';
import { safeServerError } from './safe-server-log';
import type { ResearchAdminUser } from './research-center';

type Executor = { execute: (query: any) => Promise<any> };
class ResearchReadError extends Error { constructor(message: string, public status = 400) { super(message); } }
const FINANCIAL_KEYS = ['estimatedPrice','discountAmount','totalAmount','paidAmount','remainingAmount','paymentStatus','pendingAmount','lastPaymentDate','financialStatus','approvedExpenses','pendingExpenses','estimatedContribution','actualContribution','creditedAmount'];
const grants = (user: ResearchAdminUser, permission: string) => user.isActive && (user.role === 'admin' || user.permissions.includes('research') || user.permissions.includes(permission));
const like = (text: string) => `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`;
function rows(result: any): Record<string, any>[] {
  if (!result || !Array.isArray(result.rows)) throw new Error('استجابة قراءة البحوث غير صحيحة');
  return result.rows;
}
function number(value: unknown): number {
  const result = Number(value ?? 0); if (!Number.isFinite(result)) throw new Error('قيمة مالية غير صحيحة في تقرير البحوث'); return result;
}
function where(filters: ResearchFilters, financials: boolean, day: string, includeArchived=false): SQL {
  if (filters.financialStatus && !financials) throw new ResearchReadError('لا تملك صلاحية عرض الحسابات', 403);
  const parts: SQL[] = [filters.status === 'archived' ? sql`r.archived_at IS NOT NULL` : includeArchived ? sql`true` : sql`r.archived_at IS NULL`];
  if (filters.search) {
    const value = like(filters.search);
    parts.push(sql`(r.research_no ILIKE ${value} OR r.title ILIKE ${value} OR r.title_english ILIKE ${value} OR coalesce(c.full_name,c.name,'') ILIKE ${value} OR c.phone ILIKE ${value})`);
  }
  if (filters.category) parts.push(sql`coalesce(r.research_category,'other')=${filters.category}`);
  if (filters.university) parts.push(sql`r.university_name ILIKE ${like(filters.university)}`);
  if (filters.status&&filters.status!=='archived') parts.push(sql`r.status=${filters.status}`);
  if (filters.staffId) parts.push(sql`(r.assigned_writer_id=${filters.staffId} OR EXISTS(SELECT 1 FROM research_assignments ra WHERE ra.research_order_id=r.id AND ra.staff_id=${filters.staffId} AND ra.status NOT IN ('revoked','rejected')))`);
  if (filters.stage) {
    const stage = RESEARCH_WORKFLOW_STAGES.find(row => row.key === filters.stage)!;
    parts.push(sql`r.status IN (${sql.join(stage.statuses.map(status => sql`${status}`), sql`,`)})`);
  }
  if (filters.from) parts.push(sql`(r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date >= ${filters.from}::date`);
  if (filters.to) parts.push(sql`(r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date <= ${filters.to}::date`);
  if (filters.financialStatus === 'paid') parts.push(sql`r.remaining_amount::numeric<=0`);
  if (filters.financialStatus === 'overdue') parts.push(sql`r.remaining_amount::numeric>0 AND r.payment_due_date<${day}::date`);
  if (filters.financialStatus === 'partial') parts.push(sql`r.remaining_amount::numeric>0 AND (r.paid_amount::numeric>0 OR r.total_amount::numeric>r.remaining_amount::numeric) AND (r.payment_due_date IS NULL OR r.payment_due_date>=${day}::date)`);
  if (filters.financialStatus === 'unpaid') parts.push(sql`r.remaining_amount::numeric>0 AND r.paid_amount::numeric<=0 AND r.remaining_amount::numeric>=r.total_amount::numeric AND (r.payment_due_date IS NULL OR r.payment_due_date>=${day}::date)`);
  return sql.join(parts, sql` AND `);
}
const joins = sql`research_orders r JOIN customers c ON c.id=r.customer_id LEFT JOIN staff employee ON employee.id=r.assigned_writer_id`;
function paymentMatch(alias: string): SQL {
  // Identifiers are application constants, never user-provided strings.
  const f = sql.raw(alias);
  return sql`((${f}.source_type='research_order' AND ${f}.source_id=r.id::text)
    OR (${f}.source_type='sales_invoice' AND ${f}.source_id=r.invoice_id::text)
    OR (${f}.source_type='installment_payment' AND EXISTS(SELECT 1 FROM installment_payments ip JOIN installment_contracts ic ON ic.id=ip.contract_id WHERE ip.id::text=${f}.source_id AND ic.sales_invoice_id=r.invoice_id))
    OR (${f}.source_type='installment_contract' AND ${f}.source_event IN ('payment','reconciliation','reversal') AND EXISTS(SELECT 1 FROM installment_contracts ic WHERE ic.id::text=${f}.source_id AND ic.sales_invoice_id=r.invoice_id)))`;
}
const pendingFacts = sql`coalesce((SELECT sum(f.amount::numeric) FROM financial_transactions f WHERE ${paymentMatch('f')} AND f.direction='revenue' AND f.approval_status IN ('pending','approved')),0)
  + coalesce((SELECT sum(a.amount::numeric) FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id WHERE ((a.source_type='research_order' AND a.source_id=r.id) OR (a.source_type='sales_invoice' AND a.source_id=r.invoice_id)) AND a.posted_at IS NULL AND v.approval_status IN ('pending','approved')),0)`;
const lastPayment = sql`greatest((SELECT max(f.transaction_time) FROM financial_transactions f WHERE ${paymentMatch('f')} AND f.direction='revenue' AND f.approval_status='executed'), (SELECT max(a.posted_at) FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id WHERE ((a.source_type='research_order' AND a.source_id=r.id) OR (a.source_type='sales_invoice' AND a.source_id=r.invoice_id)) AND a.posted_at IS NOT NULL AND coalesce(v.approval_status,'executed')='executed'))`;
function project(row: Record<string, any>, financials: boolean, day: string): Record<string, any> {
  const value: Record<string, any> = Object.fromEntries(Object.entries(row).map(([key, val]) => [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), val]));
  value.workflowStage = researchWorkflowStage(value.status);
  if (financials) {
    value.financialStatus = researchFinancialStatus({remainingAmount:value.remainingAmount,paidAmount:value.paidAmount,totalAmount:value.totalAmount,paymentDueDate:value.paymentDueDate}, day);
    for (const key of ['totalAmount','paidAmount','remainingAmount','pendingAmount']) value[key] = number(value[key]);
  } else for (const key of FINANCIAL_KEYS) delete value[key];
  return value;
}
export async function readResearchOrders(executor: Executor, filters: ResearchFilters, financials: boolean, day = researchDate(), includeArchived=false) {
  const condition = where(filters, financials, day,includeArchived);
  const [itemsResult, countResult] = await Promise.all([
    executor.execute(sql`/* research:list */ SELECT r.*,coalesce(nullif(c.full_name,''),c.name) AS "customerName",c.phone AS "customerPhone",coalesce(nullif(employee.full_name,''),employee.username) AS "assignedEmployeeName" ${financials ? sql`,(${pendingFacts}) AS "pendingAmount",${lastPayment} AS "lastPaymentDate"` : sql``} FROM ${joins} WHERE ${condition} ORDER BY r.created_at DESC,r.id DESC LIMIT ${filters.pageSize} OFFSET ${(filters.page-1)*filters.pageSize}`),
    executor.execute(sql`/* research:count */ SELECT count(*)::int AS total FROM ${joins} WHERE ${condition}`),
  ]);
  const [count] = rows(countResult); if (!count) throw new Error('تعذر قراءة عدد طلبات البحوث');
  return { items: rows(itemsResult).map(row => project(row,financials,day)), pagination: { page:filters.page,pageSize:filters.pageSize,total:number(count.total) } };
}
export async function readResearchBoard(executor: Executor, filters: ResearchFilters, financials: boolean, day = researchDate()) {
  const selected = filters.stage ? RESEARCH_WORKFLOW_STAGES.filter(row => row.key===filters.stage) : RESEARCH_WORKFLOW_STAGES;
  const columns = await Promise.all(selected.map(async stage => {
    const list = await readResearchOrders(executor,{...filters,stage:stage.key,pageSize:Math.min(filters.pageSize,20)},financials,day);
    return {...stage,items:list.items,total:list.pagination.total,pagination:list.pagination};
  }));
  return {columns,financialsVisible:financials};
}
async function summary(executor:Executor, filters:ResearchFilters, financials:boolean, day:string) {
  const [row] = rows(await executor.execute(sql`/* research:summary */ SELECT count(*)::int AS total,
    count(*) FILTER(WHERE r.status='new')::int AS "newOrders",
    count(*) FILTER(WHERE r.status IN ('searching_sources','writing'))::int AS "inProgress",
    count(*) FILTER(WHERE r.status IN ('accepted','review','formatting','plagiarism_check'))::int AS "awaitingReview",
    count(*) FILTER(WHERE r.status='completed')::int AS ready,
    count(*) FILTER(WHERE r.status='delivered')::int AS completed
    ${financials ? sql`,coalesce(sum(r.total_amount::numeric),0) AS "totalValue",coalesce(sum(r.paid_amount::numeric),0) AS collected,
      coalesce(sum(r.remaining_amount::numeric),0) AS remaining,
      coalesce(sum(r.remaining_amount::numeric) FILTER(WHERE r.payment_due_date<${day}::date),0) AS "overdueDebt",
      coalesce(sum(r.remaining_amount::numeric) FILTER(WHERE r.payment_due_date=${day}::date),0) AS "dueToday",
      coalesce(sum(r.remaining_amount::numeric) FILTER(WHERE r.payment_due_date IS NULL OR r.payment_due_date>=${day}::date),0) AS "currentDebt",
      coalesce(sum((${pendingFacts})),0) AS "pendingPayments",
      coalesce(sum(r.total_amount::numeric) FILTER(WHERE r.status='delivered'),0) AS "deliveredServiceValue"` : sql``}
    FROM ${joins} WHERE ${where(filters,financials,day,true)}`));
  if (!row) throw new Error('تعذر قراءة إحصائيات البحوث');
  const result:Record<string,number>={};
  for(const key of ['total','newOrders','inProgress','awaitingReview','ready','completed']) result[key]=number(row[key]);
  if(financials) for(const key of ['totalValue','collected','remaining','overdueDebt','dueToday','currentDebt','pendingPayments','deliveredServiceValue']) result[key]=number(row[key]);
  return result;
}
/** One stream per underlying receipt/transaction; a voucher header never counts again. */
function receiptStream(filters:ResearchFilters, financials:boolean, day:string):SQL {
  return sql`WITH matched AS (SELECT r.* FROM ${joins} WHERE ${where(filters,financials,day,true)})
    SELECT f.id::text AS key, f.transaction_time AS at,CASE WHEN f.direction='revenue' THEN f.amount::numeric ELSE -f.amount::numeric END AS amount
      FROM matched r JOIN financial_transactions f ON ${paymentMatch('f')} WHERE f.approval_status='executed'
    UNION ALL SELECT 'receipt:'||a.id::text,a.posted_at,greatest(a.amount::numeric-coalesce(a.reversed_amount::numeric,0),0)
      FROM matched r JOIN receipt_voucher_allocations a ON ((a.source_type='research_order' AND a.source_id=r.id) OR (a.source_type='sales_invoice' AND a.source_id=r.invoice_id))
      JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id WHERE a.posted_at IS NOT NULL AND coalesce(v.approval_status,'executed')='executed'`;
}
export async function readResearchReceivables(executor:Executor,filters:ResearchFilters,day=researchDate()) {
  const [list,totals,collectionResult]=await Promise.all([
    readResearchOrders(executor,filters,true,day,true),summary(executor,filters,true,day),
    executor.execute(sql`/* research:collections */ SELECT coalesce(sum(amount) FILTER(WHERE (at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date=${day}::date),0) AS "receivedToday",coalesce(sum(amount) FILTER(WHERE date_trunc('month',at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')=date_trunc('month',${day}::date)),0) AS "receivedThisMonth" FROM (${receiptStream(filters,true,day)}) receipts`),
  ]);
  const [cash]=rows(collectionResult);
  return {...list,summary:{...totals,totalReceivables:totals.remaining,currentReceivables:totals.currentDebt,overdueReceivables:totals.overdueDebt,receivedToday:number(cash?.receivedToday),receivedThisMonth:number(cash?.receivedThisMonth)}};
}
export async function readResearchDashboard(executor:Executor,filters:ResearchFilters,financials:boolean,day=researchDate()) {
  const [totals,recent,stages,workload,deadlines]=await Promise.all([
    summary(executor,filters,financials,day),readResearchOrders(executor,{...filters,page:1,pageSize:8},financials,day),
    executor.execute(sql`/* research:stages */ SELECT r.status,count(*)::int AS count FROM ${joins} WHERE ${where(filters,financials,day)} GROUP BY r.status`),
    executor.execute(sql`/* research:workload */ SELECT employee.id,coalesce(nullif(employee.full_name,''),employee.username) AS name, count(*)::int AS assigned,count(*) FILTER(WHERE r.status='delivered')::int AS completed,count(*) FILTER(WHERE r.status NOT IN ('delivered','archived'))::int AS active FROM ${joins} WHERE ${where(filters,financials,day)} AND employee.id IS NOT NULL GROUP BY employee.id ORDER BY active DESC,employee.id LIMIT 20`),
    executor.execute(sql`/* research:deadlines */ SELECT r.id,r.research_no AS "researchNo",r.title,r.deadline,r.status FROM ${joins} WHERE ${where(filters,financials,day)} AND r.status NOT IN ('delivered','archived') AND r.deadline<=(${day}::date+3) ORDER BY r.deadline,r.id LIMIT 20`),
  ]);
  const alerts=rows(deadlines).map(row=>({key:`deadline:${row.id}`,orderId:row.id,title:row.deadline<day?'تأخر موعد تسليم البحث':'اقترب موعد تسليم البحث',body:`${row.researchNo} — ${row.title}`,severity:row.deadline<day?'danger':'warning',href:`/admin/research/orders?order=${row.id}`}));
  if(financials&&totals.pendingPayments>0) alerts.push({key:'pending-payments',orderId:null,title:'دفعات بانتظار الموافقة',body:'الدفعات المعلقة لا تخفض الذمم حتى الموافقة والتنفيذ',severity:'warning',href:'/admin/research/receivables'} as any);
  if(financials&&totals.overdueDebt>0) alerts.push({key:'overdue-debt',orderId:null,title:'ذمم تجاوزت موعد استحقاق الدفع',body:'تُحسب حسب موعد السداد المحدد لكل طلب',severity:'danger',href:'/admin/research/receivables?financialStatus=overdue'} as any);
  return {summary:totals,recent:recent.items,byStatus:rows(stages),writers:rows(workload),alerts,financialsVisible:financials,scope:{from:filters.from,to:filters.to,dateBasis:'order_created'}};
}
export async function readResearchReports(executor:Executor,filters:ResearchFilters,financials:boolean,day=researchDate()) {
  if(!financials) throw new ResearchReadError('لا تملك صلاحية عرض الحسابات والتقارير المالية',403);
  const [list,totals,groupResult,expenseResult,cashResult,workResult,expenseTotalsResult,purchaseTotalsResult]=await Promise.all([
    readResearchOrders(executor,filters,true,day,true),summary(executor,filters,true,day),
    executor.execute(sql`/* research:periods */ SELECT (r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date::text AS day,count(*)::int AS orders,coalesce(sum(r.total_amount::numeric),0) AS "totalValue",coalesce(sum(r.paid_amount::numeric),0) AS collected,coalesce(sum(r.remaining_amount::numeric),0) AS remaining FROM ${joins} WHERE ${where(filters,true,day,true)} GROUP BY 1 ORDER BY 1 DESC LIMIT 366`),
    executor.execute(sql`/* research:expenses */ SELECT e.id,e.research_order_id AS "orderId",r.research_no AS "researchNo",e.date,e.name,e.expense_type AS "expenseType",e.amount,e.approval_status AS "approvalStatus",coalesce((SELECT sum(CASE WHEN f.direction='expense' THEN f.amount::numeric ELSE -f.amount::numeric END) FROM financial_transactions f WHERE f.source_type='expense' AND f.source_id=e.id::text AND f.approval_status='executed'),0) AS "approvedAmount" FROM ${joins} JOIN expenses e ON e.research_order_id=r.id WHERE ${where(filters,true,day,true)} AND e.deleted_at IS NULL ORDER BY e.date DESC,e.id DESC LIMIT 500`),
    executor.execute(sql`/* research:monthly-cash */ SELECT to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad','YYYY-MM') AS month,sum(amount) AS collected FROM (${receiptStream(filters,true,day)}) receipts WHERE (${filters.from}::date IS NULL OR (at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date>=${filters.from}::date) AND (${filters.to}::date IS NULL OR (at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date<=${filters.to}::date) GROUP BY 1 ORDER BY 1 DESC LIMIT 120`),
    executor.execute(sql`/* research:report-workload */ SELECT employee.id,coalesce(nullif(employee.full_name,''),employee.username) AS name,count(*)::int AS assigned,count(*) FILTER(WHERE r.status='delivered')::int AS completed,count(*) FILTER(WHERE r.deadline<${day}::date AND r.status NOT IN ('delivered','archived'))::int AS overdue FROM ${joins} WHERE ${where(filters,true,day,true)} AND employee.id IS NOT NULL GROUP BY employee.id ORDER BY assigned DESC,employee.id LIMIT 100`),
    executor.execute(sql`/* research:expense-totals */ SELECT count(*)::int AS count,coalesce(sum(cost.approved),0) AS "approvedExpenses",coalesce(sum(cost.approved) FILTER(WHERE r.status='delivered'),0) AS "deliveredExpenses",coalesce(sum(e.amount::numeric) FILTER(WHERE e.approval_status IN ('pending','approved')),0) AS "pendingExpenses" FROM ${joins} JOIN expenses e ON e.research_order_id=r.id CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN f.direction='expense' THEN f.amount::numeric ELSE -f.amount::numeric END),0) AS approved FROM financial_transactions f WHERE f.source_type='expense' AND f.source_id=e.id::text AND f.approval_status='executed') cost WHERE ${where(filters,true,day,true)} AND e.deleted_at IS NULL`),
    executor.execute(sql`/* research:purchase-totals */ SELECT coalesce(sum(p.total::numeric),0) AS "purchaseCost",coalesce(sum(p.total::numeric) FILTER(WHERE r.status='delivered'),0) AS "deliveredPurchaseCost",coalesce(sum(p.remaining_amount::numeric),0) AS "supplierRemaining" FROM ${joins} JOIN purchase_invoices p ON p.research_order_id=r.id WHERE ${where(filters,true,day,true)} AND p.status='active'`),
  ]);
  const expenses=rows(expenseResult), daily=rows(groupResult), monthly=rows(cashResult);
  const [expenseTotals]=rows(expenseTotalsResult);if(!expenseTotals) throw new Error('تعذر قراءة إجماليات مصاريف البحوث');
  const approvedExpenses=number(expenseTotals.approvedExpenses);
  const [purchaseTotals]=rows(purchaseTotalsResult);if(!purchaseTotals) throw new Error('تعذر قراءة إجماليات مشتريات البحوث');
  const purchaseCost=number(purchaseTotals.purchaseCost);
  return {...list,summary:{...totals,approvedExpenses,purchaseCost,supplierRemaining:number(purchaseTotals.supplierRemaining),pendingExpenses:number(expenseTotals.pendingExpenses),estimatedContribution:totals.totalValue-approvedExpenses-purchaseCost,actualContribution:totals.deliveredServiceValue-number(expenseTotals.deliveredExpenses)-number(purchaseTotals.deliveredPurchaseCost),actualProfit:null,profitNote:'المساهمة = قيمة العقود ناقص المصاريف المعتمدة وفواتير المشتريات الأصلية مرة واحدة. سداد المورد تسوية ذمة ولا يضاف كتكلفة جديدة. مساهمة المسلّم تستبعد غير المسلّم؛ القيم قبل المصاريف العامة وليست صافي ربح محاسبي نهائي'},daily,monthly,expenses,workload:rows(workResult),scope:{from:filters.from,to:filters.to,dateBasis:'order_created',cashDateBasis:'transaction_time',detailLimit:500,expenseCount:number(expenseTotals.count),periodLimit:366}};
}

export async function handleResearchAnalytics(req:NextRequest,parts:string[],user:ResearchAdminUser):Promise<NextResponse|null> {
  if(req.method!=='GET'||parts[1]!=='research') return null;
  const resource=parts[2]||'dashboard';
  if(!['dashboard','board','orders','receivables','reports'].includes(resource)||(resource==='orders'&&parts[3])) return null;
  const financials=grants(user,'research.financials.view');
  const permission=resource==='reports'?'research.reports.view':resource==='receivables'?'research.financials.view':'research.view';
  const requestId=makeRequestId(req.headers.get('x-request-id'));
  try {
    if(!grants(user,permission)) throw new ResearchReadError('لا تملك صلاحية عرض هذه الصفحة',403);
    let filters:ResearchFilters;
    try {filters=parseResearchFilters(req.nextUrl.searchParams);} catch(error) {throw new ResearchReadError(error instanceof Error?error.message:'التصفية غير صحيحة',400);}
    const result=resource==='dashboard'?await readResearchDashboard(db,filters,financials):resource==='board'?await readResearchBoard(db,filters,financials):resource==='receivables'?await readResearchReceivables(db,filters):resource==='reports'?await readResearchReports(db,filters,financials):await readResearchOrders(db,filters,financials);
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store','X-Request-Id':requestId}});
  } catch(error) {
    const status=error instanceof ResearchReadError?error.status:500;
    if(status===500) console.error('[research.analytics]',{requestId,resource,actorId:user.id,error:safeServerError(error)});
    return NextResponse.json(createApiErrorPayload({requestId,status,code:status===500?'DATABASE_ERROR':status===403?'PERMISSION_DENIED':'VALIDATION_ERROR',message:status===500?'تعذر تحميل بيانات قسم البحوث العلمية':(error as Error).message,retryable:status===500}),{status,headers:{'X-Request-Id':requestId}});
  }
}
