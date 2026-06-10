import { pgTable, serial, text, numeric, integer, boolean, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  nameKu: text("name_ku"),
  nameTr: text("name_tr"),
  description: text("description"),
  descriptionAr: text("description_ar"),
  descriptionKu: text("description_ku"),
  descriptionTr: text("description_tr"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: numeric("original_price", { precision: 10, scale: 2 }),
  costPrice: numeric("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
  stock: integer("stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  barcode: varchar("barcode", { length: 100 }),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  subcategoryId: integer("subcategory_id").references(() => categoriesTable.id),
  category: varchar("category", { length: 100 }),
  subcategory: varchar("subcategory", { length: 100 }),
  images: jsonb("images").$type<string[]>().notNull().default([]),
  videos: jsonb("videos").$type<string[]>().notNull().default([]),
  imageMetadata: jsonb("image_metadata").$type<Record<string, unknown>[]>().notNull().default([]),
  colors: jsonb("colors").$type<Array<string | { name: string; hex: string; image?: string | null; imageUrl?: string | null }>>().notNull().default([]),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
