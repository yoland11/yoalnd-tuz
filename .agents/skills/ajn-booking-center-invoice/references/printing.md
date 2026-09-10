# Printing and PDF flow

## Current A4 flow

`src/views/admin/booking-center.tsx` links to:

```text
/admin/invoice/{id}?type=booking
```

The A4 route in `src/views/admin/invoice.tsx`:

1. loads `/admin/invoices/{id}?type=booking`;
2. normalizes the response with `invoiceModel`;
3. renders `WeddingInvoice` into `.wedding-invoice-bleed`;
4. injects `luxuryWeddingInvoiceCss()`;
5. prints with `printDocumentWhenImagesReady`;
6. downloads PDF with `downloadElementPdf` using `[216, 303]`, zero margin, scale `3.125`, and CSS/legacy page-break handling.

`printDocumentWhenImagesReady` waits for logo, QR, and decorative images, then calls `window.print()`. Preserve this behavior. The route does not currently replace browser printing with a new dependency.

## A4 dimensions

- Outer bleed canvas: 216 × 303 mm.
- Inner trimmed page: 210 × 297 mm A4.
- `@page`: 216 × 303 mm to include the 3 mm bleed.

Do not change these dimensions, margins, crop marks, or print media rules under ordinary Booking Center maintenance.

## Print Agent

The protected A4 route uses browser printing/PDF generation. Other AJN printing helpers can detect `window.ajnDesktop.print`, but that is not a reason to replace this route. If desktop Print Agent integration is introduced later, it must preserve the same A4 HTML/CSS output and must not remove browser fallback.

## Thermal exclusion

`BookingThermalPrintAction` is a separate compact booking-label flow. It supports thermal formats but is not the A4 invoice. Never migrate the protected A4 invoice to 58 mm or 80 mm as part of this skill.

