# Signed vehicle result regression plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Continue the owner's authorized native repair and safe auto-release workflow in the existing isolated worktree.

**Goal:** Show real vehicle/trip losses instead of zero without changing financial records or sources.

**Architecture:** Preserve four original subtraction expressions and DTOs, removing only their positive-input sanitizer wrappers. Keep the global sanitizer and every source/approval/write path unchanged.

**Tech Stack:** Existing Next.js, TypeScript, Node test scripts and shared IQD formatter. No new dependencies.

**Spec:** docs/superpowers/specs/2026-10-29-vehicle-loss-display-design.md

## Global Constraints

Existing input sanitizer, source amounts, recognition/approval rules, reservations, financial writes and historical records remain unchanged. Only the four original vehicle result fields change. No migrations. Follow existing critical pre-push gate and report isolated database tests as skipped when unavailable.

## Review Focus

- Revenue below cost must remain negative for both trip types, detail summary and list stats.
- Positive/equal values must retain their original output and response types.
- Existing fractional proportional revenue must keep the original subtraction and formatter rounding.
- Large IQD results must remain readable through the existing formatter, with no new money conversion.
- The global positive-only input sanitizer must still reject negative/nonfinite inputs outside these result fields.

## Task 1: Preserve actual signed result expressions

**Files:** src/server/api.ts (four result expressions); scripts/test-vehicle-loss-display.mjs (actual-AST regression); scripts/test-vehicle-transportation-logic.mjs and scripts/run-critical-verification.mjs (existing package test and critical gate integration).

**Interfaces:** Existing numeric `tripProfit`, `summary.netProfit` and `stats.netProfit`; no new product export.

- [x] Add real-source expression/formatter regression covering all Review Focus inputs. Run `node scripts/test-vehicle-loss-display.mjs`; expect an assertion that 100000 minus 150000 currently returns 0 instead of -50000.
- [x] Remove only the four positive-only wrappers. Run the new regression and `pnpm run test:vehicle-transportation`; expect PASS, with unchanged global sanitizer behavior.
- [x] Fresh whole-change review and one RED-to-GREEN fix pass for any material findings. Run `pnpm run typecheck`, `pnpm run test:payment-state`, `pnpm run build` and `pnpm run verify:critical` through the original full gate.
- [ ] Commit completed verified fix, push main through the unchanged pre-push gate, verify exact Vercel SUCCESS and read-only deployed loss display. Do not execute Production financial transactions.
