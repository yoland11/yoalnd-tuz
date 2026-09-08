-- Manager booking instructions and per-channel read state. This migration is
-- additive only: existing Kosha media, booking, finance, inventory, and
-- timeline records are left unchanged. Booking identity remains polymorphic.

CREATE TABLE IF NOT EXISTS "kosha_manager_instructions" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_source" varchar(12) NOT NULL,
  "booking_id" integer NOT NULL,
  "kind" varchar(12) NOT NULL,
  "media_url" text,
  "caption" text,
  "uploaded_by_staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "uploaded_by_name" text,
  "revision" integer NOT NULL DEFAULT 1,
  "booking_version" bigint NOT NULL,
  "archived_at" timestamp,
  "archived_by_staff_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "kosha_manager_instructions_booking_source_check"
    CHECK ("booking_source" IN ('kosha', 'service')),
  CONSTRAINT "kosha_manager_instructions_kind_check"
    CHECK ("kind" IN ('note', 'image')),
  CONSTRAINT "kosha_manager_instructions_media_check"
    CHECK (("kind" = 'image' AND "media_url" IS NOT NULL AND btrim("media_url") <> '') OR ("kind" = 'note' AND "media_url" IS NULL))
);

CREATE INDEX IF NOT EXISTS "kosha_manager_instructions_active_booking_idx"
  ON "kosha_manager_instructions" ("booking_source", "booking_id", "archived_at", "booking_version");

CREATE TABLE IF NOT EXISTS "kosha_booking_channel_reads" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_source" varchar(12) NOT NULL,
  "booking_id" integer NOT NULL,
  "staff_id" integer NOT NULL REFERENCES "staff" ("id") ON DELETE RESTRICT,
  "channel" varchar(24) NOT NULL,
  "viewed_at" timestamp NOT NULL,
  "viewed_version" bigint NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "kosha_booking_channel_reads_booking_source_check"
    CHECK ("booking_source" IN ('kosha', 'service')),
  CONSTRAINT "kosha_booking_channel_reads_channel_check"
    CHECK ("channel" IN ('manager_instruction', 'staff_execution'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "kosha_booking_channel_reads_identity_idx"
  ON "kosha_booking_channel_reads" ("booking_source", "booking_id", "staff_id", "channel");
CREATE INDEX IF NOT EXISTS "kosha_booking_channel_reads_booking_channel_idx"
  ON "kosha_booking_channel_reads" ("booking_source", "booking_id", "channel");

CREATE TABLE IF NOT EXISTS "kosha_instruction_booking_versions" (
  "booking_source" varchar(12) NOT NULL,
  "booking_id" integer NOT NULL,
  "current_version" bigint NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "kosha_instruction_booking_versions_booking_source_check"
    CHECK ("booking_source" IN ('kosha', 'service'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "kosha_instruction_booking_versions_identity_idx"
  ON "kosha_instruction_booking_versions" ("booking_source", "booking_id");
