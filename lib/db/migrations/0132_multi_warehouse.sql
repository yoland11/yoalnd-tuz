-- Multi-warehouse foundation. Additive: no existing row is rewritten and no quantity is copied.
-- products.stock stays the company total, so existing stock cannot double. warehouse_stock holds
-- what each OTHER warehouse has; the main warehouse (lowest id) owns the remainder automatically.

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "code" varchar(30);
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "location" text;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "manager_id" integer REFERENCES "staff"("id") ON DELETE SET NULL;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "phone" varchar(40);
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_code_uq" ON "warehouses" (lower("code")) WHERE "code" IS NOT NULL;

INSERT INTO "warehouses" ("name")
SELECT 'المخزن الرئيسي'
WHERE NOT EXISTS (SELECT 1 FROM "warehouses");

ALTER TABLE "warehouse_stock" ADD COLUMN IF NOT EXISTS "quantity_checked_out" integer NOT NULL DEFAULT 0;
ALTER TABLE "warehouse_stock" ADD COLUMN IF NOT EXISTS "quantity_damaged" integer NOT NULL DEFAULT 0;
ALTER TABLE "warehouse_stock" ADD COLUMN IF NOT EXISTS "quantity_maintenance" integer NOT NULL DEFAULT 0;
ALTER TABLE "warehouse_stock" ADD COLUMN IF NOT EXISTS "quantity_missing" integer NOT NULL DEFAULT 0;

ALTER TABLE "warehouse_transfers" ADD COLUMN IF NOT EXISTS "responsible_staff_id" integer REFERENCES "staff"("id") ON DELETE SET NULL;
ALTER TABLE "warehouse_transfers" ADD COLUMN IF NOT EXISTS "transfer_date" date;
ALTER TABLE "warehouse_transfers" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120);
ALTER TABLE "warehouse_transfers" ADD COLUMN IF NOT EXISTS "executed_at" timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_transfers_idempotency_uq" ON "warehouse_transfers" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "to_warehouse_id" integer;
CREATE INDEX IF NOT EXISTS "stock_movements_warehouse_idx" ON "stock_movements" ("warehouse_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "stock_movements_to_warehouse_idx" ON "stock_movements" ("to_warehouse_id", "created_at" DESC) WHERE "to_warehouse_id" IS NOT NULL;

ALTER TABLE "stock_reservations" ADD COLUMN IF NOT EXISTS "warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE SET NULL;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "expenses_warehouse_idx" ON "expenses" ("warehouse_id") WHERE "warehouse_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "warehouse_counts" (
  "id" serial PRIMARY KEY,
  "count_no" varchar(40),
  "warehouse_id" integer NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "status" varchar(20) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('matched', 'pending', 'approved', 'rejected')),
  "notes" text,
  "request_token" varchar(120) NOT NULL,
  "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "reviewed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "reviewed_by_name" text NOT NULL DEFAULT '',
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_counts_token_uq" ON "warehouse_counts" ("request_token");
CREATE INDEX IF NOT EXISTS "warehouse_counts_warehouse_idx" ON "warehouse_counts" ("warehouse_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "warehouse_count_lines" (
  "id" serial PRIMARY KEY,
  "count_id" integer NOT NULL REFERENCES "warehouse_counts"("id") ON DELETE RESTRICT,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_name" text NOT NULL DEFAULT '',
  "expected_quantity" numeric(12,3) NOT NULL,
  "counted_quantity" numeric(12,3) NOT NULL CHECK ("counted_quantity" >= 0),
  "difference" numeric(12,3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_count_lines_uq" ON "warehouse_count_lines" ("count_id", "product_id");

-- Fail the transaction if a same-named object has a different shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'warehouse_stock' AND column_name = 'quantity_damaged'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'stock_movements' AND column_name = 'to_warehouse_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'stock_reservations' AND column_name = 'warehouse_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'expenses' AND column_name = 'warehouse_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'warehouse_count_lines' AND column_name = 'counted_quantity'
  ) OR NOT EXISTS (SELECT 1 FROM "warehouses") THEN
    RAISE EXCEPTION 'Multi-warehouse migration verification failed';
  END IF;
END $$;
