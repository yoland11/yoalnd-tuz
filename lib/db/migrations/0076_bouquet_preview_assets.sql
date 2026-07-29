-- Preview-specific data is deliberately separate from product media.  Store
-- product images remain available for cards and orders, never as bouquet layers.
alter table "products"
  add column if not exists "bouquet_element_type" varchar(24),
  add column if not exists "preview_asset_url" text,
  add column if not exists "preview_color" varchar(32),
  add column if not exists "preview_scale" numeric(6,3),
  add column if not exists "preview_layer" integer,
  add column if not exists "bouquet_recipe" jsonb not null default '[]'::jsonb,
  add column if not exists "is_bouquet_template" boolean not null default false;

create index if not exists "products_bouquet_preview_type_idx"
  on "products" ("available_in_bouquet_designer", "bouquet_element_type", "is_active");
