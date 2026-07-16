-- Additive metadata for the unified financial voucher register. Existing rows
-- stay valid and retain their immutable posting/audit history.
ALTER TABLE IF EXISTS "financial_transactions"
  ADD COLUMN IF NOT EXISTS "reference_no" varchar(120);

CREATE INDEX IF NOT EXISTS "financial_transactions_reference_no_idx"
  ON "financial_transactions" ("reference_no");
