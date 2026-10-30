# Vehicle partnership recovery and receipt implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make existing approved advance payouts printable and expose safe existing zero-period recovery.
**Architecture:** Reuse the authorized FIN receipt proof and original monthly transition endpoint. UI recovery is tied to persisted headers and immutable retry commands; all server financial safeguards remain authoritative.
**Tech Stack:** TypeScript, React, existing React Query/Dialog, exact-money helpers, AJN original printing and financial APIs.
**Spec:** docs/superpowers/specs/2026-10-30-vehicle-partnership-recovery-receipts-design.md

## Global constraints

No schema, financial posting or Production business write. No generic proposal-version fallback. No new payment, expense, transport, vehicle or printing system. Existing v1 requests and server permissions remain compatible.

## Review focus

- A source-only v2 advance can predate monthly approval or outlive ownership; printing cannot require a current active month.
- Recomputed/tampered v2 proof cannot convert a distribution or driver payment into an advance receipt.
- A zero accounting result does not imply a zero journal; only server proof permits recovery.
- Recovery after a lost response uses the original header/month/nonce despite refreshed data or another selected month.
- Monetary closings and non-admin approved reopening must retain original barriers.

### Task 1: Current advance receipt compatibility

**Files:** src/lib/vehicle-partnership/reports.ts; scripts/test-vehicle-partnership-reports.tsx.
**Interfaces:** `provePayoutReceipt(vehicleId, workspace, requestId, detail)` retains its existing PayoutReceipt result and original caller contract.

- [x] Add actual-source failing fixture for formatVersion2 source-only advance (originMode approved_advance, empty original coverage) and execute it RED.
- [x] Narrowly support that current format, preserving all other proof checks.
- [x] Execute v1/v2/unknown version, wrong source/mode/coverage, tampered digest, pending/reversed/ledger/right/payee cases GREEN.

### Task 2: Existing zero-period recovery controls

**Files:** src/views/admin/vehicle-partnership.tsx; optional focused src/views/admin/vehicle-partnership-zero-closing.tsx; scripts/test-vehicle-partnership-zero-closing-ui.tsx; test-suite registration owned by root.
**Interfaces:** persisted `{closingId, month, status, version, revision, sourceDigest, financialTransactionId}` from workspace; original POST `/closings/transition` with `cancel_zero` or `reopen_zero`, expected header and reason/nonce. Root grants no server or financial-core edits.

- [x] Write actual command/component behavior regressions and witness missing recovery controls RED.
- [x] Add reason/confirmation actions for pending/no-FIN cancellation and admin approved/no-FIN reopening using original row. Freeze route/body/month on first submit; retain exact retry and actual error on ambiguous failure; show saved-before-refresh-error correctly.
- [x] Execute eligibility, persisted source identity, no-FIN/admin barriers, exact retries, original server lifecycle/unused/opening-loss tests GREEN.

### Task 3: Integration verification and release

- [x] Run full original partnership tests, required critical/typecheck/payment-state/build, and appropriate real-component mobile/desktop checks using local fabricated data only.
- [x] Fresh independent review, fix actual important findings with regression proof, preserve skipped isolated DB test status.
- [ ] Commit only completed reviewed files, original pre-push gate, push main and verify exact Vercel deployment/read-only live UI.
