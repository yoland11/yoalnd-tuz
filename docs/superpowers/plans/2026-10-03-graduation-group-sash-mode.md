# Graduation Group Sash Mode Implementation Plan

> **For agentic workers:** Implement inline in this session; no subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a graduation group use one fixed sash for all students or allow each student to choose one, preserving existing groups.

**Architecture:** Store `sashSelectionMode` and (for fixed mode) `sashType` in the existing group `defaultConfiguration` JSON. A pure shared helper supplies legacy-safe policy interpretation and filters client overrides; both the public wizard and server order creation use it.

**Tech Stack:** TypeScript, React, existing graduation group API, existing `scripts/test-graduation-student-flow.ts` test.

**Spec:** `docs/superpowers/specs/2026-10-03-graduation-group-sash-mode-design.md`

## Global Constraints

- No database migration; retain the current group configuration JSON storage.
- Legacy groups lacking `sashSelectionMode` stay in per-student mode.
- Enforce fixed sash type and group sash color on the server; never trust the browser policy.
- Preserve personal sash text, font, and embroidery color.
- Do not edit or stage unrelated user changes.

## Review Focus

- Legacy group configuration: missing mode continues to permit per-student sash selection.
- Fixed mode direct API payload: client-supplied type/color cannot override the group choice.
- Invalid fixed type in stored configuration: resolves to a safe valid default.
- Draft restore after mode changes: current group policy reseeds controlled sash values.
- Individual graduation flow: remains unchanged.

---

### Task 1: Policy helper and regression tests

**Files:**
- Modify: `src/lib/graduation-student-flow.ts`
- Test: `scripts/test-graduation-student-flow.ts`

- [x] Add failing tests for legacy per-student policy, fixed policy normalization, and fixed payload overriding client sash type/color while preserving personal text.
- [x] Run `pnpm run test:graduation-student-flow` and verify the expected failure.
- [x] Implement a small pure policy resolver and use it when building `studentPayload`.
- [x] Rerun `pnpm run test:graduation-student-flow` and verify it passes.

### Task 2: Group setup and student experience

**Files:**
- Modify: `src/views/graduation-groups.tsx`
- Modify: `src/components/graduation-student-wizard.tsx`

- [x] Add a per-group choice mode to the group builder and save it in existing configuration JSON; show sash type selection only for fixed mode.
- [x] Public group wizard hides sash model/color selection in fixed mode and reflects the group's fixed type/color in its preview.
- [x] Rerun the focused flow test and `pnpm run typecheck`.

### Task 3: Server-authoritative enforcement and verification

**Files:**
- Modify: `src/server/graduation.ts`

- [x] Apply the resolved group policy when normalizing group student submissions so forged per-student type/color overrides are discarded in fixed mode.
- [x] Run the focused test, `pnpm run typecheck`, `pnpm run build`, and `pnpm run verify:critical`.
- [x] Report isolated save smoke as skipped unless its separately verified test database is configured.

### Task 4: Remove university number from student registration

**Files:**
- Modify: `src/components/graduation-student-wizard.tsx`
- Modify: `src/lib/graduation-student-flow.ts`
- Test: `scripts/test-graduation-student-flow.ts`

- [x] Add a failing regression test that old draft/base university numbers are absent from new registration payloads.
- [x] Remove the field from the form and confirmation, and omit it from new payloads without altering historical database records.
- [x] Rerun `pnpm run test:graduation-student-flow` and verify it passes.
