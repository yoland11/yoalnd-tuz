/** A booking's saved transport service (service orders keep it in bookingOperations). */
export type BookingTransport = { mode?: string | null; fee?: unknown; inTotal?: boolean | null } | null | undefined;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Change to the booking total when the AJN transport fee becomes `nextFee`
 * (0 when transport is removed or left to the customer). A fee saved before it
 * joined the total has no `inTotal` flag and counts as zero, so it is added once.
 */
export function transportTotalDelta(prior: BookingTransport, nextFee: number) {
  const included = prior?.mode === "ajn" && prior?.inTotal === true ? Number(prior.fee) || 0 : 0;
  return round((Number(nextFee) || 0) - included);
}

/** The part of a transport fee already collected, credited to its vehicle by paid / total. */
export function executedTransportRevenue(fee: unknown, paid: unknown, total: unknown) {
  const totalValue = Number(total) || 0;
  if (totalValue <= 0) return 0;
  return round((Number(fee) || 0) * Math.min(1, Math.max(0, (Number(paid) || 0) / totalValue)));
}
