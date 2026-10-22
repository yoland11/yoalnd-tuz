# SDD ledger — plan: docs/superpowers/plans/2026-10-22-booking-conflict-report.md

Baseline: published/Ready `b681a32660a4134994a323fe614d9e32278a6be8`. Existing clean isolated branch `codex/custody-lock-safety`; primary checkout untouched. Original five-phase spec and owner's latest selected conflict-display/desktop-mobile instruction are the brief.

## Rulings / caller audit

- Ruling: execute the already approved display portion of original Task 3 inline; no new design questionnaire — existing spec, architecture and latest explicit request settle the workflow — cost: conservative scope limits remain visible instead of implying universal resource certification.
- Existing `readResourceBooking` and physical/staff/vehicle/crew/Kosha readers remain unchanged; their existing writer callers retain exactly their prior behavior. New caller is only `loadBookingConflictReport`. `quantityPeriodAvailability` and its original stock/return math remain unchanged. New bounded SQL reads the same canonical quantity commitments/stock holds, plus original self custody/work-order manifests. No second reservation system.
- Original `handleBookingOperations` outer permission gate and read policy reused. Only new GET branch precedes schema initialization; private/no-store, mutations denied, malformed source/ID denied, actual errors propagate to AJN's existing structured API boundary. No shared error infrastructure change.
- Ruling: expose the first matching related booking per resource and a clearly partial snapshot — current guards do not yet cover standalone photography and all competing writers — cost: operator must review those remaining schedules separately; no overall green ready/all-resources-available claim.
- Ruling: unsupported fractional quantity-asset history is incomplete, never rounded down — existing quantity asset counters/model are integer-based; ordinary decimal stock and consumables remain untouched — cost: operator must reconcile the asset unit/history before confirming that item's availability.
- Original period save already invalidates the source-scoped root query key, which refreshes the new report. Other original resource mutations/return logic and financial actions unchanged. Manual refresh and refetch on mount retain snapshot semantics.
- Shadcn docs CLI failed because its cached package lacks `@modelcontextprotocol/sdk`; inspected the installed AJN component sources/rules instead. No dependency, component-system or theme replacement.

## Task 1 — report and route

- Actual original route initially returned 404 (RED), now GET works (GREEN). Tests cover both source identities, strict IDs, permission/auth denial before reads, mutation refusal, private/no-store, no schema setup and propagated DB errors.
- Controlled actual SQL/evaluator tests reproduced wrong period-adapter input (incomplete instead of shortage), then GREEN for required 10 / available 7 / occupied 8 / missing 3, cross-source same numeric ID, old outstanding physical checkout, original fixed custody/work manifest inclusion, malformed/truncated/failing reads and no writes/locks. A missing quantity profile no longer becomes an individual asset; invalid required amounts do not serialize NaN as legitimate quantities. Related quantity-booking link RED→GREEN.
- These are controlled IO tests, NOT PostgreSQL integration/concurrency proof. No Production diagnostics/write tests or database/schema changes.

## Task 2 — original workspace

- New source-scoped report panel directly below existing period editor in Assets. Same AJN components/tokens, readable responsive quantity breakdown, exact source-specific links, keyboard filter and refresh. Error/pending refresh hides stale successful rows. Coverage warning is persistent.
- Real component tests GREEN. Actual workspace browser GREEN at 1440/768/390: cross-source links, keyboard checkbox, original period-save report invalidation, read failure/recovery, delayed old-source response isolation, no page errors/overflow. Screenshots now saved in ignored `output/booking-conflict-report-review/` so production builds cannot clear them; all three new report widths visually inspected.
- Test harness initially omitted the original branches contract; actual browser showed `.assignments.find` error. Fixed only the controlled fixture to match the real API, not production code. Readiness fixture now uses actual pure evaluator instead of incomplete fake shape.

## Final review and verification

- First and fresh final full mandatory gates exited 0. Five existing workflow browser suites (readiness/full workspace, loading/QR/partial-damaged returns/custody, resource periods, preparation groups, staff preparation groups) exited 0. New report actual text-contrast assertion reproduced 4.223:1, then GREEN after darkening only new report secondary text with existing foreground token; 1440/768/390 browser runs pass >=4.5:1 and no overflow.
- One independent whole-increment review completed (the first reviewer failed from model capacity without a verdict; its replacement is the single completed review). No Critical findings. Important: original dispatch rejects vehicle `repair`/`inactive` and crew `inactive`/`unavailable`, but the report initially called them clear. Verified against the original writer; regression RED on `repair`, then GREEN after resource-specific eligibility sets. Existing `outside`/`busy` self-assignment remains accepted. No dispatch writer or shared guard changed. Full mandatory gate after this one review-fix pass exited 0 (`.superpowers/conflict-report-review-fixed-critical.log`); new actual workspace browser suite again exited 0 at all three widths.
- Deferred minor: settled quantity history currently consumes the bounded 500-row allowance. Over-limit returns an explicit error rather than false availability. Historical SQL filtering is deferred to a separately verified optimization so outstanding returns cannot be accidentally dropped; operator reviews the original warehouse history when this explicit limit is reached.
- Ruling: outstanding work-order manifest predicate matches the implemented writer (insertion immediately records checkout); no supported planned/pending manifest writer exists. Do not invent a second planned asset source for hypothetical manual rows — cost: unsupported external/manual historical insertion paths are not certified.
- Review declined PostgreSQL execution/query plans/schema/result-shape certification: accepted boundary; controlled executor tests are not a live PostgreSQL proof. No Production write diagnostics authorized or run.
- Review declined save-smoke, real writes and concurrency: accepted SKIPPED because no separately verified TEST configuration exists; never relabel as passed.
- Review declined live authenticated browser/API integration: accepted limitation; browser IO is intercepted, proving original UI interactions and responsive layout, not live database writes. Release health/auth checks will be read-only.
- Review declined universal standalone photography and unfinished date/transport/photo writers: remain explicitly outside this report increment and visible as partial coverage. No universal readiness or allocation-safety claim.
- Review declined external/manual planned-manifest history: no authoritative contract or supported writer; ruling above applies, no silent history rewrite.
- Review assessed incoming quantity management only for this increment's interactions, not full correctness of that independently published feature. Preserve it unchanged and rerun the merged mandatory/UI gates.
- Review declined merged-build/deployment success: release evidence must come from actual subsequent gates and exact-SHA Vercel status, not the review verdict.
- Remote main advanced to `fb7a15963` (quantity-management menu) during review. Preserve it via normal merge, review integration impact in the same independent pass, and run merged mandatory gate. Do not overwrite its quantity UI/server changes.
- Save-smoke / real DB integration / PostgreSQL race tests: SKIPPED without separate verified TEST configuration. Do not create a TEST DB or run destructive/write diagnostics on Production.
