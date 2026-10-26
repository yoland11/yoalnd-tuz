# Vehicle partnership: shared financial caller audit

Baseline: `eb1caaad4363472503f78453eecd66aeac57318c`, isolated branch `codex/vehicle-partnership`. Audit before Task 5 shared changes. No Production changes or migration execution.

## Original contracts and blast radius

`src/server/master-cash-box.ts` owns financial request creation/update/submission/cancellation, final admin approval/execution, rejection, reversal, MASTER balance, ledger and audit. Existing sources default to cash movement. Unknown transaction types currently fall back to general operating counteraccounts. These defaults must remain unchanged for every old source; partnership source events require a trusted, source-specific opt-in path. Never expose a request-body `noCash`, account code, approval bypass or caller-selected reconciliation flag.

Final approval is **admin only** through `canApproveFinancialTransactions`. Printing is read-only. An agreement's declared capital is not proof of receipt/payment.

| Existing caller | Existing use to preserve |
| --- | --- |
| `src/server/api.ts` | Master Cash Box CRUD/approval/rejection/reversal/recalculation; bookings/orders/invoices/purchases/vouchers; original vehicle expenses; loans; payment reconciliation. Narrow new vehicle routes may delegate, but must not change old calls' defaults. |
| `src/server/installments.ts` | Approval-first installment requests, cancellation/reversal, original installment/source locks and canonical reconciliation. |
| `src/server/employee-advances.ts` | Existing employee advances and repayments, balance-sheet treatment and approved cash movement. |
| `src/server/employee-salaries.ts` | Payroll movement reversal callback; no duplicate driver wage/base-salary change. |
| `src/server/hr-intelligence.ts` | Payroll line/run requests, approval and reversals. |
| `src/server/research-center.ts` | Original research order financial requests and approvals; source invoice projections. |
| `src/server/graduation.ts` | Existing graduation payment requests/source gates. |
| `src/server/graduation-operations.ts` | Existing graduation operation financial integration. |
| `src/server/daily-cash.ts` | Existing schema initialization and daily reconciliation aggregation. Must not mistake a non-cash partnership memo for cash. |
| `src/server/master-cash-box.ts` | Internal source request/target wrappers, canonical approval, cancellation and reconciliation calls. |

Other direct financial readers: `src/server/customer-receivable-repair.ts` is invoice-source-specific; `src/server/payment-state.ts` is canonical source/payment state; vehicle and booking profitability readers use original expense references. `src/server/event-brain.ts` and financial aggregates in API/MASTER require classification review for the new sources before they can be executed. Do not call an old report correct merely because the feature's own report excludes a duplicate.

## Ordering and integrity requirements

Additional reader audit before classification wiring: `employee-performance.ts` has two global executed-revenue aggregations and must apply the same operating predicate so noncash attribution/loss and capital receipts do not raise employee sales scores. `customer-account.ts`, booking-finance/profitability, penalties, receivable repair and payroll readers constrain original source identities; they do not accept partnership attribution as another invoice payment. `integration-health.ts` keeps raw status/integrity diagnostics rather than treating rows as profit. The financial approval notification branch must require actual cash inflow, not the persisted direction alone.

Every partnership writer must lock the selected partnership root before original feature source rows, then financial request/rights in deterministic order, then the existing cash account if needed. The original vehicle-expense approval/reversal path must participate when the same expense is being annotated/funded; an already executed company-paid expense cannot also become partner-paid. Rejected/pending original requests remain in history; do not rewrite executed history.

Pending distributions reserve approved rights, but are never paid. The underlying executed financial transaction is the authority; reversals must net against it. The same direct-to-partner cash movement may satisfy both an internal obligation and a partner distribution through distinct allocation purposes, and must debit cash only once. No fictitious partnership wallet.

Partner-funded repair: original `vehicle_expenses` row once, original amount once, approved funding classification once. Reimbursement settles the approved advance and is not another expense. An existing employee entitlement/source may be referenced but cannot be inferred from equal amount/name. The base currently contains employee-finance schema without server usage of those tables; do not claim a driver settlement integration already exists.

## Verification / publication

Any shared edit requires tests for old and new paths, `test:payment-state`, `verify:critical`, typecheck and build. Actual write/concurrency coverage requires the separately verified TEST guard; unavailable is SKIPPED. The owner's subsequent release instruction authorizes the completed, verified foundation only; unfinished monthly closing, payouts and UI remain local.

## Release-review reader corrections (2026-10-26)

Before edits, reviewed the actual dashboard/query callers: `getMasterCashDashboard` is used by the existing MASTER API; its monthly trend and daily totals need the same net operating treatment as monthly totals. `event-brain` and both `employee-performance` revenue-only queries must exclude all partnership memos, including reversals of costs. `executiveDashboard` is called by the existing executive API and needs the same income-only guard. The receivables daily/monthly payment report is a customer-payment reader, so partnership capital cash receipts are also excluded there. No original invoice/payment source filters or financial writes change.

`computeCashboxDrift` is called by the health/reconciliation APIs (including explicit repair callers). Its executed-transaction comparison must use actual cash classification, not operating classification or raw direction; otherwise a noncash accrual falsely signals drift. This change only narrows the read aggregate to real cash and does not perform a repair or write. Predicates do not require partnership schema installation. All valid legacy sources keep their existing treatment. Reader tests extract the actual SQL AST and verify the generated query guards; no mocked test is claimed as PostgreSQL integration coverage.

### Historical salary linking admission review

`getEmployeeSalaryManagementDetail` and `linkHistoricalSalaryPayment` are called only by the existing payroll-line management GET and historical reconciliation POST in `src/server/api.ts`. The routes retain `payroll_view` and `employee_salaries_repair_historical` permission gates, while the mutation retains its admin/manager/accountant check and transaction. The existing suggestion query matches executed expenses by amount/date; the mutation locks and links the selected transaction. Without a source guard, a noncash driver accrual or a future per-trip driver settlement could incorrectly mark a monthly salary paid. Both admission points must reject the complete `vehicle_partnership_` source namespace and `vp_` transaction namespace. Legacy salary sources, amounts, transactional reconciliation writes and historical records remain unchanged. The fix creates no payment, ledger or cash movement.
