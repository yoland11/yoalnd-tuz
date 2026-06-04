ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "image_url" text;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "image_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category_id" integer REFERENCES "categories" ("id");
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "subcategory_id" integer REFERENCES "categories" ("id");

UPDATE "products" p
SET "category_id" = c."id"
FROM "categories" c
WHERE p."category_id" IS NULL
  AND p."category" IS NOT NULL
  AND p."category" = c."slug"
  AND c."parent_id" IS NULL;

UPDATE "products" p
SET "subcategory_id" = c."id"
FROM "categories" c
WHERE p."subcategory_id" IS NULL
  AND p."subcategory" IS NOT NULL
  AND p."subcategory" = c."slug"
  AND c."parent_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "categories_parent_active_sort_idx" ON "categories" ("parent_id", "is_active", "sort_order");
CREATE INDEX IF NOT EXISTS "products_category_id_active_idx" ON "products" ("category_id", "is_active");
CREATE INDEX IF NOT EXISTS "products_subcategory_id_active_idx" ON "products" ("subcategory_id", "is_active");
