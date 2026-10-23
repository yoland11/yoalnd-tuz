# Booking conflict history — implementation and verification

Plan: docs/superpowers/plans/2026-10-23-booking-conflict-history.md

- Continue the specifically approved history-limit fix inline on clean `codex/booking-conflict-history-final`, base d7a52c0e9. Original dirty history prototype and primary checkout are untouched.
- Root cause: the report's 501-row query mixes settled history and live/uncertain commitments, then applies the shared 500-row guard before evaluating any row. The old prototype also accepts booleans/empty values through Number coercion and fails its uncertainty regression.
- Approach: report-only single bounded history read (5,000 plus sentinel), retain original helpers and 500 live/uncertain cap. This is bounded capacity, not unlimited history or measured SQL performance. Shared resourceRows, reservation writes, inventory, finance, schema, permissions and UI DTO unchanged.
- Blast radius: new helper → loadBookingConflictReport → original authorized private GET in admin booking operations. No other callers. All original API/error callers reviewed; existing structured failures propagate unchanged.
- Baseline report/route/UI suite PASS. Final gates, review and release pending.
- No isolated TEST configuration verified. Real DB execution, concurrency/save-smoke and EXPLAIN remain SKIPPED; no Production diagnostic writes.

## Implemented and focused evidence

- Actual report RED at 1,001 rows; GREEN after one 5,001-row bounded query and report-only retention. Required10/available7/reserved8/missing3 remains unchanged after 1,000 balanced settled rows.
- Boundaries: 500 live accepted/501 refused; 5,000 total accepted/5,001 refused even if settled. Unknown/fractional/legacy/unreturned/over-returned rows retained; invalid identity fails before filtering. Original private GET and failed reads unchanged.
- Additional composed report RED→GREEN: boolean/empty/array/object/fractional counters cannot become availability through Number coercion; explicit over-returns cannot hide behind the original clamped outstanding helper. Validation is report-only and reuses original normalization/return counts. Cancelled/completed outstanding units still participate in original checkout reconciliation.
- Final verification/review/release pending. No new migration or Production record change.

## Final verification and review

- Fresh full `pnpm run verify:critical` exited0, including typecheck, payment-state, all mandatory regressions and production build. Actual workspace browser suite exited0 at1440/768/390 RTL; screenshots visually inspected. No lint script configured. Database integration explicitly SKIPPED.
- One independent read-only review completed over all five changed/new files: no Critical, Important or deferred Minor findings. Reviewer independently ran the focused report test; Git worktree access in reviewer sandbox was unavailable, so baseline/current content was compared and parent verified actual five-file status/diff.
- Decisions retained: single bounded read and original 500-live guard; malformed historical counters explicitly incomplete; original dirty prototype untouched. Cost: this is not unlimited history and old malformed records require reconciliation.
- Review limitations: PostgreSQL execution/plans/performance/concurrency remain unverified without TEST; unchanged archived-booking/source selection and current-booking asset discovery are not broadened; absent/null optional counters retain canonical zero/default compatibility; shared reservation/financial writers remain unchanged. Cost: no whole-system or live-write certification from this report fix. Release success must be proved separately by normal pre-push and exact-SHA Vercel/health checks.
- No schema change, migration, historical rewrite or Production write diagnostic. Normal gated main release next, only after these completed checks.
