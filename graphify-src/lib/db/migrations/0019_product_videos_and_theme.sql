alter table "products"
  add column if not exists "videos" jsonb not null default '[]'::jsonb;
