-- Additive only: product bundles have independent, derived stock and never alter
-- historical product or invoice records.
CREATE TABLE IF NOT EXISTS product_bundles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image TEXT,
  barcode VARCHAR(100),
  normal_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  offer_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  show_in_store BOOLEAN NOT NULL DEFAULT FALSE,
  show_in_sales_invoices BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_bundles_barcode_unique
  ON product_bundles (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_bundles_sales_visibility_idx
  ON product_bundles (is_active, show_in_sales_invoices);

CREATE TABLE IF NOT EXISTS product_bundle_items (
  id SERIAL PRIMARY KEY,
  bundle_id INTEGER NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT product_bundle_items_bundle_product_unique UNIQUE (bundle_id, product_id)
);
CREATE INDEX IF NOT EXISTS product_bundle_items_product_idx ON product_bundle_items(product_id);

ALTER TABLE sales_invoice_items
  ADD COLUMN IF NOT EXISTS bundle_id INTEGER REFERENCES product_bundles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_invoice_items_bundle_idx ON sales_invoice_items(bundle_id) WHERE bundle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_invoice_bundle_snapshots (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  sales_invoice_item_id INTEGER NOT NULL REFERENCES sales_invoice_items(id) ON DELETE CASCADE,
  bundle_id INTEGER REFERENCES product_bundles(id) ON DELETE SET NULL,
  bundle_name TEXT NOT NULL,
  bundle_barcode VARCHAR(100),
  bundle_quantity NUMERIC(14,3) NOT NULL,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoice_bundle_snapshots_item_unique UNIQUE (sales_invoice_item_id)
);
CREATE INDEX IF NOT EXISTS sales_invoice_bundle_snapshots_invoice_idx
  ON sales_invoice_bundle_snapshots(invoice_id);
