-- Migration: Sales Invoices, Purchase Invoices, Suppliers, Print Templates

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone VARCHAR(30),
  email TEXT,
  address TEXT,
  notes TEXT,
  balance TEXT NOT NULL DEFAULT '0',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Sales Invoices
CREATE TABLE IF NOT EXISTS sales_invoices (
  id SERIAL PRIMARY KEY,
  invoice_no VARCHAR(40) NOT NULL UNIQUE,
  date DATE NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone VARCHAR(30),
  customer_id INTEGER REFERENCES customers(id),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_internal INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES staff(id),
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Sales Invoice Items
CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  barcode VARCHAR(100),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Purchase Invoices
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id SERIAL PRIMARY KEY,
  invoice_no VARCHAR(40) NOT NULL UNIQUE,
  date DATE NOT NULL,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER REFERENCES suppliers(id),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by INTEGER REFERENCES staff(id),
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Purchase Invoice Items
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  barcode VARCHAR(100),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Print Templates
CREATE TABLE IF NOT EXISTS print_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'sales',
  paper_size VARCHAR(20) NOT NULL DEFAULT 'a4',
  is_default INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES staff(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice ON purchase_invoice_items(invoice_id);
