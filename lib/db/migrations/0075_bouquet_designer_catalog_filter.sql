-- Keep the store catalog and Bouquet Designer on one products table. Products
-- outside the flower taxonomy need an explicit administrative opt-in.
alter table "products"
  add column if not exists "available_in_bouquet_designer" boolean not null default false;

create index if not exists "products_bouquet_designer_active_idx"
  on "products" ("available_in_bouquet_designer", "is_active");
