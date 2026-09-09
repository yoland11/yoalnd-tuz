# Thermal receipt formats

Sales uses `buildSalesInvoiceThermalHtml` in `lib/print-template/src/index.js` for browser and standalone Agent output. It already composes 80mm as a five-column table and 58mm as a compact two-row item. Preserve and test this separation.

Physical roll width is not guaranteed printable width. Current sales profiles use 64mm content on 80mm and 52mm on 58mm; driver margins, saved offsets and the actual device also matter. Do not prescribe those dimensions to every printer or module.

Use high-contrast content, tabular isolated numbers, wrapping for long Arabic names, content-based height and QR quiet zones. Never shrink A4 into thermal or 80mm into 58mm. Existing photography thermal and booking label designs may intentionally differ or omit financial values.

Test one/many items, long names, decimal quantities, huge values, missing images, actual browser output and the selected physical printer. A rendered preview alone does not prove a successful paper result.
