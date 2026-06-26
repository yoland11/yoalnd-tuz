ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_rental" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "price_per_day" numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "products_is_rental_active_idx"
  ON "products" ("is_rental", "is_active");

CREATE TABLE IF NOT EXISTS "rental_orders" (
  "id" serial PRIMARY KEY,
  "order_no" varchar(40) NOT NULL UNIQUE,
  "product_id" integer NOT NULL REFERENCES "products" ("id") ON DELETE RESTRICT,
  "stock_source_product_id" integer REFERENCES "products" ("id") ON DELETE SET NULL,
  "customer_id" integer REFERENCES "customers" ("id") ON DELETE SET NULL,
  "customer_name" text NOT NULL DEFAULT '',
  "phone" varchar(30) NOT NULL,
  "phone_last4" varchar(4),
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "days" integer NOT NULL DEFAULT 1,
  "price_per_day" numeric(12,2) NOT NULL DEFAULT 0,
  "total_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "paid_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "remaining_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
  "payment_status" varchar(20) NOT NULL DEFAULT 'paid',
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "notes" text,
  "stock_applied" integer NOT NULL DEFAULT 1,
  "stock_restored_at" timestamp,
  "financial_transaction_id" integer,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "returned_at" timestamp,
  "cancelled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rental_orders_product_dates_idx"
  ON "rental_orders" ("product_id", "start_date", "end_date", "status");
CREATE INDEX IF NOT EXISTS "rental_orders_stock_source_dates_idx"
  ON "rental_orders" ("stock_source_product_id", "start_date", "end_date", "status");
CREATE INDEX IF NOT EXISTS "rental_orders_phone_idx"
  ON "rental_orders" ("phone");
CREATE INDEX IF NOT EXISTS "rental_orders_customer_idx"
  ON "rental_orders" ("customer_id");
CREATE INDEX IF NOT EXISTS "rental_orders_status_created_idx"
  ON "rental_orders" ("status", "created_at");
