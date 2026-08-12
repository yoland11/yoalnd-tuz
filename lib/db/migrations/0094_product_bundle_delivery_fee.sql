-- Additive only. Existing offers and historical invoices retain their current
-- totals because the new values default to zero; no production data is changed.
ALTER TABLE product_bundles
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS offer_delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE sales_invoice_bundle_snapshots
  ADD COLUMN IF NOT EXISTS delivery_fee_per_bundle NUMERIC(14,2) NOT NULL DEFAULT 0;
