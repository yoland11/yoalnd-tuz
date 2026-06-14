import { pgTable, serial, text, numeric, integer, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";
import { serviceOrdersTable } from "./services";

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const receiptVouchersTable = pgTable("receipt_vouchers", {
  id: serial("id").primaryKey(),
  voucherNo: varchar("voucher_no", { length: 30 }).notNull().unique(),
  date: date("date").notNull().defaultNow(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  payerName: text("payer_name").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  bookingId: integer("booking_id").references(() => serviceOrdersTable.id),
  reference: text("reference"),
  method: varchar("method", { length: 20 }).notNull().default("cash"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paymentVouchersTable = pgTable("payment_vouchers", {
  id: serial("id").primaryKey(),
  voucherNo: varchar("voucher_no", { length: 30 }).notNull().unique(),
  date: date("date").notNull().defaultNow(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  payeeName: text("payee_name").notNull(),
  reference: text("reference"),
  method: varchar("method", { length: 20 }).notNull().default("cash"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().defaultNow(),
  name: text("name").notNull().default(""),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: integer("category_id").references(() => expenseCategoriesTable.id),
  categoryName: text("category_name").notNull().default(""),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  receiptImage: text("receipt_image"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ReceiptVoucher = typeof receiptVouchersTable.$inferSelect;
export type PaymentVoucher = typeof paymentVouchersTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
