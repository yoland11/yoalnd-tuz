-- Store a selected product variant with the cart and order line so the flower
-- designer can reserve/deduct the precise colour/SKU rather than aggregate stock.
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" integer;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "variant_id" integer;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "variant_id" integer;
CREATE INDEX IF NOT EXISTS "cart_items_variant_idx" ON "cart_items" ("variant_id");
CREATE INDEX IF NOT EXISTS "order_items_variant_idx" ON "order_items" ("variant_id");
CREATE INDEX IF NOT EXISTS "stock_movements_variant_idx" ON "stock_movements" ("variant_id");
