create table if not exists "notifications" (
  "id" serial primary key,
  "audience_type" varchar(20) not null default 'admin',
  "staff_id" integer references "staff" ("id"),
  "customer_id" integer references "customers" ("id"),
  "type" varchar(60) not null default 'general',
  "title" text not null,
  "body" text not null default '',
  "entity_type" varchar(40),
  "entity_id" integer,
  "href" text,
  "metadata" jsonb not null default '{}'::jsonb,
  "read_at" timestamp,
  "archived_at" timestamp,
  "created_at" timestamp not null default now()
);

create table if not exists "notification_subscriptions" (
  "id" serial primary key,
  "owner_type" varchar(20) not null default 'staff',
  "staff_id" integer references "staff" ("id"),
  "customer_id" integer references "customers" ("id"),
  "endpoint" text not null unique,
  "p256dh" text not null,
  "auth" text not null,
  "user_agent" text,
  "is_active" integer not null default 1,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create table if not exists "notification_settings" (
  "id" serial primary key,
  "owner_type" varchar(20) not null default 'global',
  "owner_id" integer,
  "push_enabled" integer not null default 1,
  "orders_enabled" integer not null default 1,
  "messages_enabled" integer not null default 1,
  "tasks_enabled" integer not null default 1,
  "inventory_enabled" integer not null default 1,
  "customer_enabled" integer not null default 1,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create index if not exists "notifications_audience_created_idx" on "notifications" ("audience_type", "created_at");
create index if not exists "notifications_staff_read_idx" on "notifications" ("staff_id", "read_at");
create index if not exists "notifications_customer_read_idx" on "notifications" ("customer_id", "read_at");
create index if not exists "notifications_type_idx" on "notifications" ("type");
create index if not exists "notification_subscriptions_staff_idx" on "notification_subscriptions" ("staff_id", "is_active");
create index if not exists "notification_subscriptions_customer_idx" on "notification_subscriptions" ("customer_id", "is_active");
create unique index if not exists "notification_settings_owner_unique_idx" on "notification_settings" ("owner_type", coalesce("owner_id", 0));
