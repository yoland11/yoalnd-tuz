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
  sharedStockProductId: integer("shared_stock_product_id"),
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

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id),
  stockSourceProductId: integer("stock_source_product_id").references(() => productsTable.id),
  quantityChange: numeric("quantity_change", { precision: 12, scale: 3 }).notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  relatedType: varchar("related_type", { length: 40 }),
  relatedId: integer("related_id"),
  createdBy: integer("created_by"),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
