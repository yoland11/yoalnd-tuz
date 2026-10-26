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

## Monthly lifecycle extension (2026-10-26, local continuation)

The existing MASTER source writer and execute/cancel/reject/reverse dispatch already cover the whole partnership namespace. The monthly extension will add a trusted preparer and source-specific posting callbacks, preserving the existing outer admin gate/transaction; no generic amount rules, Cash Box formulas or old source branches change. Monthly lifecycle uses the original nine feature tables, immutable revision lines and existing financial audit. Root lock precedes original source locks and source/financial rows. Source digests are revalidated at submission and approval. Real PostgreSQL constraints (migrations 0029 and 0096), not only Drizzle types, require financial amounts > 0: an empty journal uses explicit audited admin approval without a financial row; a zero-net month with real journal legs still uses its positive nominal financial request. No fake amount or constraint relaxation is allowed. Source-specific callbacks invoke canonical reconciliation for affected original/monthly rights. No monthly public POST is enabled until the entire lifecycle passes its gate.

Original-source barrier audit: dedicated service transport POST/PATCH (~33803), generic service custom-fields PATCH (~52018), and original service creation (~11008) all use `guardBookingResourceWrite` / `validateBookingResourceCreation`. Other existing guard callers (~7528,22433,34438,50568,51834 and Kosha creation15376) must retain their normal validation. The shared candidate validator currently skips terminal/archived/unchanged resources before locking a JSON-selected service vehicle; those identity edits can race a monthly source snapshot. The minimal change adds **only** a fleet identity FOR UPDATE lock for a service vehicle in that early-return branch, after the original booking lock. It does not rerun old scheduling/eligibility checks or change old financial values; null optional legacy vehicle IDs still skip it. Normal active resource validation, staff/vehicle lock order and inventory logic stay unchanged. Kosha/dispatch/expense FK writes already participate in the fleet barrier. This is required source serialization, not an invoice/booking redesign. Full booking transition/creation suites are part of critical verification.

Before edits, reviewed the actual dashboard/query callers: `getMasterCashDashboard` is used by the existing MASTER API; its monthly trend and daily totals need the same net operating treatment as monthly totals. `event-brain` and both `employee-performance` revenue-only queries must exclude all partnership memos, including reversals of costs. `executiveDashboard` is called by the existing executive API and needs the same income-only guard. The receivables daily/monthly payment report is a customer-payment reader, so partnership capital cash receipts are also excluded there. No original invoice/payment source filters or financial writes change.

`computeCashboxDrift` is called by the health/reconciliation APIs (including explicit repair callers). Its executed-transaction comparison must use actual cash classification, not operating classification or raw direction; otherwise a noncash accrual falsely signals drift. This change only narrows the read aggregate to real cash and does not perform a repair or write. Predicates do not require partnership schema installation. All valid legacy sources keep their existing treatment. Reader tests extract the actual SQL AST and verify the generated query guards; no mocked test is claimed as PostgreSQL integration coverage.

### Historical salary linking admission review

`getEmployeeSalaryManagementDetail` and `linkHistoricalSalaryPayment` are called only by the existing payroll-line management GET and historical reconciliation POST in `src/server/api.ts`. The routes retain `payroll_view` and `employee_salaries_repair_historical` permission gates, while the mutation retains its admin/manager/accountant check and transaction. The existing suggestion query matches executed expenses by amount/date; the mutation locks and links the selected transaction. Without a source guard, a noncash driver accrual or a future per-trip driver settlement could incorrectly mark a monthly salary paid. Both admission points must reject the complete `vehicle_partnership_` source namespace and `vp_` transaction namespace. Legacy salary sources, amounts, transactional reconciliation writes and historical records remain unchanged. The fix creates no payment, ledger or cash movement.

## Controlled unused reopening caller extension (2026-10-26)

`reverseFinancialTransaction` remains the only public financial reversal boundary. The source-specific monthly delegate adds optional expected version/digest fields; existing API, employee-salary and HR reversal callers pass their original arguments unchanged. Monthly reopening requires those fields plus administrator authorization and immutable original FI/submission/audit proof. The original transaction still owns all journal, header, right and audit writes. No new cash/source endpoint, payout producer or database migration is activated by this extension. The monthly delegate preserves old revision lines and validates only the active revision when guarding original source reversal.

## Monthly profit payout caller extension (2026-10-26)

`createPartnershipSourceFinancialRequest` remains the shared trusted request writer for activity/cost/capital/closing callers and now accepts a source-validated partial profit proposal, optional payment method and full immutable audit proof. The outer `requestPartnerDistribution` transaction creates all primary/coverage allocations and canonical holds; direct public creation is not enabled. Existing noncash descriptors retain their defaults.

`executePendingFinancialTransaction` still runs inside `approveAndExecuteFinancialTransaction`'s principal-only transaction. Only the exact settlement preflight can enter its existing MASTER block with `VP-PROFIT/1000` and exact decimal cash data. Unknown namespace members retain the fail-closed noncash dispatcher. Legacy sources retain their number-based calculations and side effects; the payout branch never feeds its amount/balance through those calculations. Original cash, FI, ledger and audit persistence is reused, not duplicated. The source finalizer then re-proves execution and reconciles the actual right/coverage and monthly completion. Existing central rejection/cancel functions delegate settlement releases to the source handler. Executed settlement reversal remains blocked pending its own controlled cash reversal implementation. No generic mutation/error infrastructure, canonical exclusion option, public route or migration is introduced.
