import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  round2,
  summarizeCustomerAccount,
  type CustomerAccountDocument,
  type CustomerAccountSourceType,
  type CustomerAccountSummary,
} from "@/server/customer-account-summary";

export {
  summarizeCustomerAccount,
  type CustomerAccountDocument,
  type CustomerAccountSourceType,
  type CustomerAccountSummary,
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
             (customer_id = ${cid}) AS linked_by_id
      FROM sales_invoices
      WHERE status = 'active' AND financially_reversed = false
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phone ? sql`customer_phone = ${phone}` : sql`false`}))
      UNION ALL
      SELECT 'order', id, 'ORD-' || id, created_at,
             total::numeric, remaining_amount::numeric, payment_status,
             (customer_id = ${cid})
      FROM orders
      WHERE archived_at IS NULL AND status <> 'cancelled'
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phone ? sql`customer_phone = ${phone}` : sql`false`}))
      UNION ALL
      SELECT 'service_order', id, coalesce(tracking_code, 'SRV-' || id), created_at,
             total_amount::numeric, remaining_amount::numeric, payment_status,
             (customer_id = ${cid})
      FROM service_orders
      WHERE archived_at IS NULL AND status <> 'cancelled'
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phone ? sql`phone = ${phone}` : sql`false`}))
      UNION ALL
      SELECT 'kosha_booking', id, coalesce(tracking_code, 'KOSHA-' || id), created_at,
             total_amount::numeric, remaining_amount::numeric, payment_status,
             (customer_id = ${cid})
      FROM kosha_bookings
      WHERE archived_at IS NULL AND status <> 'cancelled'
        AND (customer_id = ${cid}
             OR (customer_id IS NULL AND ${phone ? sql`phone = ${phone}` : sql`false`}))
    )
    SELECT source_type, source_id, reference, doc_date,
           total::text AS total, remaining::text AS remaining,
           payment_status, linked_by_id
    FROM docs
    ORDER BY doc_date DESC NULLS LAST, source_id DESC
  `);
  const rows = (result.rows ?? []) as any[];
  return rows.map((row) => {
    const total = num(row.total);
    const remaining = Math.min(Math.max(num(row.remaining), 0), Math.max(total, 0));
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
      paid: round2(Math.max(total - remaining, 0)),
      remaining: round2(remaining),
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
