import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executedTransportRevenue, transportTotalDelta } from "../src/lib/booking-transport";

// Booking transport reaches the vehicle accounts from one place: the booking
// centre's «خدمة النقل» card (kosha bookings through their own columns, service
// orders through bookingOperations), with the AJN fee inside the booking total.

// 1. The fee joins the total exactly once.
assert.equal(transportTotalDelta(null, 25_000), 25_000, "new AJN transport adds its fee");
assert.equal(transportTotalDelta({ mode: "ajn", fee: 25_000 }, 25_000), 25_000, "a fee saved «للعلم» was never in the total: added now, once");
assert.equal(transportTotalDelta({ mode: "ajn", fee: 25_000, inTotal: true }, 25_000), 0, "re-saving the same fee changes nothing");
assert.equal(transportTotalDelta({ mode: "ajn", fee: 25_000, inTotal: true }, 30_000), 5_000, "a new fee adds only the difference");
assert.equal(transportTotalDelta({ mode: "ajn", fee: 25_000, inTotal: true }, 0), -25_000, "removing transport takes the fee back out");
assert.equal(transportTotalDelta({ mode: "customer", fee: 0, inTotal: false }, 0), 0);
assert.equal(transportTotalDelta({ mode: "ajn", fee: 25_000 }, 0), 0, "removing an informational fee leaves the total alone");

// 2. The vehicle is credited with the collected share only.
assert.equal(executedTransportRevenue(25_000, 500_000, 1_250_000), 10_000, "40% paid → 40% of the fee");
assert.equal(executedTransportRevenue(25_000, 1_300_000, 1_250_000), 25_000, "never more than the fee");
assert.equal(executedTransportRevenue(25_000, 0, 1_250_000), 0);
assert.equal(executedTransportRevenue(25_000, 100, 0), 0, "an unpriced booking credits nothing");

const api = readFileSync("src/server/api.ts", "utf8");
const ui = readFileSync("src/views/admin/booking-operations-workspace.tsx", "utf8");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end: ${end}`);
  return text.slice(from, to);
};

// 3. Booking-centre endpoint: service orders only, vehicle required, locked total update.
const endpoint = between(api, 'if (resource === "transportation") {', 'if (resource === "group-attendees") {');
assert.match(endpoint, /reference\.source === "kosha"\)\s*return error\("نقل حجز الكوشة يُحفظ في حجز الكوشة نفسه/);
assert.match(endpoint, /if \(fee <= 0\) return error\("أجرة النقل مطلوبة/);
assert.match(endpoint, /if \(!d\.vehicleId\) return error\("اختر سيارة للنقل بواسطة AJN"/);
assert.match(endpoint, /from service_orders where id = \$\{reference\.id\} for update/);
assert.match(endpoint, /transportVehicleBookedElsewhere\(tx, \{ vehicleId: d\.vehicleId/);
assert.match(endpoint, /const delta = transportTotalDelta\(\(live\.operations as any\)\.transportation \?\? null, fee\);/);
assert.match(endpoint, /if \(!canEditOrderFinancials\(auth\)\)\s*throw new CheckoutError/);
assert.match(endpoint, /deposit > after\)\s*throw new CheckoutError/, "paid can never exceed the new total");
assert.match(endpoint, /const payment = paymentSummary\(after, deposit\);/);
assert.match(endpoint, /inTotal: d\.mode === "ajn",/);
assert.match(endpoint, /columnMode\s*\?\s*\{/, "kosha bookings read their own transport columns first");

// 4. Kosha booking form: same-day clash with service orders; the old card copy is cleared.
const koshaPatch = between(api, "const transportationRequested = [", "const sameStringList = ");
assert.match(koshaPatch, /transportVehicleBookedElsewhere\(db, \{ vehicleId: vehicle\.id, eventDate: eventDateForConflict, exclude: \{ source: "kosha", id \} \}\)/);
assert.match(koshaPatch, /bookingOperations = \{ \.\.\.\(\(update\.bookingDetails as any\)\.bookingOperations \?\? existingOps\), transportation: null \}/);

// 5. Vehicle accounts count service-order transport too.
const vehicleList = between(api, 'if (section === "vehicles") {', 'if (method === "POST") {');
assert.match(vehicleList, /as service_trip_count/);
assert.match(vehicleList, /as service_transportation_revenue/);
assert.match(vehicleList, /tripCount: Number\(row\.trip_count \?\? 0\) \+ Number\(row\.service_trip_count \?\? 0\)/);
const vehicleDetail = between(api, 'parts[2] === "financial" && method === "GET"', 'parts[2] === "expenses" && method === "POST"');
assert.match(vehicleDetail, /const serviceTripRows/);
assert.match(vehicleDetail, /source: "service" as any/);
assert.match(vehicleDetail, /executedTransportRevenue\(fee, paid, total\)/);

// 6. The card: vehicle + driver, kosha saved on the kosha booking, legacy fee explained.
const card = between(ui, "function TransportationCard(", "function OperationsSummary(");
assert.match(card, /<select value=\{vehicleId\}/);
assert.match(card, /السائق \(اختياري\)/);
assert.match(card, /هذه الأجرة مسجّلة للعلم فقط/);
assert.doesNotMatch(card, /للعلم\)/, "the fee is no longer labelled informational");
assert.match(ui, /booking\.source === "kosha"\s*\? adminFetch\(`\/admin\/kosha-bookings\/\$\{booking\.id\}\?source=kosha`, \{ method: "PATCH"/);
for (const page of ["src/views/admin/enterprise.tsx", "src/views/admin/vehicles.tsx"])
  assert.match(readFileSync(page, "utf8"), /\/admin\/bookings\/\$\{(trip|row)\.source \?\? "kosha"\}\//, `${page} opens the trip's own booking`);

// 7. Vehicle expenses may link a service-order trip once migration 0128 is applied.
const migration = readFileSync("lib/db/migrations/0128_vehicle_expense_service_orders.sql", "utf8");
assert.match(migration, /ADD COLUMN IF NOT EXISTS "service_order_id" integer;/);
assert.match(migration, /FOREIGN KEY \("service_order_id"\) REFERENCES "service_orders" \("id"\) ON DELETE RESTRICT/);
assert.match(migration, /CHECK \("booking_id" IS NULL OR "service_order_id" IS NULL\)/);
assert.match(migration, /CREATE INDEX IF NOT EXISTS "vehicle_expenses_service_order_idx"/);
assert.doesNotMatch(migration, /(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE|RENAME|ALTER\s+COLUMN)/i, "additive only");
assert.doesNotMatch(readFileSync("lib/db/src/schema/vehicle-finance.ts", "utf8"), /service_order_id/, "the ORM never selects the column before the migration exists");
const expensePost = between(api, 'parts[2] === "expenses" && method === "POST" && !parts[3]', 'parts[2] === "details" && method === "GET"');
assert.match(expensePost, /if \(!\(await vehicleExpenseServiceLinkReady\(\)\)\)\s*return error\("ربط مصروف السيارة بحجز خدمة يحتاج تطبيق ترقية قاعدة البيانات 0128 أولاً", 409\)/);
assert.match(expensePost, /Number\(order\.transportation\?\.vehicleId\) !== vehicleId/);
assert.match(expensePost, /update vehicle_expenses set service_order_id = \$\{data\.serviceOrderId\} where id = \$\{expense\.id\}/);
assert.match(expensePost, /if \(data\.bookingId && data\.serviceOrderId\) return error/);
assert.match(api, /const parsed = VehicleExpenseSchema\.extend\(\{\s*vehicleId:/, "the staff request keeps its own schema");
assert.match(vehicleDetail, /tripExpense: money\(tripExpenseOf\(\(expense\) => serviceOrderByExpense\.get\(expense\.id\) === Number\(order\.id\)\)\)/);
assert.match(vehicleDetail, /capabilities: \{ serviceExpenseLink \}/);
const enterprise = readFileSync("src/views/admin/enterprise.tsx", "utf8");
assert.match(enterprise, /value=\{`\$\{trip\.source \?\? "kosha"\}:\$\{trip\.bookingId\}`\}/, "the picker names the booking kind");
assert.match(enterprise, /serviceOrderId: expense\.bookingId\.startsWith\("service:"\)/);
assert.match(enterprise, /\(trip\.source \?\? "kosha"\) === "kosha" \|\| data\.capabilities\?\.serviceExpenseLink/, "service trips are offered only once linking works");

// 8. The card offers the vehicle «إسناد موارد النقل» already sent.
assert.match(endpoint, /dispatchVehicle: dispatched \?/);
assert.match(card, /السيارة المسندة لهذا الحجز من «إسناد موارد النقل»/);
assert.match(card, /value\.mode === "ajn" && dispatchVehicle \? String\(dispatchVehicle\.id\)/);

// 9. The operating period is optional: without one the booking holds its event day.
assert.doesNotMatch(card, /periodMissing|فترة تشغيل/, "the transport card never demands an operating period");
assert.match(ui, /<BookingResourceWindowPanel base=\{base\} queryKey=\{queryKey\} onSaved=\{onSaved\} optional \/>/);
const span = readFileSync("src/lib/booking-resource-window.ts", "utf8");
assert.match(span, /if\(operations\.resourceWindow!=null\|\|!day\)return null;/, "a saved but invalid period is never replaced by the day");
const { bookingResourceSpan } = await import("../src/lib/booking-resource-window");
assert.deepEqual(bookingResourceSpan({}, "2026-10-31"), { start: "2026-10-31T00:00:00+03:00", end: "2026-11-01T00:00:00+03:00" });
assert.equal(bookingResourceSpan({}, null), null);
assert.equal(bookingResourceSpan({ resourceWindow: { eventStart: "bad" } }, "2026-10-31"), null);
const { resourceTimingProblem } = await import("../src/server/booking-resource-availability");
assert.equal(resourceTimingProblem({ operations: {}, eventDate: "2026-10-31" }), null);
assert.match(String(resourceTimingProblem({ operations: {}, eventDate: null })), /تاريخ الحجز/);
// Photography too: the event may be created and timed without a period.
const photoForm = readFileSync("src/views/staff/photography/index.tsx", "utf8");
assert.match(photoForm, /if \(Object\.values\(period\)\.some\(Boolean\)\) \{/, "an empty photography period is allowed");
assert.match(photoForm, /<BookingResourceWindowInputs draft=\{period\} disabled=\{busy\} required=\{false\}/);
assert.match(photoForm, /onSaved=\{\(\) => void loadDetail\(\)\} optional \/>/);
assert.match(api, /const resourceWindow=data\.resourceWindow==null\?null:parseBookingResourceWindow\(data\.resourceWindow,data\.eventDate\)/);
assert.match(api, /patch\.eventTime!==live\.eventTime&&before\.resourceWindow&&patch\.eventTime!==/, "a shoot time is only held to a period that exists");

// Trip cost counts executed expenses only, like the vehicle's executed-expense total.
assert.match(vehicleDetail, /!\["executed", "partially_reversed", "reversed"\]\.includes\(expense\.status\)\) return sum;/);

// 10. Vehicle loading sees the card's vehicle on service orders; an empty team is explained.
const loading = readFileSync("src/server/booking-loading.ts", "utf8");
assert.match(loading, /coalesce\(CASE WHEN b\.custom_fields->'bookingOperations'->'transportation'->>'mode'='ajn' THEN nullif\(b\.custom_fields->'bookingOperations'->'transportation'->>'vehicleId',''\)::integer END,d\.vehicle_id\) AS vehicle_id/);
assert.match(loading, /const teamMissing=!record&&facts\.staff\.length<2;/);
assert.match(loading, /عيّن فريق الحجز من «فريق الحجز» أعلى الصفحة/);

console.log("PASS  booking transport: fee in total once, vehicle required, kosha via its booking, vehicle accounts include service orders");
console.log("PASS  vehicle expenses link service-order trips after migration 0128; the card offers the dispatched vehicle");
