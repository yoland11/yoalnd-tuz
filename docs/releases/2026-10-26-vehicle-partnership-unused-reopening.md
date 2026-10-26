# Vehicle partnership: controlled unused monthly reopening

This checkpoint extends the existing monthly source lifecycle. It does not activate a new public monthly producer, apply the partnership migration, or complete the payout/dashboard work.

## Behavior

- An administrator may reverse an unused approved monthly journal in full, with the displayed version/digest and a clear reason. The original financial request key, immutable summary/submission lines, approval audit and all ledger legs prove the exact historical revision.
- Later pending/approved/distributed periods, downstream loss recovery, cash use, pending cash reservations and original company cash-expense history block reopening. Pending cash coverage inside a noncash internal conversion is checked separately.
- The opposite noncash journal uses the original account IDs. Only this revision's monthly rights become reversed. Original trip/cost/capital sources and old snapshots, allocations and audits remain intact. The header returns to draft with a new revision/version and requires approval again.
- An exact reversal retry proves the old revision even after a newer approval. A different key/command or mismatched historical proof fails visibly. No duplicate journal, rights, cash or audit is created.
- A genuinely empty approved month uses a separate administrator-audited `reopen_zero` transition. It creates no zero-valued financial transaction.

## Existing callers and blast radius

The existing `reverseFinancialTransaction` in `master-cash-box.ts` still owns principal authorization and the database transaction. Its callers in `api.ts`, `employee-salaries.ts` and `hr-intelligence.ts` retain their behavior. Two optional fields (`expectedVersion`, `expectedDigest`) are forwarded only to the source-specific partnership handler; no generic accounting, payroll, expense or cash formula is changed. The partnership dispatcher handles monthly sources before the original activity-only guard. The original source guard now checks only the active approved closing revision, so superseded lines cannot incorrectly lock a source forever.

The existing canonical payment-state path releases old conversions and re-derives monthly/original right balances after reversal. Printing is not involved. Booking Center A4 output is unchanged.

## Validation and limitations

The focused monthly reversal, unused-closing and lifecycle tests passed after RED-to-GREEN implementation; an independent read-only review found no blockers in this scope and independently reran those tests. The full partnership aggregate passed. Final `pnpm run verify:critical` exited 0 (`critical-unused-reopening.log`), including TypeScript, payment-state regressions, original booking/inventory checks and the production build. There is no configured lint script. The mandatory Git pre-push gate still runs separately before publication.

Tests execute production functions with controlled SQL/transaction boundaries; they are not live PostgreSQL concurrency evidence. Actual migration/write/save-smoke integration remains **SKIPPED** without a separately verified isolated TEST database. No migration or Production data write was performed.

Remaining: dated prior-period adjustments/opening proof, actual approved partner/driver payouts, statements, vehicle UI, reports and printing. Task 6 and the overall feature remain in progress.
