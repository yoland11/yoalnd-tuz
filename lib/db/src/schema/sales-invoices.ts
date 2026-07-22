import { pgTable, serial, text, numeric, integer, timestamp, varchar, date, boolean, jsonb } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { staffTable } from "./staff";
import { productsTable } from "./products";
import { suppliersTable } from "./suppliers";

export const salesInvoicesTable = pgTable("sales_invoices", {
  id: serial("id").primaryKey(),
  invoiceNo: varchar("invoice_no", { length: 40 }).notNull().unique(),
  qrToken: varchar("qr_token", { length: 80 }),
  date: date("date").notNull(),
  customerName: text("customer_name").notNull().default(""),
  customerPhone: varchar("customer_phone", { length: 30 }),
  customerId: integer("customer_id").references(() => customersTable.id),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  couponCode: varchar("coupon_code", { length: 60 }),
  couponDiscountAmount: numeric("coupon_discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("paid"),
  dueDate: date("due_date"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  financiallyReversed: boolean("financially_reversed").notNull().default(false),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: integer("cancelled_by").references(() => staffTable.id),
  cancelledByName: text("cancelled_by_name"),
  cancellationReason: text("cancellation_reason"),
  cancelledOriginalPaidAmount: numeric("cancelled_original_paid_amount", { precision: 14, scale: 2 }),
  cancelledOriginalRemainingAmount: numeric("cancelled_original_remaining_amount", { precision: 14, scale: 2 }),
  reversalReferences: jsonb("reversal_references").$type<Record<string, unknown>>().notNull().default({}),
  reversalCompletedAt: timestamp("reversal_completed_at"),
  inventoryReversed: boolean("inventory_reversed").notNull().default(false),
  financeReversed: boolean("finance_reversed").notNull().default(false),
  isInternal: integer("is_internal").notNull().default(0),
  stockApplied: integer("stock_applied").notNull().default(1),
  stockRestoredAt: timestamp("stock_restored_at"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesInvoiceItemsTable = pgTable("sales_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => salesInvoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  productName: text("product_name").notNull(),
  barcode: varchar("barcode", { length: 100 }),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  costPrice: numeric("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SalesInvoice = typeof salesInvoicesTable.$inferSelect;
export type InsertSalesInvoice = typeof salesInvoicesTable.$inferInsert;
export type SalesInvoiceItem = typeof salesInvoiceItemsTable.$inferSelect;
export type InsertSalesInvoiceItem = typeof salesInvoiceItemsTable.$inferInsert;
