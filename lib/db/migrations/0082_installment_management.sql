-- Optional installment plans. This migration is additive and never converts an
-- existing invoice automatically. Only a manually created contract is linked.
CREATE TABLE IF NOT EXISTS installment_contracts (
  id serial PRIMARY KEY,
  contract_no varchar(48) NOT NULL UNIQUE,
  public_token varchar(96) NOT NULL UNIQUE,
  source_type varchar(50) NOT NULL DEFAULT 'sales_invoice',
  source_id integer NOT NULL,
  sales_invoice_id integer REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT '', customer_phone varchar(30), department varchar(50) NOT NULL DEFAULT 'general',
  original_total numeric(14,2) NOT NULL DEFAULT 0, paid_before_conversion numeric(14,2) NOT NULL DEFAULT 0,
  balance_at_conversion numeric(14,2) NOT NULL DEFAULT 0, down_payment_amount numeric(14,2) NOT NULL DEFAULT 0,
  financed_amount numeric(14,2) NOT NULL DEFAULT 0, scheduled_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  collected_amount numeric(14,2) NOT NULL DEFAULT 0, remaining_amount numeric(14,2) NOT NULL DEFAULT 0,
  installment_count integer NOT NULL DEFAULT 1, frequency varchar(24) NOT NULL DEFAULT 'monthly', installment_type varchar(24) NOT NULL DEFAULT 'fixed',
  first_due_date date, last_due_date date, grace_days integer NOT NULL DEFAULT 0, reminder_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(24) NOT NULL DEFAULT 'active', internal_notes text, customer_notes text,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL, created_by_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), cancelled_at timestamp, cancelled_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS installment_contracts_active_source_idx ON installment_contracts(source_type, source_id) WHERE status IN ('draft','active','paused','overdue');
CREATE INDEX IF NOT EXISTS installment_contracts_customer_idx ON installment_contracts(customer_id, status);

CREATE TABLE IF NOT EXISTS installment_schedule (
  id serial PRIMARY KEY, contract_id integer NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT,
  installment_no integer NOT NULL, due_date date NOT NULL, original_amount numeric(14,2) NOT NULL, paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(14,2) NOT NULL, status varchar(24) NOT NULL DEFAULT 'upcoming', days_overdue integer NOT NULL DEFAULT 0,
  payment_method varchar(30), receipt_number varchar(100), receipt_image text, notes text, last_reminder_at timestamp, paid_at timestamp,
  is_cancelled boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(contract_id, installment_no)
);
CREATE INDEX IF NOT EXISTS installment_schedule_due_idx ON installment_schedule(due_date, status);

CREATE TABLE IF NOT EXISTS installment_payments (
  id serial PRIMARY KEY, payment_no varchar(48) NOT NULL UNIQUE, idempotency_key varchar(120) NOT NULL UNIQUE,
  contract_id integer NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT, amount numeric(14,2) NOT NULL, payment_method varchar(30) NOT NULL,
  receipt_number varchar(100), receipt_image text, paid_at timestamp NOT NULL DEFAULT now(), notes text,
  status varchar(20) NOT NULL DEFAULT 'posted', financial_transaction_id integer REFERENCES financial_transactions(id) ON DELETE SET NULL,
  received_by integer REFERENCES staff(id) ON DELETE SET NULL, received_by_name text NOT NULL DEFAULT '', reversed_at timestamp, reversal_reason text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS installment_payment_allocations (
  id serial PRIMARY KEY, payment_id integer NOT NULL REFERENCES installment_payments(id) ON DELETE RESTRICT,
  installment_id integer NOT NULL REFERENCES installment_schedule(id) ON DELETE RESTRICT, amount numeric(14,2) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(), UNIQUE(payment_id, installment_id)
);
CREATE TABLE IF NOT EXISTS installment_history (
  id serial PRIMARY KEY, contract_id integer NOT NULL REFERENCES installment_contracts(id) ON DELETE RESTRICT,
  installment_id integer REFERENCES installment_schedule(id) ON DELETE SET NULL, action varchar(50) NOT NULL, old_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_value jsonb NOT NULL DEFAULT '{}'::jsonb, reason text, actor_id integer REFERENCES staff(id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now()
);
