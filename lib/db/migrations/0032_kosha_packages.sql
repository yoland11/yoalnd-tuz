create table if not exists "kosha_packages" (
  "id" serial primary key,
  "name" text not null,
  "slug" varchar(160) not null unique,
  "description" text,
  "price" numeric(14,2) not null default 0,
  "old_price" numeric(14,2),
  "main_image" text,
  "features" jsonb not null default '[]'::jsonb,
  "badge_text" varchar(80),
  "is_featured" boolean not null default false,
  "is_active" boolean not null default true,
  "sort_order" integer not null default 0,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create table if not exists "kosha_package_components" (
  "id" serial primary key,
  "package_id" integer not null references "kosha_packages" ("id") on delete cascade,
  "component_type" varchar(30) not null,
  "component_id" integer not null,
  "is_default" boolean not null default false,
  "sort_order" integer not null default 0,
  "created_at" timestamp not null default now(),
  constraint "kosha_package_component_type_check" check ("component_type" in ('kosha', 'addon', 'welcome_board', 'accessory'))
);

alter table "kosha_bookings" add column if not exists "package_id" integer references "kosha_packages" ("id") on delete set null;
alter table "kosha_bookings" add column if not exists "package_name" text;
alter table "kosha_bookings" add column if not exists "package_price" numeric(14,2);

create unique index if not exists "kosha_package_components_unique_idx"
  on "kosha_package_components" ("package_id", "component_type", "component_id");
create index if not exists "kosha_packages_active_sort_idx"
  on "kosha_packages" ("is_active", "sort_order", "id");
create index if not exists "kosha_package_components_package_idx"
  on "kosha_package_components" ("package_id", "sort_order", "id");
create index if not exists "kosha_bookings_package_idx"
  on "kosha_bookings" ("package_id", "created_at");

insert into "kosha_packages" ("name", "slug", "description", "features", "badge_text", "is_featured", "sort_order")
values
  ('الباقة الفضية', 'silver-package', 'اختيار متوازن للحفلات الأنيقة بتنسيق أساسي متكامل.', '["كوشة أساسية","بورد ترحيب","ستاند حلقات","تنسيق بسيط"]'::jsonb, null, false, 10),
  ('الباقة الذهبية', 'gold-package', 'باقة فاخرة تجمع أهم تفاصيل ليلة الحنة في اختيار واحد.', '["كوشة فاخرة","بورد ترحيب","ستاند حلقات","دفوف حنة","مبخرة","مهفة"]'::jsonb, 'الأكثر طلباً', true, 20),
  ('باقة VIP', 'vip-package', 'التجربة الملكية الكاملة مع جميع تفاصيل التنسيق والإكسسوارات المميزة.', '["كوشة ملكية","بورد ترحيب فاخر","ستاند حلقات","دفوف حنة","مبخرة","مهفة","شال المهر","وثيقة","قصاصات","تنسيق VIP كامل"]'::jsonb, 'VIP', false, 30)
on conflict ("slug") do nothing;

insert into "kosha_addons" ("name", "sort_order")
values ('تنسيق بسيط', 70), ('تنسيق VIP كامل', 80)
on conflict ("name") do nothing;

insert into "kosha_package_components" ("package_id", "component_type", "component_id", "is_default", "sort_order")
select p.id, 'kosha', k.id, true, 0
from "kosha_packages" p
cross join lateral (
  select ranked.id
  from (
    select id, row_number() over (order by "sort_order", "id") as position
    from "koshas"
    where "is_active" = true
  ) ranked
  order by case when ranked.position = case p.slug when 'silver-package' then 1 when 'gold-package' then 2 else 3 end then 0 else 1 end, ranked.position
  limit 1
) k
where p.slug in ('silver-package', 'gold-package', 'vip-package')
on conflict do nothing;

insert into "kosha_package_components" ("package_id", "component_type", "component_id", "sort_order")
select p.id, 'welcome_board', b.id, 10
from "kosha_packages" p
join "kosha_welcome_boards" b on b.name = case p.slug
  when 'silver-package' then 'بورد ترحيب كلاسيك'
  when 'gold-package' then 'بورد ترحيب ذهبي'
  else 'بورد مرآة'
end
where p.slug in ('silver-package', 'gold-package', 'vip-package')
on conflict do nothing;

insert into "kosha_package_components" ("package_id", "component_type", "component_id", "sort_order")
select p.id, 'addon', a.id, 20
from "kosha_packages" p
join "kosha_addons" a on a.name = case when p.slug = 'vip-package' then 'تنسيق VIP كامل' else 'تنسيق بسيط' end
where p.slug in ('silver-package', 'gold-package', 'vip-package')
on conflict do nothing;

insert into "kosha_package_components" ("package_id", "component_type", "component_id", "sort_order")
select p.id, 'accessory', a.id, 30 + a.sort_order
from "kosha_packages" p
join "kosha_accessories" a on (
  (p.slug = 'silver-package' and a.name in ('ستاند حلقات')) or
  (p.slug = 'gold-package' and a.name in ('ستاند حلقات', 'دفوف حنة', 'مبخرة', 'مهفة')) or
  (p.slug = 'vip-package' and a.name in ('ستاند حلقات', 'دفوف حنة', 'مبخرة', 'مهفة', 'شال المهر', 'وثيقة', 'قصاصات'))
)
where p.slug in ('silver-package', 'gold-package', 'vip-package')
on conflict do nothing;
