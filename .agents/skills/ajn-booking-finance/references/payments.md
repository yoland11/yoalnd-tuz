# Payments, deposits, remaining

## Authoritative paid

Paid is DERIVED, never stored as an independent screen value. It comes from:

- **Executed direct payments** — `financial_transactions` with
  `approval_status = 'executed'`, `direction = 'revenue'`, tagged with the
  booking's `customer_id` and `source_type`/`source_id`.
- **Posted receipt-voucher allocations** — `receipt_voucher_allocations` with
  `posted_at` set, whose `receipt_vouchers.approval_status` is `executed`; credit
  = `amount − reversed_amount`.

These two sets are **disjoint by construction** (a receipt's cash movement is the
`receipt_voucher` transaction; its application is the allocation), so they are
summed, never double-counted. `reconcilePaymentState`
(`src/server/payment-state.ts`) is the single reconciliation path; treat its
paid/remaining/status as truth.

## Approval-first

Recording a payment is approval-first: تسجيل دفعة → pending → موافقات → executed →
cash box once. A pending/unapproved request is NOT money and must not change the
booking's paid/remaining or the cashbox. The central engine lives in
`src/server/master-cash-box.ts` (`createSourceFinancialRequest`,
`approveAndExecuteFinancialTransaction`, unique `idempotencyKey`, reversal
linkage). Do not create parallel payment writes.

## Payment vs obligation vs cash

- **Booking obligation** = booking total (e.g. 200,000). Level 2.
- **Payment against the booking** = actual amount received (e.g. 50,000). Level 3.
- **Cashbox movement** = the actual payment (50,000), NEVER the obligation.

`remaining = bookingTotal − paid = 200,000 − 50,000 = 150,000`. If the booking
total is under-reported (160,000), remaining is silently wrong (110,000) even
though cash is correct — the defect is in the OBLIGATION total, not in payments
or cash.

## Do not

- Do not silently move historical payments between services / parent booking.
- Do not rewrite accounting transactions automatically.
- Do not change what a payment means (whole-booking vs single-service) without
  proving the existing model, and never as a side effect of a total fix.
- If a payment is genuinely scoped to one service and the model supports it,
  preserve that distinction; otherwise a booking payment applies to the booking
  aggregate.
