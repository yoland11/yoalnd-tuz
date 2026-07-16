-- Detailed, traceable employee bonuses. Additive for existing payroll events.
ALTER TABLE "hr_incentive_events"
  ADD COLUMN IF NOT EXISTS "bonus_type" varchar(60) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "bonus_source" varchar(60) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "source_type" varchar(60),
  ADD COLUMN IF NOT EXISTS "source_id" varchar(120),
  ADD COLUMN IF NOT EXISTS "calculation_method" varchar(20) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS "quantity" numeric(16,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "rate_per_unit" numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "percentage" numeric(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "base_amount" numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "calculation_formula" text,
  ADD COLUMN IF NOT EXISTS "related_department" varchar(60),
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "performance_score" numeric(6,2),
  ADD COLUMN IF NOT EXISTS "customer_rating" numeric(6,2),
  ADD COLUMN IF NOT EXISTS "attachment" text,
  ADD COLUMN IF NOT EXISTS "approved_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "approved_by_name" text,
  ADD COLUMN IF NOT EXISTS "approval_date" timestamp;

CREATE INDEX IF NOT EXISTS "hr_incentive_events_source_idx"
  ON "hr_incentive_events" ("source_type", "source_id");

CREATE UNIQUE INDEX IF NOT EXISTS "hr_incentive_events_source_period_uq"
  ON "hr_incentive_events" ("staff_id", "source_type", "source_id", "period", "bonus_type")
  WHERE "source_type" IS NOT NULL AND "source_id" IS NOT NULL;
