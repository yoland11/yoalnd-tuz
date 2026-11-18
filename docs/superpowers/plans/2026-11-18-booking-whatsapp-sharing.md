# Booking WhatsApp details and booked photos

**Goal:** From the original Booking Center/workspace, choose the customer or an employee and prepare booking details together with the selected booked-item photos for manual WhatsApp sending.

**Architecture:** Reuse the original authorized booking and overview, `bookingWorkspacePhotos`, `EmployeeSelect`, the existing staff API, branded receipt renderer, PNG capture and phone normalization. No new booking, financial, storage or messaging system. The existing WhatsApp URL opens the chosen contact; browsers cannot attach files through that URL. Prepare actual PNG files, allow copying/downloading, and offer the native file share sheet where supported. Never claim a message was sent.

**User choices:** WhatsApp only, including photos of the booked items. Customer phone is prefilled. Existing staff records contain no phone field, so employee recipients require an explicit number for this share; no schema changes or phone inference from usernames.

**Privacy:** Operational details by default for employees; financial details opt in. Customer shares may include the already-authorized original booking summary. Never export tracking secrets, admin URLs, internal notes, execution/group photos, payroll, or raw records. Photo selection must be explicit in the preview; image read failures block generation rather than silently omitting files.

## Tasks

- [x] Add failing tests for the allowlisted share text, original booked-photo selection/deduplication, photo pagination, money redaction and error handling.
- [x] Add focused `src/lib/booking-share.ts` and `booking-share-image.ts` adapters. Four booked pictures and up to twenty operational line descriptions per generated card avoid oversized mobile canvases; every card repeats the booking summary. Use validated, decoded local image bytes without re-uploading files.
- [x] Add a read-only `view=directory` projection to GET `/admin/staff`, behind its unchanged `staff.view` guard. Only active identity fields, bounded results; all other callers keep the original response and write behavior.
- [x] Add `BookingShareDialog` with customer/employee selection, explicit phone, photo selection, prepared PNG preview, native file sharing, clipboard/download, and chosen-contact WhatsApp link. Disable inputs while preparing; discard cancelled/stale generation. Errors remain visible.
- [x] Add the existing workspace action and a Booking Center shortcut opening that same workspace with the sharing dialog. No duplicate workspace or list-wide API loads.
- [x] Run focused tests and browser fixture tests: multiple original pictures, customer and selected employee, financial visibility, missing/failed media, file download, cancellation, native share, invalid phone, RTL/mobile, no mutations.
- [x] Run typecheck/build/verify:critical. Save-smoke is SKIPPED without separately verified TEST configuration. Independent final review completed with no unresolved important/critical findings.
- [ ] Under the user's safe auto-release policy, release only the completed verified files through normal Git hooks and verify exact Production commit/alias.

## Caller / blast-radius record

- Existing GET `/admin/staff` callers span employee finance, asset and booking selectors. The optional directory projection returns before salary/advance loading only when the new query value is supplied; existing callers and shared mutation infrastructure are unchanged.
- `receiptHtmlToPng` has one existing production caller, `shareReceiptImage` from `PrintFormatDialog`. It is reused without modification, so existing receipts retain their layout and behavior.
- `bookingWorkspacePhotos` is reused without changes. The dedicated share adapter also includes the separately resolved booked Koshah and deduplicates URLs, without copying stored files.
- Existing GET booking-products callers keep the original response. Only `?photos=1` asks the existing bounded `bookingServiceProductPhotos` / media-proxy helper for selected product images. `bookingOperationProducts` and its inventory/finance callers are untouched.
- Existing GET booking-finance callers keep the original response. Only `?summary=1`, behind the existing `booking_finance_view` guard, reads `getBookingFinancialSummary`; sharing never reconstructs money from card snapshots or legacy deposits. No financial writes or reconciliation changes.

## Verification ledger

- Unit/controlled-boundary tests pass for original photo selection, independent table IDs, canonical amounts/source identity, operational item snapshots, pagination, errors/cancellation, the real optional directory/product/finance branches, permissions and unchanged default products reads.
- Browser fixtures use actual AJN React, CSS and PNG capture with JPEG/PNG/SVG inputs. External traffic is blocked; OS sharing and clipboard are simulated. No actual WhatsApp messages or Production writes.
- `test:payment-state` and `test:booking-cashbox` pass. The old cashbox test's 600-character window was replaced by AST selection of the complete actual handler; all original safety assertions remain.
- Independent final review: no unresolved important/critical findings. Its stale-recipient, missing item details and cross-table photo-key findings were fixed and regression-tested.
- Final `verify:critical` passed, including TypeScript, the Production build, booked-photo sharing checks and all mandatory regression checks. Fifteen browser fixture cases passed with no page errors or mutations. Database write smoke is SKIPPED without separately verified TEST configuration; this is not a database integration pass.
- Release uses the existing pre-push gate and Vercel Git integration; exact Production commit and alias must be checked after pushing.
