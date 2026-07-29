-- Hardening for the operational Catering ERP: immutable stock application
-- claims prevent a repeated status update from moving inventory twice.
create table if not exists catering_stock_events (
  id serial primary key,
  order_id integer not null references catering_orders(id) on delete restrict,
  order_item_id integer not null references catering_order_items(id) on delete restrict,
  event varchar(20) not null,
  quantity numeric(14,3) not null,
  created_at timestamp not null default now(),
  unique(order_item_id, event)
);
create index if not exists catering_stock_events_order_idx on catering_stock_events(order_id, created_at desc);

alter table catering_orders
  add column if not exists cancelled_at timestamp,
  add column if not exists cancelled_by integer,
  add column if not exists cancellation_reason text,
  add column if not exists updated_by integer;

alter table catering_menu_items
  add column if not exists inventory_product_id integer references products(id) on delete set null;
