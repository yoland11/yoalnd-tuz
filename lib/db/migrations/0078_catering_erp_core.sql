-- Catering ERP core. All statements are additive so existing catering bookings
-- and menu items remain intact during the upgrade.

create table if not exists catering_categories (
  id serial primary key,
  name varchar(160) not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamp,
  created_by integer,
  updated_by integer,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create unique index if not exists catering_categories_name_active_idx
  on catering_categories (lower(name)) where archived_at is null;

create table if not exists catering_menu_items (
  id serial primary key,
  code varchar(40) not null unique,
  name text not null,
  category varchar(60) not null default 'general',
  cost numeric not null default 0,
  selling_price numeric not null default 0,
  preparation_minutes integer not null default 0,
  calories integer,
  inventory_product_id integer,
  image_url text,
  created_at timestamp not null default now()
);
alter table catering_menu_items
  add column if not exists category_id integer references catering_categories(id) on delete restrict,
  add column if not exists barcode varchar(100),
  add column if not exists unit varchar(40) not null default 'حبة',
  add column if not exists stock_quantity numeric(14,3) not null default 0,
  add column if not exists min_stock numeric(14,3) not null default 0,
  add column if not exists supplier_id integer references suppliers(id) on delete set null,
  add column if not exists packaging_cost numeric(14,2) not null default 0,
  add column if not exists preparation_labor_cost numeric(14,2) not null default 0,
  add column if not exists notes text,
  add column if not exists track_inventory boolean not null default false,
  add column if not exists available_for_sale boolean not null default true,
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamp,
  add column if not exists updated_at timestamp not null default now(),
  add column if not exists updated_by integer;
create unique index if not exists catering_menu_items_barcode_idx
  on catering_menu_items (barcode) where barcode is not null;
create index if not exists catering_menu_items_category_active_idx
  on catering_menu_items (category_id, is_active) where archived_at is null;

insert into catering_categories (name)
select distinct nullif(trim(category), '')
from catering_menu_items
where nullif(trim(category), '') is not null
  and not exists (
    select 1 from catering_categories c
    where lower(c.name) = lower(trim(catering_menu_items.category)) and c.archived_at is null
  )
on conflict do nothing;
update catering_menu_items mi
set category_id = c.id
from catering_categories c
where mi.category_id is null and lower(c.name) = lower(trim(mi.category));

create table if not exists catering_packages (
  id serial primary key,
  name varchar(120) not null,
  tier varchar(20) not null default 'custom',
  price numeric not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamp not null default now()
);
alter table catering_packages
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamp,
  add column if not exists image_url text,
  add column if not exists cost_amount numeric(14,2) not null default 0,
  add column if not exists updated_at timestamp not null default now();

create table if not exists catering_package_items (
  id serial primary key,
  package_id integer not null references catering_packages(id) on delete cascade,
  menu_item_id integer not null references catering_menu_items(id) on delete restrict,
  quantity numeric(14,3) not null default 1,
  created_at timestamp not null default now(),
  unique(package_id, menu_item_id)
);

create table if not exists catering_orders (
  id serial primary key,
  order_no varchar(48) not null unique,
  customer_id integer references customers(id) on delete set null,
  customer_name text not null default '',
  customer_phone varchar(30),
  customer_address text,
  occasion varchar(100),
  event_date date,
  status varchar(32) not null default 'draft',
  payment_status varchar(32) not null default 'unpaid',
  payment_method varchar(20) not null default 'cash',
  cost_settlement_mode varchar(32) not null default 'immediate',
  supplier_id integer references suppliers(id) on delete set null,
  subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  delivery_fee numeric(14,2) not null default 0,
  service_fee numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  remaining_amount numeric(14,2) not null default 0,
  food_cost numeric(14,2) not null default 0,
  expense_amount numeric(14,2) not null default 0,
  refund_amount numeric(14,2) not null default 0,
  final_profit numeric(14,2) not null default 0,
  notes text,
  stock_applied boolean not null default false,
  stock_restored_at timestamp,
  cancelled_at timestamp,
  cancelled_by integer,
  cancellation_reason text,
  created_by integer,
  created_by_name text not null default '',
  updated_by integer,
  updated_at timestamp not null default now(),
  created_at timestamp not null default now()
);
create index if not exists catering_orders_status_date_idx on catering_orders(status, event_date, created_at desc);
create index if not exists catering_orders_customer_idx on catering_orders(customer_id, created_at desc);

create table if not exists catering_order_items (
  id serial primary key,
  order_id integer not null references catering_orders(id) on delete restrict,
  menu_item_id integer references catering_menu_items(id) on delete set null,
  inventory_product_id integer references products(id) on delete set null,
  category_id integer references catering_categories(id) on delete set null,
  item_name text not null,
  item_code varchar(100),
  item_image_url text,
  unit varchar(40) not null default 'حبة',
  quantity numeric(14,3) not null,
  unit_selling_price numeric(14,2) not null default 0,
  unit_cost_price numeric(14,2) not null default 0,
  packaging_cost numeric(14,2) not null default 0,
  preparation_labor_cost numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  line_cost numeric(14,2) not null default 0,
  notes text,
  created_at timestamp not null default now()
);
create index if not exists catering_order_items_order_idx on catering_order_items(order_id);

create table if not exists catering_payments (
  id serial primary key,
  order_id integer not null references catering_orders(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_method varchar(20) not null default 'cash',
  payment_date timestamp not null default now(),
  reference varchar(160),
  notes text,
  attachment_url text,
  status varchar(20) not null default 'confirmed',
  financial_transaction_id integer references financial_transactions(id) on delete restrict,
  reversal_transaction_id integer references financial_transactions(id) on delete restrict,
  collected_by integer,
  created_at timestamp not null default now(),
  reversed_at timestamp,
  reversed_by integer,
  reversal_reason text
);
create index if not exists catering_payments_order_status_idx on catering_payments(order_id, status);

create table if not exists catering_order_expenses (
  id serial primary key,
  order_id integer not null references catering_orders(id) on delete restrict,
  expense_type varchar(40) not null,
  amount numeric(14,2) not null check (amount >= 0),
  supplier_id integer references suppliers(id) on delete set null,
  notes text,
  financial_transaction_id integer references financial_transactions(id) on delete restrict,
  created_by integer,
  created_at timestamp not null default now(),
  reversed_at timestamp
);

create table if not exists catering_supplier_payables (
  id serial primary key,
  order_id integer not null references catering_orders(id) on delete restrict,
  supplier_id integer not null references suppliers(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  paid_amount numeric(14,2) not null default 0,
  status varchar(20) not null default 'open',
  due_date date,
  notes text,
  created_at timestamp not null default now(),
  settled_at timestamp
);
create index if not exists catering_supplier_payables_supplier_idx on catering_supplier_payables(supplier_id, status);
