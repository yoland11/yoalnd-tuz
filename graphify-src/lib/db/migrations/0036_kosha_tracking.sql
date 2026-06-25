-- Kosha booking customer tracking: readable code (AJN-KOSHA-0001) + a 7-step tracking stage.
-- Additive & safe; backfills codes for existing bookings.

ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "tracking_code" varchar(40);
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "tracking_status" varchar(40) NOT NULL DEFAULT 'booked';

UPDATE "kosha_bookings"
SET "tracking_code" = 'AJN-KOSHA-' || lpad("id"::text, 4, '0')
WHERE "tracking_code" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "kosha_bookings_tracking_code_idx" ON "kosha_bookings" ("tracking_code");
