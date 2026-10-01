-- Add Koshah financial identity and optional source links for purchased items.
-- Legacy purchase lines and Koshah code fields remain unclassified/null; the UI
-- derives a stable display reference from the primary key until the next edit.

ALTER TABLE "koshas"
  ADD COLUMN IF NOT EXISTS "financial_code" varchar(30);

CREATE UNIQUE INDEX IF NOT EXISTS "koshas_financial_code_idx"
  ON "koshas" ("financial_code");

ALTER TABLE "purchase_invoice_items"
  ADD COLUMN IF NOT EXISTS "cost_category" varchar(20),
  ADD COLUMN IF NOT EXISTS "kosha_id" integer REFERENCES "koshas"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "booking_id" integer REFERENCES "kosha_bookings"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "asset_product_id" integer REFERENCES "products"("id") ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoice_items_cost_category_check'
  ) THEN
    ALTER TABLE "purchase_invoice_items"
      ADD CONSTRAINT "purchase_invoice_items_cost_category_check"
      CHECK ("cost_category" IS NULL OR "cost_category" IN ('investment', 'operating', 'booking'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoice_items_booking_category_check'
  ) THEN
    ALTER TABLE "purchase_invoice_items"
      ADD CONSTRAINT "purchase_invoice_items_booking_category_check"
      CHECK ("cost_category" <> 'booking' OR "booking_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_invoice_items_kosha_idx"
  ON "purchase_invoice_items" ("kosha_id", "cost_category");
CREATE INDEX IF NOT EXISTS "purchase_invoice_items_booking_idx"
  ON "purchase_invoice_items" ("booking_id");
CREATE INDEX IF NOT EXISTS "purchase_invoice_items_asset_product_idx"
  ON "purchase_invoice_items" ("asset_product_id");
