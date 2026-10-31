-- Attendance verification on top of attendance_records. Additive: existing records, payroll
-- runs and bookings stay as they are. Nothing here posts money.

CREATE TABLE IF NOT EXISTS "attendance_locations" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "kind" varchar(20) NOT NULL DEFAULT 'office',
  "address" text,
  "latitude" numeric(9,6),
  "longitude" numeric(9,6),
  "radius_meters" integer NOT NULL DEFAULT 100 CHECK ("radius_meters" BETWEEN 10 AND 5000),
  "max_accuracy_meters" integer NOT NULL DEFAULT 100 CHECK ("max_accuracy_meters" BETWEEN 5 AND 1000),
  "required_method" varchar(20) NOT NULL DEFAULT 'qr_gps',
  "warehouse_id" integer REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_locations_coordinates_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL))
);

CREATE TABLE IF NOT EXISTS "attendance_employee_settings" (
  "staff_id" integer PRIMARY KEY REFERENCES "staff"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "primary_location_id" integer REFERENCES "attendance_locations"("id") ON DELETE SET NULL,
  "required_method" varchar(20) NOT NULL DEFAULT 'qr_gps',
  "event_method" varchar(20),
  "allowed_methods" jsonb NOT NULL DEFAULT '["qr","gps","qr_gps"]'::jsonb,
  "schedule_type" varchar(20) NOT NULL DEFAULT 'fixed',
  "shift_start" time,
  "shift_end" time,
  "weekly_days_off" jsonb,
  "grace_minutes" integer,
  "overtime_eligible" boolean,
  "payroll_integration" boolean,
  "event_attendance" boolean NOT NULL DEFAULT true,
  "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "attendance_shifts" (
  "id" serial PRIMARY KEY,
  "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "shift_date" date NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "kind" varchar(20) NOT NULL DEFAULT 'fixed',
  "location_id" integer REFERENCES "attendance_locations"("id") ON DELETE SET NULL,
  "required_method" varchar(20),
  "grace_minutes" integer,
  "title" text,
  "booking_source" varchar(10),
  "booking_id" integer,
  "pay_amount" numeric(16,2),
  "status" varchar(20) NOT NULL DEFAULT 'scheduled',
  "notes" text,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_shifts_order_check" CHECK ("end_at" > "start_at"),
  CONSTRAINT "attendance_shifts_booking_check" CHECK (("booking_id" IS NULL) = ("booking_source" IS NULL))
);
CREATE INDEX IF NOT EXISTS "attendance_shifts_staff_date_idx" ON "attendance_shifts" ("staff_id", "shift_date");
CREATE INDEX IF NOT EXISTS "attendance_shifts_date_idx" ON "attendance_shifts" ("shift_date");
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_shifts_booking_uq" ON "attendance_shifts" ("staff_id", "booking_source", "booking_id", "start_at") WHERE "booking_id" IS NOT NULL AND "status" <> 'cancelled';

ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "shift_id" integer REFERENCES "attendance_shifts"("id") ON DELETE SET NULL;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "location_id" integer REFERENCES "attendance_locations"("id") ON DELETE SET NULL;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "method" varchar(20);
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "overtime_approved_minutes" integer;
CREATE INDEX IF NOT EXISTS "attendance_records_staff_checkin_idx" ON "attendance_records" ("staff_id", "check_in_at");
-- Older records keep method NULL, so an old stray open row cannot fail this index.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_records_one_open_idx" ON "attendance_records" ("staff_id") WHERE "check_out_at" IS NULL AND "method" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "attendance_kiosks" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "location_id" integer NOT NULL REFERENCES "attendance_locations"("id") ON DELETE RESTRICT,
  "device_token_hash" varchar(64) NOT NULL,
  "qr_secret" varchar(128) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_seen_at" timestamp,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_kiosks_token_uq" ON "attendance_kiosks" ("device_token_hash");

CREATE TABLE IF NOT EXISTS "attendance_qr_uses" (
  "id" serial PRIMARY KEY,
  "kiosk_id" integer NOT NULL REFERENCES "attendance_kiosks"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "event" varchar(10) NOT NULL,
  "used_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_qr_uses_uq" ON "attendance_qr_uses" ("token_hash", "staff_id");

CREATE TABLE IF NOT EXISTS "attendance_verifications" (
  "id" serial PRIMARY KEY,
  "record_id" integer NOT NULL REFERENCES "attendance_records"("id") ON DELETE CASCADE,
  "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "event" varchar(10) NOT NULL,
  "method" varchar(20) NOT NULL,
  "location_id" integer REFERENCES "attendance_locations"("id") ON DELETE SET NULL,
  "kiosk_id" integer REFERENCES "attendance_kiosks"("id") ON DELETE SET NULL,
  "latitude" numeric(9,6),
  "longitude" numeric(9,6),
  "accuracy_meters" numeric(8,2),
  "distance_meters" numeric(10,2),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "attendance_verifications_record_idx" ON "attendance_verifications" ("record_id");
CREATE INDEX IF NOT EXISTS "attendance_verifications_created_idx" ON "attendance_verifications" ("created_at");

CREATE TABLE IF NOT EXISTS "attendance_corrections" (
  "id" serial PRIMARY KEY,
  "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "work_date" date NOT NULL,
  "request_type" varchar(30) NOT NULL,
  "requested_check_in" timestamp with time zone,
  "requested_check_out" timestamp with time zone,
  "record_id" integer REFERENCES "attendance_records"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "attachment" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "reviewed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "reviewed_by_name" text NOT NULL DEFAULT '',
  "reviewed_at" timestamp,
  "review_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "attendance_corrections_status_idx" ON "attendance_corrections" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "attendance_corrections_staff_idx" ON "attendance_corrections" ("staff_id", "work_date");

-- One compensation per event shift; older incentive rows never carry this source type.
CREATE UNIQUE INDEX IF NOT EXISTS "hr_incentive_events_attendance_shift_uq" ON "hr_incentive_events" ("source_type", "source_id") WHERE "source_type" = 'attendance_shift';

-- Fail the transaction if a same-named object has a different shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'attendance_records' AND column_name = 'method'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'attendance_shifts' AND column_name = 'booking_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'attendance_records_one_open_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'attendance_qr_uses_uq'
  ) THEN
    RAISE EXCEPTION 'Attendance migration verification failed';
  END IF;
END $$;
