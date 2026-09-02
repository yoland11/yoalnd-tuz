-- AJN loans liability actions: additive only. Existing loans and financial history are preserved.
ALTER TABLE company_loans
  ADD COLUMN IF NOT EXISTS agreement_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE company_loan_repayments
  ADD COLUMN IF NOT EXISTS cash_account_code varchar(30),
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(180);

CREATE UNIQUE INDEX IF NOT EXISTS company_loan_repayments_idempotency_key_idx
  ON company_loan_repayments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
