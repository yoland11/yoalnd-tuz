# Equipment Rental Returns Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution and one final independent review. User explicitly prohibits commit, push and deployment.

**Goal:** Complete safe partial returns, receiving history, receipts and settlement-gated closure in the original rental workspace.

**Architecture:** Extend the original `equipment_details` JSON with immutable return snapshots; call the original quantity/custody inventory executors inside the existing locked rental transaction. Keep payment approvals and financial summaries authoritative. No database migration or new subsystem.

**Tech Stack:** React, TypeScript, existing AJN UI, Drizzle/PostgreSQL.

**Spec:** Latest user request: functional استرجاع معدات on active rentals, quantities/conditions/date/employee/warehouse, partial returns, inspections, safe completion, full history/printing and durable idempotency. No automatic refund/cashbox movement.

## Global Constraints

- DO NOT COMMIT, PUSH, OR DEPLOY.
- Preserve original customers, assets, warehouse movements, bookings and approval paths.
- Only approved inspected-good quantities enter available stock; missing quantities require authorized manager approval.
- No production writes or destructive diagnostics. Tests use a guarded disposable TEST database.

## Inspected callers and blast radius

- `executeEquipmentRentalInventory`: only the original equipment rental API calls it. Original quantity, warehouse and payment reconciliation writers remain in place.
- `operationStatus`: private to rental mutations. Use rental-specific explicit counters for individual/quantity returns, retaining legacy fallbacks.
- `equipmentRentalFinancialSummary`: used by rental reads/cancel/edit. Reuse unchanged for an explicit `complete` action guarded by approval capability.
- `equipmentRentalPrintHtml`: workspace and existing print/browser tests only. Add a return receipt builder beside it; preserve contracts and account receipts.
- `executeIndividualCustody`: rental inventory and the `api.ts` custody adapter for employee custody, booking/photography and related assets. Only the rental-specific, explicitly authorized legacy loss finalization can close an already-recorded loss, and only against the original custody marker. Other callers retain their existing behavior.
- Receipt allocations: the existing accounting receipt POST revalidates equipment-rental allocations while holding their source row locks. Other receipt sources and legacy product rentals keep their existing flow. Completion also checks unposted allocations while the original receipt awaits its approval request.

## Design and decisions

Use the existing return endpoint and details workspace. A visible استرجاع معدات button is available when dispatched equipment remains, subject to permissions. The return dialog shows four split conditions and balance counters, a Baghdad-local return date/time, receiver and destination. Good means inspected and accepted, requiring inspection permission. Pending returns remain quarantined. Each successful request appends one immutable dated receipt with receiver/actor/warehouse identities and before/after balances. A retry reuses its original request ID; no duplicate entry or movement. After physical return, use تم الإرجاع while financial work remains; an authorized explicit إكمال الإيجار validates no open equipment, inspection, deposit liability, debt, or pending financial/voucher request.

Review ruling: Some older individual losses were approved but remained in issued custody. Expose an authorized finalization on the original contract using its exact loss marker. It changes custody status and adds an audit entry while preserving the prior loss and stock counts. New ordinary charges, rent refunds and deposit collection are blocked on completed contracts. Corrections use their original financial reversal workflow.

## Review Focus

- Concurrent returns with different keys must not exceed the outstanding balance.
- Retrying an uncertain response must retain the original payload and key; changed payload cannot share the key.
- Individual missing/quarantined items must not be misread by generic legacy stage inference.
- Receiver/warehouse/date and receipt data must be server-validated snapshots, not trusted client names.
- Closed rentals and legacy JSON must remain readable; no synthetic history or historical rewrites.

### Task 1: Transactional return record and closure

- [x] Add failing PostgreSQL regressions for history/date, concurrent overreturn, permissions, no financial writes and settlement-gated completion.
- [x] Add rental-specific quantity/status helpers, typed return snapshots, validated date/receiver/destination snapshots, and complete action.
- [x] Run real isolated database tests to green; retain original inventory writers and durable idempotency.

### Task 2: Return UI and receipt

- [x] Add print and browser assertions for visible button, split quantity validation, full/pending return, history and return receipt.
- [x] Extend original dialog and workspace with counters, local date/time, partial/full split controls and return history/print actions.
- [x] Reuse existing print helpers with a dedicated A4 return receipt and escaped text. Run focused tests.

### Task 3: Verification and review

- [x] Run the strict critical gate with typecheck, build, payment-state and isolated save smoke tests; run rental browser checks at 390/768/1440 widths and RTL receipt generation.
- [x] Independent read-only review; fix material issues and retest.
- [x] Leave source edits uncommitted. Existing JSON stores the receipt snapshots and requires no migration. Older returns remain in their existing audit history; the printable snapshots start with new returns.
