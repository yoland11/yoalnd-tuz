---
name: ajn-booking-center-invoice
description: Use when inspecting, fixing, testing, or documenting the AJN Booking Center (مركز الحجوزات) A4 invoice, its booking data adapter, PDF download, browser printing, payment display, RTL behavior, or print regressions. Protects the existing A4 appearance and excludes POS, sales, purchase, photography, graduation, finance, warehouse, QR-label, thermal, and unrelated booking invoice work.
---

# AJN Booking Center invoice

Work only on the Booking Center invoice flow. The current A4 output is protected. Do not redesign it unless the user explicitly requests an A4 redesign for **مركز الحجوزات**.

## Required workflow

1. Confirm that the requested record is a Booking Center service order and the URL uses `type=booking`.
2. Read [architecture.md](references/architecture.md), [booking-data.md](references/booking-data.md), and [payments.md](references/payments.md) before changing data mapping.
3. Read [printing.md](references/printing.md) and [a4-protection.md](references/a4-protection.md) before changing any print, PDF, CSS, markup, asset, or shared invoice code.
4. Inspect all callers before changing `src/views/admin/invoice.tsx`, `src/views/admin/print-helpers.ts`, `/admin/invoices/:id`, or a shared helper. These files also serve other document types.
5. Keep changes gated to `type === "booking"` whenever shared code must change. Do not change the `order` or `kosha` branches as collateral work.
6. Use the API response as the invoice's source of truth. Do not create a second financial calculation engine in the React print component.
7. Preserve structured errors; never turn an API failure into an empty invoice or zero-value invoice.
8. Follow [testing.md](references/testing.md) and do not claim visual or physical print success without corresponding evidence.

## Hard protection rules

- Preserve the existing `.wedding-invoice-bleed` and `.wedding-invoice` A4 composition, artwork, fields, hierarchy, colors, typography, spacing, borders, QR/barcode placement, totals, signatures, and footer.
- Preserve the current 216 × 303 mm bleed canvas and 210 × 297 mm A4 trim. Do not add 58 mm or 80 mm support here.
- Preserve browser printing through `printDocumentWhenImagesReady` and PDF creation through `downloadElementPdf` unless a proven Booking Center bug requires an internal fix.
- Do not replace this template with the generic sales/POS design or another booking/receipt template.
- Do not change payment approval, reconciliation, accounting, schema, permissions, booking statuses, invoice numbering, or historical values.
- Do not expose UUIDs, internal IDs, private tokens, admin-only notes, or accounting metadata.

## Related but excluded

`BookingThermalPrintAction` in `src/components/booking-thermal-print.tsx` prints a compact booking label. It is not the protected Booking Center A4 invoice. Do not modify it under this skill unless the user separately requests thermal label work.

## Completion statement

Always report explicitly:

- Booking Center only: Yes/No
- Existing A4 design preserved: Yes/No
- Paper size still A4: Yes/No
- Other invoice modules modified: Yes/No
- Payment calculations changed: Yes/No
- Accounting logic changed: Yes/No
- Database schema changed: Yes/No
- Print Agent broken or replaced: Yes/No

