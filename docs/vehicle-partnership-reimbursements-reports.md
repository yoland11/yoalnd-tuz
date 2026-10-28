# Vehicle partnership: partner expenses, reimbursements and printing

The existing vehicle workspace is `/admin/vehicles/:id?tab=partnership`. This extension uses the original single partnered vehicle, original parties, expenses, monthly closing, financial approvals, MASTER cashbox, canonical payment state, and printing helpers. It adds no schema, transport record, vehicle, salary, cashbox or expense system.

## Employee workflow

1. In **النشاط والمصاريف**, choose an existing vehicle expense under **مصروف مدفوع من الشريك**. Select the actual payer from the agreement effective on the expense date, and explicitly choose an operating cost or capital investment and a reimbursable advance or capital contribution. No amount is re-entered.
2. Submit it to the existing financial approvals. An outstanding original company cash request must first be cancelled through its original workflow. An expense already paid by the company cannot also become a partner expense.
3. Approval creates the original noncash expense/investment and corresponding advance or capital right once. Capital contributions do not become reimbursable advances or change ownership percentages.
4. After the original cost month is approved, **المستحقات والتسويات** offers **طلب تسديد سلفة** against an approved advance. Partial requests reserve only their own amount. Administration must approve the original pending financial request before cash and paid balances change.
5. **الكشوف والطباعة** provides current partner/vehicle statements in A4/PDF, frozen approved-month reports, and 80mm receipts for actually executed profit, advance and driver payouts. Receipt numbering reuses the original FIN number. Reprinting never creates a transaction.
6. Administration can select an approved month in **الكشوف والطباعة** and choose **ربط دفعات السائقين بالشهر**. Confirm the reason to classify that month's already executed driver payments inside its available approved internal conversions. The result shows each original FIN, its paid amount, covered amount and amount already paid outside the conversion. This is a classification of existing cash, including payments made before closing, and never another amount due or another cash payment. Existing nonzero mappings remain immutable; repeating the operation reuses them.

## Financial caller impact

- `routes.ts` exposes only source-owned cost and advance-request commands on the original scoped vehicle endpoint, with the original financial writer injected.
- `accounting.ts` dispatches the trusted advance reference; it rejects mixed distribution/advance payloads. All existing activity, cost, capital, monthly and driver producers retain their own paths.
- `master-cash-box.ts` adds an advance source preflight/finalizer to the existing principal-only cash block. It posts `VP-ADVANCE / 1000`, not another expense, and keeps operating revenue/expense totals unchanged.
- `posting.ts` directs rejection/cancellation of original advance transactions to their source proof and canonical reconciliation. Executed cash reversal remains blocked rather than fabricated.
- `workspace.ts` adds a bounded read-only association with the original expense's approved month for the advance button. The server independently re-proves the frozen cost, agreement, advance and financial origin before any request or approval.
- No existing booking prices, invoices, protected A4 designs, payroll amounts, inventory movements or historical financial rows are rewritten.

### Driver conversion classification

The source-owned `closings/driver-coverage` POST is admin-only and has no financial writer. `driver-coverage.ts` validates the selected version/digest, the original approved month and its journal, frozen wage sources and existing conversion parents, then re-proves each original executed driver payment. It appends coverage allocations and separate immutable mapping/operation audits in one transaction. Original driver request proposals, settlement IDs and cash/ledger rows remain unchanged. One stable nonce replays its saved result before mutable month checks; a new attempt reuses any existing nonzero payment mapping. Queries are bounded and a mismatch fails the complete transaction.

The shared right canonical adapter accepts only this exact proven executed driver source with conversion coverage. `driver-cash-source.ts` independently verifies the original settlement, wage, funding, expense, approved execution metadata, cash balance difference and original accrual/cash journals. `driver-coverage-proof.ts` validates immutable mapping hashes, original financial request proofs and the frozen wage/revision and conversion parents. These read-only helpers do not call full driver payout preflight, avoiding recursive reconciliation. The original employee canonical path still counts the driver's actual cash once. The blast radius is the existing right reconciliation dispatcher (workspace, statements, payout capacity and monthly unused/reopen guards); every other source retains its original contract.

## Cash and concurrency safeguards

The transaction acquires partnership root, original booking/month source locks, vehicle and cost locks, rights and original finance proofs, and only then the original MASTER posting boundary. The root serializes partnership requests. Durable nonce replay precedes mutable source/capacity reads. Immutable request audits and exact primary/coverage allocations are validated before approval; only this request's proven pending holds are added back.

The original approved cost must occur exactly once in the frozen month, with matching funding ID, original expense, original noncash financial ID, amount, date, source snapshot and digest. A zero month additionally uses the existing approved-month reader to prove the original administrative zero-approval audit. Cash is mapped inside real approved internal conversions through the same payout FI, never by creating another gross payout.

## Verification and explicit limits

Focused tests exercise exact large money, original dated payers, source mismatch, approval, partial cash, retry, overpayment, duplicate/forged allocations, rejected/cancelled holds, audit rollback, zero-month approval proof, capital separation, frozen reports and receipt source/ledger proof. Driver classification tests also cover payments predating monthly approval, missing execution metadata, immutable wage-month proof, same-FI identity, partial/no conversion capacity, original driver balances, changed targets, admin-only access and controlled atomic rollback. The actual original MASTER cash function is exercised under a controlled transaction adapter. Typecheck, build, payment-state and critical gates must pass before release.

Live database write/concurrency/save-smoke coverage is **SKIPPED** when there is no separately verified TEST database; controlled tests do not claim PostgreSQL concurrency proof. No Production business diagnostic writes are permitted. No new migration is needed; previously activated migration 0129 must not be reapplied.

Reimbursement currently requires the original cost month approved and partnership ownership still active. Early reimbursement before closing, ended-ownership settlement, controlled executed-cash reversals and dated prior-period adjustments remain separate unfinished work. Driver conversion classification requires the original approved wage month; it does not invent missing historical sources, reassign cash to another month, or silently top up an existing immutable partial mapping. A physical thermal printer/PDF device test is not implied by HTML/layout tests or opening a browser print dialog.
