-- AJN company loans: additive only.  No existing financial records are changed.
CREATE TABLE IF NOT EXISTS company_loans (
  id serial PRIMARY KEY,
  loan_no varchar(50) NOT NULL UNIQUE,
  lender_name text NOT NULL,
  lender_phone varchar(30),
  original_amount numeric(16,2) NOT NULL,
  total_repaid numeric(16,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(16,2) NOT NULL,
  received_date date NOT NULL,
  payment_method varchar(20) NOT NULL DEFAULT 'cash',
  reference_no varchar(120),
  notes text,
  status varchar(24) NOT NULL DEFAULT 'pending',
  receipt_transaction_id integer,
  created_by integer,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_loans_status_idx ON company_loans(status, received_date);
CREATE INDEX IF NOT EXISTS company_loans_lender_idx ON company_loans(lender_name);

CREATE TABLE IF NOT EXISTS company_loan_repayments (
  id serial PRIMARY KEY,
  loan_id integer NOT NULL REFERENCES company_loans(id) ON DELETE RESTRICT,
  repayment_no varchar(50) NOT NULL UNIQUE,
  payment_date date NOT NULL,
  amount numeric(16,2) NOT NULL,
  payment_method varchar(20) NOT NULL DEFAULT 'cash',
  reference_no varchar(120),
  notes text,
  status varchar(24) NOT NULL DEFAULT 'pending',
  financial_transaction_id integer,
  created_by integer,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_loan_repayments_loan_idx ON company_loan_repayments(loan_id, payment_date);
