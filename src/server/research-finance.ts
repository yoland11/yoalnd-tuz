import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, customersTable, entityTimelineTable, expensesTable, financialAccountsTable, financialAuditLogsTable, financialTransactionsTable } from "@workspace/db";
import type { ResearchAdminUser } from "./research-center";
import { createAndExecuteSourceFinancialTransaction, type FinancialActor } from "./master-cash-box";
import { reconcilePaymentState } from "./payment-state";
import { getCustomerStatement, buildCustomerStatement } from "./customer-account";
import { assertResearchCollection, assertResearchRetry, researchMoney, ResearchFinanceError, requireResearchFinance, researchStatementDay } from "./research-payment-rules";
import { lockResearchPaymentSources, readResearchCanonicalPaymentState, readResearchPendingAmount } from "./research-payment-state";
import {getResearchPurchases} from './research-purchases';
export { ResearchFinanceError } from "./research-payment-rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PaymentMethod = "cash" | "transfer" | "card" | "pos" | "other";
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const centsText = (cents: number) => (cents / 100).toFixed(2);
const actor = (user: ResearchAdminUser): FinancialActor => ({ id: user.id, name: user.fullName || user.username, role: user.role, permissions: user.permissions });
const idSchema = z.coerce.number().int().positive();
const validDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "تاريخ غير صالح");
const amountSchema = z.union([z.string(), z.number()]).transform(value => { const cents = researchMoney(value); if (cents <= 0) throw new ResearchFinanceError("مبلغ الدفعة يجب أن يكون أكبر من صفر", 400, "INVALID_AMOUNT"); return centsText(cents); });
const paymentSchema = z.object({
  amount: amountSchema, method: z.enum(["cash", "transfer", "card", "pos", "other"]).optional(), paymentMethod: z.enum(["cash", "transfer", "card", "pos", "other"]).optional(),
  paymentDate: validDate.optional(), notes: z.string().trim().max(2000).optional(), accountId: idSchema.nullable().optional(), idempotencyKey: z.string().trim().min(8).max(140),
});
const expenseSchema = z.object({ amount: amountSchema, category: z.string().trim().min(1).max(200), description: z.string().trim().min(2).max(500), paymentMethod: z.enum(["cash", "transfer", "card", "pos", "other"]).default("cash"), paymentDate: validDate.optional(), notes: z.string().trim().max(2000).optional(), idempotencyKey: z.string().trim().min(8).max(140) });

function parsed<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ResearchFinanceError(result.error.issues.map(issue => issue.message).join("، "), 400, "VALIDATION_ERROR");
  return result.data;
}
/** The central engine posts to its fixed master cash account. A supplied
 * selector must resolve to that same active account, never an arbitrary ledger. */
async function accountReference(tx: Tx, accountId?: number | null) {
  if (accountId == null) return null;
  const [account] = await tx.select().from(financialAccountsTable).where(eq(financialAccountsTable.id, accountId)).limit(1);
  if (!account || !account.isActive || account.code !== "1000" || account.accountType !== "asset")
    throw new ResearchFinanceError("اختر حساب الصندوق الرئيسي الفعال", 400, "INVALID_FINANCIAL_ACCOUNT");
  return `research-account:${account.id}`;
}

export async function createResearchPaymentRequest(tx: Tx, input: { orderId: number; amount: number | string; paymentMethod: string; paymentDate?: string; notes?: string; accountId?: number | null; idempotencyKey: string }, user: ResearchAdminUser) {
  requireResearchFinance(user, "research.payment.receive");
  const data = parsed(paymentSchema, input);
  const orderId = parsed(idSchema, input.orderId);
  const [order] = await lockResearchPaymentSources(tx, { sourceType: "research_order", sourceId: orderId });
  const state = await reconcilePaymentState(tx, { sourceType: "research_order", sourceId: orderId });
  if (!state) throw new Error("Research canonical payment state unavailable");
  const key = `research-payment:${orderId}:${data.idempotencyKey}`;
  const [existing] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.idempotencyKey, key)).limit(1);
  const method = ((data.paymentMethod ?? data.method ?? "cash") === "card" ? "pos" : data.paymentMethod ?? data.method ?? "cash") as PaymentMethod;
  const referenceNo = await accountReference(tx, data.accountId);
  // An omitted date reuses the initial date across midnight on an identical retry.
  const paymentDate = data.paymentDate ?? existing?.transactionDate ?? day();
  if (existing) {
    if (existing.sourceType !== "research_order" || existing.sourceId !== String(orderId) || existing.direction !== "revenue" || existing.transactionType !== "research_payment") throw new ResearchFinanceError("مفتاح التكرار مرتبط بعملية أخرى", 409, "IDEMPOTENCY_CONFLICT");
    // Review notes can be appended to financial_transactions.notes on approval;
    // compare the immutable submitted snapshot to the request's original notes.
    const [submitted] = await tx.select({ values: financialAuditLogsTable.newValues }).from(financialAuditLogsTable).where(and(eq(financialAuditLogsTable.transactionId, existing.id), eq(financialAuditLogsTable.action, "submitted"))).orderBy(asc(financialAuditLogsTable.id)).limit(1);
    if (!submitted) throw new ResearchFinanceError("تعذر التحقق من بيانات طلب الدفع الأصلية", 409, "IDEMPOTENCY_SNAPSHOT_MISSING");
    const originalNotes = submitted.values.notes;
    assertResearchRetry({ amount: existing.amount, method: existing.paymentMethod, date: existing.transactionDate, notes: originalNotes == null ? null : String(originalNotes), accountId: existing.referenceNo?.startsWith("research-account:") ? Number(existing.referenceNo.slice(17)) : null }, { amount: data.amount, method, date: paymentDate, notes: data.notes, accountId: data.accountId }, existing.approvalStatus);
    return { transaction: existing, duplicate: true, paidAmount: state.approvedPaidAmount, remainingAmount: state.remainingAmount, paymentStatus: state.paymentStatus, pendingAmount: await readResearchPendingAmount(tx, orderId, order.invoice_id) };
  }
  const pending = await readResearchPendingAmount(tx, orderId, order.invoice_id);
  assertResearchCollection({ amount: data.amount, remaining: state.remainingAmount, pending });
  const transaction = await createAndExecuteSourceFinancialTransaction(tx, {
    direction: "revenue", amount: Number(data.amount), department: "research", transactionType: "research_payment", description: `دفعة طلب بحث #${orderId}`, paymentMethod: method,
    transactionDate: paymentDate, sourceType: "research_order", sourceId: String(orderId), sourceEvent: "payment", idempotencyKey: key,
    customerId: order.customer_id, dueDate: order.payment_due_date, notes: data.notes ?? null, referenceNo, attachments: [],
  }, actor(user));
  await tx.insert(entityTimelineTable).values({ entityType: "research_order", entityId: orderId, type: "research_payment_requested", title: "إرسال دفعة لاعتماد الإدارة", body: `دفعة ${data.amount} بانتظار الاعتماد`, actorId: user.id, actorName: actor(user).name, metadata: { transactionId: transaction.id, amount: data.amount } });
  return { transaction, duplicate: false, paidAmount: state.approvedPaidAmount, remainingAmount: state.remainingAmount, paymentStatus: state.paymentStatus, pendingAmount: centsText(researchMoney(pending) + researchMoney(data.amount)) };
}

export async function requestResearchPayment(orderId: number, raw: unknown, user: ResearchAdminUser) {
  const data = parsed(paymentSchema, raw);
  return db.transaction(tx => createResearchPaymentRequest(tx, { ...data, orderId, paymentMethod: data.paymentMethod ?? data.method ?? "cash" }, user));
}

export async function assertResearchPriceChange(tx: Tx, orderId: number, newTotal: string | number) {
  const [order] = await lockResearchPaymentSources(tx, { sourceType: "research_order", sourceId: orderId }, false);
  const state = await reconcilePaymentState(tx, { sourceType: "research_order", sourceId: orderId });
  if (!state) throw new Error("Research canonical payment state unavailable");
  const pending = await readResearchPendingAmount(tx, orderId, order.invoice_id);
  const canonical = await readResearchCanonicalPaymentState(tx, orderId);
  const minimum = researchMoney(state.approvedPaidAmount) + researchMoney(pending) + researchMoney(canonical.creditAmount);
  if (researchMoney(newTotal) < minimum) throw new ResearchFinanceError("القيمة الجديدة أقل من الدفعات المعتمدة والطلبات المعلقة والائتمان المعتمد", 409, "PRICE_BELOW_FINANCIAL_COMMITMENTS");
  return { approvedPaid: state.approvedPaidAmount, pendingAmount: pending, minimumTotal: centsText(minimum) };
}

export async function listResearchExpenses(orderId: number, params = new URLSearchParams()) {
  parsed(idSchema, orderId);
  const from = params.get("from"), to = params.get("to");
  if (from) parsed(validDate, from); if (to) parsed(validDate, to);
  const conditions = [eq(expensesTable.researchOrderId, orderId), isNull(expensesTable.deletedAt)];
  if (from) conditions.push(sql`${expensesTable.date} >= ${from}`);
  if (to) conditions.push(sql`${expensesTable.date} <= ${to}`);
  const [order] = (await db.execute(sql`SELECT id FROM research_orders WHERE id=${orderId}`)).rows ?? [];
  if (!order) throw new ResearchFinanceError("طلب البحث غير موجود", 404, "NOT_FOUND");
  return db.select({ ...getTableColumns(expensesTable),
    netAmount: sql<string>`coalesce((SELECT sum(CASE WHEN f.direction='expense' THEN f.amount::numeric ELSE -f.amount::numeric END) FROM financial_transactions f WHERE f.source_type='expense' AND f.source_id=${expensesTable.id}::text AND f.approval_status='executed'),0)::text`,
    reversedAmount: sql<string>`coalesce((SELECT sum(f.amount::numeric) FROM financial_transactions f WHERE f.source_type='expense' AND f.source_id=${expensesTable.id}::text AND f.direction='revenue' AND f.approval_status='executed' AND f.reversed_transaction_id IS NOT NULL),0)::text`,
  }).from(expensesTable).where(and(...conditions)).orderBy(desc(expensesTable.date), desc(expensesTable.id)).limit(500);
}

export async function createResearchExpense(orderId: number, raw: unknown, user: ResearchAdminUser) {
  requireResearchFinance(user, "research.financials.view");
  const data = parsed(expenseSchema, raw);
  parsed(idSchema, orderId);
  return db.transaction(async tx => {
    await lockResearchPaymentSources(tx, { sourceType: "research_order", sourceId: orderId }, false);
    const key = `research-expense:${orderId}:${data.idempotencyKey}`;
    const [existing] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.idempotencyKey, key)).limit(1);
    const method = data.paymentMethod === "card" ? "pos" : data.paymentMethod;
    if (existing) {
      const [expense] = await tx.select().from(expensesTable).where(and(eq(expensesTable.researchOrderId, orderId), eq(expensesTable.financialTransactionId, existing.id))).limit(1);
      if (!expense || existing.sourceType !== "expense" || existing.sourceId !== String(expense.id) || expense.name !== data.description || expense.categoryName !== data.category) throw new ResearchFinanceError("مفتاح التكرار مرتبط بمصروف مختلف", 409, "IDEMPOTENCY_CONFLICT");
      assertResearchRetry({ amount: expense.amount, method: expense.paymentMethod, date: expense.date, notes: expense.notes }, { amount: data.amount, method, date: data.paymentDate ?? expense.date, notes: data.notes }, existing.approvalStatus);
      return { expense, transaction: existing, duplicate: true };
    }
    const [expense] = await tx.insert(expensesTable).values({ researchOrderId: orderId, date: data.paymentDate ?? day(), name: data.description, amount: data.amount, categoryName: data.category, paymentMethod: method, notes: data.notes ?? null, createdBy: user.id, createdByName: actor(user).name, approvalStatus: "pending" }).returning();
    const transaction = await createAndExecuteSourceFinancialTransaction(tx, { direction: "expense", amount: Number(data.amount), department: "research", transactionType: "research_expense", description: data.description, paymentMethod: method, transactionDate: expense.date, sourceType: "expense", sourceId: String(expense.id), sourceEvent: "expense", idempotencyKey: key, notes: data.notes ?? null, attachments: [] }, actor(user));
    const [linked] = await tx.update(expensesTable).set({ financialTransactionId: transaction.id }).where(eq(expensesTable.id, expense.id)).returning();
    await tx.insert(entityTimelineTable).values({ entityType: "research_order", entityId: orderId, type: "research_expense_requested", title: "إرسال مصروف لاعتماد الإدارة", body: data.description, actorId: user.id, actorName: actor(user).name, metadata: { expenseId: expense.id, transactionId: transaction.id, amount: data.amount } });
    return { expense: linked, transaction, duplicate: false };
  });
}

export async function getResearchFinancialAccount(orderId: number) {
  const state = await readResearchCanonicalPaymentState(db, parsed(idSchema, orderId));
  const [pendingAmount, expenses, historyResult, expenseTotals, purchases] = await Promise.all([
    readResearchPendingAmount(db, orderId, state.invoiceId), listResearchExpenses(orderId),
    db.execute(sql`SELECT f.id::text AS id, f.transaction_no AS "transactionNo", f.transaction_date AS date, f.amount::text AS amount, f.direction, f.payment_method AS "paymentMethod", f.approval_status AS "approvalStatus", f.source_type AS "sourceType", f.source_id AS "sourceId", f.notes,
      (f.amount::numeric-coalesce((SELECT sum(rev.amount::numeric) FROM financial_transactions rev WHERE rev.reversed_transaction_id=f.id AND rev.approval_status='executed'),0))::text AS "netAmount", f.requested_by_name AS "receivedByName", f.executed_by_name AS "approvedByName", f.transaction_time AS "occurredAt"
      FROM financial_transactions f WHERE (f.source_type='research_order' AND f.source_id=${String(orderId)}) OR (f.source_type='sales_invoice' AND f.source_id=${String(state.invoiceId ?? 0)})
        OR (f.source_type='installment_payment' AND EXISTS (SELECT 1 FROM installment_payments p JOIN installment_contracts c ON c.id=p.contract_id WHERE p.id::text=f.source_id AND c.sales_invoice_id=${state.invoiceId ?? 0}))
        OR (f.source_type='installment_contract' AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.id::text=f.source_id AND c.sales_invoice_id=${state.invoiceId ?? 0}) AND f.source_event IN ('payment','reconciliation','reversal'))
      UNION ALL SELECT 'allocation:'||a.id, v.voucher_no, v.date, a.amount::text, 'revenue', v.method, CASE WHEN a.posted_at IS NOT NULL THEN coalesce(v.approval_status,'executed') ELSE coalesce(f.approval_status,v.approval_status) END, a.source_type, a.source_id::text, v.notes, greatest(a.amount::numeric-coalesce(a.reversed_amount::numeric,0),0)::text, v.created_by_name, f.executed_by_name, coalesce(a.posted_at,v.created_at)
      FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id LEFT JOIN financial_transactions f ON f.id=v.financial_transaction_id WHERE (a.source_type='research_order' AND a.source_id=${orderId}) OR (a.source_type='sales_invoice' AND a.source_id=${state.invoiceId ?? 0})
      ORDER BY date DESC, "occurredAt" DESC, id DESC LIMIT 500`),
    db.execute(sql`SELECT coalesce(sum(CASE WHEN f.approval_status='executed' THEN CASE WHEN f.direction='expense' THEN f.amount::numeric ELSE -f.amount::numeric END ELSE 0 END),0)::text AS approved,
      coalesce(sum(CASE WHEN f.approval_status='pending' AND f.direction='expense' THEN f.amount::numeric ELSE 0 END),0)::text AS pending
      FROM expenses e JOIN financial_transactions f ON f.source_type='expense' AND f.source_id=e.id::text WHERE e.research_order_id=${orderId} AND e.deleted_at IS NULL`),
    getResearchPurchases(orderId),
  ]);
  const history = historyResult.rows ?? [];
  const approvedExpenseAmount = String(expenseTotals.rows?.[0]?.approved ?? "0");
  const pendingExpenseAmount = String(expenseTotals.rows?.[0]?.pending ?? "0");
  const lifecycle = await db.execute(sql`SELECT status FROM research_orders WHERE id=${orderId}`);
  const directCost=Number(approvedExpenseAmount)+Number(purchases.costSummary.purchaseCost);
  return { ...state, paidAmount: state.approvedPaidAmount, pendingAmount, availableToRequest: centsText(Math.max(researchMoney(state.remainingAmount) - researchMoney(pendingAmount), 0)), history, lastPayment: history.find((item: any) => item.approvalStatus === "executed" && item.direction === "revenue" && Number(item.netAmount) > 0) ?? null, expenses, approvedExpenseAmount, pendingExpenseAmount, purchases:purchases.items,costSummary:purchases.costSummary,estimatedProfit: Number(state.totalAmount) - directCost, netCashFlow: Number(state.approvedPaidAmount) - Number(approvedExpenseAmount) - Number(purchases.costSummary.paidToSuppliers), actualProfit: null, operationalContribution: String(lifecycle.rows?.[0]?.status)==='delivered' ? Number(state.totalAmount) - directCost : null };
}

export async function getResearchStudentStatement(customerId: number, params = new URLSearchParams()) {
  parsed(idSchema, customerId);
  const from = params.get("from"), to = params.get("to");
  if (from) parsed(validDate, from); if (to) parsed(validDate, to);
  if (from && to && from > to) throw new ResearchFinanceError("بداية الفترة بعد نهايتها", 400, "INVALID_PERIOD");
  const [customer] = await db.select({ id: customersTable.id, name: customersTable.name, fullName: customersTable.fullName, phone: customersTable.phone }).from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
  if (!customer) throw new ResearchFinanceError("الطالب غير موجود", 404, "NOT_FOUND");
  const research = await db.execute(sql`SELECT id, invoice_id, research_no, title FROM research_orders WHERE customer_id=${customerId}`);
  const invoiceIds = new Set((research.rows ?? []).map((row: any) => Number(row.invoice_id)).filter(Boolean));
  // Original infrastructure identifies research mirrors and net approved cash.
  // Customer-level unallocated credits cannot be attributed to this department.
  const original = await getCustomerStatement(customer);
  const lines = original.entries.filter(entry => entry.sourceType === "sales_invoice" && entry.sourceId !== null && invoiceIds.has(entry.sourceId));
  const returnsReady = await db.execute(sql`SELECT to_regclass('public.sales_return_settlements') IS NOT NULL AS ready`);
  if (returnsReady.rows?.[0]?.ready === true) {
    const credits = await db.execute(sql`SELECT s.id, s.invoice_id, s.amount::text, s.status, s.created_at, s.reversed_at, r.return_no, invoice.invoice_no
      FROM sales_return_settlements s JOIN sales_returns r ON r.id=s.return_id JOIN sales_invoices invoice ON invoice.id=s.invoice_id
      WHERE s.customer_id=${customerId} AND s.kind='invoice_credit' AND s.status IN ('applied','reversed')
        AND EXISTS (SELECT 1 FROM research_orders research WHERE research.invoice_id=s.invoice_id AND research.customer_id=${customerId})`);
    for (const row of credits.rows ?? []) {
      const base = { type: "ائتمان فاتورة بحث", reference: String(row.return_no), description: `خصم مرتجع معتمد من مديونية ${row.invoice_no}`, sourceType: "sales_invoice" as const, sourceId: Number(row.invoice_id), documentReference: String(row.invoice_no), kind: "return" as const, balance: 0 };
      lines.push({ ...base, date: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at), debit: 0, credit: Number(row.amount) });
      if (row.status === "reversed") lines.push({ ...base, date: row.reversed_at instanceof Date ? row.reversed_at.toISOString() : String(row.reversed_at), type: "عكس ائتمان فاتورة بحث", description: `عكس الخصم المعتمد من مديونية ${row.invoice_no}`, debit: Number(row.amount), credit: 0 });
    }
  }
  const datedLines = lines.map(entry => ({entry, day: researchStatementDay(entry.date) ?? ""}));
  const openingBalance = datedLines.filter(({day}) => from && day < from).reduce((sum, {entry}) => sum + entry.debit - entry.credit, 0);
  const selected = datedLines.filter(({day}) => (!from || day >= from) && (!to || day <= to)).map(({entry}) => entry);
  const statement = buildCustomerStatement(selected);
  // Enrich the existing statement, without deriving or posting money again.
  // Both the reference and original invoice identify each employee snapshot.
  const references = [...new Set(statement.entries.filter(entry => entry.kind === 'payment' || entry.kind === 'receipt' || entry.kind === 'installment').map(entry => entry.reference))];
  const receivingEmployees = new Map<string, string | null>();
  if (references.length) {
    const employees = await db.execute(sql`SELECT r.invoice_id AS "invoiceId", coalesce(f.transaction_no,'#'||f.id) AS reference, f.requested_by_name AS "receivedByName"
      FROM research_orders r JOIN financial_transactions f ON
        (f.source_type='research_order' AND f.source_id=r.id::text)
        OR (f.source_type='sales_invoice' AND f.source_id=r.invoice_id::text)
        OR (f.source_type='installment_payment' AND EXISTS (SELECT 1 FROM installment_payments p JOIN installment_contracts c ON c.id=p.contract_id WHERE p.id::text=f.source_id AND c.sales_invoice_id=r.invoice_id))
        OR (f.source_type='installment_contract' AND f.source_event IN ('payment','reconciliation','reversal') AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.id::text=f.source_id AND c.sales_invoice_id=r.invoice_id))
      WHERE r.customer_id=${customerId} AND f.approval_status='executed'
        AND coalesce(f.transaction_no,'#'||f.id) IN (SELECT jsonb_array_elements_text(${JSON.stringify(references)}::jsonb))
      UNION ALL SELECT r.invoice_id, v.voucher_no, v.created_by_name
      FROM research_orders r JOIN receipt_voucher_allocations a ON (a.source_type='research_order' AND a.source_id=r.id) OR (a.source_type='sales_invoice' AND a.source_id=r.invoice_id)
      JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id
      WHERE r.customer_id=${customerId} AND a.posted_at IS NOT NULL AND coalesce(v.approval_status,'executed')='executed'
        AND v.voucher_no IN (SELECT jsonb_array_elements_text(${JSON.stringify(references)}::jsonb))`);
    for (const row of employees.rows ?? []) receivingEmployees.set(`${row.invoiceId}:${row.reference}`, row.receivedByName == null ? null : String(row.receivedByName));
  }
  const entries = statement.entries.map(entry => ({ ...entry, balance: entry.balance + openingBalance, receivedByName: receivingEmployees.get(`${entry.sourceId}:${entry.reference}`) ?? null }));
  const documents = original.documents.filter(doc => doc.sourceType === "sales_invoice" && invoiceIds.has(doc.sourceId)).map(doc => {
    const order = (research.rows ?? []).find((row: any) => Number(row.invoice_id) === doc.sourceId);
    return { ...doc, researchOrderId: Number(order?.id), researchNo: String(order?.research_no ?? ""), title: String(order?.title ?? "") };
  });
  return { customer, scope: "research" as const, from, to, openingBalance, entries, closingBalance: openingBalance + statement.closingBalance, documents, documentsRemaining: documents.reduce((sum, doc) => sum + doc.remaining, 0), creditBalance: documents.reduce((sum, doc) => sum + (doc.credited ?? 0), 0), unallocatedCustomerCreditExcluded: true };
}
