-- Migration: Activity Log Enhancements

ALTER TABLE "admin_activity_logs"
  ADD COLUMN IF NOT EXISTS "user_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "ip_address" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "user_agent" TEXT;

CREATE INDEX IF NOT EXISTS "admin_activity_user_created_idx"
  ON "admin_activity_logs" ("user_name", "created_at");

CREATE INDEX IF NOT EXISTS "admin_activity_entity_created_idx"
  ON "admin_activity_logs" ("entity_type", "created_at");

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "cost_price" NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "min_stock" INTEGER NOT NULL DEFAULT 0;

UPDATE "products"
SET "barcode" = 'AJN' || LPAD("id"::TEXT, 8, '0')
WHERE "barcode" IS NULL OR "barcode" = '';

CREATE INDEX IF NOT EXISTS "products_barcode_idx"
  ON "products" ("barcode")
  WHERE "barcode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "products_stock_min_stock_idx"
  ON "products" ("stock", "min_stock");

CREATE TABLE IF NOT EXISTS "coupons" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL UNIQUE,
  "title" TEXT NOT NULL DEFAULT '',
  "type" VARCHAR(20) NOT NULL DEFAULT 'fixed',
  "value" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "min_order_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "usage_limit" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "coupon_usages" (
  "id" SERIAL PRIMARY KEY,
  "coupon_id" INTEGER NOT NULL REFERENCES "coupons" ("id"),
  "customer_phone" VARCHAR(30),
  "order_id" INTEGER REFERENCES "orders" ("id"),
  "sales_invoice_id" INTEGER REFERENCES "sales_invoices" ("id"),
  "discount_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "coupon_code" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "coupon_discount_amount" NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "coupon_code" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "coupon_discount_amount" NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "coupons_code_idx" ON "coupons" ("code");
CREATE INDEX IF NOT EXISTS "coupon_usages_coupon_created_idx" ON "coupon_usages" ("coupon_id", "created_at");

CREATE TABLE IF NOT EXISTS "loyalty_points" (
  "id" SERIAL PRIMARY KEY,
  "customer_id" INTEGER NOT NULL REFERENCES "customers" ("id"),
  "order_id" INTEGER REFERENCES "orders" ("id"),
  "service_order_id" INTEGER REFERENCES "service_orders" ("id"),
  "points" INTEGER NOT NULL,
  "reason" VARCHAR(120) NOT NULL DEFAULT 'order_reward',
  "note" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "loyalty_points_redeemed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "loyalty_discount_amount" NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "loyalty_points_customer_created_idx"
  ON "loyalty_points" ("customer_id", "created_at");
