import { relations } from "drizzle-orm";
import { date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const dailyCashReportsTable = pgTable("daily_cash_reports", {
  id: serial("id").primaryKey(),
  reportDate: date("report_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  totalSales: numeric("total_sales", { precision: 14, scale: 2 }).notNull().default("0"),
  totalExpenses: numeric("total_expenses", { precision: 14, scale: 2 }).notNull().default("0"),
  closingBalance: numeric("closing_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  updatedBy: integer("updated_by").references(() => staffTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  reportDateIdx: uniqueIndex("daily_cash_reports_report_date_idx").on(table.reportDate),
  createdByIdx: index("daily_cash_reports_created_by_idx").on(table.createdBy),
  updatedAtIdx: index("daily_cash_reports_updated_at_idx").on(table.updatedAt),
}));

export const dailyCashReconciliationsTable = pgTable("daily_cash_reconciliations", {
  id: serial("id").primaryKey(),
  reportDate: date("report_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  totalSales: numeric("total_sales", { precision: 14, scale: 2 }).notNull().default("0"),
  totalExpenses: numeric("total_expenses", { precision: 14, scale: 2 }).notNull().default("0"),
  expectedCashBalance: numeric("expected_cash_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  actualCashInDrawer: numeric("actual_cash_in_drawer", { precision: 14, scale: 2 }).notNull().default("0"),
  difference: numeric("difference", { precision: 14, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("balanced"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  updatedBy: integer("updated_by").references(() => staffTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  reportDateIdx: uniqueIndex("daily_cash_reconciliations_report_date_idx").on(table.reportDate),
  statusIdx: index("daily_cash_reconciliations_status_idx").on(table.status),
  createdByIdx: index("daily_cash_reconciliations_created_by_idx").on(table.createdBy),
  updatedAtIdx: index("daily_cash_reconciliations_updated_at_idx").on(table.updatedAt),
}));

export const dailyCashReportsRelations = relations(dailyCashReportsTable, ({ one }) => ({
  createdByStaff: one(staffTable, {
    fields: [dailyCashReportsTable.createdBy],
    references: [staffTable.id],
  }),
  updatedByStaff: one(staffTable, {
    fields: [dailyCashReportsTable.updatedBy],
    references: [staffTable.id],
  }),
}));

export const dailyCashReconciliationsRelations = relations(dailyCashReconciliationsTable, ({ one }) => ({
  createdByStaff: one(staffTable, {
    fields: [dailyCashReconciliationsTable.createdBy],
    references: [staffTable.id],
  }),
  updatedByStaff: one(staffTable, {
    fields: [dailyCashReconciliationsTable.updatedBy],
    references: [staffTable.id],
  }),
}));

export type DailyCashReport = typeof dailyCashReportsTable.$inferSelect;
export type InsertDailyCashReport = typeof dailyCashReportsTable.$inferInsert;
export type DailyCashReconciliation = typeof dailyCashReconciliationsTable.$inferSelect;
export type InsertDailyCashReconciliation = typeof dailyCashReconciliationsTable.$inferInsert;
