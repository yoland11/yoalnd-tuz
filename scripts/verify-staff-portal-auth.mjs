/**
 * Safe Staff Portal authentication contract checks.
 *
 * These checks never connect to a database. They exercise the password-hash
 * behavior in memory and lock the portal to the canonical staff/session paths
 * in source so a future change cannot silently introduce a second credential
 * store or broaden employee data visibility.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";

const api = readFileSync("src/server/api.ts", "utf8");
const client = readFileSync("src/views/admin/_lib.ts", "utf8");
const portal = readFileSync("src/views/staff/unified-portal.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

let checks = 0;
function check(label, condition) {
  assert.equal(Boolean(condition), true, label);
  checks += 1;
  console.log(`✓ ${label}`);
}

function accepts(account, password) {
  return Boolean(
    account &&
      account.isActive &&
      account.passwordHash &&
      bcrypt.compareSync(password, account.passwordHash),
  );
}

function normalizedUsername(value) {
  return value.trim().toLowerCase();
}

function loginOutcome({ account, password, rateLimited = false, activeSessions = 0, forceReplace = false }) {
  if (rateLimited) return "rate_limited";
  if (!accepts(account, password)) return "invalid_credentials";
  if (activeSessions > 0 && !forceReplace) return "session_decision";
  return "authenticated";
}

const account = {
  id: 42,
  department: "photography",
  isActive: true,
  passwordHash: bcrypt.hashSync("AJN-old-password", 4),
};

check("existing employee password authenticates", accepts(account, "AJN-old-password"));
check("wrong employee password is rejected", !accepts(account, "wrong-password"));
check("disabled employee is rejected with the same valid hash", !accepts({ ...account, isActive: false }, "AJN-old-password"));
check("username matching is case-insensitive", normalizedUsername("AJN.Admin") === normalizedUsername("ajn.admin"));
check("username matching removes surrounding whitespace", normalizedUsername("  ajn.admin  ") === "ajn.admin");
check("nonexistent username follows the invalid-credentials branch", loginOutcome({ account: null, password: "AJN-old-password" }) === "invalid_credentials");
check("rate limiting is distinguished from invalid credentials", loginOutcome({ account, password: "AJN-old-password", rateLimited: true }) === "rate_limited");
check("active sessions request a decision instead of returning a 500", loginOutcome({ account, password: "AJN-old-password", activeSessions: 1 }) === "session_decision");
check("replacing an active session retains the authenticated branch", loginOutcome({ account, password: "AJN-old-password", activeSessions: 1, forceReplace: true }) === "authenticated");

const resetAccount = {
  ...account,
  passwordHash: bcrypt.hashSync("AJN-new-password", 4),
};
check("password reset immediately accepts the new password", accepts(resetAccount, "AJN-new-password"));
check("password reset immediately rejects the former password", !accepts(resetAccount, "AJN-old-password"));

check(
  "Staff Portal exposes an explicit login route separate from Admin login",
  app.includes('<Route path="/staff/login">') && app.includes('<Route path="/admin/*">'),
);
check(
  "web Staff Portal reuses the canonical login client",
  portal.includes("loginAdmin(username.trim(), password)") &&
    client.includes('adminFetch<{ user: AdminMe }>("/admin/auth/login"'),
);
check(
  "canonical login reads the staff table, active flag and existing password hash",
  api.includes("db.query.staffTable.findFirst") &&
    api.includes("!user.isActive") &&
    api.includes("!verifyPassword(password, user.passwordHash)") &&
    api.includes("lower(${staffTable.username}) = ${userKey}"),
);
check(
  "login errors carry a request ID and a safe server-side stage",
  api.includes("authStage: authDiagnostics.stage") &&
    api.includes('requestId: makeRequestId(req.headers.get("x-request-id"))') &&
    api.includes('authDiagnostics.stage = "username_lookup"') &&
    api.includes('authDiagnostics.stage = "session_create"'),
);
check(
  "optional activity telemetry cannot fail a successful login",
  api.includes('AJN admin login activity touch failed') &&
    api.includes("// `last_activity_at` is observability only.") &&
    api.includes('authDiagnostics.stage = "complete"'),
);
check(
  "Employee Management password reset updates the canonical staff hash",
  api.includes("if (nextPassword) update.passwordHash = hashPassword(nextPassword)") &&
    api.includes(".update(staffTable)"),
);
check(
  "session resolution rejects expired, revoked and disabled accounts",
  api.includes("gt(adminSessionsTable.expiresAt, new Date())") &&
    api.includes("isNull(adminSessionsTable.revokedAt)") &&
    api.includes("if (!user || !user.isActive) return null"),
);
check(
  "Staff Portal returns to login on session expiry",
  portal.includes("apiErrorStatus(sessionError) !== 401") &&
    portal.includes('navigate("/staff/login", { replace: true })'),
);
check(
  "tasks, attendance, notifications and payroll remain scoped to the employee ID",
  api.includes("assignedStaffIds} @> ${JSON.stringify([auth.id])}::jsonb") &&
    api.includes("eq(attendanceRecordsTable.staffId, auth.id)") &&
    api.includes("eq(notificationsTable.staffId, auth.id)") &&
    api.includes("eq(payrollLinesTable.staffId, auth.id)"),
);
check(
  "bookings remain assigned-record only across departments",
  api.includes("isKoshaBookingAssignedTo(row, auth.id)") &&
    api.includes("eq(photographyEventsTable.assignedStaffId, auth.id)") &&
    api.includes("bookingAssignedStaff(order.customFields ?? {}).ids.includes(auth.id)"),
);
check(
  "logout uses the canonical session revocation path",
  portal.includes("logoutAdmin()") &&
    client.includes('adminFetch(`/admin/auth/logout${qs}`, { method: "POST" })') &&
    api.includes("if (token) await destroySession(token)"),
);

console.log(`Staff Portal authentication contract passed (${checks} checks).`);
