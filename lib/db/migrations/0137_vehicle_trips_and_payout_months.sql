-- 1) Standalone transport jobs added from the vehicles page («إضافة نقل»): a trip
--    for an outside customer or the shop, not tied to a booking. Its fee counts as
--    the vehicle's income by trip date; the money is collected as an ordinary
--    main-cash request (source_type 'vehicle_trip') that waits for approval.
-- 2) Which month each partner payout pays (source_type 'vehicle_partner_share').
--    The amount stays only on the financial transaction; this row adds the month.
-- Additive only: two new tables, their checks, foreign keys and indexes.
-- No existing table or row is changed.

CREATE TABLE IF NOT EXISTS "vehicle_trips" (
  "id" serial PRIMARY KEY,
  "vehicle_id" integer NOT NULL REFERENCES "fleet_vehicles" ("id") ON DELETE RESTRICT,
  "trip_date" date NOT NULL,
  "customer_name" text NOT NULL,
  "customer_phone" varchar(30),
  "origin" text,
  "destination" text,
  "driver_id" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
  "fee" numeric(14, 2) NOT NULL,
  "notes" text,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "idempotency_key" varchar(160) NOT NULL,
  "created_by" integer,
  "created_by_name" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vehicle_trips_fee_check" CHECK ("fee" > 0),
  CONSTRAINT "vehicle_trips_status_check" CHECK ("status" IN ('active', 'cancelled')),
  CONSTRAINT "vehicle_trips_name_check" CHECK (length(btrim("customer_name")) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_trips_idempotency_idx"
  ON "vehicle_trips" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "vehicle_trips_vehicle_date_idx"
  ON "vehicle_trips" ("vehicle_id", "trip_date");

CREATE TABLE IF NOT EXISTS "vehicle_partner_payout_months" (
  "financial_transaction_id" integer PRIMARY KEY REFERENCES "financial_transactions" ("id") ON DELETE RESTRICT,
  "vehicle_id" integer NOT NULL REFERENCES "fleet_vehicles" ("id") ON DELETE RESTRICT,
  "share_month" date NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vehicle_partner_payout_months_month_check" CHECK (EXTRACT(DAY FROM "share_month") = 1)
);

CREATE INDEX IF NOT EXISTS "vehicle_partner_payout_months_vehicle_idx"
  ON "vehicle_partner_payout_months" ("vehicle_id", "share_month");
