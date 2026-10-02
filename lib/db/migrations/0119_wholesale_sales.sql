ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type varchar(20) NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS province varchar(100),
  ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2),
  ADD COLUMN IF NOT EXISTS special_discount_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS wholesale_price numeric(14,2);

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS sale_type varchar(20);

DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_customer_type_check
    CHECK (customer_type IN ('retail', 'wholesale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_credit_limit_check
    CHECK (credit_limit IS NULL OR credit_limit >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_special_discount_percent_check
    CHECK (special_discount_percent IS NULL OR special_discount_percent BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_wholesale_price_check
    CHECK (wholesale_price IS NULL OR wholesale_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_sale_type_check
    CHECK (sale_type IS NULL OR sale_type IN ('retail', 'wholesale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS product_wholesale_price_tiers (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  minimum_quantity numeric(14,3) NOT NULL CHECK (minimum_quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT product_wholesale_price_tiers_product_minimum_unique
    UNIQUE (product_id, minimum_quantity)
);

CREATE TABLE IF NOT EXISTS customer_product_prices (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT customer_product_prices_customer_product_unique
    UNIQUE (customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS product_wholesale_price_tiers_lookup_idx
  ON product_wholesale_price_tiers (product_id, is_active, minimum_quantity DESC);
CREATE INDEX IF NOT EXISTS customer_product_prices_lookup_idx
  ON customer_product_prices (customer_id, product_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS sales_invoices_sale_type_date_idx
  ON sales_invoices (sale_type, date, id) WHERE status = 'active' AND financially_reversed = false;
