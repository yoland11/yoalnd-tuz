-- Preserve cancelled Kosha bookings instead of deleting customer and financial history.
ALTER TABLE "kosha_bookings"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

CREATE INDEX IF NOT EXISTS "kosha_bookings_archived_created_idx"
  ON "kosha_bookings" ("archived_at", "created_at");

-- Editing and cancellation lookups use these columns repeatedly.
CREATE INDEX IF NOT EXISTS "order_items_order_product_idx"
  ON "order_items" ("order_id", "product_id");

CREATE INDEX IF NOT EXISTS "stock_movements_related_idx"
  ON "stock_movements" ("related_type", "related_id", "created_at");
