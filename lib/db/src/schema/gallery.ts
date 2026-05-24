import { pgTable, serial, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const galleryItemsTable = pgTable("gallery_items", {
  id: serial("id").primaryKey(),
  mediaUrl: text("media_url").notNull(),
  mediaType: varchar("media_type", { length: 10 }).notNull().default("image"),
  imageMetadata: jsonb("image_metadata").$type<Record<string, unknown>>().notNull().default({}),
  title: text("title"),
  titleAr: text("title_ar"),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertGalleryItemSchema = createInsertSchema(galleryItemsTable).omit({ id: true, createdAt: true });
export type InsertGalleryItem = z.infer<typeof insertGalleryItemSchema>;
export type GalleryItem = typeof galleryItemsTable.$inferSelect;
