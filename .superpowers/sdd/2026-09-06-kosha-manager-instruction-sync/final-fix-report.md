# Final fix report — Kosha manager instruction sync

## Scope and outcome

Implemented the four Important findings from the final review package on `codex/kosha-instruction-sync` without changing payment, inventory, booking-status, or financial reconciliation behavior.

## 1. Staff-detail instruction audit privacy

- Added `filterKoshaInstructionAuditTimeline`, which uses the same `mayReadAssignedKoshaInstructions` decision as the staff instructions endpoint.
- Applied the filter to both native and routed staff booking detail responses.
- Ordinary employees who can open an unassigned booking no longer receive `instruction_*` timeline rows, including caption and `mediaUrl` values nested in audit snapshots.
- Exactly assigned staff and the established `admin`/`manager` supervisors retain the instruction audit timeline.
- Non-instruction execution events remain unchanged.

TDD red evidence:

```text
AssertionError [ERR_ASSERTION]: Staff detail must share the exact instruction authorization boundary
actual: 'undefined'
expected: 'function'
```

The focused service test now covers native unassigned, routed unassigned, exact assignment, and supervisor cases.

## 2. Atomic routed custom-fields preservation

Reviewed every affected routed admin writer and moved each stale custom-fields write to `routedKoshaCustomFieldsSql`, which merges scalar changes against the current database row and reserves `koshaPortalTimeline` and `koshaPortalMedia` for current-row preservation/append behavior.

Affected callers:

1. `updateRoutedKoshaServiceBooking` — routed Kosha manager edit.
2. `saveBookingOperations` — shared admin booking workflow/product/warehouse/asset operations.
3. `stampBookingSoundDepartment` — routed sound-department stamp.
4. `handleBookingOperations` staff-assignment transaction — routed assignment changes.
5. Generic admin `service-orders` PATCH — routed orders edited from the general booking surface.

The existing routed stage, standalone media, delivery, and manager-instruction audit writers already used the same atomic helper and remain on it. Empty append sets now compile to a plain current-row JSONB merge, so unrelated service orders do not acquire empty Kosha portal arrays.

The interleaving regression starts with a current instruction-edit audit containing the previous caption plus existing media, applies a stale admin patch, and verifies both reserved arrays survive. The generated SQL contract verifies every affected caller uses the current-row helper.

TDD red evidence:

```text
AssertionError [ERR_ASSERTION]: routed manager edit must merge stale customFields against the current database row
```

An additional red test caught unwanted empty-array materialization before the helper was narrowed:

```text
AssertionError [ERR_ASSERTION]: An empty admin append preserves current JSON without creating portal arrays on unrelated service orders
```

## 3. Booking-scoped monotonic read cursor

Updated the still-unapplied additive migration `0110_kosha_manager_instructions.sql` and its Drizzle/exact-DDL contract:

- Added `kosha_manager_instructions.booking_version bigint NOT NULL`.
- Added `kosha_booking_channel_reads.viewed_version bigint NOT NULL DEFAULT 0`.
- Added `kosha_instruction_booking_versions`, uniquely keyed by `(booking_source, booking_id)`.
- Changed the active instruction index to end in `booking_version`.

Each create/edit/archive transaction obtains its version through one PostgreSQL `INSERT ... ON CONFLICT DO UPDATE current_version = current_version + 1 RETURNING` statement. The unique booking-version row serializes concurrent mutation commits for the same source-safe booking identity. A later committed mutation therefore cannot receive a cursor below one that a reader has already acknowledged.

Read behavior now uses the cursor end to end:

- Instruction rows expose `bookingVersion`.
- List/receipt responses expose `latestVersion` and `viewedVersion` while retaining `latestAt`/`viewedAt` for display compatibility.
- Staff POSTs the exact rendered `{ viewedThrough, viewedVersion }` snapshot; retries resend the same pair.
- The server rejects missing, invalid, or future versions.
- Read upserts use `greatest` for both timestamp and version.
- Per-detail and batched unread calculations compare `booking_version > viewed_version` and never use `updated_at > viewed_at`.

The deterministic race regression acknowledges version 1, moves the test clock backwards, commits version 2, and confirms version 2 remains unread despite its older timestamp.

TDD red evidence:

```text
AssertionError [ERR_ASSERTION]: kosha_manager_instructions.booking_version must be declared
```

```text
AssertionError [ERR_ASSERTION]: The first instruction mutation receives booking cursor one
undefined !== 1
```

## 4. Read-only booking reference photos

- Added a separate `الصور المرجعية للحجز` section to the admin execution panel.
- It consumes `detail.referencePhotos` directly through the shared accessible RTL viewer.
- The section is explicitly read-only and does not upload, persist, or copy any file.
- Manager-authored instruction images remain in the distinct `تعليمات المدير` section.

Browser TDD red evidence:

```text
locator.waitFor: Timeout 30000ms exceeded.
- waiting for getByRole('heading', { name: 'الصور المرجعية للحجز', exact: true }) to be visible
```

The green browser fixture verifies the existing reference URL renders in its own section. The staff browser geometry fixture now waits for the dialog opening animation before measuring, removing a repeatable mid-animation false failure while preserving all viewport assertions.

## Verification evidence

Focused deterministic contracts:

```text
node scripts/test-kosha-instructions.cjs
PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation

node scripts/test-kosha-instruction-store.cjs
PASS: Real Drizzle SQL source scoping, active filtering, row locks, batched unread, atomic routed timeline append, safe notification FK and failure propagation

pnpm run test:kosha-manager-schema
PASS: Kosha manager instruction and channel read schema contracts

pnpm run test:kosha-manager
PASS: Kosha manager source identity, combined filters, event date and cancellation precedence

pnpm run test:kosha-operations
All checks passed
```

Browser fixtures against the local app with every API request intercepted:

```text
node scripts/test-kosha-manager-browser.mjs
PASS: presentation fixtures — desktop/mobile, quick details, canonical amount display, thermal preview and empty state

node scripts/test-kosha-staff-instructions-browser.mjs
PASS: staff manager instructions — dashboard/list batching contract, native/service identity, unread failure/retry, mobile order and bounded RTL viewer access
```

Mandatory gates:

```text
pnpm run typecheck
$ tsc --noEmit
exit 0

pnpm run build
Compiled successfully
Finished TypeScript
Generated static pages
exit 0

pnpm run test:payment-state
AJN PAYMENT STATE CONTRACT PASSED — approved payment snapshots reconcile centrally.
exit 0

pnpm run verify:critical
PASS 22 critical AJN database table contracts are backward-compatible
PASS Additive tables/columns and harmless indexes remain allowed
PASS application server request code performs no DDL
PASS Critical-file change policy (standard)
AJN FINANCIAL APPROVAL CONTRACT PASSED — cash-box posting remains approval-first.
AJN PAYMENT STATE CONTRACT PASSED — approved payment snapshots reconcile centrally.
AJN SAFETY CHECK PASSED — Push allowed.
exit 0
```

`pnpm run test:save-smoke`: **SKIPPED**, not passed. `verify:critical` reported that no valid separately isolated `TEST_DATABASE_URL` is configured. No database write test, migration apply, or Production data change was attempted.

## Self-review

- Confirmed the staff-detail filter removes the whole sensitive audit event rather than selectively missing nested `previous`/`current` snapshots.
- Confirmed the filter decision is the exact instruction-service authorization helper, including supervisor and source-safe assignment behavior.
- Confirmed all routed admin edit/operations/assignment callers that begin with stale custom fields use a database-column merge; existing field stage/media/delivery/instruction appenders still use it.
- Confirmed cursor allocation and instruction mutation occur inside the same transaction, and the booking identity includes both source and ID.
- Confirmed future cursor acknowledgements fail closed and unread calculation has no timestamp comparison.
- Confirmed `latestAt` and `viewedAt` remain in responses for existing display consumers; cursor fields are additive.
- Confirmed booking reference photos reuse existing URLs and expose no mutation control.
- Confirmed no payment, approval, ledger, Cash Box, inventory, delivery-total, or booking-status logic changed.
- `git diff --check` passed.

## Release state

- Migration `0110` was updated in place because it has not been applied, as specified.
- No migration was applied and no Production data was touched.
- The final fix commit was created on `codex/kosha-instruction-sync`.
- No push was performed.

## Residual staff payload redaction closure (2026-09-09)

The follow-up security review found a second serialization path around the
authorized top-level timeline. Both native and routed staff crew serializers
still carried `bookingDetails.koshaPortalTimeline`; routed bookings populated
that object from the complete service-order `customFields`. Consequently, an
ordinary employee allowed to see an unassigned booking could receive manager
instruction captions and media URLs from nested `instruction_created`,
`instruction_edited`, or `instruction_archived` audit snapshots even though the
top-level detail timeline had been filtered.

The exact staff serialization boundary now removes every `instruction_*` event
from the generic nested booking-details timeline for both booking sources. It
preserves non-instruction execution events, staff execution media, assignment
metadata, routing fields, and the persisted source object. The manager/admin
formatters are unchanged. Assigned staff and supervisors retain intended access
through the authorization-aware instructions endpoint and, on detail responses,
the separately filtered top-level timeline.

Coverage now proves:

- native and routed crew serializers invoke the nested audit redactor;
- native and routed detail loaders use those crew serializers;
- list and dashboard responses consume the same redacted visible-row set;
- nested create/edit/archive snapshots containing both `caption` and `mediaUrl`
  are removed while a staff execution event remains;
- redaction does not mutate stored booking details.

TDD red evidence:

```text
AssertionError [ERR_ASSERTION]: Staff booking serializers must expose a tested nested-audit redaction boundary
+ actual - expected
+ 'undefined'
- 'function'
```

Fresh verification evidence:

```text
node scripts/test-kosha-instructions.cjs
PASS: Kosha instruction routes, authorization, validation, source isolation, single storage, audit, notifications, revision, archive, read channels/races, batched counts and failure propagation

pnpm run typecheck
$ tsc --noEmit
exit 0

pnpm run build
Compiled successfully
Finished TypeScript
Generated static pages
exit 0

pnpm run verify:critical
PASS 22 critical AJN database table contracts are backward-compatible
PASS Additive tables/columns and harmless indexes remain allowed
PASS application server request code performs no DDL
PASS Critical-file change policy (standard)
AJN FINANCIAL APPROVAL CONTRACT PASSED — cash-box posting remains approval-first.
AJN PAYMENT STATE CONTRACT PASSED — approved payment snapshots reconcile centrally.
AJN SAFETY CHECK PASSED — Push allowed.
exit 0
```

`pnpm run test:save-smoke`: **SKIPPED**, not passed. No separately
verified isolated `TEST_DATABASE_URL` was configured. No schema, payment,
finance, inventory, Production data, or manager/admin response behavior changed.
