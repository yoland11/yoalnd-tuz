-- Receipt allocations are posted only when the linked financial transaction is
-- executed.  This keeps pending vouchers out of receivables and booking paid
-- balances, while preserving a reviewable allocation plan.
CREATE TABLE IF NOT EXISTS "receipt_voucher_allocations" (
  "id" serial PRIMARY KEY,
  "receipt_voucher_id" integer NOT NULL REFERENCES "receipt_vouchers" ("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers" ("id"),
  "source_type" varchar(40) NOT NULL,
  "source_id" integer,
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "posted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CHECK (("source_type" = 'customer_credit' AND "source_id" IS NULL) OR ("source_type" <> 'customer_credit' AND "source_id" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipt_voucher_allocations_source_unique"
  ON "receipt_voucher_allocations" ("receipt_voucher_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "receipt_voucher_allocations_credit_unique"
  ON "receipt_voucher_allocations" ("receipt_voucher_id")
  WHERE "source_type" = 'customer_credit';
CREATE INDEX IF NOT EXISTS "receipt_voucher_allocations_customer_idx"
  ON "receipt_voucher_allocations" ("customer_id", "posted_at");
CREATE INDEX IF NOT EXISTS "receipt_voucher_allocations_source_idx"
  ON "receipt_voucher_allocations" ("source_type", "source_id", "posted_at");
