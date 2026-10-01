-- Optional uploaded image reference; legacy staff and historical attribution stay intact.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url text;
