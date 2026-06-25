ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "stock_applied" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "stock_restored_at" timestamp;

ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "stock_applied" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "stock_restored_at" timestamp;

CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" serial PRIMARY KEY,
  "product_id" integer REFERENCES "products" ("id") ON DELETE SET NULL,
  "stock_source_product_id" integer REFERENCES "products" ("id") ON DELETE SET NULL,
  "quantity_change" numeric(12,3) NOT NULL,
  "reason" varchar(80) NOT NULL,
  "related_type" varchar(40),
  "related_id" integer,
  "created_by" integer,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "stock_movements_product_id_idx" ON "stock_movements" ("product_id");
CREATE INDEX IF NOT EXISTS "stock_movements_stock_source_product_id_idx" ON "stock_movements" ("stock_source_product_id");
CREATE INDEX IF NOT EXISTS "stock_movements_related_idx" ON "stock_movements" ("related_type", "related_id");
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx" ON "stock_movements" ("created_at");
CREATE INDEX IF NOT EXISTS "orders_stock_applied_status_idx" ON "orders" ("stock_applied", "status");
CREATE INDEX IF NOT EXISTS "sales_invoices_stock_applied_status_idx" ON "sales_invoices" ("stock_applied", "status");
