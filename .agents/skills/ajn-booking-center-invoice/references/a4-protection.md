# Protected A4 visual contract

The current Booking Center A4 invoice is an intentional production design. Unless the user explicitly requests a Booking Center A4 redesign, preserve visual equivalence.

## Protected anchors

- `WeddingInvoice` component and its information hierarchy.
- `.wedding-invoice-bleed`, `.wedding-invoice`, and `.wi-*` layout contract.
- `luxuryWeddingInvoiceCss()` and its 216 × 303 mm bleed canvas.
- AJN logo, rose-corner artwork, crop marks, crown, QR, barcode, signatures, stamp, and footer.
- Customer and booking information placement.
- Service table columns and sizing.
- Six-cell horizontal totals summary and highlighted grand-total panel.
- Current fonts, colors, borders, spacing, rounding, and print media rules.

## Allowed fixes

- Correct missing or wrongly mapped Booking Center values.
- Preserve optional legacy fields without runtime crashes.
- Fix print-only clipping, page breaks, RTL ordering, overflow, or accidental admin chrome in print.
- Remove duplicated internal formatting only when output equivalence is verified.
- Improve security and Booking Center-specific validation.

## Forbidden changes

- Re-skinning, modernizing, or visually simplifying the A4 document.
- Copying POS, sales, photography, Kosha, graduation, purchase, or finance templates.
- Adding or substituting 58 mm/80 mm layouts.
- Changing the protected fields, artwork, type scale, positions, colors, or paper size.
- Using a universal renderer that changes the current output.

Any approved internal refactor needs before/after rendered A4 evidence at the same viewport and print settings. Compilation alone does not prove visual equivalence.

