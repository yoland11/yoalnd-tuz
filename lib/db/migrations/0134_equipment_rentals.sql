-- Isolated additive extension of the original rental/product authorities.
-- No existing rental, payment, stock or customer values are rewritten.
ALTER TABLE products ADD COLUMN IF NOT EXISTS rental_settings jsonb;
ALTER TABLE rental_orders ADD COLUMN IF NOT EXISTS rental_kind varchar(20) NOT NULL DEFAULT 'product';
ALTER TABLE rental_orders ADD COLUMN IF NOT EXISTS equipment_details jsonb;
CREATE INDEX IF NOT EXISTS rental_orders_equipment_period_idx ON rental_orders (rental_kind, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS rental_orders_equipment_customer_idx ON rental_orders (customer_id, rental_kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS rental_orders_equipment_create_request_idx
  ON rental_orders ((equipment_details->>'createRequestId'))
  WHERE rental_kind = 'equipment' AND equipment_details->>'createRequestId' IS NOT NULL;
CREATE INDEX IF NOT EXISTS rental_orders_equipment_linked_booking_idx
  ON rental_orders ((equipment_details->'linkedBooking'->>'source'), (equipment_details->'linkedBooking'->>'id'))
  WHERE rental_kind = 'equipment';
-- Refundable deposits belong to a liability account, never operating revenue.
INSERT INTO financial_accounts(code, name_ar, account_type, department, is_system, is_active)
VALUES ('ER-DEPOSIT', 'تأمينات إيجار مستردة', 'liability', 'rentals', true, true)
ON CONFLICT (code) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS equipment_rental_number_seq;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rental_order_id integer REFERENCES rental_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_rental_order_idx ON expenses(rental_order_id) WHERE rental_order_id IS NOT NULL;
