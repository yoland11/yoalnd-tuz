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

/**
 * A service order's transport, read the same way everywhere.
 *
 * The transport card saves `customFields.bookingOperations.transportation`; once
 * that key exists it wins, even as null («بدون نقل»). Before that, the booking
 * form (new booking and «إضافة خدمة») keeps the choice as
 * `customFields.transportationMode/transportationFee` beside a «النقل» service
 * line, and puts an AJN fee into the booking total — so it counts as `inTotal`
 * and a later card save adds nothing a second time. The fee is passed through
 * unvalidated: the plan reader rejects a bad amount instead of reading zero.
 */
export function serviceOrderTransportation(customFields: unknown): Record<string, unknown> | null {
  const fields = customFields && typeof customFields === "object" && !Array.isArray(customFields) ? customFields as Record<string, unknown> : {};
  const operations = fields.bookingOperations;
  if (operations && typeof operations === "object" && !Array.isArray(operations) && Object.hasOwn(operations, "transportation"))
    return ((operations as Record<string, unknown>).transportation ?? null) as Record<string, unknown> | null;
  if (fields.transportationMode === "ajn")
    return { mode: "ajn", fee: fields.transportationFee ?? null, vehicleId: null, driverId: null, note: null, inTotal: true, source: "booking_form" };
  if (fields.transportationMode === "customer") return { mode: "customer", source: "booking_form" };
  return null;
}

/**
 * The booking's «النقل» service line says what the transport card says, so the
 * services list and the 80mm receipt never disagree. `transport` is the card's
 * saved transport; `undefined` means not loaded yet, and the line stays as saved.
 */
export function servicesWithTransport<T extends { type: string; amount?: number; notes?: string }>(services: T[], transport: { mode?: unknown; fee?: unknown } | null | undefined): T[] {
  if (transport === undefined) return services;
  return services.map((service) => service.type !== "transportation" ? service
    : transport?.mode === "ajn" ? { ...service, amount: Number(transport.fee) || 0 }
    : transport?.mode === "customer" ? { ...service, amount: 0, notes: "النقل على الزبون" }
    : { ...service, amount: 0, notes: "ما محدد نقل بعد — حدده من تبويب النقل" });
}

/** Legacy analytical share of booking collections; not the full recorded vehicle income. */
export function executedTransportRevenue(fee: unknown, paid: unknown, total: unknown) {
  const totalValue = Number(total) || 0;
  if (totalValue <= 0) return 0;
  return round((Number(fee) || 0) * Math.min(1, Math.max(0, (Number(paid) || 0) / totalValue)));
}
