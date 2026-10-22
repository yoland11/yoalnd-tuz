# Booking resource conflict integration

> **For agentic workers:** Use superpowers:executing-plans, test-driven-development and a fresh final code review. Continue inline; the owner has explicitly requested sequential completion, release, then the next backlog item.

**Goal:** Extend the original Booking Center resource checks across the explicit preparation-to-return period, without a second reservation or inventory system.

**Architecture:** Reuse the prior unmerged resource-window/conflict evaluator where sound. Rebase adapters onto current published quantity assets, protected operational JSON, actual execution membership and original vehicle/dispatch records. Missing timing/evidence is incomplete, not a fabricated conflict-free result. Reservation validation stays inside original transactions and resource locks.

**Tech stack:** Existing Next.js/TypeScript/Drizzle/PostgreSQL/React components; no new dependency or schema.

**Spec:** Owner's approved Smart Booking Operations specification, Phase 1 resource conflict detection, and 2026-10-21 instruction to finish/release each remaining item sequentially.

## Global constraints

- Preserve original booking source+ID, all historical records, stock movement/idempotency, finance, accounting and protected A4.
- Do not merge the old mixed worktree or its financial changes wholesale.
- No Production diagnostic writes and no TEST database creation. Isolated DB smoke/concurrency is SKIPPED if no separately verified TEST configuration exists; never claim concurrency certification from controlled IO.
- Every modified shared server helper has a caller/blast-radius audit before implementation.
- Required final gates: typecheck, build, payment-state, verify:critical; actual desktop/tablet/mobile browser checks for changed UI.
- No release until a coherent increment is complete and all mandatory checks pass. Never call unfinished writer coverage complete.

## Review focus

- Same numeric ID across native/service bookings must never exclude another booking.
- An issued or partially returned asset stays occupied even after planned return or a completed booking status.
- Sequential non-overlapping quantity reservations use peak simultaneous demand, not the sum of all reservations; stock already checked out is not deducted twice.
- Legacy absent timing, malformed SQL results and bounded-result truncation cannot become an available/zero-conflict state.
- A stale booking form, changed source while saving or concurrent resource reservation cannot silently replace current timing or evidence.

## Task 1 — Audit and interval core

- [ ] Record actual writers, fields, existing locks and reused previous implementation in the ledger.
- [x] Add independent interval/quantity regression fixtures, run RED, then reuse/improve the pure evaluator and full-window validator.
- [x] Validate Baghdad offsets, overnight periods, exact boundaries, invalid dates, decimals, legacy unknown, outstanding custody and source isolation.

## Task 2 — Canonical resource adapters and checks

- [ ] Add current-schema, bounded equipment/crew/vehicle/Kosha fact readers with failure propagation.
- [ ] Extend quantity assets, physical reservations, template import, staff assignment and transportation/dispatch validation using their original transactions/locks. Audit other competing writers explicitly; do not silently assume they share the guard.
- [ ] Controlled real-handler tests reproduce the missing overlap guards before implementation and verify rollback/retry/authorization composition. Real PostgreSQL concurrency remains separately labelled.

## Task 3 — Original workspace integration

- [x] Save explicit full resource timing in original operations JSON with stale-write protection and timeline audit; no invented default duration.
- [ ] Add resource-window/conflict UI to original assets tab, with current errors, shortages and direct resolution links. Existing readiness remains unknown until all relevant evidence is actually checked.
- [x] Actual period-editor component browsers at 1440/768/390px verify RTL, errors, source switches and no overflow. Full-workspace final browser regression remains part of Task 4.

## Task 4 — Review, verification and release

- [ ] Fresh independent whole-branch review; reproduce and fix Important/Critical issues RED→GREEN.
- [ ] Required full gates green; reconcile latest main without dropping other work; run merged gate.
- [ ] Normal non-forced gated push, exact-SHA Vercel Ready, read-only Production verification, user-facing links and limits.
- [ ] Only after the first released increment is confirmed, begin legacy damaged/missing/maintenance returns.
