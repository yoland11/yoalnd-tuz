# SDD ledger — plan: docs/superpowers/plans/2026-10-22-booking-resource-writers.md

Spec: approved resource-conflict requirements and owner's current explicit instruction to complete date/assignment/standalone photography then verify/release.

## Audit and decisions

- Ruling: continue the approved resource plan inline, without another design questionnaire — current instruction selects the remaining writers explicitly — cost: this is a multi-module change and must not be described as complete until every selected writer and final gate is covered.
- Ruling: reuse the clean attached preparation-print-formats checkout on new branch `codex/booking-resource-writers`, fast-forwarded to `6a058bc01` — the previous active checkout contains unfinished history-cap work — cost: keep both checkouts, no stash/reset or inclusion of that unfinished work. Primary dirty checkout untouched.
- Original date save validates the window against the old event date; no atomic date+period route currently exists. Original native transport edit uses same-day native-booking lookup, not shared period locks. Original dispatch helper already locks source/fleet/crew but does not cover every native transport writer.
- Staff conflict reader currently sees central/native bookings and linked photo crew only; standalone primary/event crew are absent. Keep financial/inventory `BookingOperationRef` as Kosha/service; a photography scheduling identity must be scoped to staff/conflict refs only.
- Shared `syncCentralBookingToPhotography` callers: service creation, requested-date approval, service edit/restore, photo event edit in api.ts; graduation photographer action; integration backfill. Current helper reads source/assignments before its transaction. Every caller must retain its old permission, financial and notification behavior when the scheduling guard/optional transaction is introduced.
- Shared `findPhotographerConflict` callers: crew assignment and graduation photographer selection; preserve the existing contract and authorized override policy while sharing transactional staff occupancy checks.
- Standalone event schema has event day/start/end but no complete preparation/loading/transport/return window. A nullable additive field may be required; no other schema or historical rewrite is justified. Linked events must use their existing central source instead of a second authoritative copy.
- The existing native transport paid/executed-payment restriction remains in place; do not bypass it while adding operational locks. No financial logic changes are planned.
- Pre-flight: Task 1 supplies the same canonical window and optional explicit calendar options used by Task 2; Task 3 must share the staff lock order and participate in Task 1/2's original transaction. Photo integration cannot commit separately before/after a calendar change.

## Progress

- Clean base `6a058bc01`: full baseline critical gate exit 0 (`.superpowers/resource-writers-baseline.log`). Isolated database write smoke skipped, not passed.
- Task 1 RED: storage rejects the proposed day against the old calendar; route has no opt-in contract; SSR form lacks the control. GREEN: optional calendar+period transaction, original date/window stale checks, retry deduplication, Baghdad projection and callback rollback. Existing five-argument period saves remain compatible.
- Existing period suite exit 0 after core/UI changes; actual browser fixture exit 0 at 1440/768/390, including failed calendar-save draft, retry, keyboard opt-in, source identity and no RTL overflow. Visually inspected `reschedule-390.png`; desktop/tablet visual inspection still pending. Controlled IO only, not authenticated Production or real DB concurrency certification.
- Typecheck exit 0 after Task 1, before Task 2's latest changes. Final typecheck/build/critical gate still required on the final tree.
- Task 2 RED/GREEN: new original-write transition guard checks the candidate inside the caller transaction, including restoration and end-time aliases. Three actual original mutation expressions (native edit, service edit, requested-date decision) now use it; controlled route tests prove conflict rollback and successful commit. Shared caller scope is limited to these selected writers so far. Other writers/creation/linked sync remain under audit; this is NOT complete writer coverage.
- Preserved native transport paid/executed-payment restriction, protected operational JSON leaves, original item writes, status history and downstream financial calls. No new stock/payment transaction or financial formula.
- Installed shadcn documentation CLI failed because its transient MCP SDK dependency was unavailable. Reused and inspected the installed AJN Checkbox/Field components instead; no new dependency or UI theme.
- No schema migration, Production data write, commit, push or deployment in this increment yet. Standalone photo and transactional linked-photo sync are still pending; do not release the partial tree.

## Later progress (supersedes the earlier checkpoint)

- Standalone primary/crew occupancy now participates in the existing staff query, bounded across original sources. `photography` is a staff/report-only identity, never a finance/inventory booking source. Report links open the existing numeric event route; no private token is added to the new DTO.
- Added nullable `photography_events.resource_window` to Drizzle and isolated migration 0127. **Migration not applied**; no historical backfill, schema rollback or Production data mutation. The new standalone period helper has controlled-IO GREEN coverage for all crew, legacy unrelated edits, atomic day/window save, lost-response retry and audit failure rollback. API/UI connection remains pending.
- Shared linked sync now locks/re-reads the central source and accepts the caller transaction. Classification, staff lookup and audit also use that executor, avoiding a second checkout on Vercel's one-connection pool. RED default-connection failure → GREEN supplied-transaction tests. A moved event checks all current crew using one sorted staff lock set. Unchanged legacy refresh/backfill is not a second staff allocation; original source writers must guard new assignments.
- Native/routed/service edit and requested-date mutation tests now execute their actual transaction expressions. Service edit/reschedule/routed callbacks perform photo sync inside the original transaction, and tests prove sync failure rolls the actual source values/status history back. Removed their old post-commit catch-to-null sync. Operational period save also supplies its original transaction to linked sync.
- Transportation and workflow-stage adapters use the same guard and fresh original operational JSON; workflow stage/status save is atomic. No financial formula, payment-state implementation, inventory movement or A4 presentation changed. Creator/remaining assignment adapters and the original photo event/crew writers are still incomplete.
- Transition tests additionally prove releasing employee identities and editing only equipment description do not require inventing a period for valid legacy records. No new allocation is skipped: timing/activation/quantity/stage changes still validate.
- Latest complete progress critical gate (before these last additions) exit 0, including production build; isolated DB tests SKIPPED. Latest final-tree gate/review/release is still outstanding.

## Current implemented boundaries (2026-10-23)

- Original native/public creation now keeps the customer, original booking, tracking code and resource creation check in one transaction. Optional explicit timing lives in existing booking operations JSON; unassigned requests need no invented duration. No booking amounts or payment rules changed.
- The two original service creation callers share inserted-resource validation. Admin creation supplies its existing photo sync as a trusted transaction callback; customer, priced service items, history and original event/shoot linking roll back together if resources or sync fail. Service archive restoration shares the original transition guard and linked sync. Known resource errors retain their AJN structured error type/status.
- Original photo creation reuses its existing client token, verifies ownership on replay, checks the whole explicit period and writes no second booking/reservation. Linked events continue to use the central source and period; standalone events use only the nullable original event field.
- Original photo edit, crew add/remove, archive/unarchive, assignment decision, explicit shoot stage and edit-room implied stage run through the original source/event locks. Reopening checks current occupancy. Ordinary legacy descriptive edits and active-stage progression are not new allocations. Edit-room corrections cannot implicitly reactivate cancelled/completed shoots; explicit authorized stage reopening is the guarded path.
- Stage-to-central and central-to-event synchronization accept the caller executor. Classification, original customer/crew/source reads, status history and sync audit do not escape into another pooled connection. Same-day period extensions invoke the existing configurable reacceptance policy, not a second policy or status engine.
- Canonical period save checks active staff, current vehicle/crew eligibility and external dispatch holds as well as overlapping bookings. Explicit calendar changes refresh only existing native JSON time aliases and the original native date/time; period-only saves do not change the original calendar.
- Original photo portal uses the same four labelled Baghdad-time inputs and source-scoped editor. Failed saves retain drafts; source changes discard only the previous event's UI draft. Pending local events cannot create photo orders until the original event is confirmed by the server. Read errors are visible/retryable, never a false empty-order state. Descriptive manager edits do not replay an outdated date after rescheduling.

## Validation and release notes

- Focused controlled-IO suites exercise the actual original API mutation expressions, shared guards and sync helpers. They are not certification of real PostgreSQL concurrency.
- Actual component browser fixtures exercise 1440/768/390 RTL, explicit calendar opt-in, invalid time order, conflict/read failure, retry, duplicate submission, event/source switching, pending draft recovery and refreshed original header. Screenshots live under ignored `tmp/booking-resource-window-review` and `tmp/photography-resource-review`.
- The conflict report remains explicitly partial: it returns the first recorded overlap per resource and cannot turn missing historical timing into availability or operational readiness. Standalone photo primary/crew participates in the same staff occupancy query. Unfinished history-cap work in another checkout is not included.
- No lint script is configured. Without separately verified `AJN_ENV=test`, `ALLOW_TEST_WRITES=true` and `TEST_DATABASE_URL`, database save-smoke/integration/concurrency checks are **SKIPPED**, never passed. No Production diagnostic write or new test database.
- Migration `0127_photography_resource_window.sql` is isolated, nullable and additive, with no backfill/default/history rewrite. It must be reviewed, applied alone using the authoritative owner connection, and its column verified before deploying schema-dependent code. Prefer a forward fix; never drop the column or rewrite historical rows as automatic rollback.
- Full final-tree typecheck/build/payment-state/critical gate, one whole-increment review, exact-SHA main release and Vercel Ready verification must finish before the increment is described as released. At this documentation checkpoint no new commit/push/deployment or migration has occurred.

## Final review corrections

The single whole-increment review identified two Critical and three Important correctness issues, all addressed in one tested fix pass:

- Graduation photography was another original service-creation caller: date/time-only student selections now remain explicit pending requests, not confirmed photographer allocations. The requested employee stays recorded without becoming an occupancy alias. Original service creation, creation validation, portal sync and graduation link are atomic; existing graduation financial records/formulas are untouched.
- Legacy event identity is resolved across the event, shoot and every original crew row before occupancy classification. Primary and secondary employees use that same central identity/period. Contradictory/missing central links fail closed; true standalone events retain photography-only scheduling identity.
- Acceptance honors only a persisted manager-approved override on the exact assignee, not employee-supplied override text. Other crew/driver, period, eligibility and failed-read protections remain active. The composed original assign-with-override → accept path is tested with the real allocation checker.
- Period-only changes cannot contradict populated calendar start/end clocks. Explicit calendar opt-in can repair an existing end-time mismatch even when the saved date/window/start look identical.
- Native and service Kosha availability use the same allocating statuses as the writer, including actual `processing`/`booked` workflow behavior.

Focused RED→GREEN regressions are in `test:booking-resource-review` and the original period suites. Real PostgreSQL execution/concurrency is still explicitly unverified without an isolated database; no extra database or destructive diagnostic was introduced. Full post-fix gates and deployment proof remain mandatory.

## Final release checkpoint (2026-10-23)

- Fresh post-review `verify:critical` exited 0 on the completed tree, including TypeScript, payment-state, all critical resource/stock/custody regressions, production build and whitespace checks. Both actual component browser suites exited 0 at 1440/768/390 RTL. No lint script is configured.
- Isolated database save-smoke/integration/concurrency remains **SKIPPED**, not passed. Production booking/payment/inventory write smoke tests were not run.
- Applied only reviewed additive migration `0127_photography_resource_window.sql` through the existing owner-connection runner. A first metadata verification connection failed without changing data; a separate read-only retry verified `public.photography_events.resource_window` is nullable `jsonb`, with no default. No historical backfill, row rewrite, other migration or security weakening.
- The single final review's five findings are fixed with RED→GREEN tests. Unfinished history-cap and unrelated primary-checkout work are excluded. Release must use the normal mandatory pre-push gate; exact-SHA GitHub/Vercel proof is recorded after it completes.
