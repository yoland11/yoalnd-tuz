import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";
import { serviceOrdersTable } from "./services";

export const customerRewardHistoryTable = pgTable("customer_reward_history", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  serviceOrderId: integer("service_order_id").references(() => serviceOrdersTable.id),
  points: integer("points").notNull(),
  reason: varchar("reason", { length: 120 }).notNull().default("order_reward"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomerRewardHistory = typeof customerRewardHistoryTable.$inferSelect;
