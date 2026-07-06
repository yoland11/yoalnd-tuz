-- AJN financial/customer ledger upgrade.
-- Additive only: existing sales invoices remain valid without a supplier.

ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "supplier_id" integer
  REFERENCES "suppliers" ("id") ON DELETE SET NULL;

ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "supplier_name" text;

CREATE INDEX IF NOT EXISTS "sales_invoices_supplier_id_idx"
  ON "sales_invoices" ("supplier_id");
