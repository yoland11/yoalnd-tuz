-- AJN vehicle transportation profitability: additive only.
-- Existing bookings remain untouched: a NULL transportation_mode means the
-- legacy booking has no declared AJN transportation service.

ALTER TABLE kosha_bookings
  ADD COLUMN IF NOT EXISTS transportation_mode varchar(24),
  ADD COLUMN IF NOT EXISTS transportation_fee numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transportation_vehicle_id integer REFERENCES fleet_vehicles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS transportation_driver_id integer REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transportation_notes text;

CREATE INDEX IF NOT EXISTS kosha_bookings_transportation_vehicle_idx
  ON kosha_bookings (transportation_vehicle_id, event_date)
  WHERE transportation_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kosha_bookings_transportation_mode_idx
  ON kosha_bookings (transportation_mode)
  WHERE transportation_mode IS NOT NULL;

CREATE TABLE IF NOT EXISTS vehicle_expenses (
  id serial PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES fleet_vehicles(id) ON DELETE RESTRICT,
  booking_id integer REFERENCES kosha_bookings(id) ON DELETE RESTRICT,
  expense_type varchar(40) NOT NULL,
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  expense_date timestamp NOT NULL DEFAULT now(),
  cash_account_code varchar(30) NOT NULL DEFAULT 'MASTER',
  payment_method varchar(20) NOT NULL DEFAULT 'cash',
  description text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(24) NOT NULL DEFAULT 'pending',
  idempotency_key varchar(180) NOT NULL UNIQUE,
  financial_transaction_id integer UNIQUE REFERENCES financial_transactions(id) ON DELETE RESTRICT,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',
  reversed_at timestamp,
  reversal_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_expenses_vehicle_date_idx ON vehicle_expenses (vehicle_id, expense_date);
CREATE INDEX IF NOT EXISTS vehicle_expenses_booking_idx ON vehicle_expenses (booking_id);
CREATE INDEX IF NOT EXISTS vehicle_expenses_status_idx ON vehicle_expenses (status, expense_date);
