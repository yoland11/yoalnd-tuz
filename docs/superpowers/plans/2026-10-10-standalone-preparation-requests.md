# Customer-Linked Preparation Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-of-page custom preparation flow that uses an existing or new AJN customer, an existing or new/omitted occasion, and product/asset/custom items without creating a fake booking or moving stock.

**Architecture:** Existing-booking selections append atomically to the booking's current preparation metadata. Otherwise a customer-linked standalone preparation request and its items are saved in two additive tables, read alongside existing booking cards, and printed through the current A4/80 mm presentation paths. The UI uses one wizard and a source-discriminated detail adapter.

**Tech Stack:** Next.js 16, React, TypeScript, Zod, Drizzle/PostgreSQL, TanStack Query, existing AJN PDF/thermal helpers, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-10-standalone-preparation-requests-design.md`

## Global Constraints

- Preserve all existing service/Kosha booking cards, IDs, preparation metadata, print layouts, customer records, payment/accounting values, and stock reservations.
- Never create a booking or stock reservation merely to record custom preparation; product and asset picks are reference-only.
- New schema is one isolated additive migration: `preparation_requests` and `preparation_request_items`; no destructive or historical-data writes.
- Preserve legacy preparation-list read permissions; require `preparation_manage` for creation/item writes and existing customer permission for new-customer creation.
- Database/API failures retain AJN's structured error and request ID; no error-to-empty-list fallback.
- Multi-record creation and booking bulk append are atomic; retrying a create token cannot duplicate a request.
- Production write diagnostics are forbidden. Isolated write tests require `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separate `TEST_DATABASE_URL`.
- Required release gates: `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, `pnpm run test:payment-state`; `pnpm run test:save-smoke` is **SKIPPED** without a verified isolated test DB.

## Review Focus

1. A legacy booking with a customer name but no `customer_id` still selects that booking and never silently relinks it (Task 2 test).
2. A service booking with no stock reservation becomes visible after its first manually added preparation item (Task 2 test).
3. An asset/product archived after picker search is rejected at save, not saved as a stale reference (Task 1 test).
4. Retry of the same request token returns the same preparation number without another row set (Task 1 test).
5. A customer/product/booking lookup failure displays an error and retry instead of "لا توجد نتائج" (Task 3 test).

---

### Task 1: Standalone storage and guarded API

**Files:**
- Create: `lib/db/migrations/0122_standalone_preparation_requests.sql`
- Create: `lib/db/src/schema/preparation.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `src/server/preparation-requests.ts`
- Modify: `src/server/api.ts` (`handlePreparation` and its explicit caller)
- Create: `scripts/test-standalone-preparation.ts`
- Modify: `package.json` and `scripts/run-critical-verification.mjs` to add the focused non-destructive test.

**Interfaces:**
- Produces `CreatePreparationRequestInput = { requestToken: string; customerId: number; occasionName?: string | null; eventDate?: string | null; items: Array<{ source: "product" | "asset" | "custom"; productId?: number | null; name: string; department: string; quantity: number; infoOnly?: boolean }> }`.
- Produces `createPreparationRequest(input: CreatePreparationRequestInput, actorId: number): Promise<{ id: number; number: string }>` and `listStandalonePreparationCards(): Promise<PreparationCard[]>`, `getStandalonePreparationDetail(id: number): Promise<PreparationSummary | null>` in `src/server/preparation-requests.ts`.
- API: `GET /admin/preparation/customers?search=`, `GET /admin/preparation/catalog?source=&search=`, `GET /admin/preparation/eligible-staff`, `POST /admin/preparation/requests`, `GET /admin/preparation/requests/:id`, `PATCH /admin/preparation/requests/:id/items/:itemId`. Use existing AJN response/error helpers and permissions.

- [ ] **Step 1: Write failing focused tests.** In `scripts/test-standalone-preparation.ts`, assert input validation, positive integer quantity, product-vs-asset flag validation, unknown/deleted customer rejection, stale/archived product rejection, unauthorized create/assign denial, retry token idempotency, atomic parent+items rollback (mocked transaction or isolated TEST DB only), assignment task reference, and customer search's empty/error distinction.
- [ ] **Step 2: Run the focused test.** Run `node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/test-standalone-preparation.ts`; expect a failure for missing schema/functions.
- [ ] **Step 3: Add schema and one reviewed migration.** Add request number, token unique index, customer FK, nullable occasion fields, audit timestamps; add item FK, source check, nullable product FK, positive quantity, status, assignee, and order index. Keep existing tables untouched.
- [ ] **Step 4: Implement server functions and API.** Validate every referenced ID on the server, create parent+items transactionally, use token conflict to return the original request, batch-read item availability, and route errors through AJN's structured contract. Customer/catalog/staff search must be bounded and read-only; do not call the all-customers GET that performs backfill. Item status/assignment updates use the existing staff-task semantics with a distinct `preparation_request` related type and safe admin audit logging.
- [ ] **Step 5: Run the focused test and typecheck.** Both commands must pass; inspect the migration SQL for additive-only operations.
- [ ] **Step 6: Commit only Task 1 files on the isolated branch.** Do not push `main` or apply a Production migration at this stage.

### Task 2: Existing-booking append and combined preparation cards

**Files:**
- Modify: `src/server/api.ts` (booking-scoped bulk-add action and preparation list composition)
- Modify: `src/server/booking-preparation.ts`
- Modify: `src/server/preparation-requests.ts` (shared card/rollup adapter if needed)
- Create: `scripts/test-preparation-existing-booking.ts`
- Modify: `package.json` and `scripts/run-critical-verification.mjs` to include the focused test.

**Interfaces:**
- Consumes `listStandalonePreparationCards()` from Task 1.
- Produces `GET /admin/preparation/bookings?search=` and `POST /admin/preparation/bookings/:source/:id/items` with `{ requestToken, items }` and one atomic append into existing `bookingOperations.manualPrepItems`; `source` is only `service | kosha`.
- Extends card source to `"service" | "kosha" | "request"`; preserves existing booking card fields and adds a request marker/occasion label only for standalone cards.

- [ ] **Step 1: Write failing tests.** Assert one atomic append of multiple items, cancellation/archive denial, unknown booking rejection, legacy customer snapshot without relinking, no reservation/booking/payment writes, and visibility of manual-only service bookings.
- [ ] **Step 2: Run `node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/test-preparation-existing-booking.ts`; expect the new cases to fail.**
- [ ] **Step 3: Implement server-side booking validation and bulk append.** Reuse existing preparation item structure and audit path; apply a single metadata update under a row lock/transaction and deduplicate retries by token. Do not change existing one-item endpoint contracts.
- [ ] **Step 4: Combine cards without duplicates.** Include active service bookings with manual-only items in the batch read; merge standalone cards from Task 1, preserve existing read permission alternatives and cancellation filtering, and keep summary counts accurate.
- [ ] **Step 5: Run both preparation focused tests plus `pnpm run test:preparation-cards` and `pnpm run test:payment-state`; expect PASS.**
- [ ] **Step 6: Commit only Task 2 files on the isolated branch.** Do not publish partial work.

### Task 3: Top action, wizard, standalone detail, and printing

**Files:**
- Create: `src/views/admin/preparation-create.tsx` (wizard and draft-line list)
- Create: `src/views/admin/preparation-item-picker.tsx` (extracted three-source picker reused in details and wizard)
- Modify: `src/views/admin/preparation.tsx` (header action, source-aware card/detail, query states, print adapters)
- Modify: `src/views/admin/customer-quick-add.tsx` only if a reusable description prop is needed; preserve sales/booking behavior.
- Create: `scripts/test-preparation-create-ui.tsx`
- Modify: `package.json` and `scripts/run-critical-verification.mjs` to add the focused UI test.

**Interfaces:**
- Consumes Task 1 customer/catalog/request endpoints and Task 2 booking bulk-add endpoint.
- Produces `PreparationCreateDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: (cardKey: string) => void })`.
- `PreparationItemPicker` emits the exact draft-item shape from `CreatePreparationRequestInput["items"][number]`; quantity is a positive integer as in existing manual preparation.

- [ ] **Step 1: Write failing UI tests.** Assert occasion existing/new/skip, customer search/add, booking-customer read-only state, three item sources, zero-line save guard, failed-search retry message, failed-save draft preservation, double-submit disable, standalone card print labels, and mobile RTL wrapping.
- [ ] **Step 2: Run `node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/test-preparation-create-ui.tsx`; expect missing-component failures.**
- [ ] **Step 3: Extract the picker without altering existing item behavior.** Use bounded server search for products/assets, and pass draft lines to the wizard or the existing booking detail action.
- [ ] **Step 4: Add the top action and source-aware detail.** Search/select eligible bookings, call the existing customer quick-add dialog for new customers, save to the correct endpoint, preserve drafts on error, and focus/refetch the affected card on success.
- [ ] **Step 5: Extend A4 and 80 mm preparation printing for standalone requests.** Keep existing booking print templates unchanged, use real preparation number/person/occasion, and never display a fabricated booking/invoice number.
- [ ] **Step 6: Run the UI test and `pnpm run test:preparation-print`; expect PASS. Inspect desktop/mobile RTL and A4/80 mm print previews.**
- [ ] **Step 7: Commit only Task 3 files on the isolated branch.** Do not push/deploy until the full gate passes.

### Task 4: Integrated verification and safe release

**Files:** Only focused fixes exposed by verification; no unrelated modules.

**Interfaces:** Consumes Tasks 1-3; produces a verified release candidate, then a Production deployment only if every mandatory gate passes.

- [ ] **Step 1: Review the full diff and schema blast radius.** Check all callers of changed shared helpers, legacy booking behavior, permissions, and no inventory/payment writes.
- [ ] **Step 2: Run `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, and `pnpm run test:payment-state`; require all PASS.**
- [ ] **Step 3: Determine isolated DB availability without exposing credentials.** Run `pnpm run test:save-smoke` only when the required separate TEST configuration is verified; otherwise record **SKIPPED**. Never use Production for write smoke tests.
- [ ] **Step 4: Apply only `lib/db/migrations/0122_standalone_preparation_requests.sql` through the project's reviewed additive migration workflow, after required preflight; verify the two tables/indexes/FKs.** Do not run all pending migrations or destructive DDL.
- [ ] **Step 5: Re-run the relevant gates after any fix and confirm the intended branch diff is complete.** Merge/cherry-pick only intended commits to `main`, commit there, allow AJN's post-commit push/pre-push gate, and verify the connected Vercel Production deployment. If a mandatory gate fails, stop without commit/push/deploy.
