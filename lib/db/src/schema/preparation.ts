import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { staffTable } from "./staff";
import { tasksTable } from "./admin-extensions";

/** Operational preparation only: no invoice, booking, reservation or stock movement. */
export const preparationRequestsTable = pgTable("preparation_requests", {
  id: serial("id").primaryKey(),
  requestNo: varchar("request_no", { length: 40 }),
  requestToken: varchar("request_token", { length: 80 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "restrict" }),
  customerName: text("customer_name").notNull(),
  occasionName: text("occasion_name"),
  eventDate: date("event_date"),
  status: varchar("status", { length: 30 }).notNull().default("active"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("preparation_requests_token_uq").on(table.requestToken),
  uniqueIndex("preparation_requests_no_uq").on(table.requestNo),
  index("preparation_requests_customer_idx").on(table.customerId),
  index("preparation_requests_event_idx").on(table.eventDate),
]);

export const preparationRequestItemsTable = pgTable("preparation_request_items", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => preparationRequestsTable.id, { onDelete: "restrict" }),
  source: varchar("source", { length: 20 }).notNull(),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  sku: varchar("sku", { length: 120 }),
  department: varchar("department", { length: 40 }).notNull().default("other"),
  quantity: integer("quantity").notNull(),
  infoOnly: boolean("info_only").notNull().default(false),
  status: varchar("status", { length: 30 }).notNull().default("preparing"),
  assigneeId: integer("assignee_id").references(() => staffTable.id),
  taskId: integer("task_id").references(() => tasksTable.id),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("preparation_request_items_request_idx").on(table.requestId),
  check("preparation_request_items_quantity_ck", sql`${table.quantity} > 0`),
  check("preparation_request_items_source_ck", sql`${table.source} IN ('product', 'asset', 'custom')`),
]);
