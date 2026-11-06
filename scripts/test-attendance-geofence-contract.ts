import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  attendanceGeofenceCapabilities,
  formatGeofenceExitAlert,
  geofenceConsentInput,
  geofenceSampleInput,
  isGeofencePushRecipient,
} from "../src/lib/attendance-geofence-contract";

const employee = { role: "staff", permissions: ["staff", "attendance_view"] };
const locationViewer = { role: "staff", permissions: ["attendance_view", "attendance_location_view"] };
const reviewer = { role: "staff", permissions: ["attendance_approve", "attendance_location_view"] };
const manager = { role: "manager", permissions: [] };
assert.deepEqual(attendanceGeofenceCapabilities(employee), { canViewGeofence: false, canManageGeofence: false, canReviewGeofence: false });
assert.deepEqual(attendanceGeofenceCapabilities(locationViewer), { canViewGeofence: true, canManageGeofence: false, canReviewGeofence: false });
assert.deepEqual(attendanceGeofenceCapabilities(reviewer), { canViewGeofence: true, canManageGeofence: false, canReviewGeofence: true });
assert.deepEqual(attendanceGeofenceCapabilities(manager), { canViewGeofence: true, canManageGeofence: true, canReviewGeofence: true });
assert.equal(isGeofencePushRecipient({ ...manager, isActive: true }), true);
assert.equal(isGeofencePushRecipient({ ...manager, isActive: false }), false);
assert.equal(isGeofencePushRecipient({ ...locationViewer, isActive: true }), false);
assert.equal(formatGeofenceExitAlert("أحمد مراد", Date.parse("2026-11-05T07:35:00Z")), "الموظف أحمد مراد خرج من نطاق العمل الساعة 10:35 صباحاً");
assert.equal(formatGeofenceExitAlert("أحمد مراد", Date.parse("2026-11-05T10:05:00Z")), "الموظف أحمد مراد خرج من نطاق العمل الساعة 1:05 مساءً");
assert.equal(geofenceConsentInput.safeParse({ recordId: 1, consent: true, staffId: 9 }).success, false);
assert.equal(geofenceConsentInput.safeParse({ recordId: 1, consent: "true" }).success, false);
assert.equal(geofenceConsentInput.safeParse({ recordId: 1, consent: false }).success, true);
const fix = { recordId: 1, observedAt: Date.now(), latitude: 33.3, longitude: 44.4, accuracy: 20 };
assert.equal(geofenceSampleInput.safeParse(fix).success, true);
for (const unsafe of [{ ...fix, staffId: 2 }, { ...fix, accuracy: 0 }, { ...fix, latitude: 100 }, { ...fix, longitude: -190 }, { ...fix, observedAt: Infinity }]) {
  assert.equal(geofenceSampleInput.safeParse(unsafe).success, false);
}
console.log("PASS geofence route inputs, least-privilege attendance access, manager push scope and Baghdad alert text");

const listeners = new Map<string, (event: unknown) => void>();
const displayed: Array<{ title: string; body: string }> = [];
let managerAuthorized = false;
let fetches = 0;
const sensitive = "الموظف أحمد مراد خرج من نطاق العمل الساعة 10:35 صباحاً";
runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
  self: {
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    registration: { showNotification: async (title: string, options: { body: string }) => displayed.push({ title, body: options.body }) },
  },
  fetch: async (path: string, options: RequestInit) => {
    fetches++;
    assert.equal(path, "/api/admin/notifications/attendance-exit/42");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    return { ok: managerAuthorized, json: async () => ({ title: "خروج من نطاق العمل", body: sensitive }) };
  },
});
const push = async (payload: unknown) => {
  let pending: Promise<unknown> | undefined;
  listeners.get("push")?.({ data: { json: () => payload }, waitUntil: (work: Promise<unknown>) => { pending = work; } });
  await pending;
};
await push({ type: "attendance_geofence_exit", id: 42, body: "untrusted" });
assert.equal(displayed.length, 0, "a logged out or different user gets no named push");
managerAuthorized = true;
await push({ type: "attendance_geofence_exit", id: 42, body: "untrusted" });
assert.equal(displayed[0]?.body, sensitive);
await push({ type: "attendance_geofence_exit", id: "42" });
assert.equal(fetches, 2);
await push({ title: "Existing notification", body: "Original payload" });
assert.equal(displayed[1]?.body, "Original payload");
console.log("PASS service worker displays named exit push only after current manager authorization");
