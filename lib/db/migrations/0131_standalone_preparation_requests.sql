-- Additive operational preparation requests. No booking, money or stock changes.
CREATE TABLE IF NOT EXISTS "preparation_requests" (
  "id" serial PRIMARY KEY,
  "request_no" varchar(40),
  "request_token" varchar(80) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "customer_name" text NOT NULL,
  "occasion_name" text,
  "event_date" date,
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "created_by" integer REFERENCES "staff"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "preparation_requests_token_uq" ON "preparation_requests" ("request_token");
CREATE UNIQUE INDEX IF NOT EXISTS "preparation_requests_no_uq" ON "preparation_requests" ("request_no");
CREATE INDEX IF NOT EXISTS "preparation_requests_customer_idx" ON "preparation_requests" ("customer_id");
CREATE INDEX IF NOT EXISTS "preparation_requests_event_idx" ON "preparation_requests" ("event_date");

CREATE TABLE IF NOT EXISTS "preparation_request_items" (
  "id" serial PRIMARY KEY,
  "request_id" integer NOT NULL REFERENCES "preparation_requests"("id") ON DELETE RESTRICT,
  "source" varchar(20) NOT NULL CHECK ("source" IN ('product', 'asset', 'custom')),
  "product_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "sku" varchar(120),
  "department" varchar(40) NOT NULL DEFAULT 'other',
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "info_only" boolean NOT NULL DEFAULT false,
  "status" varchar(30) NOT NULL DEFAULT 'preparing',
  "assignee_id" integer REFERENCES "staff"("id"),
  "task_id" integer REFERENCES "tasks"("id"),
  "note" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "preparation_request_items_request_idx" ON "preparation_request_items" ("request_id");

-- Fail the transaction if an existing object with the same name has a different
-- shape. The migration runner reports APPLIED only after these checks pass.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'preparation_requests'
      AND column_name = 'request_token' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'preparation_request_items'
      AND column_name = 'request_id' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'preparation_requests_token_uq'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'preparation_request_items_request_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'preparation_requests'::regclass AND contype = 'f'
      AND confrelid = 'customers'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'preparation_request_items'::regclass AND contype = 'f'
      AND confrelid = 'preparation_requests'::regclass
  ) THEN
    RAISE EXCEPTION 'Standalone preparation migration verification failed';
  END IF;
END $$;
