# SDD ledger — plan: C:/project/yoalnd-tuz-main/docs/superpowers/plans/2026-10-11-smart-booking-operations.md

## Scope: complete the operations room only

Base 8196357e00ce8b552faef51498812f0af55e05c2; clean existing isolated worktree. Latest user explicitly limits work to the room. Existing premium RTL UI and read-only API are the baseline.

1. Read actual execution/team acceptance and vehicle condition; show only supported evidence. Add operational alerts and attention views, with a clearly bounded previous-30-day view for outstanding work.
2. Apply supported search/category/status/location/vehicle filters before the bounded cohort query, preserve legacy/source identity, and retain selected filters/URL state. No misleading ready certification or zero conflicts.
3. Test focused real projections, emitted SQL/authorization and browser interaction at desktop/tablet/mobile; run typecheck/build/critical and independent final review. Release only completed verified room changes under AGENTS policy.

Ruling: this request permits room-specific read adapters, not new loading, profitability, resource reservation writers or bulk mutations — these remain outside the latest explicit scope — cost if wrong: incomplete authoritative resource timing stays visible as unknown rather than blocking delivery of the room.

## Caller and data audit

- `loadDailyOperations` has one production caller: the private GET branch of `handleEnterpriseAdmin`; UI consumer is `DailyOperationsTab` within the existing Command Center. Existing API callers continue to work with additive fields/default filters.
- Native Kosha acceptance: `kosha_work_orders.booking_id` references **native kosha_bookings only**; member `accepted_at/declined_at/removed_at/status` is authoritative. Never join a service booking's same numeric ID.
- Service photography acceptance: `photography_shoot_crew` + `photography_shoots.booking_id` reference service_orders; use live non-cancelled shoots and explicit acceptance, not task progress as guessed acceptance.
- Vehicle identity/condition comes from the original `fleet_vehicles` join; dispatch is not proof of availability. Inactive/maintenance/missing vehicles must not pass the condition check.
- Manual preparation and quantity counters continue using existing metadata and quantity normalizer. Archived/cancelled bookings stay excluded; completed bookings do not inflate needs-preparation.
- No schema, payment/accounting, stock, A4, permissions semantics or original mutation helper changes. No notification emitted by loading the room.

## Evidence

- RED→GREEN: original member acceptance was ignored (unknown instead of pass); actual evidence loader failed the same source-bound acceptance test before its extension. New projections cover pending/partial acceptance, vehicle maintenance/customer transport, missed required arrival, previous-event equipment, closed bookings, attention/KPI separation, last-30-day bounds and namespaced URL isolation.
- Emitted-SQL coverage: requested filters are parameters before ORDER/LIMIT; work-order and photography membership use their original source relations; removed/declined/rejected membership is not accepted. Database failures still propagate.
- Browser RED→GREEN: missing attention button timed out first; explicit accessible employee selection then exposed the old ambiguous wrapped-select label, fixed with stable accessible names. Actual component/CSS fixture now passes at 1440/768/390px including attention drilldown, employee selection, reload restoration, clearing filters, search, failure/recovery and no writes.
- `pnpm run typecheck`: PASS after model/loader/UI changes. Existing four room suites and the two new completion/evidence suites pass.
- No new TEST database, credentials, schema or Production data changes. TEST database/write smoke remains SKIPPED, not passed. First full critical gate passed before final-review corrections; the final gate is rerun below.

## Final review and correction pass

Independent whole-slice review found no Critical issues and four Important issues, all reproduced by failing tests before correction:

- Original work-order checkout/return manifest: bounded read of `kosha_work_order_assets` through its original native booking FK. Checkout-only, returned, damaged/missing/maintenance, matching physical-ID overlap and mixed-quantity evidence are covered. Same physical identity is not summed twice. Inconsistent/mixed custody records display a review warning instead of claiming an exact reconciled quantity. Returned maintenance items remain problems, not outstanding checkouts.
- Baghdad naive `required_arrival_at`: interpret datetime-local/SQL wall-clock values as Baghdad UTC+03:00, retain explicit offsets and Date instants, reject invalid timestamps rather than hide errors. UTC-runtime regression now detects a 15:00 Baghdad missed arrival at 12:01Z.
- Pre-limit search: SQL now matches the projection's number-then-customer ordering, including the actual `KOSHA-id` / `SRV-id` legacy display fallback. Combined name/code search stays parameterized before LIMIT. Emitted SQL and real projection tested, not claimed as a live PostgreSQL integration test.
- Active field KPI includes the canonical photography `shooting` stage; transitioning from `on_the_way` no longer removes an active booking.

Final: Ruling: regrade the two false KPI drilldowns from Minor to Important — clicking a labelled metric silently showed unrelated bookings, so those metrics are now explicitly noninteractive until they have real matching filters; existing supported drilldowns remain — cost if wrong: two counters cannot be used as shortcuts, with no loss of the stage filter. The real SSR regression failed first and passes after correction.

Final: Ruling: Production schema availability, actual query execution/plans and isolated write integration were not certified by the reviewer or fixture suite — retain honest evidence labels and AGENTS normal-release skip policy, do not introduce credentials or a test database — cost if wrong: a Production-specific read error must surface through the existing structured boundary and needs a read-only follow-up; no writes occur.

Final: Ruling: full resource-occupancy conflict certification, loading/profit/bulk writers and unrelated unfinished phases are outside this room-only slice — keep them unchanged and display conflict/requirements checks as unknown — cost if wrong: the room requires manual operational review and must not be mistaken for an automated reservation guarantee.

No deferred Minor findings remain after the severity reassessment. The final pass does not alter original checkout/return writers, cancellations, historical records, stock transactions or financial state.

Final: fixed missing work-order manifest — original-manifest regression RED→GREEN, full room suite 7/7 scripts PASS.
Final: fixed naive Baghdad timestamp — UTC-runtime wall-clock regression RED→GREEN, full room suite 7/7 scripts PASS.
Final: fixed SQL/projection search disagreement — fallback/combined-search regression RED→GREEN, full room suite 7/7 scripts PASS.
Final: fixed missing active shooting stage — on-the-way/shooting KPI regression RED→GREEN, full room suite 7/7 scripts PASS.
Final: fixed misleading KPI shortcuts — real SSR regression RED→GREEN, full room suite 7/7 scripts PASS.

## Final verification (2026-10-18)

- `pnpm run test:booking-daily-operations`: PASS, all seven scripts including original-model/store/auth/UI and completion/evidence/review regressions.
- `pnpm run test:booking-daily-operations-browser`: PASS, actual component plus AJN CSS at 1440/768/390px; filters, original-source links, error/retry, reload state, attention selection and no writes/overflow. Desktop/mobile screenshots visually inspected. This is an intercepted read-API fixture, not authenticated Production data certification.
- `pnpm run verify:critical`: PASS, exit 0 after the final correction pass; includes `pnpm run typecheck`, central payment-state regression checks, configured critical tests, `pnpm run build` and `git diff --check`. Original pre-push gate will run again on release.
- `test:save-smoke` / isolated database integration: SKIPPED, no separately verified TEST_DATABASE_URL configured. No new test database created. `verify:strict` not claimed.
- Lint: no configured package lint command, not invented or claimed.
- No database migration, secrets, Production writes, financial/inventory writers or A4 changes. Only the room adapter/model/UI and their checks changed.
- Existing host-managed worktree and broader plan scratch are preserved: other unfinished phases share that plan; deleting their workspace is not authorized by this room-only request.

Release target: existing Git main → connected Vercel Production integration, through the original safety hook. Exact release result is reported after it is observed, not inferred from these local checks.
