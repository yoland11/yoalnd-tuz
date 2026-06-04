import { pgTable, serial, text, boolean, varchar, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  description: text("description"),
  descriptionAr: text("description_ar"),
  type: varchar("type", { length: 50 }).notNull(),
  icon: text("icon"),
  image: text("image"),
  imageMetadata: jsonb("image_metadata").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const serviceOrdersTable = pgTable("service_orders", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id),
  trackingCode: varchar("tracking_code", { length: 20 }),
  qrToken: varchar("qr_token", { length: 80 }),
  phoneLast4: varchar("phone_last4", { length: 4 }),
  customerName: text("customer_name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  eventDate: text("event_date"),
  eventLocation: text("event_location"),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  rewardPointsAwarded: integer("reward_points_awarded").notNull().default(0),
  customFields: jsonb("custom_fields"),
  internalNotes: text("internal_notes"),
  customerConfirmation: varchar("customer_confirmation", { length: 30 }),
  requestedDate: text("requested_date"),
  confirmationNote: text("confirmation_note"),
  confirmationAt: timestamp("confirmation_at"),
  preRescheduleStatus: varchar("pre_reschedule_status", { length: 30 }),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const serviceOrderStatusHistoryTable = pgTable("service_order_status_history", {
  id: serial("id").primaryKey(),
  serviceOrderId: integer("service_order_id").notNull().references(() => serviceOrdersTable.id),
  status: varchar("status", { length: 30 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ServiceOrderStatusHistory = typeof serviceOrderStatusHistoryTable.$inferSelect;

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;

export const insertServiceOrderSchema = createInsertSchema(serviceOrdersTable).omit({ id: true, createdAt: true });
export type InsertServiceOrder = z.infer<typeof insertServiceOrderSchema>;
export type ServiceOrder = typeof serviceOrdersTable.$inferSelect;
