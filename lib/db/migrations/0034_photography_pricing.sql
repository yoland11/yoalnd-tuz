-- Photography portal: managed unit pricing + soft-cancel for orders.
-- Additive only — safe to run on existing data.

ALTER TABLE "photography_orders" ADD COLUMN IF NOT EXISTS "unit_price" numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "photography_orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
ALTER TABLE "photography_orders" ADD COLUMN IF NOT EXISTS "cancelled_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL;

-- Backfill unit_price for legacy rows from total/copies so existing orders display a sane unit price.
UPDATE "photography_orders"
SET "unit_price" = ROUND("total_amount" / GREATEST("copies", 1), 2)
WHERE "unit_price" = 0 AND "total_amount" > 0;
