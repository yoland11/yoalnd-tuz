/**
 * Booking calendar rules: department counters, filters, Baghdad calendar days,
 * printing and the contracts that keep them wired to the real pages.
 * Pure: touches no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addCalendarDays,
  baghdadDay,
  bookingCountLabel,
  bookingStatusLabel,
  bookingStatusTone,
  calendarConflicts,
  calendarStaffOptions,
  calendarStatusOptions,
  calendarViewDays,
  eventCalendarDay,
  filterCalendarCards,
  formatCalendarRange,
  formatEventTime,
  formatLongDay,
  isCalendarDay,
  matchesCalendarSearch,
  normalizeBookingDepartments,
  normalizeEventTime,
  shiftCalendarAnchor,
  summarizeCalendarDay,
  summarizeCalendarRange,
  weekStartOf,
  type BookingCalendarEvent,
  type CalendarCardFilters,
} from "../src/lib/booking-calendar";
import { buildBookingSchedulePrintHtml } from "../src/lib/booking-calendar-print";
import { BookingCalendarRangeError, parseBookingCalendarRange } from "../src/server/booking-calendar";
import { centralBookingDepartments, koshaBookingDepartments, serviceOrderDepartments } from "../src/server/booking-departments";

let nextId = 1;
function event(overrides: Partial<BookingCalendarEvent> = {}): BookingCalendarEvent {
  const id = overrides.id ?? nextId++;
  const kind = overrides.kind ?? "service";
  return {
    key: `${kind}-${id}`,
    id,
    kind,
    countsAsBooking: true,
    title: "حجز",
    customerName: "زبون",
    phone: "07701234567",
    trackingCode: null,
    number: `B-${id}`,
    status: "confirmed",
    date: "2026-10-30",
    day: "2026-10-30",
    startTime: null,
    endTime: null,
    timeNote: null,
    location: "",
    departments: ["kosha"],
    departmentUnits: {},
    staff: [],
    detailHref: `/admin/bookings/service/${id}`,
    workspaceHref: `/admin/bookings/service/${id}?tab=tasks`,
    ...overrides,
  };
}
const noFilters: CalendarCardFilters = { status: "", department: "", employee: null, search: "", showStoreOrders: false };
const counts = (summary: { departments: { key: string; bookings: number }[] }) => Object.fromEntries(summary.departments.map((row) => [row.key, row.bookings]));
const DAY = "2026-10-30";

// 1. One booking, one department.
assert.deepEqual(counts(summarizeCalendarDay(DAY, [event()])), { kosha: 1 });

// 2. One booking with several departments: +1 each, still one booking.
const mixed = summarizeCalendarDay(DAY, [event({ departments: ["kosha", "photography", "sound"] })]);
assert.deepEqual(counts(mixed), { kosha: 1, photography: 1, sound: 1 });
assert.equal(mixed.total, 1, "a mixed booking is one booking");

// 3. Several bookings in one department.
assert.deepEqual(counts(summarizeCalendarDay(DAY, [event(), event(), event({ departments: ["photography"] })])), { kosha: 2, photography: 1 });

// 4. Two service lines in one department: one booking, two units, kept distinct.
const units = summarizeCalendarDay(DAY, [event({ departmentUnits: { kosha: 2 } })]).departments[0];
assert.equal(units.bookings, 1);
assert.equal(units.units, 2);

// The same record delivered twice never counts twice.
const twice = event();
assert.equal(summarizeCalendarDay(DAY, [twice, { ...twice }]).total, 1);
assert.equal(summarizeCalendarDay(DAY, [twice, { ...twice }]).departments[0].bookings, 1);

// 5. Cancelled bookings leave the counters unless the status filter asks for them.
const cancelled = event({ status: "cancelled" });
assert.equal(summarizeCalendarDay(DAY, [cancelled]).total, 0);
assert.deepEqual(counts(summarizeCalendarDay(DAY, [cancelled], "ملغي")), { kosha: 1 }, "explicitly asking for cancelled shows them");
assert.equal(filterCalendarCards([cancelled], noFilters).length, 0);
assert.equal(filterCalendarCards([cancelled], { ...noFilters, status: "ملغي" }).length, 1);

// 6. A rescheduled booking counts on its current date only.
const moved = event({ day: "2026-10-31", date: "2026-10-31" });
assert.equal(summarizeCalendarDay(DAY, [moved]).total, 0);
assert.equal(summarizeCalendarDay("2026-10-31", [moved]).total, 1);
assert.equal(bookingStatusLabel("reschedule_pending"), "تغيير موعد");

// 7-9. Weekly and monthly totals add up the same distinct bookings.
const week = calendarViewDays("week", DAY);
assert.deepEqual([week[0], week[6]], ["2026-10-24", "2026-10-30"], "the week starts on Saturday, like the date picker");
const month = calendarViewDays("month", DAY);
assert.equal(month[0], "2026-09-26", "the month grid starts on the Saturday before the first");
assert.equal(month[month.length - 1], "2026-11-06");
assert.equal(month.length % 7, 0, "the month grid is whole weeks");
const weekEvents = [event(), event({ day: "2026-10-24" }), event({ day: "2026-10-31", departments: ["sound"] })];
assert.deepEqual(counts(summarizeCalendarRange(week, weekEvents)), { kosha: 2 }, "a booking outside the week is left out");
assert.equal(summarizeCalendarRange(week, weekEvents).total, 2);

// 10. The department filter narrows cards, never the totals.
const dayEvents = [event({ departments: ["kosha"] }), event({ departments: ["photography"] }), event({ departments: ["kosha", "photography"] })];
assert.equal(filterCalendarCards(dayEvents, { ...noFilters, department: "photography" }).length, 2);
assert.equal(summarizeCalendarDay(DAY, dayEvents).total, 3, "the day total keeps its meaning under a department filter");

// 11. The status filter applies to cards and counters alike, by visible label.
const statuses = [event({ status: "confirmed" }), event({ status: "preparing" }), event({ status: "processing" })];
assert.equal(filterCalendarCards(statuses, { ...noFilters, status: "قيد التجهيز" }).length, 2, "two stored values, one label");
assert.equal(summarizeCalendarDay(DAY, statuses, "قيد التجهيز").total, 2);
assert.deepEqual(calendarStatusOptions(statuses), ["قيد التجهيز", "مؤكد"].sort((a, b) => a.localeCompare(b, "ar")));

// 12. Search: name with Arabic variants, number and phone.
const searchable = event({ customerName: "شركة أنوار", number: "K-418-5330", phone: "0770 123 4567" });
for (const query of ["شركه انوار", "K-418", "1234567", "07701234567"]) assert.ok(matchesCalendarSearch(searchable, query), query);
assert.equal(matchesCalendarSearch(searchable, "غير موجود"), false);

// Employee filter and options come from the bookings themselves.
const staffed = event({ staff: [{ id: 7, name: "علي" }] });
assert.equal(filterCalendarCards([staffed, event()], { ...noFilters, employee: 7 }).length, 1);
assert.deepEqual(calendarStaffOptions([staffed, staffed]), [{ id: 7, name: "علي" }]);
assert.equal(summarizeCalendarDay(DAY, [staffed]).staffAssignments, 1, "assignments are a separate count from bookings");

// Store orders are not bookings: separate counter, opt-in cards, never under a department.
const store = event({ kind: "order", countsAsBooking: false, departments: [] });
const withStore = summarizeCalendarDay(DAY, [store, event()]);
assert.equal(withStore.total, 1);
assert.equal(withStore.storeOrders, 1);
assert.equal(filterCalendarCards([store], noFilters).length, 0);
assert.equal(filterCalendarCards([store], { ...noFilters, showStoreOrders: true }).length, 1);
assert.equal(filterCalendarCards([store], { ...noFilters, showStoreOrders: true, department: "kosha" }).length, 0);

// 15. Empty day.
assert.deepEqual(summarizeCalendarDay(DAY, []), { day: DAY, total: 0, departments: [], storeOrders: 0, staffAssignments: 0 });
assert.equal(bookingCountLabel(0), "لا حجوزات");
assert.equal(bookingCountLabel(1), "حجز واحد");
assert.equal(bookingCountLabel(2), "حجزان");
assert.equal(bookingCountLabel(8), "8 حجوزات");
assert.equal(bookingCountLabel(11), "11 حجزاً");

// 16. A very busy day stays exact and fast.
const busy = Array.from({ length: 3000 }, (_, index) => event({ departments: index % 2 ? ["kosha", "sound"] : ["photography"] }));
const started = performance.now();
const busySummary = summarizeCalendarDay(DAY, busy);
assert.equal(busySummary.total, 3000);
assert.deepEqual(counts(busySummary), { kosha: 1500, photography: 1500, sound: 1500 });
assert.ok(performance.now() - started < 500, "counters stay responsive at high volume");

// 17. Calendar days do not depend on the device timezone (no off-by-one).
const originalTz = process.env.TZ;
for (const tz of ["Asia/Baghdad", "UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
  process.env.TZ = tz;
  assert.equal(addCalendarDays("2026-10-31", 1), "2026-11-01", tz);
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28", tz);
  assert.equal(weekStartOf("2026-10-30"), "2026-10-24", tz);
  assert.equal(weekStartOf("2026-10-31"), "2026-10-31", `${tz}: a Saturday starts its own week`);
  assert.equal(formatLongDay("2026-10-30"), "الجمعة 30 أكتوبر", tz);
  assert.equal(baghdadDay(new Date("2026-10-29T21:30:00Z")), "2026-10-30", `${tz}: 00:30 in Baghdad is already the next day`);
  assert.equal(baghdadDay(new Date("2026-10-29T20:30:00Z")), "2026-10-29", tz);
  assert.equal(shiftCalendarAnchor("month", "2026-01-31", 1), "2026-02-28", `${tz}: never spills into March`);
  assert.equal(shiftCalendarAnchor("month", "2026-03-31", -1), "2026-02-28", tz);
  assert.equal(shiftCalendarAnchor("week", "2026-10-30", -1), "2026-10-23", tz);
  assert.equal(shiftCalendarAnchor("day", "2026-12-31", 1), "2027-01-01", tz);
}
process.env.TZ = originalTz;
assert.equal(isCalendarDay("2026-02-30"), false);
assert.equal(eventCalendarDay("2026-10-30T19:00"), "2026-10-30");
assert.equal(eventCalendarDay("2026/10/5"), "2026-10-05");
assert.equal(eventCalendarDay("قريباً"), null, "free text has no calendar day");
assert.match(formatCalendarRange("week", DAY), /24 أكتوبر – 30 أكتوبر 2026/);

// Saved times become sortable; free text stays unknown instead of guessed.
assert.equal(normalizeEventTime("19:00"), "19:00");
assert.equal(normalizeEventTime("7:30 م"), "19:30");
assert.equal(normalizeEventTime("7:30 مساءً"), "19:30");
assert.equal(normalizeEventTime("٧:٣٠ م"), "19:30");
assert.equal(normalizeEventTime("12:15 ص"), "00:15");
assert.equal(normalizeEventTime("12 PM"), "12:00");
assert.equal(normalizeEventTime("2026-10-30T18:45"), "18:45");
assert.equal(normalizeEventTime("بعد المغرب"), null);
assert.equal(normalizeEventTime("25:00"), null);
assert.equal(formatEventTime({ startTime: "19:00", endTime: "23:00", timeNote: null }), "19:00 – 23:00");
assert.equal(formatEventTime({ startTime: null, endTime: null, timeNote: "بعد المغرب" }), "بعد المغرب");
assert.equal(formatEventTime({ startTime: null, endTime: null, timeNote: null }), "بدون وقت محدد");
const ordered = filterCalendarCards([event({ startTime: "21:00" }), event({ startTime: "09:00" }), event()], noFilters);
assert.deepEqual(ordered.map((row) => row.startTime), [null, "09:00", "21:00"], "cards run by time");

// Status colors follow the meaning, unknown stored values stay neutral and untouched.
assert.equal(bookingStatusTone("confirmed"), "confirmed");
assert.equal(bookingStatusTone("pending"), "pending");
assert.equal(bookingStatusTone("preparing"), "preparing");
assert.equal(bookingStatusTone("completed"), "done");
assert.equal(bookingStatusTone("cancelled"), "cancelled");
assert.equal(bookingStatusTone("legacy_x"), "neutral");
assert.equal(bookingStatusLabel("legacy_x"), "legacy_x");

// Departments: same rules as the Booking Center, unknown keys do not invent a department.
assert.deepEqual(normalizeBookingDepartments(["sound", "kosha", "sound", "unknown"]), ["kosha", "sound"]);
assert.deepEqual(normalizeBookingDepartments([""]), ["decorations"], "a booking with no known service keeps the Booking Center's fallback");
assert.deepEqual(normalizeBookingDepartments([], "kosha"), ["kosha"]);
assert.deepEqual(serviceOrderDepartments({ departments: ["kosha"], bookingCenterServices: [{ type: "sound" }] }), ["kosha", "sound"]);
assert.deepEqual(serviceOrderDepartments({}, { type: "photography" }), ["photography"]);
assert.deepEqual(centralBookingDepartments("هدية"), ["gifts"]);
assert.deepEqual(koshaBookingDepartments({}), ["kosha"]);
assert.deepEqual(koshaBookingDepartments({ bookingCenterServices: [{ type: "sound" }] }), ["kosha", "sound"]);

// Possible conflicts keep the existing rule: same resource and moment, service orders only.
const conflicting = [event({ crewName: "فريق أ", date: "2026-10-30T19:00" }), event({ crewName: "فريق أ", date: "2026-10-30T19:00" }), event({ crewName: "فريق ب", date: "2026-10-30T19:00" })];
assert.equal(calendarConflicts(conflicting).length, 1);
assert.equal(calendarConflicts(conflicting)[0].events.length, 2);
assert.equal(calendarConflicts([event({ crewName: "أ", status: "cancelled" }), event({ crewName: "أ", status: "cancelled" })]).length, 0);
assert.equal(calendarConflicts([event({ kind: "kosha", location: "ق" }), event({ kind: "kosha", location: "ق" })]).length, 0);

// Requested range: validated, bounded, never everything.
assert.deepEqual(parseBookingCalendarRange(null, null, "2026-10-30"), { from: "2026-10-30", to: "2026-10-30" });
assert.throws(() => parseBookingCalendarRange("2026-13-01", "2026-13-02"), BookingCalendarRangeError);
assert.throws(() => parseBookingCalendarRange("2026-10-30", "2026-10-01"), BookingCalendarRangeError);
assert.throws(() => parseBookingCalendarRange("2026-01-01", "2026-12-31"), BookingCalendarRangeError, "a whole year is refused");
assert.doesNotThrow(() => parseBookingCalendarRange(month[0], month[month.length - 1]));

// 20. Printing: every requested field, escaped, for the filtered cards.
const printed = buildBookingSchedulePrintHtml({
  title: "جدول حجوزات يوم الجمعة 30 أكتوبر",
  rangeLabel: formatCalendarRange("day", DAY),
  days: [DAY],
  events: [event({ customerName: "أحمد <b>", number: "K-9-1234", startTime: "19:00", endTime: "23:00", location: "قاعة الملكي", departments: ["kosha", "photography"] }), event({ departments: ["sound"] })],
  filters: { ...noFilters, department: "kosha" },
  filterNote: "البطاقات تعرض الكوشات فقط؛ الأعداد تبقى لكل الأقسام.",
  generatedAt: "2026",
});
assert.match(printed, /الجمعة 30 أكتوبر/);
assert.match(printed, /إجمالي الحجوزات: <b>2<\/b>/, "print totals follow the same meaning as the screen");
assert.match(printed, /الكوشات: <b>1<\/b>/);
assert.match(printed, /DJ والصوتيات: <b>1<\/b>/);
assert.match(printed, /أحمد &lt;b&gt;/, "customer text is escaped");
assert.match(printed, /K-9-1234/);
assert.match(printed, /19:00 – 23:00/);
assert.match(printed, /الكوشات \+ التصوير/);
assert.match(printed, /قاعة الملكي/);
assert.match(printed, /البطاقات تعرض الكوشات فقط/);
assert.equal((printed.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length, 1, "the department filter narrows the printed rows");

// Contracts: wiring that a pure test cannot see.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const api = read("../src/server/api.ts");
const view = read("../src/views/admin/calendar.tsx");
const server = read("../src/server/booking-calendar.ts");
assert.match(api, /parseBookingCalendarRange\(params\.get\("from"\), params\.get\("to"\)\)/, "the route validates the visible range");
assert.match(api, /await readBookingCalendar\(db,/, "the route reads through the one calendar reader");
assert.match(api, /departments: serviceOrderDepartments\(fields, service\)/, "the Booking Center shares the department rules");
assert.match(api, /departments: koshaBookingDepartments\(/, "the Booking Center shares the Kosha department rules");
assert.doesNotMatch(api.slice(api.indexOf('section === "calendar" && method === "GET"'), api.indexOf('section === "messages"')), /insert|update\s*\(|delete\s*\(/i, "the calendar route writes nothing");
assert.doesNotMatch(server, /\b(INSERT|UPDATE|DELETE)\b/, "the calendar reader writes nothing");
for (const fragment of ["e.booking_id IS NULL", "o.archived_at IS NULL", "k.archived_at IS NULL", "linked.custom_fields->>'storeOrderId'", "Asia/Baghdad"]) assert.ok(server.includes(fragment), `calendar reader keeps: ${fragment}`);
for (const label of ["+ باقي الأقسام", "فتح مساحة العمل", "فتح الحجز", "إعادة التصفية", "طباعة جدول اليوم", "طباعة جدول الأسبوع", "كل الأقسام", "اليوم"]) assert.ok(view.includes(label), `calendar view keeps: ${label}`);
assert.match(view, /refetchOnMount: "always"/, "returning to the calendar always re-reads changed bookings");

console.log("PASS booking calendar logic: distinct per-department counts, service units, cancelled and status rules, filters that keep totals honest, Baghdad days in any timezone, printing, route contracts");
