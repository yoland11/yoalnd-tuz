-- Indexed, server-side search for the sales and purchase invoice registers.
-- Additive only. Existing invoice data, routes and business logic are unchanged.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS sales_invoices_invoice_no_trgm_idx
  ON sales_invoices USING gin (invoice_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sales_invoices_customer_name_trgm_idx
  ON sales_invoices USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sales_invoices_customer_phone_trgm_idx
  ON sales_invoices USING gin (customer_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sales_invoices_customer_phone_digits_trgm_idx
  ON sales_invoices USING gin ((regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sales_invoices_notes_trgm_idx
  ON sales_invoices USING gin (notes gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sales_invoices_register_filters_idx
  ON sales_invoices (status, payment_status, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS customers_name_trgm_idx
  ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_full_name_trgm_idx
  ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx
  ON customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_digits_trgm_idx
  ON customers USING gin ((regexp_replace(phone, '[^0-9]', '', 'g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_account_number_trgm_idx
  ON customers USING gin ((('CUS-' || lpad(id::text, 6, '0'))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS purchase_invoices_invoice_no_trgm_idx
  ON purchase_invoices USING gin (invoice_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_name_trgm_idx
  ON purchase_invoices USING gin (supplier_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS purchase_invoices_notes_trgm_idx
  ON purchase_invoices USING gin (notes gin_trgm_ops);
CREATE INDEX IF NOT EXISTS purchase_invoices_register_filters_idx
  ON purchase_invoices (status, payment_status, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS suppliers_name_trgm_idx
  ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_company_trgm_idx
  ON suppliers USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_phone_trgm_idx
  ON suppliers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_phone_digits_trgm_idx
  ON suppliers USING gin ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_code_trgm_idx
  ON suppliers USING gin (supplier_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_account_number_trgm_idx
  ON suppliers USING gin ((coalesce(supplier_code, 'SUP-' || lpad(id::text, 6, '0'))) gin_trgm_ops);
