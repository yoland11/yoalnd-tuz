-- AJN Master Cash Box: additive, idempotent migration. Existing finance data is preserved.
CREATE TABLE IF NOT EXISTS "master_cash_box" (
  "id" serial PRIMARY KEY,
  "code" varchar(30) NOT NULL DEFAULT 'MASTER',
  "name" text NOT NULL DEFAULT 'الصندوق الرئيسي',
  "opening_balance" numeric(16,2) NOT NULL DEFAULT 0,
  "current_balance" numeric(16,2) NOT NULL DEFAULT 0,
  "total_revenue" numeric(16,2) NOT NULL DEFAULT 0,
  "total_expenses" numeric(16,2) NOT NULL DEFAULT 0,
  "net_profit" numeric(16,2) NOT NULL DEFAULT 0,
  "available_balance" numeric(16,2) NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 0,
  "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "updated_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "master_cash_box_code_idx" ON "master_cash_box" ("code");

CREATE TABLE IF NOT EXISTS "financial_accounts" (
  "id" serial PRIMARY KEY,
  "code" varchar(30) NOT NULL,
  "name_ar" text NOT NULL,
  "account_type" varchar(20) NOT NULL,
  "department" varchar(40),
  "is_system" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "financial_accounts_code_idx" ON "financial_accounts" ("code");
CREATE INDEX IF NOT EXISTS "financial_accounts_type_idx" ON "financial_accounts" ("account_type");
CREATE INDEX IF NOT EXISTS "financial_accounts_department_idx" ON "financial_accounts" ("department");

CREATE TABLE IF NOT EXISTS "financial_transactions" (
  "id" serial PRIMARY KEY,
  "transaction_no" varchar(50) NOT NULL,
  "transaction_date" date NOT NULL,
  "transaction_time" timestamp NOT NULL DEFAULT now(),
  "direction" varchar(20) NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "department" varchar(40) NOT NULL DEFAULT 'general',
  "transaction_type" varchar(60) NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
  "source_type" varchar(60),
  "source_id" varchar(80),
  "source_event" varchar(60) NOT NULL DEFAULT 'primary',
  "idempotency_key" varchar(180) NOT NULL,
  "approval_status" varchar(20) NOT NULL DEFAULT 'draft',
  "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "submitted_at" timestamp,
  "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "approved_by_name" text NOT NULL DEFAULT '',
  "approved_at" timestamp,
  "rejected_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "rejected_by_name" text NOT NULL DEFAULT '',
  "rejected_at" timestamp,
  "rejection_reason" text,
  "executed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "executed_by_name" text NOT NULL DEFAULT '',
  "executed_at" timestamp,
  "balance_before" numeric(16,2),
  "balance_after" numeric(16,2),
  "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL,
  "customer_name" text,
  "customer_phone" varchar(30),
  "due_date" date,
  "inventory_item_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
  "responsible_user_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "responsible_user_name" text,
  "notes" text,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "financial_transactions_direction_chk" CHECK ("direction" IN ('revenue','expense')),
  CONSTRAINT "financial_transactions_amount_chk" CHECK ("amount" > 0),
  CONSTRAINT "financial_transactions_status_chk" CHECK ("approval_status" IN ('draft','pending','approved','rejected','executed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_no_idx" ON "financial_transactions" ("transaction_no");
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_idempotency_idx" ON "financial_transactions" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "financial_transactions_date_idx" ON "financial_transactions" ("transaction_date");
CREATE INDEX IF NOT EXISTS "financial_transactions_status_idx" ON "financial_transactions" ("approval_status");
CREATE INDEX IF NOT EXISTS "financial_transactions_department_idx" ON "financial_transactions" ("department");
CREATE INDEX IF NOT EXISTS "financial_transactions_direction_idx" ON "financial_transactions" ("direction");
CREATE INDEX IF NOT EXISTS "financial_transactions_source_idx" ON "financial_transactions" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "financial_transactions_customer_idx" ON "financial_transactions" ("customer_id");
CREATE INDEX IF NOT EXISTS "financial_transactions_due_date_idx" ON "financial_transactions" ("due_date");

CREATE TABLE IF NOT EXISTS "financial_ledger_entries" (
  "id" serial PRIMARY KEY,
  "transaction_id" integer NOT NULL REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
  "account_id" integer NOT NULL REFERENCES "financial_accounts"("id") ON DELETE RESTRICT,
  "entry_side" varchar(10) NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "financial_ledger_entry_side_chk" CHECK ("entry_side" IN ('debit','credit')),
  CONSTRAINT "financial_ledger_entry_amount_chk" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_transaction_idx" ON "financial_ledger_entries" ("transaction_id");
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_account_idx" ON "financial_ledger_entries" ("account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "financial_ledger_entries_unique_idx" ON "financial_ledger_entries" ("transaction_id", "account_id", "entry_side");

CREATE TABLE IF NOT EXISTS "financial_audit_logs" (
  "id" serial PRIMARY KEY,
  "transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
  "action" varchar(60) NOT NULL,
  "actor_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "old_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "new_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reason" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "financial_audit_logs_transaction_idx" ON "financial_audit_logs" ("transaction_id");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_actor_idx" ON "financial_audit_logs" ("actor_id");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_created_at_idx" ON "financial_audit_logs" ("created_at");

INSERT INTO "master_cash_box" ("code", "name") VALUES ('MASTER', 'الصندوق الرئيسي')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "financial_accounts" ("code", "name_ar", "account_type", "department") VALUES
  ('1000', 'الصندوق الرئيسي', 'asset', NULL),
  ('4000', 'إيرادات عامة', 'revenue', 'general'),
  ('4010', 'إيرادات المتجر', 'revenue', 'store'),
  ('4020', 'إيرادات الكوشات', 'revenue', 'koshas'),
  ('4030', 'إيرادات التصوير', 'revenue', 'photography'),
  ('4040', 'إيرادات الصوتيات', 'revenue', 'audio'),
  ('4050', 'إيرادات الهدايا والتوزيعات', 'revenue', 'gifts'),
  ('5000', 'مصاريف عامة', 'expense', 'general'),
  ('5010', 'مصاريف المتجر', 'expense', 'store'),
  ('5020', 'مصاريف الكوشات', 'expense', 'koshas'),
  ('5030', 'مصاريف التصوير', 'expense', 'photography'),
  ('5040', 'مصاريف الصوتيات', 'expense', 'audio'),
  ('5050', 'مصاريف الهدايا والتوزيعات', 'expense', 'gifts'),
  ('5090', 'خسائر التلف والفقدان', 'expense', 'inventory')
ON CONFLICT ("code") DO NOTHING;

-- Preserve legacy records as already executed; new records can enter the approval workflow.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE SET NULL;
ALTER TABLE "receipt_vouchers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
ALTER TABLE "receipt_vouchers" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE SET NULL;
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE SET NULL;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "due_date" date;
ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "due_date" date;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "due_date" date;
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "total_amount" numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "remaining_amount" numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "payment_status" varchar(20) NOT NULL DEFAULT 'unpaid';
ALTER TABLE "kosha_bookings" ADD COLUMN IF NOT EXISTS "due_date" date;

CREATE INDEX IF NOT EXISTS "expenses_approval_status_idx" ON "expenses" ("approval_status");
CREATE INDEX IF NOT EXISTS "orders_due_date_idx" ON "orders" ("due_date");
CREATE INDEX IF NOT EXISTS "service_orders_due_date_idx" ON "service_orders" ("due_date");
CREATE INDEX IF NOT EXISTS "sales_invoices_due_date_idx" ON "sales_invoices" ("due_date");
CREATE INDEX IF NOT EXISTS "kosha_bookings_due_date_idx" ON "kosha_bookings" ("due_date");

CREATE OR REPLACE FUNCTION ajn_prevent_financial_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Financial records are immutable and cannot be deleted';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_transactions_no_delete') THEN
    CREATE TRIGGER financial_transactions_no_delete BEFORE DELETE ON financial_transactions
    FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_ledger_entries_no_delete') THEN
    CREATE TRIGGER financial_ledger_entries_no_delete BEFORE DELETE ON financial_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_audit_logs_no_delete') THEN
    CREATE TRIGGER financial_audit_logs_no_delete BEFORE DELETE ON financial_audit_logs
    FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
  END IF;
END $$;
