CREATE TABLE IF NOT EXISTS "daily_cash_reports" (
  "id" serial PRIMARY KEY,
  "report_date" date NOT NULL,
  "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
  "total_sales" numeric(14,2) NOT NULL DEFAULT 0,
  "total_expenses" numeric(14,2) NOT NULL DEFAULT 0,
  "closing_balance" numeric(14,2) NOT NULL DEFAULT 0,
  "notes" text,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "updated_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_reports_report_date_idx"
  ON "daily_cash_reports" ("report_date");
CREATE INDEX IF NOT EXISTS "daily_cash_reports_created_by_idx"
  ON "daily_cash_reports" ("created_by");
CREATE INDEX IF NOT EXISTS "daily_cash_reports_updated_at_idx"
  ON "daily_cash_reports" ("updated_at");

CREATE TABLE IF NOT EXISTS "daily_cash_reconciliations" (
  "id" serial PRIMARY KEY,
  "report_date" date NOT NULL,
  "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
  "total_sales" numeric(14,2) NOT NULL DEFAULT 0,
  "total_expenses" numeric(14,2) NOT NULL DEFAULT 0,
  "expected_cash_balance" numeric(14,2) NOT NULL DEFAULT 0,
  "actual_cash_in_drawer" numeric(14,2) NOT NULL DEFAULT 0,
  "difference" numeric(14,2) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'balanced',
  "notes" text,
  "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "updated_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_reconciliations_report_date_idx"
  ON "daily_cash_reconciliations" ("report_date");
CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_status_idx"
  ON "daily_cash_reconciliations" ("status");
CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_created_by_idx"
  ON "daily_cash_reconciliations" ("created_by");
CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_updated_at_idx"
  ON "daily_cash_reconciliations" ("updated_at");
