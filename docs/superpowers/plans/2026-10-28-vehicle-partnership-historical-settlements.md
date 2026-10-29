# Vehicle Partnership Historical Settlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution was already selected for the original approved feature.

**Goal:** Implement the four requested remaining settlement priorities without changing approved history or duplicating money.

**Architecture:** Source-backed prior-event classifications and opening declarations use existing immutable financial audits; original financial approvals and monthly rights remain authoritative. New advance requests prove the original approved liability independently of closing, with later same-FI conversion classification.

**Tech Stack:** Existing TypeScript/Next/React/Drizzle/PostgreSQL/Zod; decimal strings/BigInt; no new dependency or schema.

**Spec:** docs/superpowers/specs/2026-10-28-vehicle-partnership-historical-settlements-design.md plus original 2026-10-25-vehicle-partnership-design.md.

## Global Constraints

- Single existing vehicle, two original parties; preserve dated percentages and approved months.
- No duplicate expense, invoice, payment, journal, cashbox movement or historical rewrite.
- All cash uses existing approval/MASTER and canonical payment reconciliation.
- No Production diagnostic writes. Full database write/concurrency/save-smoke SKIPPED without separate verified TEST configuration; normal release allowed only after required gates.
- Preserve legacy source/request/snapshot contracts; new metadata/opt-ins are additive.

## Review Focus

- Opening loss exceeds first-month income, zero journal, reopening and later same-party recovery: keep original loss identity and never post it twice.
- Prior-source mapping approved after a month preview, used/pending source, reverse/refund chronology and changed source: stale approval must fail, not duplicate or hide money.
- Early partial advance request approved after monthly close or ownership ending: its original proof/retry stays valid, pending holds still prevent overpayment.
- Later coverage versus cash return/replacement/reopened month: same cash is contained once; immutable old allocation evidence stays readable.
- No new metadata on legacy installations/frozen snapshots: old endpoints and proposals retain their original response and accounting behavior.

### Task 1: Existing-source prior-period classification

**Files:** new src/server/vehicle-partnership/period-attributions.ts and read-only proof helper; extend closing.ts and routes.ts; tests scripts/test-vehicle-partnership-period-attributions.ts.
**Interfaces:** readPeriodAttributions(tx,root,historySources,snapshots); approvePeriodAttribution(db,actor,vehicleId,input); projectClassifiedClosingSources(input) produces original-key facts/snapshots and explicit blockers. No financial writer.
- [x] RED: approved executed unconsumed source moves only report date into an open later month, original FIN/amount/basis date/party unchanged; old/current/future/duplicate/used/pending-frozen mismatches reject; nonce/audit rollback; SQL failure propagates.
- [x] Implement original-source/journal snapshot proof, admin confirmation and immutable audit lifecycle under existing source locks; reject arbitrary money and source changes.
- [x] GREEN with original closing evidence/preview/journal/locks/reopening regressions.

### Task 2: Opening loss declaration and noncash approval

**Files:** new opening-loss.ts/opening-loss-proof.ts and pure opening types as needed; accounting.ts, posting.ts, financial-classification.ts, journal.ts; original master source labels. Tests opening source/posting/permission/retry.
**Interfaces:** requestOpeningLoss(db,actor,vehicleId,input,writer); prepareOpeningLossRequest(tx,reference,actor); execute/reject/reverseOpeningLoss(tx,initial,actor); readApprovedOpeningLoss(tx,root,firstAgreement).
- [x] RED: exact declared original amount/dated two-member shares, evidence required, pending not approved, principal-only one balanced noncash journal, no cash/operating impact, immutable retry, conflict and audit rollback; consumed opening reversal blocked.
- [x] Implement via existing audited declaration + central source request, exact amount from approved first agreement, actual journal/approval metadata proof and no new table.
- [x] GREEN source/classification/central noncash ingress and original capital/cost/driver regressions.

### Task 3: Opening loss in real monthly rights

**Files:** closing.ts, closing-lifecycle.ts, closing-rights.ts, closing-unused.ts, closing-journal.ts; tests opening monthly integration.
**Interfaces:** optional snapshot.openingLoss proof; opening:declaration:<id>:member:<id> claim identities; actual first-month adjustment lines/right linkage to original opening FI; shared original loss resolver for recovery.
- [x] RED: partial/full/no recovery; original opening amount exceeds income; no sources/zero month; changed terms/typed parties; first-month reopening preserves opening FI and old rights; later used loss blocks source/month reversal; old frozen snapshots unchanged.
- [x] Integrate proven opening metadata, materialize rights exactly once, let later recovery use real original rights; remove only the unsupported-opening guard when proof is present.
- [x] GREEN complete monthly math/preview/submission/posting/unused/reversal suites.

### Task 4: Source-only early/historical advance requests

**Files:** advance-payments.ts, closing-locks.ts/closing-lifecycle.ts (historical proof option only if needed), workspace.ts, cash-reversal.ts/proof; tests advance-payments/origin/cash return.
**Interfaces:** opt-in command originMode='approved_advance', proposal formatVersion=2 with source-only origin; legacy absent opt-in remains v1. Context has optional monthly proof; no fictitious closing or coverage.
- [x] RED: no month, draft/pending month, already closed month, inactive ownership, historical original member; early40+remaining60, concurrent pending capacity, approval after close, exact retry and late canonical/audit rollback; old v1 byte-identical behavior.
- [x] Implement new source-only proof/admission through original pending request and exact MASTER flow; transaction date >= original cost; no expense repost.
- [x] GREEN original advance/profit/driver/payment-state and full cash-return tests.

### Task 5: Classify original early advance cash inside approved conversions

**Files:** new advance-coverage.ts/read-only proof; advance-payments.ts, cash-reversal-proof.ts; route and reusable existing coverage dialog/result; tests source proof/canonical/sync/UI.
**Interfaces:** syncClosingAdvanceCoverage(db,actor,vehicleId,input):DriverCoverageSyncResult; same original advance FI/right/primary, separate immutable mapping proof and original approved cost month.
- [x] RED: pre-close40 + later60, partial/no capacity, repeated exact nonce, old mapping immutable, full cash return -> replacement -> sync, month revision mismatch, unapproved FI, crossed scope and audit rollback; no cash/expense writes.
- [x] Implement bounded source-owned same-FI coverage using existing exact coverage math and monthly conversions; preserve original proposal and primary allocation.
- [x] GREEN existing driver sync/canonical/cash-return/closing regressions.

### Task 6: Original partnership UI and final validation

**Files:** source-specific controls inside original vehicle-partnership UI, narrow routes/workspace, reports/guide, aggregate scripts/test-vehicle-partnership.mjs. No unrelated module redesign.
- [x] Add opening evidence declaration/status and prior-source review/confirmation, usable early advance action and later advance coverage; mobile RTL; server errors remain explicit; saved success survives refresh failure; exact retry frozen.
- [x] Actual component controlled tests plus desktop/mobile local UI; no Production financial writes.
- [x] Fresh whole-change review (or accurately reported unavailability), full pnpm run typecheck, test:payment-state, build and verify:critical; isolated DB tests only when permitted.
- [ ] Release only completed verified software under current AGENTS safe auto-release policy; original pre-push and exact Vercel status plus read-only postdeploy checks. No partial or failed work release.

## Self-review

All four requested priorities map to Tasks1-5; Task6 covers practical UI and verification. Historical attribution is source-backed classification only, not free-form mutation of already distributed profit. Opening and advance money each retain one existing financial source. No new schema is needed. Native implementation preserves the original worktree and leaves unrelated concurrent work untouched.
