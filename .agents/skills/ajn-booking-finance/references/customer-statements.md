# Customer statement / account statement

Highest-priority surface. When representing a WHOLE booking, it must show the
aggregate booking total, not one service.

## How it is derived today

- `getCustomerAccountDocuments(customer)` (`src/server/customer-account.ts`) reads
  one debit document per receivable: `sales_invoices`, `orders`, `service_orders`,
  `kosha_bookings`, joined by `customer_id` (+ exact-phone fallback ONLY for rows
  with no `customer_id`). For a service order it reads **`service_orders.total_amount`
  as the booking debit** — this is exactly where the second service (تجهيزات) is
  lost when `total_amount` is base-only.
- `getCustomerStatement` builds a chronological ledger: each document is a debit
  at its date; each executed payment a credit — direct `financial_transactions`
  (executed) + posted `receipt_voucher_allocations`. The two credit sets are
  disjoint, so they are summed, never double-counted.
- `summarizeCustomerAccount` / `buildCustomerStatement`
  (`src/server/customer-account-summary.ts`) are pure folders over those rows.

There are also OTHER balance computations (the customer-detail summary in
`api.ts` that sums `productTotal + serviceTotal + invoiceTotal + koshaTotal`).
All of them read the same ambiguous `total_amount`; unify them onto the
authoritative booking total.

## Correct behaviour

For a customer with Booking A = Kosha 160,000 + Preparations 40,000, the whole
booking's statement line must be **200,000** debit (with paid/remaining derived),
NOT 160,000 — unless the user is explicitly viewing the individual Kosha service
transaction. The statement must never lose a service/product that belongs to the
same unified booking.

## Fix rule

The per-document total for a service-order booking must be the **authoritative
booking total** (base + products …) from the shared summary — not the raw
`total_amount`. Change the debit SOURCE; keep the statement structure, the
disjoint credit logic, and the join-by-`customer_id` identity rule intact. Never
turn a failed read into an empty/zero statement.
