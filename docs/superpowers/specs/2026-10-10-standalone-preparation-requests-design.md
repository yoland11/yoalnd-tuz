# AJN Preparation Center: Customer-Linked Custom Preparation

Date: 2026-10-10
Status: design for owner review

## Intent and current state

The owner wants a button at the top of `/admin/preparation` to prepare items for a person, with an optional occasion. The occasion can be selected from an existing supported booking or entered as a new named occasion; the person can be selected from existing AJN customers or added through the existing customer flow. Preparation items may come from store products, assets, or a custom description ("من عندي"). The resulting work must be visible in the same preparation center and printable in A4 and 80 mm formats.

Today, the preparation center lists service bookings with stock reservations and all active Kosha bookings. Its booking-scoped preparation endpoint stores manually added items in the existing booking-operations metadata. It cannot represent a request without a booking. The UI already has the three item-source choices and the two print formats. No standalone preparation table was found. This design must not create a fake booking, duplicate an existing booking card, or turn preparation selection into an inventory or financial transaction.

## Chosen approach and alternatives

Add a small, isolated preparation-request record for requests that have no existing booking, with item rows and an AJN customer link. Keep the existing booking preparation path for selected service/Kosha bookings. Render both kinds in the current preparation center using a shared card/detail presentation and separate server adapters. This is the minimum additive model that can represent a request without inventing a booking.

Rejected alternatives: requiring a booking contradicts the optional-occasion flow; storing these requests as generic tasks loses the preparation-specific item/source/print behavior; creating a booking solely to hold a checklist would pollute booking and financial history.

## User flow and UI

1. A `تجهيز حسب الطلب` action appears in the blank header area above the preparation summary cards and opens an RTL dialog or drawer.
2. The first step offers an optional occasion: search/select an existing active service or Kosha booking; add a new occasion name with an optional date; or skip the occasion. A selected booking displays its existing customer and booking number. Cancelled or archived bookings are not selectable. A service booking selected here must appear in the preparation center even if it has no stock reservations yet.
3. If an existing booking is selected, its customer is read-only in this flow and the new items are appended to that booking's current preparation list. Otherwise the user searches existing AJN customers by name/phone or opens the existing `CustomerQuickAddDialog`. The customer is required for a standalone request; occasion name/date remain optional.
4. The user adds one or more lines from a real store product, a real asset, or a custom name. Each line has a positive quantity and department; a product/asset keeps its ID and a display snapshot of its name/SKU. The user can remove a draft line before saving. A request cannot be saved with zero lines.
5. On successful save the dialog closes and the relevant card is focused/refreshed. A standalone card is clearly labelled `تجهيز خاص` and displays its own reference number, person, optional occasion/date, progress, details, and existing-style A4/80 mm print actions. Booking cards remain visually and behaviorally unchanged except for this entry path.

## Data and API boundaries

- Use the existing customers table and existing customer-create flow; do not duplicate customer records. A new, permission-protected customer lookup should be paginated/limited and read-only instead of using the current all-customers response, which performs unrelated reconciliation work.
- Existing booking selection resolves source + ID on the server, verifies active/noncancelled state and access, then performs one atomic append to that booking's preparation metadata. It does not create a standalone request. The customer displayed is the booking's real customer/snapshot; this flow does not relink the booking.
- For standalone work, use one isolated, backward-compatible additive migration for `preparation_requests` and `preparation_request_items`, with a customer foreign key, nullable occasion name/date, creator/audit timestamps, source type, nullable product/asset reference, quantity, department, operational status, and a generated public preparation number. A unique client request token prevents retry-driven duplicate requests. The parent and all draft items are inserted in one transaction. Existing records and schemas are untouched.
- Product/asset selection is reference-only at creation. Do not create stock reservations, deduct stock, change item prices, generate invoices, post accounting, or modify booking totals/payments. The picker and detail read current product/asset availability through batched existing read paths and label it informational; custom lines show no stock figure. Only an existing explicit reservation workflow may allocate stock.
- The list/read APIs return booking cards and standalone cards with a discriminated source. Preserve the current preparation-list read permission alternatives (`preparation_view`, `bookings`, `orders`, `koshas`, `booking_operations_view`) for legacy callers; require `preparation_manage` for new list/item writes and the existing customer permission for customer creation. Detail and mutation endpoints remain source-specific. Do not trust customer, booking, or product IDs supplied by the browser; revalidate them on the server.
- Standalone items use the existing preparation status and employee-assignment semantics. Assigned staff tasks refer to the standalone preparation ID using a distinct related type; the staff preparation read path resolves this type and must not mistake it for a booking. Existing booking timeline and audit behavior stay intact. Record standalone creation/updates in the existing safe admin activity audit path.

## Error handling and compatibility

Validation errors identify the field; API/database failures use the AJN structured error contract, correct HTTP status, request ID, and safe server logging. Never render a failed lookup as an empty customer/product list. A failed save leaves customer, occasion, and draft lines in place; the API never leaves a partial standalone request. Double-submit is disabled in the UI and deduplicated on the server. Legacy booking cards, manual items, A4 printing, and 80 mm printing remain readable and unchanged. Standalone print output has its own label and uses its actual person/occasion/item data; it never displays fabricated booking or invoice numbers.

## Verification and release

Test existing-customer and new-customer selection; existing booking versus new/no occasion; product, asset, and custom lines; invalid/deleted IDs; cancelled booking denial; permission denial; zero-line validation; duplicate submission; atomic rollback; list/detail progress; print output in A4 and 80 mm; desktop/mobile RTL; and API-failure preservation. Ensure no stock, payment, invoice, or booking creation occurs. Run `pnpm run typecheck`, `pnpm run build`, `pnpm run verify:critical`, `pnpm run test:payment-state`, and focused preparation tests. Run `pnpm run test:save-smoke` only with a separately verified test database; otherwise report **SKIPPED**. Database write tests must use `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separate `TEST_DATABASE_URL`, never Production. Apply only the reviewed additive migration and verify its objects before a completed release. Do not commit/push/deploy partial code or failed validation.
