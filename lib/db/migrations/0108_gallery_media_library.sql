-- AJN central media library. Additive only: existing gallery_items and media URLs stay untouched.
CREATE TABLE IF NOT EXISTS gallery_categories (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL,
  slug varchar(120) NOT NULL UNIQUE,
  parent_id integer REFERENCES gallery_categories(id) ON DELETE RESTRICT,
  cover_media_id integer REFERENCES gallery_items(id) ON DELETE SET NULL,
  icon varchar(60),
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gallery_categories_parent_idx ON gallery_categories(parent_id, display_order);

ALTER TABLE gallery_items
  ADD COLUMN IF NOT EXISTS category_id integer REFERENCES gallery_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS gallery_items_category_status_idx ON gallery_items(category_id, status);

CREATE TABLE IF NOT EXISTS gallery_tags (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gallery_media_tags (
  media_id integer NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES gallery_tags(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, tag_id)
);
CREATE INDEX IF NOT EXISTS gallery_media_tags_tag_idx ON gallery_media_tags(tag_id);

CREATE TABLE IF NOT EXISTS gallery_albums (
  id serial PRIMARY KEY,
  name varchar(140) NOT NULL,
  description text,
  cover_media_id integer REFERENCES gallery_items(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'published',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gallery_album_media (
  album_id integer NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  media_id integer NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, media_id)
);
CREATE INDEX IF NOT EXISTS gallery_album_media_media_idx ON gallery_album_media(media_id);
