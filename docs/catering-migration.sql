-- AJN Catering Center — safe PostgreSQL migration.
-- The application also provisions these idempotently on first API access.
create table if not exists catering_bookings (
  id serial primary key, code varchar(32) not null unique, customer_id integer,
  customer_name text not null, mobile1 varchar(30), mobile2 varchar(30), address text, map_url text,
  event_type varchar(30) not null, event_date date not null, start_time varchar(20), finish_time varchar(20),
  hall text, location text, gps text, guest_count integer not null,
  male_count integer not null default 0, female_count integer not null default 0, children_count integer not null default 0, vip_count integer not null default 0,
  notes text, package_name text, total_amount numeric not null default 0, estimated_cost numeric not null default 0,
  balance_amount numeric not null default 0, qr_token varchar(64) not null unique, status varchar(24) not null default 'confirmed',
  chef_name text, created_by integer, created_at timestamp not null default now(), updated_at timestamp not null default now()
);
create table if not exists catering_menu_items (
  id serial primary key, code varchar(40) not null unique, name text not null, category varchar(60) not null,
  cost numeric not null default 0, selling_price numeric not null default 0, preparation_minutes integer not null default 0,
  calories integer, inventory_product_id integer, image_url text, created_at timestamp not null default now()
);
create table if not exists catering_packages (
  id serial primary key, name varchar(120) not null, tier varchar(20) not null, price numeric not null default 0,
  details jsonb not null default '{}'::jsonb, created_at timestamp not null default now()
);
create index if not exists catering_bookings_date_idx on catering_bookings(event_date, status);
