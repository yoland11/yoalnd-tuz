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

## Trust model for historical data (validated in production, 2026-09)

A read-only scan of production (`scripts/diagnose-booking-finance.ts`) proved the
only trustworthy service base is `bookingOperations.baseBookingAmount` (opsBase),
written by the products flow as `total_amount − productCharges`. Do NOT decide a
correction from `pricing.totalAmount` / `pricing.koshaPrice`: those are display
snapshots that go STALE after re-pricing (e.g. kosha #25 pricing.totalAmount=715k
while the true whole = opsBase 390k + تجهيزات 225k − discount 5k = 610k, which is
what `total_amount` already holds — a CORRECT booking, not an error).

Classification, per booking with تجهيزات/discount:

- `whole = opsBase + تجهيزات − discount`.
- `stored == whole` → CORRECT (or DISCOUNTED when discount > 0).
- `opsBase > 0` and `stored == opsBase − discount` and تجهيزات present → UNDERCOUNTED
  (the reported bug); auto-fixable ONLY when discount == 0.
- `stored > whole` → DOUBLE-COUNTED → manual.
- `opsBase` missing/0 → HISTORICAL/AMBIGUOUS → manual (never auto-classify as error).
- otherwise → MANUAL (usually a manual re-price below base).

Of 91 live bookings, 13 carried تجهيزات/discount: 6 correct, 1 discounted-valid,
1 undercounted (auto-fixable), 1 double-counted, 1 manual re-price, 3 ambiguous
(opsBase=0). A blanket "recompute total = base+products" would have CORRUPTED the
correct/discounted/re-priced ones — which is exactly why correction is per-case
and gated. `scripts/normalize-booking-finance.ts` applies ONLY the clean
auto-fixable signature, is dry-run by default, backs up every row first, changes
only `total_amount`/`remaining_amount`/`payment_status` (never cashbox, receipts,
ledgers or products), and is reversible via `--revert`.
