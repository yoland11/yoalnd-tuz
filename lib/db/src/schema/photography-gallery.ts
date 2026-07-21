import { boolean, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { photographyShootsTable } from "./photography-shoots";

/**
 * Client delivery galleries.
 *
 * Object storage is not provisioned, so a gallery is a password-protected delivery page:
 * small preview images ride the existing data-URL media pipeline, while full-resolution
 * deliverables are external links. No original file ever transits this API.
 */
export const photographyGalleriesTable = pgTable(
  "photography_galleries",
  {
    id: serial("id").primaryKey(),
    shootId: integer("shoot_id")
      .notNull()
      .unique()
      .references(() => photographyShootsTable.id, { onDelete: "cascade" }),

    // The share link. Long and random — it is the primary access control.
    slug: varchar("slug", { length: 32 }).notNull().unique(),
    title: text("title").notNull().default(""),

    // Optional second factor. Stored as a salted hash, never in clear text.
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),

    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").notNull().default(true),

    viewCount: integer("view_count").notNull().default(0),
    downloadCount: integer("download_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at"),

    notes: text("notes"),
    createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    activeIdx: index("photography_galleries_active_idx").on(table.isActive, table.expiresAt),
  }),
);

export const photographyGalleryItemsTable = pgTable(
  "photography_gallery_items",
  {
    id: serial("id").primaryKey(),
    galleryId: integer("gallery_id")
      .notNull()
      .references(() => photographyGalleriesTable.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Small preview only — served through the existing media route. */
    previewImage: text("preview_image"),
    /** Where the client actually downloads the full-resolution file. */
    downloadUrl: text("download_url"),
    kind: varchar("kind", { length: 20 }).notNull().default("photo"),
    sortOrder: integer("sort_order").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    downloadCount: integer("download_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    galleryIdx: index("photography_gallery_items_gallery_idx").on(table.galleryId, table.sortOrder),
  }),
);

/** One row per client action, so download tracking and favourites are auditable. */
export const photographyGalleryEventsTable = pgTable(
  "photography_gallery_events",
  {
    id: serial("id").primaryKey(),
    galleryId: integer("gallery_id")
      .notNull()
      .references(() => photographyGalleriesTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => photographyGalleryItemsTable.id, { onDelete: "cascade" }),
    /** view | download | favorite | unfavorite | unlock_failed */
    type: varchar("type", { length: 20 }).notNull(),
    /** Opaque per-browser token; no personal data is stored. */
    visitorToken: varchar("visitor_token", { length: 64 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    galleryIdx: index("photography_gallery_events_gallery_idx").on(table.galleryId, table.type, table.createdAt),
  }),
);

export type PhotographyGallery = typeof photographyGalleriesTable.$inferSelect;
export type PhotographyGalleryItem = typeof photographyGalleryItemsTable.$inferSelect;
export type PhotographyGalleryEvent = typeof photographyGalleryEventsTable.$inferSelect;
