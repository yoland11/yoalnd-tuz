# Accounting rules

Do not change accounting behaviour blindly. Identify how AJN currently models
each concept before touching anything, and preserve its meaning.

## Concepts (confirm in code)

- **Receivable** — the customer owes the booking obligation (booking total). A
  booking debit in the statement is a receivable.
- **Payment / credit** — actual money received reduces the receivable. Recorded
  via the approval-first engine (`master-cash-box.ts`) as executed
  `financial_transactions` (+ posted allocations).
- **Revenue** — recognized per the existing accounting rules; not invented here.
- **Customer balance** — Σ receivables − Σ payments, derived (never stored as an
  independent number). One derivation only.

## Obligation vs cash — the line that must not blur

- A booking total (200,000) is an OBLIGATION. It belongs in receivables/booking
  totals, never in the cashbox.
- A cash movement equals the ACTUAL payment (50,000). It belongs in the cashbox
  and in the executed-transactions ledger.
- Fixing the booking OBLIGATION total (so statements show 200,000) must NOT create
  or alter any cash movement, ledger entry, or payment. It only corrects the
  displayed/derived receivable.

## Guardrails

- Do not modify debit/credit rules, ledger posting, or cashbox amounts as part of
  a booking-total fix.
- Do not double count: a child product/service and a parent booking total that
  represent the same money are ONE receivable.
- Any genuine accounting change is out of scope for this skill and needs its own
  approval (use `ajn-finance` for cash-box / approval / ledger changes).
