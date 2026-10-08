# AJN Representative Portal: One Account, One Group

Date: 2026-10-08
Status: design for owner review

## Intent and current state

Each graduation-group representative must sign in with their own existing AJN staff account and see only their assigned group's information. Administrators with the existing admin role retain the cross-group view. The owner explicitly does not want a second account system or changes to existing staff accounts.

The existing `/representative` portal authenticates through AJN staff sessions. `representative_group_assignments` already links staff IDs to graduation-group IDs, and most representative endpoints use those links. The screenshot shows the principal administrator, whose role intentionally sees all groups. Two gaps remain: unauthenticated representatives are sent to the generic admin login, and the assignment table/API can give one staff account multiple active groups. Payment and receipt reads are currently scoped to the payment creator, not to the account's *current* group.

## Chosen approach

Reuse AJN staff authentication, session handling, permissions, and the existing assignment table. Provide a representative-branded login at `/representative/login` that calls the existing login API. The administrator continues to create or maintain each representative's unique username and password through the existing Staff screen and then links that account to one group in the representative-assignment screen. Do not create accounts automatically, store passwords in the group record, or add a new authentication API.

Alternatives rejected: a separate representative account table/session system would duplicate security infrastructure; filtering only in React would leave the API exposed.

## Account and assignment policy

- A non-admin representative needs `representative.portal.access`, an active AJN staff account, and exactly one active group assignment. Zero assignments or multiple active assignments fail closed with an actionable message; neither case falls back to all groups.
- Administrators with the existing admin role may see all groups and manage assignments. Other staff roles do not acquire administrator-wide access merely through graduation permissions.
- The admin assignment UI lists eligible staff accounts, identifies the currently assigned group, and makes the one-group rule clear. The server validates the selected staff account and applies assignment changes atomically under a staff-row lock, so concurrent requests cannot create two active groups.
- An existing account may be corrected/reassigned only before it has representative payment requests or custody handovers. After financial activity, the account stays bound to its historical group; a new representative account is needed for a different group. Existing payment and custody history is never deleted or rewritten. Legacy accounts with multiple active groups require explicit admin review rather than automatic selection or data mutation.
- Multiple different representative accounts may be assigned to the same group if the administrator chooses; the invariant is one active group per representative account, not one representative per group.

## Portal and API behavior

- `/representative` sends anonymous users to `/representative/login`. Successful login stays on `/representative`; a representative-only account that uses generic `/admin/login` is redirected to the representative portal rather than an inaccessible admin dashboard. Existing admin and staff logins otherwise keep their behavior.
- The portal header displays the authenticated account and the title of its one assigned group. An administrator's cross-group view remains explicit instead of making the first group look like the only group.
- Every representative dashboard, students, reports, sash pricing, payment request, receipt, and issue operation resolves the active assignment on the server. Client-supplied group/order IDs are never sufficient for access. For non-admin reads of payment requests and receipts, require the current group as well as the existing creator/permission checks. Unknown IDs and unauthorized groups return a controlled 403/404, not data from another group.
- Custody remains tied to the representative account because the existing records have no group ID. The no-reassignment-after-financial-activity rule prevents a new group's dashboard from inheriting old-group custody. Any ambiguous legacy multi-group account is denied until administrators resolve it; no historical values are backfilled or silently reclassified.
- Preserve the existing payment approval, canonical reconciliation, receipt, accounting, audit, and permissions logic. This change only narrows access and improves login/assignment UX.

## Failure handling and migration

No database migration and no production data rewrite are planned. A missing, inactive, or ambiguous assignment produces a clear error state for the representative and a visible admin correction path. A database failure must retain the AJN structured error contract with request ID and safe server logging; it must not become an empty-group response. Login errors preserve the existing session-replacement policy and never expose credentials.

## Verification and release

Use test-first cases for one assigned group, no group, multiple legacy groups, another group's student/payment/receipt, admin overview, login redirects, concurrent assignment, and financial-history reassignment denial. Run the repository's representative portal test plus `pnpm run typecheck`, `pnpm run build`, `pnpm run test:payment-state`, and `pnpm run verify:critical`. Run `pnpm run test:save-smoke` only with a separately verified test database; otherwise report **SKIPPED**. Never run write tests or modify data in Production. Commit/push/deploy only after all mandatory checks pass and only the intended representative files are included.

## Out of scope

Creating actual representative accounts without owner-provided identities, changing existing staff credentials, changing graduation orders or payment amounts, replacing the current AJN authentication system, and publishing unrelated dirty checkout changes are outside this task.
