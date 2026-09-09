# AJN Premium Sales Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `/admin/sales` into a premium, responsive Arabic RTL sales workspace without changing AJN invoice, stock, payment, accounting, or printing behavior.

**Architecture:** Keep `SalesPage` as the behavioral controller and extract only focused UI components and pure presentation helpers. Reuse current queries, calculations, callbacks, `DeliverySection`, barcode dialog, save mutation, invoice history, and print flows so the redesign cannot create a second source of truth.

**Tech Stack:** React, TypeScript, TanStack Query, Tailwind CSS, Lucide React, existing AJN UI primitives.

**Spec:** `docs/superpowers/plans/2026-09-09-sales-invoice-premium-design.md`

## Global Constraints

- Preserve route `/admin/sales` and all existing permission checks.
- Do not change financial calculations, payment-state reconciliation, inventory movements, Cash Box behavior, invoice identifiers, or historical records.
- Product categories and counts must come from existing product data; do not hard-code production categories.
- Preserve decimal quantity support with `min="0.001"` and `step="0.001"` wherever the current workflow supports it.
- Use Arabic RTL and existing AJN font/icon systems.
- No database migration is planned.
- Required release checks: `pnpm run typecheck`, `pnpm run build`, `pnpm run test:payment-state`, and `pnpm run verify:critical`.
- Run `pnpm run test:save-smoke` only when a separately verified test database is configured; otherwise report it as `SKIPPED`.

---

## File Structure

- Create `src/views/admin/sales-invoice-ui.tsx`: focused presentation components and pure category/stock helpers for the create-invoice workspace.
- Modify `src/views/admin/sales.tsx`: retain all data/state/mutations; compose the extracted UI and add responsive state only.
- Create `scripts/test-sales-invoice-ui.cjs`: source-level regression checks for the preserved behavioral boundaries and redesigned UI contract.
- Modify `package.json`: add the focused test command and include it in `verify:critical` through the existing critical test aggregator mechanism.

### Task 1: Lock Behavioral Boundaries With a Failing Regression Test

**Files:**
- Create: `scripts/test-sales-invoice-ui.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `src/views/admin/sales.tsx` save function, barcode handler, decimal quantity fields, `DeliverySection`, and payment helpers.
- Produces: command `pnpm run test:sales-invoice-ui` that fails until the new presentation module and required premium UI hooks exist.

- [ ] **Step 1: Write the focused regression test**

Create a Node script that reads `sales.tsx` and the new presentation module, asserts that `saveInvoice`, `handleSearchKey`, `DeliverySection`, `isCashPaymentMethod`, decimal quantity attributes, and the existing `/admin/sales-invoices` mutation remain present, then asserts exported UI symbols `SalesInvoiceHeader`, `ProductCategoryChips`, `InvoiceItemsCard`, `InvoiceTotalsCard`, and `InvoiceMobileSaveBar`.

- [ ] **Step 2: Register the test command**

Add `"test:sales-invoice-ui": "node scripts/test-sales-invoice-ui.cjs"` and wire it into the existing critical verification script without replacing any current checks.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm run test:sales-invoice-ui`

Expected: FAIL because `src/views/admin/sales-invoice-ui.tsx` and its exports do not exist.

- [ ] **Step 4: Commit the test boundary**

```powershell
git add scripts/test-sales-invoice-ui.cjs package.json
git commit -m "test(sales): define premium invoice UI contract"
```

### Task 2: Build the Premium Sales Presentation Components

**Files:**
- Create: `src/views/admin/sales-invoice-ui.tsx`
- Test: `scripts/test-sales-invoice-ui.cjs`

**Interfaces:**
- Consumes: product/cart/form values and callbacks supplied by `SalesPage`; `Product`, `CartItem`, and formatting callbacks exposed or moved from `sales.tsx` without changing their shapes.
- Produces: `SalesInvoiceHeader`, `InvoiceActionBar`, `ProductCategoryChips`, `ProductSearchPanel`, `InvoiceItemsCard`, `InvoiceTotalsCard`, `InvoiceSectionCard`, `InvoiceSaveActions`, and `InvoiceMobileSaveBar`.

- [ ] **Step 1: Implement pure category and stock helpers**

Add helpers that normalize the existing product category label, derive unique category chips from loaded products, filter by selected category plus search query, and map current stock to `available`, `low`, or `out` presentation states without mutating stock.

- [ ] **Step 2: Implement premium header and action bar**

Render the approved title, subtitle, breadcrumb, rose icon container, new-invoice action, history, held invoices, and current hold/reset callbacks with accessible labels.

- [ ] **Step 3: Implement product discovery components**

Render the large search field, barcode action, dynamically derived category chips, 64–80px product thumbnails, SKU/barcode, price, stock badge, and add action. Keep horizontal chip scrolling and keyboard focus behavior.

- [ ] **Step 4: Implement invoice item desktop rows and mobile cards**

Use the current cart items and update/remove callbacks. Keep editable name, unit price, discount percent, discount amount, total, and decimal quantity input; wrap quantity with minus/plus controls that apply the same numeric update callback.

- [ ] **Step 5: Implement totals and sticky save surfaces**

Render subtotal, additional discount, coupon, tax, delivery/COD charges, payment summary, grand total, desktop save actions, and the mobile sticky total/save bar using values calculated by `SalesPage`.

- [ ] **Step 6: Run the focused test**

Run: `pnpm run test:sales-invoice-ui`

Expected: PASS for component exports and preserved behavioral anchors.

- [ ] **Step 7: Commit the presentation layer**

```powershell
git add src/views/admin/sales-invoice-ui.tsx scripts/test-sales-invoice-ui.cjs
git commit -m "feat(sales): add premium invoice presentation components"
```

### Task 3: Compose the Redesigned Workspace Around Existing Logic

**Files:**
- Modify: `src/views/admin/sales.tsx:328-1345`
- Test: `scripts/test-sales-invoice-ui.cjs`

**Interfaces:**
- Consumes: components exported by `sales-invoice-ui.tsx` and all existing `SalesPage` state/callbacks.
- Produces: redesigned create-invoice view at `/admin/sales`; list/history and detail/edit flows remain unchanged.

- [ ] **Step 1: Add selected category and debounced search state**

Keep raw `searchQ` for barcode immediacy, derive a deferred text query for visual filtering, reset only the selected category when explicitly requested, and combine category plus query without changing the products query.

- [ ] **Step 2: Replace only the create-invoice JSX shell**

Compose the premium header, action bar, discovery panel, invoice items, customer/supplier card, totals, existing `DeliverySection`, payment controls, notes, additional information, and save actions. Do not modify list mode, invoice detail/editor, cancellation, repair, statement, or print components.

- [ ] **Step 3: Add submit locking without changing mutation semantics**

Use the current saving state to disable both save actions and barcode/cart destructive controls during submission. Preserve cart and form state in the existing catch path and keep the current request payload unchanged.

- [ ] **Step 4: Preserve barcode focus restoration**

Confirm successful save and barcode add return focus to `searchRef`; existing duplicate product scans continue increasing the matching cart item quantity.

- [ ] **Step 5: Run focused regression tests**

Run: `pnpm run test:sales-invoice-ui`

Expected: PASS.

- [ ] **Step 6: Run TypeScript validation**

Run: `pnpm run typecheck`

Expected: exit code 0.

- [ ] **Step 7: Commit the composed redesign**

```powershell
git add src/views/admin/sales.tsx src/views/admin/sales-invoice-ui.tsx
git commit -m "feat(sales): redesign invoice workspace"
```

### Task 4: Validate Responsive RTL and Accessibility Behavior

**Files:**
- Modify: `src/views/admin/sales-invoice-ui.tsx`
- Modify: `src/views/admin/sales.tsx`
- Test: `scripts/test-sales-invoice-ui.cjs`

**Interfaces:**
- Consumes: completed redesigned workspace.
- Produces: desktop, tablet, and mobile RTL layouts with accessible focus and icon controls.

- [ ] **Step 1: Inspect desktop at 1440×900**

Open `/admin/sales`, verify the product workspace dominates, the summary does not exceed roughly 30%, tables do not clip, product images remain legible, and the invoice rail stays usable during scrolling.

- [ ] **Step 2: Inspect tablet at 1024×768**

Verify fields do not become narrow, summary sections stack cleanly, category chips remain scrollable, and no horizontal page scroll appears.

- [ ] **Step 3: Inspect mobile at 390×844**

Verify the required mobile order, item cards, 44px minimum interactive targets, readable currency, and sticky total/save bar without covering content.

- [ ] **Step 4: Fix visual and accessibility findings**

Adjust only presentation classes/markup for spacing, RTL alignment, overflow, focus rings, `aria-label`, and `aria-pressed`. Do not change calculation or mutation code.

- [ ] **Step 5: Re-run focused and type checks**

Run: `pnpm run test:sales-invoice-ui`

Run: `pnpm run typecheck`

Expected: both exit code 0.

- [ ] **Step 6: Commit polish fixes**

```powershell
git add src/views/admin/sales.tsx src/views/admin/sales-invoice-ui.tsx scripts/test-sales-invoice-ui.cjs
git commit -m "fix(sales): polish responsive RTL invoice layout"
```

### Task 5: Full Safety Verification and Release

**Files:**
- Verify only; modify files only for failures directly caused by this feature.

**Interfaces:**
- Consumes: all completed sales redesign tasks.
- Produces: release evidence and a verified commit suitable for the AJN auto-release workflow.

- [ ] **Step 1: Run the focused UI test**

Run: `pnpm run test:sales-invoice-ui`

Expected: PASS.

- [ ] **Step 2: Run TypeScript and production build**

Run: `pnpm run typecheck`

Run: `pnpm run build`

Expected: both exit code 0.

- [ ] **Step 3: Run payment-state regression tests**

Run: `pnpm run test:payment-state`

Expected: PASS.

- [ ] **Step 4: Run AJN critical verification**

Run: `pnpm run verify:critical`

Expected: `AJN SAFETY CHECK PASSED` and exit code 0.

- [ ] **Step 5: Handle save smoke truthfully**

If `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separately verified `TEST_DATABASE_URL` are available, run `pnpm run test:save-smoke`; otherwise record `SKIPPED — no isolated test database`.

- [ ] **Step 6: Review the final diff**

Confirm there are no changes to server APIs, schemas, migrations, financial helpers, inventory mutations, payment reconciliation, cancellation/reversal logic, or historical data.

- [ ] **Step 7: Create the final feature commit if polish changed files**

```powershell
git add src/views/admin/sales.tsx src/views/admin/sales-invoice-ui.tsx scripts/test-sales-invoice-ui.cjs package.json docs/superpowers/plans/2026-09-09-sales-invoice-premium-design.md docs/superpowers/plans/2026-09-09-sales-invoice-premium.md
git commit -m "feat(sales): deliver premium AJN invoice experience"
```

- [ ] **Step 8: Push only after all mandatory checks pass**

Use the repository's protected AJN release workflow; do not bypass pre-push validation and do not publish partial or failed work.
