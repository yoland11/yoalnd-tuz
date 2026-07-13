-- Employee Advances: additive schema for employee advances and repayment history.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "department" varchar(60) NOT NULL DEFAULT 'general';
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "base_salary" numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "hired_at" date NOT NULL DEFAULT CURRENT_DATE;
CREATE TABLE IF NOT EXISTS "employee_advances" (
  "id" serial PRIMARY KEY,
  "advance_no" varchar(40) NOT NULL UNIQUE,
  "employee_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "request_date" date NOT NULL,
  "advance_type" varchar(30) NOT NULL DEFAULT 'salary_advance',
  "amount" numeric(16,2) NOT NULL,
  "repaid_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "remaining_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "monthly_deduction" numeric(16,2) NOT NULL DEFAULT 0,
  "reason" text NOT NULL DEFAULT '',
  "notes" text,
  "attachment_url" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "approved_by_name" text NOT NULL DEFAULT '',
  "approved_at" timestamp,
  "rejected_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "rejected_by_name" text NOT NULL DEFAULT '',
  "rejected_at" timestamp,
  "rejection_reason" text,
  "paid_at" timestamp,
  "due_date" date,
  "last_deduction_at" timestamp,
  "financial_transaction_id" integer,
  "payroll_reference" varchar(80),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "employee_advances_employee_idx" ON "employee_advances" ("employee_id", "created_at");
CREATE INDEX IF NOT EXISTS "employee_advances_status_idx" ON "employee_advances" ("status", "request_date");
CREATE TABLE IF NOT EXISTS "employee_advance_repayments" (
  "id" serial PRIMARY KEY,
  "advance_id" integer NOT NULL REFERENCES "employee_advances"("id") ON DELETE RESTRICT,
  "employee_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "payment_date" date NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "method" varchar(20) NOT NULL DEFAULT 'cash',
  "kind" varchar(20) NOT NULL DEFAULT 'manual',
  "notes" text,
  "payroll_reference" varchar(80),
  "financial_transaction_id" integer,
  "received_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "received_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "employee_advance_repayments_advance_idx" ON "employee_advance_repayments" ("advance_id", "payment_date");
CREATE TABLE IF NOT EXISTS "employee_advance_settings" (
  "id" serial PRIMARY KEY,
  "max_advance_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "max_salary_percentage" numeric(5,2) NOT NULL DEFAULT 100,
  "max_active_advances" integer NOT NULL DEFAULT 1,
  "minimum_employment_days" integer NOT NULL DEFAULT 0,
  "manager_approval_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
