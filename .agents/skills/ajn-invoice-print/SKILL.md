---
name: ajn-invoice-print
description: Use when changing AJN invoice, receipt, voucher, A4/A5, PDF, 58mm/80mm thermal, browser-print or Print Agent presentation.
---

# AJN invoice print

One shared print architecture can contain multiple intentional designs. Existing working AJN layouts are authoritative; preserve their paper size, typography, artwork, fields and routing unless broken or explicitly selected for redesign.

## Route by physical format

- A4/A5/PDF: read [sheet](references/sheet.md) and use the document's existing sheet builder.
- 58mm/80mm: read [thermal](references/thermal.md); each width has its own composition.
- Remote Windows printing: also use `ajn-invoice-print-router` when installed.
- Source data and money: also use `ajn-invoice-engine` and `ajn-invoice-payments` when installed.

Current sales browser thermal and standalone Print Agent share `lib/print-template/src/index.js`. A4 sales uses `salesInvoiceSheetCss()` in `src/views/admin/print-helpers.ts`. Other specialized documents use their established builders; `print-helpers.ts` is important shared infrastructure, not the only valid renderer.

Do not scale A4 into thermal, scale 80mm into 58mm, or force photography, kosha, purchase, wedding or report documents into the sales layout. A4 and thermal may show the same authoritative values with different hierarchy and columns.

Presentation must not recalculate totals, paid/remaining or stock. Escape user text, keep mixed-direction numbers isolated, wait for relevant images/fonts, and preserve failed-state visibility. Follow the project's real verification commands and focused print tests. A physical printer result requires physical evidence; compilation is not visual verification.
