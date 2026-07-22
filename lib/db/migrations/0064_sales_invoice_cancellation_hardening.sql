-- Complete, idempotent sales-invoice cancellation history.
-- Additive only: invoices, payments, stock movements and journals remain intact.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS cancelled_original_paid_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS cancelled_original_remaining_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS reversal_references jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE receipt_voucher_allocations
  ADD COLUMN IF NOT EXISTS reversed_at timestamp,
  ADD COLUMN IF NOT EXISTS reversed_by integer REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_transaction_id integer REFERENCES financial_transactions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS receipt_voucher_allocations_active_source_idx
  ON receipt_voucher_allocations(source_type, source_id, posted_at)
  WHERE reversed_at IS NULL;

-- Historical receivable rows stay immutable but can be closed by cancellation.
DO $body$
BEGIN
  IF to_regclass('public.customer_receivable_ledger') IS NOT NULL THEN
    ALTER TABLE customer_receivable_ledger
      DROP CONSTRAINT IF EXISTS customer_receivable_ledger_status_chk;
    ALTER TABLE customer_receivable_ledger
      ADD CONSTRAINT customer_receivable_ledger_status_chk
      CHECK (status IN ('open', 'paid', 'review', 'cancelled'));
  END IF;
END
$body$;
