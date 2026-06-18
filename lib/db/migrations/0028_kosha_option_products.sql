ALTER TABLE "kosha_accessories"
  ADD COLUMN IF NOT EXISTS "price" NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "main_image" TEXT;

CREATE TABLE IF NOT EXISTS "kosha_addons" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "price" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "description" TEXT,
  "main_image" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kosha_welcome_boards" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "price" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "description" TEXT,
  "main_image" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kosha_addons_active_sort_idx" ON "kosha_addons" ("is_active", "sort_order", "id");
CREATE INDEX IF NOT EXISTS "kosha_welcome_boards_active_sort_idx" ON "kosha_welcome_boards" ("is_active", "sort_order", "id");

INSERT INTO "kosha_addons" ("name", "sort_order")
VALUES
  ('تصوير', 10),
  ('ألبوم', 20),
  ('فيديو مختصر', 30),
  ('دي جي', 40),
  ('إضاءة إضافية', 50),
  ('توصيل وتركيب', 60)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "kosha_welcome_boards" ("name", "sort_order")
VALUES
  ('بورد ترحيب كلاسيك', 10),
  ('بورد ترحيب ذهبي', 20),
  ('بورد ورد', 30),
  ('بورد مرآة', 40)
ON CONFLICT ("name") DO NOTHING;
