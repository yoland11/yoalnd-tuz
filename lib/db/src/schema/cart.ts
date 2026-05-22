import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { productsTable } from "./products";

export const cartItemsTable = pgTable("cart_items", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  quantity: integer("quantity").notNull().default(1),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  selectedColor: text("selected_color"),
  customization: text("customization"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CartItem = typeof cartItemsTable.$inferSelect;
