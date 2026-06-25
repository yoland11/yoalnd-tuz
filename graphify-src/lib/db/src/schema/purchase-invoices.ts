import { pgTable, serial, text, numeric, integer, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";
import { staffTable } from "./staff";
import { productsTable } from "./products";

export const purchaseInvoicesTable = pgTable("purchase_invoices", {
  id: serial("id").primaryKey(),
  invoiceNo: varchar("invoice_no", { length: 40 }).notNull().unique(),
  date: date("date").notNull(),
  supplierName: text("supplier_name").notNull().default(""),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  shippingCost: numeric("shipping_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("paid"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const purchaseInvoiceItemsTable = pgTable("purchase_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => purchaseInvoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  productName: text("product_name").notNull(),
  barcode: varchar("barcode", { length: 100 }),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  costPrice: numeric("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
  salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PurchaseInvoice = typeof purchaseInvoicesTable.$inferSelect;
export type InsertPurchaseInvoice = typeof purchaseInvoicesTable.$inferInsert;
export type PurchaseInvoiceItem = typeof purchaseInvoiceItemsTable.$inferSelect;
export type InsertPurchaseInvoiceItem = typeof purchaseInvoiceItemsTable.$inferInsert;
