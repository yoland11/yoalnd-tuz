-- Quantity-based assets: one master asset (product) can represent many identical units.
-- Additive only. Existing assets have no row here and keep the individual lifecycle.
-- Warehouse units stay in products.stock and the stock_movements ledger; this table
-- holds the tracking mode plus the physical states that are outside the warehouse.
CREATE TABLE IF NOT EXISTS "asset_quantity_profiles" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL REFERENCES "products" ("id"),
  "tracking_mode" varchar(20) NOT NULL DEFAULT 'quantity',
  "unit_of_measure" varchar(40) NOT NULL DEFAULT 'قطعة',
  "quantity_checked_out" integer NOT NULL DEFAULT 0,
  "quantity_damaged" integer NOT NULL DEFAULT 0,
  "quantity_maintenance" integer NOT NULL DEFAULT 0,
  "quantity_missing" integer NOT NULL DEFAULT 0,
  "configured_by" integer REFERENCES "staff" ("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "asset_quantity_profiles_mode_check"
    CHECK ("tracking_mode" IN ('individual', 'quantity')),
  CONSTRAINT "asset_quantity_profiles_non_negative_check"
    CHECK (
      "quantity_checked_out" >= 0
      AND "quantity_damaged" >= 0
      AND "quantity_maintenance" >= 0
      AND "quantity_missing" >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_quantity_profiles_product_idx"
  ON "asset_quantity_profiles" ("product_id");
