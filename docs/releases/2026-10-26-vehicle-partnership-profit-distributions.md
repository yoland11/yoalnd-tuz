# Approved monthly profit distribution backend

This checkpoint implements partial and complete payouts of existing approved monthly **profit** rights. It does not activate a public payout endpoint, apply the partnership migration, or claim that the partnership UI/whole system is complete.

## Implemented behavior and reused modules

- The existing trusted central financial request creator creates one pending FI, numbered by the original financial numbering logic. Its existing audit stores the complete immutable proposal, normalized amount/date/payment method, original member/right/month proof and coverage plan.
- A single source transaction creates the FI, proposal audit, one full primary right allocation and optional coverage against that same month's approved internal conversions. Canonical reconciliation reserves them before commit. It does not move cash or alter the original right's source FI.
- An exact request retry proves the prior proposal and allocations before checking mutable capacity. Changed commands with the same key fail visibly. Rejection/cancellation retains history and releases all holds through the existing canonical adapter.
- Principal approval re-proves the original frozen month, balanced journal and exact existing right. It validates only its proven own pending holds, preserving reservations by other requests. No general reservation exclusion or fictitious wallet was added.
- The existing MASTER execution block posts the single cash movement and the original ledger/audit records. A payout debits `VP-PROFIT` and credits `1000`; it is not another operating expense. BigInt decimal amounts preserve cents and large IQD values without passing through the legacy number formatter. Existing operating revenue, expenses and net profit remain unchanged.
- A verified executed retry returns the fresh executed FI without another cash lock/write. Source finalization is idempotent. The month becomes `distributed` only when every approved profit right is fully paid with no pending amount.

## Scope and callers

`master-cash-box.ts` retains its existing principal approval, outer transaction, MASTER row lock, FI posting, chart, journal and audit flow. Other sources retain their original branches/formulas. Only a source-proven `vehicle_partnership_settlement` profit request enters the exact payout branch; unknown source kinds remain blocked. Generic financial forms cannot create or edit partnership sources.

The trusted request reference in `accounting.ts` accepts a strict source-specific distribution proposal. The existing activity, cost, capital and monthly callers remain valid. `posting.ts` adds only source-specific pending rejection/cancellation delegation. No booking price, driver accrual, inventory, invoice design or historical agreement is rewritten.

## Files

- `src/server/vehicle-partnership/distributions.ts`
- `src/lib/vehicle-partnership/payout.ts` and `cash.ts`
- `src/server/master-cash-box.ts`, `vehicle-partnership/accounting.ts`, `vehicle-partnership/posting.ts`
- Four focused `scripts/test-vehicle-partnership-{payout,cash,distributions,distribution-cash}.ts` tests and the existing feature aggregate runner.

## Validation and limits

Focused tests passed after observed RED-to-GREEN runs. They execute actual production functions with controlled SQL/transaction/canonical boundaries, including the real central request creator, pending holds, partial remainder, other pending reservations, exact large IQD/cents, wrong allocation proof, rejection, early/late audit rollback, stale initial execution reply and repeated execution/finalization. Independent source/cash reviews found no Critical or Important blocker. `pnpm run verify:critical` exited 0 (`critical-profit-distributions.log`), including TypeScript, payment-state and feature regressions, original booking/inventory checks and production build. The strengthened source/central-writer integration test passed after that gate; the mandatory pre-push gate will rerun the complete candidate before publication.

No database change is required by this checkpoint. The earlier additive partnership migration remains unapplied; no Production diagnostic/data writes occurred. Live PostgreSQL migration/write/concurrency/save-smoke tests are **SKIPPED** without a separately verified isolated TEST database. No configured lint script exists.

Remaining work includes dated prior-period adjustments, advance reimbursements, driver payments, controlled executed-cash reversals, partner statements, original vehicle UI, reports and printing. Unsupported cash reversal remains explicitly blocked rather than falling through to generic posting. Public producers remain inactive until the complete source lifecycle/UI is ready.
