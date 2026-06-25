alter table "customers" add column if not exists "reward_points" integer not null default 0;
alter table "customers" add column if not exists "reward_level" varchar(20) not null default 'bronze';

alter table "orders" add column if not exists "reward_points_awarded" integer not null default 0;
alter table "service_orders" add column if not exists "reward_points_awarded" integer not null default 0;

create table if not exists "customer_reward_history" (
  "id" serial primary key,
  "customer_id" integer not null references "customers" ("id"),
  "order_id" integer references "orders" ("id"),
  "service_order_id" integer references "service_orders" ("id"),
  "points" integer not null,
  "reason" varchar(120) not null default 'order_reward',
  "note" text,
  "created_at" timestamp not null default now()
);

create index if not exists "customer_reward_history_customer_created_idx"
  on "customer_reward_history" ("customer_id", "created_at");

create index if not exists "customers_reward_points_idx"
  on "customers" ("reward_points");
