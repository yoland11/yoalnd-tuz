-- Product details analytics filter sales, purchase and online-order lines by
-- product. Index-only and additive: no table, column or row changes; the
-- feature works without it, these only keep per-product queries fast.
CREATE INDEX IF NOT EXISTS "sales_invoice_items_product_idx"
  ON "sales_invoice_items" ("product_id") WHERE "product_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "purchase_invoice_items_product_idx"
  ON "purchase_invoice_items" ("product_id") WHERE "product_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "order_items_product_idx"
  ON "order_items" ("product_id") WHERE "product_id" IS NOT NULL;
