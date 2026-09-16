# Booking financial model (real repository)

Confirm each field in code before relying on it. Locations below are where the
current architecture stores each money level.

## A booking is one row

- **Service order** — `service_orders` ([lib/db/src/schema/services.ts](../../../../lib/db/src/schema/services.ts)),
  loaded with `source = "service"`. ONE `service_id` per row. Money columns:
  `total_amount`, `deposit_amount`, `remaining_amount`, `payment_status`. Booking
  operations (products meta, base, stages) live in `custom_fields.bookingOperations`.
- **Kosha booking** — `kosha_bookings`, loaded with `source = "kosha"`. Has an
  extra `products_total` column and line items in `kosha_booking_items`. Booking
  operations live in `booking_details.bookingOperations`.

The workspace loads either via `loadBookingOperationsReference(source, id)`
([src/server/api.ts](../../../../src/server/api.ts)).

## Where each money level lives

| Level | Service order | Kosha booking |
|---|---|---|
| Service base | `operations.baseBookingAmount` (fallback `total_amount − productCharges`) | `pricing.totalAmount` / `total_amount − products_total` |
| Products (تجهيزات) | `stock_reservations` rows (`source_type`,`source_id`), priced via `operations.productMeta.unitPrice/discount`; `productCharges = Σ line totals` of non-`released` lines | `kosha_booking_items.line_total` → `products_total` |
| Booking total | `total_amount` (AMBIGUOUS — see booking-aggregation) | `total_amount` = base + `products_total` (kept by the recompute) |
| Deposit / paid | `deposit_amount` / `paid_amount`; authoritative paid from payments engine | same |
| Remaining | `remaining_amount` (reconciled) | same |
| Payment status | `payment_status` | same |

## Products / تجهيزات

`bookingOperationProducts(reference)` ([api.ts](../../../../src/server/api.ts))
reads `stock_reservations` joined to `products`/`product_variants`, applies
per-line `unitPrice`/`discount` from `operations.productMeta`, and returns each
line `total = max(0, unitPrice*qty − discount)`. The booking's product charge is
the sum of non-`released` line totals. This is the تجهيزات amount (40,000 in the
worked example).

## Payments and cash

- `financial_transactions` — carries `customer_id`, `source_type`/`source_id`,
  `direction` (revenue/expense), `approval_status`; only `executed` rows are
  money. Cash movement = the transaction `amount` (actual paid), never the
  booking total.
- `receipt_voucher_allocations` (+ `receipt_vouchers`) — a posted allocation of a
  receipt voucher to a booking; credit = `amount − reversed_amount` when
  `posted_at` is set and the voucher is executed.
- `reconcilePaymentState` (`src/server/payment-state.ts`) derives paid/remaining/
  status per document from executed transactions + posted allocations. It is the
  authoritative paid/remaining source.

## Customer identity

Bookings link to a customer by the canonical `customer_id` (service_orders and
kosha_bookings both carry it; older rows backfilled from normalized phone). The
customer account/statement joins by `customer_id`, with an exact-phone fallback
ONLY for rows still carrying no `customer_id` (never a row linked to a different
customer). See [customer-statements](customer-statements.md).
