# Current architecture and retrieval map

Inspected 2026-09-09. Re-read relevant code before edits; this is not proof that every production deployment matches this checkout.

| Source | Entry point | Presentation / business owner |
|---|---|---|
| Sales and POS | `src/views/admin/sales.tsx`, `src/views/admin/pos.tsx` | `src/views/admin/print-helpers.ts`; shared sales HTML in `lib/print-template/src/index.js` |
| Purchase statements | `src/views/admin/purchases.tsx` | purchaseInvoicePrintInput → createPurchaseInvoicePrintElement / openPurchaseInvoicePrintWindow; not the remote sales queue |
| Customer / booking wedding invoice | `src/views/admin/invoice.tsx` | luxuryWeddingInvoiceCss; special artwork and A4 + bleed |
| Kosha | `src/views/admin/koshas.tsx` | separate booking document; `src/components/booking-thermal-print.tsx` is a compact label, not a financial receipt |
| Photography | `src/views/staff/photography/index.tsx` | printReceipt already uses thermalReceiptCss("80mm") and image readiness; do not migrate it on a stale assumption |
| Graduation | `src/views/admin/print-helpers.ts` | openGraduationLabelPrintWindow, openGraduationProductionSheet; find live callers before modification |
| Reports, accounting, finance | `src/views/admin/accounting.tsx`, `src/views/admin/finance.tsx` | mixed local and shared receipts/report builders; intentional layouts need individual inspection |
| Shop/service/rental/research orders | `src/server/api.ts` | distinct handlers and schema mappings; inspect each route, not sales assumptions |
| Inventory / depreciation / custody | `src/views/admin/print-helpers.ts` | assetSalesReportCss, depreciationReportCss, custodyStatementCss; labels are not invoices |
| Payment truth | `src/server/payment-state.ts` | reconcilePaymentState |
| Approvals / cash | `src/server/master-cash-box.ts` | existing executed financial transaction flow |
| Remote printing | `src/server/remote-printing.ts` | sales-only queue, configured printers and credentials |
| Desktop host | `desktop/src/main.ts` | separate Electron wrapper; do not confuse with standalone Print Agent |

Shared helpers are not the only valid rendering location. Existing browser sales and Agent reuse @workspace/print-template. Other specialized formats remain in print-helpers or module views.

## Future recommendation, not an installed abstraction

Module → authoritative business data → module adapter → normalized document → router → selected specialized template/profile → browser / Agent / PDF.

An optional future PrintProfile could distinguish thermal-58, thermal-80, a4, a5, label, custom. Neither that type nor a universal normalized document is introduced by this suite. Inspect all callers before any shared contract change.
