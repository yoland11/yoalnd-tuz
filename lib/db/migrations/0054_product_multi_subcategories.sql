-- One product, barcode and inventory source can be shown in multiple
-- subcategories. The legacy primary subcategory remains for compatibility.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "subcategory_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "products"
SET "subcategory_ids" = jsonb_build_array("subcategory_id")
WHERE coalesce(jsonb_array_length("subcategory_ids"), 0) = 0
  AND "subcategory_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "products_subcategory_ids_gin_idx"
  ON "products" USING gin ("subcategory_ids");
