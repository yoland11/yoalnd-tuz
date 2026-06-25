-- Migration: Harden staff save/update schema

CREATE TABLE IF NOT EXISTS "staff" (
  "id" serial PRIMARY KEY,
  "username" varchar(50) NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "full_name" text NOT NULL DEFAULT '',
  "role" varchar(30) NOT NULL DEFAULT 'employee',
  "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_activity_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "username" varchar(50),
  ADD COLUMN IF NOT EXISTS "password_hash" text,
  ADD COLUMN IF NOT EXISTS "full_name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "role" varchar(30) NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'staff'
      AND column_name = 'permissions'
      AND udt_name <> 'jsonb'
  ) THEN
    ALTER TABLE "staff" RENAME COLUMN "permissions" TO "permissions_legacy";
    ALTER TABLE "staff" ADD COLUMN "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "staff" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "staff_username_unique_idx" ON "staff" ("username");
CREATE INDEX IF NOT EXISTS "staff_username_lower_idx" ON "staff" (lower("username"));
