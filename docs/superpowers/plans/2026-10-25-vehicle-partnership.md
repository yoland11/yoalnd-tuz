# Single-Vehicle Partnership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dated partnership accounting, approved internal transportation entitlements, monthly results and approval-safe partner settlements for ONE existing AJN vehicle, initially two 50/50 partners.

**Architecture:** Extend existing vehicle, trip, expense, party, approval and accounting sources with a focused partnership relationship/sub-ledger. No duplicate vehicles/trips/costs/payments; central financial transactions, ledger, cashbox and payment reconciliation remain authoritative. New non-cash source adapters must be trusted server-only and must not change existing transaction defaults.

**Tech Stack:** Current TypeScript/Next/React, Drizzle/PostgreSQL, Zod, TanStack Query and AJN RTL UI/print helpers. Exact decimal money uses scaled BigInt and serializable decimal strings; no new runtime library.

**Spec:** `docs/superpowers/specs/2026-10-25-vehicle-partnership-design.md`, owner approved on 2026-10-25 with `كمل اشتغل`, including loss carryforward proposal. Execution is native, with no intermediate check-in required by that latest explicit work instruction; final independent review remains mandatory.

## Global Constraints

- DO NOT COMMIT, PUSH OR DEPLOY. This includes the design/plan and overrides repository auto-release policy for this task.
- Exactly ONE selected existing vehicle; two partners initially 50/50. No global conversion of vehicles, duplicate assets or identity copies.
- Internal company transportation is a real entitlement payable to the partnership, paid only after existing management approval and actual execution.
- No automatic booking repricing, duplicated customer fees or consolidated external revenue from internal transfers.
- No invented driver fee, recognition, reserve, depreciation, opening balance or historic payment. Unknown is not zero.
- Each ownership/profit/expense percentage set totals 100%; shares and capital are independent. Dated approved terms and closed financial history are immutable.
- One underlying expense/cost even when shown on booking, vehicle and partnership reports. Settlement, payroll payment and reimbursement do not recognize it again.
- Use transactions, deterministic locks, source uniqueness, durable idempotency and canonical payment reconciliation for money-related actions.
- No Production write tests, historical backfills, destructive migrations or runtime DDL. Only one isolated reviewed additive migration when needed.
- Required gates: actual `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, `pnpm run test:payment-state` plus relevant tests. Isolated save/database smoke is SKIPPED without separately verified TEST configuration. No configured lint script means explicitly not configured, not an invented command.
- Preserve other invoices, Booking Center A4 appearance, Print Agent's sales-only contract, permissions, existing IDs and all unrelated primary/other-worktree drafts.

## Review Focus

1. A pending payout and a simultaneous second request must not each consume the same approved balance; execution and reversals must reconcile the original source under lock (Task 7).
2. Capital, partner-paid repair, internal entitlement and distribution must not fall through the existing generic cash/revenue/expense defaults or expose a client-controlled no-cash bypass (Task 5).
3. Changing percentages or late/reversed source data must not silently rewrite an approved month or assign departed partners' loss to a new partner (Tasks 3, 6).
4. Driver wage, payroll settlement, purchase settlement and partner reimbursement can reference the same cost; count it once by authoritative identity rather than equal amount/name (Task 4).
5. Partial/failed source reads and bounded report truncation must not produce plausible zero profit, and BigInt/decimal rounding must allocate the exact approved total (Tasks 1, 4, 8).

## Workspace and source baseline

Use the clean reused attached worktree `C:/Users/ALIJAN/.codex/worktrees/calendar-exact-order/yoalnd-tuz-main`, branch `codex/vehicle-partnership`, based on fetched `origin/main` `eb1caaad4363472503f78453eecd66aeac57318c`. Primary checkout is dirty/behind; never reset, merge or publish its drafts. Prior transport-receipt work in the other worktree remains separate and unpublished.

## File map and contracts

- `src/lib/vehicle-partnership/money.ts`: strict decimal parse/format, exact arithmetic, allocation.
- `src/lib/vehicle-partnership/domain.ts`: agreement validation, effective dating, provisional/monthly exact calculations and completeness.
- `src/lib/vehicle-partnership/types.ts`: serializable shared domain/DTO types; no DB or UI dependency.
- `lib/db/src/schema/vehicle-partnership.ts`, schema index and one `lib/db/migrations/*_vehicle_partnership.sql`: focused additive relationships, original-source foreign keys, unique constraints.
- `src/server/vehicle-partnership/repository.ts`: guarded schema availability, original-source reads, transaction-owned persistence and audit; no runtime DDL.
- `src/server/vehicle-partnership/agreements.ts`: single-vehicle configuration, party identity and immutable dated amendments.
- `src/server/vehicle-partnership/activity.ts`: original trip/expense/driver/purchase adapters and approved source eligibility/deduplication.
- `src/server/vehicle-partnership/accounting.ts`: trusted source-specific non-cash/settlement adapters, ledger mappings and reversal rules.
- `src/server/vehicle-partnership/closing.ts`: digest-bound monthly preview, submission/approval and immutable revision/loss/reserve workflow.
- `src/server/vehicle-partnership/distributions.ts`: pending reservations, approved rights and existing financial payment allocations.
- `src/server/vehicle-partnership/routes.ts`: narrow original enterprise vehicle endpoint extension, server financial permission checks and AJN errors.
- `src/server/api.ts`: route delegation only where possible; existing driver/vehicle expense source adapters only where proven necessary.
- `src/server/master-cash-box.ts`, `src/server/payment-state.ts`: opt-in trusted source hooks only, with all old call paths preserved and tested.
- `src/components/vehicle-partnership/*`, `src/views/admin/vehicles.tsx`: original vehicle page integration, searchable existing-party selection, read-only report/print DTO consumers.
- `src/lib/vehicle-partnership/print.ts`: escaped source-specific A4/80mm presentation through current helper; no financial side effects.
- `scripts/test-vehicle-partnership-*.ts/.tsx/.cjs`, aggregate runner and real package scripts: tests per task, hooked into critical verification.

Shared persistence names: `vehicle_partnerships` (one installation slot and one original vehicle FK); `vehicle_partnership_agreements`; `vehicle_partnership_members`; `vehicle_partnership_activity` (source annotation, NOT trip copy); `vehicle_partnership_closings`; `vehicle_partnership_closing_lines`; `vehicle_partnership_rights`; `vehicle_partnership_settlement_allocations`. Add event/audit columns and versioned records within these relationships rather than another generic financial engine. If an existing relationship already supplies a field, reference it instead of duplicating it.

### Task 1: Exact money, agreement validation and pure calculations

**Files:** new `types.ts`, `money.ts`, `domain.ts`; tests `scripts/test-vehicle-partnership-domain.ts`.

**Interfaces:** `parseMoney(value:string):bigint`, `formatMoney(value:bigint):string`, `allocateMoney(total:bigint, shares:Array<{key:string;basisPoints:number}>):Array<{key:string;amount:string}>`; `validateAgreement(input:unknown):AgreementDraft`; `calculateTrip(input:TripFacts):TripResult`; `calculateMonth(input:MonthFacts):MonthResult`. Money DTO fields are decimal strings; dates are validated calendar dates. Missing inputs produce explicit incomplete reasons, never an official zero result.

- [ ] Write RED tests: strict decimals/no exponent/NaN; numeric(16,2) range; exact `0.10+0.20=0.30`; large IQD; reject excess precision/duplicate party keys/three members/percent groups not 10000; independence of capital/ownership/profit/loss shares.
- [ ] Test exact 50/50 allocation including `0.01`, stable tie-break and sum conservation; no floating-point conversion. Internal income 30000, driver10000, fuel5000 → contribution15000, provisional7500 each; no payable/financial write.
- [ ] Test monthly loss100 then surplus150 → maximum distributable50 and25 each; reserve zero only explicitly configured; unknown driver/depreciation/recognition blocks approval, not false zero. No automatic old-right setoff.
- [ ] Run `node scripts/run-tsx.mjs --tsconfig tsconfig.json scripts/test-vehicle-partnership-domain.ts`; Expected RED missing module/export, then implement exact pure functions and rerun Expected PASS.
- [ ] Verify pure layer has no database/cash/financial request imports. Record task evidence without committing.

### Task 2: Additive schema and original-source repository

**Files:** schema/migration/index; `repository.ts`; `scripts/test-vehicle-partnership-schema.ts`, `scripts/test-vehicle-partnership-repository.ts`.

**Interfaces:** `assertPartnershipSchema(tx):Promise<void>` returns structured setup-required error when absent; `lockPartnership(tx,vehicleId):Promise<PartnershipRecord>`; `appendPartnershipAudit(tx,event):Promise<void>`. Reuse caller transaction and existing audit identity. No auto-migration in GET or feature code.

- [ ] Write RED tests for one selected original vehicle (unique installation slot + vehicle FK), exactly one party reference per member (customer/supplier/staff), member share bounds, agreement revision uniqueness, one vehicle/month closing identity, source/event uniqueness and financial-allocation uniqueness.
- [ ] Define immutable agreement/closing revisions and original source/financial references with restrictive history FKs. Money numeric(16,2), percentages integer basis points, actor/reason/version/idempotency fields. Final migration column choices must be documented before application, not invented during a live write.
- [ ] Implement one additive migration and schema without modifying existing vehicle rows or adding a globally selected new column that breaks deployments before migration. Repository schema readiness is read-only, fails visibly and does not turn an error into no partnership.
- [ ] Run schema/repository tests RED→GREEN and typecheck. Real forward/constraint/concurrency validation only on independently verified isolated TEST; otherwise explicitly SKIPPED, never Production write smoke. Do not apply to Production during diagnostics.

### Task 3: Single-vehicle configuration and dated agreement amendments

**Files:** `agreements.ts`, narrow routes/API delegation, pure domain extensions; agreement route/store tests.

**Interfaces:** `saveVehicleAgreement(tx,actor,vehicleId,command:{expectedVersion:number;idempotencyKey:string;draft:AgreementDraft;reason:string}):Promise<AgreementDto>`; `readVehiclePartnership(actor,vehicleId):Promise<PartnershipDto>`. Existing parties are identified by typed source IDs, not name matching.

- [ ] Write RED real-handler/controlled transaction tests: financial permission before read/write; second vehicle rejected; original vehicle/party existence and branch visibility; legacy no-config behavior; unchanged retry no duplicate; stale409; audit failure rolls back.
- [ ] Validate initial two-member 50/50 setup through configuration, not seed values; legal registration owner separate from economic members and capital declaration not a paid receipt.
- [ ] Implement dated audited versions, reject overlapping effective terms and historical edits. A change with carried loss must include explicit existing-member loss responsibility resolution; old closed snapshots never recalculate under new shares.
- [ ] Run agreement/domain suites and original vehicle/booking authorization regressions; Expected PASS. Keep source mutation isolated, no cash entry on configuration.

### Task 4: Original trips, costs, driver compensation and recognized-source adapters

**Files:** `activity.ts`, repository readers, necessary original vehicle-expense/driver linkage extensions; activity/driver deduplication tests.

**Interfaces:** `readVehicleActivity(tx,actor,{vehicleId,from,to}):Promise<ActivityFacts>`; `resolveActivitySources(tx,reference):Promise<RecognizedSourceFacts>`; `costIdentity(record):string`. `ActivityFacts` contains recognized external income, approved internal entitlements, separately reconciled cash, original cost facts, exact source keys and completeness reasons/digest.

- [ ] Write RED tests for Kosha/service exact source identity and optional actual delivery/dispatch linkage, no duplicate trip records, missing vehicle assignment not assigned to partnership by inference, source limits fail visibly, failed DB reads propagate as structured errors.
- [ ] Test approved recognized revenue separately from original collected-share analytics; no recognized basis means incomplete. Same original activity cannot count both customer transport fee and internal entitlement. Read never changes booking total or creates invoices.
- [ ] Test driver_wage + employee entitlement + payroll settlement deduplication, purchase expense + supplier payment once, approved reversal netting, pending request exclusion, capital improvement excluded from operating costs, partner-funded cost once/reimbursement not cost.
- [ ] Implement adapters using actual existing source/status/permission contracts on final base. Original expense remains the only expense; source annotations add missing association/classification only. External operations without a genuine existing billing/vehicle source remain explicitly incomplete until corrected through the original workflow, never a fictitious trip/income.
- [ ] Run activity/domain and existing vehicle/payroll/approval/purchase tests that the caller audit identifies; Expected PASS. Show no unknown field as zero official profitability.

### Task 5: Approval-safe internal entitlement, funding and accounting integration

**Files:** `accounting.ts`, central financial source adapters/approval hooks, activity approval commands; payment-state source extension where genuinely required; accounting regression tests.

**Interfaces:** `submitPartnershipEvent(tx,actor,command:PartnershipEventCommand):Promise<FinancialRequestRef>`; `resolvePartnershipPosting(tx,sourceEvent):Promise<TrustedPostingPlan>`; `applyPartnershipFinancialEvent(tx,event):Promise<void>`. The posting plan is built on the server from original source identity; NO client-controlled cashImpact/account/reconciliation flags.

- [ ] Re-list EVERY caller of shared financial mutation helpers and document blast radius before edits. Write RED tests proving all old sources retain defaults; unknown partnership source fails closed rather than ordinary operating revenue/expense.
- [ ] Test internal entitlement pending: no income/right/cash; approved non-cash entitlement: one obligation/activity source, no cash/new external revenue; later settlement reduces the same liability without a second expense. Capital recorded as approved balance-sheet event, not sales.
- [ ] Test partner-paid repair creates one recognized approved expense and funding advance/capital as selected, no company cash until approved actual reimbursement; reimbursement not second cost/ownership change. Driver accrual remains the original employee/driver cost and its settlement stays singular.
- [ ] Implement source-specific central posting/callback/reversal rules with original transactions, locks and approvals. Non-cash postings balance without fake MASTER movements. Capital/advance/internal transfers/distribution settlements never fall through default operating account classification. Preserve existing reports for all non-feature sources.
- [ ] Every create/approve/reject/cancel/reverse/payment change invokes canonical source reconciliation; extend its trusted source adapters rather than feature-local paid snapshots. Run new tests, `pnpm run test:payment-state`, original approval/booking-cashbox/employee finance suites and `pnpm run verify:critical`; Expected PASS, isolated DB writes only when safe TEST available.

### Task 6: Immutable monthly closing, carryforward and partner rights

**Files:** `closing.ts`, repository/route handlers, domain additions; monthly lifecycle/digest/concurrency tests.

**Interfaces:** `previewClosing(tx,actor,vehicleId,month):Promise<ClosingPreview>`; `transitionClosing(tx,actor,{closingId,action,expectedVersion,expectedDigest,idempotencyKey,reason}):Promise<ClosingDto>`. `ClosingPreview` includes exact decimal source lines, agreement versions, completeness, loss recovery, explicit reserve/depreciation policy and deterministic digest.

- [ ] Write RED tests for draft→review→pending→approved, one vehicle/month identity, pending/unauthorized/stale sources block approval, two concurrent approvals/unchanged retry allocate once, audit failure rolls back rights and snapshot.
- [ ] Test exact 50/50 positive allocation, loss period no payout, subsequent loss recovery once, explicit reserve, no negative distributable, capital not operating cost, mid-month dated terms and material shared-cost basis missing blocks approval.
- [ ] Snapshot original source/reversal and agreement versions on submission; recheck under deterministic locks before approval. Approved rights/snapshots immutable; late source updates require next-period adjustment, no silent recalculation.
- [ ] Implement controlled reopening only with authorized reason/superseding revision and original pending/paid reversal constraints; never edit settled history. Zero/loss closing completes without artificial payment.
- [ ] Run domain/activity/accounting/closing lifecycle suites and relevant original financial regressions; Expected PASS. Real DB concurrency remains separately guarded and accurately labelled.

### Task 7: Partner statements, pending reservations and partial distributions

**Files:** `distributions.ts`, canonical reconciliation/accounting callback wiring, original approval source integration; payout/statement tests.

**Interfaces:** `readPartnerStatement(tx,actor,{vehicleId,partyKey,from,to}):Promise<PartnerStatement>`; `requestDistribution(tx,actor,{rightId,amount,paymentSource,idempotencyKey,expectedVersion,notes}):Promise<FinancialRequestRef>`; canonical reconciliation computes executed net paid/remaining from existing financial records and allocation links.

- [ ] Write RED tests: capital, approved profit/loss, advances, pending, paid and remaining are separate; pending never paid; approved-but-not-executed never paid; overpayment rejected at request and execution; original financial reversal restores outstanding correctly.
- [ ] Test concurrent pending requests reserve the same available right once; retries reuse one request; rejection/cancel releases reservation; double execution/reimbursement creates no duplicate cash/cost.
- [ ] Test internal payable settlement and partner distribution cannot independently pay the same value from MASTER twice. Single direct-to-partner payment must allocate only valid approved rights and referenced internal entitlement settlement; an actual prior transfer requires an actual permitted non-master payment source for subsequent payout.
- [ ] Implement through existing source requests/approvals, row-lock order, durable source keys and canonical reconciliation only. No custom wallet, cash balance or generic direct payout endpoint.
- [ ] Run payout/statement/canonical payment/approval tests; Expected PASS. Incomplete or unapproved rights cannot be printed as paid.

### Task 8: Original vehicle page, reports and source-specific printing

**Files:** vehicle partnership components, original `vehicles.tsx`, original enterprise routes, print builder; SSR/browser/report tests.

**Interfaces:** `VehiclePartnershipPanel({vehicleId:number})`; DTOs from Tasks3–7; `buildPartnershipReportHtml(dto,format:'a4'|'80mm'):string` pure escaped presentation, never a financial mutation.

- [ ] Read required AJN print/UI/performance skills before touching presentation. Write RED tests for no tab activation on unrelated vehicles, role-limited view/actions, single selected vehicle setup, original-party search, approvals/partial payout state, structured failure versus no config and accurate unknown-source warnings.
- [ ] Add Arabic RTL agreement/partners/trips/expenses/monthly/statement/report sections inside original vehicle page only; date filters Baghdad; cash collected distinct from recognized income; internal/external income separate; no browser financial calculations.
- [ ] A4 vehicle/partner/monthly report, PDF via original export and approved source-specific 80mm distribution receipt. Include real approved/executed refs, no privacy leaks, no Print Agent sales-job misuse; print/reprint/preview never pay or change status.
- [ ] Browser tests at desktop/mobile for setup, review, pending approval, partial payout, long Arabic/large IQD, selectors, denied/read errors, A4/thermal overflow and no extra blank page. Controlled HTTP only, not Production writes.
- [ ] Run focused UI/print tests and original vehicle/invoice/print regression suites; Expected PASS, physical printer explicitly unverified unless tested.

### Task 9: Whole-feature verification and uncommitted delivery

**Files:** feature test aggregate, actual package/critical test script, approved implementation report and ledger.

- [ ] Map every spec acceptance case1–24 to an implemented test/task; run feature suite and all required actual typecheck/build/critical/payment-state commands. Run configured lint only. Isolated TEST smoke unavailable means SKIPPED; no secrets or tests against Production.
- [ ] Fresh whole-change review per executing-plans, including untracked files and all new financial/schema logic. Review Focus tests must be pinned; fix Critical/Important findings RED→GREEN in one fix pass and rerun full gates.
- [ ] Report exact files, reused originals, migration availability/application/validation honestly, financial safeguards, tests, skips and remaining limitations. Keep primary and other worktree drafts untouched.
- [ ] DO NOT COMMIT/PUSH/DEPLOY. No safe-auto-release hook invocation; leave reviewed changes local for the owner.

## Self-review coverage

Spec configuration/history→Tasks1–3; trip/driver/funding/internal/external safeguards→Tasks4–5; monthly/retained-loss/approval/rights→Tasks6–7; premium RTL/reports/A4/80mm→Task8; integrity/24 acceptance cases/gates→Task9. No task duplicates existing transport/vehicle/payroll/accounting systems. Types and money/approval interfaces are owned once above and consumed consistently. Each task has an independent RED→GREEN gate; no intermediate commits under the owner's explicit prohibition.
