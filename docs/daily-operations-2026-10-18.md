# SDD ledger — plan: C:/project/yoalnd-tuz-main/docs/superpowers/plans/2026-10-11-smart-booking-operations.md

## Current slice: daily operations room

Base: f25483ab2e60279b63e4c116b54bdfa0d3a3cfe6. Existing isolated branch is clean. Execute inline; one independent final review. Existing approved design and subsequent release authorization apply.

Ruling: implement the explicitly requested read-only room before merging unfinished Phase 1/2 writers — current main has newer custody/quantity safeguards; copying the mixed branch would regress them — cost if wrong: exact occupancy conflict certification and loading controls remain separate integration work.

Ruling: use a durable versioned ledger rather than deleting Bash-generated scratch in this managed Windows workspace — preserve user-owned work and evidence — cost if wrong: one extra documentation file.

Pre-flight: Task 3 consumes Task 1 readiness/conflicts, which are not integrated in current main. Unknown checks must remain unknown, never zero conflicts or ready. No status transitions, notifications, financial writes or inventory movements from room reads.

## Caller / blast-radius audit

- `src/views/admin/enterprise.tsx` is the existing `/admin/command-center` page, guarded by dashboard permission. Existing tabs, assets/vehicle deep links and cached `/admin/enterprise/command-center` consumer remain unchanged.
- Add a separate uncached GET `/admin/enterprise/daily-operations` within the existing enterprise router. Require dashboard plus booking-source permission before any query; never use global command-center cache for user-specific results.
- Read native `kosha_bookings` and `service_orders`, original `bookingOperations` metadata, `stock_reservations`, `tasks`, `dispatch_assignments`, `staff`, `fleet_vehicles`, `crews`. Source+ID stays inseparable.
- Existing preparation list is unsuitable for authoritative readiness: it can infer ready from on-hand stock; current overview also weights financial balances. Do not reuse these scores or add another stock calculator.
- Bound date window to Baghdad today/tomorrow/next 7 calendar days, bound loaded cohort, disclose truncation, paginate client presentation. Filter before KPIs. No database schema or shared business helper changes.
- UI uses existing RTL primitives/tokens. Scene: dispatch managers reviewing next actions in a bright office or on a phone. Restrained existing burgundy accents; no decorative motion.

## Verification

- RED→GREEN: missing read model, missing bounded loader, missing route branch and missing actual UI each failed before implementation. Four focused suites pass (`pnpm run test:booking-daily-operations`).
- First `verify:critical`: PASS, including TypeScript, payment-state, production build and all configured critical regressions. No lint script is configured.
- Full local app browser attempt: BLOCKED by missing `DATABASE_URL` in the root public-settings renderer (HTTP 500). No credential added and no Production fallback. Replaced with a test-only server bundling the actual component and actual AJN Tailwind CSS, with every API request intercepted.
- Browser fixtures: PASS at 1440/768/390 pixels; RTL, no document overflow, exact native/service links, search filtering, empty state, check expansion, error and retry recovery, no writes. Screenshots inspected for desktop/mobile. This is presentation coverage, not authenticated Production E2E or PostgreSQL integration.
- Independent final review: no Critical or Minor issues. Three Important data mapping omissions reproduced separately and fixed in one RED→GREEN pass: manual non-info preparation entries; explicit asset preparation damage; canonical workspace transportation precedence. Four focused suites green after fixes.
- Final: fixed manual requirement omission — mixed product/manual/info-only regression RED→GREEN.
- Final: fixed asset damage omission — picked asset with asset:ID preparation damage regression RED→GREEN.
- Final: fixed transport precedence — native/service customer and AJN workspace overrides regression RED→GREEN.

Final: Ruling: PostgreSQL runtime/performance and guarded write certification cannot be inferred from fixture tests — report unavailable integration explicitly; this room is read-only and normal AGENTS release policy permits the skip — cost if wrong: a runtime query/configuration defect may require restoring the previous deployment.

Final: Ruling: full conflicts/loading/bulk operations remain separate work rather than being certified by this room — unknown checks are visible in the UI; no legacy writers or unrelated defects changed — cost if wrong: operators must continue the existing manual verification before dispatch.

Isolated database write tests: SKIPPED, not passed. No separately verified TEST configuration, no new TEST database, no Production writes.

## Final room-slice gate / release decision

- `pnpm run test:booking-daily-operations`: PASS, all four focused suites after review fixes.
- `pnpm run test:booking-daily-operations-browser`: PASS, 1440/768/390px after fixes; screenshots inspected. Test-only output lives under ignored `.next/daily-operations-review`.
- Final `pnpm run verify:critical`: PASS, exit 0; includes `typecheck`, canonical `test:payment-state`, all configured critical regression suites, production `build`, `git diff --check`. Full output `.superpowers/daily-operations-final-critical.log` stays local.
- No lint command exists. No migration, new dependency, credentials, Production data, stock movement, financial formula, payment approval, invoice template or historical record changes.
- Medium risk: a new bounded read endpoint and existing Command Center tab only. Existing command overview/operations/vehicle/assets URLs and behavior preserved. Room polling is uncached/private; no dispatch or notification side effects.
- Owner's current AGENTS safe auto-release authorization applies to this completed read-only slice. Remote main verified at baseline f25483ab2e60279b63e4c116b54bdfa0d3a3cfe6 before integration. Preserve dirty primary and incomplete mixed worktrees. Use original pre-push gate; no force push.
- GO for the read-only room under normal release policy, NOT a claim all five phases are done. Remaining: authoritative full-occupancy conflicts/readiness, loading/grouping integration, bulk actions and profitability certification.
- Runtime PostgreSQL/performance, authenticated live end-to-end, staging/canary, error tracker baseline and rollback rehearsal are not verified. No unsupported claim of those checks passing.
- Rollback trigger: failed Vercel deployment/HTML health, new room query errors or a confirmed permission/data-mapping regression. Restore previous Vercel deployment for f25483ab2 (`GW449LGQfX1a6Cm3mjPtC3nTXjgE`) and investigate; no schema rollback/data rewrite needed.
- Post-push: verify remote exact SHA, connected Vercel status and public command-center/login HTML plus unauthorized room endpoint. Public reads do not certify authenticated data flows.
