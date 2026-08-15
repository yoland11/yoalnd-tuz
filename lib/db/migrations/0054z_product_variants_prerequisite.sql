-- Historical installations created product_variants lazily at runtime, while
-- 0055 already expected it to exist. Make the dependency explicit before 0055.
CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" serial PRIMARY KEY,
  "product_id" integer NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE,
  "color" varchar(60),
  "color_hex" varchar(16),
  "size" varchar(60),
  "sku" varchar(80),
  "barcode" varchar(100),
  "qr_token" varchar(80),
  "image" text,
  "price" numeric(12,2),
  "cost" numeric(12,2),
  "stock" integer NOT NULL DEFAULT 0,
  "min_stock" integer NOT NULL DEFAULT 0,
  "max_stock" integer NOT NULL DEFAULT 0,
  "warehouse_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "product_variants_product_idx" ON "product_variants" ("product_id");
CREATE INDEX IF NOT EXISTS "product_variants_barcode_idx" ON "product_variants" ("barcode");
CREATE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants" ("sku");
