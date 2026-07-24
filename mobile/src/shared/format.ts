/**
 * Locale-aware formatting helpers. The AJN platform is Arabic-first (Iraq),
 * so dates/times default to the Baghdad timezone and Arabic labels come from
 * the server. These helpers only handle presentation, never business rules.
 */

const BAGHDAD_TZ = "Asia/Baghdad";

export function formatCurrencyIQD(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  if (!Number.isFinite(n)) return "0 د.ع";
  return `${new Intl.NumberFormat("ar-IQ").format(Math.round(n as number))} د.ع`;
}

export function formatEventDate(date: string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(date.length <= 10 ? `${date}T00:00:00` : date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("ar-IQ", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: BAGHDAD_TZ,
  }).format(parsed);
}

export function formatEventTime(time: string | null | undefined): string {
  if (!time) return "";
  // Server stores plain "HH:mm" strings; show as-is (already Baghdad local).
  return time;
}

/** Build a Google Maps navigation URL from coordinates or a free-text address. */
export function mapsUrl(opts: {
  lat?: number | null;
  lng?: number | null;
  query?: string | null;
}): string | null {
  if (opts.lat != null && opts.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${opts.lat},${opts.lng}`;
  }
  if (opts.query && opts.query.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.query.trim())}`;
  }
  return null;
}

export function telUrl(phone: string | null | undefined): string | null {
  const cleaned = (phone ?? "").replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
}
