-- Additive Asset Sale module. Assets and all related histories remain immutable.
CREATE TABLE IF NOT EXISTS "asset_sales" (
  "id" serial PRIMARY KEY,
  "sale_no" varchar(50) NOT NULL,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL,
  "buyer_name" text NOT NULL,
  "buyer_phone" varchar(30),
  "sale_date" date NOT NULL,
  "purchase_cost" numeric(16,2) NOT NULL,
  "book_value" numeric(16,2) NOT NULL,
  "accumulated_depreciation" numeric(16,2) NOT NULL,
  "market_value" numeric(16,2),
  "sale_price" numeric(16,2) NOT NULL,
  "paid_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "receivable_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "profit_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "loss_amount" numeric(16,2) NOT NULL DEFAULT 0,
  "payment_method" varchar(20) NOT NULL,
  "collection_method" varchar(20),
  "financial_account_id" integer REFERENCES "financial_accounts"("id") ON DELETE RESTRICT,
  "payment_status" varchar(20) NOT NULL DEFAULT 'paid',
  "invoice_number" varchar(120),
  "reason" text NOT NULL,
  "notes" text,
  "disposal_reference" varchar(80) NOT NULL,
  "accounting_reference" varchar(80),
  "financial_transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
  "sold_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "sold_by_name" text NOT NULL DEFAULT '',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_sales_sale_no_idx" ON "asset_sales" ("sale_no");
CREATE UNIQUE INDEX IF NOT EXISTS "asset_sales_product_idx" ON "asset_sales" ("product_id");
CREATE INDEX IF NOT EXISTS "asset_sales_date_idx" ON "asset_sales" ("sale_date");
CREATE INDEX IF NOT EXISTS "asset_sales_buyer_idx" ON "asset_sales" ("buyer_phone");
CREATE INDEX IF NOT EXISTS "asset_sales_account_idx" ON "asset_sales" ("financial_account_id");

INSERT INTO "financial_accounts" ("code", "name_ar", "account_type", "department") VALUES
  ('1010', 'الحساب البنكي الرئيسي', 'asset', NULL),
  ('1500', 'الأصول الثابتة', 'asset', 'assets'),
  ('1590', 'مجمع إهلاك الأصول', 'contra_asset', 'assets'),
  ('4200', 'أرباح بيع الأصول', 'revenue', 'assets'),
  ('5200', 'خسائر بيع الأصول', 'expense', 'assets')
ON CONFLICT ("code") DO NOTHING;

CREATE OR REPLACE FUNCTION ajn_prevent_asset_sale_delete() RETURNS trigger AS $immutable$
BEGIN
  RAISE EXCEPTION 'Asset sale records are immutable and cannot be deleted';
END;
$immutable$ LANGUAGE plpgsql;

DO $triggers$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_sales_no_delete') THEN
    CREATE TRIGGER asset_sales_no_delete BEFORE DELETE ON asset_sales
    FOR EACH ROW EXECUTE FUNCTION ajn_prevent_asset_sale_delete();
  END IF;
END $triggers$;
