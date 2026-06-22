-- 0031 Financial transaction reversal / adjustment linkage (additive, no deletes).
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_transaction_id" integer;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversal_txn_id" integer;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversal_reason" text;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_by" integer;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_by_name" text;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp;

-- Source markers (store order / service order / sales invoice) — never deleted, excluded from net revenue.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
