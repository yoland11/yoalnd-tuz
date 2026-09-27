// Short, human-friendly booking numbers.
//
// The long tracking code (e.g. AJN-5330-4FC3…) is a bearer secret: it opens
// the public tracking page without any other check, so it must stay long and
// unguessable. It keeps living inside QR codes and tracking links only.
//
// For everything people read, type or say (lists, invoices, receipts,
// messages) we show a short number derived from data that never changes:
//   K-418-5330  → kosha booking #418, phone ending 5330 at booking time
//   B-1532-5330 → service booking #1532
// The phone tail is taken from the tracking code (captured when the booking
// was created), so editing the customer's phone later never changes the
// number printed on earlier invoices. Old codes without a phone tail simply
// render without it (e.g. K-12).
//
// A short number alone never unlocks public tracking: the server also
// requires the full mobile number registered on the booking.

export type ShortBookingSource = "kosha" | "service";

const PREFIX: Record<ShortBookingSource, "K" | "B"> = { kosha: "K", service: "B" };

/** Phone tail embedded in an `AJN-1234-<hex>` tracking code, or "". */
export function trackingPhoneTail(trackingCode?: string | null): string {
  const match = /^AJN-(\d{4})-[A-F0-9]+$/i.exec(String(trackingCode ?? "").trim());
  const tail = match?.[1] ?? "";
  return tail === "0000" ? "" : tail;
}

export function shortBookingNumber(
  source: ShortBookingSource,
  id: number | string | null | undefined,
  trackingCode?: string | null,
): string {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return "";
  const tail = trackingPhoneTail(trackingCode);
  return `${PREFIX[source]}-${numericId}${tail ? `-${tail}` : ""}`;
}

/**
 * Short number for mixed lists keyed by kind: bookings ("service" / "kosha")
 * get their short number; anything else (store orders…) returns "" so the
 * caller keeps showing its own code.
 */
export function bookingDisplayNumber(
  kind: string | null | undefined,
  id: number | string | null | undefined,
  trackingCode?: string | null,
): string {
  if (kind === "service") return shortBookingNumber("service", id, trackingCode);
  if (kind === "kosha") return shortBookingNumber("kosha", id, trackingCode);
  return "";
}

export type ParsedShortBookingNumber = {
  source: ShortBookingSource;
  id: number;
  tail: string | null;
};

/**
 * Accepts K-418-5330, k418-5330, "K 418 5330", K-418 (case/space/dash
 * tolerant). The phone tail must be separated from the id; returns null for
 * anything else so long tracking codes are never misread as short numbers.
 */
export function parseShortBookingNumber(value: unknown): ParsedShortBookingNumber | null {
  const text = String(value ?? "").trim().toUpperCase();
  const match = /^([KB])[\s-]*(\d{1,7})(?:[\s-]+(\d{4}))?$/.exec(text);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    source: match[1] === "K" ? "kosha" : "service",
    id,
    tail: match[3] ?? null,
  };
}
