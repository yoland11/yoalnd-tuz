ALTER TABLE products
  ADD COLUMN IF NOT EXISTS item_type varchar(20) NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS service_unit text,
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true;

ALTER TABLE sales_invoice_items
  ADD COLUMN IF NOT EXISTS unit_snapshot text,
  ADD COLUMN IF NOT EXISTS track_inventory_snapshot boolean;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_item_type_check
    CHECK (item_type IN ('product', 'service'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_service_unit_check
    CHECK (item_type <> 'service' OR (track_inventory = false AND service_unit IS NOT NULL AND length(trim(service_unit)) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS service_order_items (
  id serial PRIMARY KEY,
  service_order_id integer NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  product_id integer REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  unit text NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_order_items_order_idx
  ON service_order_items (service_order_id, id);
