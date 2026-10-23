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

console.log("PASS  booking transport: fee in total once, vehicle required, kosha via its booking, vehicle accounts include service orders");
