# Approved per-trip driver payment backend

This checkpoint adds partial cash settlements of an existing approved trip-driver entitlement. Public partnership payment producers and the partnership UI remain inactive; the earlier additive partnership migration remains unapplied. It does not claim the whole vehicle partnership feature is complete.

## Reused records and behavior

- One original `vehicle_expenses` driver wage, its approved accrual and its original `employee_finance_entries` record remain the source of the amount and driver. Each payment uses the existing `employee_finance_settlements` table, never a second expense, salary, trip or driver-fee field.
- A source-owned transaction checks the real approved accrual and canonical available balance, stages the settlement, creates a pending FI through the original central trusted request writer, then links and reconciles it before commit. The intentionally nullable staging row is never passed to canonical reconciliation or committed without its FI. Audit failures roll back every staged effect.
- Immutable original-source and full normalized-command proof is stored in the existing financial request audit. An exact retry proves that history before mutable source/capacity reads; a changed command using the same key is rejected. Financial source ID is the settlement ID, while canonical reconciliation always uses the original employee-entry ID.
- Pending requests reserve the entitlement without changing cash or its paid amount. Admin approval re-proves the source, settlement, date/method, digest and exact own pending hold. It never releases or ignores other pending reservations.
- The existing central MASTER transaction performs the single cash movement, journal and audit with exact decimal strings. It debits `VP-DRIVER` and credits `1000`; the expense was recognized by the original accrual, so settlement preserves operating totals. Existing profit payouts still debit `VP-PROFIT` through that same block. The actual source/type/event/account catalog is checked again before posting.
- Repeated execution proves cash snapshots and the original balanced journal, and returns the fresh FI without another MASTER movement. Rejection/cancellation releases the pending hold and preserves the original approved accrual and all history. Payroll-linked, mismatched or orphan settlements fail visibly.
- Historical inactive vehicles/drivers retain valid accrued obligations. Generic cash forms and historical payroll linking remain unable to impersonate these source records. Executed cash reversal remains blocked until its separate controlled workflow is implemented.

## Scope and callers

The shared trusted request reference gains only the source-specific driver command. The existing central approve/reject/cancel boundaries dispatch this exact namespace to the driver proof; legacy activity/cost/capital/closing/profit and other financial callers retain their original contracts. No public endpoint, database schema, invoice design, booking price, driver wage, payroll or production record is changed.

Files added: `src/server/vehicle-partnership/driver-payments.ts`, `driver-payment-origin.ts` and their focused tests. Files extended: `driver-payment-state.ts`, `accounting.ts`, `posting.ts`, `distributions.ts`, `master-cash-box.ts`, exact `cash.ts`, three existing driver/central tests and the feature test runner. The financial caller audit records the precise shared boundary.

## Verification and limits

Observed RED-to-GREEN tests cover the actual source functions and central request/MASTER functions using controlled SQL/transaction boundaries. Cases include 40+60 partial payments, pending-versus-paid, exact own reservation, overpayment, changed nonce payload, stale version, original source/branch identity, date/method/payroll mismatch, altered digest, source history retries, source and central audit rollback, repeated execution and large exact decimal values. Focused feature aggregate and TypeScript passed before the final release gate. Live PostgreSQL migration/write/concurrency/save-smoke is **SKIPPED** without a separately verified TEST configuration. No lint script is configured. No migration or Production write was run.

The final staged `pnpm run verify:critical` exited 0 (`critical-driver-payments.log`), including current TypeScript, payment-state, original financial/booking/inventory regressions, the complete partnership aggregate and production build. Independent origin/state and full producer/central reviews found no Critical or Important blockers. The mandatory pre-push gate reruns the complete candidate before publication. Remaining feature work includes partner advance reimbursement, driver internal-conversion coverage, controlled executed-cash reversal, dated prior-period adjustments, statements, vehicle UI, reports and printing.
