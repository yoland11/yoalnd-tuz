# Validation rules

Detect and REPORT inconsistencies. Never silently repair financial data.

## Invariants to check

For a booking summary:

- `subtotal = base + Σ(non-released product line totals)` (+ extra services).
- `finalTotal = subtotal + additions + delivery − discount` per existing rules.
- `finalTotal ≥ 0`; each service/product line ≥ 0.
- `remaining = finalTotal − authoritativePaid`, and `0 ≤ remaining ≤ finalTotal`
  (clamp only for display; a raw negative/over remaining is a data signal).
- `paid` reconciles with the payments engine (executed transactions + posted
  allocations), not with `deposit_amount` alone.
- No double count: `total_amount` is not summed with `productCharges` if it
  already includes them.

## Anomalies to surface (not auto-fix)

- Missing service/product that belongs to the unified booking.
- Duplicate service or duplicate financial amount for the same money.
- Parent/child mismatch (e.g. `total_amount` ≠ base+products for a booking that
  went through only one of the two code paths).
- Payment mismatch (persisted `remaining_amount` ≠ reconciled remaining).
- Unexpected negative or over-paid amounts.

## Behaviour

- Diagnose explicitly; log/report the booking id, the two disagreeing values, and
  which one the architecture treats as authoritative.
- Never turn a failed/ambiguous read into an empty or zero-value booking.
- Never rewrite historical rows to "make it balance" — a diagnostic report is the
  deliverable; a migration needs explicit approval (see booking-aggregation).
