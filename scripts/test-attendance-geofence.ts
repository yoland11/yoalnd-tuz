import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  classifyGeofenceSample,
  evaluateGeofenceSample,
  geofenceEvidenceStatus,
  geofenceWindow,
  type GeofenceEvidence,
  type GeofenceOpenVisit,
} from "../src/lib/attendance-geofence";
import { closeGeofenceForCheckout, geofenceMe, recordGeofenceSample } from "../src/server/attendance-geofence";

const now = Date.parse("2026-11-04T06:00:00Z");
const workplace = { latitude: 34.888, longitude: 44.633, radiusMeters: 100, maxAccuracyMeters: 50 };
assert.equal(classifyGeofenceSample({ ...workplace, accuracy: 10 }, workplace), "inside");
assert.equal(classifyGeofenceSample({ latitude: 34.8889, longitude: 44.633, accuracy: 12 }, workplace), "unavailable", "a fix overlapping the boundary cannot prove an exit or a return");
assert.equal(classifyGeofenceSample({ latitude: 34.89, longitude: 44.633, accuracy: 30 }, workplace), "outside");
assert.equal(classifyGeofenceSample({ latitude: 34.89, longitude: 44.633, accuracy: 51 }, workplace), "unavailable", "a low-quality fix cannot prove an exit");
assert.equal(classifyGeofenceSample({ latitude: Number.NaN, longitude: 44.633, accuracy: 12 }, workplace), "unavailable");

const fresh = (): GeofenceEvidence => ({
  status: "unavailable", observedAt: null, receivedAt: null, lastTrustedAt: null,
  outsideSince: null, outsideSinceReceivedAt: null,
});
let evidence = fresh();
let visit: GeofenceOpenVisit | null = null;
function sample(second: number, position: "outside" | "inside" | "unavailable", options: { received?: number; exempted?: boolean } = {}) {
  const decision = evaluateGeofenceSample({
    evidence, visit, position, observedAt: now + second * 1000,
    now: now + (options.received ?? second) * 1000, interrupted: options.exempted ?? false,
  });
  evidence = decision.evidence;
  if (decision.visit?.kind === "open") visit = { outsideMs: decision.visit.outsideMs, verification: "verified" };
  if (decision.visit?.kind === "update") visit = { outsideMs: decision.visit.outsideMs, verification: decision.visit.verification };
  if (decision.visit?.kind === "return") visit = null;
  return decision;
}

for (const second of [0, 60, 120, 180, 240, 299]) {
  const decision = sample(second, "outside");
  assert.equal(decision.visit, null, "no exit before five minutes of fresh evidence");
  assert.notEqual(evidence.status, "outside");
}
assert.deepEqual(sample(300, "outside").visit, { kind: "open", exitAt: now, outsideMs: 300_000 });
assert.equal(evidence.status, "outside");
assert.equal(sample(300, "outside", { received: 301 }).visit, null, "a retried sample cannot open or extend the visit");
assert.equal(sample(240, "inside", { received: 301 }).visit, null, "an out-of-order sample cannot close the visit");
assert.equal(evidence.status, "outside");
assert.deepEqual(sample(360, "inside").visit, { kind: "return", returnAt: now + 360_000, outsideMs: 360_000, verification: "verified" });
assert.equal(evidence.status, "returned");
assert.equal(sample(390, "inside").evidence.status, "returned");

evidence = fresh();
for (const second of [0, 60, 120, 180, 240]) sample(second, "outside");
assert.equal(geofenceEvidenceStatus(evidence, now + 331_000), "unavailable", "silent devices age out");
assert.equal(sample(331, "outside").visit, null, "a 91-second gap restarts the five-minute timer");
assert.equal(evidence.outsideSince, now + 331_000);
assert.equal(sample(390, "outside", { received: 451 }).visit, null, "a delayed sample cannot extend an outside run");
assert.equal(evidence.outsideSince, null);
assert.equal(sample(530, "outside", { received: 519 }).evidence.outsideSince, null, "a future sample cannot start a run");

evidence = fresh();
for (const second of [0, 60, 120, 180, 240]) sample(second, "outside");
assert.equal(sample(300, "outside", { exempted: true }).visit, null, "an approved exemption between samples breaks continuity");
assert.equal(evidence.outsideSince, now + 300_000);
assert.equal(sample(345, "unavailable").evidence.outsideSince, null, "uncertain accuracy breaks continuity");
assert.equal(evidence.lastTrustedAt, now + 300_000, "an unavailable observation cannot advance the last trusted timestamp");

evidence = fresh();
for (const second of [0, 60, 120, 180, 240, 300]) sample(second, "outside");
assert.deepEqual(sample(450, "outside").visit, { kind: "update", outsideMs: 300_000, verification: "interrupted" });
assert.deepEqual(sample(510, "inside").visit, { kind: "return", returnAt: now + 510_000, outsideMs: 360_000, verification: "interrupted" }, "a verified return does not turn an evidence gap into outside time");

evidence = fresh();
for (const second of [0, 60, 120, 180, 240, 300]) sample(second, "outside", { received: Math.max(50, second) });
assert.equal(visit, null, "five minutes must elapse on the server clock as well");
assert.deepEqual(sample(350, "outside").visit, { kind: "open", exitAt: now, outsideMs: 300_000 });

const fixed = { enabled: true, scheduleType: "fixed", shiftStart: "22:00", shiftEnd: "06:00", weeklyDaysOff: [], graceMinutes: 0 };
const overnight = Date.parse("2026-11-04T20:00:00Z");
assert.deepEqual(geofenceWindow({ checkInAt: overnight, schedule: fixed, shift: null }), { startsAt: overnight, endsAt: Date.parse("2026-11-05T03:00:00Z") });
assert.equal(geofenceWindow({ checkInAt: now, schedule: { ...fixed, scheduleType: "flexible" }, shift: null }), null, "company defaults do not invent a flexible shift end");
assert.deepEqual(geofenceWindow({
  checkInAt: now, schedule: { ...fixed, scheduleType: "flexible" },
  shift: { startMs: now + 60_000, endMs: now + 3_600_000, status: "scheduled" },
}), { startsAt: now + 60_000, endsAt: now + 3_600_000 }, "an explicit flexible shift can be bounded and cannot start tracking early");
assert.equal(geofenceWindow({
  checkInAt: now, schedule: fixed, shift: { startMs: now, endMs: now + 3_600_000, status: "cancelled" },
}), null, "a cancelled authoritative shift cannot fall back to fixed hours");

const migration = readFileSync("lib/db/migrations/0135_attendance_geofence.sql", "utf8");
assert.match(migration, /last_trusted_at timestamptz/);
assert.doesNotMatch(migration, /\b(latitude|longitude|accuracy_meters|distance_meters)\s+(numeric|decimal|real|double precision)/i);

const scope = {
  id: 42, staff_id: 8, staff_name: "Test employee", check_in_at: new Date(now), check_out_at: null as Date | null,
  method: "qr", shift_id: 1, shift_kind: "fixed", shift_start: new Date(now), shift_end: new Date(now + 3_600_000),
  shift_status: "scheduled", workplace: "Office", workplace_active: true,
  latitude: workplace.latitude as number | null, longitude: workplace.longitude,
  radius_meters: workplace.radiusMeters, max_accuracy_meters: workplace.maxAccuracyMeters,
  employee_enabled: true, auth_session_id: 7, session_live: true,
  consented_at: new Date(now), consent_ends_at: new Date(now + 3_600_000), revoked_at: null,
  evidence_status: "unavailable", last_observed_at: new Date(now + 240_000), last_received_at: new Date(now + 240_000),
  last_trusted_at: new Date(now + 240_000), outside_since: new Date(now), outside_since_received_at: new Date(now),
};
const statements: ReturnType<PgDialect["sqlToQuery"]>[] = [];
const dialect = new PgDialect();
const executor = {
  async execute(sql: SQL) {
    const query = dialect.sqlToQuery(sql);
    statements.push(query);
    if (/to_regclass\('attendance_geofence_sessions'\)/.test(query.sql)) return { rows: [{ ready: true }] };
    if (/select distinct on \(r.staff_id\)/.test(query.sql)) return { rows: [scope] };
    if (/from admin_sessions\s+where id/.test(query.sql)) return { rows: [{ id: 7 }] };
    if (/insert into attendance_geofence_visits/.test(query.sql)) return { rows: [{ id: 19 }] };
    if (/select g.record_id from attendance_geofence_sessions/.test(query.sql)) return { rows: [{ record_id: 42 }] };
    return { rows: [] };
  },
};

const sampleInput = { staffId: 8, authSessionId: "7", recordId: 42, observedAt: now + 300_000, latitude: 34.89, longitude: 44.633, accuracy: 30 };
const captured: unknown[] = [];
const onExit: NonNullable<Parameters<typeof recordGeofenceSample>[2]> = async (_tx, event) => { captured.push(event); };
assert.equal((await recordGeofenceSample(executor, { ...sampleInput, authSessionId: "9" }, onExit, now + 300_000)).consented, false);
assert.equal(statements.some(({ sql }) => /update attendance_geofence_sessions/.test(sql)), false, "another native session cannot write location evidence");
assert.equal((await recordGeofenceSample(executor, sampleInput, onExit, now + 300_000)).status, "outside");
assert.deepEqual(captured, [{ id: 19, staffId: 8, staffName: "Test employee", exitAt: now }]);
const persist = statements.find(({ sql }) => /set status =.*last_observed_at/.test(sql));
assert.match(persist?.sql ?? "", /last_trusted_at =/);
assert.ok(persist?.params.includes(new Date(now + 300_000).toISOString()));
assert.ok(statements.every(({ params }) => !params.includes(sampleInput.latitude) && !params.includes(sampleInput.longitude)),
  "location fixes must not be bound to database writes");

scope.latitude = null;
const noGps = await geofenceMe(executor, 8, "7", now + 301_000);
assert.equal(noGps.status, "unavailable", "an active QR session without workplace coordinates has no verification");
assert.equal(noGps.consented, true, "the employee can revoke their existing consent after configuration changes");
assert.equal(noGps.eligible, false, "location samples must stop until workplace coordinates are configured");
await closeGeofenceForCheckout(executor, 8, 42, now + 360_000);
assert.ok(statements.some(({ sql }) => /set ended_at = .*g\.last_trusted_at/.test(sql)),
  "checkout ends an interrupted visit using the last trusted observation");
scope.check_out_at = new Date(now + 360_000);
assert.equal((await geofenceMe(executor, 8, "7", now + 360_000)).status, "checked_out");

console.log("PASS attendance geofence certainty, continuity, clock, return, schedule and server contract");
