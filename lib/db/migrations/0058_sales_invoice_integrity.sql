-- Sales invoice hardening: query paths used by the sale list, reports and
-- stock reconciliation.  Existing foreign keys already protect parent/child
-- integrity; these indexes avoid table scans as invoice history grows.

CREATE INDEX IF NOT EXISTS sales_invoices_status_date_idx
  ON sales_invoices (status, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_invoices_customer_status_idx
  ON sales_invoices (customer_id, status, date DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_invoice_items_product_invoice_idx
  ON sales_invoice_items (product_id, invoice_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_movements_sales_invoice_idx
  ON stock_movements (related_id, product_id, created_at DESC)
  WHERE related_type = 'sales_invoice';
