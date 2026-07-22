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
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { salesInvoicesTable } from "./sales-invoices";
import { staffTable } from "./staff";

/**
 * Customer sub-ledger for receivables. It never posts cash or sales revenue;
 * those remain owned by the existing financial transaction subsystem.
 */
export const customerReceivableLedgerTable = pgTable(
  "customer_receivable_ledger",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "restrict" }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => salesInvoicesTable.id, { onDelete: "restrict" }),
    invoiceNumber: varchar("invoice_number", { length: 40 }).notNull(),
    invoiceDate: date("invoice_date").notNull(),
    sourceType: varchar("source_type", { length: 60 }).notNull().default("sales_invoice"),
    entryType: varchar("entry_type", { length: 80 })
      .notNull()
      .default("sales_invoice_historical_backfill"),
    invoiceTotal: numeric("invoice_total", { precision: 16, scale: 2 }).notNull(),
    validPayments: numeric("valid_payments", { precision: 16, scale: 2 }).notNull().default("0"),
    returnsAmount: numeric("returns_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    creditNotesAmount: numeric("credit_notes_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    adjustmentsAmount: numeric("adjustments_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    debitAmount: numeric("debit_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    creditAmount: numeric("credit_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    remainingAmount: numeric("remaining_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    batchId: varchar("batch_id", { length: 80 }).notNull(),
    createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull().default("system_backfill"),
    backfillVersion: varchar("backfill_version", { length: 40 }).notNull(),
    backfilledAt: timestamp("backfilled_at").notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex("customer_receivable_ledger_idempotency_idx").on(table.idempotencyKey),
    invoiceSourceIdx: uniqueIndex("customer_receivable_ledger_invoice_source_idx").on(
      table.invoiceId,
      table.customerId,
      table.sourceType,
    ),
    customerStatusIdx: index("customer_receivable_ledger_customer_status_idx").on(
      table.customerId,
      table.status,
      table.invoiceDate,
    ),
  }),
);

export const customerBalanceRepairBatchesTable = pgTable(
  "customer_balance_repair_batches",
  {
    id: serial("id").primaryKey(),
    batchId: varchar("batch_id", { length: 80 }).notNull(),
    mode: varchar("mode", { length: 20 }).notNull(),
    backfillVersion: varchar("backfill_version", { length: 40 }).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 20 }).notNull().default("running"),
    executedBy: integer("executed_by").references(() => staffTable.id, { onDelete: "set null" }),
    executedByName: text("executed_by_name").notNull().default("system_backfill"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    batchIdIdx: uniqueIndex("customer_balance_repair_batches_batch_id_idx").on(table.batchId),
  }),
);

export const customerBalanceRepairItemsTable = pgTable(
  "customer_balance_repair_items",
  {
    id: serial("id").primaryKey(),
    batchId: varchar("batch_id", { length: 80 }).notNull(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => salesInvoicesTable.id, { onDelete: "restrict" }),
    customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
    result: varchar("result", { length: 30 }).notNull(),
    proposedAction: varchar("proposed_action", { length: 60 }).notNull(),
    oldBalance: numeric("old_balance", { precision: 16, scale: 2 }),
    newBalance: numeric("new_balance", { precision: 16, scale: 2 }),
    outstandingRestored: numeric("outstanding_restored", { precision: 16, scale: 2 }).notNull().default("0"),
    existingPayments: numeric("existing_payments", { precision: 16, scale: 2 }).notNull().default("0"),
    returnsDetected: numeric("returns_detected", { precision: 16, scale: 2 }).notNull().default("0"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    batchInvoiceIdx: uniqueIndex("customer_balance_repair_items_batch_invoice_idx").on(
      table.batchId,
      table.invoiceId,
    ),
    resultIdx: index("customer_balance_repair_items_result_idx").on(table.result, table.createdAt),
  }),
);

