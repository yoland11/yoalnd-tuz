import assert from "node:assert/strict";
import { readTransportPlan, validateTransportPlan, transportPlanFee, transportTripReference } from "../src/lib/booking-transport-plan";

// Removing the legacy charge or summing an overall charge per trip must fail.
const input = { source: "kosha" as const, id: 7, bookingNumber: "AJN-KOSHA-0007", legacy: { mode: "ajn", fee: 50000, vehicleId: 3, driverId: 8, note: "ملاحظة نقل" }, storedPlan: null };
const legacy = readTransportPlan(input);
assert.equal(legacy.revision, 0);
assert.equal(legacy.legacy, true);
assert.equal(legacy.trips.length, 1);
assert.equal(legacy.trips[0].id, "legacy-1");
assert.equal(legacy.trips[0].vehicleId, 3);
assert.equal(legacy.trips[0].driverId, 8);
assert.equal(legacy.trips[0].departureTime, null, "event time is not an invented departure");
assert.equal(legacy.trips[0].origin, null);
assert.equal(legacy.trips[0].notes, "ملاحظة نقل");
assert.equal(transportPlanFee(legacy), 50000);
assert.equal(transportTripReference(input.bookingNumber, 1), "AJN-KOSHA-0007-T01");
assert.deepEqual(readTransportPlan({ ...input, legacy: null }).trips, []);
assert.deepEqual(readTransportPlan({ ...input, legacy: { mode: "customer", fee: 0 } }).trips, []);

const trip = { ...legacy.trips[0], customerCharge: 30000 };
const perTrip = { version: 1, revision: 1, feeMode: "per_trip", overallCharge: null, trips: [trip, { ...trip, id: "trip-2", sequence: 2, vehicleId: 4, customerCharge: 20000 }] };
assert.equal(transportPlanFee(validateTransportPlan(perTrip)), 50000);
const overall = { ...perTrip, feeMode: "overall", overallCharge: 50000, trips: perTrip.trips.map(t => ({ ...t, customerCharge: null })) };
assert.equal(transportPlanFee(validateTransportPlan(overall)), 50000, "two trips are not 100,000");
const loaded = readTransportPlan({ ...input, storedPlan: perTrip });
assert.equal(loaded.legacy, false);
assert.equal(loaded.trips[1].sequence, 2);
assert.equal(loaded.revision, 1);
const reordered = validateTransportPlan({ ...perTrip, trips: [...perTrip.trips].reverse() });
assert.equal(transportTripReference(input.bookingNumber, reordered.trips[0].sequence), "AJN-KOSHA-0007-T02");

for (const bad of [[], "bad", {}, { ...perTrip, version: 2 }, { ...perTrip, revision: -1 }, { ...perTrip, feeMode: "unknown" }, { ...perTrip, trips: [trip, trip] }, { ...perTrip, trips: [trip, { ...trip, id: "trip-2" }] }, { ...perTrip, trips: Array.from({length:51}, (_,i) => ({...trip,id:`t-${i}`,sequence:i+1})) }]) {
  assert.throws(() => validateTransportPlan(bad), /./, "malformed input must not become an empty plan");
}
for (const charge of [-1, Infinity, NaN, 1000000001, 1.001]) {
  assert.throws(() => validateTransportPlan({ ...perTrip, trips: [{ ...trip, customerCharge: charge }] }));
}
assert.equal(transportPlanFee(validateTransportPlan({ ...perTrip, trips: [{ ...trip, customerCharge: 0.1 }, { ...trip, id: "t-2", sequence: 2, customerCharge: 0.2 }] })), 0.3);
assert.throws(() => validateTransportPlan({ ...perTrip, trips: [{ ...trip, customerCharge: 600000000 }, { ...trip, id: "t-2", sequence: 2, customerCharge: 600000000 }] }), /./, "aggregate limit applies too");
assert.throws(() => validateTransportPlan({ ...overall, trips: [{ ...trip, customerCharge: 30000 }] }), /./, "overall mode cannot silently retain a per-trip fee");
assert.equal(readTransportPlan({...input,legacy:{...input.legacy,note:"ن".repeat(2000)}}).trips[0].notes?.length,2000,"valid original Kosha transport notes are not lost");
assert.equal(transportPlanFee(readTransportPlan({...input,legacy:{...input.legacy,fee:2000000000}})),2000000000,"legacy Kosha numeric amount remains readable even above the newer service-plan editing limit");
assert.throws(() => validateTransportPlan({ ...perTrip, trips: [{ ...trip, notes: "ن".repeat(2001) }] }));
assert.equal(validateTransportPlan({...perTrip,trips:[{...trip,driverPhone:"07710000000"}]}).trips[0].driverPhone,"07710000000");
assert.throws(()=>validateTransportPlan({...perTrip,trips:[{...trip,driverPhone:"not a phone"}]}));
assert.throws(() => validateTransportPlan({ ...perTrip, trips: [{ ...trip, transportDate: "2026-02-30" }] }));
assert.throws(() => validateTransportPlan({ ...perTrip, trips: [{ ...trip, departureTime: "25:10" }] }));
assert.throws(() => readTransportPlan({ ...input, storedPlan: [] }));
assert.throws(() => readTransportPlan({ ...input, storedPlan: { ...perTrip, trips: [{ ...trip, customerCharge: 30000 }] } }), /./, "persisted plan and authoritative fee mismatch is not silently repaired");
assert.throws(() => readTransportPlan({ ...input, legacy: { ...input.legacy, fee: "not-money" } }));
assert.throws(() => readTransportPlan({ ...input, id: -1 }));
assert.throws(() => transportTripReference(input.bookingNumber, 0));
console.log("PASS transport plan: legacy read, stable references, two fee modes, precision, bounds and corrupt-data rejection");
