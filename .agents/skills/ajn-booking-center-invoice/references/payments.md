# Financial and payment data

## Source of truth

The server adapter in `src/server/api.ts` reads Booking Center financial values from `service_orders` and compatible legacy `customFields` fallbacks. The A4 component receives:

- `price`: total
- `deposit`: paid/deposit amount
- `balance`: remaining amount
- `paymentStatus`: persisted Booking Center payment state
- `financiallyReversed`: financial reversal marker

Treat the server response and the canonical AJN payment-state reconciliation path as authoritative. Do not derive approval or payment status from colors, labels, `paid > 0`, or the printed remaining balance.

## Protected behavior

- Do not change payment approval or rejection.
- Do not create or reverse a Cash Box transaction from print code.
- Do not recalculate historical totals, discounts, paid values, or remaining balances during rendering.
- Do not mutate booking financial data while opening, downloading, or printing an invoice.
- Do not silently replace missing money with an apparently valid invoice. Surface the real API error when loading fails.

If a data defect is reported, trace the canonical write/reconciliation path before changing display code. Changes to payment, booking, invoice, Cash Box, or accounting logic require `pnpm run test:payment-state` in addition to the mandatory release checks.

