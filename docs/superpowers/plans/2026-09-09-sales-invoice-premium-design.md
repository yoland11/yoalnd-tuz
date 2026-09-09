# AJN Premium Sales Invoice Design

## Objective

Redesign `/admin/sales` as a premium Arabic RTL sales workspace while preserving the existing invoice, stock, barcode, customer, supplier, coupon, delivery, payment, accounting, printing, permission, and audit behavior.

## Approved Architecture

The existing `SalesPage` remains the controller and source of truth for queries, calculations, mutations, and save/print behavior. The redesign extracts focused presentation components that consume the current state and callbacks; it does not introduce a parallel invoice model, API, database table, payment-state calculation, or inventory movement path.

## Visual System

- Page background: `#F8F7F5`; cards: white; secondary surfaces: `#FBF5F3`.
- Primary text: `#182033`; secondary text: `#778092`; border: `#E9E5E2`.
- Rose `#B85C65` and champagne `#C7A36A` are accents, not page-wide fills.
- Cards use 18–22px rounding, subtle borders, and lightweight shadows.
- Desktop uses an RTL 72/28 main-to-summary layout. Mobile becomes a deliberate one-column flow with a sticky total/save bar.
- Signature detail: a restrained rose/champagne invoice summary rail that visually anchors totals and save actions without decorative clutter.

## Interaction Design

- Search and barcode remain keyboard-first and reuse the existing add/increment path.
- Product categories come from the real product data and combine with debounced search.
- Invoice items preserve decimal quantities and existing discount calculations.
- Delivery fields remain progressive through the existing `DeliverySection`.
- Payment state remains derived by the existing canonical sales flow.
- Save failures preserve entered state; duplicate submission is prevented by the existing/request busy state.
- Existing invoice history, cancellation, printing, customer repair, and statement flows remain available.

## Responsive Design

- Desktop: product workspace is dominant; invoice summary stays narrow and readable.
- Tablet: summary becomes a comfortable stacked or collapsible region rather than narrow controls.
- Mobile order: header, search/barcode, categories, items, customer, totals, delivery, payment, notes, save actions.
- Invoice rows become mobile cards; category chips scroll horizontally; icon actions retain accessible labels/tooltips.

## Safety Boundaries

- No database migration.
- No server API changes unless a verified missing read-only field blocks rendering.
- No changes to financial formulas, stock mutation, payment reconciliation, Cash Box integration, cancellation/reversal, or historical records.
- Existing permissions and route `/admin/sales` are preserved.

## Verification

- Focused UI/state tests for category filtering, item quantity behavior, mobile structure, and submit locking.
- Existing sales/payment checks.
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm run test:payment-state`
- `pnpm run verify:critical`
- `pnpm run test:save-smoke` only with a separately verified test database; otherwise report `SKIPPED`.
- Manual desktop and mobile RTL inspection of `/admin/sales`.
