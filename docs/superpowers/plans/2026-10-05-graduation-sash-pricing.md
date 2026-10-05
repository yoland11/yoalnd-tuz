# Graduation Group Sash Pricing Implementation Plan

**Goal:** الإدارة أو ممثل الدفعة يحدد سعراً لكل نوع وشاح معتمد؛ الطالب الذي يختار الملكي يرى سعر الملكي والذي يختار الأمريكي يرى سعر الأمريكي.

**Architecture:** Store optional `sashPricing: { mode: "by_sash", prices }` in existing group `defaultConfiguration`. Server reads persisted prices for new orders, replacing the outfit-kit catalogue charge while preserving real production costs and separately selected flowers. Existing saved orders and payments remain unchanged. No migration.

**Tech Stack:** Existing Next.js, React Query, Drizzle, Zod and AJN authenticated representative/admin APIs.

## Constraints and review focus

- Editing requires authenticated admin pricing permission or an active assigned representative; phone equality alone is not financial authorization.
- Validate finite nonnegative bounded IQD amounts, including explicit zero; require every allowed sash price.
- Public payload cannot change the configured price or apply a discount to it.
- Legacy groups without this policy retain catalogue pricing; snapshots, receipts and invoices agree.
- Group policy updates merge row-locked JSON and audit before/after in one transaction; no historical repricing.
- Preserve approved sash choices and fixed group colours/embroidery.

## Tasks

- [x] Test and implement `src/lib/graduation-group-pricing.ts`: validation, selected-price lookup and kit-price application; scripts/test-graduation-group-pricing.ts.
- [x] Add transactional authenticated price setter in `src/server/graduation-group-pricing.ts`; route through existing representative/admin handlers. Guard generic config updates against bypass.
- [x] Apply server policy in `createOrder` and admin `addStudent`, preserving stored historical totals. Keep core new-order financial records transactional.
- [x] Add reusable Arabic pricing editor to Admin group workspace and assigned representative portal; show selected price in student wizard. Clear missing-price error, no student edit controls.
- [x] Run focused tests, payment-state, typecheck, build and verify:critical; isolated database smoke SKIPPED if unavailable. Fresh security/correctness review and desktop/mobile read-only visual verification.
- [ ] Commit only completed task files on main; push via existing hook and verify connected deployment.

## Execution record

- Ruling: retain the existing main checkout, explicitly authorized by the user's auto-release policy; do not include unrelated dirty files.
- Ruling: prices cover the student's outfit kit; optional purchased flowers stay separate, photography retains its separate order. Historical saved totals are unchanged.
- Caller review: `createInvoice` is local to `createOrder`; `applyInventory` also serves `updateOrder` and retains its default transaction behavior there. The operations helpers `ensureIdentity` and `findOrCreateCustomer` retain their existing default database executor for non-creation callers. No shared Cash Box/payment-state core, schemas or migrations changed.
- Independent review findings addressed: authenticated price authorization, no client-expanded fixed-price kit, no recovery of unrelated recent orders, stale quote confirmation, and price-only admin routing.
- Verification: domain tests 32/32 plus access, real handler/creator in-memory rollback tests, UI tests, graduation center 16/16, payment-state, typecheck, production build and verify:critical passed. Expected simulated failures exercise audit rollback and post-save notification warnings; they never touch a database.
- Visual verification: actual editor/wizard at 1440×1000 and 390×844; royal 23,000 / American 25,000 fixture selections switched the displayed price correctly, no horizontal overflow, invalid negative price rejected. Temporary preview route removed before the production build.
- `test:save-smoke`: **SKIPPED**, no verified isolated `TEST_DATABASE_URL`; no Production write tests or data changes performed.
- Release: task-only commit/push and connected Vercel verification follow the completed checks; unrelated dirty files remain excluded.
