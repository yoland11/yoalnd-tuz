CREATE TABLE IF NOT EXISTS "koshas" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" VARCHAR(160) NOT NULL UNIQUE,
  "description" TEXT,
  "price" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "old_price" NUMERIC(14,2),
  "discount_percentage" INTEGER NOT NULL DEFAULT 0,
  "main_image" TEXT,
  "number_of_pieces" INTEGER,
  "main_color" VARCHAR(80),
  "flower_color" VARCHAR(80),
  "kosha_space" VARCHAR(120),
  "side_console_space" VARCHAR(120),
  "accessories" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "notes" TEXT,
  "availability_status" VARCHAR(40) NOT NULL DEFAULT 'available',
  "is_featured" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kosha_images" (
  "id" SERIAL PRIMARY KEY,
  "kosha_id" INTEGER NOT NULL REFERENCES "koshas"("id") ON DELETE CASCADE,
  "image_url" TEXT NOT NULL,
  "image_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kosha_bookings" (
  "id" SERIAL PRIMARY KEY,
  "kosha_id" INTEGER REFERENCES "koshas"("id") ON DELETE SET NULL,
  "customer_name" TEXT NOT NULL,
  "phone" VARCHAR(20) NOT NULL,
  "event_date" TEXT,
  "event_time" VARCHAR(20),
  "city_area" TEXT,
  "hall_location" TEXT,
  "notes" TEXT,
  "status" VARCHAR(30) NOT NULL DEFAULT 'new',
  "internal_notes" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "koshas_active_sort_idx" ON "koshas" ("is_active", "sort_order", "id");
CREATE INDEX IF NOT EXISTS "koshas_featured_idx" ON "koshas" ("is_featured", "is_active");
CREATE INDEX IF NOT EXISTS "kosha_images_kosha_sort_idx" ON "kosha_images" ("kosha_id", "sort_order", "id");
CREATE INDEX IF NOT EXISTS "kosha_bookings_kosha_idx" ON "kosha_bookings" ("kosha_id");
CREATE INDEX IF NOT EXISTS "kosha_bookings_status_idx" ON "kosha_bookings" ("status");
CREATE INDEX IF NOT EXISTS "kosha_bookings_created_at_idx" ON "kosha_bookings" ("created_at");
