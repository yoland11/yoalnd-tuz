import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureGraduationEnterpriseTables } from "@/server/graduation-enterprise-schema";

let mediaTablesReady: Promise<void> | null = null;

/** Additive compatibility guard; mirrors migration 0071 without deleting data. */
export async function ensureGraduationMediaTables() {
  if (!mediaTablesReady) {
    mediaTablesReady = (async () => {
      await ensureGraduationEnterpriseTables();
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS gallery_items (
          id serial PRIMARY KEY, media_url text NOT NULL,
          media_type varchar(10) NOT NULL DEFAULT 'image',
          image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          title text, title_ar text, category varchar(50) NOT NULL DEFAULT 'general',
          created_at timestamp NOT NULL DEFAULT now()
        );
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS description text;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS thumbnail_url text;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS scope varchar(40) NOT NULL DEFAULT 'general';
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS display_location varchar(40) NOT NULL DEFAULT 'gallery';
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT true;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS archived_at timestamp;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS deleted_at timestamp;
        ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
        CREATE INDEX IF NOT EXISTS gallery_items_scope_order_idx ON gallery_items(scope,display_order);
        CREATE INDEX IF NOT EXISTS gallery_items_visibility_idx ON gallery_items(scope,is_active,customer_visible);

        CREATE TABLE IF NOT EXISTS graduation_media_links (
          id serial PRIMARY KEY,
          media_id integer NOT NULL REFERENCES gallery_items(id) ON DELETE RESTRICT,
          target_type varchar(24) NOT NULL,
          template_id integer REFERENCES graduation_templates(id) ON DELETE RESTRICT,
          package_id integer REFERENCES graduation_packages(id) ON DELETE RESTRICT,
          is_primary boolean NOT NULL DEFAULT false,
          sort_order integer NOT NULL DEFAULT 0,
          created_at timestamp NOT NULL DEFAULT now(),
          CHECK ((target_type='template' AND template_id IS NOT NULL AND package_id IS NULL)
            OR (target_type='package' AND package_id IS NOT NULL AND template_id IS NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_media_links_template_unique_idx
          ON graduation_media_links(media_id,template_id) WHERE template_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS graduation_media_links_package_unique_idx
          ON graduation_media_links(media_id,package_id) WHERE package_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS graduation_media_links_media_idx ON graduation_media_links(media_id);
        CREATE INDEX IF NOT EXISTS graduation_media_links_template_idx ON graduation_media_links(template_id,sort_order);
        CREATE INDEX IF NOT EXISTS graduation_media_links_package_idx ON graduation_media_links(package_id,sort_order);
      `);
    })().catch((error) => {
      mediaTablesReady = null;
      throw error;
    });
  }
  await mediaTablesReady;
}

