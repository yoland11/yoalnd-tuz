import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { staffTable } from "./staff";

export const masterCashBoxTable = pgTable("master_cash_box", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().default("MASTER"),
  name: text("name").notNull().default("الصندوق الرئيسي"),
  openingBalance: numeric("opening_balance", { precision: 16, scale: 2 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 16, scale: 2 }).notNull().default("0"),
  totalRevenue: numeric("total_revenue", { precision: 16, scale: 2 }).notNull().default("0"),
  totalExpenses: numeric("total_expenses", { precision: 16, scale: 2 }).notNull().default("0"),
  netProfit: numeric("net_profit", { precision: 16, scale: 2 }).notNull().default("0"),
  availableBalance: numeric("available_balance", { precision: 16, scale: 2 }).notNull().default("0"),
  version: integer("version").notNull().default(0),
  updatedBy: integer("updated_by").references(() => staffTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  codeIdx: uniqueIndex("master_cash_box_code_idx").on(table.code),
}));

export const financialAccountsTable = pgTable("financial_accounts", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull(),
  nameAr: text("name_ar").notNull(),
  accountType: varchar("account_type", { length: 20 }).notNull(),
  department: varchar("department", { length: 40 }),
  isSystem: boolean("is_system").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  codeIdx: uniqueIndex("financial_accounts_code_idx").on(table.code),
  typeIdx: index("financial_accounts_type_idx").on(table.accountType),
  departmentIdx: index("financial_accounts_department_idx").on(table.department),
}));

export const financialTransactionsTable = pgTable("financial_transactions", {
  id: serial("id").primaryKey(),
  transactionNo: varchar("transaction_no", { length: 50 }).notNull(),
  transactionDate: date("transaction_date").notNull(),
  transactionTime: timestamp("transaction_time").notNull().defaultNow(),
  direction: varchar("direction", { length: 20 }).notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  department: varchar("department", { length: 40 }).notNull().default("general"),
  transactionType: varchar("transaction_type", { length: 60 }).notNull(),
  description: text("description").notNull().default(""),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  sourceType: varchar("source_type", { length: 60 }),
  sourceId: varchar("source_id", { length: 80 }),
  sourceEvent: varchar("source_event", { length: 60 }).notNull().default("primary"),
  idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("draft"),
  requestedBy: integer("requested_by").references(() => staffTable.id, { onDelete: "set null" }),
  requestedByName: text("requested_by_name").notNull().default(""),
  submittedAt: timestamp("submitted_at"),
  approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }),
  approvedByName: text("approved_by_name").notNull().default(""),
  approvedAt: timestamp("approved_at"),
  rejectedBy: integer("rejected_by").references(() => staffTable.id, { onDelete: "set null" }),
  rejectedByName: text("rejected_by_name").notNull().default(""),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  executedBy: integer("executed_by").references(() => staffTable.id, { onDelete: "set null" }),
  executedByName: text("executed_by_name").notNull().default(""),
  executedAt: timestamp("executed_at"),
  balanceBefore: numeric("balance_before", { precision: 16, scale: 2 }),
  balanceAfter: numeric("balance_after", { precision: 16, scale: 2 }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name"),
  customerPhone: varchar("customer_phone", { length: 30 }),
  dueDate: date("due_date"),
  inventoryItemId: integer("inventory_item_id").references(() => productsTable.id, { onDelete: "set null" }),
  responsibleUserId: integer("responsible_user_id").references(() => staffTable.id, { onDelete: "set null" }),
  responsibleUserName: text("responsible_user_name"),
  notes: text("notes"),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  transactionNoIdx: uniqueIndex("financial_transactions_no_idx").on(table.transactionNo),
  idempotencyIdx: uniqueIndex("financial_transactions_idempotency_idx").on(table.idempotencyKey),
  dateIdx: index("financial_transactions_date_idx").on(table.transactionDate),
  statusIdx: index("financial_transactions_status_idx").on(table.approvalStatus),
  departmentIdx: index("financial_transactions_department_idx").on(table.department),
  directionIdx: index("financial_transactions_direction_idx").on(table.direction),
  sourceIdx: index("financial_transactions_source_idx").on(table.sourceType, table.sourceId),
  customerIdx: index("financial_transactions_customer_idx").on(table.customerId),
  dueDateIdx: index("financial_transactions_due_date_idx").on(table.dueDate),
}));

export const financialLedgerEntriesTable = pgTable("financial_ledger_entries", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull().references(() => financialTransactionsTable.id, { onDelete: "restrict" }),
  accountId: integer("account_id").notNull().references(() => financialAccountsTable.id, { onDelete: "restrict" }),
  entrySide: varchar("entry_side", { length: 10 }).notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  transactionIdx: index("financial_ledger_entries_transaction_idx").on(table.transactionId),
  accountIdx: index("financial_ledger_entries_account_idx").on(table.accountId),
  uniqueEntryIdx: uniqueIndex("financial_ledger_entries_unique_idx").on(table.transactionId, table.accountId, table.entrySide),
}));

export const financialAuditLogsTable = pgTable("financial_audit_logs", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => financialTransactionsTable.id, { onDelete: "restrict" }),
  action: varchar("action", { length: 60 }).notNull(),
  actorId: integer("actor_id").references(() => staffTable.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull().default(""),
  oldValues: jsonb("old_values").$type<Record<string, unknown>>().notNull().default({}),
  newValues: jsonb("new_values").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  transactionIdx: index("financial_audit_logs_transaction_idx").on(table.transactionId),
  actorIdx: index("financial_audit_logs_actor_idx").on(table.actorId),
  createdAtIdx: index("financial_audit_logs_created_at_idx").on(table.createdAt),
}));

export const financialTransactionsRelations = relations(financialTransactionsTable, ({ many }) => ({
  entries: many(financialLedgerEntriesTable),
  auditLogs: many(financialAuditLogsTable),
}));

export const financialLedgerEntriesRelations = relations(financialLedgerEntriesTable, ({ one }) => ({
  transaction: one(financialTransactionsTable, {
    fields: [financialLedgerEntriesTable.transactionId],
    references: [financialTransactionsTable.id],
  }),
  account: one(financialAccountsTable, {
    fields: [financialLedgerEntriesTable.accountId],
    references: [financialAccountsTable.id],
  }),
}));

export const financialAuditLogsRelations = relations(financialAuditLogsTable, ({ one }) => ({
  transaction: one(financialTransactionsTable, {
    fields: [financialAuditLogsTable.transactionId],
    references: [financialTransactionsTable.id],
  }),
}));

export type MasterCashBox = typeof masterCashBoxTable.$inferSelect;
export type FinancialAccount = typeof financialAccountsTable.$inferSelect;
export type FinancialTransaction = typeof financialTransactionsTable.$inferSelect;
export type FinancialLedgerEntry = typeof financialLedgerEntriesTable.$inferSelect;
export type FinancialAuditLog = typeof financialAuditLogsTable.$inferSelect;
