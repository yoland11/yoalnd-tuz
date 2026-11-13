export const BOOKING_EVENT_TYPES = [
  { key: "engagement", label: "خطوبة" },
  { key: "henna", label: "حنة" },
  { key: "wedding", label: "زفاف" },
  { key: "birthday", label: "عيد ميلاد" },
  { key: "graduation", label: "تخرج" },
  { key: "other", label: "مناسبة أخرى" },
] as const;

export type BookingEventType = typeof BOOKING_EVENT_TYPES[number]["key"];
export type BookingEventFilter = "all" | BookingEventType;

const aliases: Record<BookingEventType, readonly string[]> = {
  engagement: ["engagement", "خطوبة", "خطوبه", "الخطوبة", "الخطوبه", "ملكة"],
  henna: ["henna", "حنة", "حنه", "الحنة", "الحنه", "حناء", "ليلة الحنة"],
  wedding: ["wedding", "زفاف", "الزفاف", "عرس", "العرس", "زواج", "حفل زفاف"],
  birthday: ["birthday", "birthday party", "عيد ميلاد", "عيدميلاد", "حفل عيد ميلاد"],
  graduation: ["graduation", "تخرج", "التخرج", "حفل تخرج", "حفلة تخرج"],
  other: ["other", "أخرى", "اخرى", "آخر", "اخر", "مناسبة أخرى", "مناسبه اخرى"],
};

function token(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}
const keys = new Map<string, BookingEventType>();
for (const type of BOOKING_EVENT_TYPES) for (const alias of aliases[type.key]) keys.set(token(alias), type.key);

export function normalizeBookingEventType(value: unknown): BookingEventType | null {
  return typeof value === "string" ? keys.get(token(value)) ?? null : null;
}

/** New choices retain the established human-readable database representation. */
export function bookingEventTypeStorage(value: unknown): string | null {
  const key = normalizeBookingEventType(value);
  return BOOKING_EVENT_TYPES.find(type => type.key === key)?.label ?? null;
}

export function bookingEventTypeLabel(value: unknown, fallback = "غير محدد"): string {
  return bookingEventTypeStorage(value) ?? (typeof value === "string" && value.trim() ? value.trim() : fallback);
}

export function bookingEventTypeMatches(value: unknown, filter: BookingEventFilter): boolean {
  if (filter === "all") return true;
  const key = normalizeBookingEventType(value);
  if (key) return key === filter;
  return filter === "other" && typeof value === "string" && Boolean(value.trim());
}

function bag(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

/** Never infer an occasion from a paid service or department name. */
export function readBookingEventType(source: string, value: unknown): string | null {
  const raw = bag(value), fields = bag(raw.customFields), details = bag(raw.bookingDetails);
  const stored = source === "service" ? fields.eventType ?? raw.eventType
    : source === "kosha" ? raw.eventType ?? raw.event_type ?? details.eventType
    : raw.eventType ?? fields.eventType;
  if (typeof stored === "string" && stored.trim()) return stored;
  if (source === "graduation" || (source === "service" && fields.bookingSource === "graduation" && positiveId(fields.graduationOrderId))) return "تخرج";
  return null;
}

/** Existing graduation order IDs can open the original authorized order view. */
export function bookingGraduationHref(value: unknown): string {
  const raw = bag(value), fields = bag(raw.customFields), details = bag(raw.bookingDetails);
  const id = positiveId(fields.graduationOrderId ?? details.graduationOrderId ?? raw.graduationOrderId);
  return id ? `/admin/graduation/orders?order=${id}` : "/admin/graduation/orders";
}
