-- ============================================================================
-- Link purchase invoices to a customer account  —  REVIEW BEFORE RUNNING
-- ============================================================================
--
-- Status: NOT APPLIED. Left for a human to run on a non-prod copy first.
--
-- Why: the "open a customer account?" prompt on saving a purchase invoice
-- creates the customer record, but purchase_invoices only has supplier_id — it
-- has no column to link that customer, so purchases can't yet aggregate under
-- the account. This adds an optional customer_id link (mirrors sales_invoices)
-- so a purchase can be attributed to a customer account when desired.
--
-- ⚠️  DATABASE_URL points at the LIVE production database. Run on a staging copy
--     first, back up before applying to prod, and apply during low traffic.
-- ============================================================================

BEGIN;

ALTER TABLE "purchase_invoices"
  ADD COLUMN IF NOT EXISTS "customer_id" integer REFERENCES "customers"("id");

CREATE INDEX IF NOT EXISTS "purchase_invoices_customer_idx"
  ON "purchase_invoices" ("customer_id");

COMMIT;

-- Follow-up (application code, after the column exists):
--   • lib/db/src/schema/purchase-invoices.ts — add customerId to the table.
--   • src/server/api.ts (handlePurchaseInvoices POST/PUT) — accept + persist
--     customerId, same as sales invoices do.
--   • src/views/admin/purchases.tsx — pass the created customerId from
--     CustomerAccountPrompt.onConfirm into the invoice payload (like sales).
-- ============================================================================
