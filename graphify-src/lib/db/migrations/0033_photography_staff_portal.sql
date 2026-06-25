create table if not exists "photography_events" (
  "id" serial primary key,
  "client_token" varchar(64) not null unique,
  "groom_name" text not null,
  "event_name" text,
  "event_date" date not null,
  "location" text,
  "assigned_staff_id" integer references "staff" ("id") on delete set null,
  "assigned_staff_name" text not null default '',
  "status" varchar(20) not null default 'active',
  "created_by" integer references "staff" ("id") on delete set null,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create table if not exists "photography_orders" (
  "id" serial primary key,
  "client_token" varchar(64) not null unique,
  "order_no" varchar(40) not null unique,
  "event_id" integer not null references "photography_events" ("id") on delete restrict,
  "assigned_staff_id" integer references "staff" ("id") on delete set null,
  "customer_name" text not null,
  "phone" varchar(20) not null,
  "copies" integer not null default 1,
  "print_type" varchar(30) not null default '10x15',
  "total_amount" numeric(14,2) not null default 0,
  "paid_amount" numeric(14,2) not null default 0,
  "remaining_amount" numeric(14,2) not null default 0,
  "payment_status" varchar(20) not null default 'unpaid',
  "photo_number" varchar(120),
  "notes" text,
  "reference_image" text,
  "status" varchar(30) not null default 'registered',
  "created_by" integer references "staff" ("id") on delete set null,
  "delivered_at" timestamp,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create table if not exists "photography_order_events" (
  "id" serial primary key,
  "order_id" integer not null references "photography_orders" ("id") on delete cascade,
  "staff_id" integer references "staff" ("id") on delete set null,
  "staff_name" text not null default '',
  "type" varchar(40) not null,
  "from_status" varchar(30),
  "to_status" varchar(30),
  "note" text,
  "created_at" timestamp not null default now()
);

alter table "photography_orders" add column if not exists "client_token" varchar(64);
update "photography_orders" set "client_token" = md5(random()::text || clock_timestamp()::text || "id"::text) where "client_token" is null;
alter table "photography_orders" alter column "client_token" set not null;
create unique index if not exists "photography_orders_client_token_idx" on "photography_orders" ("client_token");

create table if not exists "photography_payment_requests" (
  "id" serial primary key,
  "order_id" integer not null references "photography_orders" ("id") on delete cascade,
  "staff_id" integer references "staff" ("id") on delete set null,
  "staff_name" text not null default '',
  "amount" numeric(14,2) not null,
  "note" text,
  "status" varchar(20) not null default 'pending',
  "financial_transaction_id" integer,
  "reviewed_by_staff_id" integer references "staff" ("id") on delete set null,
  "reviewed_by_name" text,
  "reviewed_at" timestamp,
  "created_at" timestamp not null default now()
);

create index if not exists "photography_events_staff_date_idx" on "photography_events" ("assigned_staff_id", "event_date", "id");
create index if not exists "photography_orders_event_idx" on "photography_orders" ("event_id", "created_at");
create index if not exists "photography_orders_staff_status_idx" on "photography_orders" ("assigned_staff_id", "status", "created_at");
create index if not exists "photography_orders_phone_idx" on "photography_orders" ("phone");
create index if not exists "photography_order_events_order_idx" on "photography_order_events" ("order_id", "created_at");
create index if not exists "photography_payment_requests_status_idx" on "photography_payment_requests" ("status", "created_at");
create unique index if not exists "photography_payment_requests_financial_idx" on "photography_payment_requests" ("financial_transaction_id") where "financial_transaction_id" is not null;

update "staff" set "permissions" = '["photography"]'::jsonb where "role" = 'photographer';
update "staff" set "permissions" = coalesce("permissions", '[]'::jsonb) || '["photography"]'::jsonb
where "role" = 'manager' and not (coalesce("permissions", '[]'::jsonb) ? 'photography');
