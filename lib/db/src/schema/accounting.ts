import { sql } from "drizzle-orm";
import { check, index, pgTable, serial, text, numeric, integer, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";
import { serviceOrdersTable } from "./services";
import { koshaBookingsTable, koshasTable } from "./koshas";
import { suppliersTable } from "./suppliers";
import { koshaConstructionProjectsTable } from "./kosha-finance";

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
  koshaBookingId: integer("kosha_booking_id"),
  reference: text("reference"),
  method: varchar("method", { length: 20 }).notNull().default("cash"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("executed"),
  financialTransactionId: integer("financial_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * The allocation is the source of truth for where a receipt was applied.  A
 * voucher can be split across several documents; the voucher header must not
 * be used as the allocation ledger.
 */
export const receiptVoucherAllocationsTable = pgTable("receipt_voucher_allocations", {
  id: serial("id").primaryKey(),
  receiptVoucherId: integer("receipt_voucher_id").notNull().references(() => receiptVouchersTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  sourceType: varchar("source_type", { length: 40 }).notNull(),
  sourceId: integer("source_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  postedAt: timestamp("posted_at"),
  reversedAt: timestamp("reversed_at"),
  reversedBy: integer("reversed_by").references(() => staffTable.id, { onDelete: "set null" }),
  reversalReason: text("reversal_reason"),
  reversalTransactionId: integer("reversal_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paymentVouchersTable = pgTable("payment_vouchers", {
  id: serial("id").primaryKey(),
  voucherNo: varchar("voucher_no", { length: 30 }).notNull().unique(),
  date: date("date").notNull().defaultNow(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  payeeName: text("payee_name").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  reference: text("reference"),
  method: varchar("method", { length: 20 }).notNull().default("cash"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("executed"),
  financialTransactionId: integer("financial_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().defaultNow(),
  name: text("name").notNull().default(""),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: integer("category_id").references(() => expenseCategoriesTable.id),
  costCategory: varchar("cost_category", { length: 20 }),
  koshaId: integer("kosha_id").references(() => koshasTable.id, { onDelete: "set null" }),
  constructionProjectId: integer("construction_project_id").references(() => koshaConstructionProjectsTable.id, { onDelete: "set null" }),
  bookingId: integer("booking_id").references(() => koshaBookingsTable.id, { onDelete: "set null" }),
  expenseType: varchar("expense_type", { length: 40 }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  beneficiaryName: text("beneficiary_name"),
  responsibleEmployeeId: integer("responsible_employee_id").references(() => staffTable.id, { onDelete: "set null" }),
  categoryName: text("category_name").notNull().default(""),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  receiptImage: text("receipt_image"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  updatedBy: integer("updated_by").references(() => staffTable.id),
  updatedByName: text("updated_by_name").notNull().default(""),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("executed"),
  financialTransactionId: integer("financial_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  koshaCategoryIdx: index("expenses_kosha_category_idx").on(table.koshaId, table.costCategory, table.date),
  bookingIdx: index("expenses_booking_idx").on(table.bookingId),
  costCategoryCheck: check(
    "expenses_kosha_cost_category_check",
    sql`${table.costCategory} IS NULL OR ${table.costCategory} IN ('investment', 'operating', 'booking')`,
  ),
  bookingCategoryCheck: check(
    "expenses_kosha_booking_category_check",
    sql`${table.costCategory} <> 'booking' OR ${table.bookingId} IS NOT NULL`,
  ),
}));

export type ReceiptVoucher = typeof receiptVouchersTable.$inferSelect;
export type ReceiptVoucherAllocation = typeof receiptVoucherAllocationsTable.$inferSelect;
export type PaymentVoucher = typeof paymentVouchersTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
