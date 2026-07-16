-- AJN HR, payroll, incentive, evaluation and customer-rating extension.
-- Additive only; existing employee and finance records remain untouched.
CREATE TABLE IF NOT EXISTS "hr_incentive_rules" (
  "id" serial PRIMARY KEY, "code" varchar(60) NOT NULL UNIQUE, "name" text NOT NULL,
  "kind" varchar(20) NOT NULL DEFAULT 'bonus', "metric" varchar(60) NOT NULL,
  "operator" varchar(10) NOT NULL DEFAULT 'gte', "threshold" numeric(16,2) NOT NULL DEFAULT 0,
  "amount" numeric(16,2) NOT NULL DEFAULT 0, "department" varchar(60), "is_active" integer NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "hr_incentive_events" (
  "id" serial PRIMARY KEY, "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "rule_id" integer REFERENCES "hr_incentive_rules"("id") ON DELETE SET NULL, "period" varchar(7) NOT NULL,
  "kind" varchar(20) NOT NULL, "amount" numeric(16,2) NOT NULL DEFAULT 0, "points" integer NOT NULL DEFAULT 0,
  "title" text NOT NULL DEFAULT '', "reason" text, "status" varchar(20) NOT NULL DEFAULT 'pending',
  "payroll_line_id" integer, "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT 'system', "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hr_incentive_events_staff_period_idx" ON "hr_incentive_events" ("staff_id", "period");
CREATE INDEX IF NOT EXISTS "hr_incentive_events_rule_period_idx" ON "hr_incentive_events" ("rule_id", "staff_id", "period");
CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" serial PRIMARY KEY, "run_no" varchar(40) NOT NULL UNIQUE, "period" varchar(7) NOT NULL UNIQUE,
  "status" varchar(20) NOT NULL DEFAULT 'draft', "notes" text,
  "total_gross" numeric(16,2) NOT NULL DEFAULT 0, "total_deductions" numeric(16,2) NOT NULL DEFAULT 0, "total_net" numeric(16,2) NOT NULL DEFAULT 0,
  "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "created_by_name" text NOT NULL DEFAULT '',
  "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "approved_by_name" text NOT NULL DEFAULT '',
  "approved_at" timestamp, "paid_at" timestamp, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "payroll_lines" (
  "id" serial PRIMARY KEY, "payroll_run_id" integer NOT NULL REFERENCES "payroll_runs"("id") ON DELETE RESTRICT,
  "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "base_salary" numeric(16,2) NOT NULL DEFAULT 0, "overtime_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "bonus_amount" numeric(16,2) NOT NULL DEFAULT 0, "penalty_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "advance_deduction" numeric(16,2) NOT NULL DEFAULT 0, "insurance_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "gross_salary" numeric(16,2) NOT NULL DEFAULT 0, "net_salary" numeric(16,2) NOT NULL DEFAULT 0,
  "financial_transaction_id" integer, "signature_name" text, "signed_at" timestamp, "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "payroll_lines_run_staff_idx" ON "payroll_lines" ("payroll_run_id", "staff_id");
CREATE TABLE IF NOT EXISTS "employee_targets" (
  "id" serial PRIMARY KEY, "staff_id" integer REFERENCES "staff"("id") ON DELETE CASCADE, "department" varchar(60),
  "period" varchar(7) NOT NULL, "metric" varchar(60) NOT NULL, "target" numeric(16,2) NOT NULL,
  "completed" numeric(16,2) NOT NULL DEFAULT 0, "reward_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'active', "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "employee_evaluations" (
  "id" serial PRIMARY KEY, "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "evaluator_id" integer REFERENCES "staff"("id") ON DELETE SET NULL, "evaluator_name" text NOT NULL DEFAULT '', "period" varchar(7) NOT NULL,
  "discipline" integer NOT NULL DEFAULT 0, "communication" integer NOT NULL DEFAULT 0, "leadership" integer NOT NULL DEFAULT 0,
  "quality" integer NOT NULL DEFAULT 0, "responsibility" integer NOT NULL DEFAULT 0, "speed" integer NOT NULL DEFAULT 0, "innovation" integer NOT NULL DEFAULT 0,
  "comments" text, "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "employee_career_history" (
  "id" serial PRIMARY KEY, "staff_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "title" varchar(100) NOT NULL, "level" varchar(60) NOT NULL DEFAULT 'worker', "effective_date" date NOT NULL,
  "notes" text, "created_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "customer_employee_ratings" (
  "id" serial PRIMARY KEY, "token" varchar(80) NOT NULL UNIQUE, "staff_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "source_type" varchar(40) NOT NULL, "source_id" integer NOT NULL, "quality" integer, "speed" integer,
  "behavior" integer, "professionalism" integer, "overall" integer, "message" text, "submitted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
