# Task 4 Report: Staff Portal Experience

## Status

Implemented and verified the staff-facing manager instruction flow for native Kosha and routed service bookings. The change is limited to staff UI/client types and focused browser fixtures; schema, server, admin UI, financial logic, booking mutations, and operational workflows were not changed.

## Changes

- Extended the existing staff client contract with:
  - list/detail `unreadInstructionCount`
  - `GET /staff/koshas/bookings/:id/instructions?source=...`
  - `POST /staff/koshas/bookings/:id/instructions/viewed?source=...`
- Added a prominent `تعليمات من الإدارة` section after booking/setup information and before stage/action controls.
- Rendered active manager notes with caption, uploader, and timestamp.
- Rendered manager reference images through the shared accessible RTL thumbnail/dialog viewer, including captions, uploader/time metadata, 44px navigation controls, Escape, and RTL arrow-key navigation.
- Added `تعليمات الإدارة • N جديد` to existing staff booking cards using only the list response’s batched unread count. No per-card instruction request was introduced.
- Preserved the exact `(source, bookingId)` identity on native and routed-service GET/POST requests.
- Marked viewed only after the successfully loaded instruction section commits, posting the captured `latestAt` snapshot.
- Kept the unread badge after a mark-viewed failure, rendered a controlled error, and added a 44px retry action that resends the same captured snapshot.
- Kept instruction-load failures distinct from an empty instruction state and provided a controlled retry.
- Keyed the instruction section by `(source, bookingId)` and deduplicated its initial development-mode load so a snapshot from one booking cannot be acknowledged under another booking identity.

## TDD Evidence

The focused browser fixture was added before production code.

Initial red run:

```text
locator.waitFor: Timeout 60000ms exceeded.
- waiting for getByText('تعليمات الإدارة • 2 جديد', { exact: true }) to be visible
exit_code=1
```

The first implementation run exposed a cross-identity/Strict Mode race:

```text
AssertionError [ERR_ASSERTION]: Unrendered service instructions are never acknowledged
1 !== 0
exit_code=1
```

After binding the section lifecycle to the exact booking identity and deduplicating the initial load:

```text
PASS: staff manager instructions — native/service identity, unread failure/retry, mobile order and RTL viewer keyboard navigation
exit_code=0
```

The browser fixture covers card unread badges, native/service source preservation, instruction load failure/retry, mark-viewed failure/retry, exact rendered snapshots, no acknowledgement for failed/unrendered content, section order before execution controls, mobile horizontal overflow, and keyboard RTL image navigation.

## Verification

```text
$env:AJN_BROWSER_RUNTIME='C:\Users\ALIJAN\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\package.json'; pnpm run test:kosha-staff-instructions
PASS: staff manager instructions — native/service identity, unread failure/retry, mobile order and RTL viewer keyboard navigation
exit_code=0
```

```text
pnpm run test:kosha-manager
PASS: Kosha manager source identity, combined filters, event date and cancellation precedence
exit_code=0
```

```text
node scripts/test-kosha-instructions.cjs
PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation
exit_code=0
```

```text
pnpm run test:kosha-operations
All checks passed
exit_code=0
```

```text
pnpm run typecheck
$ tsc --noEmit
exit_code=0
```

```text
pnpm run build
✓ Compiled successfully in 6.6s
Finished TypeScript in 34.0s
✓ Generating static pages using 5 workers (1/1)
exit_code=0
```

```text
pnpm run verify:critical
AJN DATABASE INTEGRATION TESTS SKIPPED — no valid isolated TEST_DATABASE_URL is configured.
...
AJN SAFETY CHECK PASSED — Push allowed.
AJN DATABASE INTEGRATION TESTS: SKIPPED (normal release policy; not reported as PASS).
exit_code=0
```

`test:save-smoke` was **SKIPPED**, not passed, because `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separately verified `TEST_DATABASE_URL` are not configured.

## Self-review

- Confirmed no server authorization, mutation, payment, delivery, stage, upload, operations, notification, or routing behavior was changed.
- Confirmed the viewed POST always uses the successfully rendered response’s `latestAt`, never request completion time or a newer unrendered snapshot.
- Confirmed GET failures cannot render the empty-instructions state or trigger acknowledgment.
- Confirmed retry retains the unread badge until POST success.
- Confirmed native buttons and the shared viewer preserve keyboard support, visible focus behavior, RTL navigation, and 44px touch targets.
- Confirmed the mobile fixture has no horizontal document/viewer overflow and instruction content precedes execution controls in DOM order.
- `git diff --check` passed.

## Concerns

- `pnpm run test:staff-portal-auth` has an unrelated existing failure in the source-text assertion `simple salary portal derives the employee from the authenticated session`. This task does not touch `handleUnifiedStaffPortal`, salary handling, or that test. The mandatory `verify:critical` gate passed.
- Full write-path database smoke coverage remains unavailable until a separate safe test database is configured.
- Existing untracked `docs/superpowers/` files were present before Task 4 and were left untouched.
