CREATE INDEX IF NOT EXISTS orders_tracking_code_perf_idx ON orders (tracking_code);
CREATE INDEX IF NOT EXISTS orders_customer_phone_perf_idx ON orders (customer_phone);
CREATE INDEX IF NOT EXISTS orders_phone_last4_perf_idx ON orders (phone_last4);
CREATE INDEX IF NOT EXISTS orders_status_archived_perf_idx ON orders (status, archived_at);

CREATE INDEX IF NOT EXISTS service_orders_tracking_code_perf_idx ON service_orders (tracking_code);
CREATE INDEX IF NOT EXISTS service_orders_phone_perf_idx ON service_orders (phone);
CREATE INDEX IF NOT EXISTS service_orders_phone_last4_perf_idx ON service_orders (phone_last4);
CREATE INDEX IF NOT EXISTS service_orders_status_archived_perf_idx ON service_orders (status, archived_at);

CREATE INDEX IF NOT EXISTS products_category_active_perf_idx ON products (category, is_active);
CREATE INDEX IF NOT EXISTS products_active_created_perf_idx ON products (is_active, created_at);

CREATE INDEX IF NOT EXISTS staff_username_perf_idx ON staff (username);
CREATE INDEX IF NOT EXISTS customers_phone_perf_idx ON customers (phone);
