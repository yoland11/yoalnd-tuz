# A4, A5 and PDF

`src/views/admin/print-helpers.ts` has independent sheet builders for sales, purchases, statements and reports. `src/views/admin/invoice.tsx` has a specialized 216×303mm wedding invoice with bleed. Preserve these intentional designs.

A4 and A5 need independent margins, columns, typography and pagination; do not zoom or screenshot-scale one into the other. For long tables repeat headers and keep ordinary rows and totals together where possible. Give content taller than a page an explicit split strategy.

Sales A4 uses `salesInvoiceSheetCss()` and `.sales-sheet`; it is separate from the shared 80mm/58mm thermal document. The same authoritative customer, items, totals, paid and remaining values may be arranged differently without being recalculated.

PDF uses the project's existing HTML/PDF helpers and dependencies. Verify page dimensions, Arabic shaping, selectable/readable text where relevant, image/font readiness, totals, multipage breaks and error handling. Do not replace a working generator merely for visual uniformity.
