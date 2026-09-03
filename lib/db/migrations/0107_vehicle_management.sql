-- AJN vehicle management: additive metadata, maintenance and immutable odometer history.
ALTER TABLE fleet_vehicles
  ADD COLUMN IF NOT EXISTS manufacturer varchar(100),
  ADD COLUMN IF NOT EXISTS model varchar(100),
  ADD COLUMN IF NOT EXISTS manufacture_year integer,
  ADD COLUMN IF NOT EXISTS color varchar(60),
  ADD COLUMN IF NOT EXISTS vehicle_type varchar(40),
  ADD COLUMN IF NOT EXISTS vin varchar(80),
  ADD COLUMN IF NOT EXISTS default_driver_id integer REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odometer_km integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_url text;
CREATE INDEX IF NOT EXISTS fleet_vehicles_default_driver_idx ON fleet_vehicles (default_driver_id);

ALTER TABLE vehicle_expenses
  ADD COLUMN IF NOT EXISTS driver_id integer REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odometer_km integer;

CREATE TABLE IF NOT EXISTS vehicle_maintenance_records (
  id serial PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES fleet_vehicles(id) ON DELETE RESTRICT,
  maintenance_type varchar(50) NOT NULL,
  maintenance_date date NOT NULL,
  odometer_km integer,
  cost numeric(16,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  workshop_vendor text,
  description text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_maintenance_date date,
  next_maintenance_odometer integer,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_date_idx ON vehicle_maintenance_records (vehicle_id, maintenance_date);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_next_date_idx ON vehicle_maintenance_records (next_maintenance_date);

CREATE TABLE IF NOT EXISTS vehicle_odometer_history (
  id serial PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES fleet_vehicles(id) ON DELETE RESTRICT,
  previous_km integer NOT NULL,
  new_km integer NOT NULL,
  source varchar(40) NOT NULL,
  note text,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (previous_km >= 0 AND new_km >= 0)
);
CREATE INDEX IF NOT EXISTS vehicle_odometer_vehicle_date_idx ON vehicle_odometer_history (vehicle_id, created_at);
