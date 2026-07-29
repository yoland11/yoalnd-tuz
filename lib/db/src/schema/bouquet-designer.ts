import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { productsTable } from "./products";

// Components reuse products, preserving one source of truth for stock, price and media.
export const bouquetTemplatesTable = pgTable("bouquet_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  previewAssetUrl: text("preview_asset_url"),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  defaultColors: jsonb("default_colors").$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  archivedAt: timestamp("archived_at"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const bouquetTemplateItemsTable = pgTable("bouquet_template_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => bouquetTemplatesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull().default(1),
  role: varchar("role", { length: 32 }).notNull().default("FLOWER"),
  position: jsonb("position").$type<Record<string, unknown>>().notNull().default({}),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const bouquetPreviewSettingsTable = pgTable("bouquet_preview_settings", {
  id: serial("id").primaryKey(),
  defaultTemplateId: integer("default_template_id").references(() => bouquetTemplatesTable.id, { onDelete: "set null" }),
  backgroundUrl: text("background_url"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
