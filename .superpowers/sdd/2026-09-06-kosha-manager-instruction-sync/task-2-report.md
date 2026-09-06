# Task 2 report — Kosha instruction server APIs

## Scope completed

- Added the manager instruction domain service and Drizzle persistence adapter.
- Added the approved manager action matrix under `/api/admin/kosha-bookings/:id/manager-view`:
  - `GET|POST /instructions`
  - `PATCH /instructions/:instructionId`
  - `POST /instructions/:instructionId/archive`
  - `GET /instruction-reads`
  - `POST /execution-viewed`
- Added the approved staff routes:
  - `GET /api/staff/koshas/bookings/:id/instructions`
  - `POST /api/staff/koshas/bookings/:id/instructions/viewed`
- Added `unreadInstructionCount` to Kosha staff booking list and detail responses. List counts use one batched store query, not one query per booking.
- Preserved `(source, id)` across native `kosha` and routed `service` bookings.

## Security, consistency, and failure behavior

- Manager reads use the existing Kosha execution-view capability; create/edit/archive remain restricted to the existing manager/admin roles.
- Staff instruction access first passes through `authorizeKoshaPortalBooking`, then applies an exact-assignment check. Only the existing Kosha supervisor roles bypass assignment.
- Cross-source instruction lookup is scoped by `booking_source`, `booking_id`, and instruction id. Rejected instruction requests return the AJN structured error response and log safe request/booking/actor context.
- Image creation invokes the existing media persistence helper once and stores its single returned URL/value on the instruction row. Caption edits reuse the stored media object.
- Create/edit/archive, native/routed timeline writes, and assigned-staff notifications run in one database transaction. Routed timeline writes append atomically to `service_orders.custom_fields.koshaPortalTimeline`.
- Edits and archives lock the active instruction row, increment `revision`, and archives set archival metadata without deleting history.
- Viewed state upserts the exact `(source, id, staff, channel)` identity with a monotonic `greatest(existing, incoming)` timestamp. Staff uses `manager_instruction`; manager execution review uses `staff_execution`.
- Database failures propagate to the central AJN safe error mapper; no empty/null fallback was introduced.

## Files

- `src/server/api.ts`
- `src/server/kosha-instructions.ts`
- `src/server/kosha-instruction-store.ts`
- `scripts/test-kosha-instructions.cjs`
- `scripts/test-kosha-instruction-store.cjs`
- `.superpowers/sdd/2026-09-06-kosha-manager-instruction-sync/task-2-report.md`

## TDD evidence

The route dispatcher contract was added before its implementation.

```text
$ node scripts/test-kosha-instructions.cjs
AssertionError [ERR_ASSERTION]: Instruction routes must share one tested action dispatcher
+ actual - expected
+ 'undefined'
- 'function'
exit_code=1
```

After implementing the minimal shared dispatcher:

```text
$ node scripts/test-kosha-instructions.cjs
PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation
exit_code=0
```

## Focused verification

```text
$ node scripts/test-kosha-instructions.cjs
PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation
exit_code=0

$ node scripts/test-kosha-instruction-store.cjs
PASS: Real Drizzle SQL source scoping, active filtering, row locks, batched unread, atomic routed timeline append, safe notification FK and failure propagation
exit_code=0

$ pnpm run test:kosha-manager
PASS: Kosha manager source identity, combined filters, event date and cancellation precedence
exit_code=0

$ pnpm run test:kosha-operations
All checks passed
exit_code=0

$ pnpm run test:kosha-manager-schema
PASS: Kosha manager instruction and channel read schema contracts
exit_code=0
```

The first `test:kosha-operations` attempt did not execute project code because the checkout lacked esbuild's declared Windows optional binary. The exact `@esbuild/win32-x64@0.27.3` package was installed only into ignored local `node_modules`; `package.json` and `pnpm-lock.yaml` were not changed. The same command then passed as shown above.

## Mandatory AJN verification

```text
$ pnpm run typecheck
$ tsc --noEmit
exit_code=0

$ pnpm run build
$ next build
✓ Compiled successfully in 7.3s
Finished TypeScript in 30.3s
✓ Generating static pages using 5 workers (1/1)
exit_code=0

$ pnpm run verify:critical
AJN DATABASE INTEGRATION TESTS SKIPPED — no valid isolated TEST_DATABASE_URL is configured.
...
AJN SAFETY CHECK PASSED — Push allowed.
AJN DATABASE INTEGRATION TESTS: SKIPPED (normal release policy; not reported as PASS).
exit_code=0

$ pnpm run test:save-smoke
TEST BLOCKED: Safe test database could not be verified.
Reason: AJN_ENV=test and ALLOW_TEST_WRITES=true are required.
exit_code=1
```

`test:save-smoke` is therefore **SKIPPED**, never reported as passed, in accordance with the repository safety policy. No database write smoke test was run against Production or a fallback database.

## Remaining concern

- No separately verified `TEST_DATABASE_URL` was configured, so real database write-path integration coverage remains unavailable. The focused suite covers service behavior, rollback semantics through its transactional fake, and generated Drizzle SQL contracts; production build and the full non-write critical gate pass.

## Fix round 1 — review findings

### Rendered execution snapshot

- Manager `POST /execution-viewed` now parses the JSON body and requires `payload.viewedThrough`.
- The service validates the snapshot as a finite timestamp no later than the server clock, then sends it to the existing monotonic `greatest(existing, incoming)` read upsert.
- A regression holds the rendered snapshot at `2026-09-06T09:00:30.000Z`, advances the server clock, records the manager review, and uploads a staff update at `09:00:45`. The later staff update remains unread, proving a concurrent upload is not swallowed by server-time acknowledgement.
- Missing and future `viewedThrough` values return the existing structured 422 instruction error rather than being silently accepted.

### Routed timeline interleaving

- Reviewed all routed Kosha timeline/media writers. The affected callers are stage updates, standalone media uploads, delivery completion, and instruction audit events.
- Added one shared current-row JSONB merge expression. Scalar patches are merged into the current `custom_fields`; reserved `koshaPortalTimeline` and `koshaPortalMedia` arrays are removed from stale patches and appended against the database row inside the update statement.
- Rewired all four callers to that expression. Existing compare-and-set stage guards, delivery financial fields, permissions, and AJN structured error handling remain unchanged.
- An interleaving regression starts from a current database timeline containing an instruction-edit event with `meta.previous.caption = "Old note"`, applies a stale stage snapshot, and proves the prior audit entry survives while the new stage event and media append.

### Fix-round TDD and verification

```text
$ node scripts/test-kosha-instructions.cjs
AssertionError: manager read used 2026-09-06T09:01:00.000Z instead of rendered snapshot 2026-09-06T09:00:30.000Z
exit_code=1

$ node scripts/test-kosha-instructions.cjs
PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation
exit_code=0

$ node scripts/test-kosha-instruction-store.cjs
AssertionError: routed custom-fields merge helpers were not exported
exit_code=1

$ node scripts/test-kosha-instruction-store.cjs
PASS: Real Drizzle SQL source scoping, active filtering, row locks, batched unread, atomic routed timeline append, safe notification FK and failure propagation
exit_code=0

$ pnpm run test:kosha-operations
All checks passed
exit_code=0

$ pnpm run typecheck
$ tsc --noEmit
exit_code=0

$ pnpm run build
✓ Compiled successfully in 5.2s
Finished TypeScript in 32.5s
✓ Generating static pages using 5 workers (1/1)
exit_code=0

$ pnpm run verify:critical
✓ Compiled successfully in 5.1s
Finished TypeScript in 31.5s
AJN SAFETY CHECK PASSED — Push allowed.
AJN DATABASE INTEGRATION TESTS: SKIPPED (normal release policy; not reported as PASS).
exit_code=0
```

Per the fix-round instruction, `test:save-smoke` was not run. The database integration portion of `verify:critical` was **SKIPPED**, not passed, because no valid isolated `TEST_DATABASE_URL` is configured.
