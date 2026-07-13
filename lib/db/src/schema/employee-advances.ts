import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

/** Employee salary advances, temporary withdrawals, and emergency loans. */
export const employeeAdvancesTable = pgTable(
  "employee_advances",
  {
    id: serial("id").primaryKey(),
    advanceNo: varchar("advance_no", { length: 40 }).notNull().unique(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    requestDate: date("request_date").notNull(),
    advanceType: varchar("advance_type", { length: 30 }).notNull().default("salary_advance"),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    repaidAmount: numeric("repaid_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    remainingAmount: numeric("remaining_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    monthlyDeduction: numeric("monthly_deduction", { precision: 16, scale: 2 }).notNull().default("0"),
    reason: text("reason").notNull().default(""),
    notes: text("notes"),
    attachmentUrl: text("attachment_url"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    requestedBy: integer("requested_by").references(() => staffTable.id, { onDelete: "set null" }),
    requestedByName: text("requested_by_name").notNull().default(""),
    approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }),
    approvedByName: text("approved_by_name").notNull().default(""),
    approvedAt: timestamp("approved_at"),
    rejectedBy: integer("rejected_by").references(() => staffTable.id, { onDelete: "set null" }),
    rejectedByName: text("rejected_by_name").notNull().default(""),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    paidAt: timestamp("paid_at"),
    dueDate: date("due_date"),
    lastDeductionAt: timestamp("last_deduction_at"),
    financialTransactionId: integer("financial_transaction_id"),
    payrollReference: varchar("payroll_reference", { length: 80 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    employeeIdx: index("employee_advances_employee_idx").on(table.employeeId, table.createdAt),
    statusIdx: index("employee_advances_status_idx").on(table.status, table.requestDate),
    requestDateIdx: index("employee_advances_request_date_idx").on(table.requestDate),
  }),
);

export const employeeAdvanceRepaymentsTable = pgTable(
  "employee_advance_repayments",
  {
    id: serial("id").primaryKey(),
    advanceId: integer("advance_id")
      .notNull()
      .references(() => employeeAdvancesTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    paymentDate: date("payment_date").notNull(),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    method: varchar("method", { length: 20 }).notNull().default("cash"),
    kind: varchar("kind", { length: 20 }).notNull().default("manual"),
    notes: text("notes"),
    payrollReference: varchar("payroll_reference", { length: 80 }),
    financialTransactionId: integer("financial_transaction_id"),
    receivedBy: integer("received_by").references(() => staffTable.id, { onDelete: "set null" }),
    receivedByName: text("received_by_name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    advanceIdx: index("employee_advance_repayments_advance_idx").on(table.advanceId, table.paymentDate),
    employeeIdx: index("employee_advance_repayments_employee_idx").on(table.employeeId, table.paymentDate),
  }),
);

export const employeeAdvanceSettingsTable = pgTable("employee_advance_settings", {
  id: serial("id").primaryKey(),
  maxAdvanceAmount: numeric("max_advance_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  maxSalaryPercentage: numeric("max_salary_percentage", { precision: 5, scale: 2 }).notNull().default("100"),
  maxActiveAdvances: integer("max_active_advances").notNull().default(1),
  minimumEmploymentDays: integer("minimum_employment_days").notNull().default(0),
  managerApprovalAmount: numeric("manager_approval_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  updatedBy: integer("updated_by").references(() => staffTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmployeeAdvance = typeof employeeAdvancesTable.$inferSelect;
export type EmployeeAdvanceRepayment = typeof employeeAdvanceRepaymentsTable.$inferSelect;
