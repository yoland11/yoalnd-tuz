import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { suppliersTable } from "./suppliers";
import { financialTransactionsTable } from "./master-cash-box";

/** Separate employee entitlements and debts; base salary is never changed. */
export const employeeFinanceEntriesTable = pgTable("employee_finance_entries", {
  id: serial("id").primaryKey(), entryNo: varchar("entry_no", { length: 50 }).notNull().unique(),
  employeeId: integer("employee_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  entryType: varchar("entry_type", { length: 50 }).notNull(), direction: varchar("direction", { length: 24 }).notNull(),
  entryDate: date("entry_date").notNull(), amount: numeric("amount", { precision: 16, scale: 2 }).notNull(), settledAmount: numeric("settled_amount", { precision: 16, scale: 2 }).notNull().default("0"), remainingAmount: numeric("remaining_amount", { precision: 16, scale: 2 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending"), category: varchar("category", { length: 100 }), description: text("description").notNull(), notes: text("notes"), attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
  sourceType: varchar("source_type", { length: 60 }), sourceId: varchar("source_id", { length: 80 }), supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }), invoiceNo: varchar("invoice_no", { length: 120 }),
  submittedBy: integer("submitted_by").references(() => staffTable.id, { onDelete: "set null" }), submittedByName: text("submitted_by_name").notNull().default(""), approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }), approvedByName: text("approved_by_name").notNull().default(""), approvedAt: timestamp("approved_at"), rejectedBy: integer("rejected_by").references(() => staffTable.id, { onDelete: "set null" }), rejectedAt: timestamp("rejected_at"), rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  employeeIdx: index("employee_finance_entries_employee_idx").on(table.employeeId, table.entryDate),
  statusIdx: index("employee_finance_entries_status_idx").on(table.status, table.direction),
  sourceUniqueIdx: uniqueIndex("employee_finance_entries_source_unique_idx").on(table.sourceType, table.sourceId).where(sql`source_type is not null and source_id is not null`),
}));

export const employeeFinanceSettlementsTable = pgTable("employee_finance_settlements", {
  id: serial("id").primaryKey(), entryId: integer("entry_id").notNull().references(() => employeeFinanceEntriesTable.id, { onDelete: "restrict" }),
  settlementType: varchar("settlement_type", { length: 30 }).notNull(), amount: numeric("amount", { precision: 16, scale: 2 }).notNull(), settlementDate: date("settlement_date").notNull(), paymentMethod: varchar("payment_method", { length: 20 }), notes: text("notes"),
  financialTransactionId: integer("financial_transaction_id").references(() => financialTransactionsTable.id, { onDelete: "restrict" }), payrollLineId: integer("payroll_line_id"), idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull().unique(), createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }), createdByName: text("created_by_name").notNull().default(""), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({ entryIdx: index("employee_finance_settlements_entry_idx").on(table.entryId, table.settlementDate), salaryIdx: index("employee_finance_settlements_salary_idx").on(table.payrollLineId) }));
