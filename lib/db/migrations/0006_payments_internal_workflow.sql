alter table "orders" add column if not exists "deposit_amount" numeric(10,2) not null default 0;
alter table "orders" add column if not exists "remaining_amount" numeric(10,2) not null default 0;
alter table "orders" add column if not exists "payment_status" varchar(20) not null default 'unpaid';
alter table "orders" add column if not exists "internal_notes" text;

update "orders"
set
  "deposit_amount" = case when "payment_method" = 'paid' then "total" else coalesce("deposit_amount", 0) end,
  "remaining_amount" = case when "payment_method" = 'paid' then 0 else greatest("total" - coalesce("deposit_amount", 0), 0) end,
  "payment_status" = case when "payment_method" = 'paid' then 'paid' else coalesce(nullif("payment_status", ''), 'unpaid') end
where "remaining_amount" = 0
  and "payment_status" = 'unpaid';

alter table "service_orders" add column if not exists "total_amount" numeric(10,2) not null default 0;
alter table "service_orders" add column if not exists "deposit_amount" numeric(10,2) not null default 0;
alter table "service_orders" add column if not exists "remaining_amount" numeric(10,2) not null default 0;
alter table "service_orders" add column if not exists "payment_status" varchar(20) not null default 'unpaid';
alter table "service_orders" add column if not exists "internal_notes" text;

update "service_orders"
set
  "remaining_amount" = greatest(coalesce("total_amount", 0) - coalesce("deposit_amount", 0), 0),
  "payment_status" = case
    when coalesce("total_amount", 0) > 0 and greatest(coalesce("total_amount", 0) - coalesce("deposit_amount", 0), 0) = 0 then 'paid'
    when coalesce("deposit_amount", 0) > 0 then 'partial'
    else coalesce(nullif("payment_status", ''), 'unpaid')
  end;

create index if not exists "orders_payment_status_idx" on "orders" ("payment_status");
create index if not exists "service_orders_payment_status_idx" on "service_orders" ("payment_status");
