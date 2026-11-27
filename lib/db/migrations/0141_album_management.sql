-- Album Management (إدارة الألبومات): isolated, additive tables only.
-- No existing table, column or historical value is changed. Money stays in
-- the linked sales invoice (canonical payment state); album rows only keep the
-- sale price snapshot and manufacturing costs.

-- Administrator-managed specifications: types, sizes, covers, colours, paper,
-- page counts and boxes, each with a default price and manufacturing cost and an
-- optional inventory product consumed per album copy.
CREATE TABLE IF NOT EXISTS album_catalog_options (
  id serial PRIMARY KEY,
  kind varchar(20) NOT NULL,
  label text NOT NULL,
  default_price numeric(14, 2) NOT NULL DEFAULT 0,
  manufacturing_cost numeric(14, 2) NOT NULL DEFAULT 0,
  product_id integer REFERENCES products(id) ON DELETE SET NULL,
  material_quantity numeric(12, 3) NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT album_catalog_options_kind_check CHECK (kind IN ('type', 'size', 'cover_type', 'cover_color', 'paper', 'page_count', 'box')),
  CONSTRAINT album_catalog_options_money_check CHECK (default_price >= 0 AND manufacturing_cost >= 0 AND material_quantity > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS album_catalog_options_kind_label_idx ON album_catalog_options (kind, lower(label));
CREATE INDEX IF NOT EXISTS album_catalog_options_kind_idx ON album_catalog_options (kind, is_active, sort_order);

CREATE TABLE IF NOT EXISTS album_orders (
  id serial PRIMARY KEY,
  album_no varchar(30) NOT NULL,
  -- Opaque tokens for the QR code and barcode: no customer data is encoded.
  qr_token varchar(64) NOT NULL,
  barcode_value varchar(40) NOT NULL,
  creation_key varchar(180),
  customer_id integer REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  phone varchar(30) NOT NULL DEFAULT '',
  booking_id integer REFERENCES service_orders(id) ON DELETE SET NULL,
  occasion_type text,
  album_type text NOT NULL,
  album_size text NOT NULL,
  page_count integer,
  photo_count integer,
  copies integer NOT NULL DEFAULT 1,
  cover_type text,
  cover_color text,
  paper_type text,
  box_type text,
  cover_names text,
  occasion_date date,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  designer_staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  printer_staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  binder_staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  quality_staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  customer_notes text,
  internal_notes text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  stage varchar(30) NOT NULL DEFAULT 'received',
  stage_changed_at timestamp NOT NULL DEFAULT now(),
  -- invoice: charged on its own sales invoice; package: already paid for inside
  -- the linked photography booking (no second charge); free: no charge.
  finance_mode varchar(20) NOT NULL DEFAULT 'invoice',
  invoice_id integer REFERENCES sales_invoices(id) ON DELETE SET NULL,
  sale_price numeric(14, 2) NOT NULL DEFAULT 0,
  design_cost numeric(14, 2) NOT NULL DEFAULT 0,
  printing_cost numeric(14, 2) NOT NULL DEFAULT 0,
  cover_cost numeric(14, 2) NOT NULL DEFAULT 0,
  binding_cost numeric(14, 2) NOT NULL DEFAULT 0,
  extra_costs numeric(14, 2) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'active',
  delivered_at timestamp,
  delivered_to_name text,
  delivery_photo_url text,
  delivery_signature_url text,
  delivered_by integer REFERENCES staff(id) ON DELETE SET NULL,
  delivered_by_name text,
  cancelled_at timestamp,
  cancelled_by integer REFERENCES staff(id) ON DELETE SET NULL,
  cancel_reason text,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT album_orders_stage_check CHECK (stage IN ('received', 'awaiting_selection', 'selected', 'designing', 'awaiting_approval', 'approved', 'printing', 'binding', 'quality', 'ready', 'delivered')),
  CONSTRAINT album_orders_finance_mode_check CHECK (finance_mode IN ('invoice', 'package', 'free')),
  CONSTRAINT album_orders_status_check CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT album_orders_counts_check CHECK (copies BETWEEN 1 AND 50 AND (page_count IS NULL OR page_count > 0) AND (photo_count IS NULL OR photo_count >= 0)),
  CONSTRAINT album_orders_money_check CHECK (sale_price >= 0 AND design_cost >= 0 AND printing_cost >= 0 AND cover_cost >= 0 AND binding_cost >= 0 AND extra_costs >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS album_orders_album_no_idx ON album_orders (album_no);
CREATE UNIQUE INDEX IF NOT EXISTS album_orders_qr_token_idx ON album_orders (qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS album_orders_barcode_idx ON album_orders (barcode_value);
-- Durable creation identity: a retried or double-clicked save returns the same album.
CREATE UNIQUE INDEX IF NOT EXISTS album_orders_creation_key_idx ON album_orders (creation_key);
-- One sales invoice can only ever belong to one album order.
CREATE UNIQUE INDEX IF NOT EXISTS album_orders_invoice_idx ON album_orders (invoice_id);
CREATE INDEX IF NOT EXISTS album_orders_stage_idx ON album_orders (status, stage, due_date);
CREATE INDEX IF NOT EXISTS album_orders_customer_idx ON album_orders (customer_id);
CREATE INDEX IF NOT EXISTS album_orders_booking_idx ON album_orders (booking_id);
CREATE INDEX IF NOT EXISTS album_orders_order_date_idx ON album_orders (order_date);
CREATE INDEX IF NOT EXISTS album_orders_designer_idx ON album_orders (designer_staff_id);
CREATE INDEX IF NOT EXISTS album_orders_printer_idx ON album_orders (printer_staff_id);

-- Every stage change, note and photo: who, when and why.
CREATE TABLE IF NOT EXISTS album_order_events (
  id serial PRIMARY KEY,
  album_id integer NOT NULL REFERENCES album_orders(id) ON DELETE CASCADE,
  type varchar(30) NOT NULL,
  from_stage varchar(30),
  to_stage varchar(30),
  note text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  staff_id integer REFERENCES staff(id) ON DELETE SET NULL,
  staff_name text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS album_order_events_album_idx ON album_order_events (album_id, created_at);
CREATE INDEX IF NOT EXISTS album_order_events_staff_idx ON album_order_events (staff_id, created_at);
-- An album is handed to the customer once: a second delivery record is refused.
CREATE UNIQUE INDEX IF NOT EXISTS album_order_events_one_delivery_idx ON album_order_events (album_id) WHERE type = 'delivered';

-- One row per physical copy, each with its own scannable code.
CREATE TABLE IF NOT EXISTS album_copies (
  id serial PRIMARY KEY,
  album_id integer NOT NULL REFERENCES album_orders(id) ON DELETE CASCADE,
  copy_no integer NOT NULL,
  code varchar(40) NOT NULL,
  qr_token varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT album_copies_copy_no_check CHECK (copy_no > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS album_copies_album_copy_idx ON album_copies (album_id, copy_no);
CREATE UNIQUE INDEX IF NOT EXISTS album_copies_code_idx ON album_copies (code);
CREATE UNIQUE INDEX IF NOT EXISTS album_copies_qr_token_idx ON album_copies (qr_token);

-- Inventory consumed by an album. The stock movement itself is written by the
-- existing stock engine under the line's idempotency key.
CREATE TABLE IF NOT EXISTS album_materials (
  id serial PRIMARY KEY,
  album_id integer NOT NULL REFERENCES album_orders(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  quantity numeric(12, 3) NOT NULL,
  unit_cost numeric(14, 2) NOT NULL DEFAULT 0,
  request_key varchar(160) NOT NULL,
  returned_at timestamp,
  returned_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT album_materials_quantity_check CHECK (quantity > 0 AND unit_cost >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS album_materials_request_key_idx ON album_materials (request_key);
CREATE INDEX IF NOT EXISTS album_materials_album_idx ON album_materials (album_id);

-- Design / printing / binding / quality tasks sent to the Work Commands Center.
CREATE TABLE IF NOT EXISTS album_tasks (
  id serial PRIMARY KEY,
  album_id integer NOT NULL REFERENCES album_orders(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL,
  staff_id integer NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  task_id integer,
  created_by integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT album_tasks_role_check CHECK (role IN ('design', 'printing', 'binding', 'quality'))
);
CREATE INDEX IF NOT EXISTS album_tasks_album_idx ON album_tasks (album_id, role);
CREATE INDEX IF NOT EXISTS album_tasks_staff_idx ON album_tasks (staff_id);
