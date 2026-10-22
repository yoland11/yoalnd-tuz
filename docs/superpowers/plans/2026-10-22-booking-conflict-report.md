# Booking conflict report and responsive QA

> Execute inline with superpowers:executing-plans and TDD; one fresh final reviewer. This completes the display portion of Task 3 in the approved 2026-10-21 resource integration plan, not the unfinished competing writers.

**Goal:** Display original booking resource conflicts and honest missing evidence inside Assets, with direct original-booking resolution links and desktop/tablet/mobile verification.

**Architecture:** Read-only GET before existing schema initialization, under original Booking Operations authorization. Reuse `readResourceBooking`, original physical/staff/vehicle/crew/Kosha conflict readers and `quantityPeriodAvailability`; bounded source-specific reads for quantities and original custody/work-order resources. No reservation, stock, financial, status or historical write. React Query source+ID keys; original period save invalidates the report. Existing AJN components/tokens and no new dependencies.

**Spec:** Owner's approved Smart Booking Operations specification, resource conflict display, and latest explicit instruction to complete display plus integrated computer/mobile checks.

## Constraints / review focus

- Unknown timing, truncated results, malformed data and read failure never become availability. Show reader coverage limits, first matching booking per resource and snapshot/non-reservation nature.
- Same numeric ID in different sources is not self; links use `/admin/bookings/{source}/{id}?tab=assets`.
- Actual checkout remains occupied until returned. Quantity math uses original exclusive buckets, peak demand, stock holds and decimal support, not a second formula.
- Report only references permitted admin operations; no private contact, financial, internal note or full source JSON returned.
- Existing writer coverage/standalone photography remains incomplete. Never label overall readiness or all resources conflict-free.

## Task 1 — Original read endpoint and report

Files: `src/lib/booking-conflict-report.ts` (DTO), `src/server/booking-conflict-report.ts` (bounded read adapter), original `src/server/api.ts` routing only, `scripts/test-booking-conflict-report-route.cjs`, `scripts/test-booking-conflict-report.ts`.

Produces `loadBookingConflictReport(executor, {source:'kosha'|'service',id:number}) -> Promise<BookingConflictReport>`; rows identify kind/name/state/reason, quantity figures when applicable and minimal other-booking refs. Route `GET /admin/booking-operations/{source}/{id}/conflicts`, private/no-store; reject mutations and unauthorized access before reads.

- [x] Actual-handler route regression RED (route absent), then minimal GET wiring GREEN. Test source/ID validation, no initializers/writes, permission denial and propagated storage failure.
- [x] Controlled SQL executor tests RED then GREEN for original identities/holds, real quantity peak/decimal/partial-out facts, missing timing, malformed/truncated reads and no mutations. Reuse original overlap readers; no formula duplication.

## Task 2 — Report in original Assets tab

Files: `src/components/booking-conflict-report.tsx`, `src/views/admin/booking-conflict-report-panel.tsx`, original workspace import/placement, period panel invalidation, report UI/browser tests.

- [x] Real component RED then GREEN: named resources, precise causes, original links, quantity breakdown, no green all-clear on unknowns/errors, refresh/retry, safe Arabic RTL wrapping and keyboard/touch controls.
- [x] Actual panel integration at 1440/768/390px: source switching and late responses, stale refresh failure hides old results, period save refreshes original-source report only; screenshots inspected, no overflow.
- [x] Run existing readiness, loading/QR/partial-damaged return/custody, preparation-group and staff mobile browser suites. These use controlled IO and do not certify a live DB end-to-end write or PostgreSQL concurrency.

## Task 3 — Verification, review and release

- [x] Register report regressions in mandatory critical runner; run full `verify:critical` (typecheck/payment-state/build included), relevant browser suites and whitespace checks. No isolated TEST: save-smoke/integration/concurrency SKIPPED.
- [x] One fresh whole-increment review, one RED→GREEN fix pass for Important/Critical findings. Record rulings/minors in ledger.
- [ ] Fetch latest main, normal gated commit/push per owner auto-release policy; verify exact SHA Vercel Ready and read-only production health/auth. Preserve primary dirty checkout and all unfinished work.
