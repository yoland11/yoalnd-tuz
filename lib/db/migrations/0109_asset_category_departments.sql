-- Asset-category departments are organisational metadata only. They do not
-- alter product IDs, QR codes, stock, custody, maintenance or accounting.
ALTER TABLE "asset_categories"
  ADD COLUMN IF NOT EXISTS "parent_id" integer REFERENCES "asset_categories"("id") ON DELETE RESTRICT;
ALTER TABLE "asset_categories"
  ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "asset_categories"
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "asset_categories_parent_idx"
  ON "asset_categories" ("parent_id");
CREATE INDEX IF NOT EXISTS "asset_categories_active_sort_idx"
  ON "asset_categories" ("is_active", "sort_order");

INSERT INTO "asset_categories" ("name", "icon", "sort_order") VALUES
  ('التصوير', 'camera', 10),
  ('الإضاءة', 'lightbulb', 20),
  ('الكوشات', 'lamp', 30),
  ('الصوتيات', 'audio-lines', 40),
  ('المركبات', 'car-front', 50),
  ('الطباعة', 'printer', 60),
  ('تجهيزات التخرج', 'graduation-cap', 70),
  ('الأثاث', 'armchair', 80),
  ('أدوات ومعدات', 'package', 90),
  ('أخرى', 'boxes', 100)
ON CONFLICT ("name") DO NOTHING;
