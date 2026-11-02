# Simple Transport and Partnership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make existing transport, vehicle accounts and partnership workflows easier to use without changing accounting.

**Architecture:** Presentation-only progressive disclosure within existing components, routes and APIs. Essential transport controls remain visible; vehicle and partnership daily actions come first, with advanced workflows still available. Preserve all mutation bodies, validation, permission checks and retry identity.

**Tech Stack:** Existing React, TypeScript, TanStack Query, Wouter, Tailwind and shadcn components.

**Spec:** `docs/superpowers/specs/2026-11-02-simple-transport-and-partnership-design.md`

## Global Constraints

- No commit, push or deploy. No production writes or new dependencies.
- No changes to server, database, financial logic, print layouts, approvals, permissions or API contracts.
- Arabic RTL, mobile accessibility, errors remain visible.
- Preserve per-trip/overall fees, all trip fields, occupancy intervals, historical and advanced workflows, approved versus provisional figures, immutable retries and query links.

## Review Focus

- Collapsing advanced controls cannot clear saved trip data or alter reservation bounds.
- Pending and failed source queries must not appear as successful zero amounts.
- Financial actions retain confirmation, source version and stable retry payload.
- Partnership balances for all periods cannot be labelled as filtered period results.
- Every advanced or legacy view must remain reachable on mobile and by URL.

## Task 1 — Booking transport editor

Ownership: `src/components/booking-transport-plan-editor.tsx` and focused transport UI tests.

- [x] Read existing editor callers, UI and resource tests.
- [x] Write/run a failing behavior test for compact primary controls and retained advanced values.
- [x] Group essential vehicle/driver/route/date/fee controls and existing save/print actions. Move optional occupancy and secondary controls into labelled details; indicate stored advanced settings.
- [x] Keep mutation, fee-mode confirmation, permissions, trip identifiers and state unchanged.
- [x] Run focused existing transport and new UI tests; task review.

## Task 2 — Partnership daily workflow

Ownership: `src/views/admin/vehicle-partnership.tsx` and focused partnership navigation tests. Do not edit finance helpers or child financial components.

- [x] Read existing views, callers, financial UI tests and payment attempts.
- [x] Write/run a failing test for simple daily navigation and accessible advanced views.
- [x] Present activity, partner balances/payment requests and monthly accounting clearly. Put agreement/history/reports/advanced policies behind explicit advanced navigation, without losing any workflow.
- [x] Reuse existing computed figures and actions; do not add guessed financial aggregates.
- [x] Run focused existing partnership and new UI tests; task review.

## Task 3 — Vehicle entry point

Ownership: `src/views/admin/vehicles.tsx` and focused vehicle navigation tests; root integration.

- [x] Add/run a failing navigation and query-state regression test.
- [x] Promote trips, expenses and partnership; move vehicle data, maintenance and history to advanced navigation. Preserve deep links and default to daily trips only without a valid requested tab.
- [x] Preserve list and detail query failure states rather than hiding failures behind empty states.
- [x] Keep report/expense links and existing components/actions.
- [x] Run focused existing vehicle and new UI tests; task review.

## Task 4 — Integration and validation

- [x] Review each task and whole diff against the spec, fix introduced issues.
- [x] Browser verification with synthetic/local fixtures only: desktop and phone, basic/advanced tabs, financial visibility, preserved transport fields, errors and stable retries.
- [x] Run `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`; run relevant UI/regression tests.
- [x] Record isolated database smoke as SKIPPED if no separately verified test database. Do not contact/write production databases for UI QA.
- [x] Report changed files, actual test results and local-only delivery.

## Completion — 2026-11-03

All tasks implemented and independently reviewed. Typecheck, standalone production build and verify:critical passed; desktop/mobile synthetic browser tests passed. Isolated database integration/write smoke SKIPPED; no verified TEST configuration. No commit/push/deploy. Full handoff: `docs/reports/2026-11-03-simple-transport-and-partnership.md`.
