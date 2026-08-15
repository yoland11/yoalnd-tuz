import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, entityTimelineTable, notificationsTable, salesInvoicesTable } from "@workspace/db";
import {
  createAndExecuteSourceFinancialTransaction,
  ensureMasterCashBoxTables,
  type FinancialActor,
} from "@/server/master-cash-box";
import { readRequestBody } from "@/server/request-body";

type User = { id: number; username: string; fullName: string; role: string; permissions: string[]; isActive: boolean };
const money = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const fail = (error: string, status = 400) => json({ error }, status);
const has = (u: User, p: string) => u.role === "admin" || u.permissions.includes("installments") || u.permissions.includes(p);
const actor = (u: User): FinancialActor => ({ id: u.id, name: u.fullName || u.username, role: u.role, permissions: u.permissions });
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000));

const convertInput = z.object({
  invoiceId: z.coerce.number().int().positive(), installmentType: z.enum(["fixed", "graduated", "custom"]).default("fixed"),
  frequency: z.enum(["weekly", "biweekly", "monthly", "bimonthly", "custom"]).default("monthly"), installmentCount: z.coerce.number().int().min(1).max(240),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), graceDays: z.coerce.number().int().min(0).max(90).default(0),
  downPayment: z.coerce.number().min(0).default(0), paymentMethod: z.enum(["cash", "transfer", "card", "pos", "other"]).default("cash"),
  internalNotes: z.string().trim().max(2000).optional().default(""), customerNotes: z.string().trim().max(2000).optional().default(""),
  customSchedule: z.array(z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.coerce.number().positive() })).max(240).default([]),
});
const paymentInput = z.object({ amount: z.coerce.number().positive(), paymentMethod: z.enum(["cash", "transfer", "card", "pos", "other"]).default("cash"), receiptNumber: z.string().trim().max(100).optional().default(""), receiptImage: z.string().max(4_000_000).optional().default(""), paidAt: z.string().datetime().optional(), notes: z.string().trim().max(2000).optional().default(""), idempotencyKey: z.string().trim().min(8).max(120).optional(), allocations: z.array(z.object({ installmentId: z.coerce.number().int().positive(), amount: z.coerce.number().positive() })).max(240).default([]) });

let ready: Promise<void> | null = null;
async function ensureTables() {
  if (!ready) ready = db.execute(sql`select 1`).then(() => undefined);
  return ready;
}

function scheduleFor(data: z.infer<typeof convertInput>, financed: number) {
  if (data.installmentType === "custom") {
    if (data.customSchedule.length !== data.installmentCount) throw new Error("أدخل مبلغ وتاريخ كل قسط مخصص");
    if (Math.abs(data.customSchedule.reduce((s, x) => s + money(x.amount), 0) - financed) > .009) throw new Error("مجموع الأقساط المخصصة يجب أن يساوي المبلغ الممول");
    return data.customSchedule.map((x, i) => ({ no: i + 1, dueDate: x.dueDate, amount: money(x.amount) }));
  }
  const start = new Date(`${data.firstDueDate}T00:00:00`); const base = Math.floor((financed / data.installmentCount) * 100) / 100;
  return Array.from({ length: data.installmentCount }, (_, i) => {
    const date = new Date(start); const offset = data.frequency === "weekly" ? i * 7 : data.frequency === "biweekly" ? i * 15 : data.frequency === "bimonthly" ? i * 2 : i;
    if (data.frequency === "weekly" || data.frequency === "biweekly") date.setDate(date.getDate() + offset); else if (data.frequency !== "custom") date.setMonth(date.getMonth() + offset);
    const amount = i === data.installmentCount - 1 ? money(financed - base * (data.installmentCount - 1)) : base;
    return { no: i + 1, dueDate: date.toISOString().slice(0, 10), amount };
  });
}
function installmentStatus(row: any, grace = 0) { const due = String(row.due_date ?? row.dueDate); const paid = money(row.paid_amount ?? row.paidAmount), total = money(row.original_amount ?? row.originalAmount); const remaining = money(row.remaining_amount ?? row.remainingAmount); if (row.is_cancelled) return "cancelled"; if (paid > total + .009) return "overpaid"; if (remaining <= .009) return "paid"; const overdue = dayDiff(due) > grace; if (overdue) return "overdue"; if (due === today()) return "due_today"; const days = Math.ceil((new Date(`${due}T00:00:00`).getTime() - Date.now()) / 86400000); if (days <= 7) return paid > 0 ? "partial" : "due_soon"; return paid > 0 ? "partial" : "upcoming"; }
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
async function addHistory(executor: Executor, contractId: number, action: string, user: User, oldValue: any = {}, newValue: any = {}, reason = "", installmentId?: number | null) { await executor.execute(sql`INSERT INTO installment_history (contract_id, installment_id, action, old_value, new_value, reason, actor_id, actor_name) VALUES (${contractId}, ${installmentId ?? null}, ${action}, ${JSON.stringify(oldValue)}::jsonb, ${JSON.stringify(newValue)}::jsonb, ${reason || null}, ${user.id}, ${user.fullName || user.username})`); }

export async function handleInstallments(req: NextRequest, parts: string[], user: User) {
  await ensureTables(); const resource = parts[0] || "dashboard";
  if (!has(user, "installments.view")) return fail("لا تملك صلاحية عرض الأقساط", 403);
  if (resource === "eligible" && req.method === "GET") {
    const rows = await db.execute(sql`SELECT i.id, i.invoice_no AS "invoiceNo", i.customer_name AS "customerName", i.customer_phone AS "customerPhone", i.customer_id AS "customerId", i.total, i.paid_amount AS "paidAmount", i.remaining_amount AS "remainingAmount", i.payment_status AS "paymentStatus", i.status, c.id AS "contractId", c.status AS "installmentStatus" FROM sales_invoices i LEFT JOIN installment_contracts c ON c.sales_invoice_id=i.id AND c.status IN ('draft','active','paused','overdue') WHERE i.status='active' AND i.remaining_amount::numeric > 0 ORDER BY i.created_at DESC LIMIT 500`);
    return json({ items: rows.rows });
  }
  if (resource === "convert" && req.method === "POST") {
    if (!has(user, "installments.convert_invoice")) return fail("لا تملك صلاحية تحويل الفاتورة إلى أقساط", 403);
    const parsed = convertInput.safeParse(await readRequestBody(req)); if (!parsed.success) return fail("تحقق من بيانات عقد الأقساط"); const data = parsed.data;
    const invoice = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, data.invoiceId) });
    if (!invoice || invoice.status !== "active" || money(invoice.remainingAmount) <= 0) return fail("الفاتورة غير مؤهلة للتحويل إلى أقساط", 409);
    const exists = await db.execute(sql`SELECT id FROM installment_contracts WHERE source_type='sales_invoice' AND source_id=${invoice.id} AND status IN ('draft','active','paused','overdue')`); if (exists.rows[0]) return fail("توجد خطة أقساط نشطة لهذه الفاتورة", 409);
    const balance = money(invoice.remainingAmount); if (data.downPayment > balance) return fail("الدفعة المقدمة أكبر من الرصيد المتبقي", 422); const financed = money(balance - data.downPayment);
    if (financed <= 0) return fail("لا يمكن إنشاء خطة أقساط دون رصيد ممول", 422);
    let schedule; try { schedule = scheduleFor(data, financed); } catch (e) { return fail(e instanceof Error ? e.message : "جدول الأقساط غير صالح", 422); }
    const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const contract = await db.transaction(async (tx) => {
      const noResult = await tx.execute(sql`SELECT nextval('installment_contracts_id_seq') AS id`); const id = Number((noResult.rows[0] as any).id); const contractNo = `AJN-INS-${new Date().getFullYear()}-${String(id).padStart(6, "0")}`;
      const inserted = await tx.execute(sql`INSERT INTO installment_contracts (id, contract_no, public_token, source_type, source_id, sales_invoice_id, customer_id, customer_name, customer_phone, department, original_total, paid_before_conversion, balance_at_conversion, down_payment_amount, financed_amount, collected_amount, remaining_amount, installment_count, frequency, installment_type, first_due_date, last_due_date, grace_days, internal_notes, customer_notes, created_by, created_by_name) VALUES (${id}, ${contractNo}, ${token}, 'sales_invoice', ${invoice.id}, ${invoice.id}, ${invoice.customerId}, ${invoice.customerName}, ${invoice.customerPhone}, 'sales', ${String(money(invoice.total))}, ${String(money(invoice.paidAmount))}, ${String(balance)}, ${String(data.downPayment)}, ${String(financed)}, '0', ${String(financed)}, ${data.installmentCount}, ${data.frequency}, ${data.installmentType}, ${schedule[0].dueDate}, ${schedule.at(-1)?.dueDate ?? null}, ${data.graceDays}, ${data.internalNotes || null}, ${data.customerNotes || null}, ${user.id}, ${user.fullName || user.username}) RETURNING *`);
      for (const row of schedule) await tx.execute(sql`INSERT INTO installment_schedule (contract_id, installment_no, due_date, original_amount, remaining_amount) VALUES (${id}, ${row.no}, ${row.dueDate}, ${String(row.amount)}, ${String(row.amount)})`);
      return (inserted.rows[0] as any);
    });
    await addHistory(db, Number(contract.id), "contract_created", user, {}, { invoiceId: invoice.id, financed, schedule });
    await db.insert(entityTimelineTable).values({ entityType: "sales_invoice", entityId: invoice.id, type: "installment", title: "تم تحويل الفاتورة إلى خطة أقساط", actorId: user.id, actorName: user.fullName || user.username, metadata: { contractId: contract.id, contractNo: contract.contract_no } as any });
    await db.insert(notificationsTable).values({ audienceType: "admin", type: "installment_contract_created", title: "تم إنشاء عقد أقساط", body: `${contract.contract_no} · ${invoice.customerName}`, entityType: "installment_contract", entityId: Number(contract.id), href: `/admin/installments/${contract.id}`, metadata: { invoiceId: invoice.id } });
    if (data.downPayment > 0) { const result = await postInstallmentPayment(Number(contract.id), { amount: data.downPayment, paymentMethod: data.paymentMethod, receiptNumber: "", receiptImage: "", notes: "دفعة مقدمة عند تحويل الفاتورة إلى أقساط", idempotencyKey: `installment-down-${contract.id}` }, user, true); if (result instanceof NextResponse) return result; }
    return json({ contract, schedule }, 201);
  }
  if (resource === "dashboard" && req.method === "GET") {
    const c = await db.execute(sql`SELECT status, COALESCE(sum(financed_amount),0) financed, COALESCE(sum(collected_amount),0) collected, COALESCE(sum(remaining_amount),0) remaining, count(*) contracts FROM installment_contracts GROUP BY status`);
    const due = await db.execute(sql`SELECT COALESCE(sum(remaining_amount),0) due_today FROM installment_schedule WHERE due_date=CURRENT_DATE AND remaining_amount::numeric>0 AND is_cancelled=false`);
    const overdue = await db.execute(sql`SELECT COALESCE(sum(remaining_amount),0) amount, count(DISTINCT contract_id) contracts FROM installment_schedule WHERE due_date<CURRENT_DATE AND remaining_amount::numeric>0 AND is_cancelled=false`);
    return json({ summaries: c.rows, dueToday: money((due.rows[0] as any)?.due_today), overdue: { amount: money((overdue.rows[0] as any)?.amount), contracts: Number((overdue.rows[0] as any)?.contracts || 0) } });
  }
  if (resource === "contracts" && req.method === "GET") { const q = String(req.nextUrl.searchParams.get("q") || "").trim(); const rows = await db.execute(q ? sql`SELECT * FROM installment_contracts WHERE contract_no ILIKE ${`%${q}%`} OR customer_name ILIKE ${`%${q}%`} ORDER BY created_at DESC LIMIT 500` : sql`SELECT * FROM installment_contracts ORDER BY created_at DESC LIMIT 500`); return json({ items: rows.rows }); }
  if (resource === "reconcile" && req.method === "POST") {
    if (user.role !== "admin" && !user.permissions.includes("accounting"))
      return fail("مصالحة دفعات الأقساط متاحة للإدارة أو الحسابات فقط",403);
    const payload=await readRequestBody(req);
    const requestedId=payload?.contractId==null?null:Number(payload.contractId);
    if(requestedId!==null&&(!Number.isInteger(requestedId)||requestedId<=0))return fail("معرف العقد غير صالح",400);
    const ids=requestedId?[requestedId]:((await db.execute(sql`SELECT DISTINCT contract_id FROM installment_payments WHERE status='posted' AND financial_transaction_id IS NULL ORDER BY contract_id LIMIT 500`)).rows as any[]).map(row=>Number(row.contract_id));
    const reports=[];
    for(const contractId of ids)reports.push(await reconcileInstallmentPayments(contractId,user));
    return json({scanned:ids.length,reconciled:reports.filter(report=>report.createdTransactionId).length,reports});
  }
  const id = Number(parts[1]); if (!Number.isInteger(id) || id <= 0) return fail("معرف العقد غير صالح", 404);
  const contractRow = await db.execute(sql`SELECT * FROM installment_contracts WHERE id=${id}`); const contract = contractRow.rows[0] as any; if (!contract) return fail("عقد الأقساط غير موجود", 404);
  if (resource === "contracts" && parts.length === 2 && req.method === "GET") { const [schedule, payments, history] = await Promise.all([db.execute(sql`SELECT * FROM installment_schedule WHERE contract_id=${id} ORDER BY installment_no`), db.execute(sql`SELECT * FROM installment_payments WHERE contract_id=${id} ORDER BY paid_at DESC`), db.execute(sql`SELECT * FROM installment_history WHERE contract_id=${id} ORDER BY created_at DESC`)]); return json({ contract, schedule: schedule.rows.map((x:any) => ({ ...x, computedStatus: installmentStatus(x, Number(contract.grace_days)) })), payments: payments.rows, history: history.rows }); }
  if (resource === "contracts" && parts[2] === "payment" && req.method === "POST") { if (!has(user, "installments.receive_payment")) return fail("لا تملك صلاحية استلام الأقساط",403); const parsed = paymentInput.safeParse(await readRequestBody(req)); if (!parsed.success) return fail("تحقق من بيانات الدفعة"); const posted = await postInstallmentPayment(id, parsed.data, user); return posted instanceof NextResponse ? posted : json(posted, 201); }
  if (resource === "contracts" && parts[2] === "pause" && req.method === "POST") { if (!has(user,"installments.pause")) return fail("لا تملك صلاحية إيقاف الخطة",403); const payload=await readRequestBody(req); await db.execute(sql`UPDATE installment_contracts SET status='paused', updated_at=now() WHERE id=${id}`); await addHistory(db,id,"contract_paused",user,{status:contract.status},{status:"paused"},String(payload?.reason||"")); return json({status:"paused"}); }
  if (resource === "contracts" && parts[2] === "resume" && req.method === "POST") { if (!has(user,"installments.pause")) return fail("لا تملك صلاحية استئناف الخطة",403); await db.execute(sql`UPDATE installment_contracts SET status='active', updated_at=now() WHERE id=${id}`); await addHistory(db,id,"contract_resumed",user,{status:contract.status},{status:"active"}); return json({status:"active"}); }
  if (resource === "contracts" && parts[2] === "cancel" && req.method === "POST") {
    if (!has(user,"installments.cancel")) return fail("لا تملك صلاحية إلغاء الخطة",403);
    const reason=String((await readRequestBody(req))?.reason||"").trim();
    if(!reason)return fail("سبب الإلغاء مطلوب");
    const cancelled=await db.transaction(async tx=>{
      const locked=(await tx.execute(sql`SELECT * FROM installment_contracts WHERE id=${id} FOR UPDATE`)).rows[0] as any;
      if(!locked)return {error:"عقد الأقساط غير موجود",status:404};
      const payments=await tx.execute(sql`SELECT count(*) count FROM installment_payments WHERE contract_id=${id} AND status='posted'`);
      if(Number((payments.rows[0] as any)?.count||0)>0)return {error:"لا يمكن إلغاء عقد له دفعات؛ استخدم مسار العكس المالي المعتمد",status:409};
      await tx.execute(sql`UPDATE installment_contracts SET status='cancelled',cancelled_at=now(),cancelled_reason=${reason},updated_at=now() WHERE id=${id}`);
      await tx.execute(sql`UPDATE installment_schedule SET is_cancelled=true,status='cancelled',updated_at=now() WHERE contract_id=${id}`);
      await addHistory(tx,id,"contract_cancelled",user,{status:locked.status},{status:"cancelled"},reason);
      return {status:"cancelled"};
    });
    if("error" in cancelled)return fail(String(cancelled.error),Number(cancelled.status));
    return json(cancelled);
  }
  if (resource === "contracts" && parts[2] === "reschedule" && req.method === "POST") { if (!has(user,"installments.reschedule")) return fail("لا تملك صلاحية إعادة الجدولة",403); const input=z.object({reason:z.string().trim().min(3).max(1000),items:z.array(z.object({id:z.coerce.number().int().positive(),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amount:z.coerce.number().positive()})).min(1)}).safeParse(await readRequestBody(req)); if(!input.success)return fail("تحقق من جدول إعادة الجدولة"); const current=await db.execute(sql`SELECT * FROM installment_schedule WHERE contract_id=${id} AND paid_amount::numeric=0 AND is_cancelled=false ORDER BY installment_no`); const old=current.rows as any[]; if(old.length!==input.data.items.length || Math.abs(old.reduce((s,x)=>s+money(x.remaining_amount),0)-input.data.items.reduce((s,x)=>s+money(x.amount),0))>.009)return fail("يجب أن يساوي مجموع الجدول الجديد الرصيد المستقبلي",422); await db.transaction(async tx=>{for(const row of input.data.items){const found=old.find(x=>Number(x.id)===row.id);if(!found)throw new Error("لا يمكن تعديل قسط مدفوع أو غير تابع للعقد");await tx.execute(sql`UPDATE installment_schedule SET due_date=${row.dueDate},original_amount=${String(row.amount)},remaining_amount=${String(row.amount)},updated_at=now() WHERE id=${row.id}`);}await addHistory(tx,id,"schedule_rescheduled",user,old,input.data.items,input.data.reason);}); return json({ok:true}); }
  return fail("المسار غير موجود",404);
}

async function verifyLinkedFinancialMovement(tx:Tx,payment:any){
  if(!payment.financial_transaction_id)return false;
  const result=await tx.execute(sql`SELECT ft.id,ft.approval_status,ft.source_type,ft.source_id,ft.source_event,ft.amount,count(le.id)::int ledger_count FROM financial_transactions ft LEFT JOIN financial_ledger_entries le ON le.transaction_id=ft.id WHERE ft.id=${Number(payment.financial_transaction_id)} GROUP BY ft.id,ft.approval_status,ft.source_type,ft.source_id,ft.source_event,ft.amount`);
  const row=result.rows[0] as any;
  if(!row||row.approval_status!=="executed"||Number(row.ledger_count)<2)throw new Error("الدفعة مرتبطة بحركة مالية غير مكتملة");
  const direct=row.source_type==="installment_payment"&&String(row.source_id)===String(payment.id)&&Math.abs(money(row.amount)-money(payment.amount))<.005;
  const reconciled=row.source_type==="installment_contract"&&row.source_event==="reconciliation"&&String(row.source_id)===String(payment.contract_id);
  if(!direct&&!reconciled)throw new Error("الدفعة مرتبطة بحركة مالية لا تطابق مصدرها");
  return true;
}

async function createPaymentFinancialMovement(tx:Tx,payment:any,contract:any,user:User){
  const financial=await createAndExecuteSourceFinancialTransaction(tx,{
    transactionDate:String(payment.paid_at??new Date()).slice(0,10),direction:"revenue",amount:money(payment.amount),department:String(contract.department||"sales"),transactionType:"installment_collection",description:`تحصيل ${payment.payment_no} لعقد ${contract.contract_no}`,paymentMethod:payment.payment_method,sourceType:"installment_payment",sourceId:String(payment.id),sourceEvent:"collection",idempotencyKey:`installment-payment:${payment.id}:collection:v1`,customerId:contract.customer_id,customerName:contract.customer_name,customerPhone:contract.customer_phone,notes:payment.notes||null,attachments:[]
  },actor(user));
  const updated=await tx.execute(sql`UPDATE installment_payments SET financial_transaction_id=${financial.id} WHERE id=${payment.id} RETURNING *`);
  return updated.rows[0] as any;
}

export async function postInstallmentPayment(contractId:number,data:any,user:User,downPayment=false):Promise<NextResponse|{payment:any;duplicate?:boolean}>{
  await ensureMasterCashBoxTables();
  const key=data.idempotencyKey||randomUUID();
  const paymentResult=await db.transaction(async tx=>{
    const contract=(await tx.execute(sql`SELECT * FROM installment_contracts WHERE id=${contractId} FOR UPDATE`)).rows[0] as any;
    if(!contract)return {error:"العقد غير موجود",status:404};
    const duplicate=(await tx.execute(sql`SELECT * FROM installment_payments WHERE idempotency_key=${key} FOR UPDATE`)).rows[0] as any;
    if(duplicate){
      if(Number(duplicate.contract_id)!==contractId)return {error:"مفتاح التكرار مستخدم لعقد آخر",status:409};
      if(Math.abs(money(duplicate.amount)-money(data.amount))>.005||String(duplicate.payment_method)!==String(data.paymentMethod))return {error:"مفتاح التكرار مستخدم لدفعة مختلفة",status:409};
      if(!(await verifyLinkedFinancialMovement(tx,duplicate)))await reconcileInstallmentPaymentsInTransaction(tx,contractId,user,contract);
      const refreshed=(await tx.execute(sql`SELECT * FROM installment_payments WHERE id=${duplicate.id}`)).rows[0] as any;
      if(!(await verifyLinkedFinancialMovement(tx,refreshed)))throw new Error("تعذر تأكيد الحركة المالية للدفعة المكررة");
      return {payment:refreshed,duplicate:true};
    }
    if(!["active","overdue"].includes(contract.status))return {error:"لا يمكن استلام دفعة لعقد غير نشط",status:409};
    const schedules=((await tx.execute(sql`SELECT * FROM installment_schedule WHERE contract_id=${contractId} AND is_cancelled=false ORDER BY due_date, installment_no FOR UPDATE`)).rows as any[]);
    let left=money(data.amount);
    const chosen=downPayment?[]:data.allocations?.length?data.allocations.map((x:any)=>({row:schedules.find(s=>Number(s.id)===Number(x.installmentId)),amount:money(x.amount)})):schedules.map(row=>({row,amount:Math.min(left,money(row.remaining_amount))})).filter(x=>{if(!data.allocations?.length)left=money(left-x.amount);return x.amount>0;});
    if((data.allocations?.length&&chosen.some((x:any)=>!x.row))||chosen.reduce((sum:number,item:any)=>sum+item.amount,0)>money(data.amount)+.009)return {error:"توزيع الدفعة غير صالح",status:422};
    const seqRow=(await tx.execute(sql`SELECT nextval('installment_payments_id_seq') AS id`)).rows[0] as any;
    const seq=Number(seqRow?.id||0); const no=`AJN-INSP-${new Date().getFullYear()}-${String(seq).padStart(6,"0")}`;
    let payment=(await tx.execute(sql`INSERT INTO installment_payments (id,payment_no,idempotency_key,contract_id,amount,payment_method,receipt_number,receipt_image,paid_at,notes,received_by,received_by_name) VALUES (${seq},${no},${key},${contractId},${String(money(data.amount))},${data.paymentMethod},${data.receiptNumber||null},${data.receiptImage||null},${data.paidAt?new Date(data.paidAt):new Date()},${data.notes||null},${user.id},${user.fullName||user.username}) RETURNING *`)).rows[0] as any;
    for(const allocation of chosen){if(!allocation.row)continue;const next=money(allocation.row.paid_amount)+allocation.amount;const remaining=money(allocation.row.original_amount)-next;await tx.execute(sql`UPDATE installment_schedule SET paid_amount=${String(next)},remaining_amount=${String(Math.max(0,remaining))},payment_method=${data.paymentMethod},receipt_number=${data.receiptNumber||null},receipt_image=${data.receiptImage||null},paid_at=${remaining<=.009?new Date():null},updated_at=now() WHERE id=${allocation.row.id}`);await tx.execute(sql`INSERT INTO installment_payment_allocations (payment_id,installment_id,amount) VALUES (${payment.id},${allocation.row.id},${String(allocation.amount)})`);}
    const allocated=chosen.reduce((sum:number,item:any)=>sum+item.amount,0);const projectedCollected=money(contract.collected_amount)+money(data.amount);const projectedScheduled=money(contract.scheduled_paid_amount)+allocated;const remaining=money(contract.financed_amount)-projectedScheduled;const contractStatus=remaining<=.009?"completed":"active";
    await tx.execute(sql`UPDATE installment_contracts SET collected_amount=${String(projectedCollected)},scheduled_paid_amount=${String(projectedScheduled)},remaining_amount=${String(Math.max(0,remaining))},status=${contractStatus},updated_at=now() WHERE id=${contractId}`);
    if(contract.sales_invoice_id)await tx.execute(sql`UPDATE sales_invoices SET paid_amount=paid_amount::numeric+${String(money(data.amount))},remaining_amount=GREATEST(total::numeric-(paid_amount::numeric+${String(money(data.amount))}),0),payment_status=CASE WHEN paid_amount::numeric+${String(money(data.amount))}>total::numeric THEN 'overpaid' WHEN paid_amount::numeric+${String(money(data.amount))}>=total::numeric THEN 'paid' WHEN paid_amount::numeric+${String(money(data.amount))}>0 THEN 'partial' ELSE 'unpaid' END,updated_at=now() WHERE id=${contract.sales_invoice_id}`);
    payment=await createPaymentFinancialMovement(tx,payment,contract,user);
    await addHistory(tx,contractId,downPayment?"down_payment_received":"payment_received",user,{}, {paymentId:payment.id,amount:data.amount,financialTransactionId:payment.financial_transaction_id});
    await tx.insert(entityTimelineTable).values({entityType:"installment_contract",entityId:contractId,type:"payment",title:downPayment?"تم استلام الدفعة المقدمة":"تم استلام قسط",actorId:user.id,actorName:user.fullName||user.username,metadata:{paymentId:payment.id,amount:data.amount,financialTransactionId:payment.financial_transaction_id}as any});
    return {payment};
  });
  if("error"in paymentResult)return fail(String(paymentResult.error),Number(paymentResult.status??400));
  return paymentResult;
}

async function reconcileInstallmentPaymentsInTransaction(tx:Tx,contractId:number,user:User,lockedContract?:any){
  const contract=lockedContract??((await tx.execute(sql`SELECT * FROM installment_contracts WHERE id=${contractId} FOR UPDATE`)).rows[0] as any);
  if(!contract)throw new Error("عقد الأقساط غير موجود");
  const payments=(await tx.execute(sql`SELECT * FROM installment_payments WHERE contract_id=${contractId} AND status='posted' AND reversed_at IS NULL ORDER BY id FOR UPDATE`)).rows as any[];
  const paymentIds=payments.map(payment=>String(payment.id));
  const paymentMovements=paymentIds.length?sql`OR (source_type='installment_payment' AND source_id IN (${sql.join(paymentIds.map(id=>sql`${id}`),sql`, `)}))`:sql``;
  const relevantFinancials=(await tx.execute(sql`SELECT * FROM financial_transactions WHERE ((source_type='installment_contract' AND source_id=${String(contractId)} AND source_event IN ('payment','reconciliation')) ${paymentMovements}) ORDER BY id FOR UPDATE`)).rows as any[];
  const unresolvedFinancials=relevantFinancials.filter(financial=>financial.approval_status!=="executed");
  if(unresolvedFinancials.length)throw new Error(`توجد حركات مالية غير منفذة مرتبطة بالعقد (${unresolvedFinancials.map(item=>item.id).join(", ")})؛ تتطلب مراجعة قبل المصالحة`);
  const financials=relevantFinancials;
  for(const financial of financials){const ledger=await tx.execute(sql`SELECT count(*)::int value FROM financial_ledger_entries WHERE transaction_id=${financial.id}`);if(Number((ledger.rows[0] as any)?.value)<2)throw new Error(`الحركة المالية ${financial.id} بلا قيد محاسبي مكتمل`);}
  const expected=money(payments.reduce((sum,payment)=>sum+money(payment.amount),0));
  const executedBefore=money(financials.reduce((sum,financial)=>sum+(financial.direction==="revenue"?money(financial.amount):-money(financial.amount)),0));
  const delta=money(expected-executedBefore);
  if(delta<-.005)throw new Error("الحركات المالية للأقساط أكبر من الدفعات المسجلة؛ تتطلب مراجعة يدوية");
  let createdTransactionId:number|null=null;
  if(delta>.004){
    const financial=await createAndExecuteSourceFinancialTransaction(tx,{direction:"revenue",amount:delta,department:String(contract.department||"sales"),transactionType:"installment_collection",description:`مصالحة دفعات عقد ${contract.contract_no}`,paymentMethod:"cash",sourceType:"installment_contract",sourceId:String(contractId),sourceEvent:"reconciliation",idempotencyKey:`installment-reconcile:${contractId}:${expected.toFixed(2)}:v1`,customerId:contract.customer_id,customerName:contract.customer_name,customerPhone:contract.customer_phone,notes:"مصالحة آلية قابلة لإعادة التشغيل لدفعات قديمة غير مرتبطة محاسبياً",attachments:[]},actor(user));
    createdTransactionId=financial.id;
  }
  const linkedIds:number[]=[];
  for(const payment of payments.filter(item=>!item.financial_transaction_id)){
    const direct=financials.find(financial=>financial.source_type==="installment_payment"&&String(financial.source_id)===String(payment.id));
    const anchor=direct?.id??createdTransactionId??financials.at(-1)?.id??null;
    if(anchor){await tx.execute(sql`UPDATE installment_payments SET financial_transaction_id=${anchor} WHERE id=${payment.id} AND financial_transaction_id IS NULL`);linkedIds.push(Number(payment.id));}
  }
  const report={contractId,contractNo:contract.contract_no,paymentCount:payments.length,expectedAmount:expected,executedBefore,delta,createdTransactionId,linkedPaymentIds:linkedIds};
  if(createdTransactionId||linkedIds.length)await addHistory(tx,contractId,"financial_reconciled",user,{executedAmount:executedBefore},{executedAmount:expected,...report},"مصالحة دفعات الأقساط القديمة");
  return report;
}

export async function reconcileInstallmentPayments(contractId:number,user:User){
  await ensureMasterCashBoxTables();
  return db.transaction(tx=>reconcileInstallmentPaymentsInTransaction(tx,contractId,user));
}
