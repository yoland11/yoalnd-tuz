-- Kosha occasion categories (حنة / خطوبة / عرس / عيد ميلاد / تخرج / مناسبات أخرى …),
-- manager-managed, plus a nullable category link on koshas. Additive & safe on existing data.

CREATE TABLE IF NOT EXISTS "kosha_categories" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL UNIQUE,
  "slug" varchar(160) NOT NULL UNIQUE,
  "icon" varchar(60),
  "image" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "koshas" ADD COLUMN IF NOT EXISTS "category_id" integer REFERENCES "kosha_categories" ("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "koshas_category_idx" ON "koshas" ("category_id");

INSERT INTO "kosha_categories" ("name","slug","sort_order") VALUES
  ('حنة','hanna',1),('خطوبة','khotoba',2),('عرس','wedding',3),
  ('عيد ميلاد','birthday',4),('تخرج','graduation',5),('مناسبات أخرى','other',6)
ON CONFLICT ("name") DO NOTHING;
