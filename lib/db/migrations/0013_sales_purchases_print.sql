-- Sales invoices
CREATE TABLE IF NOT EXISTS sales_invoices (
  id SERIAL PRIMARY KEY,
  invoice_no VARCHAR(30) NOT NULL UNIQUE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone VARCHAR(20),
  is_internal INTEGER NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  created_by INTEGER,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL DEFAULT '',
  product_name_ar TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Purchases
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  invoice_no VARCHAR(50),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_phone VARCHAR(20),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  extra_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  created_by INTEGER,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL DEFAULT '',
  product_name_ar TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12,2),
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Print templates
CREATE TABLE IF NOT EXISTS print_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'sales',
  paper_size VARCHAR(20) NOT NULL DEFAULT 'a4',
  is_default INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_invoices_date_idx ON sales_invoices (date);
CREATE INDEX IF NOT EXISTS sales_invoices_payment_status_idx ON sales_invoices (payment_status);
CREATE INDEX IF NOT EXISTS purchases_date_idx ON purchases (date);
CREATE INDEX IF NOT EXISTS print_templates_type_idx ON print_templates (type);
