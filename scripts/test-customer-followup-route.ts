import assert from "node:assert/strict";
import { customerFollowupRoute } from "../src/server/customer-followup-route";
import { CustomerFollowupError } from "../src/server/customer-followups";

const actor = { id: 4, role: "staff", permissions: ["customers"], canBook: false, canCreateCustomer: true };
const req = () => new Request("http://localhost/api/admin/customer-followups?scope=mine", { headers: { "x-request-id": "followup-test-1" } });
const db: any = { execute: () => { throw new Error("unrequested database access"); } };
let calls = 0;
const run: any = async (_db: unknown, actual: unknown, input: any) => {
  calls++; assert.equal(actual, actor); assert.equal(input.query.get("scope"), "mine");
  return { status: 200, data: { rows: [], summary: { today: 0 } } };
};
const denied = await customerFollowupRoute(req(), [], null, db, run);
assert.equal(denied.status, 401); assert.equal(calls, 0);
assert.equal((await denied.json()).code, "AUTH_REQUIRED");
const ok = await customerFollowupRoute(req(), [], actor, db, run);
assert.equal(ok.status, 200); assert.equal(calls, 1);
assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
assert.equal(ok.headers.get("x-request-id"), "followup-test-1");
const original = console.error; const logs: unknown[] = [];
console.error = (...args: unknown[]) => { logs.push(args); };
try {
  const booking = { source: "service" as const, id: 8, number: "B-8", href: "/admin/bookings/service/8" };
  const conflict = await customerFollowupRoute(req(), ["2", "actions"], actor, db, async () => { throw new CustomerFollowupError(409, "FOLLOWUP_ALREADY_CONVERTED", "المتابعة مرتبطة بحجز", { existingBooking: booking }); });
  const payload = await conflict.json();
  assert.equal(conflict.status, 409); assert.equal(payload.code, "CONFLICT"); assert.deepEqual(payload.existingBooking, booking);
  assert.equal(payload.requestId, "followup-test-1");
  const broken = await customerFollowupRoute(req(), [], actor, db, async () => { throw new Error("postgres://private:secret@host/private_schema INTERNAL_PRIVATE_ERROR"); });
  const failed = await broken.json();
  assert.equal(broken.status, 500); assert.equal(failed.success, false); assert.equal(failed.code, "DATABASE_ERROR");
  assert.ok(!JSON.stringify(failed).includes("private_schema")); assert.ok(!JSON.stringify(failed).includes("secret"));
  assert.ok(!("rows" in failed)); assert.ok(!JSON.stringify(logs).includes("private:secret@"));
} finally { console.error = original; }
console.log("PASS followup HTTP boundary: authentication first, scoped delegation, private no-store, typed recovery, canonical errors/request IDs, safe logs and no empty-data fallback");
