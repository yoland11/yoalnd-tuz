import { boolean, index, integer, numeric, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { productsTable } from "./products";

export const productWholesalePriceTiersTable = pgTable("product_wholesale_price_tiers", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  minimumQuantity: numeric("minimum_quantity", { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  productMinimumUnique: uniqueIndex("product_wholesale_price_tiers_product_minimum_unique").on(table.productId, table.minimumQuantity),
  lookupIdx: index("product_wholesale_price_tiers_lookup_idx").on(table.productId, table.isActive, table.minimumQuantity),
}));

export const customerProductPricesTable = pgTable("customer_product_prices", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  customerProductUnique: uniqueIndex("customer_product_prices_customer_product_unique").on(table.customerId, table.productId),
  lookupIdx: index("customer_product_prices_lookup_idx").on(table.customerId, table.productId, table.isActive),
}));
