# Equipment rentals inside Booking Center

**Goal:** Extend the original `rental_orders` authority into multi-asset equipment contracts inside Booking Center. Preserve the public single-product rental flow and all historical rows. No commits, pushes, deployments, or Production writes.

**Architecture:** Add `rental_kind='equipment'` and `equipment_details` to the existing rental header. Keep `product_id` as the first real asset/product anchor (never a fabricated product). Equipment details contain priced asset lines plus the original quantity-operation counters/allocations and resource window. New equipment contracts have no mirrored store order. Financial authority remains `rental_order`; deposits have their own source-owned approval identity and liability classification. Source-owned evidence is allowed; no second stock ledger, cashbox, customer ledger, or invoice store.

**Tech stack:** Existing Next/React/TypeScript/Drizzle/PostgreSQL, React Query, shadcn, AJN Arabic date field and print helpers.

## Reuse and boundaries

- Original rental header/API: `lib/db/src/schema/products.ts`, `src/server/api.ts::handleRentalOrders`.
- New actions stay under the existing `/api/admin/rental-orders/equipment` dispatch; public legacy behavior is preserved.
- UI routes `/admin/bookings/rentals`, `/new`, `/returns`, `/reports`, `/:id` precede the generic booking route.
- The existing quantity engine owns reservations, checkout, returns, warehouse allocation and movements. Its commitment readers must see rentals as well as events, bidirectionally.
- Individual custody reuses original asset links/custody and its employee responsibility; a customer is never made into an employee.
- Pending inspection remains unavailable through the existing maintenance quarantine mechanism and explicit rental inspection evidence, never restored as available stock.
- Rental payments use `createSourceFinancialRequest` and canonical `reconcilePaymentState`. Deposits are liabilities, and applying them to rent is an approved noncash settlement.
- Customer account extension must exclude mirrored legacy rental/store rows.
- Calendar uses original rental IDs, separate rental counters, start/return markers, and original workspace links.
- Documents project the original rental data; printing never creates another invoice or financial transaction.

## Shared data contracts

`equipment_details` has version 1, address, startTime/endTime, linkedBooking `{source:'service'|'kosha',id}` or null, deliveryCharge, installationCharge, discount, depositRequired, terms, assets, resourceWindow, history and attachments. Each asset line retains productId, name/image/code, warehouseId, quantity, pricingType (fixed/daily/hourly/custom), unitPrice, duration, discount, lineTotal and existing operation fields. One product has one asset line; existing warehouse allocations split it across warehouses if needed.

API response detail: `{id,orderNo,rentalKind,customerId,customerName,phone,startDate,endDate,status,total,paid,remaining,overdue,details,capabilities,finance,history}`. List: `{data,total,summary}`. Options: `{assets,warehouses,employees}` from existing originals. All writes carry a durable requestId and lock the original rental then sorted products. Errors keep the AJN structured contract and request IDs.

## Work and ownership

- [x] Backend/domain: additive header/settings schema and isolated migration; shared rental types/pricing validation; original API extension; transactional drafts/confirmation/changes/customer lookup/status/history, bounded list/options/reports; finance/inventory wrapper calls. Owner: backend worker.
- [x] Inventory: rental commitments in original quantity/individual conflict readers; wrapper for availability, reserve/release, dispatch, partial returns and inspection; original custody/warehouse/movement writers; regression/integration tests. Owner: inventory worker.
- [x] Finance: rental collection/refund, deposit collect/refund/apply, approved charges; existing approvals/cashbox/reconciliation/classification, customer account; focused tests and additive evidence schema only if required. Owner: finance worker.
- [x] Presentation/integration: routes/nav/quick action, RTL dashboard/form/workspace, linked rentals in original booking, asset settings, shared calendar, rental A4/80mm contract/receipt, reports and customer shortcut. Owner: root.
- [x] Validate: isolated PostgreSQL additive migration; drafts, confirmation/overlap/concurrency, warehouse splits, partial custody, damage/inspection, approvals/deposits/settlement, statement dedupe; TypeScript/build/critical/payment-state/save-smoke and relevant legacy suites. No Production mutations.

## Review focus

1. An event created after a rental must see its reservation; transfers and adjustments must also see it.
2. Paid values come only from executed approvals. Deposit receipts never pay rent or enter operating P&L.
3. Retry after an uncertain response must not repeat a checkout, return, charge, collection or settlement.
4. Legacy rentals without new details, including mirrored store orders, still load/count once.
5. Inspection/damage/missing equipment remains unavailable until authorized resolution; company ownership is not reduced by checkout.

## Verification and delivery

Mandatory gates: `pnpm run typecheck`, `pnpm run build`, `pnpm run test:payment-state`, `pnpm run verify:critical`; use `verify:strict` and `test:save-smoke` with the verified local PostgreSQL test cluster. New migration applies only to test databases. Leave all implementation uncommitted for review. Final report lists functionality, changed files, migration, reuse and limitations with exact test evidence.

## Final verification — 2026-11-04

- PASS `pnpm run verify:critical --strict`: 82 verification stages, including `typecheck`, payment-state, original booking/warehouse/financial regressions, production build and the three isolated save-smoke phases. This is the same strict runner used by `verify:strict`.
- PASS original-writer PostgreSQL rental lifecycle on disposable UUID-owned databases; fresh final run additionally verifies receipt-allocation collection reporting and reversal once.
- PASS original React UI fixture in Chrome at 390/768/1440px, RTL, no page overflow, partial dispatch/returns, pending money and compact 80mm output.
- Lint: SKIPPED because this repository has no configured lint script. Production audit/storage writes: not run; no Production data was changed.
- No commit, staging, push or deployment. HEAD remains `86aed879f`, branch `codex/equipment-rentals-booking-center`.

### Review corrections verified

- Draft/pending individual rentals do not reserve equipment; dispatched evidence still holds it.
- Cancellation refuses outstanding equipment, inspection, funded balances, deposit custody, approved charges or pending source requests.
- Partial returns cannot prematurely close an undelivered remainder.
- Warehouse permission checks reuse original allocation consumption and the effective main warehouse.
- Refundable pools exclude receipt-voucher allocations; those refunds remain owned by the original receipt. Refunded/applied deposits cannot be reversed into a second refund.
- Receipt approvals lock original equipment rentals before financial/cash rows and reject draft/pending/cancelled equipment sources without changing legacy rental contracts.
- Original customer identity cannot change once payments or receipt allocations exist; a revised total cannot undercut approved/reserved funds.
- Noncash settlement/charges are excluded from original cash reconciliation. Source-owned deposits remain outside operating P&L.
- Settings-only access does not expose customer/staff directories. The rejected broad permission expansion was not applied; only asset settings are accessible to existing product editors.
- Real-source financial guards were supplied to legacy extracted-code regression harnesses; no allow-all test bypass was added.

### Shared-code callers / blast radius

- `createFinancialTransaction` / `createSourceFinancialRequest`: existing order, sales, booking, purchases, supplier, payroll/employee, installment, receipt/voucher and vehicle-finance callers retain their default signature; only the exact rental adapter namespace uses the new optional source argument. Generic requests cannot forge `er_*` sources.
- Original approve/reject/cancel/reverse: only identified rental financial sources delegate to the rental adapter. Principal-manager approval remains original. Original receipt approve/reverse additionally locks referenced equipment rentals; unrelated receipt and legacy-rental behavior is retained.
- `reconcilePaymentState`: the original rental adapter alone adds executed deposit applications and reversals. Other source adapters retain their original result.
- Quantity commitment readers feed event booking reservations, rental availability, quantity adjustment and warehouse transfer safety. Rental identity is added only to scheduling/resource types; booking-finance identities remain unchanged.
- Individual resource conflicts feed original custody, booking assignment and resource-period writers. The same stored rental source is projected; no parallel reservations are created.
- Customer account/statement and calendar readers use original IDs and records. Store mirrors and rental start/return markers are deduplicated at their original source identities.

## Release authorization — 2026-11-04

The owner subsequently requested commit, push and Production deployment. The preceding no-release statements record the implementation phase. Release only this feature from the isolated branch through the mandatory Git pre-push gate, apply only reviewed additive migration 0134 with the canonical owner connection, verify its objects, and confirm Vercel Production status for the pushed commit. Do not include unrelated main-checkout work or run Production write smoke tests.

Release integration: origin/main advanced to c6e21598d (customer followups). Retain both API routes and both navigation/critical-script additions. Booking creation now reacts to the existing useSearch hook, consumes only the manual new=1 shortcut, and preserves all followup gates. Original BookingCenterPage browser regressions passed at 390/1440px including repeated query-only opening. Both reviewed 0134 filenames have disjoint objects and are executed by full filename; no Production migration reapplication is required.
