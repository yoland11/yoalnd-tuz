import { pgTable, serial, text, numeric, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { salesInvoicesTable } from "./sales-invoices";

export const couponsTable = pgTable("coupons", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 60 }).notNull().unique(),
  title: text("title").notNull().default(""),
  type: varchar("type", { length: 20 }).notNull().default("fixed"),
  value: numeric("value", { precision: 14, scale: 2 }).notNull().default("0"),
  minOrderAmount: numeric("min_order_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  usageLimit: integer("usage_limit"),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const couponUsagesTable = pgTable("coupon_usages", {
  id: serial("id").primaryKey(),
  couponId: integer("coupon_id").notNull().references(() => couponsTable.id),
  customerPhone: varchar("customer_phone", { length: 30 }),
  orderId: integer("order_id").references(() => ordersTable.id),
  salesInvoiceId: integer("sales_invoice_id").references(() => salesInvoicesTable.id),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Coupon = typeof couponsTable.$inferSelect;
export type CouponUsage = typeof couponUsagesTable.$inferSelect;
