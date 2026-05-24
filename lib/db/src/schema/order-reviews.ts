import { pgTable, serial, integer, text, timestamp, varchar, uniqueIndex } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const orderReviewsTable = pgTable("order_reviews", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id),
  orderKind: varchar("order_kind", { length: 20 }).notNull(),
  orderId: integer("order_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqOrderReview: uniqueIndex("order_reviews_kind_order_customer_idx").on(table.orderKind, table.orderId, table.customerId),
}));

export type OrderReview = typeof orderReviewsTable.$inferSelect;
