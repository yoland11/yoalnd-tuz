import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

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
  // The database migration owns the self-referencing FK. Keeping this as a
  // plain integer avoids a circular TypeScript schema initializer.
  parentId: integer("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: uniqueIndex("asset_categories_name_idx").on(table.name),
  createdIdx: index("asset_categories_created_idx").on(table.createdAt),
  parentIdx: index("asset_categories_parent_idx").on(table.parentId),
  activeSortIdx: index("asset_categories_active_sort_idx").on(table.isActive, table.sortOrder),
}));

export type AssetCategory = typeof assetCategoriesTable.$inferSelect;
