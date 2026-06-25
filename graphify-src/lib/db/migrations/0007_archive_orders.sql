alter table "orders" add column if not exists "archived_at" timestamp;
alter table "service_orders" add column if not exists "archived_at" timestamp;

create index if not exists "orders_archived_at_idx" on "orders" ("archived_at");
create index if not exists "service_orders_archived_at_idx" on "service_orders" ("archived_at");
