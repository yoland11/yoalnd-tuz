import { index, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Categories used exclusively by fixed assets. They are deliberately separate
 * from the storefront product categories so managing an equipment class never
 * changes the public catalogue.
 */
export const assetCategoriesTable = pgTable("asset_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  color: varchar("color", { length: 20 }),
  icon: varchar("icon", { length: 80 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: uniqueIndex("asset_categories_name_idx").on(table.name),
  createdIdx: index("asset_categories_created_idx").on(table.createdAt),
}));

export type AssetCategory = typeof assetCategoriesTable.$inferSelect;
