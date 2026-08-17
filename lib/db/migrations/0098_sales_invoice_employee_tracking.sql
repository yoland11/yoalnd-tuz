-- Additive invoice attribution. Existing invoices keep their original creator
-- fields and continue to work; the existing branch_entity_assignments relation
-- remains the single source of truth for branch ownership.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS created_by_role varchar(30) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_by_role varchar(30) NOT NULL DEFAULT '';

-- Historical invoices have no separate modifier. Preserve their known creator
-- as the initial last modifier instead of leaving ambiguous empty data.
UPDATE sales_invoices
SET updated_by = COALESCE(updated_by, created_by),
    updated_by_name = CASE
      WHEN COALESCE(updated_by_name, '') = '' THEN COALESCE(created_by_name, '')
      ELSE updated_by_name
    END
WHERE updated_by IS NULL OR COALESCE(updated_by_name, '') = '';

CREATE INDEX IF NOT EXISTS sales_invoices_created_by_date_idx
  ON sales_invoices(created_by, date DESC);

CREATE INDEX IF NOT EXISTS sales_invoices_updated_by_idx
  ON sales_invoices(updated_by);
