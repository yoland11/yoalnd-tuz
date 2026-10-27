# Vehicle partnership: partner expenses, reimbursements and printing

The existing vehicle workspace is `/admin/vehicles/:id?tab=partnership`. This extension uses the original single partnered vehicle, original parties, expenses, monthly closing, financial approvals, MASTER cashbox, canonical payment state, and printing helpers. It adds no schema, transport record, vehicle, salary, cashbox or expense system.

## Employee workflow

1. In **النشاط والمصاريف**, choose an existing vehicle expense under **مصروف مدفوع من الشريك**. Select the actual payer from the agreement effective on the expense date, and explicitly choose an operating cost or capital investment and a reimbursable advance or capital contribution. No amount is re-entered.
2. Submit it to the existing financial approvals. An outstanding original company cash request must first be cancelled through its original workflow. An expense already paid by the company cannot also become a partner expense.
3. Approval creates the original noncash expense/investment and corresponding advance or capital right once. Capital contributions do not become reimbursable advances or change ownership percentages.
4. After the original cost month is approved, **المستحقات والتسويات** offers **طلب تسديد سلفة** against an approved advance. Partial requests reserve only their own amount. Administration must approve the original pending financial request before cash and paid balances change.
5. **الكشوف والطباعة** provides current partner/vehicle statements in A4/PDF, frozen approved-month reports, and 80mm receipts for actually executed profit, advance and driver payouts. Receipt numbering reuses the original FIN number. Reprinting never creates a transaction.

## Financial caller impact

- `routes.ts` exposes only source-owned cost and advance-request commands on the original scoped vehicle endpoint, with the original financial writer injected.
- `accounting.ts` dispatches the trusted advance reference; it rejects mixed distribution/advance payloads. All existing activity, cost, capital, monthly and driver producers retain their own paths.
- `master-cash-box.ts` adds an advance source preflight/finalizer to the existing principal-only cash block. It posts `VP-ADVANCE / 1000`, not another expense, and keeps operating revenue/expense totals unchanged.
- `posting.ts` directs rejection/cancellation of original advance transactions to their source proof and canonical reconciliation. Executed cash reversal remains blocked rather than fabricated.
- `workspace.ts` adds a bounded read-only association with the original expense's approved month for the advance button. The server independently re-proves the frozen cost, agreement, advance and financial origin before any request or approval.
- No existing booking prices, invoices, protected A4 designs, payroll amounts, inventory movements or historical financial rows are rewritten.

## Cash and concurrency safeguards

The transaction acquires partnership root, original booking/month source locks, vehicle and cost locks, rights and original finance proofs, and only then the original MASTER posting boundary. The root serializes partnership requests. Durable nonce replay precedes mutable source/capacity reads. Immutable request audits and exact primary/coverage allocations are validated before approval; only this request's proven pending holds are added back.

The original approved cost must occur exactly once in the frozen month, with matching funding ID, original expense, original noncash financial ID, amount, date, source snapshot and digest. A zero month additionally uses the existing approved-month reader to prove the original administrative zero-approval audit. Cash is mapped inside real approved internal conversions through the same payout FI, never by creating another gross payout.

## Verification and explicit limits

Focused tests exercise exact large money, original dated payers, source mismatch, approval, partial cash, retry, overpayment, duplicate/forged allocations, rejected/cancelled holds, audit rollback, zero-month approval proof, capital separation, frozen reports and receipt source/ledger proof. The actual original MASTER cash function is exercised under a controlled transaction adapter. Typecheck, build, payment-state and critical gates must pass before release.

Live database write/concurrency/save-smoke coverage is **SKIPPED** when there is no separately verified TEST database; controlled tests do not claim PostgreSQL concurrency proof. No Production business diagnostic writes are permitted. No new migration is needed; previously activated migration 0129 must not be reapplied.

Reimbursement currently requires the original cost month approved and partnership ownership still active. Early reimbursement before closing, ended-ownership settlement, controlled executed-cash reversals, dated prior-period adjustments and extended driver conversion coverage remain separate unfinished work. A physical thermal printer/PDF device test is not implied by HTML/layout tests or opening a browser print dialog.
