ALTER TABLE "kosha_bookings"
  ADD COLUMN IF NOT EXISTS "bride_name" TEXT,
  ADD COLUMN IF NOT EXISTS "groom_name" TEXT,
  ADD COLUMN IF NOT EXISTS "event_type" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "service_level" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "venue_type" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "theme_color" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "province" TEXT,
  ADD COLUMN IF NOT EXISTS "area" TEXT,
  ADD COLUMN IF NOT EXISTS "mahalla" TEXT,
  ADD COLUMN IF NOT EXISTS "nearest_point" TEXT,
  ADD COLUMN IF NOT EXISTS "address_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "bride_phone" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "groom_phone" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "alternate_phone" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "selected_addons" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "welcome_boards" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "selected_accessories" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "venue_images" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "booking_details" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "kosha_accessories" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kosha_provinces" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kosha_accessories_active_sort_idx" ON "kosha_accessories" ("is_active", "sort_order", "id");
CREATE INDEX IF NOT EXISTS "kosha_provinces_active_sort_idx" ON "kosha_provinces" ("is_active", "sort_order", "id");
CREATE INDEX IF NOT EXISTS "kosha_bookings_event_date_idx" ON "kosha_bookings" ("event_date");

INSERT INTO "kosha_accessories" ("name", "sort_order")
VALUES
  ('كفرات منع التصوير', 10),
  ('دفوف حنة', 20),
  ('مبخرة', 30),
  ('مهفة', 40),
  ('القرآن الكريم', 50),
  ('شال المهر', 60),
  ('ورد الحنة', 70),
  ('وثيقة', 80),
  ('ستاند حلقات', 90),
  ('قصاصات', 100)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "kosha_provinces" ("name", "sort_order")
VALUES
  ('كركوك', 10),
  ('صلاح الدين', 20),
  ('بغداد', 30),
  ('أربيل', 40),
  ('السليمانية', 50),
  ('ديالى', 60),
  ('نينوى', 70)
ON CONFLICT ("name") DO NOTHING;
