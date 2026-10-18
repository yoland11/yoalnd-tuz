import assert from "node:assert/strict";
import { existsSync } from "node:fs";

// Missing implementation is a feature failure, not an import/loader accident.
assert.ok(existsSync("src/lib/booking-daily-operations.ts"), "daily operations model must exist");
const { dailyOperationsRange, projectDailyBooking, buildDailyOperations, parseDailyOperationsFilters } = await import("../src/lib/booking-daily-operations");

// Break caught: using UTC/local host midnight changes the Iraqi operation date.
assert.deepEqual(dailyOperationsRange("today", new Date("2026-10-18T22:30:00Z")), { from: "2026-10-19", to: "2026-10-20" });
assert.deepEqual(dailyOperationsRange("tomorrow", new Date("2026-12-31T12:00:00Z")), { from: "2027-01-01", to: "2027-01-02" });
assert.deepEqual(dailyOperationsRange("week", new Date("2026-10-18T12:00:00Z")), { from: "2026-10-18", to: "2026-10-25" });
assert.throws(() => parseDailyOperationsFilters(new URLSearchParams("period=year")), /الفترة/);
assert.throws(() => parseDailyOperationsFilters(new URLSearchParams("employee=-1")), /الموظف/);

const base = { source: "kosha" as const, id: 12, number: "AJN-KOSHA-0012", customerName: "أحمد", eventDate: "2026-10-18", eventTime: "18:00", location: "بغداد", status: "confirmed", category: "kosha", details: {}, assignedStaffId: 8, vehicleId: null, vehicleName: null, transportationMode: "customer", crewName: null, overdueTasks: 0, openTasks: 0, products: [] };
const booking = projectDailyBooking(base);
assert.equal(booking.href, "/admin/bookings/kosha/12");
assert.equal(projectDailyBooking({ ...base, source: "service" }).href, "/admin/bookings/service/12");
assert.notEqual(booking.key, projectDailyBooking({ ...base, source: "service" }).key);
assert.notEqual(booking.readiness.status, "ready", "empty equipment is not proof requirements were reviewed");
assert.ok(booking.readiness.checks.some((c: any) => c.id === "conflicts" && c.state === "unknown"));
assert.ok(!booking.readiness.checks.some((c: any) => /paid|payment|balance|finance/.test(c.id)));
assert.equal(booking.readiness.checks.find((c: any) => c.id === "vehicle")?.state, "pass", "customer transport does not require an AJN vehicle");
assert.equal(projectDailyBooking({ ...base, transportationMode: "ajn" }).readiness.checks.find((c: any) => c.id === "vehicle")?.state, "fail");

const prepared = projectDailyBooking({ ...base, products: [{ productId: 4, variantId: null, quantity: 2, status: "reserved" }], details: { bookingOperations: { productMeta: { "4:0": { prep: { status: "ready" } } }, assets: [{ productId: 5, quantity: 10, trackingMode: "quantity", preparedQty: 3, checkedOutQty: 3, returnedGoodQty: 1, stage: "out", problem: "damaged" }] } } });
assert.equal(prepared.preparation.total, 2);
assert.equal(prepared.preparation.prepared, 1, "partial quantity asset is not ready");
assert.equal(prepared.preparation.problems, 1);
assert.ok(prepared.issues.some((i: any) => i.kind === "equipment"));

// Review regression 1: manual operational requirements are not optional notes.
const manual = projectDailyBooking({ ...base, products: [{ productId: 4, variantId: null, quantity: 2, status: "reserved" }], details: { bookingOperations: { manualPrepItems: [{ id: "install", infoOnly: false }, { id: "note", infoOnly: true }], productMeta: { "4:0": { prep: { status: "ready" } } } } } });
assert.equal(manual.preparation.total, 2, "manual installation requirement must remain in preparation denominator");
assert.equal(manual.preparation.percentage, 50);
assert.equal(manual.readiness.checks.find((c: any) => c.id === "preparation")?.state, "fail");
// Review regression 2: a lifecycle pick never erases a preparation damage flag.
const damaged = projectDailyBooking({ ...base, details: { bookingOperations: { assets: [{ productId: 9, quantity: 1, stage: "picked" }], productMeta: { "asset:9": { prep: { status: "damaged" } } } } } });
assert.equal(damaged.preparation.problems, 1);
assert.equal(damaged.preparation.prepared, 0);
assert.equal(damaged.readiness.checks.find((c: any) => c.id === "preparation")?.state, "fail");
// Review regression 3: workspace transport wins over legacy native columns.
for (const source of ["kosha", "service"] as const) {
  const customerTransport = projectDailyBooking({ ...base, source, transportationMode: "ajn", details: { bookingOperations: { transportation: { mode: "customer", fee: 0 } } } });
  assert.equal(customerTransport.readiness.checks.find((c: any) => c.id === "vehicle")?.state, "pass", `${source}: workspace customer transport needs no AJN vehicle`);
  const ajnTransport = projectDailyBooking({ ...base, source, transportationMode: "customer", details: { bookingOperations: { transportation: { mode: "ajn", fee: 100 } } } });
  assert.equal(ajnTransport.readiness.checks.find((c: any) => c.id === "vehicle")?.state, "fail", `${source}: workspace AJN transport needs a vehicle`);
}

const result = buildDailyOperations([base, { ...base, source: "service", id: 12, assignedStaffId: 9, overdueTasks: 2 }], { period: "today", employee: 8, search: "", category: "all", status: "all", vehicle: null, location: "" }, false, new Date("2026-10-18T12:00:00Z"));
assert.equal(result.summary.bookings, 1, "employee filter precedes KPIs");
assert.equal(result.summary.overdueTasks, 0, "filtered-out booking must not enter KPIs");
assert.equal(result.summary.conflicts, null, "unverified conflicts must not be reported as zero");
assert.equal(buildDailyOperations([base], { ...result.filters, search: "لا يوجد" }, true, new Date()).truncated, true);
console.log("PASS daily operations dates, filters, original identities, honest readiness and KPIs");
