-- Private Bride Dashboard support. This is additive: it does not alter or
-- duplicate bookings, invoices, payments, accounting records, or customers.
CREATE TABLE IF NOT EXISTS bride_dashboard_requests (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE RESTRICT,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  request_type varchar(40) NOT NULL,
  department varchar(40) NOT NULL DEFAULT 'support',
  body text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'new',
  task_id integer REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bride_dashboard_requests_customer_idx
  ON bride_dashboard_requests(customer_id, created_at DESC);

-- A wedding owner can optionally invite a linked family customer. Access is
-- still restricted to the exact booking, and the customer session is checked
-- server-side for every request.
CREATE TABLE IF NOT EXISTS wedding_workspace_members (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role varchar(24) NOT NULL DEFAULT 'family',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(booking_id, customer_id)
);
CREATE INDEX IF NOT EXISTS wedding_workspace_members_customer_idx
  ON wedding_workspace_members(customer_id, booking_id);

CREATE TABLE IF NOT EXISTS wedding_workspace_items (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  kind varchar(32) NOT NULL,
  title text NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'pending',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wedding_workspace_items_booking_idx
  ON wedding_workspace_items(booking_id, kind, updated_at DESC);
