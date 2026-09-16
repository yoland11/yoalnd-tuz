---
name: ajn-booking-finance
description: Use when changing or investigating AJN booking money — service amount vs whole-booking total, multi-service / unified bookings, تجهيزات/products on a booking, base amount, discounts, additions, delivery, deposit/paid, remaining, payment status, customer statements/accounts, receivables/accounting, cashbox, booking invoices, or the booking finance tab. It is the source of truth for how a booking's money is layered and aggregated, and it exists to stop two specific defects: showing ONE service's amount as the whole booking, and DOUBLE-COUNTING booking products.
---

# AJN booking finance

A booking is ONE financial context. It may contain several services and several
products (تجهيزات), but it has exactly one authoritative aggregate total. Every
surface that represents the WHOLE booking must show that aggregate; a surface
that represents a single service shows that service's amount. Never mix the two,
and never derive the same money twice.

This skill is authoritative for meaning and rules. It is not authorization to
change schema, accounting, payments, or historical data. Confirm every field in
the current code before acting — the reference maps below are grounded in the
real repository but are starting points, not frozen contracts.

## The four money levels (do not mix)

1. **Service amount** — one service's value (e.g. Kosha service = 160,000). One
   `service_orders` row carries ONE `service_id`; the base service amount is the
   booking's `baseBookingAmount`.
2. **Booking total (aggregate)** — `base + products + additions + delivery −
   discount` for the whole unified booking (e.g. 160,000 + 40,000 = 200,000).
   This is the receivable/obligation.
3. **Payment level** — actual money received against the booking
   (deposit/collections). Authoritative paid comes from executed
   `financial_transactions` + posted `receipt_voucher_allocations`, reconciled by
   `reconcilePaymentState`. Never inferred from a screen.
4. **Accounting / cashbox level** — a cash movement equals the ACTUAL payment
   (pay 50,000 → cashbox 50,000), NEVER the booking obligation (200,000). Debit /
   credit / receivable / revenue meaning is owned by the accounting engine.

`remaining = bookingTotal − authoritativePaid` (level 2 − level 3). Do not
compute remaining from a per-screen total.

## The one authoritative rule

There must be ONE booking-financial summary, computed in the domain layer and
consumed by every UI, statement, invoice, and report:

```
getBookingFinancialSummary(source, id) -> {
  source, id,
  services:   [{ label, amount }],   // level 1, shown individually
  base,                              // service base (operations.baseBookingAmount)
  products,                          // sum of non-released stock_reservations lines
  additions, delivery, discount,     // existing business rules only
  subtotal,                          // base + products (+ services)
  finalTotal,                        // authoritative booking total (level 2)
  paid,                              // authoritative (level 3)
  remaining,                         // finalTotal - paid
  paymentStatus
}
```

Adapt names to the real architecture; the invariant is: **one calculation path**.
Frontend components must NOT independently reconstruct the total (sum services in
A, read `total_amount` in B, add products again in C). Domain → summary → UI.

## No double counting (critical)

`Kosha 160,000 + Preparations 40,000` must aggregate to **200,000** — not
`160,000 + 200,000`, not `200,000 + 40,000`, not `240,000`. Before summing,
determine exactly what each persisted field already contains. In this repo
`service_orders.total_amount` is ambiguous (sometimes base-only, sometimes
base+products); the finance endpoint adds products a second time. See
[booking-aggregation](references/booking-aggregation.md) — this ambiguity is the
proven root cause of the "statement shows 160,000, another screen shows 200,000"
bug, and of a 240,000 double-count.

## Reference files

- [financial-model](references/financial-model.md) — real tables/fields and where each money level lives.
- [booking-aggregation](references/booking-aggregation.md) — the aggregation formula, kosha vs service_order, the exact double-count/under-count sites, no-migration-first stance.
- [payments](references/payments.md) — how paid/deposit/remaining are recorded and reconciled; approval-first; cashbox = actual cash.
- [customer-statements](references/customer-statements.md) — statement/account derivation, the read-`total_amount` defect, disjoint deposit vs allocation credits.
- [accounting-rules](references/accounting-rules.md) — debit/credit/receivable/revenue; obligation vs cash; do-not-change.
- [validation](references/validation.md) — consistency checks; report inconsistencies, never silently repair.
- [testing](references/testing.md) — the mandatory Kosha+تجهيزات case, the full matrix, regression scope, and the real repo commands.

## Protections (always in force)

- **Booking Center A4** (`invoice.tsx` / `luxuryWeddingInvoiceCss`) is visually
  PROTECTED. You may correct its DATA SOURCE so the existing design shows the
  correct aggregate; never change its layout/typography/colors/margins/tables.
- **Cashbox** records actual money movement only. Never post the booking total.
- **Accounting** meaning is preserved. Do not rewrite transactions automatically.
- **No migration by default.** Prefer existing relationships + correct
  aggregation + a shared adapter. If a schema change is truly unavoidable, STOP
  and explain the problem, change, tables, historical impact, and rollback.
- **Historical data** is not assumed correct and is never auto-rewritten. Provide
  a read-only diagnostic; migrations of historical money need explicit approval.
- Presentation never recalculates authoritative paid/remaining/stock, and never
  turns a failed read into an empty or zero-value booking.
