import { pgTable, serial, text, numeric, integer, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const salesInvoicesTable = pgTable("sales_invoices", {
  id: serial("id").primaryKey(),
  invoiceNo: varchar("invoice_no", { length: 30 }).notNull().unique(),
  date: date("date").notNull().defaultNow(),
  customerName: text("customer_name").notNull().default(""),
  customerPhone: varchar("customer_phone", { length: 20 }),
  isInternal: integer("is_internal").notNull().default(0),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesInvoiceItemsTable = pgTable("sales_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => salesInvoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id"),
  productName: text("product_name").notNull().default(""),
  productNameAr: text("product_name_ar").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
});

export type SalesInvoice = typeof salesInvoicesTable.$inferSelect;
export type SalesInvoiceItem = typeof salesInvoiceItemsTable.$inferSelect;
