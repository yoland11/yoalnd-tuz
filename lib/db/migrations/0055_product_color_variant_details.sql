-- Extends the existing product_variants table; products stay single records.
ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "max_stock" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notes" text;

CREATE INDEX IF NOT EXISTS "product_variants_active_stock_idx"
  ON "product_variants" ("product_id", "is_active", "stock");
