import { date, integer, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffTable } from "./staff";

export const PHOTOGRAPHY_ORDER_STAGES = ["registered", "editing", "ready_print", "ready_pickup", "delivered"] as const;
export type PhotographyOrderStage = (typeof PHOTOGRAPHY_ORDER_STAGES)[number];

export const photographyEventsTable = pgTable("photography_events", {
  id: serial("id").primaryKey(),
  clientToken: varchar("client_token", { length: 64 }).notNull().unique(),
  groomName: text("groom_name").notNull(),
  eventName: text("event_name"),
  eventDate: date("event_date").notNull(),
  location: text("location"),
  assignedStaffId: integer("assigned_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  assignedStaffName: text("assigned_staff_name").notNull().default(""),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const photographyOrdersTable = pgTable("photography_orders", {
  id: serial("id").primaryKey(),
  clientToken: varchar("client_token", { length: 64 }).notNull().unique(),
  orderNo: varchar("order_no", { length: 40 }).notNull().unique(),
  eventId: integer("event_id").notNull().references(() => photographyEventsTable.id, { onDelete: "restrict" }),
  assignedStaffId: integer("assigned_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  copies: integer("copies").notNull().default(1),
  printType: varchar("print_type", { length: 30 }).notNull().default("10x15"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  photoNumber: varchar("photo_number", { length: 120 }),
  notes: text("notes"),
  referenceImage: text("reference_image"),
  status: varchar("status", { length: 30 }).notNull().default("registered"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const photographyOrderEventsTable = pgTable("photography_order_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => photographyOrdersTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  type: varchar("type", { length: 40 }).notNull(),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const photographyPaymentRequestsTable = pgTable("photography_payment_requests", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => photographyOrdersTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull().default(""),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  financialTransactionId: integer("financial_transaction_id"),
  reviewedByStaffId: integer("reviewed_by_staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPhotographyEventSchema = createInsertSchema(photographyEventsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPhotographyOrderSchema = createInsertSchema(photographyOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPhotographyOrderEventSchema = createInsertSchema(photographyOrderEventsTable).omit({ id: true, createdAt: true });
export const insertPhotographyPaymentRequestSchema = createInsertSchema(photographyPaymentRequestsTable).omit({ id: true, createdAt: true });

export type PhotographyEvent = typeof photographyEventsTable.$inferSelect;
export type PhotographyOrder = typeof photographyOrdersTable.$inferSelect;
export type PhotographyOrderEvent = typeof photographyOrderEventsTable.$inferSelect;
export type PhotographyPaymentRequest = typeof photographyPaymentRequestsTable.$inferSelect;
export type InsertPhotographyEvent = z.infer<typeof insertPhotographyEventSchema>;
export type InsertPhotographyOrder = z.infer<typeof insertPhotographyOrderSchema>;
