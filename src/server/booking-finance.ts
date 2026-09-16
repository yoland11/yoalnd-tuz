import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * ajn-booking-finance — the ONE authoritative, read-only financial summary for a
 * booking (a `service_orders` row when source="service", a `kosha_bookings` row
 * when source="kosha"). See the `ajn-booking-finance` Agent Skill.
 *
 * WHY THIS EXISTS
 * A booking may contain a base service PLUS booking products (تجهيزات). The base
 * and the products are the same money split across two stores:
 *   - base       = operations.baseBookingAmount  (falls back to total_amount)
 *   - products   = Σ live non-released stock_reservations line totals
 * The persisted `service_orders.total_amount` is ambiguous — some code paths
 * fold products into it, others treat it as base-only and add products at
 * display time — so reading it directly under- or over-reports a multi-service
 * booking (Kosha 160,000 + تجهيزات 40,000 showing 160,000, or 240,000).
 *
 * This service computes the aggregate the SAME way the (correct) booking finance
 * tab does, but derives the base from `baseBookingAmount` when present so it can
 * never double-count. It is READ-ONLY: it writes nothing, posts no cash, changes
 * no schema, and never rewrites historical rows. Paid is the raw approved money
 * (executed financial_transactions + posted receipt-voucher allocations), so it
 * is not affected by the base-clamped `deposit_amount`/`remaining_amount`.
 */

export type BookingFinanceSource = "service" | "kosha";

export type BookingFinancialSummary = {
  source: BookingFinanceSource;
  id: number;
  /** Service base amount (level 1 aggregate of the booking's service). */
  base: number;
  /** Booking products / تجهيزات (level 1). */
  products: number;
  /** base + products (before nothing else is applied — additions already baked into base). */
  subtotal: number;
  /** Authoritative whole-booking total (level 2 — the receivable). */
  finalTotal: number;
  /** Authoritative approved money against the booking (level 3). */
  paid: number;
  /** finalTotal − paid, floored at 0. */
  remaining: number;
  paymentStatus: "unpaid" | "partial" | "paid" | "pending_pricing";
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/**
 * Pure aggregation core (unit-tested). Derives the authoritative final total
 * without ever trusting an ambiguous persisted total: the base comes from the
 * explicit base amount when known, and products are added exactly once.
 */
export function deriveBookingFinal(input: {
  /** operations.baseBookingAmount when known, else null. */
  baseBookingAmount: number | null;
  /** persisted total_amount (used only as the base fallback when base is unknown). */
  persistedTotal: number;
  /** Σ live non-released product line totals. */
  products: number;
  /** raw approved money (executed transactions + posted allocations). */
  paid: number;
}): { base: number; products: number; subtotal: number; finalTotal: number; paid: number; remaining: number; paymentStatus: BookingFinancialSummary["paymentStatus"] } {
  const base = round2(Math.max(0, input.baseBookingAmount ?? input.persistedTotal));
  const products = round2(Math.max(0, input.products));
  const finalTotal = round2(base + products);
  const paid = round2(Math.max(0, input.paid));
  const remaining = round2(Math.max(0, finalTotal - paid));
  const paymentStatus: BookingFinancialSummary["paymentStatus"] =
    finalTotal <= 0 ? "pending_pricing" : remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  return { base, products, subtotal: finalTotal, finalTotal, paid, remaining, paymentStatus };
}

type Executor = { execute: (query: any) => Promise<any> };

/** Approved money against a source: executed financial_transactions (netting reversals by direction) + posted receipt allocations. Unclamped (true paid). */
export async function bookingApprovedPaid(
  sourceType: "service_order" | "kosha_booking",
  sourceId: number,
  executor: Executor = db,
): Promise<number> {
  const result = await executor.execute(sql`
    WITH direct AS (
      SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0)::numeric AS value
      FROM financial_transactions
      WHERE source_type = ${sourceType} AND source_id = ${String(sourceId)} AND approval_status = 'executed'
    ), alloc AS (
      SELECT coalesce(sum(greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)), 0)::numeric AS value
      FROM receipt_voucher_allocations a
      JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
      WHERE a.source_type = ${sourceType} AND a.source_id = ${sourceId}
        AND a.posted_at IS NOT NULL AND coalesce(v.approval_status, 'executed') = 'executed'
    )
    SELECT greatest((SELECT value FROM direct) + (SELECT value FROM alloc), 0)::text AS paid
  `);
  return round2(num((result.rows ?? [])[0]?.paid));
}

/** Σ of the booking's live non-released product line totals (تجهيزات), priced from operations.productMeta with the product price as fallback. */
export async function bookingProductCharges(
  entityType: "service_order" | "kosha_booking",
  sourceId: number,
  productMeta: Record<string, any>,
  executor: Executor = db,
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT r.product_id, r.variant_id, r.quantity, r.status, coalesce(p.price, 0)::numeric AS price
    FROM stock_reservations r
    JOIN products p ON p.id = r.product_id
    WHERE r.source_type = ${entityType} AND r.source_id = ${sourceId} AND r.status <> 'released'
  `);
  const rows = (result.rows ?? []) as any[];
  let total = 0;
  for (const row of rows) {
    const productId = Number(row.product_id);
    const variantId = row.variant_id == null ? null : Number(row.variant_id);
    const line = productMeta[`${productId}:${variantId ?? 0}`] ?? {};
    const quantity = num(row.quantity);
    const unitPrice = num(line.unitPrice ?? row.price);
    const discount = num(line.discount);
    total += Math.max(0, unitPrice * quantity - discount);
  }
  return round2(total);
}

/**
 * The authoritative booking financial summary. Read-only. Returns null if the
 * booking does not exist.
 */
export async function getBookingFinancialSummary(
  source: BookingFinanceSource,
  id: number,
  executor: Executor = db,
): Promise<BookingFinancialSummary | null> {
  if (source === "service") {
    const result = await executor.execute(sql`
      SELECT total_amount::text AS total_amount, custom_fields
      FROM service_orders WHERE id = ${id} AND archived_at IS NULL
    `);
    const row = (result.rows ?? [])[0] as any;
    if (!row) return null;
    const details = (row.custom_fields ?? {}) as Record<string, any>;
    const ops = (details.bookingOperations ?? {}) as Record<string, any>;
    const products = await bookingProductCharges("service_order", id, (ops.productMeta ?? {}) as Record<string, any>, executor);
    const paid = await bookingApprovedPaid("service_order", id, executor);
    const derived = deriveBookingFinal({
      baseBookingAmount: ops.baseBookingAmount != null ? num(ops.baseBookingAmount) : null,
      persistedTotal: num(row.total_amount),
      products,
      paid,
    });
    return { source, id, ...derived };
  }
  // kosha_booking: base is priced explicitly (pricing.totalAmount) or as
  // total_amount − products_total; products come from the kosha line items.
  const result = await executor.execute(sql`
    SELECT total_amount::text AS total_amount, coalesce(products_total, '0')::text AS products_total,
           booking_details
    FROM kosha_bookings WHERE id = ${id} AND archived_at IS NULL
  `);
  const row = (result.rows ?? [])[0] as any;
  if (!row) return null;
  const details = (row.booking_details ?? {}) as Record<string, any>;
  const pricing = (details.pricing ?? {}) as Record<string, any>;
  const productsTotal = round2(num(row.products_total));
  const base =
    pricing.totalAmount != null
      ? num(pricing.totalAmount)
      : Math.max(0, num(row.total_amount) - productsTotal);
  const paid = await bookingApprovedPaid("kosha_booking", id, executor);
  const derived = deriveBookingFinal({ baseBookingAmount: base, persistedTotal: num(row.total_amount), products: productsTotal, paid });
  return { source, id, ...derived };
}
