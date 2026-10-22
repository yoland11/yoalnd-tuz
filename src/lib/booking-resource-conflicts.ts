import type { BookingOperationRef } from "./booking-operational-readiness";

export type ResourceOccupancy = { start: string; end: string };
export type ResourceReservation = {
  id: string;
  booking: BookingOperationRef;
  /** Canonical stock/variant or physical-asset identity, resolved by server adapter. */
  resource: string;
  quantity: number;
  status: "reserved" | "checked_out" | "released" | "cancelled" | "returned" | "consumed";
  interval: ResourceOccupancy | null;
};
export type ResourceConflictInput = {
  booking: BookingOperationRef;
  resource: string;
  required: number;
  stock: number;
  /** Explicit basis prevents subtracting checked-out quantities from on-hand stock twice. */
  stockBasis: "total_serviceable" | "warehouse_on_hand";
  interval: ResourceOccupancy | null;
  reservations: readonly ResourceReservation[];
};
export type ResourceConflictResult = {
  status: "available" | "shortage" | "incomplete";
  required: number;
  available: number | null;
  reserved: number | null;
  missing: number | null;
  conflictingBookings: BookingOperationRef[];
};
const statuses = new Set(["reserved", "checked_out", "released", "cancelled", "returned", "consumed"]);
const validBooking = (ref: BookingOperationRef) => ref && ["kosha", "service"].includes(ref.source) && Number.isSafeInteger(ref.id) && ref.id > 0;
const bookingKey = (ref: BookingOperationRef) => `${ref.source}:${ref.id}`;
const round = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

export function resourceOccupancyTimestamps(interval: ResourceOccupancy | null): [number, number] | null {
  // Require explicit time and timezone; local/date-only legacy data is not exact occupancy.
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!interval || !instant.test(interval.start) || !instant.test(interval.end)) return null;
  for (const value of [interval.start, interval.end]) {
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
    if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
    const offset = value.match(/[+-](\d{2}):(\d{2})$/);
    if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return null;
  }
  const start = Date.parse(interval.start), end = Date.parse(interval.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? [start, end] : null;
}

/** Read-only preview; callers MUST revalidate canonical facts under reservation locks. */
export function evaluateResourceConflict(input: ResourceConflictInput): ResourceConflictResult {
  if (!validBooking(input.booking) || !input.resource?.trim()
    || !Number.isFinite(input.required) || input.required <= 0
    || !Number.isFinite(input.stock) || input.stock < 0
    || !["total_serviceable", "warehouse_on_hand"].includes(input.stockBasis)) throw new Error("Invalid resource requirement");
  const identities = new Set<string>();
  for (const row of input.reservations) {
    if (!row.id?.trim() || !validBooking(row.booking) || !row.resource?.trim()
      || !Number.isFinite(row.quantity) || row.quantity <= 0 || !statuses.has(row.status)) throw new Error("Invalid reservation");
    if (identities.has(row.id)) throw new Error("Duplicate reservation identity");
    identities.add(row.id);
  }
  const target = resourceOccupancyTimestamps(input.interval);
  const conflicting = new Map<string, BookingOperationRef>();
  const incomplete = (): ResourceConflictResult => ({ status: "incomplete", required: input.required, available: null, reserved: null, missing: null, conflictingBookings: [...conflicting.values()] });
  if (!target) return incomplete();
  const events: Array<{ at: number; delta: number }> = [];
  let unknown = false;
  let outstanding = 0;
  for (const row of input.reservations) {
    if (row.resource !== input.resource || bookingKey(row.booking) === bookingKey(input.booking)
      || !["reserved", "checked_out"].includes(row.status)) continue;
    if (row.status === "checked_out") {
      // Planned return is not evidence of physical return. With on-hand stock
      // these units are already absent; with total stock they stay committed.
      if (input.stockBasis === "total_serviceable") {
        outstanding = round(outstanding + row.quantity);
        conflicting.set(bookingKey(row.booking), { ...row.booking });
      }
      continue;
    }
    const occupied = resourceOccupancyTimestamps(row.interval);
    if (!occupied) {
      unknown = true;
      conflicting.set(bookingKey(row.booking), { ...row.booking });
      continue;
    }
    const start = Math.max(target[0], occupied[0]), end = Math.min(target[1], occupied[1]);
    if (start >= end) continue;
    conflicting.set(bookingKey(row.booking), { ...row.booking });
    events.push({ at: start, delta: row.quantity }, { at: end, delta: -row.quantity });
  }
  if (unknown) return incomplete();
  // Release before acquire at equal timestamps: [start,end), with peak simultaneous usage.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = outstanding, peak = outstanding;
  for (const event of events) {
    current = round(current + event.delta);
    peak = Math.max(peak, current);
  }
  const available = Math.max(0, round(input.stock - peak));
  const missing = Math.max(0, round(input.required - available));
  return { status: missing > 0 ? "shortage" : "available", required: input.required, available, reserved: peak, missing, conflictingBookings: [...conflicting.values()] };
}
