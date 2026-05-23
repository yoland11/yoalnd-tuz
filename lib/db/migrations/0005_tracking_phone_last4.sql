alter table "orders" add column if not exists "phone_last4" varchar(4);
alter table "service_orders" add column if not exists "phone_last4" varchar(4);

update "orders"
set "phone_last4" = right(regexp_replace(coalesce("customer_phone", ''), '\D', '', 'g'), 4)
where ("phone_last4" is null or "phone_last4" = '')
  and length(regexp_replace(coalesce("customer_phone", ''), '\D', '', 'g')) >= 4;

update "service_orders"
set "phone_last4" = right(regexp_replace(coalesce("phone", ''), '\D', '', 'g'), 4)
where ("phone_last4" is null or "phone_last4" = '')
  and length(regexp_replace(coalesce("phone", ''), '\D', '', 'g')) >= 4;

alter table "orders" drop constraint if exists "orders_tracking_code_unique";
alter table "service_orders" drop constraint if exists "service_orders_tracking_code_unique";
drop index if exists "orders_tracking_code_unique";
drop index if exists "service_orders_tracking_code_unique";

create index if not exists "orders_tracking_code_idx" on "orders" ("tracking_code");
create index if not exists "orders_phone_last4_idx" on "orders" ("phone_last4");
create index if not exists "service_orders_tracking_code_idx" on "service_orders" ("tracking_code");
create index if not exists "service_orders_phone_last4_idx" on "service_orders" ("phone_last4");
