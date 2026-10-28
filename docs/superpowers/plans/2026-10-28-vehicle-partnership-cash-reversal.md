# Vehicle partnership cash reversal

> Execute inside the existing vehicle-partnership plan/workspace. The user approved continued implementation and safe release. No Production diagnostic writes.

Goal: full, admin-approved reversal of an existing executed profit, advance or driver payout through the original MASTER transaction, preserving source IDs and immutable history.

1. RED/GREEN exact cash-in math: preserve stored operating totals, add the original amount exactly, reject overflow and malformed balances.
2. Source preflight and immutable history proof: original request, source, allocation/mapping, approved execution, amount, balance difference and journal; root/source locks before MASTER. First reversal reuses original source admission. Exact retry proves the saved reversal without depending on later mutable source state. No new schema or parallel cash writer.
3. Extend only the three source-owned cash cases in the existing `reverseFinancialTransaction`. Existing noncash partnership and unrelated callers retain their original dispatch. Post one typed cash-in, opposite liability journal, original reversal link and audits atomically; reconcile original driver/primary/coverage sources. Re-derive a refunded distributed month to approved.
4. Explicitly prove fully reversed driver history before excluding it from new monthly coverage; preserve old mappings and permit an independently approved replacement payment. Surface reversed payouts in the existing reports/workspace. Preserve print and source permissions.
5. Run original-function controlled tests, rollback/retry/forgery/permission regressions, all partnership tests, payment-state/typecheck/build/critical gates, review, original pre-push and exact Vercel verification. Isolated PostgreSQL write/concurrency/save-smoke are SKIPPED when no separate TEST configuration exists.

Shared caller impact: MASTER reversal is used by the original voucher route, vehicle-expense reversal, payroll/salary cancellation, HR, booking/order refunds and graduation workflows. New behavior is restricted to `vehicle_partnership_settlement` (`vp_partner_distribution`, `vp_partner_advance_repayment`) and `vehicle_partnership_driver` (`vp_driver_payment`). Generic formulas, source flags and callbacks remain unchanged for all other callers. Full reversal only; partial cash reversal and dated prior-period adjustments remain explicit limitations.

Review focus: retry after replacement payment/month revision; original driver settlement identity versus employee entry; same cash classified across conversion coverage; callbacks/audit/canonical rollback; unchanged legacy reversal and noncash workflows.
