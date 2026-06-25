ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_metadata jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE gallery_items
  ADD COLUMN IF NOT EXISTS image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS avatar_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
