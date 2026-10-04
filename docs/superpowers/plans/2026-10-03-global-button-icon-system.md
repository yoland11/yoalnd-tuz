# AJN Global Button and Icon System — Implementation Plan

**Goal:** Make app-owned buttons and icons across AJN administration, staff, bookings, storefront, and customer routes follow the approved `/admin/workspace` visual language while preserving every existing action and state.

**Design reference:** `docs/superpowers/specs/2026-10-03-global-button-icon-system-design.md`

**Constraints:** Presentation-only. Do not change routes, permissions, validation, API/database behavior, booking/sales/payment logic, or control semantics. Do not apply blanket `button` or `svg` element rules. Preserve specialized surfaces (including bouquet/design canvases), status colors, RTL/LTR, keyboard behavior, and existing loading/disabled states. No partial commit/release; AJN release hooks publish `main` after an intentional commit.

**Review focus (five likely regression points):**

1. Direct native buttons bypass the shared style and can be missed in large route groups.
2. Selected, destructive, warning, success, and disabled states can lose their semantic meaning during restyling.
3. Compact icon actions may become too small to use on touch screens or lack accessible names.
4. RTL/LTR layouts can reverse icon placement, chevrons, or action order unintentionally.
5. Specialized editors, dialogs, and canvas controls can be damaged by generic styles or inappropriate shared variants.

## Execution tasks

### Task 1 — Add a failing design-system contract check

**Files:** `scripts/verify-global-control-system.mjs`; `package.json`.

1. Add a Node-based regression check and `test:global-control-system` package script. Initially assert the shared component's required semantic variants and named sizes, accessible icon-only control contract, icon-frame semantic tones, and the ban on global `button`/`svg` rules. Run `pnpm run test:global-control-system` and confirm it fails on the missing primitives/contract before implementing them.
2. Include checks for primary/secondary/quiet/destructive/selected presentations, touch-size and focus classes, and intentional exception documentation. Keep this a source-contract check; do not pretend it replaces visual review.

**Expected result:** the new check fails for specific missing pieces, with no application changes yet.

### Task 2 — Establish reusable button and icon primitives

**Files:** `src/components/ui/button.tsx`; new `src/components/ui/icon-button.tsx`; new `src/components/ui/icon-frame.tsx`; `scripts/verify-global-control-system.mjs`.

1. Keep the regression check failing while adding supported `Button` variants and sizes aligned with the approved coral/white/quiet workspace controls. Preserve `asChild`, existing prop API, `ref`, disabled/loading semantics, focus ring, and mobile hit area.
2. Add an `IconButton` built on the shared button system. Require an accessible name (`aria-label` or equivalent title contract), preserve tooltip support through caller composition, and offer compact/standard touch-safe sizes.
3. Add a small `IconFrame` for prominent module/section glyphs with explicit semantic tone and size. Use Lucide `currentColor`; leave inline glyphs unframed.
4. Run `pnpm run test:global-control-system` and `pnpm run typecheck`; confirm the contract check passes and existing Button call sites still typecheck.

**Expected result:** one shared, testable presentation contract that existing screens can adopt without changing behavior.

### Task 3 — Align the workspace reference and shared application shell

**Files:** `src/views/admin/workspace.tsx`; shared navigation/layout files discovered in `src/components/layout/` and the app shell; regression check.

1. Add representative assertions for workspace primary/secondary actions, module icon halos, and shared shell icon actions before migrating those call sites; run the check and confirm the new assertions fail.
2. Replace duplicated workspace button/icon utility clusters with the shared primitives. Migrate app-owned navigation controls, mobile navigation, and shell icon-only actions while retaining active-route styling, menu state, permission visibility, RTL order, and keyboard behavior.
3. Run the focused contract check, typecheck, and inspect the changed desktop/mobile shell states.

**Expected result:** the workspace remains the visual source of truth, and shared navigation demonstrates accessible, responsive adoption.

### Task 4 — Migrate customer-facing, store, and booking controls

**Files:** app-owned controls under `src/views/store/`, `src/views/services/`, `src/views/` customer/account/cart/checkout/graduation flows, `src/views/admin/booking*`, `src/views/staff/booking*`, and related booking components under `src/components/`.

1. Add targeted source-contract assertions for representative add-to-cart, checkout, booking navigation, stepper, gallery, and icon-only actions; verify the assertions fail before the migration.
2. Migrate standard actions to shared `Button` variants, icon-only actions to `IconButton`, and only prominent module/section glyphs to `IconFrame`. Preserve selected tab/step treatments as selected controls, not generic buttons; preserve all product and booking visual states.
3. Keep upload, canvas, slider, drag/drop, date-picker, and third-party controls specialized where required. Add a concise source comment or exception entry only where a true visual exception remains.
4. Run focused checks and typecheck; review RTL desktop/mobile layouts for store, checkout, graduation booking, and booking center.

**Expected result:** customer, store, and booking routes visibly follow the workspace design while their booking and sales behavior stays untouched.

### Task 5 — Migrate remaining staff and administration controls

**Files:** remaining app-owned controls under `src/views/admin/`, `src/views/staff/`, `src/views/representative/`, and reusable dialogs/components under `src/components/`.

1. Use the source inventory to identify remaining application-authored raw buttons and divergent icon wrappers. Record purposeful exceptions (canvas/editor internals, chart controls, specialized segmented controls, or external widgets) in a small checked-in exception manifest consumed by the regression check.
2. Migrate the remaining standard, destructive, quiet, and icon-only actions in cohesive domain batches. Preserve action handlers, permission gates, confirmation flows, tooltips, selected states, and status colors exactly.
3. Make the regression check fail if a newly introduced unclassified app-owned button pattern appears in audited surfaces. Do not require every browser-native or third-party control to use AJN styling.
4. Run focused checks and typecheck after each batch; inspect representative admin and staff dialogs on desktop and mobile.

**Expected result:** all app-owned actions use the common contract or a documented, reviewable exception.

### Task 6 — Complete site-wide responsive and visual verification

**Files:** all files changed in Tasks 2–5; `scripts/verify-global-control-system.mjs` and its package script.

1. Run `pnpm run test:global-control-system`; review the final exception inventory and search for unexplained raw buttons or non-Lucide application icons.
2. Manually verify representative routes at desktop, tablet, and mobile widths: `/admin/workspace`, `/admin/bookings`, `/admin/purchases`, `/store`, `/checkout`, `/graduation`, and a staff task route. Check RTL and any intentionally LTR content; test primary, secondary, quiet, destructive, selected, focused, disabled, and loading states; confirm no page-level horizontal overflow.
3. Run all required project gates: `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`. Run `pnpm run test:save-smoke` only if a separately verified isolated test database is configured; otherwise report **SKIPPED** and never as passed. Do not run write tests against production.
4. Inspect `git diff --check`, review the final diff for behavior or business-logic changes, and only after the complete implementation and mandatory checks pass create one intentional commit on `main`; the configured hook handles push and Vercel production deployment. If a required gate fails, stop before commit/push/deploy and report the failure.

**Expected result:** consistent site-wide controls, recorded test evidence, and no release of partial or failed work.
