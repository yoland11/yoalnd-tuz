-- Phase 3 release-readiness repair.
-- The application has used sales_invoices.idempotency_key for retry-safe
-- invoice creation, but older migration chains did not add the column.
-- Additive and backwards-compatible: historical invoices remain NULL.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_idempotency_key_idx
  ON sales_invoices(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_idempotency_key_idx
  ON purchase_invoices(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ajn_schema_revisions (
  revision integer PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO ajn_schema_revisions (revision, description)
VALUES (97, 'Phase 3 release readiness: invoice idempotency schema alignment')
ON CONFLICT (revision) DO NOTHING;
