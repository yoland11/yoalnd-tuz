# Unified Booking Event Types Implementation Plan

> **For agentic workers:** Execute the independently owned tasks below with shared interfaces. Do not commit, push, deploy, or write Production data.

**Goal:** Select, save, edit, display, search, filter and report the six requested occasions inside the original AJN Booking Center.

**Architecture:** Reuse `service_orders.custom_fields.eventType` and `kosha_bookings.event_type`. A pure shared normalizer recognizes canonical keys and historical Arabic/English labels; new writes store the established readable Arabic label. Use existing follow-up transactions and graduation order links. No new table, booking system, invoice, or migration.

**Tech Stack:** React, TypeScript, existing AJN Button/Dialog/form components, lucide icons, existing Next.js API and Drizzle readers/writers.

**Spec:** User request in this chat: six mandatory choices for new bookings; editable historical records; independent occasion filter; badges/details/reports/search; existing follow-ups and graduation integration; Arabic RTL; no commit/push/deploy.

## Global Constraints

- Do not commit, push or deploy; the current request overrides automatic release.
- Preserve historical missing/custom event types and unrelated create/edit clients.
- No schema or financial changes. Keep existing booking fields, departments, prices and statuses.
- Only the updated Booking Center create contract (`bookingCenterVersion: 2`) requires an event choice server-side. Existing version 1 clients and repeats remain compatible.
- A provided changed occasion must be valid; an unchanged unknown legacy value must survive unrelated edits.
- Missing occasions remain visible under “الكل”; unknown nonempty legacy occasions display their original text and belong to “أخرى”.
- Occasion does not select a paid service, create a graduation order, or duplicate customer/follow-up records.

## Shared Interfaces

Root owns `src/lib/booking-event-types.ts` and `src/components/booking-event-type.tsx`:

- `BOOKING_EVENT_TYPES`: `{key,label}[]` for engagement/henna/wedding/birthday/graduation/other.
- `BookingEventType`, `BookingEventFilter = BookingEventType | "all"`.
- `normalizeBookingEventType(value): BookingEventType | null`.
- `bookingEventTypeLabel(value, fallback?): string`: Arabic label, preserved unknown text, or “غير محدد”.
- `bookingEventTypeStorage(value): string | null`: recognized readable Arabic label only.
- `bookingEventTypeMatches(value, filter): boolean`.
- `readBookingEventType(source, raw): unknown`: exact existing source field, with explicit graduation-origin recognition only.
- `bookingGraduationHref(raw): string`: existing graduation list, or supported stable order query.
- `BookingEventTypeSelector({value,onChange,required?,error?,disabled?,id?})`: `onChange` returns the recognized Arabic storage label.
- `BookingEventTypeBadge({value,className?})`.
- `BookingEventTypeFilter({value,onChange})`: accessible “all + six types” selection.

## Review Focus

- Old booking with no event type: still readable/editable, never silently classified as a wedding.
- Unknown historical free text: preserve/display it on unrelated edits; do not rewrite history.
- Add-services mode: preserve the original event and avoid mandatory re-entry.
- Filters: event and existing department/status/date/search predicates compose with AND.
- Follow-ups/graduation: stable IDs, original permission checks, no invented entity or duplicated records.

## Tasks

### 1. Shared model and selectors — root

- [x] Write/run alias, missing/unknown, storage, filter and explicit graduation-link tests.
- [x] Implement pure helpers and shared compact RTL icon selector/badge/filter.
- [x] Replace service/native editor occasion controls, preserving all existing fields and legacy values.
- [x] Verify the selector with keyboard/ARIA, aliases and historical values.

### 2. Original server paths — backend worker

Ownership: `src/server/api.ts`, a focused server validation helper if needed, and server tests.

- [x] Add optional eventType projection to original central list/detail sources.
- [x] Validate and normalize new version-2 center creation; retain old clients/repeats.
- [x] Validate explicit edits without rejecting unchanged historical records.
- [x] Use existing structured field errors and transactional writes.
- [x] Test actual create/edit admission and source-specific reads without Production writes.

### 3. Booking Center and workspace — UI worker

Ownership: `src/views/admin/booking-center.tsx`, `booking-center.css`, `booking-operations-workspace.tsx`, and focused center/UI/browser tests.

- [x] Add mandatory new-booking selector and follow-up preset initialization; keep add-services untouched.
- [x] Add independent occasion filter and readable search text.
- [x] Display occasion on every card and in the original workspace/details.
- [x] Add occasion filter/column to existing uncapped printed reports.
- [x] Provide graduation management shortcut using shared safe helper.
- [x] Verify old records, composed filters and responsive RTL controls.

### 4. Existing integrations — integration worker

Ownership: existing follow-up rules/operations and tests; graduation Orders query selection only if supported by existing authorized readers.

- [x] Reuse shared normalization while preserving four-value follow-up occasion contract.
- [x] Extend existing idempotent occasion chain to henna → wedding, keeping engagement behavior.
- [x] Reuse the stable graduation order relationship; no auto-created order or financial record.
- [x] Test duplicate/contact-blocking protections and birthday/other non-inference.

### 5. Verification — root

- [x] Review combined diff, callers, error behavior and unchanged financial fields.
- [x] Run targeted tests and browser checks at desktop/tablet/mobile sizes.
- [x] Run `pnpm run typecheck`, `pnpm run build`, `pnpm run test:payment-state`, and `pnpm run verify:critical` (the critical gate runs the named checks).
- [x] Run isolated save smoke only with separately verified TEST configuration; otherwise record SKIPPED.
- [x] Report implementation, local routes, tests and remaining limits. Leave changes uncommitted and unpublished.

## Completion — 2026-11-13

Implemented and reviewed all planned changes locally. pnpm run test:booking-event-types and pnpm run verify:critical passed on the final source; the critical gate ran TypeScript, production build, payment-state checks and existing regression suites. Browser verification passed at 1440, 768 and 390px. Isolated TEST database write/save smoke: SKIPPED because no separately verified TEST configuration is available. No migration, Production data write, commit, push or deployment.

## Release authorization — 2026-11-13

The user subsequently requested “ارفع وانشر”. That request supersedes the implementation-stage commit/push/deploy hold above. Release uses the existing Git main integration and mandatory pre-push verification; no database migration or Production data write is included.
