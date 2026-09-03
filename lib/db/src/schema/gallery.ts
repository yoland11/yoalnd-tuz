import { boolean, index, integer, pgTable, serial, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const galleryItemsTable = pgTable("gallery_items", {
  id: serial("id").primaryKey(),
  mediaUrl: text("media_url").notNull(),
  mediaType: varchar("media_type", { length: 10 }).notNull().default("image"),
  imageMetadata: jsonb("image_metadata").$type<Record<string, unknown>>().notNull().default({}),
  title: text("title"),
  titleAr: text("title_ar"),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  scope: varchar("scope", { length: 40 }).notNull().default("general"),
  displayLocation: varchar("display_location", { length: 40 }).notNull().default("gallery"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  customerVisible: boolean("customer_visible").notNull().default(true),
  categoryId: integer("category_id"),
  status: varchar("status", { length: 20 }).notNull().default("published"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  visibility: jsonb("visibility").$type<string[]>().notNull().default([]),
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("gallery_items_scope_order_idx").on(table.scope, table.displayOrder),
  index("gallery_items_visibility_idx").on(table.scope, table.isActive, table.customerVisible),
  index("gallery_items_category_status_idx").on(table.categoryId, table.status),
]);

/** A category may have a parent; media uses the leaf category when selected. */
export const galleryCategoriesTable = pgTable("gallery_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  parentId: integer("parent_id"),
  coverMediaId: integer("cover_media_id"),
  icon: varchar("icon", { length: 60 }),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("gallery_categories_parent_idx").on(table.parentId, table.displayOrder)]);

export const galleryTagsTable = pgTable("gallery_tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const galleryMediaTagsTable = pgTable("gallery_media_tags", {
  mediaId: integer("media_id").notNull(),
  tagId: integer("tag_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("gallery_media_tags_media_idx").on(table.mediaId),
  index("gallery_media_tags_tag_idx").on(table.tagId),
]);

/** Albums are independent collections. A single gallery item can join many albums. */
export const galleryAlbumsTable = pgTable("gallery_albums", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 140 }).notNull(),
  description: text("description"),
  coverMediaId: integer("cover_media_id"),
  status: varchar("status", { length: 20 }).notNull().default("published"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const galleryAlbumMediaTable = pgTable("gallery_album_media", {
  albumId: integer("album_id").notNull(),
  mediaId: integer("media_id").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("gallery_album_media_album_idx").on(table.albumId, table.displayOrder),
  index("gallery_album_media_media_idx").on(table.mediaId),
]);

export const insertGalleryItemSchema = createInsertSchema(galleryItemsTable).omit({ id: true, createdAt: true });
export type InsertGalleryItem = z.infer<typeof insertGalleryItemSchema>;
export type GalleryItem = typeof galleryItemsTable.$inferSelect;
