# SDD ledger — plan: C:/project/yoalnd-tuz-main/docs/superpowers/plans/2026-10-11-smart-booking-operations.md

## Continuation: Booking Center operational readiness

Base: cb5e3e60bf9752e446ab7707573c6ba73d983f84. Reuse the clean isolated release worktree; primary graduation edits and the old mixed operations branch remain untouched.

The next incomplete foundation deliverable is honest readiness in the actual Booking Center and booking workspace. Current list readiness is a client-side service/payment/contract weighted guess; the workspace also invents warehouse percentages. Daily Operations already reads original preparation, task, work-order acceptance, vehicle and custody facts. Reuse that projection and source identity rather than creating another stock/booking subsystem.

1. Shared mandatory/optional readiness evaluator, covered RED→GREEN. Unknown mandatory checks prevent ready; money is not an input.
2. Reuse the bounded daily reader for explicit authorized booking refs, without its date horizon. Add read-only readiness to the existing list opt-in and single workspace GET; preserve original contracts and all financial fields.
3. Replace guessed list/workspace percentages with recorded checks, exact resolution links and explicit unknown/error states. Reuse existing premium RTL components; desktop/mobile browser verification.
4. Focused tests, independent whole-slice review, full critical/typecheck/build/payment-state gate, original pre-push hook and connected deployment only after success.

Pre-flight: list and workspace consume the same evaluator/read adapter; Daily Operations must retain its existing filters, source scoping, cancelled exclusion, counts and URLs. List reports must not load thousands of operational records; they show unavailable readiness when no evidence was requested. No mutations or new schema are required.

Ruling: current AGENTS safe auto-release and later iterative-publish requests supersede the old plan's no-publish wording — release this completed verified read-only slice, not the old mixed branch — cost if wrong: delivery is incremental rather than all five phases at once.
Ruling: no TEST database is created; absent isolated write coverage is SKIPPED under current AGENTS, never passed. Reservation/checkout writers, full occupancy certification, reminders and financial intelligence are unchanged here — cost if wrong: unverified mandatory requirements stay explicitly unknown and cannot certify ready.

Caller/blast radius before changes: `loadDailyOperations` currently has one production caller, the private command-center daily GET. It gains an optional validated explicit-ref scope with unchanged default behavior. `handleCentralBookingCenter` list is used by preparation coverage and report/UI readers; operational evidence is opt-in for the on-screen list only, preserving its default array/report contracts. `handleBookingOperations` is the existing permission boundary for the detail workspace; the new GET reuses its already-authorized source/ref and existing structured-error wrapper. No mutation/auth helper changes. `bookingOperationProducts/assets` and the legacy overview readiness fields remain unchanged for other callers.

## Implementation and evidence

- Shared mandatory/optional evaluator observed RED before creation, then GREEN. Unknown mandatory evidence prevents ready; optional unknown means follow-up; no applicable checks gives null, not 100%. Only operational DTO fields are emitted, not arbitrary financial input properties.
- Daily room now uses that evaluator without changing its recorded preparation, task, acceptance, vehicle or custody projections. All seven existing room scripts remain PASS after integration.
- Exact source+ID reader observed RED, then GREEN; a 2020 booking or missing event date is assessed without today's date filter. Bounded to 1000 refs (the existing on-screen native/service caps), deduplicated source-aware refs, original errors propagate. No write, schema initialization or stock adjustment.
- Readiness GET observed 404 RED, then GREEN. Authentication/explicit global booking-read permission is required before data access, including valid legacy supervisory roles. Department-only Kosha permission is denied, POST/invalid refs denied, same numeric IDs remain disjoint. Runs before existing legacy runtime schema initializers. Cache-Control private/no-store.
- List opts into evidence; original preparation/report consumers keep the unchanged contract. Reports do not fan out into 20,000 checklists. Responses carry compact status/percentage/timestamp summaries, not every checklist. Regression preserves all three fixture sources' original total/paid/remaining exactly.
- Actual list helper/summary render observed RED for payment/status guesses and 100/80% warehouse guesses, then GREEN after consuming evidence. Old overview fields are kept for backward compatibility but no longer used by these readiness surfaces. Amounts, invoices, printing and original mutations untouched.
- Checklist SSR observed RED before creation, then GREEN. Exact source links, mandatory/optional/not-applicable, unknown/loading/error/stale data and no-requirements states are covered. Transportation refresh invalidates readiness; existing equipment/team/task mutations already invalidate the workspace prefix; detail also refreshes every 30 seconds.
- Browser fixture initially failed because it omitted AJN's actual PrintProvider. Root cause reproduced from browser pageerror; fixture now uses the real PrintProvider/TooltipProvider as App.tsx does. No production print code changed. Real Center and Workspace plus production CSS run against intercepted GET-only APIs, not Production or PostgreSQL.

## Final review and release boundary (2026-10-19)

- Independent reviewer: scoped readiness slice approved, no Critical/Important findings; independently reran `test:booking-readiness` PASS. Source-table uniqueness supports the explicit-reference row cap.
- Final: minor (deferred): booking edit invalidation does not explicitly refresh the readiness key; the 30-second detail refresh eventually updates it.
- Final: minor (deferred): list cache can retain prior equipment percentages for up to its existing two-minute stale time. Unknown mandatory checks still block certified-ready status.
- Final: Ruling: remaining conflicts, requirements, loading, bulk and profitability are not certified by this release — keep unknown evidence visible, continue those tasks separately — cost if wrong: this slice cannot yet certify a booking fully ready.
- Final: Ruling: intercepted browser fixtures and transaction contract tests are not authenticated PostgreSQL E2E or reservation-race evidence — no Production write tests and no new TEST database — cost if wrong: full database write-path validation remains unavailable and explicitly SKIPPED.
- Final: Ruling: merge the newer work-command center from remote main without replacing its routes or applying its migration as a side effect — cost if wrong: integration must pass the combined full gate before release.
- Verification before integration: `verify:critical` PASS (includes typecheck, payment-state, production build, existing and new readiness suites); isolated database/save-smoke coverage SKIPPED. Desktop/tablet/mobile fixture browser 1440/768/390 passed; no configured lint command.
- Integration: merged `origin/main` at `5fe1016ff5afce69363b5f660c1a66a9dcd274b6` without conflicts. Reviewed the remaining readiness-only API/workspace diff against that main; upstream command routes/button remain intact. Full combined `pnpm run verify:critical` PASS, including `test:work-commands`, typecheck and production build. Database integration/save-smoke remain SKIPPED, not passed. No migration was applied.
