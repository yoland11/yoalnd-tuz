import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Booking damage & penalty — the ONE authoritative, read-only rollup for a
 * booking's penalties. Phase 1: derivation only (no writes, no endpoints wired).
 *
 * MONEY MODEL (never violated):
 *   - The penalty obligation lives in `booking_penalties`, entirely separate from
 *     the booking total — it is never folded into `total_amount`.
 *   - Actual payments are executed `financial_transactions`
 *     (source_type='booking_penalty', source_id=penalty.id). Only EXECUTED
 *     movements count (they are what moved the cash box), netting reversals.
 *   - paid / remaining / payment-status are DERIVED here, never stored mutably,
 *     so they can never silently drift from the cash box.
 *
 * It is safe to call on a database that has not yet run migration 0112: it probes
 * for the table first and returns an empty summary instead of throwing.
 */

export type BookingPenaltySource = "service" | "kosha";
const entityTypeOf = (source: BookingPenaltySource) => (source === "kosha" ? "kosha_booking" : "service_order");

export type PenaltyDisplayStatus = "pending_review" | "unpaid" | "partly_paid" | "paid" | "cancelled";
export type BookingPenaltyOverallStatus = "none" | PenaltyDisplayStatus;

export type BookingPenaltyRow = {
  id: number;
  penaltyNo: string;
  damageType: string;
  itemLabel: string;
  productId: number | null;
  quantity: number;
  unitValue: number;
  penaltyAmount: number;
  reason: string;
  status: string; // lifecycle: pending_review | approved | cancelled
  origin: string;
  evidenceCount: number;
  createdByName: string;
  createdAt: string | null;
  paid: number;
  remaining: number;
  displayStatus: PenaltyDisplayStatus;
};

export type BookingPenaltySummary = {
  count: number;
  pendingReview: number;
  penaltyTotal: number; // Σ approved (active) obligations
  paid: number;
  remaining: number;
  status: BookingPenaltyOverallStatus;
  penalties: BookingPenaltyRow[];
};

type Executor = { execute: (query: any) => Promise<any> };

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function penaltyDisplayStatus(lifecycle: string, penaltyAmount: number, paid: number): PenaltyDisplayStatus {
  if (lifecycle === "cancelled") return "cancelled";
  if (lifecycle === "pending_review") return "pending_review";
  if (paid >= penaltyAmount - 0.01 && penaltyAmount > 0) return "paid";
  if (paid > 0) return "partly_paid";
  return "unpaid";
}

async function penaltiesTableExists(executor: Executor): Promise<boolean> {
  try {
    const result = await executor.execute(sql`SELECT to_regclass('public.booking_penalties') AS t`);
    return Boolean((result.rows ?? [])[0]?.t);
  } catch {
    return false;
  }
}

/** Executed, reversal-netted money collected against ONE penalty. Unclamped >= 0. */
export async function penaltyApprovedPaid(penaltyId: number, executor: Executor = db): Promise<number> {
  const result = await executor.execute(sql`
    SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0)::text AS paid
    FROM financial_transactions
    WHERE source_type = 'booking_penalty' AND source_id = ${String(penaltyId)} AND approval_status = 'executed'
  `);
  return round2(Math.max(0, num((result.rows ?? [])[0]?.paid)));
}

const EMPTY: BookingPenaltySummary = { count: 0, pendingReview: 0, penaltyTotal: 0, paid: 0, remaining: 0, status: "none", penalties: [] };

/** The authoritative, read-only penalty rollup for a booking. */
export async function getBookingPenaltySummary(
  source: BookingPenaltySource,
  id: number,
  executor: Executor = db,
): Promise<BookingPenaltySummary> {
  if (!(await penaltiesTableExists(executor))) return EMPTY;
  const entity = entityTypeOf(source);
  const result = await executor.execute(sql`
    SELECT id, penalty_no, damage_type, item_label, product_id, quantity::text AS quantity,
           unit_value::text AS unit_value, penalty_amount::text AS penalty_amount, reason,
           status, origin, coalesce(jsonb_array_length(evidence), 0) AS evidence_count,
           created_by_name, created_at
    FROM booking_penalties
    WHERE source_type = ${entity} AND source_id = ${id}
    ORDER BY id DESC
  `);
  const rows = (result.rows ?? []) as any[];
  const penalties: BookingPenaltyRow[] = [];
  let penaltyTotal = 0;
  let paidTotal = 0;
  let remainingTotal = 0;
  let pendingReview = 0;
  for (const row of rows) {
    const lifecycle = String(row.status ?? "");
    const penaltyAmount = round2(num(row.penalty_amount));
    const paid = lifecycle === "cancelled" ? 0 : await penaltyApprovedPaid(Number(row.id), executor);
    const remaining = lifecycle === "approved" ? round2(Math.max(0, penaltyAmount - paid)) : 0;
    if (lifecycle === "approved") {
      penaltyTotal = round2(penaltyTotal + penaltyAmount);
      paidTotal = round2(paidTotal + Math.min(paid, penaltyAmount));
      remainingTotal = round2(remainingTotal + remaining);
    }
    if (lifecycle === "pending_review") pendingReview += 1;
    penalties.push({
      id: Number(row.id),
      penaltyNo: String(row.penalty_no ?? ""),
      damageType: String(row.damage_type ?? ""),
      itemLabel: String(row.item_label ?? ""),
      productId: row.product_id == null ? null : Number(row.product_id),
      quantity: num(row.quantity),
      unitValue: round2(num(row.unit_value)),
      penaltyAmount,
      reason: String(row.reason ?? ""),
      status: lifecycle,
      origin: String(row.origin ?? "manager"),
      evidenceCount: Number(row.evidence_count ?? 0),
      createdByName: String(row.created_by_name ?? ""),
      createdAt: row.created_at ? (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)) : null,
      paid,
      remaining,
      displayStatus: penaltyDisplayStatus(lifecycle, penaltyAmount, paid),
    });
  }
  const status: BookingPenaltyOverallStatus =
    penaltyTotal <= 0
      ? pendingReview > 0
        ? "pending_review"
        : "none"
      : remainingTotal <= 0
        ? "paid"
        : paidTotal > 0
          ? "partly_paid"
          : "unpaid";
  return { count: rows.length, pendingReview, penaltyTotal, paid: paidTotal, remaining: remainingTotal, status, penalties };
}
