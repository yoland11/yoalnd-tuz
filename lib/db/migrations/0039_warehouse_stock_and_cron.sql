create table if not exists "warehouse_stock" (
  "id" serial primary key,
  "warehouse_id" integer not null references "warehouses" ("id"),
  "product_id" integer not null,
  "quantity" numeric(12,3) not null default 0,
  "updated_at" timestamp not null default now(),
  "created_at" timestamp not null default now()
);

create unique index if not exists "warehouse_stock_product_warehouse_idx"
  on "warehouse_stock" ("product_id", "warehouse_id");

create index if not exists "warehouse_stock_warehouse_idx"
  on "warehouse_stock" ("warehouse_id");

create index if not exists "warehouse_stock_product_idx"
  on "warehouse_stock" ("product_id");
