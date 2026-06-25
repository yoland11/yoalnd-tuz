-- Harden accounting voucher saves for databases that missed later finance columns.
-- This is additive only: no data is deleted or rewritten.

ALTER TABLE "receipt_vouchers"
  ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed',
  ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;

ALTER TABLE "payment_vouchers"
  ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed',
  ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;

CREATE INDEX IF NOT EXISTS "receipt_vouchers_approval_status_idx"
  ON "receipt_vouchers" ("approval_status");

CREATE INDEX IF NOT EXISTS "receipt_vouchers_financial_transaction_id_idx"
  ON "receipt_vouchers" ("financial_transaction_id");

CREATE INDEX IF NOT EXISTS "payment_vouchers_approval_status_idx"
  ON "payment_vouchers" ("approval_status");

CREATE INDEX IF NOT EXISTS "payment_vouchers_financial_transaction_id_idx"
  ON "payment_vouchers" ("financial_transaction_id");
