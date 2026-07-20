-- Fixed-asset categories are kept separate from storefront categories. This
-- prevents equipment administration from changing the public catalogue.
CREATE TABLE IF NOT EXISTS "asset_categories" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "description" text,
  "color" varchar(20),
  "icon" varchar(80),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_categories_name_idx"
  ON "asset_categories" ("name");
CREATE INDEX IF NOT EXISTS "asset_categories_created_idx"
  ON "asset_categories" ("created_at");

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "asset_category_id" integer
  REFERENCES "asset_categories" ("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "products_asset_category_id_idx"
  ON "products" ("asset_category_id");

INSERT INTO "asset_categories" ("name", "icon") VALUES
  ('كاميرا', 'camera'), ('عدسة', 'aperture'), ('درون', 'drone'),
  ('إضاءة', 'lightbulb'), ('صوت', 'audio-lines'), ('سماعة', 'speaker'),
  ('مكسر صوت', 'sliders-horizontal'), ('شاشة', 'monitor'), ('ديكور', 'lamp'),
  ('مركبة', 'car-front'), ('أثاث', 'armchair'), ('أخرى', 'package')
ON CONFLICT ("name") DO NOTHING;

-- Link records created by the previous fixed list before the new relation was
-- introduced. Existing unmatched legacy values remain untouched.
UPDATE "products" AS p
SET "asset_category_id" = c."id"
FROM "asset_categories" AS c
WHERE p."asset_category_id" IS NULL
  AND p."is_asset" = true
  AND p."category" = c."name";
