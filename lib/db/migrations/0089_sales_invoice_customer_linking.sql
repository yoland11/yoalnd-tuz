-- Legacy sales invoices can have an empty customer_id.  This index supports
-- the safe repair preview and keeps customer-linked invoice lookup fast.  No
-- historical amount, payment, or customer data is changed by this migration.
create index if not exists sales_invoices_customer_id_active_idx
  on sales_invoices (customer_id, created_at desc)
  where customer_id is not null and status = 'active';
