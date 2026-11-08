import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  buildCustomerStatement,
  customerSourceLabelAr,
  round2,
  summarizeCustomerAccount,
  type CustomerAccountDocument,
  type CustomerAccountSourceType,
  type CustomerAccountSummary,
  type CustomerStatementEntry,
  type CustomerStatementLine,
} from "@/server/customer-account-summary";
import { salesReturnStatementLines, salesReturnsReady } from "@/server/sales-returns";
import { iraqiPhoneVariants } from "@/lib/phone";

export {
  buildCustomerStatement,
  summarizeCustomerAccount,
  type CustomerAccountDocument,
  type CustomerAccountSourceType,
  type CustomerAccountSummary,
  type CustomerStatementEntry,
} from "@/server/customer-account-summary";

/**
 * CustomerAccountService — the single, read-only derivation of a customer's
 * financial account across every AJN receivable source.
 *
 * PRINCIPLE (Phase 2): there is ONE customer financial truth, and it is
 * DERIVED, never independently stored. Each document's `total` and reconciled
 * `remaining_amount` already reflect only executed/posted money (via
 * reconcilePaymentState). This service simply folds those authoritative
 * snapshots together, joining strictly by the canonical `customer_id`.
 *
 * It creates no tables, posts no cash, and mutates nothing. It is safe to call
 * from any authorized view; every consumer sees the same numbers.
 */

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Read every active receivable document for a customer, joined by the canonical
 * customer_id (with an exact-phone fallback ONLY for rows that still carry no
 * customer_id — never a row linked to a different customer). Returns the raw
 * document rows; callers derive summaries/statements from these.
 */
export async function getCustomerAccountDocuments(
  customer: { id: number; phone?: string | null },
  executor: { execute: (query: any) => Promise<any> } = db,
): Promise<CustomerAccountDocument[]> {
  const cid = customer.id;
  const phone = (customer.phone ?? "").trim();
  // The same number in any stored spelling (07…, 964…, +964…, 00964…).
  const phones = [...new Set([phone, ...iraqiPhoneVariants(phone)].filter(Boolean))];
  const phoneIs = (column: string) =>
    phones.length
      ? sql`${sql.raw(column)} IN (SELECT jsonb_array_elements_text(${JSON.stringify(phones)}::jsonb))`
      : sql`false`;
  // Debt removed by approved sales returns, read from its own settlement rows
  // (never inferred from snapshot gaps); zero before migration 0130.
  const credited = (await salesReturnsReady(executor))
    ? sql`(SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s
        WHERE s.kind = 'invoice_credit' AND s.status = 'applied' AND s.invoice_id = sales_invoices.id)`
    : sql`0::numeric`;
  // The phone fallback is written inline per source below, referencing each
  // table's own phone column (orders/sales use customer_phone; service/kosha use
  // phone) and only for rows that still carry no customer_id.
  const result = await executor.execute(sql`
    WITH docs AS (
      SELECT 'sales_invoice' AS source_type, id AS source_id,
             coalesce(invoice_no, 'SI-' || id) AS reference,
             created_at AS doc_date,
             total::numeric AS total, remaining_amount::numeric AS remaining,
             payment_status,
             (customer_id = ${cid}) AS linked_by_id,
             ${credited} AS credited
      FROM sales_invoices
      WHERE status = 'active' AND financially_reversed = false
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phoneIs("customer_phone")}))
      UNION ALL
      SELECT 'order', id, coalesce(tracking_code, 'ORD-' || id), created_at,
             total::numeric, remaining_amount::numeric, payment_status,
             (customer_id = ${cid}), 0::numeric
      FROM orders
      WHERE archived_at IS NULL AND status <> 'cancelled'
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phoneIs("customer_phone")}))
      UNION ALL
      SELECT 'service_order', id, coalesce(tracking_code, 'SRV-' || id), created_at,
             total_amount::numeric, remaining_amount::numeric, payment_status,
             (customer_id = ${cid}), 0::numeric
      FROM service_orders
      WHERE archived_at IS NULL AND status <> 'cancelled'
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phoneIs("phone")}))
      UNION ALL
      SELECT 'kosha_booking', id, coalesce(tracking_code, 'KOSHA-' || id), created_at,
             total_amount::numeric, remaining_amount::numeric, payment_status,
             (customer_id = ${cid}), 0::numeric
      FROM kosha_bookings
      WHERE archived_at IS NULL AND status <> 'cancelled'
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phoneIs("phone")}))
      UNION ALL
      SELECT 'rental_order', r.id, r.order_no, r.created_at,
             r.total_amount::numeric, r.remaining_amount::numeric, r.payment_status,
             (r.customer_id = ${cid}), 0::numeric
      FROM rental_orders r
      WHERE to_jsonb(r)->>'rental_kind'='equipment' AND r.status NOT IN ('draft','pending_approval','cancelled','canceled')
        AND NOT EXISTS (SELECT 1 FROM orders mirror WHERE mirror.tracking_code = r.order_no)
        AND (r.customer_id = ${cid} OR (r.customer_id IS NULL AND ${phoneIs("r.phone")}))
    )
    SELECT source_type, source_id, reference, doc_date,
           total::text AS total, remaining::text AS remaining,
           payment_status, linked_by_id, credited::text AS credited
    FROM docs
    ORDER BY doc_date DESC NULLS LAST, source_id DESC
  `);
  const rows = (result.rows ?? []) as any[];
  return rows.map((row) => {
    const total = num(row.total);
    const remaining = Math.min(Math.max(num(row.remaining), 0), Math.max(total, 0));
    const credited = Math.min(Math.max(num(row.credited), 0), Math.max(total - remaining, 0));
    return {
      sourceType: String(row.source_type) as CustomerAccountSourceType,
      sourceId: Number(row.source_id),
      reference: String(row.reference ?? ""),
      date:
        row.doc_date instanceof Date
          ? row.doc_date.toISOString()
          : row.doc_date
            ? String(row.doc_date)
            : null,
      total: round2(total),
      paid: round2(Math.max(total - remaining - credited, 0)),
      remaining: round2(remaining),
      credited: round2(credited),
      paymentStatus: String(row.payment_status ?? "unpaid"),
      linkedById: row.linked_by_id === true || row.linked_by_id === "t",
    } satisfies CustomerAccountDocument;
  });
}

/** The one canonical customer account summary used by every authorized view. */
export async function getCustomerAccountSummary(
  customer: { id: number; phone?: string | null },
  executor: { execute: (query: any) => Promise<any> } = db,
): Promise<CustomerAccountSummary> {
  const documents = await getCustomerAccountDocuments(customer, executor);
  return summarizeCustomerAccount(customer.id, documents);
}

/** Where each receivable document opens in the admin. */
export function customerDocumentHref(sourceType: CustomerAccountSourceType, sourceId: number): string {
  switch (sourceType) {
    case "sales_invoice": return `/admin/sales?invoice=${sourceId}`;
    case "order": return `/admin/invoice/${sourceId}`;
    case "service_order": return `/admin/invoice/${sourceId}?type=booking`;
    case "kosha_booking": return `/admin/kosha-bookings?booking=${sourceId}`;
    case "rental_order": return `/admin/rental-orders?order=${sourceId}`;
  }
}

/** One كشف حساب line, tied to the document it settles when there is one. */
export type CustomerStatementMovement = CustomerStatementLine & {
  /** document = the receivable itself; payment/receipt/installment/deposit = money against it;
   * adjustment = paid recorded on the document without its own movement; return/credit = customer credit. */
  kind: "document" | "payment" | "receipt" | "installment" | "deposit" | "adjustment" | "return" | "credit";
  sourceType: CustomerAccountSourceType | null;
  sourceId: number | null;
  /** The receivable document's own reference (null for customer-level credit lines). */
  documentReference: string | null;
};

export type CustomerStatementResult = {
  entries: (CustomerStatementMovement & { balance: number })[];
  /** Running balance after every line: debt − unused credit held for the customer. */
  closingBalance: number;
  /** Σ reconciled remaining of the documents — the same «المتبقي» every other screen shows. */
  documentsRemaining: number;
  /** documentsRemaining − closingBalance: unused return credit, refunds owed and unapplied receipt money. */
  creditBalance: number;
  documents: CustomerAccountDocument[];
};

const toIso = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value == null || value === "") return null;
  const parsed = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

/**
 * Chronological كشف حساب built from the same reconciled documents as the account
 * summary, so its balance always equals «المتبقي» everywhere else (less any
 * credit the customer holds). Each document is a debit; its money is matched by
 * the document's own identity exactly as reconcilePaymentState counts it —
 * direct executed transactions (net of reversals), posted receipt-voucher
 * allocations net of reversed amounts, installment cash for sales invoices,
 * applied rental deposits, and the graduation/research order behind a mirror
 * invoice. Paid that the document records without such a movement (legacy
 * entries, or money above the document total that is not counted as debt) gets
 * one explicit adjustment line, so nothing is hidden and nothing is counted
 * twice. Read-only; posts nothing.
 */
export async function getCustomerStatement(
  customer: { id: number; phone?: string | null },
  executor: { execute: (query: any) => Promise<any> } = db,
): Promise<CustomerStatementResult> {
  const documents = await getCustomerAccountDocuments(customer, executor);
  const cid = customer.id;
  const key = (sourceType: string, sourceId: number) => `${sourceType}:${sourceId}`;
  const byKey = new Map(documents.map((doc) => [key(doc.sourceType, doc.sourceId), doc]));
  const docLines: CustomerStatementMovement[] = documents.map((doc) => ({
    date: doc.date,
    type: customerSourceLabelAr(doc.sourceType),
    reference: doc.reference,
    description: `${customerSourceLabelAr(doc.sourceType)} — استحقاق`,
    debit: doc.total,
    credit: 0,
    kind: "document",
    sourceType: doc.sourceType,
    sourceId: doc.sourceId,
    documentReference: doc.reference,
  }));
  const keys = JSON.stringify(documents.map((doc) => ({ t: doc.sourceType, id: doc.sourceId })));
  const result = await executor.execute(sql`
    WITH docs AS (
      SELECT d->>'t' AS source_type, (d->>'id')::int AS source_id
      FROM jsonb_array_elements(${keys}::jsonb) d
    ), mirrors AS (
      -- A graduation/research order owns its mirror invoice's balance; its money
      -- is posted on the order. Only when the invoice has no history of its own.
      SELECT 'graduation_order'::text AS money_type, g.id AS money_id, d.source_id AS invoice_id
      FROM docs d
      JOIN sales_invoices invoice ON invoice.id = d.source_id
      JOIN graduation_orders g ON g.invoice_id = invoice.id AND g.total_amount::numeric = invoice.total::numeric
      WHERE d.source_type = 'sales_invoice'
      UNION ALL
      SELECT 'research_order', r.id, d.source_id
      FROM docs d JOIN research_orders r ON r.invoice_id = d.source_id
      WHERE d.source_type = 'sales_invoice'
    ), owned AS (
      SELECT m.* FROM mirrors m
      WHERE NOT EXISTS (SELECT 1 FROM financial_transactions f
          WHERE f.source_type = 'sales_invoice' AND f.source_id = m.invoice_id::text)
        AND NOT EXISTS (SELECT 1 FROM receipt_voucher_allocations a
          WHERE a.source_type = 'sales_invoice' AND a.source_id = m.invoice_id)
        AND NOT EXISTS (SELECT 1 FROM installment_contracts c WHERE c.sales_invoice_id = m.invoice_id)
    ), targets AS (
      SELECT source_type AS money_type, source_id AS money_id, source_type, source_id FROM docs
      UNION ALL
      SELECT money_type, money_id, 'sales_invoice', invoice_id FROM owned
    )
    SELECT t.source_type, t.source_id, 'payment' AS kind, f.transaction_time AS at,
           coalesce(f.transaction_no, '#' || f.id) AS reference,
           coalesce(nullif(f.notes, ''), nullif(f.description, '')) AS note,
           CASE WHEN f.direction = 'revenue' THEN 0 ELSE f.amount::numeric END AS debit,
           CASE WHEN f.direction = 'revenue' THEN f.amount::numeric ELSE 0 END AS credit
    FROM targets t
    JOIN financial_transactions f ON f.source_type = t.money_type AND f.source_id = t.money_id::text
    WHERE f.approval_status = 'executed'
    UNION ALL
    SELECT t.source_type, t.source_id, 'receipt', coalesce(a.posted_at, v.date::timestamp), v.voucher_no, NULL,
           0, greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)
    FROM targets t
    JOIN receipt_voucher_allocations a ON a.source_type = t.money_type AND a.source_id = t.money_id
    JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
    WHERE a.posted_at IS NOT NULL AND coalesce(v.approval_status, 'executed') = 'executed'
    UNION ALL
    SELECT d.source_type, d.source_id, 'installment', f.transaction_time,
           coalesce(f.transaction_no, '#' || f.id), coalesce(nullif(f.notes, ''), nullif(f.description, '')),
           CASE WHEN f.direction = 'revenue' THEN 0 ELSE f.amount::numeric END,
           CASE WHEN f.direction = 'revenue' THEN f.amount::numeric ELSE 0 END
    FROM docs d
    JOIN installment_contracts c ON c.sales_invoice_id = d.source_id
    JOIN financial_transactions f ON f.approval_status = 'executed' AND (
      (f.source_type = 'installment_contract' AND f.source_event IN ('payment', 'reconciliation', 'reversal') AND f.source_id = c.id::text)
      OR (f.source_type = 'installment_payment' AND EXISTS (
        SELECT 1 FROM installment_payments p WHERE p.contract_id = c.id AND p.id::text = f.source_id)))
    WHERE d.source_type = 'sales_invoice'
    UNION ALL
    SELECT d.source_type, d.source_id, 'deposit', f.transaction_time,
           coalesce(f.transaction_no, '#' || f.id), coalesce(nullif(f.notes, ''), nullif(f.description, '')),
           CASE WHEN f.direction = 'expense' THEN 0 ELSE f.amount::numeric END,
           CASE WHEN f.direction = 'expense' THEN f.amount::numeric ELSE 0 END
    FROM docs d
    JOIN financial_transactions f ON f.source_type = 'equipment_rental_deposit' AND f.source_id = d.source_id::text
    WHERE d.source_type = 'rental_order' AND f.approval_status = 'executed'
      AND f.transaction_type IN ('er_deposit_apply', 'er_deposit_apply_reversal')
    UNION ALL
    -- Receipt money not applied to any document stays the customer's credit.
    SELECT NULL, NULL, 'credit', coalesce(a.posted_at, v.date::timestamp), v.voucher_no, NULL,
           0, greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)
    FROM receipt_voucher_allocations a
    JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
    WHERE a.customer_id = ${cid} AND a.source_type = 'customer_credit' AND a.posted_at IS NOT NULL
      AND coalesce(v.approval_status, 'executed') = 'executed'
  `);
  const explained = new Map<string, number>();
  const lastMoneyAt = new Map<string, string | null>();
  const moneyLines: CustomerStatementMovement[] = [];
  for (const row of (result.rows ?? []) as any[]) {
    const debit = num(row.debit);
    const credit = num(row.credit);
    if (debit === 0 && credit === 0) continue;
    const date = toIso(row.at);
    if (row.kind === "credit") {
      moneyLines.push({ date, type: "سند قبض", reference: String(row.reference ?? ""), description: "سند قبض — رصيد غير مخصص للعميل", debit, credit, kind: "credit", sourceType: null, sourceId: null, documentReference: null });
      continue;
    }
    const doc = byKey.get(key(String(row.source_type), Number(row.source_id)));
    if (!doc) continue;
    const docKey = key(doc.sourceType, doc.sourceId);
    explained.set(docKey, round2((explained.get(docKey) ?? 0) + credit - debit));
    const previous = lastMoneyAt.get(docKey);
    if (date && (!previous || date > previous)) lastMoneyAt.set(docKey, date);
    const label = customerSourceLabelAr(doc.sourceType);
    const kind = row.kind as CustomerStatementMovement["kind"];
    const type = kind === "receipt" ? "سند قبض" : kind === "installment" ? "قسط" : kind === "deposit" ? "تسوية تأمين" : credit > 0 ? "دفعة" : "عكس دفعة";
    const note = row.note ? String(row.note).trim() : "";
    moneyLines.push({
      date,
      type,
      reference: String(row.reference ?? ""),
      description: note ? `${note} — ${doc.reference}` : `${type} على ${label} ${doc.reference}`,
      debit,
      credit,
      kind,
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      documentReference: doc.reference,
    });
  }
  // The document's own paid is the authority (reconciled snapshot). Make any
  // difference from its detailed movements visible as one explicit line; an
  // excess is shown right after the payment that caused it.
  const justAfter = (date: string | null) => {
    const time = date ? Date.parse(date) : Number.NaN;
    return Number.isNaN(time) ? date : new Date(time + 1000).toISOString();
  };
  const adjustmentLines: CustomerStatementMovement[] = [];
  for (const doc of documents) {
    const docKey = key(doc.sourceType, doc.sourceId);
    const difference = round2(doc.paid - (explained.get(docKey) ?? 0));
    if (Math.abs(difference) < 0.01) continue;
    const label = customerSourceLabelAr(doc.sourceType);
    adjustmentLines.push(difference > 0
      ? { date: doc.date, type: "مدفوع سابق", reference: doc.reference, description: `مدفوع مثبت على ${label} ${doc.reference} بدون حركة دفع مفصلة`, debit: 0, credit: difference, kind: "adjustment", sourceType: doc.sourceType, sourceId: doc.sourceId, documentReference: doc.reference }
      : { date: justAfter(lastMoneyAt.get(docKey) ?? doc.date), type: "تسوية", reference: doc.reference, description: `مبلغ زائد عن قيمة ${label} ${doc.reference} — غير محسوب على الذمة`, debit: -difference, credit: 0, kind: "adjustment", sourceType: doc.sourceType, sourceId: doc.sourceId, documentReference: doc.reference });
  }
  const returnLines: CustomerStatementMovement[] = (await salesReturnStatementLines(executor, cid)).map((line) => ({
    ...line,
    kind: "return" as const,
    sourceType: null,
    sourceId: null,
    documentReference: null,
  }));
  const statement = buildCustomerStatement([...docLines, ...moneyLines, ...adjustmentLines, ...returnLines]);
  const documentsRemaining = round2(documents.reduce((sum, doc) => sum + doc.remaining, 0));
  return {
    ...statement,
    documentsRemaining,
    creditBalance: round2(documentsRemaining - statement.closingBalance),
    documents,
  };
}
