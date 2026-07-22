-- Historical sales-invoice receivable repair support.
-- Additive only: no invoice, payment, stock movement, or financial transaction
-- is deleted or reposted by this migration.

CREATE TABLE IF NOT EXISTS customer_receivable_ledger (
  id serial PRIMARY KEY,
  idempotency_key varchar(180) NOT NULL,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_id integer NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  invoice_number varchar(40) NOT NULL,
  invoice_date date NOT NULL,
  source_type varchar(60) NOT NULL DEFAULT 'sales_invoice',
  entry_type varchar(80) NOT NULL DEFAULT 'sales_invoice_historical_backfill',
  invoice_total numeric(16,2) NOT NULL,
  valid_payments numeric(16,2) NOT NULL DEFAULT 0,
  returns_amount numeric(16,2) NOT NULL DEFAULT 0,
  credit_notes_amount numeric(16,2) NOT NULL DEFAULT 0,
  adjustments_amount numeric(16,2) NOT NULL DEFAULT 0,
  debit_amount numeric(16,2) NOT NULL DEFAULT 0,
  credit_amount numeric(16,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(16,2) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'open',
  batch_id varchar(80) NOT NULL,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text NOT NULL DEFAULT 'system_backfill',
  backfill_version varchar(40) NOT NULL,
  backfilled_at timestamp NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT customer_receivable_ledger_amounts_chk CHECK (
    invoice_total >= 0 AND valid_payments >= 0 AND returns_amount >= 0
    AND credit_notes_amount >= 0 AND adjustments_amount >= 0
    AND debit_amount >= 0 AND credit_amount >= 0 AND remaining_amount >= 0
  ),
  CONSTRAINT customer_receivable_ledger_status_chk CHECK (status IN ('open', 'paid', 'review'))
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_receivable_ledger_idempotency_idx
  ON customer_receivable_ledger(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS customer_receivable_ledger_invoice_source_idx
  ON customer_receivable_ledger(invoice_id, customer_id, source_type);
CREATE INDEX IF NOT EXISTS customer_receivable_ledger_customer_status_idx
  ON customer_receivable_ledger(customer_id, status, invoice_date DESC);

CREATE TABLE IF NOT EXISTS customer_balance_repair_batches (
  id serial PRIMARY KEY,
  batch_id varchar(80) NOT NULL,
  mode varchar(20) NOT NULL,
  backfill_version varchar(40) NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'running',
  executed_by integer REFERENCES staff(id) ON DELETE SET NULL,
  executed_by_name text NOT NULL DEFAULT 'system_backfill',
  started_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_balance_repair_batches_batch_id_idx
  ON customer_balance_repair_batches(batch_id);

CREATE TABLE IF NOT EXISTS customer_balance_repair_items (
  id serial PRIMARY KEY,
  batch_id varchar(80) NOT NULL,
  invoice_id integer NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  result varchar(30) NOT NULL,
  proposed_action varchar(60) NOT NULL,
  old_balance numeric(16,2),
  new_balance numeric(16,2),
  outstanding_restored numeric(16,2) NOT NULL DEFAULT 0,
  existing_payments numeric(16,2) NOT NULL DEFAULT 0,
  returns_detected numeric(16,2) NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_balance_repair_items_batch_invoice_idx
  ON customer_balance_repair_items(batch_id, invoice_id);
CREATE INDEX IF NOT EXISTS customer_balance_repair_items_result_idx
  ON customer_balance_repair_items(result, created_at DESC);

CREATE OR REPLACE FUNCTION ajn_prevent_receivable_ledger_delete() RETURNS trigger AS $immutable$
BEGIN
  RAISE EXCEPTION 'Customer receivable ledger records are immutable and cannot be deleted';
END;
$immutable$ LANGUAGE plpgsql;

DO $triggers$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'customer_receivable_ledger_no_delete') THEN
    CREATE TRIGGER customer_receivable_ledger_no_delete
    BEFORE DELETE ON customer_receivable_ledger
    FOR EACH ROW EXECUTE FUNCTION ajn_prevent_receivable_ledger_delete();
  END IF;
END $triggers$;

