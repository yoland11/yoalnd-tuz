-- Direct, item-level traceability for sales invoice stock deductions and their
-- cancellation reversals. All changes are additive; existing movements remain.
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS sales_invoice_id integer,
  ADD COLUMN IF NOT EXISTS sales_invoice_item_id integer,
  ADD COLUMN IF NOT EXISTS invoice_number varchar(40),
  ADD COLUMN IF NOT EXISTS warehouse_id integer,
  ADD COLUMN IF NOT EXISTS movement_type varchar(60),
  ADD COLUMN IF NOT EXISTS reversed_movement_id integer,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by integer,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(180),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE stock_movements movement
SET sales_invoice_id = movement.related_id,
    invoice_number = invoice.invoice_no,
    movement_type = CASE
      WHEN movement.quantity_change::numeric < 0 THEN 'sale'
      WHEN movement.reason = 'sales_invoice_cancellation_return' THEN 'sales_invoice_cancellation'
      ELSE movement.movement_type
    END
FROM sales_invoices invoice
WHERE movement.related_type = 'sales_invoice'
  AND movement.related_id = invoice.id
  AND (movement.sales_invoice_id IS NULL OR movement.invoice_number IS NULL OR movement.movement_type IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_sales_invoice_fk') THEN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sales_invoice_fk
      FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_sales_invoice_item_fk') THEN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sales_invoice_item_fk
      FOREIGN KEY (sales_invoice_item_id) REFERENCES sales_invoice_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_reversed_movement_fk') THEN
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reversed_movement_fk
      FOREIGN KEY (reversed_movement_id) REFERENCES stock_movements(id) ON DELETE RESTRICT;
  END IF;
END $$;

DROP INDEX IF EXISTS stock_movements_sales_invoice_cancel_once_idx;

CREATE INDEX IF NOT EXISTS stock_movements_sales_invoice_direct_idx
  ON stock_movements (sales_invoice_id, sales_invoice_item_id, movement_type, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_movements_invoice_number_idx
  ON stock_movements (invoice_number, product_id, created_at DESC)
  WHERE invoice_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_idempotency_idx
  ON stock_movements (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_reversal_once_idx
  ON stock_movements (reversed_movement_id)
  WHERE reversed_movement_id IS NOT NULL
    AND movement_type = 'sales_invoice_cancellation';

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_invoice_item_cancel_once_idx
  ON stock_movements (sales_invoice_id, sales_invoice_item_id)
  WHERE sales_invoice_id IS NOT NULL
    AND sales_invoice_item_id IS NOT NULL
    AND movement_type = 'sales_invoice_cancellation';
