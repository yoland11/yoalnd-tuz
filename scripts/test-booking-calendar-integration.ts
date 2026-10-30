/**
 * Real-PostgreSQL test of the booking calendar reader. Write test: runs ONLY with
 * AJN_ENV=test, ALLOW_TEST_WRITES=true and a separate TEST_DATABASE_URL (never
 * DATABASE_URL). Otherwise it reports SKIPPED. Every row it creates carries this
 * run's unique prefix, and assertions read only those rows.
 */
import assert from "node:assert/strict";
// @ts-expect-error shared .mjs guard without type declarations
import { assertSafeTestDatabase } from "./lib/test-database-guard.mjs";

let target: { url: string };
try {
  target = assertSafeTestDatabase(process.env);
} catch {
  console.log("SKIPPED booking calendar integration: separate verified TEST database and write flags unavailable (not reported as PASS).");
  process.exit(process.argv.includes("--strict") ? 2 : 0);
}
process.env.DATABASE_URL = target!.url;

const { db } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const { readBookingCalendar } = await import("../src/server/booking-calendar");
const { calendarViewDays, summarizeCalendarDay, summarizeCalendarRange, filterCalendarCards } = await import("../src/lib/booking-calendar");

const run = `cal${Date.now().toString(36)}`;
const one = async (query: any) => ((await db.execute(query)) as any).rows[0];
const n = (value: unknown) => Number(value);
const name = (label: string) => `${run} ${label}`;
const DAY = "2031-03-13"; // A Thursday.
const NEXT = "2031-03-14";
const OUTSIDE = "2031-04-20";

// ── Seed (unique to this run) ────────────────────────────────────────────
const staff = await one(sql`INSERT INTO staff (username, password_hash, full_name, role, permissions, is_active) VALUES (${`${run}-crew`}, 'x', ${name("موظف")}, 'staff', '[]', true) RETURNING id`);
const service = await one(sql`INSERT INTO services (name, name_ar, type) VALUES (${`${run} photo`}, ${name("تصوير")}, 'photography') RETURNING id`);
const product = await one(sql`INSERT INTO products (name, name_ar, price, stock) VALUES (${`${run}-chair`}, ${name("كرسي")}, 100, 5) RETURNING id`);
const serviceOrder = async (label: string, date: string | null, fields: Record<string, unknown>, extra: { status?: string; archived?: boolean } = {}) =>
  n((await one(sql`
    INSERT INTO service_orders (service_id, customer_name, phone, event_date, event_location, status, custom_fields, archived_at, tracking_code)
    VALUES (${n(service.id)}, ${name(label)}, '07700000001', ${date}, 'قاعة', ${extra.status ?? "confirmed"}, ${JSON.stringify(fields)}::jsonb, ${extra.archived ? sql`now()` : null}, ${`AJN-1234-${run.toUpperCase()}${label.length}`.slice(0, 40)})
    RETURNING id`)).id);
const kosha = async (label: string, date: string, fields: { time?: string; mode?: string | null; details?: Record<string, unknown>; status?: string; staffId?: number }) =>
  n((await one(sql`
    INSERT INTO kosha_bookings (customer_name, phone, event_date, event_time, transportation_mode, booking_details, status, hall_location, assigned_staff_id)
    VALUES (${name(label)}, '07700000002', ${date}, ${fields.time ?? null}, ${fields.mode ?? null}, ${JSON.stringify(fields.details ?? {})}::jsonb, ${fields.status ?? "confirmed"}, 'قاعة الكوشة', ${fields.staffId ?? null})
    RETURNING id`)).id);

const mixed = await serviceOrder("مختلط", DAY, {
  eventTime: "19:00",
  hallName: "قاعة أحمد",
  departments: ["kosha"],
  bookingCenterServices: [{ type: "kosha" }, { type: "kosha" }, { type: "photography" }, { type: "sound" }],
  bookingStaffAssignments: [{ id: n(staff.id), name: name("موظف") }],
});
const byServiceType = await serviceOrder("نوع الخدمة", DAY, {});
const cancelledOrder = await serviceOrder("ملغي", DAY, { departments: ["kosha"] }, { status: "cancelled" });
const archivedOrder = await serviceOrder("مؤرشف", DAY, { departments: ["kosha"] }, { archived: true });
const outsideOrder = await serviceOrder("خارج الفترة", OUTSIDE, { departments: ["kosha"] });
const withWindow = await serviceOrder("فترة تشغيل", NEXT, {
  departments: ["sound"],
  eventTime: "10:00",
  bookingOperations: {
    transportation: { mode: "ajn", fee: 5000 },
    resourceWindow: { preparationStart: `${NEXT}T12:00:00+03:00`, eventStart: `${NEXT}T17:00:00+03:00`, eventEnd: `${NEXT}T22:30:00+03:00`, returnEnd: `${NEXT}T23:30:00+03:00` },
  },
});
const reschedulePending = await serviceOrder("طلب تغيير موعد", DAY, { departments: ["gifts"] }, { status: "reschedule_pending" });

const koshaAjn = await kosha("كوشة ونقل", DAY, { time: "7:30 م", mode: "ajn", staffId: n(staff.id) });
const koshaCustomer = await kosha("كوشة بلا نقل", DAY, { time: "بعد المغرب", mode: "customer" });
const koshaSound = await kosha("كوشة وصوت", NEXT, { details: { bookingCenterServices: [{ type: "sound" }] } });
const koshaCancelled = await kosha("كوشة ملغاة", DAY, { status: "cancelled" });

const standalonePhoto = n((await one(sql`INSERT INTO photography_events (client_token, groom_name, event_date, event_start_time, event_end_time, location, status) VALUES (${`${run}-p1`}, ${name("تصوير مستقل")}, ${DAY}, '16:00', '20:00', 'حديقة', 'active') RETURNING id`)).id);
await db.execute(sql`INSERT INTO photography_events (client_token, booking_id, groom_name, event_date, status) VALUES (${`${run}-p2`}, ${mixed}, ${name("تصوير مرتبط")}, ${DAY}, 'active')`);
await db.execute(sql`INSERT INTO photography_events (client_token, groom_name, event_date, status) VALUES (${`${run}-p3`}, ${name("تصوير مؤرشف")}, ${DAY}, 'archived')`);

const dated = n((await one(sql`INSERT INTO graduation_groups (group_no, join_token, title, representative_phone, university, event_date) VALUES (${`${run}-G1`}, ${`${run}-j1`}, ${name("جامعة بغداد")}, '07700000003', 'بغداد', ${DAY}) RETURNING id`)).id);
const undated = n((await one(sql`INSERT INTO graduation_groups (group_no, join_token, title) VALUES (${`${run}-G2`}, ${`${run}-j2`}, ${name("مجموعة بلا موعد")}) RETURNING id`)).id);
const graduation = async (no: string, label: string, groupId: number | null, due: string, status = "confirmed") =>
  n((await one(sql`INSERT INTO graduation_orders (order_no, qr_token, customer_name, phone, group_id, due_date, status) VALUES (${`${run}-${no}`}, ${`${run}-q-${no}`}, ${name(label)}, '07700000004', ${groupId}, ${due}, ${status}) RETURNING id`)).id);
for (const no of ["D1", "D2", "D3"]) await graduation(no, "طالب مجموعة", dated, DAY);
await graduation("U1", "طالب بلا موعد", undated, DAY);
await graduation("U2", "طالب بلا موعد", undated, DAY);
await graduation("U3", "طالب ملغي", undated, DAY, "cancelled");
const individual = await graduation("I1", "طالب فردي", null, DAY);

const catering = n((await one(sql`INSERT INTO catering_orders (order_no, customer_name, customer_phone, occasion, event_date, status) VALUES (${`${run}-C1`}, ${name("ضيافة")}, '07700000005', 'عرس', ${DAY}, 'confirmed') RETURNING id`)).id);
await db.execute(sql`INSERT INTO catering_orders (order_no, customer_name, event_date, status) VALUES (${`${run}-C2`}, ${name("مسودة ضيافة")}, ${DAY}, 'draft')`);

const rental = n((await one(sql`INSERT INTO rental_orders (order_no, product_id, customer_name, phone, start_date, end_date, status) VALUES (${`${run}-R1`}, ${n(product.id)}, ${name("إيجار")}, '07700000006', ${DAY}, ${NEXT}, 'active') RETURNING id`)).id);
await db.execute(sql`INSERT INTO rental_orders (order_no, product_id, customer_name, phone, start_date, end_date, status) VALUES (${`${run}-R2`}, ${n(product.id)}, ${name("إيجار من المتجر")}, '07700000006', ${DAY}, ${NEXT}, 'active')`);

const storeOrder = async (code: string, label: string, createdAt: string) =>
  n((await one(sql`INSERT INTO orders (tracking_code, customer_name, customer_phone, total, created_at) VALUES (${`${run}-${code}`}, ${name(label)}, '07700000007', 1000, ${createdAt}::timestamp) RETURNING id`)).id);
// 21:30 UTC on the 12th is 00:30 on the 13th in Baghdad.
const storeBoundary = await storeOrder("S1", "طلب متجر", "2031-03-12 21:30:00");
const storeLinked = await storeOrder("S2", "طلب متجر مرتبط", "2031-03-13 09:00:00");
await serviceOrder("حجز من المتجر", OUTSIDE, { storeOrderId: storeLinked });
await storeOrder("R2", "طلب إيجار", "2031-03-13 10:00:00");

// ── Read the week ────────────────────────────────────────────────────────
const days = calendarViewDays("week", DAY);
assert.deepEqual([days[0], days[6]], ["2031-03-08", "2031-03-14"]);
const result = await readBookingCalendar(db as any, { from: days[0], to: days[6] });
const events = result.events.filter((event) => event.customerName.startsWith(run));
const byKey = new Map(events.map((event) => [event.key, event]));
const get = (key: string) => {
  const event = byKey.get(key);
  assert.ok(event, `missing event ${key}`);
  return event!;
};
assert.equal(result.truncated, false);
assert.equal(result.range.from, days[0]);
assert.ok(result.departments.some((department) => department.key === "catering"), "departments come back with the data");

// Only the visible range; archived rows never appear.
assert.ok(!byKey.has(`service-${outsideOrder}`), "a booking outside the range is not fetched");
assert.ok(!byKey.has(`service-${archivedOrder}`), "archived bookings stay out");

// Multi-department booking: one record, every department, service units kept apart.
const mixedEvent = get(`service-${mixed}`);
assert.deepEqual(mixedEvent.departments, ["kosha", "photography", "sound"]);
assert.equal(mixedEvent.departmentUnits.kosha, 2);
assert.equal(mixedEvent.startTime, "19:00");
assert.equal(mixedEvent.location, "قاعة أحمد");
assert.match(mixedEvent.number, /^B-\d+/, "the short number, not the secret tracking code");
assert.equal(mixedEvent.detailHref, `/admin/bookings/service/${mixed}`, "opens the original booking");
assert.equal(mixedEvent.workspaceHref, `/admin/bookings/service/${mixed}?tab=tasks`, "opens the original workspace");
assert.deepEqual(mixedEvent.staff, [{ id: n(staff.id), name: name("موظف") }]);

// No stamped department: same classification as the Booking Center.
assert.deepEqual(get(`service-${byServiceType}`).departments, ["photography"]);

// Transport counts when AJN carries it, and the explicit operating period sets the time.
const windowed = get(`service-${withWindow}`);
assert.deepEqual(windowed.departments, ["sound", "transportation"]);
assert.equal(windowed.startTime, "17:00", "the operating period beats the saved event time");
assert.equal(windowed.endTime, "22:30");
assert.equal(windowed.day, NEXT);
assert.deepEqual(get(`kosha-${koshaAjn}`).departments, ["kosha", "transportation"]);
assert.equal(get(`kosha-${koshaAjn}`).startTime, "19:30");
assert.deepEqual(get(`kosha-${koshaAjn}`).staff, [{ id: n(staff.id), name: name("موظف") }]);
assert.deepEqual(get(`kosha-${koshaCustomer}`).departments, ["kosha"], "customer transport is not an AJN transport booking");
assert.equal(get(`kosha-${koshaCustomer}`).startTime, null);
assert.equal(get(`kosha-${koshaCustomer}`).timeNote, "بعد المغرب", "free-text time is shown as saved");
assert.deepEqual(get(`kosha-${koshaSound}`).departments, ["kosha", "sound"]);

// A rescheduled-pending booking stays on its date with its own status.
assert.equal(get(`service-${reschedulePending}`).status, "reschedule_pending");

// Photography: a standalone event is a booking; one linked to a service order is that same booking.
assert.deepEqual(get(`photography-${standalonePhoto}`).departments, ["photography"]);
assert.equal(get(`photography-${standalonePhoto}`).startTime, "16:00");
assert.equal(get(`photography-${standalonePhoto}`).endTime, "20:00");
assert.ok(!events.some((event) => event.customerName === name("تصوير مرتبط")), "a linked photography event is not counted twice");
assert.ok(!events.some((event) => event.customerName === name("تصوير مؤرشف")));

// Graduation: a group is one booking, whatever its size.
const group = get(`graduation_group-${dated}`);
assert.match(group.title, /3 طالب/);
assert.deepEqual(group.departments, ["graduation"]);
assert.ok(!events.some((event) => event.customerName === name("طالب مجموعة")), "students of a dated group are not separate bookings");
const undatedGroup = get(`graduation_group-${undated}-${DAY}`);
assert.match(undatedGroup.title, /2 طالب/, "cancelled students are left out");
assert.equal(undatedGroup.timeNote, "موعد التسليم");
assert.equal(get(`graduation-${individual}`).timeNote, "موعد التسليم");
assert.equal(get(`graduation-${individual}`).detailHref, `/admin/graduation/orders?order=${individual}`);

// Catering and rental: real records, drafts and store-linked rentals left out.
assert.deepEqual(get(`catering-${catering}`).departments, ["catering"]);
assert.equal(get(`catering-${catering}`).title, "عرس");
assert.ok(!events.some((event) => event.customerName === name("مسودة ضيافة")), "a draft is not a booking");
assert.deepEqual(get(`rental-${rental}`).departments, ["rental"]);
assert.ok(!events.some((event) => event.customerName === name("إيجار من المتجر")), "a rental that is a store order is listed once");

// Store orders: on the Baghdad day, not bookings, and not when they became a service order.
const store = get(`order-${storeBoundary}`);
assert.equal(store.day, DAY, "00:30 Baghdad belongs to the new day, not the UTC one");
assert.equal(store.countsAsBooking, false);
assert.deepEqual(store.departments, []);
assert.ok(!byKey.has(`order-${storeLinked}`), "a store order that became a booking is not listed twice");

// ── The counters a user sees for that Thursday ───────────────────────────
const summary = summarizeCalendarDay(DAY, events);
const counts = Object.fromEntries(summary.departments.map((row) => [row.key, row.bookings]));
assert.deepEqual(counts, { kosha: 3, photography: 3, sound: 1, transportation: 1, graduation: 3, gifts: 1, catering: 1, rental: 1 });
// mixed, byServiceType, reschedulePending, koshaAjn, koshaCustomer, photo, group, undated group, individual, catering, rental.
assert.equal(summary.total, 11, "each booking counts once in the day total");
assert.equal(summary.departments.find((row) => row.key === "kosha")!.units, 4, "two Kosha lines on one booking are units, not bookings");
assert.equal(summary.storeOrders, 2);
assert.equal(summary.staffAssignments, 2);

// Cancelled: out of the counters, available when asked for.
assert.ok(byKey.has(`service-${cancelledOrder}`) && byKey.has(`kosha-${koshaCancelled}`), "cancelled rows reach the status filter");
const cancelledSummary = summarizeCalendarDay(DAY, events, "ملغي");
assert.equal(cancelledSummary.total, 2);
assert.deepEqual(Object.fromEntries(cancelledSummary.departments.map((row) => [row.key, row.bookings])), { kosha: 2 });

// Week totals span days; the department filter narrows cards without touching totals.
const week = summarizeCalendarRange(days, events);
assert.equal(week.total, 13, "the Thursday's 11 plus the two on Friday");
const koshaCards = filterCalendarCards(events.filter((event) => event.day === DAY), { status: "", department: "kosha", employee: null, search: "", showStoreOrders: false });
assert.equal(koshaCards.length, 3);
assert.equal(summarizeCalendarDay(DAY, events).total, 11);

// Rescheduling moves the booking; cancelling removes it: counters follow the record.
await db.execute(sql`UPDATE service_orders SET event_date = ${NEXT} WHERE id = ${byServiceType}`);
await db.execute(sql`UPDATE kosha_bookings SET status = 'cancelled' WHERE id = ${koshaCustomer}`);
const after = (await readBookingCalendar(db as any, { from: days[0], to: days[6] })).events.filter((event) => event.customerName.startsWith(run));
assert.equal(summarizeCalendarDay(DAY, after).total, 9);
assert.equal(after.find((event) => event.key === `service-${byServiceType}`)!.day, NEXT);

// The route's optional filters keep their meaning.
const onlyConfirmed = await readBookingCalendar(db as any, { from: days[0], to: days[6], status: "reschedule_pending" });
assert.ok(onlyConfirmed.events.every((event) => event.status === "reschedule_pending"));
const onlyService = await readBookingCalendar(db as any, { from: days[0], to: days[6], serviceId: n(service.id) });
assert.ok(onlyService.events.filter((event) => event.kind === "service").every((event) => event.serviceId === n(service.id)));

console.log(`PASS booking calendar integration (${run}): every source on its real date, one count per booking and department, service units apart, cancelled and archived rules, linked records never doubled, Baghdad day boundary, counters follow reschedule and cancel`);
process.exit(0);
