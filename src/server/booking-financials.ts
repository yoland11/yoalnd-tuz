import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * The booking money formula, in exactly one place.
 *
 * This module is imported by BOTH `booking-center.ts` (the feature) and
 * `master-cash-box.ts` (the approval engine). It deliberately imports nothing
 * from either of them, so the engine can recompute a booking on approval
 * without a circular import — and so the formula can never drift between the
 * two call sites.
 */

/** Minimal structural type for `db` or a drizzle transaction handle. */
type Executor = Pick<typeof db, "execute">;

/**
 * Recompute a booking's derived financials from source-of-truth rows.
 *
 *   servicesTotal ← booking_services (excluding cancelled)
 *   grandTotal    ← servicesTotal + products + additionalCharges - discount
 *   paid          ← receipt_vouchers  where approval_status = 'executed'
 *   refunded      ← payment_vouchers  where approval_status = 'executed'
 *   remaining     ← grandTotal - paid + refunded     (per spec)
 *
 * Everything is a SUM over vouchers rather than an increment, so replaying this
 * — or approving twice — cannot double-count. Safe to call at any time.
 */
export async function recalcBookingFinancialsWith(
  executor: Executor,
  bookingId: number,
) {
  const result = await executor.execute(
    sql`
    WITH svc AS (
      SELECT COALESCE(SUM(amount::numeric), 0) AS total
      FROM booking_services
      WHERE booking_id = ${bookingId} AND status <> 'cancelled'
    ),
    paid AS (
      SELECT COALESCE(SUM(amount::numeric), 0) AS total
      FROM receipt_vouchers
      WHERE booking_ref_id = ${bookingId} AND approval_status = 'executed'
    ),
    pending AS (
      SELECT COALESCE(SUM(amount::numeric), 0) AS total
      FROM receipt_vouchers
      WHERE booking_ref_id = ${bookingId} AND approval_status IN ('draft', 'pending')
    ),
    refunded AS (
      SELECT COALESCE(SUM(amount::numeric), 0) AS total
      FROM payment_vouchers
      WHERE booking_ref_id = ${bookingId} AND approval_status = 'executed'
    ),
    calc AS (
      SELECT
        svc.total AS services_total,
        paid.total AS paid_total,
        pending.total AS pending_total,
        refunded.total AS refunded_total
      FROM svc, paid, pending, refunded
    )
    UPDATE bookings b SET
      services_total = calc.services_total,
      grand_total = GREATEST(0, calc.services_total + b.products_total::numeric
        + b.additional_charges::numeric - b.discount::numeric),
      paid_amount = calc.paid_total,
      pending_receipt_amount = calc.pending_total,
      refunded_amount = calc.refunded_total,
      remaining_amount = GREATEST(0,
        GREATEST(0, calc.services_total + b.products_total::numeric
          + b.additional_charges::numeric - b.discount::numeric)
        - calc.paid_total + calc.refunded_total),
      payment_status = CASE
        WHEN calc.paid_total - calc.refunded_total <= 0.004 THEN 'unpaid'
        WHEN calc.paid_total - calc.refunded_total + 0.004 >=
          GREATEST(0, calc.services_total + b.products_total::numeric
            + b.additional_charges::numeric - b.discount::numeric)
          THEN CASE WHEN calc.refunded_total > 0.004 THEN 'refunded_partial' ELSE 'paid' END
        ELSE 'partial'
      END,
      updated_at = now()
    FROM calc
    WHERE b.id = ${bookingId}
    RETURNING b.*;
  `,
  );
  return ((result.rows ?? []) as Record<string, unknown>[])[0] ?? null;
}

/**
 * Called from inside the cashbox approval/reversal transaction.
 *
 * Guarded by `to_regclass` because the Booking Center tables are provisioned
 * lazily on first use: a deployment that has never opened the Booking Center
 * must still be able to approve ordinary vouchers.
 */
export async function syncUnifiedBooking(
  executor: Executor,
  voucherTable: "receipt_vouchers" | "payment_vouchers",
  voucherId: number,
) {
  const probe = await executor.execute(
    sql`SELECT to_regclass('public.bookings') IS NOT NULL AS has_bookings`,
  );
  if (!(probe.rows ?? [])[0]?.has_bookings) return null;

  const linked = await executor.execute(
    voucherTable === "receipt_vouchers"
      ? sql`SELECT booking_ref_id FROM receipt_vouchers WHERE id = ${voucherId}`
      : sql`SELECT booking_ref_id FROM payment_vouchers WHERE id = ${voucherId}`,
  );
  const bookingId = Number((linked.rows ?? [])[0]?.booking_ref_id ?? 0);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return null;

  return recalcBookingFinancialsWith(executor, bookingId);
}
