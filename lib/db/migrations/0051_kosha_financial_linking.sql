-- Unify Kosha booking/customer and collection financial references.
-- Additive and idempotent: legacy rows are retained and backfilled only when
-- their normalized phone uniquely identifies a customer.
ALTER TABLE "kosha_bookings"
  ADD COLUMN IF NOT EXISTS "customer_id" integer
  REFERENCES "customers" ("id") ON DELETE SET NULL;

ALTER TABLE "kosha_payment_requests"
  ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;

ALTER TABLE "receipt_vouchers"
  ADD COLUMN IF NOT EXISTS "kosha_booking_id" integer
  REFERENCES "kosha_bookings" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "kosha_bookings_customer_id_idx"
  ON "kosha_bookings" ("customer_id");
CREATE INDEX IF NOT EXISTS "kosha_payment_requests_financial_idx"
  ON "kosha_payment_requests" ("financial_transaction_id");
CREATE INDEX IF NOT EXISTS "receipt_vouchers_kosha_booking_idx"
  ON "receipt_vouchers" ("kosha_booking_id");

UPDATE "kosha_bookings" b
SET "customer_id" = c.id
FROM "customers" c
WHERE b."customer_id" IS NULL
  AND regexp_replace(coalesce(b."phone", ''), '[^0-9]', '', 'g') <> ''
  AND regexp_replace(coalesce(c."phone", ''), '[^0-9]', '', 'g') =
      regexp_replace(coalesce(b."phone", ''), '[^0-9]', '', 'g');
