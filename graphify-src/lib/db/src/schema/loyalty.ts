import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";
import { serviceOrdersTable } from "./services";

export const loyaltyPointsTable = pgTable("loyalty_points", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  serviceOrderId: integer("service_order_id").references(() => serviceOrdersTable.id),
  points: integer("points").notNull(),
  reason: varchar("reason", { length: 120 }).notNull().default("order_reward"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LoyaltyPoint = typeof loyaltyPointsTable.$inferSelect;
