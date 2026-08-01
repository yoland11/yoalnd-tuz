-- AJN Class Representatives Portal.  Additive only: no legacy student,
-- customer, order, payment, cash-box, or accounting rows are modified.
CREATE TABLE IF NOT EXISTS representative_group_assignments (
  id serial PRIMARY KEY,
  staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(staff_id, group_id)
);

CREATE TABLE IF NOT EXISTS representative_payment_requests (
  id serial PRIMARY KEY,
  group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE RESTRICT,
  graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method varchar(30) NOT NULL,
  receipt_number varchar(100),
  receipt_image text,
  occurred_at timestamp NOT NULL DEFAULT now(),
  notes text,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','approved','rejected','cancelled')),
  representative_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  representative_name text NOT NULL DEFAULT '',
  approved_by integer REFERENCES staff(id) ON DELETE SET NULL,
  approved_at timestamp,
  rejection_note text,
  posted_payment_id integer REFERENCES graduation_student_payments(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS representative_payment_requests_group_idx ON representative_payment_requests(group_id, status);
CREATE INDEX IF NOT EXISTS representative_payment_requests_representative_idx ON representative_payment_requests(representative_id, status);

CREATE TABLE IF NOT EXISTS representative_custody_handovers (
  id serial PRIMARY KEY,
  representative_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_image text,
  notes text,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','cancelled')),
  confirmed_by integer REFERENCES staff(id) ON DELETE SET NULL,
  confirmed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS representative_issues (
  id serial PRIMARY KEY,
  group_id integer NOT NULL REFERENCES graduation_groups(id) ON DELETE CASCADE,
  graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  priority varchar(20) NOT NULL DEFAULT 'medium',
  status varchar(20) NOT NULL DEFAULT 'open',
  notes text NOT NULL,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  reporter_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  assigned_to integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
