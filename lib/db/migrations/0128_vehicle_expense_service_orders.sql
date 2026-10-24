-- Vehicle expenses may belong to a service order's AJN transport trip (the booking
-- centre's «خدمة النقل»), as they already may to a kosha booking.
-- Additive only: one nullable column, its foreign key, an index, and a check that
-- one expense is never linked to both kinds of booking. Existing rows keep NULL.

ALTER TABLE "vehicle_expenses"
  ADD COLUMN IF NOT EXISTS "service_order_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_expenses_service_order_id_fkey' AND conrelid = 'vehicle_expenses'::regclass
  ) THEN
    ALTER TABLE "vehicle_expenses"
      ADD CONSTRAINT "vehicle_expenses_service_order_id_fkey"
      FOREIGN KEY ("service_order_id") REFERENCES "service_orders" ("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_expenses_single_booking_check' AND conrelid = 'vehicle_expenses'::regclass
  ) THEN
    ALTER TABLE "vehicle_expenses"
      ADD CONSTRAINT "vehicle_expenses_single_booking_check"
      CHECK ("booking_id" IS NULL OR "service_order_id" IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "vehicle_expenses_service_order_idx"
  ON "vehicle_expenses" ("service_order_id");
