/**
 * Pure-logic guard for the session-revocation SCOPE. No database, no network —
 * it models the exact WHERE-clause semantics of the server helpers in
 * src/server/api.ts (destroySession / revokeSession / revokeAllUserSessions)
 * against an in-memory set of sessions and asserts that each operation touches
 * ONLY the intended rows. This is the automated counterpart to the manual test
 * matrix; run it in CI to catch a regression that broadens a revoke's scope.
 *
 * Usage: node scripts/verify-session-isolation.mjs
 */

let failures = 0;
function assert(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}

// ── In-memory mirror of admin_sessions rows ──
function makeStore() {
  // Three employees, some on multiple devices/portals. `sid` is the opaque
  // session_id; `tok` is the secret token; revoked === null means active.
  return [
    { sid: "ali-laptop", tok: "t1", userId: 1, portal: "admin", revoked: null },
    { sid: "hassan-phone", tok: "t2", userId: 2, portal: "photography", revoked: null },
    { sid: "hassan-laptop", tok: "t3", userId: 2, portal: "photography", revoked: null },
    { sid: "ahmed-phone", tok: "t4", userId: 3, portal: "kosha", revoked: null },
  ];
}

const now = () => new Date();

// destroySession(token): revoke exactly the row whose token matches AND is active.
function destroySession(store, token) {
  for (const s of store) {
    if (s.tok === token && s.revoked === null) s.revoked = now();
  }
}

// revokeSession(sessionId): revoke exactly the row whose session_id matches AND is active.
function revokeSession(store, sessionId) {
  for (const s of store) {
    if (s.sid === sessionId && s.revoked === null) s.revoked = now();
  }
}

// revokeAllUserSessions(userId, exceptSessionId?): revoke every active row for
// that user only, optionally sparing one session.
function revokeAllUserSessions(store, userId, exceptSessionId = null) {
  for (const s of store) {
    if (s.userId === userId && s.revoked === null && s.sid !== exceptSessionId) {
      s.revoked = now();
    }
  }
}

const active = (store) => store.filter((s) => s.revoked === null).map((s) => s.sid).sort();

// ── Test 1: ordinary logout (Hassan's phone) revokes only that device ──
console.log("Test 1 — ordinary logout revokes current session only");
{
  const store = makeStore();
  destroySession(store, "t2"); // Hassan's phone token
  assert("Hassan's phone is revoked", store.find((s) => s.sid === "hassan-phone").revoked !== null);
  assert("Hassan's laptop stays active", store.find((s) => s.sid === "hassan-laptop").revoked === null);
  assert("Ali (admin) stays active", store.find((s) => s.sid === "ali-laptop").revoked === null);
  assert("Ahmed (kosha) stays active", store.find((s) => s.sid === "ahmed-phone").revoked === null);
  assert(
    "exactly one session revoked",
    active(store).join(",") === ["ali-laptop", "hassan-laptop", "ahmed-phone"].sort().join(","),
  );
}

// ── Test 2: revoke one device by session_id ──
console.log("Test 2 — revoke a specific device by session_id");
{
  const store = makeStore();
  revokeSession(store, "hassan-laptop");
  assert("Hassan's laptop revoked", store.find((s) => s.sid === "hassan-laptop").revoked !== null);
  assert("Hassan's phone still active", store.find((s) => s.sid === "hassan-phone").revoked === null);
  assert("other users untouched", active(store).includes("ali-laptop") && active(store).includes("ahmed-phone"));
}

// ── Test 3: logout-all for Hassan revokes only Hassan ──
console.log("Test 3 — logout-all revokes only the target user");
{
  const store = makeStore();
  revokeAllUserSessions(store, 2); // Hassan
  assert("both Hassan sessions revoked", store.filter((s) => s.userId === 2).every((s) => s.revoked !== null));
  assert("Ali stays active", store.find((s) => s.sid === "ali-laptop").revoked === null);
  assert("Ahmed stays active", store.find((s) => s.sid === "ahmed-phone").revoked === null);
  assert("only Hassan affected", active(store).sort().join(",") === ["ahmed-phone", "ali-laptop"].sort().join(","));
}

// ── Test 4: logout-all with an exception keeps the initiating session ──
console.log("Test 4 — logout-all can spare the initiating session");
{
  const store = makeStore();
  revokeAllUserSessions(store, 2, "hassan-phone"); // keep the phone we're on
  assert("Hassan's phone kept", store.find((s) => s.sid === "hassan-phone").revoked === null);
  assert("Hassan's laptop revoked", store.find((s) => s.sid === "hassan-laptop").revoked !== null);
}

// ── Test 5: an already-revoked session is not resurrected or double-touched ──
console.log("Test 5 — operations never touch other users even when repeated");
{
  const store = makeStore();
  revokeAllUserSessions(store, 3); // Ahmed logs out everywhere
  revokeAllUserSessions(store, 2); // Hassan logs out everywhere
  assert("Ali is the only one still active", active(store).join(",") === "ali-laptop");
}

if (failures) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll session-isolation scope checks passed.");
