# Invoice data, adapters and money

Read the module's response type, query, schema, mutation and formatter together. Record source table, source ID, document number, customer/supplier snapshot, issue date versus event date, item array, currency and payment summary before changing an adapter.

## Current backend mappings

`src/server/payment-state.ts` supports sales_invoice, purchase_invoice, kosha_booking, order, service_order, graduation_order, photography_order, rental_order, research_order. Sales/purchase use total; other sources generally total_amount, except orders total. Orders and service orders use deposit_amount rather than paid_amount. service_orders has no updated_at column in that reconciliation map. Do not homogenize column names.

Purchase statements have supplier semantics; sales have customer semantics. A booking thermal label intentionally omits finances. Missing required historic purchase lines must block unsafe empty editing, not be guessed from stock.

Adapters should map existing facts, omit absent optional rows, escape user text, retain decimal quantities, and carry authoritative line totals and approved paid/remaining/status unchanged. Keep API errors distinguishable from an actually empty list.

## Monetary semantics

Current shared sales renderer `lib/print-template/src/index.js` uses formatLatinMoney with د.ع, Latin digits and at most two display decimals. toLatinDigits handles Arabic/Persian digits and decimal/group separators. Its numericValue converts malformed input to zero: this is legacy presentation tolerance, NOT valid business validation or a pattern to copy into a write path.

Display rounding does not change stored values. Preserve backend numeric precision; do not multiply IQD by 100 automatically or assume quantities are integers. Long values need wrapping/column space, not truncation.

USD: no universal multi-currency invoice adapter was established in this inspection. Verify the source's explicit currency, precision and exchange-rate snapshot before displaying USD. Do not label USD as IQD, infer currency from magnitude, mix totals or apply today's rate to a historic invoice. Existing IQD-only formatter is not a currency converter.

Discount type (line percentage versus absolute amount), tax base, packaging and delivery are source-specific. Sales Print Agent distinguishes offerDeliveryFee and deliveryFee. Preserve both meanings, ensure fees are not added twice. Do not invent a packaging charge absent from the source. Previous approved payments, new pending collection and current remaining are different facts; use the canonical payment summary.
