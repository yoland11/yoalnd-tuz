BEGIN;

ALTER TABLE public.products
  ALTER COLUMN stock TYPE numeric(14,3)
  USING stock::numeric;

ALTER TABLE public.products
  ALTER COLUMN min_stock TYPE numeric(14,3)
  USING min_stock::numeric;

CREATE INDEX IF NOT EXISTS purchase_invoice_items_invoice_id_idx
  ON public.purchase_invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_created_idx
  ON public.purchase_invoices (supplier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_movements_purchase_related_idx
  ON public.stock_movements (related_type, related_id, created_at DESC)
  WHERE related_type IN ('purchase', 'purchase_invoice');

COMMIT;
