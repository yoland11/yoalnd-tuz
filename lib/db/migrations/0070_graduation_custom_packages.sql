-- AJN graduation custom-package builder + product economics.
-- Additive only: no historical graduation data is removed or rewritten.

-- 1) Product economics/inventory columns on graduation_templates (Hybrid model).
--    Per-type attributes (sizes, colors, print/embroidery, tassel, size chart,
--    production time, rental/sale) continue to live inside `configuration` jsonb.
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS cost_price numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS discount_price numeric(14,2);
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS sku varchar(80);
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS barcode varchar(120);
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 0;
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE graduation_templates ADD COLUMN IF NOT EXISTS archived_at timestamp;

-- 2) Per-item price + customization snapshot for custom packages.
--    One row per selected gown / sash / cap / accessory. Prices are snapshotted
--    at order time so later product price changes never alter past orders.
CREATE TABLE IF NOT EXISTS graduation_order_items (
  id serial PRIMARY KEY,
  graduation_order_id integer NOT NULL REFERENCES graduation_orders(id) ON DELETE CASCADE,
  group_id integer REFERENCES graduation_groups(id) ON DELETE SET NULL,
  item_type varchar(30) NOT NULL DEFAULT 'custom',
  template_id integer REFERENCES graduation_templates(id) ON DELETE SET NULL,
  product_id integer REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  product_sku varchar(80),
  variant_label text,
  size varchar(60),
  color varchar(80),
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  original_unit_price numeric(14,2) NOT NULL DEFAULT 0,
  final_unit_price numeric(14,2) NOT NULL DEFAULT 0,
  customization_charge numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  customization jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_url text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graduation_order_items_order_idx ON graduation_order_items(graduation_order_id, sort_order);
CREATE INDEX IF NOT EXISTS graduation_order_items_template_idx ON graduation_order_items(template_id);
