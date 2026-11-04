import assert from "node:assert/strict";
import { evaluateResourceConflict } from "../src/lib/booking-resource-conflicts";
import { quantityPeriodAvailability } from "../src/lib/quantity-asset-period";
import { lineOutstanding, normalizeQuantityLine } from "../src/lib/quantity-assets";

const interval = { start: "2026-11-03T10:00:00+03:00", end: "2026-11-04T10:00:00+03:00" };
const hold = { id: "rental:1", booking: { source: "rental" as const, id: 1 }, resource: "asset:10", quantity: 2, status: "reserved" as const, interval };
const common = { resource: "asset:10", required: 1, stock: 2, stockBasis: "total_serviceable" as const, interval };
assert.equal(evaluateResourceConflict({ ...common, booking: { source: "service", id: 1 }, reservations: [hold] }).status, "shortage", "an event sees a rental with the same numeric ID");
assert.equal(evaluateResourceConflict({ ...common, booking: hold.booking, reservations: [{ ...hold, booking: { source: "kosha", id: 1 } }] }).status, "shortage", "a rental sees existing event holds");
assert.equal(evaluateResourceConflict({ ...common, booking: hold.booking, reservations: [hold] }).available, 2, "a rental excludes only its own source identity");
const line = { trackingMode: "quantity", quantity: 2, reservedQty: 2, checkedOutQty: 2, returnedGoodQty: 0, pendingInspectionQty: 2, stage: "inspection" };
assert.equal(lineOutstanding(normalizeQuantityLine(line)), 0, "quarantined returns are physically back, never fake losses or available stock");
const availability = quantityPeriodAvailability({ booking: { source: "service", id: 2 }, buckets: { inWarehouse: 2, checkedOut: 0, damaged: 0, missing: 0, maintenance: 2 }, interval, otherHolds: 0,
  rows: [{ source: "rental_order", bookingId: 1, day: "2026-11-03", status: "confirmed", line: { ...line, checkedOutQty: 0, pendingInspectionQty: 0, stage: "reserved" }, interval }] });
assert.equal(availability.availability?.available, 0, "quantity scheduling includes original rental lines and excludes maintenance");
console.log("PASS equipment rental bidirectional conflict identity, quarantine and quantity commitments");
