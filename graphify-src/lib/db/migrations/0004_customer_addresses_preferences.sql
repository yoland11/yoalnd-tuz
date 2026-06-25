create table if not exists "customer_addresses" (
  "id" serial primary key,
  "customer_id" integer not null references "customers"("id"),
  "type" varchar(20) not null default 'home',
  "full_name" text not null default '',
  "phone" varchar(20) not null,
  "governorate" text not null default '',
  "city" text not null default '',
  "address" text not null default '',
  "landmark" text not null default '',
  "notes" text not null default '',
  "is_default" boolean not null default false,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create index if not exists "customer_addresses_customer_id_idx" on "customer_addresses" ("customer_id");

create table if not exists "customer_preferences" (
  "id" serial primary key,
  "customer_id" integer not null references "customers"("id"),
  "default_payment_method" varchar(20) not null default 'cash',
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create unique index if not exists "customer_preferences_customer_id_unique" on "customer_preferences" ("customer_id");
