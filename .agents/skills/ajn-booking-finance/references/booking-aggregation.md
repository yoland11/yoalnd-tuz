# Booking aggregation — the one rule, and the proven defect

## Canonical formula

```
bookingSubtotal = serviceBase + Σ(non-released product line totals)   // + extra services if the booking has them
bookingFinalTotal = bookingSubtotal + additions + delivery − discount // existing business rules only
bookingRemaining  = bookingFinalTotal − authoritativePaid             // paid from the payments engine
```

Compute this once (a shared `getBookingFinancialSummary(source, id)`), and have
the statement, account summary, receivables, finance tab, reports, and the
protected A4 invoice all read it. Never recompute per screen.

## The proven root cause (why 160,000 vs 200,000 vs 240,000)

`service_orders.total_amount` has a **self-contradictory meaning**:

- **Products PUT** (`api.ts`, resource `products`, method `PUT`) writes
  `total_amount = baseBookingAmount + productCharges` → products **folded in**.
- **Finance GET** (`api.ts`, `resource === "finance"`) sets `total = total_amount`
  then `finalAmount = total + productCharges + damageCharges` → products **added
  again**.

Therefore:

- If products were NOT saved through that exact PUT (created via the main form,
  base edited afterward, or products changed elsewhere), `total_amount` stays at
  the **base (160,000)**. The finance tab still shows `base + live products =
  200,000`, but every reader of `total_amount` — customer statement
  (`getCustomerAccountDocuments` reads `service_orders.total_amount` as the debit),
  account summary, customer-detail summary (`productTotal + serviceTotal +
  koshaTotal`), receivables — shows **160,000** and drops the تجهيزات. **This is
  the reported bug.**
- If products WERE saved via the PUT (`total_amount = 200,000`), the finance tab
  **double-counts**: `finalAmount = 200,000 + 40,000 = 240,000`.

Kosha bookings avoid this because they persist `products_total` separately and a
recompute keeps `total_amount = base + products_total` consistently. Service
orders have neither.

## No double counting

Determine what each field already contains before adding:

- Do NOT add `productCharges` to a `total_amount` that already includes products.
- Do NOT sum a parent booking total AND its child product/service amounts if they
  represent the same money.
- `Kosha 160,000 + Preparations 40,000 = 200,000`. Never 240,000, never 360,000.

## Fix stance (Phase 2 onward)

Prefer, in order:

1. A shared read-only adapter that derives `finalTotal = base + products (+
   additions/delivery − discount)` from `operations.baseBookingAmount` +
   `stock_reservations`, and route ALL whole-booking readers through it.
2. Make the finance endpoint stop adding products to a total that already
   includes them (pick ONE meaning for `total_amount` and make writers + readers
   agree).

**No migration by default.** The base is already persisted
(`operations.baseBookingAmount`) and products are derivable, so the authoritative
total can be produced with no schema change. A `products_total` column on
`service_orders` (mirroring kosha) is optional for parity only; if proposed, STOP
and get approval with schema/historical/rollback details.
