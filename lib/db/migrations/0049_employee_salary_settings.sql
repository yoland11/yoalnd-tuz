-- Additive employee salary profile. Existing staff payroll columns remain authoritative fallbacks.
CREATE TABLE IF NOT EXISTS "employee_salary_settings" (
  "id" serial PRIMARY KEY, "staff_id" integer NOT NULL UNIQUE REFERENCES "staff"("id") ON DELETE CASCADE,
  "employment_type" varchar(30) NOT NULL DEFAULT 'full_time', "first_payroll_date" date,
  "monthly_working_hours" numeric(8,2) NOT NULL DEFAULT 0, "shift_start" time, "shift_end" time, "weekly_days_off" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "risk_allowance" numeric(16,2) NOT NULL DEFAULT 0, "weekend_hour_rate" numeric(16,2) NOT NULL DEFAULT 0, "holiday_hour_rate" numeric(16,2) NOT NULL DEFAULT 0, "max_monthly_overtime" numeric(8,2) NOT NULL DEFAULT 0,
  "tax_deduction" numeric(16,2) NOT NULL DEFAULT 0, "insurance_deduction" numeric(16,2) NOT NULL DEFAULT 0, "retirement_deduction" numeric(16,2) NOT NULL DEFAULT 0, "late_deduction" numeric(16,2) NOT NULL DEFAULT 0, "absence_deduction" numeric(16,2) NOT NULL DEFAULT 0, "other_deduction" numeric(16,2) NOT NULL DEFAULT 0,
  "monthly_bonus" numeric(16,2) NOT NULL DEFAULT 0, "performance_bonus" numeric(16,2) NOT NULL DEFAULT 0, "commission" numeric(16,2) NOT NULL DEFAULT 0, "annual_bonus" numeric(16,2) NOT NULL DEFAULT 0, "other_bonus" numeric(16,2) NOT NULL DEFAULT 0,
  "bank_name" text, "account_number" text, "iban" varchar(64),
  "generate_payroll_automatically" boolean NOT NULL DEFAULT false, "enable_overtime" boolean NOT NULL DEFAULT true, "enable_attendance_integration" boolean NOT NULL DEFAULT true, "enable_advance_deduction" boolean NOT NULL DEFAULT true, "enable_bonuses" boolean NOT NULL DEFAULT true, "enable_penalties" boolean NOT NULL DEFAULT true,
  "approval_status" varchar(20) NOT NULL DEFAULT 'approved', "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "approved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "employee_salary_setting_audits" (
  "id" serial PRIMARY KEY, "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT, "actor_id" integer REFERENCES "staff"("id") ON DELETE SET NULL, "actor_name" text NOT NULL DEFAULT '', "action" varchar(40) NOT NULL, "old_value" jsonb NOT NULL DEFAULT '{}'::jsonb, "new_value" jsonb NOT NULL DEFAULT '{}'::jsonb, "ip_address" varchar(80), "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "employee_salary_setting_audits_staff_created_idx" ON "employee_salary_setting_audits"("staff_id", "created_at");
