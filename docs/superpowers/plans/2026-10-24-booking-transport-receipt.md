# Booking Transport Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authorized per-operation Arabic 80mm transport receipts and selectable per-trip/overall customer transport pricing to existing bookings.

**Architecture:** Extend existing booking JSON with an optional versioned transport plan; retain original Kosha/service financial aggregate and canonical writes. Extend existing resource protection and fleet projections, and use one feature-specific preview and pure receipt renderer through existing browser printing.

**Tech Stack:** Existing TypeScript, React, Next.js, Drizzle/PostgreSQL, Zod, TanStack Query, AJN UI components, installed QR and browser-print helpers; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-24-booking-transport-receipt-design.md` (owner-approved).

## Global Constraints

- Updated owner instruction `كمل ارفع وانشر` authorizes release ONLY after the entire intended feature and required verification pass. No partial/failed release. This supersedes the original no-commit/push/deploy instruction; intermediate tasks stay uncommitted.
- No Production data changes, configuration/secret changes, historical backfill, destructive migration or write diagnostics.
- No schema migration planned: extend optional `bookingOperations.transportPlan` in existing booking JSON only.
- Paper 80mm; existing Booking Center A4 visual design and other invoice modules remain unchanged.
- Per-trip charges sum once into the original booking transportation fee; overall charge remains one charge, never automatically divided or repeated.
- Driver copies never expose customer charges. No invented driver settlement/payment source.
- Printing never posts money, changes status, creates dispatch or proves physical printing.
- Preserve current source/branch/financial permissions, paid-booking restrictions and canonical payment reconciliation.
- Database/API errors remain structured errors, never empty data.
- Required verification includes typecheck, build, verify:critical and test:payment-state. Isolated DB smoke is SKIPPED without separately verified TEST configuration; never use Production or create a test DB.

## Review Focus

1. Concurrent legacy and trip editors must not overwrite a plan or add the transportation fee twice; pin a stale-revision and unchanged-retry test in Task 3.
2. Missing arrival/release times must not make repeated driver/vehicle use appear free; pin unknown-interval and ETA-only cases in Task 2.
3. Overall pricing with multiple vehicles must not credit every vehicle with the entire fee; pin an unallocated-revenue case in Task 4.
4. Switching an already-open preview from customer to driver must remove all customer prices and private notes, including HTML/QR; pin an asynchronous stale-result test in Task 6.
5. Legacy fields, malformed stored JSON and API failures must remain distinct; pin legacy read/no-write, malformed-plan rejection and failed-fetch vs no-operation cases in Tasks 1, 3 and 6.

## File map / responsibilities

- Create `src/lib/booking-transport-plan.ts`: pure plan validation, legacy adaptation, stable references, customer fee and resource-use normalization.
- Create `src/server/booking-transport-receipt.ts`: feature-specific receipt read model and financial redaction; no financial writes.
- Create `src/lib/transport-receipt.ts`: field-settings schema/defaults and escaped standalone thermal HTML.
- Create `src/components/transport-receipt-dialog.tsx`: trip selection, preview, recipient/copies, settings, print-request feedback.
- Create `src/components/booking-transport-plan-editor.tsx`: existing transportation-card trip editor, original save endpoint integration.
- Modify `src/server/api.ts`: original transport schemas/save/read paths, feature-scoped receipt/settings/audit handlers, fleet projections; do not restructure this monolithic router.
- Modify `src/server/booking-resource-period.ts`, `booking-resource-availability.ts`, `booking-conflict-report.ts`: include all plan assignments in current resource checks.
- Modify `src/views/admin/booking-operations-workspace.tsx`, `booking-center.tsx`, `vehicles.tsx`: narrow existing entry points/projections only.
- Modify `src/views/admin/enterprise.tsx` only where its existing fleet trip selector needs stable trip identity or matching revised DTO; do not redesign dispatch.
- Modify `src/server/booking-loading.ts` only if the existing primary-vehicle compatibility projection requires it; do not invent multi-manifest stock movements.
- Create focused tests `scripts/test-booking-transport-plan.ts`, `test-booking-transport-plan-store.ts`, `test-booking-transport-plan-resources.ts`, `test-transport-receipt.ts`, `test-transport-receipt-ui.tsx`, `test-transport-receipt-browser.ts` and feature wiring tests.
- Modify existing transport/resource test fixtures when contracts intentionally extend; retain behavioral assertions rather than deleting regression cases to pass new code.
- Add focused test command(s) to existing `package.json` using `scripts/run-tsx.mjs`; no invented package manager or global test infrastructure changes.

## Shared-helper caller audit before edits

- `guardBookingResourceWrite`/`readResourceBooking`: original booking create/edit, operating-period edit, restore, service changes, asset/loading/team actions and dispatch. Enumerate actual import/call sites before changing ResourceBooking fields or snapshot equality.
- `findBookingVehicleConflict`/`findBookingStaffConflict`: resource guards, dispatch, conflict report and photography checks. Queries must recognize new plan assignments without weakening legacy windows or cross-source checks.
- `saveBookingOperations` plus evidence-preserving JSON SQL: all booking operation mutations; preserve `transportPlan` using existing merge semantics, and reject stale conflicting edits.
- Kosha create/PATCH and service transportation POST/PATCH: maintain existing authoritative columns/fee, permissions and paid-state rules; no parallel financial writer.
- Fleet list/detail financial API and enterprise trip picker: source-aware identity, customer-fee attribution and approved expenses; no duplicate costs/revenue.
- Reuse `printHtmlDocument`; do not change the generic PrintJob API or global print helper unless a focused test proves it is necessary and all current callers are reviewed.

### Task 1 — Pure plan contract and legacy adapter

**Files:** `booking-transport-plan.ts`, `test-booking-transport-plan.ts`.

**Interfaces:** Export `TransportPlan`, `TransportTrip`, `TransportFeeMode`, `TransportReference`, `TransportPlanError`; `readTransportPlan(input: {source: 'kosha'|'service'; id: number; bookingNumber: string; legacy: unknown; storedPlan: unknown}): TransportPlanView`; `validateTransportPlan(input: unknown): TransportPlan`; `transportPlanFee(plan: TransportPlan): number`; `transportTripReference(bookingNumber: string, sequence: number): string`.

- [ ] Write failing tests: legacy config yields one stable read-only operation and no writes; missing legacy/plan yields no operations; malformed stored plan throws; duplicate IDs/sequences, negative/nonfinite/over-limit amounts, oversized notes and >50 trips fail.
- [ ] Assert per-trip 30,000 + 20,000 => 50,000; overall 50,000 across two operations => 50,000; stable sequences never depend on array ordering; no invented optional data.
- [ ] Run `node scripts/run-tsx.mjs --tsconfig tsconfig.json scripts/test-booking-transport-plan.ts`, confirm failure before implementation.
- [ ] Implement minimal pure schema/adapter with existing currency precision; retain legacy `inTotal` meaning outside the renderer. Re-run for PASS.

### Task 2 — Complete transport resource protection

**Files:** plan resource tests; original resource-period/availability/conflict-report files.

**Interfaces:** Add `transportResourceUses(plan: TransportPlanView, bookingOccupancy: ResourceOccupancy): TransportResourceUse[]` to the pure plan module; retain original singular ResourceBooking fields and add typed complete plan uses. Original guard signatures stay compatible.

- [ ] Add failing cases for two different trip drivers/vehicles, same-resource overlap, sequential intervals, touching endpoints, ETA without release, missing occupancy and invalid stored plans. Include an original legacy reservation and photography/dispatch conflict in each direction.
- [ ] Run focused tests using existing tsx runner and confirm RED.
- [ ] Extend original source queries/snapshot comparisons/ordered locks to all trip assignments. Cross-booking occupancy remains full existing operating period. Same-booking reuse requires explicit valid non-overlapping loading-through-release intervals within it.
- [ ] Ensure date/time edits, resource restore and new assignments recheck the complete plan in the same transaction; never modify the other booking.
- [ ] Re-run focused tests and `pnpm run test:booking-resource-period`, `pnpm run test:booking-resource-transition`, `pnpm run test:booking-conflicts`; fix introduced regressions before Task 3.

### Task 3 — Original transport saves, aggregate and concurrency

**Files:** original API schemas/routes/JSON preservation; plan-store/wiring tests; original booking transport tests.

**Interfaces:** Extend existing original transport payloads with optional `transportPlan` and `expectedTransportRevision`. Kosha still saves via `/admin/kosha-bookings/:id?source=kosha`; service via `/admin/booking-operations/service/:id/transportation`. GET adds plan view/capabilities without removing existing `transportation`/`dispatchVehicle` keys.

- [ ] Add failing transactional fake-store cases: legacy migration on explicit save only, exactly-once fee delta, unchanged retry, stale revision409, two writers, paid-booking rejection, malformed payload422, nonfinancial user cannot change total, another operation edit cannot erase the plan.
- [ ] Assert existing service informational fee is added once only under the original `inTotal` contract; Kosha keeps authoritative columns and original restriction after executed payments.
- [ ] Confirm tests fail; implement within original locked source transaction, with canonical reconciliation where required and structured AJN errors. Preserve dedicated printable notes separately from internal notes.
- [ ] Reject conflicting legacy single-config edits when a multi-trip plan exists, with a direct editor instruction; preserve unrelated booking JSON and original source identity.
- [ ] Re-run focused tests plus `pnpm run test:booking-transport`, `pnpm run test:booking-finance`, `pnpm run test:payment-state`; no Production writes.

### Task 4 — Authorized receipt projection and fleet integration

**Files:** `booking-transport-receipt.ts`, original transportation read/fleet API handlers, `vehicles.tsx`, necessary enterprise selector adaptation; projection/permission tests.

**Interfaces:** `readTransportReceipt(executor, ref: TransportReference, selection: {tripId: string; variant: 'customer'|'driver'|'internal'}, access: TransportReceiptAccess): Promise<TransportReceiptData>`. The access object is created only from existing server authorization predicates; client flags cannot grant access. DTO includes `amount: {value: number; label: string}|null`, not hidden extra customer-price properties.

- [ ] Test exact source+booking+trip identity, unknown/cross-booking trip404, denied view403, customer money only with existing finance visibility and driver variant with no customer charge anywhere in its DTO. Test missing staff/vehicle optional details without fabricated values.
- [ ] Implement read-only transport receipt selection through the existing transportation API using query parameters, with structured errors and joins to existing company/staff/vehicle records. No duplicate endpoint for a second transport system.
- [ ] Extend existing fleet trip projection to one identifiable operation per trip. Per-trip mode attributes recorded charges; overall multi-vehicle mode returns explicit unallocated revenue, not zero profit or repeated revenue. Display unavailable profit honestly where allocation is absent.
- [ ] Pin approved vehicle-expense cost counted once across the booking view; retain one existing financial transaction and do not infer driver payable from driverId. Driver settlement remains explicitly unavailable if no authoritative source exists.
- [ ] Run projection/permission tests and original transport/vehicle financial regressions before continuing.

### Task 5 — Safe thermal renderer, settings and print-request audit

**Files:** `transport-receipt.ts`, pure renderer tests; scoped existing API settings/audit integration.

**Interfaces:** `TransportReceiptData`, `TransportReceiptSettings`, `DEFAULT_TRANSPORT_RECEIPT_SETTINGS`, `normalizeTransportReceiptSettings(input: unknown): TransportReceiptSettings`, `buildTransportReceiptHtml(data: TransportReceiptData, settings: TransportReceiptSettings, copies: number): string`.

- [ ] Write failing HTML tests for Arabic/RTL and escaped hostile strings, 80mm page width/72mm content, long notes, large amounts, 1–5 copies, stable references, correct overall caption, no admin controls, driver customer-charge absence and hidden fields. Reject invalid copies instead of silently changing them.
- [ ] Implement dedicated standalone B&W composition using existing image/font-ready print infrastructure. Use `80mm auto` plus measured finite-height fallback; do not alter protected A4 styles or Print Agent.
- [ ] Add scoped validated namespaced settings via existing configuration infrastructure, including authorized reset; no modification to `printerSettings`. Unknown field settings do not grant financial access.
- [ ] Optional QR points only to authenticated existing booking transportation selection, with no public customer/financial payload; omitted if safe target unavailable.
- [ ] Record print requests in existing audit infrastructure after document/popup preparation, with actor/source/trip/format/recipient/copies. Never record physical success or trigger any financial/status writer. Test audit failure is visible without duplicating a trip/payment.
- [ ] Run focused renderer/settings/audit tests; verify unchanged A4 file diff.

### Task 6 — Editor, preview and all entry points

**Files:** new transport editor/dialog, booking workspace, Booking Center actions, vehicle trip actions; UI/browser tests.

**Interfaces:** `TransportReceiptDialog({reference: TransportReference|null, onClose: () => void})`; `BookingTransportPlanEditor` consumes existing authorized transport DTO/capabilities and submits only through Task 3 original routes. Shared UI action carries exact source/id and optional stable trip ID.

- [ ] Write RED tests for single-trip direct preview, multiple-trip selection, no-trip authorized shortcut, permission-denied/no edit, failed GET is not empty-state, loading/error/retry, recipient and 1–5 copy selection, settings defaults/reset.
- [ ] Test delayed customer response after switching to driver never renders customer money; query key includes source/id/trip/variant and stale previews are cleared while fetching.
- [ ] Implement responsive RTL dialogs/editor with current primitives and design tokens; accessible labels/focus, keyboard cancel and touch-friendly controls. Pricing-mode switch shows aggregate before explicit save; optional occupancy controls explain same-resource reuse.
- [ ] Add one secondary menu entry `طباعة وصل نقل 80mm` to Booking Center and workspace print menu, per-trip transportation history action and fleet history action. Preserve all original A4/thermal/preparation actions and existing URLs/query parameters.
- [ ] Use `printHtmlDocument` for the selected standalone receipt; maintain preview on print or audit failure. Multiple copies reference one operation and create no records.
- [ ] Run component tests, desktop and mobile browser fixtures with mocked API only; test keyboard, long Arabic names/notes, overflowing fields, popup blocked, reprint, cancellation and existing booking navigation.

### Task 7 — Final regressions, review and verified release

**Files:** focused test command(s), browser tests, task ledger/report; product changes only for verified regressions caused by Tasks 1–6.

- [ ] Self-review the implementation against every section of the approved design, including aliases/legacy callers, permissions, dual pricing and no money writes from print. Request a fresh read-only whole-change code review using the review skill before completion.
- [ ] Run focused feature tests and listed original transport/finance/resource tests; run `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, `pnpm run test:payment-state`. Use configured lint only if it exists.
- [ ] Run print-media browser layout checks at actual 80mm and mobile viewport, measured-height fallback, long multi-copy content, no blank extra page and no A4 changes. State physical hardware test unavailable unless actually performed.
- [ ] Verify isolated test configuration without exposing values; `pnpm run test:save-smoke` only with separate verified TEST DB and required write flags; otherwise report SKIPPED. No secret/test DB creation, Production write tests or migrations.
- [ ] Report reused components/APIs, implementation, exact changed files, no schema change, actual test results/skips and driver settlement/physical printer limitations. After clean review and mandatory gates, integrate only this completed feature, push main and verify the connected Production deployment, as authorized by the latest owner instruction. Keep unrelated primary-checkout drafts untouched.

## Plan self-review / approval boundary

All approved design sections map to Tasks 1–7. Price types and plan identity are
owned by Task 1, mutations by Task 3, redaction by Task 4, renderer/settings by
Task 5 and interaction state by Task 6. Resource and financial regression gates
are intentionally before UI wiring. No task authorizes historical rewrites or
release before review and required verification. The latest explicit owner instruction authorizes the final verified release. The five Review Focus risks each have an explicit owning test above.

Execution method proposed: native implementation in this existing isolated
worktree, then a fresh independent review. This minimizes shared-file contention
in the large existing server router. This plan is ready for owner review before
implementation; no product code has been written by preparing it.
