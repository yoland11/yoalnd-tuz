# Customer Follow-up Center — local implementation report

Date: 2026-11-04 (Asia/Baghdad).

Implementation complete. Following the user's explicit release request, **migration 0134 was applied successfully** through the existing additive migration runner and its catalog validation. GitHub/Vercel publication is verified separately in the release result. No existing Production business data or financial records were modified for testing.

## Implemented behavior

- Admin entry: **العملاء ← مركز المتابعة**, route `/admin/customer-followups`.
- Four compact counters only: today, overdue, upcoming, converted. One searchable/paginated table on desktop, cards on mobile. Service/status/employee/date-bucket filters and a small report disclosure.
- Add followup with existing customer search or the original customer quick-add dialog, service interest, Baghdad date/time, employee and optional note.
- One-click completion; optional completion note/next date; postponement; interested/waiting/uninterested states. The converted state requires a real eligible booking.
- Manual WhatsApp links with prepared Arabic text and phone links. Opening the page never sends a message. A declined service and customer-wide contact stop are separate actions.
- Read-only booking/inquiry suggestions. Actual booking occasion, existing services, linked photography, prior suggestions, open inquiries, service declines and contact preferences determine eligibility. Unknown occasions remain unknown.
- Managers see all followups and can reassign an inactive former employee's followups to an active employee. This does not give a manager access to the global customer directory unless the original customer permission is present.
- Employees see assigned followups at `/staff?tab=followups`; the original Staff Portal and Koshat portal show assigned-only reminders. Reminders are derived from existing due followups and do not create duplicate notifications.
- Conversion uses the existing Booking Center form, retaining the original customer. Source eligibility and original customer phone are locked/validated before booking/resource writes. Repeated submission recovers the saved booking before equipment conflicts can obscure it. The original transaction links the followup and audit atomically.
- An explicit action can link an existing eligible booking for the same customer. Bookings that predate the followup cannot be counted as a conversion. Arbitrary independent bookings are not automatically attributed by name or phone.

## Existing modules reused

Canonical `customers`, `staff`, `service_orders` and `kosha_bookings`; active AJN sessions and permissions; original customer creation/duplicate checks; original unified booking form and `createServiceOrderWithHistory` transaction; original resource validation, booking insertion/status history and photography synchronization; AJN structured errors/request IDs/safe logs; shared TanStack Query cache/session cleanup; original avatars, employee picker, date field, dialogs, table/button controls and phone normalization.

The new picker deliberately avoids the historical `/admin/customers` GET backfill. Feature requests also bypass unrelated broad admin customer/payment/Cash Box bootstrap while retaining global schema revision and original session authentication.

## Persistence and safeguards

One isolated additive file: `lib/db/migrations/0134_customer_followups.sql`.

It creates only feature-owned `customer_followups`, `customer_followup_events` and `customer_followup_contact_preferences`. Canonical customers/employees/bookings are referenced, not copied. Existing table schemas and historical rows remain unchanged.

Unique open customer/service pairs, suggestion keys and durable request tokens prevent duplicates. Transaction locks, optimistic versions and immutable result/audit events support retries and atomic completion/next-followup/conversion. Global contact stop and service decline remain distinct.

Missing feature schema returns an explicit structured unavailable error; it never creates tables at request time or presents a false empty list. No-source/public booking requests retain their original customer resolution and do not read feature storage. No financial formulas, approvals, stock movements, payment posting or invoice designs were modified.

`createServiceOrderWithHistory` has two existing callers: public service-order creation and admin service-order creation. Only admin requests containing an explicit followup source supply the new optional customer resolver. Its fallback, original resource validation, original insertion and photography callback remain intact for ordinary bookings.

Release applied only migration 0134 through the project's reviewed migration runner, transactionally, using the authoritative owner `DATABASE_URL`. Its tables, constraints and indexes passed the migration's catalog checks. No other pending migration was applied. For other environments, use the same isolated workflow; prefer a forward fix or code rollback to dropping feature tables after data exists.

## Verification

Final required verification completed successfully after the final review fixes. Synthetic/browser data is not represented as PostgreSQL integration coverage.

- Focused `node scripts/test-customer-followups.mjs`: **PASS — 13 suites**, including domain/read/store/mutations/schema, permission/assignment boundaries, HTTP errors, original API bootstrap predicates, original booking transaction/customer identity, source wiring and UI.
- Mounted `node scripts/test-customer-followups-browser.mjs`: **PASS**, actual shared page, original Booking Center and original Staff Portal at 1440px and 390px. All HTTP is intercepted; no real customer contact or backend/database request occurs.
- Browser coverage includes error/retry, four counters, customer preview, exact lost-response retry, complete/postpone/next followup, service decline versus contact stop, manager reassignment and inactive employee filter, staff restrictions, source identity, original financial request values, already-saved recovery, query-only reminder navigation, one-row mobile footer and no horizontal page overflow.
- Independent final review: three findings fixed (unrelated bootstrap writes, legacy phone identity, resource-first retry recovery); follow-up patch review found no remaining correctness/security blockers. Review is not a substitute for live database testing.
- `pnpm run verify:critical`: **PASS, exit 0** on the final source. It runs the actual `pnpm run typecheck` and `pnpm run build` commands, both **PASS**, plus payment-state reconciliation, financial approval, original booking/inventory/permission regressions and the 13 followup suites. Build compilation and its TypeScript pass completed successfully. Final log: `.superpowers/sdd/customer-followup/verify-critical-final.log`.
- Lint: **NOT CONFIGURED** — no `lint` command exists in the real root `package.json`.
- `pnpm run test:save-smoke` and real concurrent database reservation/conversion tests: **SKIPPED** — no separately verified isolated TEST database is configured. Never run write tests against Production or fall back to `DATABASE_URL`. Migration 0134 itself was executed successfully as authorized release DDL, not as a Production write test.

Evidence screenshots are stored in `C:/Users/ALIJAN/.codex/visualizations/2026/08/22/01a02a5d-8cc1-7861-ad2f-4a59a5f49eda/customer-followup-2026-11-04/`. Local command logs are under `.superpowers/sdd/customer-followup/`.

Git whitespace verification passed. The implementation report inventories all 40 task files, originally based on `cf252a3d59e2a378ac40abf3f16513db8eab6864`. The later release request authorizes integration with current `main`, commit, push and Vercel publication through the existing mandatory pre-push gate.

## Files changed

### Application and persistence

- `lib/db/migrations/0134_customer_followups.sql`
- `lib/db/src/schema/customer-followups.ts`
- `lib/db/src/schema/index.ts`
- `src/components/customer-followup-reminder.tsx`
- `src/lib/booking-repeat.ts`
- `src/lib/customer-followup-booking.ts`
- `src/lib/customer-followups.ts`
- `src/server/api.ts`
- `src/server/customer-followup-route.ts`
- `src/server/customer-followups-rules.ts`
- `src/server/customer-followups.ts`
- `src/views/admin/_layout.tsx`
- `src/views/admin/booking-center.tsx`
- `src/views/admin/customer-followups.tsx`
- `src/views/admin/index.tsx`
- `src/views/staff/index.tsx`
- `src/views/staff/unified-portal.tsx`

### Verification and documentation

- `package.json`
- `scripts/run-critical-verification.mjs`
- `scripts/test-customer-followups.mjs`
- `scripts/test-customer-followups-browser.mjs`
- `scripts/test-customer-followup-assignment.ts`
- `scripts/test-customer-followup-booking.ts`
- `scripts/test-customer-followup-booking-browser.ts`
- `scripts/test-customer-followup-browser.ts`
- `scripts/test-customer-followup-customer-identity.ts`
- `scripts/test-customer-followup-domain.ts`
- `scripts/test-customer-followup-mutations.ts`
- `scripts/test-customer-followup-permissions.ts`
- `scripts/test-customer-followup-preflight.ts`
- `scripts/test-customer-followup-read.ts`
- `scripts/test-customer-followup-route.ts`
- `scripts/test-customer-followup-schema.ts`
- `scripts/test-customer-followup-staff-browser.ts`
- `scripts/test-customer-followup-store.ts`
- `scripts/test-customer-followup-ui.tsx`
- `scripts/test-customer-followup-wiring.ts`
- `docs/superpowers/plans/2026-11-03-customer-followup.md`
- `docs/superpowers/specs/2026-11-03-customer-followup-design.md`
- `docs/reports/2026-11-04-customer-followup-center.md`

## Usage

1. After migration/application activation, open **العملاء ← مركز المتابعة**.
2. Choose **إضافة متابعة**, select the existing customer (or use the original new-customer dialog), service/date/employee, then save.
3. Use WhatsApp/phone manually; choose **إكمال** or **تأجيل**. Additional completion options allow a note and next date.
4. Choose **إنشاء حجز**, review actual services/pricing in the original Booking Center, and save. The inquiry becomes converted to that exact booking. A saved booking is recovered instead of creating a duplicate on retry.
5. Employees open **متابعات العملاء** in their original staff portal. Managers can filter/reassign existing followups; contact preference controls are explicit.

## Remaining limitations

- Production feature schema is applied. Application publication must be confirmed from the exact Git commit's Vercel deployment status, not inferred from a successful local build.
- Real PostgreSQL locking/concurrency and write-path smoke remain unverified until a separate TEST database is available.
- Conversion is automatic when entering through the explicit followup action; independent bookings can be linked explicitly after canonical eligibility validation. No inferred causal attribution is introduced.
- WhatsApp sending remains a manual employee action, as requested.
