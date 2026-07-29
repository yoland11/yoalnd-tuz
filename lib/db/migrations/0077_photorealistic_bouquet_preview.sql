-- Product gallery images remain store media. These columns are used only by
-- the florist preview engine and accept transparent PNG/WebP cut-outs.
alter table "products"
  add column if not exists "show_in_bouquet_builder" boolean not null default false,
  add column if not exists "preview_cutout_url" text,
  add column if not exists "ready_made_preview_url" text,
  add column if not exists "preview_rotation" numeric(7,2),
  add column if not exists "is_ready_made_bouquet" boolean not null default false;

update "products"
set
  "show_in_bouquet_builder" = "available_in_bouquet_designer",
  "preview_cutout_url" = coalesce("preview_cutout_url", "preview_asset_url"),
  "is_ready_made_bouquet" = "is_bouquet_template"
where "available_in_bouquet_designer" = true
   or "preview_asset_url" is not null
   or "is_bouquet_template" = true;

create index if not exists "products_bouquet_builder_preview_idx"
  on "products" ("show_in_bouquet_builder", "is_ready_made_bouquet", "is_active");
