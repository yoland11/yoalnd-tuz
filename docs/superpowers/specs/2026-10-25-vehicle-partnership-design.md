# AJN — Single-Vehicle Partnership Accounting

Status: owner-approved design (2026-10-25, `كمل اشتغل`); native implementation authorized. No commit/push/deploy.
Date: 2026-10-25, Asia/Baghdad.

## Owner decisions and release boundary

- Extend AJN, not a second vehicle, transport, accounting or payroll system.
- Exactly ONE selected existing vehicle is shared by two partners, initially 50/50 ownership, profit and expense/loss shares. Do not enable partnerships on every vehicle or copy the asset.
- The company is the legal registration owner; economic partner interests are separate.
- Internal company transportation is a real entitlement payable to the partnership, not reporting-only. Owner clarified: `تدفع بعد موافقة`.
- Actual company cash is paid only through existing approval and execution. Approval of an entitlement or monthly allocation is not itself a cash payment.
- Driver compensation varies by trip; reuse existing driver-wage/employee entitlement and settlement workflows, never add a second independently postable fee.
- DO NOT COMMIT, PUSH OR DEPLOY, including documentation. Do not change historical records or run write diagnostics on Production.

## Audit context and discovered reuse

Read-only inspection covered the local source and the fetched `origin/main` snapshot `eb1caaad4`. The dirty primary checkout is at `d4180f226`, 99 commits behind that remote snapshot; it is NOT a safe implementation base. Its unrelated graduation drafts must remain untouched. Before implementation, use a suitable isolated checkout at a newly verified current main. A prior uncommitted transport-receipt feature exists separately; do not assume it is published, silently merge it, or depend on its draft tables/contracts. Inspect the final base again.

| Area | Existing implementation | Treatment |
| --- | --- | --- |
| Vehicle identity | `lib/db/src/schema/enterprise.ts`: `fleet_vehicles`, purchase price/date, default driver, branch; existing `/admin/vehicles/:id` page | Keep one original vehicle/asset. Add optional partnership configuration only for the selected vehicle. |
| Booking transport | Kosha's original transportation columns; service `custom_fields.bookingOperations.transportation`; original booking resource/dispatch workflows | Reference the original source and any stable operation identity it actually supports. No duplicate trip rows. |
| Vehicle analytics | Original enterprise vehicle financial endpoint and `src/lib/booking-transport.ts` | Existing collected-share projection is cash attribution, NOT recognized income. Retain that separate metric. |
| Vehicle costs | `lib/db/src/schema/vehicle-finance.ts`: `vehicle_expenses`, unique idempotency/financial transaction links | Extend classification/linkage only where necessary; retain one original expense. |
| Driver fee | Existing `driver_wage` vehicle-expense category plus staff and employee-finance entries/settlements | Use one authoritative cost/entitlement path per trip; link payroll settlement rather than count another expense. |
| Employee accrual | `lib/db/src/schema/employee-finance.ts`: source-unique employee entries, settlements, optional payroll linkage | Reuse for an eligible staff driver's entitlement, under current approvals. Do not change base salary. |
| Cash/approvals | `src/server/master-cash-box.ts`, `financial_transactions`, accounts, ledger and audit tables, existing idempotency and reversal linkage | Extend trusted source adapters only; preserve default behavior for every existing source. |
| Parties | Existing customers, suppliers and staff identities | Partner relationships reference an existing identity; do not auto-create a duplicate person or change unrelated customer/supplier balances. |
| Delivery | `delivery_details` / `delivery_orders` describe existing sales/POS/order shipments | Reuse only an actually vehicle-linked, financially applicable operation; never reinterpret all deliveries as partnership trips. |
| Printing | Existing A4/browser/PDF helpers and receipt infrastructure | Add source-specific presentation. Existing remote Print Agent is sales-invoice-specific: do not disguise partnership receipts as sales jobs. |
| Audit/permission | Existing server permission helpers, source timelines and financial audit logs | No separate authentication or client-only authority. |

No vehicle partnership agreement, immutable monthly closing or partner allocation schema was found in this inspected source. These are genuinely missing accounting relationships, not grounds to rebuild transport.

### Financial gap that must be handled explicitly

The existing generic financial execution posts a cash movement and selects operating accounts for unrecognized transaction types. Reusing it unchanged for capital, an unpaid internal entitlement, partner-paid repair, or profit allocation would create false cash/revenue/expense. These source classes need reviewed, source-specific non-cash and settlement treatment in the existing accounting workflow. A client must never be able to request an arbitrary `noCash` flag or choose an unrestricted journal mapping.

Shared financial callers discovered: `api.ts`, `employee-advances.ts`, `installments.ts`, `hr-intelligence.ts`, `research-center.ts`, and `master-cash-box.ts` itself. Reconfirm ALL callers on the final base before edits; keep new behavior opt-in for trusted partnership sources, with regression coverage for old callers. Booking payment meaning and total formulas are unchanged.

## Approach

Use a narrowly scoped partnership sub-ledger and dated agreement attached to the ONE existing vehicle, integrated with current approvals, accounting and settlements. This follows the owner's specified existing-module approach. It is not another general ledger or cashbox: cash and posted accounting events remain centrally authoritative.

Rejected alternatives: (1) store only two percentages in editable vehicle notes/JSON — cannot protect historical periods or concurrent payouts; (2) build independent transport/partner cash/payment systems — duplicates the exact transactions the owner prohibits. The additional persisted relationships below are needed for immutable financial history, not duplicated operational identities.

## Configuration and identity

1. Optional ownership type: company, personal, partnership. Legacy vehicles without the field retain existing behavior; no historical ownership assertion/backfill.
2. Initial activation selects one existing vehicle, registration owner, partnership start date and the two existing party identities. Configuration editing does not post cash or copy the purchase asset.
3. Record capital contribution, ownership percentage, profit percentage and expense/loss percentage independently. Validate each percentage group totals 100%; initial configured values are 50/50, not a hardcoded calculation or fake financial record.
4. Use effective-dated agreement versions, actor/reason and before/after audit. No overlapping active versions; a selected future change does not overwrite an approved period's terms.
5. Existing purchase price/date remain authoritative vehicle fields. Initial contribution declaration is not proof of money received. An actual contribution requires a separately approved source transaction or verified existing reference.
6. Names, vehicle ID, agreement start and actual purchase/contribution amounts are entered/selected during setup; examples in the owner's request are not seed data.

## Minimal persistence proposal

Finalize names/FKs after the isolated-base schema audit. One reviewed additive migration only; no drop, narrowing, mass update, historical backfill or runtime DDL.

- Vehicle partnership agreement/header, vehicle FK and ownership metadata; at most one configured partnership vehicle for this initial installation, enforced transactionally/server-side rather than changing every vehicle.
- Effective-dated agreement members/versions with typed existing-party references, contribution declaration, independent integer percentage shares and immutable audit identity.
- Source-linked activity/entitlement annotations and cost funding/classification only where current records lack them. Unique source + operation + event identity; these annotate original trips/expenses, never create another trip or another cost. Do not create both an annotation and another expense with the same financial impact.
- Monthly closing header/revisions and itemized immutable source snapshots/partner allocations. One authoritative closing per vehicle/month; corrections are versioned, never a second competing closing.
- Partner right/advance/distribution references and settlement allocation links to EXISTING approved financial transactions. Unique financial event/allocation keys; these are liability/settlement detail, not another payments table that can independently move cash.
- Optional backward-compatible additions on the existing vehicle expense only if needed for original trip identity, funding party, approved recognition, capital/operating classification. Preserve existing nullable/new-field-absent records.

Apply/verify only this feature's required migration after design approval and required review. No migration is applied during design. Forward-fix additive objects; never automatically drop them to roll back code. Existing Production records stay unchanged. Strict database tests require a separately verified TEST database; do not create one or fall back to Production.

## Revenue, internal entitlement and cost rules

### Internal company transportation

- Existing booking/transport assignment supplies operational identity; a separately configured/entered agreed internal amount supplies the partnership entitlement. Do not silently use the customer's transport charge as that amount.
- Submit a source-linked internal entitlement for management approval. Draft/pending figures are estimates only. Approval records the real company obligation and the vehicle activity entitlement under the agreed policy, with no cash movement.
- Company operational transfer/allocation and partnership activity income are two views of ONE source event, eliminated from consolidated external company revenue. A company booking's original customer invoice/charge remains unchanged.
- Settlement pays/reduces that obligation once through the existing approved financial workflow; it is not another operating expense and not a second revenue event.
- Partner distributions subsequently reduce approved partner rights. Never pay the same internal entitlement once to a generic vehicle payee and again directly to partners without a corresponding allocation/settlement relationship. If payment is made directly to partners, allocate that single cash transaction to the relevant rights; if funds genuinely move to an existing partnership/bank account first, subsequent payouts must use that actual payment source. No invented wallet or duplicate master-cash outflow.

### External transportation

- Reference actual approved customer billing and its recognized transportation line/source amount, plus separately reconciled collections and receivables.
- Do not substitute the collected-share helper or customer cash receipts for recognized revenue. If no authoritative recognition basis exists, show incomplete data and block monthly approval until an authorized, referenced recognition adjustment/policy supplies it.
- One original trip has one income basis (internal entitlement OR eligible external charge) for partnership results. Never count the same booking customer fee and internal allocation twice.
- Cancelled/voided/reversed events follow their original sources. No automatic booking repricing, new invoice, copied booking or rebooking to create partnership income.

### Driver compensation and other costs

- Each actual trip can reference one existing `driver_wage` expense or an existing employee-finance entitlement that is the authoritative driver cost. Different trips may have different amounts. A settlement/payroll payment of that same entitlement is not a second cost.
- A missing fee is unknown, not zero. An explicit authorized no-fee selection may mean zero. Preserve historical unknowns; do not guess from customer charges, driver ID, default driver or salary.
- Vehicle expenses are one fact, net of approved reversals; categories separate trip-specific, monthly shared, capital improvement, partner-funded and non-cash depreciation.
- Cash paid to a supplier does not add a second expense when a referenced purchase cost was already recognized. Deduplicate by canonical source/financial identity, not by amount or description.
- Capital improvements remain investment unless an approved policy supplies capitalization/depreciation. Do not charge full vehicle acquisition price on every trip or month.
- Partner-funded repairs: approve the ONE vehicle cost and separately classify the funding as reimbursable advance, additional capital, or explicit other arrangement. No company cash movement at recording. Reimbursement reduces the advance; it does not recognize repair cost again or alter ownership.
- A partner expense, driver accrual or internal entitlement needing non-cash posting uses only the reviewed trusted source adapter in the existing financial engine/approval workflow. Default transactions retain existing behavior.

## Calculations and exact arithmetic

All new money calculations use decimal strings/scaled integer arithmetic (BigInt at 0.01 IQD precision compatible with existing numeric columns), never floating-point money. Percentages use integer basis points. Serialize money safely as decimal strings.

- Provisional trip contribution = recognized eligible activity income minus attributable recognized driver/fuel/other direct costs. Label provisional and show missing-source warnings; this never creates a partner payable per trip.
- Monthly activity result = eligible recognized external revenue + approved internal entitlements minus recognized trip/shared operating costs minus configured depreciation plus approved adjustments. Capital movements, loan/advance principal, repayments and distributions are excluded from operating result.
- Reserve is an explicit approved amount or percentage of an identified eligible positive basis, never an assumed 10%. A missing depreciation/reserve policy must be shown and acknowledged as not applicable/zero or configured before approval; do not invent expense amounts.
- Distributable profit cannot exceed the approved eligible positive result after reserve, carried losses and prior restrictions. It is not automatically equal to operating surplus or cash collected.
- Positive distributable profit uses the applicable profit shares; loss allocation uses applicable expense/loss shares. Report expense responsibility without deducting the same expense again from already-net profit. Additional funding/capital calls require a separate approved event, not an automatic ownership change.
- Use dated agreement terms applicable to each eligible source period. If terms change mid-month, closing source lines are segmented by effective agreement version; monthly shared cost allocation follows the explicitly approved period policy, not an invented prorating rule. Refuse approval if a material allocation basis is missing.
- Allocate the final minor-unit remainder deterministically (largest remainder, stable partner identity tie-breaker); allocated totals must exactly equal their approved source total.

### Proposed loss policy for owner approval

For the initial unchanged 50/50 agreement, keep a vehicle-level carried-loss balance AND separately identify each partner's approved loss responsibility. These are two views of the same loss, not two deductions. A loss period creates no cash payout or automatic cash call. Later positive operating results first recover the outstanding approved carried loss, then apply the configured reserve and approved distributable ceiling. Example: loss 100 followed by positive result 150, with no reserve/other restrictions, permits at most 50 distributable (25 per partner), not 150. Record retained loss recovery explicitly; do not count it as another expense or silently erase the historical loss allocation.

Do NOT offset any previously approved unpaid profit distribution or advance balance automatically. Any such legal/accounting setoff needs a separate authorized adjustment with its own approval and references. If partner membership or loss shares change while carried losses remain, the dated amendment must explicitly resolve the existing partners' carried-loss/retained-recovery responsibility before taking effect; do not assign old losses to a new partner or rewrite old shares by default. The owner approved this proposed policy with the complete design on 2026-10-25.

## Monthly closing and history

Workflow: draft → review → awaiting approval → approved → distributed.

1. Calculate a bounded, permission-filtered preview for the selected vehicle/month using current original sources.
2. Review source-linked income, costs, driver entitlements, partner advances, depreciation, adjustments, reserve and missing/ambiguous data. Expose source links without changing them.
3. Submission snapshots source versions/digests and agreement versions, including all eligibility and deduplication keys. Detect changes between calculation and approval; require recalculation rather than approving a stale report.
4. Authorized approval locks the vehicle/closing/rights in deterministic order, validates fresh sources, records immutable allocations and audit in one transaction. No cash moves.
5. Distribution requests reference approved positive rights only, support partial payment, reserve outstanding pending requests under row lock, and recheck outstanding balance during approval/execution. Rejection/cancellation frees the reservation. Durable idempotency protects request retries and execution.
6. `distributed` means all approved distributable rights were actually settled; a closing with zero distributable profit or a loss completes without fabricating a payout. An approved, partially settled month remains approved with explicit partial-payment information.
7. Approved snapshots never silently change. Late expenses/reversals/corrections use an auditable subsequent-period adjustment. Controlled reopening requires authorization, reason and a superseding revision, and is blocked while conflicting pending/executed allocations exist unless they are first handled by the original controlled reversal workflow.

## Partner statements and payment safeguards

Separate sections/balances: capital contributions; approved profit/loss allocations; reimbursable advances; distributions/settlements; pending requests; actual paid; remaining approved rights. Never one ambiguous mixed balance.

Every cash payment must use the existing request/approval/execution flow and original cash account permissions. A pending request neither moves cash nor increases paid. Approval without execution is not paid. Overpayment is checked at request and execution under locks; reversals restore the correct rights through the same canonical reconciliation.

Extend the canonical payment-state source adapters where genuinely required for new partnership rights; do not create manual feature-specific paid/remaining snapshots. Existing source behavior and all payment-state tests are protected. Ledger classification of capital, advances, internal transfers and settled partner rights must not fall through to ordinary sales or operating expense defaults.

## Existing UI, reports and print integration

Inside the selected existing vehicle page only: ownership selector and `الشراكة والحسابات`/`الشراكة والأرباح` section. Reuse current Arabic RTL tokens and controls; other vehicles keep current behavior.

Sections: agreement/partners; original trips with provisional contribution and original driver cost; existing vehicle expenses/funding; monthly closing history; separate partner statements/distributions; reports. Date filters: today, current month, previous month and custom range, in Asia/Baghdad. No competing dashboard/module.

Summary cards distinguish vehicle investment, recognized activity income, approved cost, operating result, approved partner shares, settled distributions and outstanding rights. Internal allocation and external revenue remain visibly separate; no fabricated zeros for missing data.

Reuse existing browser/PDF print infrastructure for vehicle/partner/monthly A4 statements and approved partner distribution 80mm receipt. Real source references, status, cash transaction and partial settlement values only. Printing/reprinting creates no payment, financial approval, source status or ledger movement. Print-request audit is not proof of physical printing. Preserve protected Booking Center A4 and the existing Print Agent contract.

## Authorization and audit

Existing server authorization protects view of partner financials, agreement changes, capital events, review/approval, distributions, historical adjustments and print variants. Ordinary vehicle operational permissions do not automatically grant partner financial access. Reuse identity/role infrastructure; any narrowly required permission code must be additive and not rewrite historical grants or authentication.

Audit actor, timestamps, reason, source/event, previous/new agreement versions, approval and execution references. No client-supplied approver, party entitlement, aggregate financial result or permission flag is authoritative. Known errors use AJN structured status/code/request ID; safe logging only, no tokens/credentials.

## Implementation sequence and verification gates

1. Re-audit an isolated current base; source/driver/party/financial map, detailed shared-core caller audit, additive schema proposal and pure invariants.
2. Agreement/configuration, one-vehicle guard, dated 50/50 membership and exact arithmetic tests; no cash or historical backfill.
3. Existing trip/cost adapters, internal payable approvals, driver entitlement deduplication and partner-funded expense references. Test recognized income separately from cash collections and consolidated revenue elimination.
4. Immutable monthly closing, source-change detection, reserve/loss handling, partner rights and approved/partial settlements; test concurrent duplicate closing/payment attempts and reversals.
5. Selected-vehicle RTL UI, statements/reports/A4/80mm presentation and desktop/mobile tests, then whole-change review and all required gates. No commit/push/deploy.

Required commands from current package: `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, `pnpm run test:payment-state` plus focused tests and existing booking/vehicle/employee-finance/approval/payroll/purchase/print regressions where configured. Run lint only if configured; do not invent a lint command.

Database write/migration integration tests require verified separate TEST configuration (`AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, `TEST_DATABASE_URL`); otherwise report SKIPPED, not passed. No Production diagnostics that mutate data. All controlled IO concurrency tests must be labelled controlled, never real PostgreSQL concurrency proof. Physical printer testing remains explicitly unverified unless actually performed.

Acceptance includes all 24 owner test cases, unknown values, exact rounding, zero/loss periods, mid-month agreement changes, late/reversed sources, pending approval isolation, cash non-movement on accrual/printing, partner-funded reimbursement once, driver/payroll deduplication, partial/duplicate/overpayment, permissions and historical preservation.

### Owner acceptance matrix (complete 24 cases)

1. Create a 50/50 partnership on the one selected vehicle; validate independent ownership/profit/expense totals.
2. Link existing vehicle identity without a copied asset or activating partnership on other vehicles.
3. Calculate original-trip provisional operating contribution from eligible recognized sources.
4. Record different driver fees for different trips through the original expense/entitlement path.
5. Internal transport creates an approved partnership entitlement without new consolidated external revenue or premature cash movement.
6. External transport uses actual approved customer billing/recognition and original receivables/collections.
7. Prevent duplicate revenue across booking, invoice, collection and internal-allocation references.
8. Prevent duplicate driver cost across trip expense, employee entitlement and payroll/settlement.
9. Record fuel/maintenance once, with proper operating versus investment classification.
10. Record partner-paid expense once and reimburse an approved advance without another expense.
11. Calculate a source-itemized monthly result with missing-source/stale-preview refusal.
12. Allocate approved distributable positive profit 50/50 with exact minor-unit rounding.
13. Handle monthly loss, carryforward and later recovery without automatic cash calls or retroactive rights setoff.
14. Apply the explicit maintenance-reserve basis/amount, keeping retained reserve separate from distributions.
15. Authorize monthly approval with immutable source and agreement snapshots; no cash on approval alone.
16. Execute approved partial partner distributions and reconcile paid/remaining centrally.
17. Prevent overpayment at request and execution, including outstanding pending reservations.
18. Prevent duplicate closing, partner allocation, payout and retried financial execution under concurrency.
19. Print approved source-linked partner statements without any financial mutation.
20. Print accurate approved 80mm distribution receipts; reprint/cancel cannot create payment.
21. Preserve management approval, rejection, execution and controlled reversal behavior for all existing financial sources.
22. Preserve historical vehicle/booking/driver/expense/cash records and dated ownership terms; late changes become explicit adjustments.
23. Validate premium Arabic RTL/mobile/desktop UI, readable codes/dates, A4/PDF and thermal presentation.
24. Enforce financial and operational role permissions server-side, with safe structured failures/audit.

## Calls proposed by the builder, not asserted as owner instructions

- A source-specific partnership sub-ledger/relationship extension is the smallest safe persistence for effective dating, immutable approvals and idempotent payments; raw editable percentages alone are insufficient.
- Scope initial activation to one chosen vehicle, preserve extensible relationships without automatically enabling other vehicles.
- Default reserve/depreciation are NOT silently invented; require an explicit configured/none acknowledgement.
- For approved history, subsequent-period adjustments are the default correction route; reopening is exceptional and blocked by unsettled/incompatible payment history.
- Losses carry forward against future distributable results for the unchanged initial agreement; prior approved unpaid rights are never offset automatically. A dated ownership change must explicitly resolve existing carried-loss responsibilities.
- Actual party names, vehicle choice, amounts, start date and chart-account policy are explicit setup inputs, not more hardcoded example data.

The owner approved this complete design with `كمل اشتغل` on 2026-10-25. The following implementation must remain local and uncommitted; no push, deploy or historical Production data change is authorized.
