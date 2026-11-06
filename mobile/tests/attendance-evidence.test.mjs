import assert from "node:assert/strict";
import test from "node:test";
import { attendanceCode, locationSample, locationTaskAction, punchEvidence } from "../src/domain/attendance-evidence.ts";

const now = 1_800_000_000_000;
const coords = { latitude: 33.3, longitude: 44.4, accuracy: 12 };
const fix = (timestamp, mocked = false) => ({ timestamp, coords, mocked });
const session = { startsAt: now - 60_000, endsAt: now + 60_000, lastAttemptAt: 0, lastObservedAt: 0 };

test("selects one recent real fix and drops duplicate or too-frequent attempts", () => {
  const fixes = [fix(now - 1_000), fix(now - 200, true), fix(now - 500)];
  assert.deepEqual(locationSample(fixes, session, now), { observedAt: now - 500, ...coords });
  assert.equal(locationSample(fixes, { ...session, lastObservedAt: now - 500 }, now), null);
  assert.equal(locationSample(fixes, { ...session, lastAttemptAt: now - 29_999 }, now), null);
});

test("rejects stale fixes and fixes outside the active session", () => {
  assert.equal(locationSample([fix(now - 30_001)], session, now), null);
  assert.equal(locationSample([fix(now - 200)], { ...session, startsAt: now - 100 }, now), null);
  assert.equal(locationSample([fix(now - 500)], { ...session, endsAt: now }, now), null);
  assert.equal(locationSample([fix(now + 10_000)], session, now), null);
});

test("sends only a status request during an approved exception and resumes sampling after", () => {
  const fixes = [fix(now - 500)];
  assert.deepEqual(locationTaskAction(fixes, { ...session, exempt: true }, now), { kind: "refresh" });
  assert.deepEqual(locationTaskAction([], { ...session, exempt: true }, now, true), { kind: "refresh" });
  assert.equal(locationTaskAction(fixes, { ...session, exempt: true, lastAttemptAt: now - 500 }, now), null);
  assert.deepEqual(locationTaskAction(fixes, { ...session, exempt: false }, now), {
    kind: "sample",
    sample: { observedAt: now - 500, ...coords },
  });
});

test("never requests evidence outside the authorized work window", () => {
  const fixes = [fix(now - 500)];
  assert.equal(locationTaskAction(fixes, { ...session, exempt: true, startsAt: now + 1 }, now), null);
  assert.equal(locationTaskAction(fixes, { ...session, exempt: true, endsAt: now }, now), null);
});

test("honors available methods for QR-only, combined and either-method punches", () => {
  assert.deepEqual(punchEvidence({ method: "qr_gps", allowedMethods: [] }), { qr: "gps", directGps: false });
  assert.deepEqual(punchEvidence({ method: "any", allowedMethods: ["qr_gps", "gps"] }), { qr: "gps", directGps: true });
  assert.deepEqual(punchEvidence({ method: "any", allowedMethods: ["qr_gps", "qr"] }), { qr: "only", directGps: false });
  assert.deepEqual(punchEvidence({ method: "manual", allowedMethods: ["qr", "gps"] }), { qr: null, directGps: false });
});

test("extracts a rotating code from the kiosk link and rejects unrelated barcodes", () => {
  const code = "AJN1.3.12345678.abcdefghijklmnopqrstuvwxyzABCDEF";
  assert.equal(attendanceCode(code), code);
  assert.equal(attendanceCode("https://staff.example/staff?attendanceQr=" + encodeURIComponent(code)), code);
  assert.equal(attendanceCode("https://staff.example/staff?attendanceQr=%"), null);
  assert.equal(attendanceCode("1234"), null);
});
