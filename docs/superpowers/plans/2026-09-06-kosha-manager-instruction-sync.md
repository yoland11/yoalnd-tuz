# Kosha Manager Instruction Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize manager instructions and staff execution media bidirectionally on one Kosha booking.

**Architecture:** Add an instruction metadata table and channel read-state table, expose permission-checked manager/staff APIs, and integrate them into existing admin and staff booking views. Existing storage, notifications, staff media, and timeline infrastructure remain authoritative.

**Tech Stack:** React, TypeScript, Express API, Drizzle/PostgreSQL, TanStack Query, shadcn/ui, Supabase Storage.

**Spec:** `docs/superpowers/specs/2026-09-06-kosha-manager-instruction-sync-design.md`

## Global Constraints

- Preserve booking, financial, inventory, payment, and existing media behavior.
- Use additive schema only and apply only the isolated migration.
- Follow AJN structured errors and server-side permissions.
- Write failing focused tests before implementation where the current harness supports it.

---

## Task 1: Schema and contracts

- [ ] Add focused schema/contract tests for instruction and read-state fields.
- [ ] Add Drizzle tables, relations, indexes, and one additive SQL migration.
- [ ] Run focused tests and typecheck.

## Task 2: Server authorization and APIs

- [ ] Add tests for manager permission, assigned staff access, supervisor access, and cross-booking denial.
- [ ] Implement list/create/edit/archive instruction APIs and explicit mark-viewed APIs.
- [ ] Add timeline events, assigned-staff notifications, read receipts, and batched unread counts.
- [ ] Preserve native and routed-service booking identity.

## Task 3: Admin experience

- [ ] Add API client types/hooks.
- [ ] Extend `StaffExecutionPanel` with manager instruction upload/note/edit/archive UI.
- [ ] Add separated media sections, read receipts, and the accessible RTL image viewer.
- [ ] Mark staff-execution activity reviewed only after the panel renders.

## Task 4: Staff portal experience

- [ ] Extend staff booking/list contracts with instructions and unread counts.
- [ ] Render manager instructions before execution controls.
- [ ] Mark instructions viewed after successful render and keep task-card indicators until then.
- [ ] Validate mobile RTL and image navigation.

## Task 5: Verification and release

- [ ] Run focused tests, `pnpm run typecheck`, `pnpm run build`, `pnpm run test:payment-state`, and `pnpm run verify:critical`.
- [ ] Run `pnpm run test:save-smoke` only with a verified isolated test DB; otherwise record **SKIPPED**.
- [ ] Apply and verify only the additive migration if Production connection is configured.
- [ ] Review diff, commit, push `main`, and verify the Production route.

