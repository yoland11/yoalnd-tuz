-- Purchase invoice lines retain a nullable reference and display snapshots.
-- Historical lines stay product-level and require no rewrite.
ALTER TABLE "purchase_invoice_items"
  ADD COLUMN IF NOT EXISTS "variant_id" integer,
  ADD COLUMN IF NOT EXISTS "variant_label" text,
  ADD COLUMN IF NOT EXISTS "variant_sku" varchar(80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_invoice_items_variant_id_fkey'
      AND conrelid = 'purchase_invoice_items'::regclass
  ) THEN
    ALTER TABLE "purchase_invoice_items"
      ADD CONSTRAINT "purchase_invoice_items_variant_id_fkey"
      FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_invoice_items_variant_idx"
  ON "purchase_invoice_items" ("variant_id");
