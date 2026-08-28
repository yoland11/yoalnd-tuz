import { sql } from "drizzle-orm";

/**
 * The canonical, server-side view of a document's official payment state.
 *
 * Only executed financial transactions and posted receipt allocations count.
 * Pending, rejected and draft requests are intentionally excluded.  This
 * module owns the final paid/remaining/status update; source modules must not
 * infer the value from client input or a previously stored payment status.
 */
export type PaymentStateSourceType =
  | "sales_invoice"
  | "purchase_invoice"
  | "kosha_booking"
  | "order"
  | "service_order"
  | "graduation_order"
  | "photography_order"
  | "rental_order"
  | "research_order";

type SourceConfig = {
  table: string;
  total: string;
  paid: string;
  remaining: string;
  status: string;
  direction: "revenue" | "expense";
  receiptAllocations: boolean;
};

// Every identifier here is a fixed application-owned SQL identifier. Never
// accept table or column names from a request.
const SOURCES: Record<PaymentStateSourceType, SourceConfig> = {
  sales_invoice: { table: "sales_invoices", total: "total", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  purchase_invoice: { table: "purchase_invoices", total: "total", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "expense", receiptAllocations: false },
  kosha_booking: { table: "kosha_bookings", total: "total_amount", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  order: { table: "orders", total: "total", paid: "deposit_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  service_order: { table: "service_orders", total: "total_amount", paid: "deposit_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  graduation_order: { table: "graduation_orders", total: "total_amount", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  photography_order: { table: "photography_orders", total: "total_amount", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  rental_order: { table: "rental_orders", total: "total_amount", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
  research_order: { table: "research_orders", total: "total_amount", paid: "paid_amount", remaining: "remaining_amount", status: "payment_status", direction: "revenue", receiptAllocations: true },
};

export type ReconciledPaymentState = {
  sourceType: PaymentStateSourceType;
  sourceId: number;
  totalAmount: string;
  approvedPaidAmount: string;
  remainingAmount: string;
  paymentStatus: "unpaid" | "partial" | "paid";
};

export function isPaymentStateSourceType(value: string | null | undefined): value is PaymentStateSourceType {
  return Boolean(value && Object.prototype.hasOwnProperty.call(SOURCES, value));
}

/**
 * Rebuild the stored payment snapshot from approved money inside the caller's
 * transaction. Reversal entries net against their original executed entry by
 * direction, while receipt allocation reversals reduce their allocation.
 */
export async function reconcilePaymentState(
  tx: { execute: (query: any) => Promise<any> },
  input: { sourceType: string | null | undefined; sourceId: string | number | null | undefined },
): Promise<ReconciledPaymentState | null> {
  if (!isPaymentStateSourceType(input.sourceType)) return null;
  const sourceId = Number(input.sourceId);
  if (!Number.isInteger(sourceId) || sourceId <= 0) return null;

  const config = SOURCES[input.sourceType];
  const table = sql.raw(config.table);
  const total = sql.raw(config.total);
  const paid = sql.raw(config.paid);
  const remaining = sql.raw(config.remaining);
  const status = sql.raw(config.status);
  const allocations = config.receiptAllocations
    ? sql`, allocations AS (
        SELECT coalesce(sum(greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)), 0)::numeric AS value
        FROM receipt_voucher_allocations a
        JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
        WHERE a.source_type = ${input.sourceType}
          AND a.source_id = ${sourceId}
          AND a.posted_at IS NOT NULL
          AND coalesce(v.approval_status, 'executed') = 'executed'
      )`
    : sql`, allocations AS (SELECT 0::numeric AS value)`;

  const result = await tx.execute(sql`
    WITH source AS (
      SELECT id, ${total}::numeric AS total_amount
      FROM ${table}
      WHERE id = ${sourceId}
      FOR UPDATE
    ), direct_financials AS (
      SELECT coalesce(sum(CASE
        WHEN direction = ${config.direction} THEN amount::numeric
        ELSE -amount::numeric
      END), 0)::numeric AS value
      FROM financial_transactions
      WHERE source_type = ${input.sourceType}
        AND source_id = ${String(sourceId)}
        AND approval_status = 'executed'
    )
    ${allocations}, computed AS (
      SELECT source.id, source.total_amount,
        greatest(direct_financials.value + allocations.value, 0)::numeric AS approved_paid
      FROM source, direct_financials, allocations
    )
    UPDATE ${table} document
    SET ${paid} = least(computed.total_amount, computed.approved_paid),
        ${remaining} = greatest(computed.total_amount - computed.approved_paid, 0),
        ${status} = CASE
          WHEN computed.total_amount <= 0 OR computed.approved_paid <= 0 THEN 'unpaid'
          WHEN computed.approved_paid >= computed.total_amount THEN 'paid'
          ELSE 'partial'
        END,
        updated_at = now()
    FROM computed
    WHERE document.id = computed.id
    RETURNING document.id,
      computed.total_amount::text AS total_amount,
      least(computed.total_amount, computed.approved_paid)::text AS approved_paid_amount,
      greatest(computed.total_amount - computed.approved_paid, 0)::text AS remaining_amount,
      document.${status}::text AS payment_status
  `);
  const row = (result.rows ?? [])[0];
  if (!row) throw new Error("تعذر إعادة تسوية حالة دفع السجل المرتبط.");
  return {
    sourceType: input.sourceType,
    sourceId,
    totalAmount: String(row.total_amount),
    approvedPaidAmount: String(row.approved_paid_amount),
    remainingAmount: String(row.remaining_amount),
    paymentStatus: String(row.payment_status) as ReconciledPaymentState["paymentStatus"],
  };
}
