/**
 * Pure rules of the booking calendar: departments, Baghdad calendar days and
 * the daily counters. No database or browser access, so every rule is testable.
 *
 * Counting rules:
 * - A booking counts once in the day total and once in each department it
 *   serves, however many service lines it holds (those are `units`).
 * - Cancelled bookings are left out unless the status filter asks for them.
 * - Store orders are not bookings: they have their own counter.
 * - The department, search and employee filters narrow the cards only; the
 *   counters keep describing the whole day.
 */

import { CALENDAR_WEEK_STARTS_ON, baghdadDay, isCalendarDay } from "./arabic-date";

export { baghdadDay, isCalendarDay };

export const BOOKING_DEPARTMENTS = [
  { key: "kosha", label: "الكوشات", short: "الكوشات" },
  { key: "photography", label: "التصوير", short: "التصوير" },
  { key: "sound", label: "DJ والصوتيات", short: "DJ وصوتيات" },
  { key: "transportation", label: "النقل", short: "النقل" },
  { key: "graduation", label: "التخرج", short: "التخرج" },
  { key: "gifts", label: "الهدايا والتوزيعات", short: "الهدايا" },
  { key: "flowers", label: "التنسيق والزهور", short: "الزهور" },
  { key: "catering", label: "الضيافة", short: "الضيافة" },
  { key: "led", label: "شاشات LED", short: "LED" },
  { key: "decorations", label: "الديكورات", short: "الديكور" },
  { key: "rental", label: "الإيجار", short: "الإيجار" },
] as const;
export type BookingDepartmentKey = (typeof BOOKING_DEPARTMENTS)[number]["key"];

const DEPARTMENT_ORDER = new Map<string, number>(BOOKING_DEPARTMENTS.map((department, index) => [department.key, index]));
export const isBookingDepartment = (value: unknown): value is BookingDepartmentKey => DEPARTMENT_ORDER.has(String(value));
export const bookingDepartment = (key: string) => BOOKING_DEPARTMENTS.find((department) => department.key === key) ?? null;

/** Known departments in catalogue order; a booking with none keeps the Booking Center's fallback. */
export function normalizeBookingDepartments(values: readonly unknown[], fallback: BookingDepartmentKey = "decorations"): BookingDepartmentKey[] {
  const known = [...new Set(values.map(String))].filter(isBookingDepartment);
  known.sort((a, b) => DEPARTMENT_ORDER.get(a)! - DEPARTMENT_ORDER.get(b)!);
  return known.length ? known : [fallback];
}

// ── Calendar days (plain dates; Baghdad has no DST) ───────────────────────
const dayParts = (day: string) => day.split("-").map(Number) as [number, number, number];
const utcOf = (day: string) => {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date));
};
const isoOf = (date: Date) => date.toISOString().slice(0, 10);

export function addCalendarDays(day: string, days: number): string {
  const next = utcOf(day);
  next.setUTCDate(next.getUTCDate() + days);
  return isoOf(next);
}

/** The same week as the date picker: it starts on Saturday. */
export const weekStartOf = (day: string) => addCalendarDays(day, -((utcOf(day).getUTCDay() - CALENDAR_WEEK_STARTS_ON + 7) % 7));

export function calendarDaySpan(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addCalendarDays(day, 1)) days.push(day);
  return days;
}

export type CalendarView = "day" | "week" | "month";

/** Days a view shows: the month view is whole weeks around that month. */
export function calendarViewDays(view: CalendarView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const start = weekStartOf(anchor);
    return calendarDaySpan(start, addCalendarDays(start, 6));
  }
  const [year, month] = dayParts(anchor);
  const first = isoOf(new Date(Date.UTC(year, month - 1, 1)));
  const last = isoOf(new Date(Date.UTC(year, month, 0)));
  return calendarDaySpan(weekStartOf(first), addCalendarDays(weekStartOf(last), 6));
}

export function shiftCalendarAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addCalendarDays(anchor, direction);
  if (view === "week") return addCalendarDays(anchor, 7 * direction);
  const [year, month, date] = dayParts(anchor);
  // 31 January + one month is the last day of February, never early March.
  const lastDate = new Date(Date.UTC(year, month - 1 + direction + 1, 0)).getUTCDate();
  return isoOf(new Date(Date.UTC(year, month - 1 + direction, Math.min(date, lastDate))));
}

export const isSameCalendarMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

const dayFormat = (options: Intl.DateTimeFormatOptions) => {
  const format = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { ...options, timeZone: "UTC" });
  return (day: string) => format.format(utcOf(day));
};
export const formatWeekday = dayFormat({ weekday: "long" });
export const formatWeekdayNarrow = dayFormat({ weekday: "narrow" });
export const formatDayMonth = dayFormat({ day: "numeric", month: "long" });
export const formatMonthYear = dayFormat({ month: "long", year: "numeric" });
const formatFullDate = dayFormat({ day: "numeric", month: "long", year: "numeric" });
export const formatLongDay = (day: string) => `${formatWeekday(day)} ${formatDayMonth(day)}`;

export function formatCalendarRange(view: CalendarView, anchor: string): string {
  if (view === "day") return `${formatWeekday(anchor)} ${formatFullDate(anchor)}`;
  if (view === "month") return formatMonthYear(anchor);
  const days = calendarViewDays("week", anchor);
  return `${formatDayMonth(days[0])} – ${formatFullDate(days[6])}`;
}

/** Calendar day of a stored event date; legacy text that is not a date has none. */
export function eventCalendarDay(value: unknown): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const day = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return isCalendarDay(day) ? day : null;
}

const ARABIC_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

/** "19:00", "7:30 م" or "7 PM" as HH:MM; free text stays unknown instead of guessed. */
export function normalizeEventTime(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit]);
  if (!text) return null;
  const clock = text.includes("T") ? text.slice(text.indexOf("T") + 1) : text;
  const match = /^(\d{1,2})(?::(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*(ص|م|صباحا?ً?|مساءً?|am|pm)?$/i.exec(clock);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = (match[3] ?? "").toLowerCase();
  if (period && (hour < 1 || hour > 12)) return null;
  if (period === "pm" || period.startsWith("م")) hour = hour === 12 ? 12 : hour + 12;
  else if (period && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ── Statuses: reuse the stored values, only their display is mapped here ──
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  draft: "مسودة",
  submitted: "مرسل",
  registered: "مسجل",
  open: "مفتوح",
  pending: "قيد الانتظار",
  pending_confirmation: "بانتظار التأكيد",
  waiting: "بانتظار البدء",
  reschedule_pending: "تغيير موعد",
  confirmed: "مؤكد",
  active: "نشط",
  ready: "جاهز",
  processing: "قيد التجهيز",
  preparing: "قيد التجهيز",
  in_progress: "قيد التنفيذ",
  in_production: "قيد الإنتاج",
  sewing: "قيد الخياطة",
  dispatched: "تم الإرسال",
  shipped: "في الطريق",
  out_for_delivery: "خرج للتوصيل",
  installed: "تم التركيب",
  running: "قيد التنفيذ",
  completed: "مكتمل",
  delivered: "تم التسليم",
  finished: "منتهٍ",
  returned: "تم الإرجاع",
  closed: "مغلق",
  cancelled: "ملغي",
};
export const bookingStatusLabel = (status: string) => BOOKING_STATUS_LABELS[status] ?? status;

export type BookingStatusTone = "confirmed" | "pending" | "preparing" | "done" | "cancelled" | "neutral";
const STATUS_TONES: Record<BookingStatusTone, readonly string[]> = {
  confirmed: ["confirmed", "active", "ready", "open"],
  pending: ["new", "draft", "submitted", "registered", "pending", "pending_confirmation", "waiting", "reschedule_pending"],
  preparing: ["processing", "preparing", "in_progress", "in_production", "sewing", "dispatched", "shipped", "out_for_delivery", "installed", "running"],
  done: ["completed", "delivered", "finished", "returned", "closed"],
  cancelled: ["cancelled", "canceled"],
  neutral: [],
};
export function bookingStatusTone(status: string): BookingStatusTone {
  for (const tone of Object.keys(STATUS_TONES) as BookingStatusTone[]) if (STATUS_TONES[tone].includes(status)) return tone;
  return "neutral";
}
export const isCancelledBooking = (status: string) => bookingStatusTone(status) === "cancelled";

// ── Events and counters ───────────────────────────────────────────────────
export type BookingCalendarEventKind = "service" | "kosha" | "order" | "photography" | "graduation" | "graduation_group" | "catering" | "rental";

export type BookingCalendarEvent = {
  /** Unique per event: one booking appears once on its day. */
  key: string;
  id: number;
  kind: BookingCalendarEventKind;
  /** False for store orders, which have their own counter. */
  countsAsBooking: boolean;
  title: string;
  customerName: string;
  phone: string;
  trackingCode: string | null;
  number: string;
  status: string;
  date: string;
  day: string;
  startTime: string | null;
  endTime: string | null;
  /** Shown when there is no parseable time: the saved text, or what the date means. */
  timeNote: string | null;
  location: string;
  departments: string[];
  /** Service lines per department; a booking still counts once in `bookings`. */
  departmentUnits: Record<string, number>;
  staff: { id: number; name: string }[];
  detailHref: string | null;
  workspaceHref: string | null;
  serviceId?: number;
  serviceType?: string | null;
  crewName?: string;
  primaryEmployeeName?: string | null;
  assistantEmployeeName?: string | null;
};

export type DepartmentCount = { key: string; label: string; short: string; bookings: number; units: number };
export type DaySummary = { day: string; total: number; departments: DepartmentCount[]; storeOrders: number; staffAssignments: number };
export type RangeSummary = { total: number; departments: DepartmentCount[]; storeOrders: number };

/** Status rule shared by counters and cards: cancelled only when asked for. */
export function matchesCalendarStatus(event: Pick<BookingCalendarEvent, "status">, statusLabel: string): boolean {
  if (statusLabel) return bookingStatusLabel(event.status) === statusLabel;
  return !isCancelledBooking(event.status);
}

function departmentCounts(events: readonly BookingCalendarEvent[]): DepartmentCount[] {
  const counts = new Map<string, { bookings: Set<string>; units: number }>();
  for (const event of events) {
    for (const key of event.departments) {
      const entry = counts.get(key) ?? { bookings: new Set<string>(), units: 0 };
      if (!entry.bookings.has(event.key)) {
        entry.bookings.add(event.key);
        entry.units += Math.max(event.departmentUnits[key] ?? 1, 1);
      }
      counts.set(key, entry);
    }
  }
  return [...counts.entries()]
    .map(([key, entry]) => {
      const department = bookingDepartment(key);
      return { key, label: department?.label ?? key, short: department?.short ?? key, bookings: entry.bookings.size, units: entry.units };
    })
    .sort((a, b) => (DEPARTMENT_ORDER.get(a.key) ?? 99) - (DEPARTMENT_ORDER.get(b.key) ?? 99));
}

export function summarizeCalendarDay(day: string, events: readonly BookingCalendarEvent[], statusLabel = ""): DaySummary {
  const dayEvents = events.filter((event) => event.day === day && matchesCalendarStatus(event, statusLabel));
  const bookings = dayEvents.filter((event) => event.countsAsBooking);
  return {
    day,
    total: new Set(bookings.map((event) => event.key)).size,
    departments: departmentCounts(bookings),
    storeOrders: dayEvents.length - bookings.length,
    staffAssignments: bookings.reduce((sum, event) => sum + event.staff.length, 0),
  };
}

export function summarizeCalendarRange(days: readonly string[], events: readonly BookingCalendarEvent[], statusLabel = ""): RangeSummary {
  const inRange = new Set(days);
  const scoped = events.filter((event) => inRange.has(event.day) && matchesCalendarStatus(event, statusLabel));
  const bookings = scoped.filter((event) => event.countsAsBooking);
  return { total: new Set(bookings.map((event) => event.key)).size, departments: departmentCounts(bookings), storeOrders: scoped.length - bookings.length };
}

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ـ/g, "").replace(/\s+/g, " ").trim();

export function matchesCalendarSearch(event: BookingCalendarEvent, query: string): boolean {
  const needle = normalizeText(query);
  if (!needle) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 3 && event.phone.replace(/\D/g, "").includes(digits)) return true;
  return [event.customerName, event.number, event.title, event.location, event.phone].some((value) => normalizeText(value ?? "").includes(needle));
}

export type CalendarCardFilters = { status: string; department: string; employee: number | null; search: string; showStoreOrders: boolean };

/** The cards a view shows, by time; events with no known time come first. */
export function filterCalendarCards(events: readonly BookingCalendarEvent[], filters: CalendarCardFilters): BookingCalendarEvent[] {
  return events
    .filter((event) => (event.countsAsBooking ? true : filters.showStoreOrders && !filters.department))
    .filter((event) => matchesCalendarStatus(event, filters.status))
    .filter((event) => !filters.department || event.departments.includes(filters.department))
    .filter((event) => filters.employee == null || event.staff.some((staff) => staff.id === filters.employee))
    .filter((event) => matchesCalendarSearch(event, filters.search))
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.customerName.localeCompare(b.customerName, "ar") || a.key.localeCompare(b.key));
}

/** Statuses present in the loaded period, as one option per visible label. */
export function calendarStatusOptions(events: readonly BookingCalendarEvent[]): string[] {
  return [...new Set(events.map((event) => bookingStatusLabel(event.status)))].sort((a, b) => a.localeCompare(b, "ar"));
}

export function calendarStaffOptions(events: readonly BookingCalendarEvent[]): { id: number; name: string }[] {
  const staff = new Map<number, string>();
  for (const event of events) for (const member of event.staff) if (!staff.has(member.id)) staff.set(member.id, member.name);
  return [...staff.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Service orders sharing a crew or location at the same moment: the existing "possible conflict" rule. */
export function calendarConflicts(events: readonly BookingCalendarEvent[]): { key: string; events: BookingCalendarEvent[] }[] {
  const groups = new Map<string, BookingCalendarEvent[]>();
  for (const event of events) {
    if (event.kind !== "service" || ["cancelled", "completed", "delivered"].includes(event.status)) continue;
    const moment = (event.date ?? "").slice(0, 16) || event.day;
    const resource = (event.crewName || event.location || `service-${event.serviceId ?? "general"}`).trim();
    if (!moment || !resource) continue;
    const key = `${moment}::${resource}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([key, items]) => ({ key, events: items }));
}

/** Arabic count wording: لا حجوزات، حجز واحد، حجزان، 3 حجوزات، 11 حجزاً. */
export function bookingCountLabel(count: number): string {
  if (count <= 0) return "لا حجوزات";
  if (count === 1) return "حجز واحد";
  if (count === 2) return "حجزان";
  return count <= 10 ? `${count} حجوزات` : `${count} حجزاً`;
}

export const formatEventTime = (event: Pick<BookingCalendarEvent, "startTime" | "endTime" | "timeNote">) =>
  event.startTime ? (event.endTime ? `${event.startTime} – ${event.endTime}` : event.startTime) : event.timeNote || "بدون وقت محدد";

export const eventServicesLabel = (event: Pick<BookingCalendarEvent, "departments" | "countsAsBooking" | "title">) =>
  event.countsAsBooking && event.departments.length ? event.departments.map((key) => bookingDepartment(key)?.short ?? key).join(" + ") : event.title;
