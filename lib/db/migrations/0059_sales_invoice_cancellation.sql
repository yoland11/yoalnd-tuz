-- Controlled sales-invoice cancellation. Original invoices and movements stay
-- immutable; these fields only record the completed reversal.
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp,
  ADD COLUMN IF NOT EXISTS cancelled_by integer REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS cancelled_by_name text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS reversal_completed_at timestamp,
  ADD COLUMN IF NOT EXISTS inventory_reversed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finance_reversed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sales_invoices_cancellation_idx
  ON sales_invoices (status, cancelled_at DESC)
  WHERE status = 'cancelled';

-- One cancellation-return movement per source product and invoice.  The
-- original deduction is never modified or deleted.
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_sales_invoice_cancel_once_idx
  ON stock_movements (related_id, product_id, reason)
  WHERE related_type = 'sales_invoice'
    AND reason = 'sales_invoice_cancellation_return';
