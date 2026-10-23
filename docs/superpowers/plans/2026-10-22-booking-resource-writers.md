# Booking resource writers and standalone photography Implementation Plan

> Execute inline using superpowers:executing-plans and TDD, with one fresh whole-increment review. The owner explicitly requested completion, final validation, push and deployment. Do not release incomplete writer coverage.

**Goal:** Close the remaining date/transport/photography reservation bypasses in the existing AJN workflows, including an atomic calendar+resource-window change.

**Architecture:** Preserve original booking source+ID, canonical resource windows, original quantity/custody writers and shared staff/fleet locks. Extend the existing resource-window save with an optional explicit calendar change and stale date check; generic date/resource writers validate their candidate under the same locks. Integrate original photography events/crew and central synchronization transactionally. Keep photography identity local to staff scheduling, not the global financial/inventory booking type.

**Tech stack:** Existing TypeScript/Drizzle/PostgreSQL, React Query, AJN components. No new dependency or parallel reservation system.

**Spec:** Approved Smart Booking Operations resource-conflict requirements, `2026-10-21-resource-conflict-integration.md`, and owner's current two-item instruction (date/assignment/standalone photography; final checks and release).

## Global constraints

- No financial formula, payment reconciliation, Cash Box, accounting, inventory movement, protected A4, permission or historical-value changes.
- Preserve legacy unrelated edits and existing approval/manager override policies. New allocations and schedule changes cannot infer unknown occupancy or bypass original server authorization.
- Canonical lock order: original source booking/event, existing photography synchronization lock where relevant, sorted Kosha/staff/fleet/crew/product identities. Re-read the protected candidate before confirmation. Preserve original checkout/return restrictions when rescheduling.
- Preserve the original identity for linked photography; standalone events must never become duplicate central bookings or financial records.
- Standalone events currently have no full preparation-to-return field. If confirmed necessary, use one nullable additive `photography_events.resource_window` field; linked events continue to use central booking JSON. Apply only this reviewed migration, verify its object, and never run all pending migrations or rewrite legacy rows. Missing legacy windows remain explicit unknowns, not invented durations.
- Shared helper caller audit is required before modifications. Use the AJN structured error path; do not turn failed reads into empty results.
- No Production write diagnostics or new TEST database. Isolated save-smoke/real DB concurrency is SKIPPED when unavailable.
- The unfinished history-cap work stays in the other isolated checkout and outside this release.

## Task 1: Atomic calendar and resource period

Files: original `src/server/booking-resource-period.ts`, resource-window API branch, original period form/panel, existing period route/store/browser tests.

Interface: existing `saveBookingResourceWindow(...)` retains five-argument semantics; optional calendar options contain explicit desired `eventDate`, `expectedEventDate` and trusted internal transaction callback. Existing callers remain compatible.

- [ ] RED changing date+window together; GREEN one transaction updates original calendar/period and audit, including sync-callback rollback, duplicate retry, stale date/window refusal, Baghdad date/time and exact source identity.
- [ ] Preserve existing fixed-custody, outstanding checkout, quantity-release and resource lock checks. No inventory movement when editing times.
- [ ] Add explicit opt-in to the existing period form for changing booking date/time with the four entered timestamps. Preserve old save behavior by default. Test failed-save draft, source switching, keyboard/mobile RTL and source-scoped cache invalidation.

## Task 2: Original competing booking and dispatch writers

Files: original native/public Kosha create/update, routed service create/update/requested-date approval in `src/server/api.ts`, existing dispatch/team helpers and focused controlled-handler tests.

- [ ] Audit every date, Kosha, driver, vehicle and execution assignment writer. Inspect existing locks and preserve old finance/transport payment restrictions.
- [ ] RED full-window overlap and stale candidate bypasses, then integrate the canonical guard inside original transactions. Check confirmation/reactivation as well as explicit changes; unrelated legacy descriptive edits remain valid.
- [ ] Test same numeric ID across sources, resource eligibility, sorted locks, current and proposed staff/vehicle identities, rollback/retry and read errors. Do not publish another booking or stock reservation store.

## Task 3: Standalone and linked photography scheduling

Files: original staff conflict reader/report refs, `photography-booking-integration.ts`, photography event create/edit/crew routes and original portal forms; minimal nullable schema/migration if necessary.

- [ ] RED central booking vs standalone primary/crew, standalone vs central, overnight boundaries, missing timing and original link identity. A photography ref must never fall through to service/inventory/finance handling.
- [ ] Use existing event/crew sources and staff locks, validate all active crew on reschedule, preserve policy-driven reacceptance and authorized override reasons/audit.
- [ ] Synchronization re-reads the locked central row and participates in the caller's transaction when supplied. No event/crew/central schedule partial save on failure; unchanged legacy refresh does not create a new allocation.
- [ ] Provide original-portal period editing where required; full-window facts are authoritative, legacy missing data remains visibly incomplete. No secrets/private client tokens in new conflict DTOs or links.

## Task 4: Final validation, review and release

- [ ] Full typecheck/build/payment-state/verify:critical, focused real-handler tests, original booking/loading/QR/returns/custody/regression suites and 1440/768/390 browser QA. No configured lint script; isolated DB coverage SKIPPED if absent.
- [ ] One fresh whole-increment review; one Important/Critical RED→GREEN fix pass; record every ruling and deferred minor.
- [ ] Preserve latest main via normal merge and rerun merged gates. Only completed verified code is committed/pushed through existing hooks; verify exact-SHA Production Ready and read-only health/auth afterwards.

## Review focus

- Proposed dates must be validated against the proposed period, never the old date (avoid circular reschedule failure).
- Every competing writer shares the same staff/vehicle locks; unknown historical occupancy cannot be advertised as free.
- Linked photo/source identity must exclude only the actual same record, not equal numeric IDs from another source.
- Retain old financial/transport guards, original custody release requirements, existing manager override/reacceptance rules and all history.
- Controlled IO cannot certify real PostgreSQL concurrency/schema execution; report skipped coverage honestly.
