-- AJN employee financial accounts. Additive only; no historical rows are changed.
CREATE TABLE IF NOT EXISTS employee_finance_entries (
  id serial PRIMARY KEY, entry_no varchar(50) NOT NULL UNIQUE,
  employee_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  entry_type varchar(50) NOT NULL, direction varchar(24) NOT NULL,
  entry_date date NOT NULL, amount numeric(16,2) NOT NULL,
  settled_amount numeric(16,2) NOT NULL DEFAULT 0, remaining_amount numeric(16,2) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending', category varchar(100), description text NOT NULL, notes text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb, source_type varchar(60), source_id varchar(80),
  supplier_id integer REFERENCES suppliers(id) ON DELETE SET NULL, invoice_no varchar(120),
  submitted_by integer REFERENCES staff(id) ON DELETE SET NULL, submitted_by_name text NOT NULL DEFAULT '',
  approved_by integer REFERENCES staff(id) ON DELETE SET NULL, approved_by_name text NOT NULL DEFAULT '', approved_at timestamp,
  rejected_by integer REFERENCES staff(id) ON DELETE SET NULL, rejected_at timestamp, rejection_reason text,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_finance_entries_employee_idx ON employee_finance_entries(employee_id, entry_date);
CREATE INDEX IF NOT EXISTS employee_finance_entries_status_idx ON employee_finance_entries(status, direction);
CREATE UNIQUE INDEX IF NOT EXISTS employee_finance_entries_source_unique_idx ON employee_finance_entries(source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_finance_settlements (
  id serial PRIMARY KEY, entry_id integer NOT NULL REFERENCES employee_finance_entries(id) ON DELETE RESTRICT,
  settlement_type varchar(30) NOT NULL, amount numeric(16,2) NOT NULL, settlement_date date NOT NULL,
  payment_method varchar(20), notes text, financial_transaction_id integer REFERENCES financial_transactions(id) ON DELETE RESTRICT,
  payroll_line_id integer REFERENCES payroll_lines(id) ON DELETE RESTRICT,
  idempotency_key varchar(180) NOT NULL UNIQUE, created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_finance_settlements_entry_idx ON employee_finance_settlements(entry_id, settlement_date);
CREATE INDEX IF NOT EXISTS employee_finance_settlements_salary_idx ON employee_finance_settlements(payroll_line_id) WHERE payroll_line_id IS NOT NULL;
