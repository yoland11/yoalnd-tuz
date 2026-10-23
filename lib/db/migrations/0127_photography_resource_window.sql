-- Optional full operating period for standalone photography events only.
-- Linked events continue to read the original central booking period.
-- No default, historical backfill, new booking or reservation record.
ALTER TABLE photography_events ADD COLUMN IF NOT EXISTS resource_window jsonb;
