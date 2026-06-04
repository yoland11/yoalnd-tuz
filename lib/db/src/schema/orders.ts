import { pgTable, serial, text, numeric, integer, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  trackingCode: varchar("tracking_code", { length: 20 }).notNull(),
  qrToken: varchar("qr_token", { length: 80 }),
  phoneLast4: varchar("phone_last4", { length: 4 }),
  customerId: integer("customer_id").references(() => customersTable.id),
  customerName: text("customer_name").notNull(),
  customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  serviceType: varchar("service_type", { length: 30 }),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  couponCode: varchar("coupon_code", { length: 60 }),
  couponDiscountAmount: numeric("coupon_discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  loyaltyPointsRedeemed: integer("loyalty_points_redeemed").notNull().default(0),
  loyaltyDiscountAmount: numeric("loyalty_discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cod"),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  rewardPointsAwarded: integer("reward_points_awarded").notNull().default(0),
  governorate: text("governorate"),
  area: text("area"),
  address: text("address"),
  mapsUrl: text("maps_url"),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  internalNotes: text("internal_notes"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  productNameAr: text("product_name_ar").notNull().default(""),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  selectedColor: text("selected_color"),
  selectedColorData: jsonb("selected_color_data").$type<{ name: string; hex: string; image?: string | null; imageUrl?: string | null } | null>(),
  customization: text("customization"),
  image: text("image"),
});

export const orderStatusHistoryTable = pgTable("order_status_history", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  status: varchar("status", { length: 30 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
