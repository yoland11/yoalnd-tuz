import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { financialTransactionsTable } from "@workspace/db";
import { shortBookingNumber } from "@/lib/booking-number";
import { bookingCashState } from "@/lib/booking-cash-state";

type Executor = { execute: (query: any) => Promise<any> };
export type BookingEntityType = "kosha_booking" | "service_order";
export type BookingLink = { source: "kosha" | "service"; id: number; label: string };

const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];
const amountOf = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const sourceOf = (entityType: string) => (entityType === "kosha_booking" ? "kosha" : "service");
const groupPhotoKey = (entityType: string, id: number) => `group-photo-attendee:${entityType}:${id}:`;

export const bookingEntityType = (source: string | null | undefined): BookingEntityType | null =>
  source === "kosha" ? "kosha_booking" : source === "service" ? "service_order" : null;

async function voucherIdsFor(executor: Executor, entityType: BookingEntityType, id: number) {
  const result = await executor.execute(sql`
    SELECT v.id FROM receipt_vouchers v
    WHERE ${entityType === "kosha_booking" ? sql`v.kosha_booking_id = ${id}` : sql`v.booking_id = ${id}`}
    UNION
    SELECT a.receipt_voucher_id FROM receipt_voucher_allocations a
    WHERE a.source_type = ${entityType} AND a.source_id = ${id}
  `);
  return rowsOf(result).map((row) => String(row.id));
}

/**
 * Every cash movement that belongs to one booking: its direct payments, the receipt vouchers
 * collected for it, its penalty payments and its group photos. The booking's log and the cash
 * ledger's booking filter both use this, so they always list the same rows.
 */
export async function bookingTransactionCondition(executor: Executor, entityType: BookingEntityType, id: number) {
  const voucherIds = await voucherIdsFor(executor, entityType, id);
  const penaltyIds = rowsOf(await executor.execute(sql`SELECT id FROM booking_penalties WHERE source_type = ${entityType} AND source_id = ${id}`)).map((row) => String(row.id));
  const table = financialTransactionsTable;
  return or(
    and(eq(table.sourceType, entityType), eq(table.sourceId, String(id))),
    voucherIds.length ? and(eq(table.sourceType, "receipt_voucher"), inArray(table.sourceId, voucherIds)) : undefined,
    penaltyIds.length ? and(eq(table.sourceType, "booking_penalty"), inArray(table.sourceId, penaltyIds)) : undefined,
    and(eq(table.sourceType, "group_photo"), eq(table.sourceId, String(id)), like(table.idempotencyKey, `${groupPhotoKey(entityType, id)}%`)),
  )!;
}

/** How much of each receipt voucher went to this booking; one voucher can pay several documents. */
export async function bookingVoucherShares(executor: Executor, entityType: BookingEntityType, id: number) {
  const result = await executor.execute(sql`
    SELECT a.receipt_voucher_id AS voucher_id, sum(a.amount::numeric) AS share
    FROM receipt_voucher_allocations a
    WHERE a.source_type = ${entityType} AND a.source_id = ${id}
    GROUP BY a.receipt_voucher_id
  `);
  return new Map(rowsOf(result).map((row) => [String(row.voucher_id), amountOf(row.share)]));
}

/**
 * The booking seen from the cash box. "approved" uses the same rule as reconcilePaymentState
 * (executed movements plus posted allocations), and penalties and group photos stay outside it
 * because they are separate money that never counts towards the booking's own total.
 */
export async function bookingCashSummary(executor: Executor, input: { entityType: BookingEntityType; id: number; total: number; recorded: number }) {
  const { entityType, id, total, recorded } = input;
  const sourceId = String(id);
  const [row] = rowsOf(await executor.execute(sql`
    SELECT
      (SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0) FROM financial_transactions
        WHERE source_type = ${entityType} AND source_id = ${sourceId} AND approval_status = 'executed') AS direct_paid,
      (SELECT coalesce(sum(amount::numeric), 0) FROM financial_transactions
        WHERE source_type = ${entityType} AND source_id = ${sourceId} AND approval_status IN ('pending', 'draft') AND direction = 'revenue') AS direct_waiting,
      (SELECT coalesce(sum(greatest(a.amount::numeric - coalesce(a.reversed_amount::numeric, 0), 0)), 0)
        FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
        WHERE a.source_type = ${entityType} AND a.source_id = ${id} AND a.posted_at IS NOT NULL AND coalesce(v.approval_status, 'executed') = 'executed') AS allocated_paid,
      (SELECT coalesce(sum(a.amount::numeric), 0)
        FROM receipt_voucher_allocations a JOIN receipt_vouchers v ON v.id = a.receipt_voucher_id
        WHERE a.source_type = ${entityType} AND a.source_id = ${id} AND a.posted_at IS NULL AND v.approval_status IN ('pending', 'draft')) AS allocated_waiting,
      (SELECT coalesce(sum(CASE WHEN f.direction = 'revenue' THEN f.amount::numeric ELSE -f.amount::numeric END), 0)
        FROM financial_transactions f JOIN booking_penalties p ON p.id::text = f.source_id
        WHERE f.source_type = 'booking_penalty' AND f.approval_status = 'executed' AND p.source_type = ${entityType} AND p.source_id = ${id}) AS penalties,
      (SELECT coalesce(sum(CASE WHEN direction = 'revenue' THEN amount::numeric ELSE -amount::numeric END), 0) FROM financial_transactions
        WHERE source_type = 'group_photo' AND source_id = ${sourceId} AND approval_status = 'executed' AND idempotency_key LIKE ${`${groupPhotoKey(entityType, id)}%`}) AS group_photos
  `));
  const approved = Math.max(amountOf(amountOf(row?.direct_paid) + amountOf(row?.allocated_paid)), 0);
  return {
    approved,
    waiting: amountOf(amountOf(row?.direct_waiting) + amountOf(row?.allocated_waiting)),
    recorded: amountOf(recorded),
    penalties: amountOf(row?.penalties),
    groupPhotos: amountOf(row?.group_photos),
    ...bookingCashState({ total, recorded, approved }),
  };
}

/** Adds the booking(s) behind each cash movement, so the ledger can open the booking itself. */
export async function attachBookingLinks<T extends { sourceType: string | null; sourceId: string | null; idempotencyKey?: string | null }>(executor: Executor, rows: T[]) {
  const numericIds = (sourceType: string) => [...new Set(rows.filter((row) => row.sourceType === sourceType && /^\d+$/.test(String(row.sourceId ?? ""))).map((row) => Number(row.sourceId)))];
  const inList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const penaltyIds = numericIds("booking_penalty");
  const voucherIds = numericIds("receipt_voucher");
  const penalties = new Map(penaltyIds.length
    ? rowsOf(await executor.execute(sql`SELECT id, source_type, source_id FROM booking_penalties WHERE id IN (${inList(penaltyIds)})`)).map((row) => [String(row.id), { entityType: String(row.source_type), id: Number(row.source_id) }])
    : []);
  const vouchers = new Map<string, Array<{ entityType: string; id: number }>>();
  if (voucherIds.length) {
    const result = await executor.execute(sql`
      SELECT a.receipt_voucher_id AS voucher_id, a.source_type AS entity_type, a.source_id AS booking_id FROM receipt_voucher_allocations a
      WHERE a.receipt_voucher_id IN (${inList(voucherIds)}) AND a.source_type IN ('kosha_booking', 'service_order') AND a.source_id IS NOT NULL
      UNION
      SELECT v.id, 'kosha_booking', v.kosha_booking_id FROM receipt_vouchers v WHERE v.id IN (${inList(voucherIds)}) AND v.kosha_booking_id IS NOT NULL
      UNION
      SELECT v.id, 'service_order', v.booking_id FROM receipt_vouchers v WHERE v.id IN (${inList(voucherIds)}) AND v.booking_id IS NOT NULL
    `);
    for (const row of rowsOf(result)) {
      const list = vouchers.get(String(row.voucher_id)) ?? [];
      list.push({ entityType: String(row.entity_type), id: Number(row.booking_id) });
      vouchers.set(String(row.voucher_id), list);
    }
  }
  const targetsOf = (row: T): Array<{ entityType: string; id: number }> => {
    const id = String(row.sourceId ?? "");
    if ((row.sourceType === "kosha_booking" || row.sourceType === "service_order") && /^\d+$/.test(id)) return [{ entityType: row.sourceType, id: Number(id) }];
    if (row.sourceType === "booking_penalty") return penalties.has(id) ? [penalties.get(id)!] : [];
    if (row.sourceType === "receipt_voucher") return vouchers.get(id) ?? [];
    if (row.sourceType === "group_photo") {
      const match = /^group-photo-attendee:(kosha_booking|service_order):(\d+):/.exec(String(row.idempotencyKey ?? ""));
      return match ? [{ entityType: match[1], id: Number(match[2]) }] : [];
    }
    return [];
  };
  const targets = rows.map(targetsOf);
  const idsFor = (entityType: string) => [...new Set(targets.flat().filter((target) => target.entityType === entityType).map((target) => target.id))];
  const koshaIds = idsFor("kosha_booking");
  const serviceIds = idsFor("service_order");
  const codes = new Map<string, string | null>();
  if (koshaIds.length) for (const row of rowsOf(await executor.execute(sql`SELECT id, tracking_code FROM kosha_bookings WHERE id IN (${inList(koshaIds)})`))) codes.set(`kosha_booking:${row.id}`, row.tracking_code ?? null);
  if (serviceIds.length) for (const row of rowsOf(await executor.execute(sql`SELECT id, tracking_code FROM service_orders WHERE id IN (${inList(serviceIds)})`))) codes.set(`service_order:${row.id}`, row.tracking_code ?? null);
  return rows.map((row, index) => {
    const seen = new Set<string>();
    const bookings: BookingLink[] = [];
    for (const target of targets[index]) {
      const key = `${target.entityType}:${target.id}`;
      // A booking that no longer exists has nothing to open.
      if (seen.has(key) || !codes.has(key)) continue;
      seen.add(key);
      const source = sourceOf(target.entityType);
      bookings.push({ source, id: target.id, label: shortBookingNumber(source, target.id, codes.get(key)) || `#${target.id}` });
    }
    return { ...row, bookings };
  });
}
