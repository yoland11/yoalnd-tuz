ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "shared_stock_product_id" integer;

DO $$
BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_shared_stock_product_id_fkey"
    FOREIGN KEY ("shared_stock_product_id")
    REFERENCES "products" ("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "products_shared_stock_product_id_idx"
  ON "products" ("shared_stock_product_id");
