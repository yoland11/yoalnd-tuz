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
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("gallery_items_scope_order_idx").on(table.scope, table.displayOrder),
  index("gallery_items_visibility_idx").on(table.scope, table.isActive, table.customerVisible),
]);

export const insertGalleryItemSchema = createInsertSchema(galleryItemsTable).omit({ id: true, createdAt: true });
export type InsertGalleryItem = z.infer<typeof insertGalleryItemSchema>;
export type GalleryItem = typeof galleryItemsTable.$inferSelect;
