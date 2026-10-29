# Full recorded transport fee implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Continue native execution and authorized safe auto-release in the existing isolated worktree.

**Goal:** A saved15,000 fee appears as15,000 vehicle income without paid/total reduction.

**Architecture:** Sum existing eligible trip fees in the original vehicle financial GET/list SQL. Trip result uses fee minus existing approved-effective cost. Preserve the legacy collection-share DTO/helper and all original cash/accounting/partnership sources; remove its misleading visible column.

**Tech Stack:** Existing Next.js/TypeScript, Drizzle, React, Node tests. No dependencies or schema.

**Spec:** docs/superpowers/specs/2026-10-29-vehicle-full-transport-fee-design.md

## Global Constraints

No booking total/paid/remaining, fee, financial transaction, approval, cash, expense-recognition, partnership posting or historical mutation. Keep original cancelled/archived/mode/vehicle guards, signed loss and response compatibility. Production QA read-only. Required typecheck/payment-state/build/critical gate; isolated DB writes SKIPPED without verified TEST configuration.

## Review Focus

- Partial/zero/full booking payments must not change the full recorded fee for either source.
- Booking totals, source fees and legacy collection-share fields/helper must retain their meaning and values.
- Expense changes affect profit only; losses remain negative.
- Fleet SQL must match detail fee basis without dropping vehicle/mode/archive/cancellation scope.
- Both actual UI tables/recorded-income labels must show the full fee and not present collection attribution as income or executed cash.

## Task 1: Full-fee read model and consistent original views

**Files:** src/server/api.ts; src/views/admin/vehicles.tsx; src/views/admin/enterprise.tsx; src/lib/booking-transport.ts (comment only); scripts/test-vehicle-full-transport-fee.mjs; existing vehicle/booking-transport tests; original transport aggregate.

**Interfaces:** Existing summary.transportationRevenue, trip.transportationFee/tripProfit, numeric fleet stats. Existing executedTransportationRevenue/executionStatus stay collection indicators for compatibility. No new product API.

- [x] Add actual-source API/SQL/JSX regression and witness RED: saved15000 with paid150000/total195000 currently gives11538.46.
- [x] Switch analytical income and trip profit to full saved fee, retain original collections, update count and fleet SQL. Remove misleading visible collection column and executed labels. Clarify legacy helper/test comments without changing its calculation.
- [x] Update signed-result regression to cover the original scoped trip properties with full-fee context, not the old initializer variable name. Include the new regression in the existing transport test, run both original transport packages GREEN.
- [x] Fresh whole-change review; one RED/GREEN fix pass if needed. Run all required critical/typecheck/payment-state/build checks.
- [ ] Commit verified work, push main through original pre-push gate, verify exact Vercel SUCCESS and read-only deployed fee15000/detail/list/command-center/mobile. No Production financial actions.
