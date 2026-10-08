# AJN Representative Single-Group Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each graduation representative a separate login through their existing AJN staff account and access to exactly one assigned group, while administrators retain the all-group view.

**Architecture:** Keep `/admin/auth/login`, AJN sessions, staff permissions, and `representative_group_assignments`. Introduce a small, testable representative-scope policy; enforce it in every representative API and sash-pricing route; make assignment replacement transactional under a staff-row lock. Add a branded `/representative/login` page and clear assignment/error UI. Do not migrate schema, rewrite production data, or change payment calculations.

**Tech Stack:** Next.js 16 API routes, React/TypeScript, Wouter, TanStack Query, Drizzle/PostgreSQL, existing AJN test scripts.

**Spec:** [Approved design](../specs/2026-10-08-representative-single-group-access-design.md)

## Global Constraints

- Work only in the isolated `codex/representative-single-group` worktree. Preserve the dirty main checkout and unrelated graduation edits.
- Review callers before altering shared code. Prefer representative-local helpers. Do not add a new auth API, account table, migration, financial formula, or payment path.
- A representative needs an active staff account, `representative.portal.access`, and exactly one active assignment. Zero or multiple assignments fail closed; only the existing `admin` role sees all groups.
- Preserve existing creator checks on payments/receipts in addition to current-group checks. Never use a public join token or client-supplied group ID as authority.
- Preserve AJN structured errors with request IDs and safe logging. A database failure is not an empty assignment or unauthenticated session.
- No production write diagnostics. DB integration tests require `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separately verified `TEST_DATABASE_URL`; otherwise record **SKIPPED**.
- Commit/push `main` only after completed code passes `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, `pnpm run test:payment-state`, and relevant representative tests. Run `pnpm run test:save-smoke` only with isolated test DB. Never release partial or unrelated files.

## Review Focus

1. **Ambiguous assignment leaks groups:** Task 1 tests zero, one, two active assignments and admin role; Task 2 proves the API rejects ambiguity.
2. **Secondary route bypasses scope:** Task 2 tests other-group student, report, payment list, receipt, and sash-pricing requests, including users with graduation permissions.
3. **Reassignment shifts financial history or races:** Task 3 tests financial-history denial and simultaneous assignment attempts against a guarded isolated DB; pure policy tests run without DB.
4. **Login breaks the shared session policy or misroutes staff:** Task 4 tests existing admin/staff route behavior, representative-only route, session replacement, and recoverable auth errors.
5. **Security fix changes money or hides an API failure:** Task 5 runs payment-state and critical suites, verifies no changed financial paths, and checks controlled error responses with request IDs.

---

## Task 1 — Explicit single-group access policy

**Files:** Create `src/lib/representative-group-access.ts`, `scripts/test-representative-group-access.ts`; update `package.json` with `test:representative-group-access`.

**Interfaces:** `classifyRepresentativeScope(user: Pick<GraduationAdminUser, "role" | "isActive" | "permissions">, activeGroupIds: number[]): { kind: "admin" } | { kind: "group"; groupId: number } | { kind: "denied"; reason: "inactive" | "permission" | "missing" | "ambiguous" }`. `canAccessRepresentativeGroup(scope, groupId): boolean`. Keep the policy pure; database errors must propagate before calling it.

- [ ] RED: Add tests for admin all groups, inactive account, missing portal permission, zero active groups, one group, two legacy active groups, and unrelated group ID.
- [ ] Run `node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/test-representative-group-access.ts`; confirm the new tests fail because the policy is absent.
- [ ] GREEN: Implement the minimum policy without any fallback to first assignment or all groups.
- [ ] Run the focused test and `pnpm run test:representative-portal`; adjust obsolete source-contract assertions only if they conflict with the stricter behavior.
- [ ] Commit only Task 1 files on the feature branch.

## Task 2 — Apply scope to every representative read and write

**Files:** `src/server/representative.ts`, `src/server/graduation-group-pricing.ts`, `src/lib/graduation-group-pricing-access.ts` only if its existing permission contract needs a narrow representative-specific correction; add `scripts/test-representative-route-scope.mjs` and extend `scripts/verify-representative-portal.mjs`.

**Interfaces:** `loadRepresentativeScope(user: GraduationAdminUser, executor = db): Promise<RepresentativeScope>` in a representative-local server helper (or inside `representative.ts`) reads active assignment IDs and calls Task 1 policy. `requireRepresentativeGroup(scope, groupId)` gates order-specific operations. `handleGraduationGroupPricing(req, identifier, user, representative)` continues its existing public signature and validates exactly-one assignment inside its transaction for representative access.

- [ ] RED: Add route/contract tests asserting 403 for absent/ambiguous assignments; foreign-group order/payment/receipt/pricing reads and mutations; and admin all-group access. Include the current loophole where a representative also has `graduation` or pricing permission.
- [ ] Run focused route tests; confirm the existing broad `groupIdsFor`/pricing behavior fails them.
- [ ] GREEN: Resolve one group server-side before dashboard, students, reports, payments, receipts, custody, and issues. Require current group **and** existing representative ownership for non-admin payment/receipt reads. For sash pricing, do not let other permissions bypass the assigned-group check on the representative route. Preserve admin behavior and the existing payment approval/reconciliation code.
- [ ] Use AJN structured error payloads for new denials; return 500 with request ID and safe server log on assignment-query failure. Do not turn errors into `[]` or `null`. Run focused tests, `pnpm run test:graduation-group-pricing`, and `pnpm run test:representative-portal`.
- [ ] Commit only Task 2 files after reviewing all `handleRepresentativePortal`, `handleGraduationGroupPricing`, and access-helper callers.

## Task 3 — Atomic admin assignment and immutable financial custody

**Files:** `src/server/representative.ts`, `scripts/test-representative-assignment-policy.ts`, optionally `scripts/test-representative-assignment-db.ts` using the existing isolated-DB guard; extend the representative test script in `package.json` only as needed.

**Interfaces:** `assignmentDecision({ currentActiveGroupIds, targetGroupId, hasPaymentRequests, hasCustodyHandovers }): "same" | "assign" | "replace" | "ambiguous" | "financiallyLocked"` as pure policy. The existing `POST /admin/representative/assignments` remains the only writer. Its transaction locks the selected `staff` row, validates active staff and portal permission, verifies target group, checks current assignments and historical payment/custody rows, then updates assignment rows atomically.

- [ ] RED: Test first assignment, idempotent same-group save, permissible pre-financial replacement, two legacy active rows requiring manual review, inactive/unauthorized staff, and blocked reassignment after any payment request or custody handover.
- [ ] Run the focused pure tests and confirm failure before implementation. If isolated DB is configured, add a guarded concurrent POST/integration test proving two simultaneous target groups cannot both be active; otherwise mark DB test **SKIPPED**.
- [ ] GREEN: Implement under a staff-row `FOR UPDATE` lock and one transaction. Do not delete assignment/payment/custody history; deactivate prior assignment only when replacement is allowed. Recheck state after acquiring the lock. Keep admin-only endpoint enforcement.
- [ ] Run focused tests and isolated DB concurrency test if configured; inspect the final transaction and error statuses (400/403/404/409/500). Do not add a Production migration or data cleanup.
- [ ] Commit Task 3 files only after a second read of the write path and its callers.

## Task 4 — Dedicated representative entry and understandable UI

**Files:** Create `src/views/representative/login.tsx`; update `src/App.tsx`, `src/views/representative/index.tsx`, `src/views/admin/login.tsx`, and `scripts/verify-representative-portal.mjs`.

**Interfaces:** `/representative/login` uses the existing `loginAdmin(username, password, { forceReplace })` and `isSessionDecision`; no new server auth endpoint. `PortalGate` uses an explicit `/admin/auth/me` query that distinguishes 401 from server/network errors instead of treating every failure as logged out. The representative dashboard response keeps the existing `groups` shape but contains one group for a representative and all groups for an admin.

- [ ] RED: Add UI route/contract tests for anonymous redirect to `/representative/login`, successful representative login to `/representative`, generic admin login redirect for representative-only accounts, unchanged admin login path, and single-session confirmation. Check error/retry UI on non-401 `/me` failures.
- [ ] Run focused tests and verify they fail before UI changes.
- [ ] GREEN: Register the dedicated route before the wildcard; reuse AJN login calls, never store a second credential; show the assigned group's title in the representative header and explicit no-group/ambiguous-group guidance. Make assignment UI show current group and conflict reasons. Do not navigate during render.
- [ ] Run focused tests, `pnpm run test:staff-portal-auth`, and `pnpm run test:representative-portal`; inspect desktop and mobile RTL behavior without using or altering Production data.
- [ ] Commit Task 4 files only.

## Task 5 — Final regression, isolation, and release gate

**Files:** Tests/documentation only if corrections are needed; do not broaden product scope. Review `git diff` against `origin/main` and the isolated worktree status.

**Interfaces:** Existing AJN login/session, graduation payment approval, canonical `receivePayment`, receipt print, and financial exports retain their signatures and calculations.

- [ ] Run `pnpm run test:representative-group-access`, focused route/assignment tests, `pnpm run test:representative-portal`, `pnpm run test:graduation-group-pricing`, and `pnpm run test:staff-portal-auth`.
- [ ] Run `pnpm run typecheck`, `pnpm run build`, `pnpm run test:payment-state`, and `pnpm run verify:critical`. Record exact pass/fail results; no pass claims from stale output.
- [ ] If and only if a separately verified isolated TEST DB is available, run guarded assignment/concurrency tests and `pnpm run test:save-smoke`; otherwise record **SKIPPED**. Never point tests at Production or fall back to `DATABASE_URL`.
- [ ] Manually verify anonymous, one-group, zero-group, multi-group, foreign-ID, and admin views; verify the representative cannot see other groups' student details, payment requests, receipts, or prices. Inspect RTL/login/assignment UI and safe error states.
- [ ] Review changed files for unrelated edits and unchanged payment formulas/schema. If mandatory checks pass, integrate only feature commits to `main`, push through the existing AJN gate, and confirm Vercel Production deployment; if anything fails, do not commit/push/deploy the incomplete feature.

## Plan self-review

The plan uses the existing staff account, session, assignment, receipt, and payment architecture. It narrows access before UI work, handles the separate sash-pricing bypass, and locks assignment changes without a new schema. The sole database-write test is isolated; its absence is reported as a skip, not a pass. The principal implementation risk is coupling the representative group's current assignment with historical custody, addressed by prohibiting reassignment after any financial activity.
