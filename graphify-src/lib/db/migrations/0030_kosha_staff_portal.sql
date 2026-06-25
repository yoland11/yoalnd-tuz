-- 0030 Kosha Staff Portal — additive field-crew execution layer.
-- Safe & additive: extends kosha_bookings and adds execution/timeline/media/delivery/payment tables.

ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "execution_stage" varchar(30) NOT NULL DEFAULT 'preparing';
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "assigned_staff_id" integer;

CREATE TABLE IF NOT EXISTS "kosha_booking_events" (
  "id" serial PRIMARY KEY,
  "booking_id" integer NOT NULL REFERENCES "kosha_bookings" ("id") ON DELETE CASCADE,
  "staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "staff_name" text NOT NULL DEFAULT '',
  "type" varchar(30) NOT NULL,
  "from_stage" varchar(30),
  "to_stage" varchar(30),
  "note" text,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_booking_events_booking_idx" ON "kosha_booking_events" ("booking_id");

CREATE TABLE IF NOT EXISTS "kosha_media" (
  "id" serial PRIMARY KEY,
  "booking_id" integer NOT NULL REFERENCES "kosha_bookings" ("id") ON DELETE CASCADE,
  "event_id" integer REFERENCES "kosha_booking_events" ("id") ON DELETE SET NULL,
  "staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "url" text NOT NULL,
  "kind" varchar(10) NOT NULL DEFAULT 'image',
  "stage" varchar(30),
  "purpose" varchar(20) NOT NULL DEFAULT 'execution',
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_media_booking_idx" ON "kosha_media" ("booking_id");

CREATE TABLE IF NOT EXISTS "kosha_delivery_reports" (
  "id" serial PRIMARY KEY,
  "booking_id" integer NOT NULL REFERENCES "kosha_bookings" ("id") ON DELETE CASCADE,
  "staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "staff_name" text NOT NULL DEFAULT '',
  "has_loss" boolean NOT NULL DEFAULT false,
  "has_breakage" boolean NOT NULL DEFAULT false,
  "note" text,
  "compensation_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "signature_url" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_delivery_reports_booking_idx" ON "kosha_delivery_reports" ("booking_id");

CREATE TABLE IF NOT EXISTS "kosha_payment_requests" (
  "id" serial PRIMARY KEY,
  "booking_id" integer NOT NULL REFERENCES "kosha_bookings" ("id") ON DELETE CASCADE,
  "staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "staff_name" text NOT NULL DEFAULT '',
  "amount" numeric(14,2) NOT NULL DEFAULT 0,
  "note" text,
  "status" varchar(12) NOT NULL DEFAULT 'pending',
  "reviewed_by_staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "reviewed_by_name" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_payment_requests_status_idx" ON "kosha_payment_requests" ("status");

CREATE TABLE IF NOT EXISTS "kosha_staff_notifications" (
  "id" serial PRIMARY KEY,
  "staff_id" integer REFERENCES "staff" ("id") ON DELETE CASCADE,
  "audience" varchar(12) NOT NULL DEFAULT 'staff',
  "type" varchar(30) NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "booking_id" integer REFERENCES "kosha_bookings" ("id") ON DELETE CASCADE,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "kosha_staff_notifications_staff_idx" ON "kosha_staff_notifications" ("staff_id");
