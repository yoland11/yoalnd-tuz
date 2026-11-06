-- Simple vehicle profit split: the company and one partner share a vehicle.
-- Each row says "from this month on, this partner takes this share of the
-- vehicle's net"; it lasts until the vehicle's next row. A share of 0 ends the
-- partnership from that month. Payouts are ordinary main-cash requests
-- (source_type 'vehicle_partner_share'), so no payout table is needed.
-- Additive only: one new table, its checks, foreign key and unique index.
-- No existing table or row is changed.

CREATE TABLE IF NOT EXISTS "vehicle_partners" (
  "id" serial PRIMARY KEY,
  "vehicle_id" integer NOT NULL REFERENCES "fleet_vehicles" ("id") ON DELETE RESTRICT,
  "partner_name" text NOT NULL,
  "partner_phone" varchar(30),
  "share_basis_points" integer NOT NULL,
  "starts_month" date NOT NULL,
  "created_by" integer,
  "created_by_name" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vehicle_partners_share_check" CHECK ("share_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "vehicle_partners_month_check" CHECK (EXTRACT(DAY FROM "starts_month") = 1),
  CONSTRAINT "vehicle_partners_name_check" CHECK (length(btrim("partner_name")) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_partners_vehicle_month_idx"
  ON "vehicle_partners" ("vehicle_id", "starts_month");
