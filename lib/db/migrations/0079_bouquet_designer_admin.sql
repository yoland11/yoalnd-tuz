-- The designer shares `products` with Store: no duplicated stock, pricing or media.
alter table "products"
  add column if not exists "preview_position" jsonb,
  add column if not exists "accessory_type" varchar(60),
  add column if not exists "maximum_quantity_per_bouquet" integer;

create table if not exists "bouquet_templates" (
  "id" serial primary key,
  "name" text not null,
  "description" text,
  "product_id" integer references "products"("id") on delete set null,
  "preview_asset_url" text,
  "configuration" jsonb not null default '{}'::jsonb,
  "default_colors" jsonb not null default '{}'::jsonb,
  "is_default" boolean not null default false,
  "is_active" boolean not null default true,
  "archived_at" timestamp,
  "display_order" integer not null default 0,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);
create table if not exists "bouquet_template_items" (
  "id" serial primary key,
  "template_id" integer not null references "bouquet_templates"("id") on delete cascade,
  "product_id" integer not null references "products"("id") on delete restrict,
  "quantity" integer not null default 1 check ("quantity" > 0),
  "role" varchar(32) not null default 'FLOWER',
  "position" jsonb not null default '{}'::jsonb,
  "display_order" integer not null default 0,
  "created_at" timestamp not null default now()
);
create table if not exists "bouquet_preview_settings" (
  "id" serial primary key,
  "default_template_id" integer references "bouquet_templates"("id") on delete set null,
  "background_url" text,
  "settings" jsonb not null default '{}'::jsonb,
  "updated_by" integer,
  "updated_at" timestamp not null default now()
);
create index if not exists "bouquet_templates_active_order_idx" on "bouquet_templates" ("is_active", "display_order");
create index if not exists "bouquet_template_items_template_idx" on "bouquet_template_items" ("template_id", "display_order");
update "products"
set "preview_position" = coalesce("preview_position", '{"x":50,"y":50,"anchor":"center"}'::jsonb)
where "show_in_bouquet_builder" = true or "available_in_bouquet_designer" = true;
