import { sql } from "drizzle-orm";
import { assertResearchCollection, researchMoney, ResearchFinanceError } from "./research-payment-rules";

export type ResearchExecutor = { execute: (query: any) => Promise<any> };
type Source = { sourceType?: string | null; sourceId?: string | number | null };
type ResearchSource = { id: number; invoice_id: number | null; invoice_total?: string | null; invoice_status?:string|null; total_amount: string; customer_id: number; status: string; payment_due_date: string | null };
const decimal = (cents: number) => (cents / 100).toFixed(2);
let researchTableKnown = false;
async function researchTableAvailable(tx: ResearchExecutor) {
  if (researchTableKnown) return true;
  const result = await tx.execute(sql`/* research_table_available */ SELECT to_regclass('public.research_orders') IS NOT NULL AS ready`);
  researchTableKnown = result.rows?.[0]?.ready === true;
  return researchTableKnown;
}
function sourceId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ResearchFinanceError("معرّف مصدر الدفعة غير صالح", 400);
  return id;
}

/** All research aliases acquire the same sorted original rows before financial,
 * voucher, invoice or cash locks. Unrelated sources retain their existing path. */
export async function lockResearchPaymentSources(tx: ResearchExecutor, source: Source | Source[], requireActive = true): Promise<ResearchSource[]> {
  const sources = (Array.isArray(source) ? source : [source]).filter(item => ["research_order", "sales_invoice", "receipt_voucher", "installment_contract", "installment_payment"].includes(item.sourceType ?? ""));
  if (!sources.length) return [];
  if (!(await researchTableAvailable(tx))) {
    if (sources.some(item => item.sourceType === "research_order")) throw new ResearchFinanceError("جداول البحوث غير متاحة", 409, "RESEARCH_SCHEMA_UNAVAILABLE");
    return [];
  }
  const matches = sources.map(item => {
    const id = sourceId(item.sourceId);
    return item.sourceType === "research_order" ? sql`r.id = ${id}`
      : item.sourceType === "sales_invoice" ? sql`r.invoice_id = ${id}`
      : item.sourceType === "receipt_voucher" ? sql`r.id IN (SELECT a.source_id FROM receipt_voucher_allocations a WHERE a.receipt_voucher_id = ${id} AND a.source_type = 'research_order') OR r.invoice_id IN (SELECT a.source_id FROM receipt_voucher_allocations a WHERE a.receipt_voucher_id = ${id} AND a.source_type = 'sales_invoice')`
      : item.sourceType === "installment_contract" ? sql`r.invoice_id IN (SELECT sales_invoice_id FROM installment_contracts WHERE id = ${id})`
      : sql`r.invoice_id IN (SELECT c.sales_invoice_id FROM installment_contracts c JOIN installment_payments p ON p.contract_id = c.id WHERE p.id = ${id})`;
  });
  const condition = matches.reduce((left, right) => sql`(${left}) OR (${right})`);
  const result = await tx.execute(sql`/* research_source_lock */ SELECT r.id, r.invoice_id, (SELECT invoice.total::text FROM sales_invoices invoice WHERE invoice.id=r.invoice_id) AS invoice_total, (SELECT invoice.status FROM sales_invoices invoice WHERE invoice.id=r.invoice_id) AS invoice_status, r.total_amount::text, r.customer_id, r.status, to_jsonb(r)->>'payment_due_date' AS payment_due_date FROM research_orders r WHERE ${condition} ORDER BY r.id FOR UPDATE`);
  const rows = (result.rows ?? []) as ResearchSource[];
  for (const item of sources) if (item.sourceType === "research_order" && !rows.some(row => Number(row.id) === Number(item.sourceId))) throw new ResearchFinanceError("طلب البحث غير موجود", 404, "NOT_FOUND");
  if (requireActive && rows.some(row => ["archived", "cancelled", "canceled"].includes(row.status))) throw new ResearchFinanceError("لا يمكن تحصيل دفعة لبحث مؤرشف أو ملغى");
  if(requireActive&&rows.some(row=>['cancelled','deleted'].includes(String(row.invoice_status))))throw new ResearchFinanceError('فاتورة البحث ملغاة؛ راجع التصحيح المالي المعتمد قبل التحصيل',409,'RESEARCH_INVOICE_INACTIVE');
  return rows;
}

export async function researchOrderForInvoice(tx: ResearchExecutor, invoiceId: number): Promise<number | null> {
  if (!(await researchTableAvailable(tx))) return null;
  const result = await tx.execute(sql`SELECT id FROM research_orders WHERE invoice_id = ${invoiceId} ORDER BY id LIMIT 2`);
  if ((result.rows ?? []).length > 1) throw new ResearchFinanceError("الفاتورة مرتبطة بأكثر من طلب بحث؛ يلزم مراجعة الربط");
  return result.rows?.[0] ? Number(result.rows[0].id) : null;
}

export async function readResearchPendingAmount(tx: ResearchExecutor, orderId: number, invoiceId: number | null): Promise<string> {
  const result = await tx.execute(sql`/* research_pending_reservations */
    SELECT (coalesce((SELECT sum(f.amount::numeric) FROM financial_transactions f WHERE f.approval_status = 'pending' AND f.direction = 'revenue' AND
      ((f.source_type = 'research_order' AND f.source_id = ${String(orderId)}) OR (f.source_type = 'sales_invoice' AND f.source_id = ${String(invoiceId ?? 0)})
       OR (f.source_type = 'installment_payment' AND EXISTS (SELECT 1 FROM installment_payments p JOIN installment_contracts c ON c.id=p.contract_id WHERE p.id::text=f.source_id AND c.sales_invoice_id=${invoiceId ?? 0}))
       OR (f.source_type = 'installment_contract' AND f.source_event IN ('payment','reconciliation') AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.id::text=f.source_id AND c.sales_invoice_id=${invoiceId ?? 0})))),0)
      + coalesce((SELECT sum(a.amount::numeric) FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id JOIN financial_transactions f ON f.id=v.financial_transaction_id
        WHERE a.posted_at IS NULL AND f.approval_status='pending' AND f.source_type='receipt_voucher' AND f.source_id=v.id::text AND f.direction='revenue'
          AND ((a.source_type='research_order' AND a.source_id=${orderId}) OR (a.source_type='sales_invoice' AND a.source_id=${invoiceId ?? 0}))),0))::text AS pending`);
  return decimal(researchMoney(String(result.rows?.[0]?.pending ?? "0")));
}

/** Read-only by default. Reconciliation is the only writer of paid snapshots. */
export async function readResearchCanonicalPaymentState(tx: ResearchExecutor, orderId: number, write = false) {
  const id = sourceId(orderId);
  let source: ResearchSource | undefined;
  if (write) source = (await lockResearchPaymentSources(tx, { sourceType: "research_order", sourceId: id }, false))[0];
  else {
    const result = await tx.execute(sql`/* research_source_lock_read */ SELECT r.id, r.invoice_id, (SELECT invoice.total::text FROM sales_invoices invoice WHERE invoice.id=r.invoice_id) AS invoice_total, (SELECT invoice.status FROM sales_invoices invoice WHERE invoice.id=r.invoice_id) AS invoice_status, r.total_amount::text, r.customer_id, r.status, to_jsonb(r)->>'payment_due_date' AS payment_due_date FROM research_orders r WHERE r.id=${id}`);
    source = result.rows?.[0];
  }
  if (!source) throw new ResearchFinanceError("طلب البحث غير موجود", 404, "NOT_FOUND");
  if (source.invoice_id && (source.invoice_total == null || researchMoney(source.invoice_total) !== researchMoney(source.total_amount)))
    throw new ResearchFinanceError("قيمة الفاتورة الأصلية تختلف عن قيمة البحث؛ يلزم مراجعة الربط قبل التسوية", 409, "RESEARCH_INVOICE_TOTAL_MISMATCH");
  const invoiceId = Number(source.invoice_id) || 0;
  const ready = await tx.execute(sql`/* research_return_table */ SELECT to_regclass('public.sales_return_settlements') IS NOT NULL AS ready`);
  const credit = ready.rows?.[0]?.ready === true ? sql`(SELECT coalesce(sum(amount::numeric),0) FROM sales_return_settlements WHERE invoice_id=${invoiceId} AND kind='invoice_credit' AND status='applied')` : sql`0::numeric`;
  const result = await tx.execute(sql`/* research_money_totals */ SELECT
    (coalesce((SELECT sum(CASE WHEN f.direction='revenue' THEN f.amount::numeric ELSE -f.amount::numeric END) FROM financial_transactions f WHERE f.approval_status='executed' AND
      ((f.source_type='research_order' AND f.source_id=${String(id)}) OR (f.source_type='sales_invoice' AND f.source_id=${String(invoiceId)})
       OR (f.source_type='installment_payment' AND EXISTS (SELECT 1 FROM installment_payments p JOIN installment_contracts c ON c.id=p.contract_id WHERE p.id::text=f.source_id AND c.sales_invoice_id=${invoiceId}))
       OR (f.source_type='installment_contract' AND f.source_event IN ('payment','reconciliation','reversal') AND EXISTS (SELECT 1 FROM installment_contracts c WHERE c.id::text=f.source_id AND c.sales_invoice_id=${invoiceId})))),0)
      + coalesce((SELECT sum(greatest(a.amount::numeric-coalesce(a.reversed_amount::numeric,0),0)) FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id=a.receipt_voucher_id WHERE a.posted_at IS NOT NULL AND coalesce(v.approval_status,'executed')='executed'
        AND ((a.source_type='research_order' AND a.source_id=${id}) OR (a.source_type='sales_invoice' AND a.source_id=${invoiceId}))),0))::text AS paid,
    (${credit})::text AS credits`);
  const row = result.rows?.[0];
  if (!row) throw new Error("Research payment aggregate did not return a row");
  const total = researchMoney(String(source.total_amount));
  const paidText = String(row.paid);
  const paid = paidText.startsWith("-") ? 0 : researchMoney(paidText);
  const credits = researchMoney(String(row.credits));
  const approvedPaid = paid;
  const remaining = Math.max(total - approvedPaid - credits, 0);
  const paymentStatus = approvedPaid + credits >= total && total > 0 ? "paid" as const : approvedPaid + credits > 0 ? "partial" as const : "unpaid" as const;
  const state = { sourceType: "research_order" as const, sourceId: id, orderId: id, customerId: Number(source.customer_id), invoiceId: source.invoice_id ? Number(source.invoice_id) : null, totalAmount: decimal(total), approvedPaidAmount: decimal(approvedPaid), remainingAmount: decimal(remaining), creditAmount: decimal(credits), paymentStatus, paymentDueDate: source.payment_due_date ?? null };
  if (write) {
    await tx.execute(sql`UPDATE research_orders SET paid_amount=${state.approvedPaidAmount}, remaining_amount=${state.remainingAmount}, payment_status=${state.paymentStatus}, updated_at=now() WHERE id=${id}`);
    await tx.execute(sql`UPDATE sales_invoices SET paid_amount=${state.approvedPaidAmount}, remaining_amount=${state.remainingAmount}, payment_status=${state.paymentStatus}, updated_at=now() WHERE id=${invoiceId}`);
  }
  return state;
}

/** Called before any ledger/cash mutation. The plan is re-read while holding
 * the original source lock, covering direct requests and both receipt aliases. */
export async function guardResearchFinancialApproval(tx: ResearchExecutor, source: Source & { id: number; direction: string }) {
  if (source.direction !== "revenue") return;
  const orders = await lockResearchPaymentSources(tx, source);
  for (const order of orders) {
    const candidates = await tx.execute(sql`/* research_approval_candidates */ SELECT ${order.id}::int AS order_id,
      CASE WHEN f.source_type='receipt_voucher' THEN coalesce((SELECT sum(a.amount::numeric) FROM receipt_voucher_allocations a WHERE a.receipt_voucher_id=f.source_id::int AND a.posted_at IS NULL AND ((a.source_type='research_order' AND a.source_id=${order.id}) OR (a.source_type='sales_invoice' AND a.source_id=${order.invoice_id ?? 0}))),0) ELSE f.amount::numeric END::text AS amount
      FROM financial_transactions f WHERE f.id=${source.id}`);
    const amount = String(candidates.rows?.[0]?.amount ?? "0");
    const state = await readResearchCanonicalPaymentState(tx, Number(order.id));
    // Existing pending requests reserve capacity until rejected/cancelled.
    const pending = await readResearchPendingAmount(tx, Number(order.id), order.invoice_id);
    assertResearchCollection({ amount, remaining: state.remainingAmount, pending, ownPending: amount });
  }
}
