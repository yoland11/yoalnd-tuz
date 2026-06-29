-- Link payment vouchers to existing customers for safe name/phone lookup.
-- Additive only; historical vouchers remain valid with a NULL customer_id.

ALTER TABLE "payment_vouchers"
  ADD COLUMN IF NOT EXISTS "customer_id" integer
  REFERENCES "customers" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "payment_vouchers_customer_id_idx"
  ON "payment_vouchers" ("customer_id");
