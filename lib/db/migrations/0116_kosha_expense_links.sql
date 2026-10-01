-- Extend AJN's existing expense record with optional Koshah cost-center context.
-- Existing expenses remain unclassified and keep their approval/transaction links.
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "cost_category" varchar(20),
  ADD COLUMN IF NOT EXISTS "kosha_id" integer REFERENCES "koshas"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "booking_id" integer REFERENCES "kosha_bookings"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "expense_type" varchar(40),
  ADD COLUMN IF NOT EXISTS "supplier_id" integer REFERENCES "suppliers"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "beneficiary_name" text,
  ADD COLUMN IF NOT EXISTS "responsible_employee_id" integer REFERENCES "staff"("id") ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_kosha_cost_category_check'
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_kosha_cost_category_check"
      CHECK ("cost_category" IS NULL OR "cost_category" IN ('investment', 'operating', 'booking'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_kosha_booking_category_check'
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_kosha_booking_category_check"
      CHECK ("cost_category" <> 'booking' OR "booking_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "expenses_kosha_category_idx"
  ON "expenses" ("kosha_id", "cost_category", "date");
CREATE INDEX IF NOT EXISTS "expenses_booking_idx"
  ON "expenses" ("booking_id");
