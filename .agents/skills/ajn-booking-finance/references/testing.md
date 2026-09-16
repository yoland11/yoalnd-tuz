# Testing

Prove the aggregate with unit tests over the pure summary/aggregation logic
(no DB), and verify the affected surfaces. A physical/visual result needs
corresponding evidence; compilation is not verification.

## Mandatory case

Customer "Test Customer", one unified booking:

- Service Kosha = 160,000 → shown as 160,000 (service level)
- Preparations / تجهيزات = 40,000 → shown as 40,000 (product level)
- Booking subtotal = 200,000
- Discount 0, additions 0, delivery 0 → booking total = 200,000
- Paid 50,000 → remaining = 150,000
- Customer statement for the whole booking = **200,000** debit (NOT 160,000)

## Matrix

- 1 service; 2 services; 3+ services (e.g. 100,000 + 50,000 + 25,000 = 175,000).
- Discount; additions; delivery (each per existing rules).
- Zero payment; partial; full; multiple payments.
- Large IQD values; Arabic customer names; long service/product names.
- Cancelled / voided / released service or product (excluded from the total).
- Duplicate-service / duplicate-line protection (no double count).
- Kosha booking AND service-order booking (both must aggregate products).

## Regression scope (must not break)

Booking Center, booking creation, service execution, booking invoices, payments,
customer statements/accounts, cashbox, accounting, reports, POS, photography,
graduation, purchases, sales. Only touch another module if the audit proves it
consumes the same booking-financial source.

## Booking Center A4

The A4 design is protected. If it showed the wrong total because it read one
service, correct the DATA SOURCE only; assert the layout is unchanged
(`test:wedding-invoice-layout` stays 9/9) and that the totals now reflect the
aggregate.

## Repo commands (use the real ones — do not invent)

- `npm run typecheck`
- `npm run verify:critical` (includes the production build + DB/financial contracts)
- `npm run test:wedding-invoice-layout` (Booking Center A4 protection)
- Add a focused pure test for the new `getBookingFinancialSummary` aggregation and
  wire it into the existing script suite if one is added; run it before shipping.
