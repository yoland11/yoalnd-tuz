import { pgTable, serial, text, numeric, integer, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  invoiceNo: varchar("invoice_no", { length: 50 }),
  date: date("date").notNull().defaultNow(),
  supplierName: text("supplier_name").notNull().default(""),
  supplierPhone: varchar("supplier_phone", { length: 20 }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  extraCosts: numeric("extra_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const purchaseItemsTable = pgTable("purchase_items", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull().references(() => purchasesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id"),
  productName: text("product_name").notNull().default(""),
  productNameAr: text("product_name_ar").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull().default("0"),
  sellPrice: numeric("sell_price", { precision: 12, scale: 2 }),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
});

export type Purchase = typeof purchasesTable.$inferSelect;
export type PurchaseItem = typeof purchaseItemsTable.$inferSelect;
