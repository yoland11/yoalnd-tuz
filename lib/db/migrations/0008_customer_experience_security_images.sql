alter table "staff" add column if not exists "last_activity_at" timestamp;

alter table "crews" add column if not exists "status" varchar(20) not null default 'available';
alter table "crews" add column if not exists "internal_notes" text;
update "crews" set "status" = 'inactive' where "is_active" = false and ("status" is null or "status" = 'available');
create index if not exists "crews_status_idx" on "crews" ("status");

create table if not exists "order_reviews" (
  "id" serial primary key,
  "customer_id" integer references "customers" ("id"),
  "order_kind" varchar(20) not null,
  "order_id" integer not null,
  "rating" integer not null,
  "comment" text,
  "created_at" timestamp not null default now()
);
create unique index if not exists "order_reviews_kind_order_customer_idx"
  on "order_reviews" ("order_kind", "order_id", "customer_id");
create index if not exists "order_reviews_order_idx" on "order_reviews" ("order_kind", "order_id");

create table if not exists "admin_activity_logs" (
  "id" serial primary key,
  "staff_id" integer references "staff" ("id"),
  "action" varchar(80) not null,
  "entity_type" varchar(80),
  "entity_id" integer,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamp not null default now()
);
create index if not exists "admin_activity_staff_created_idx" on "admin_activity_logs" ("staff_id", "created_at");
create index if not exists "admin_activity_action_created_idx" on "admin_activity_logs" ("action", "created_at");
