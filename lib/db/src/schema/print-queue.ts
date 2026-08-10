import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { enterpriseBranchesTable } from "./enterprise";
import { salesInvoicesTable } from "./sales-invoices";
import { staffTable } from "./staff";

/**
 * Remote printing is intentionally separate from financial writes.  These rows
 * are an audit trail and a durable hand-off to a Windows-only agent, never a
 * substitute for a sales-invoice transaction.
 */
export const printAgentsTable = pgTable("print_agents", {
  id: serial("id").primaryKey(),
  agentId: varchar("agent_id", { length: 64 }).notNull(),
  name: text("name").notNull(),
  registrationTokenHash: varchar("registration_token_hash", { length: 128 }),
  tokenHash: varchar("token_hash", { length: 128 }),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  hostname: varchar("hostname", { length: 255 }),
  appVersion: varchar("app_version", { length: 40 }),
  detectedPrinters: jsonb("detected_printers").$type<Array<{ name: string; displayName?: string; isDefault?: boolean }>>().notNull().default([]),
  lastSeenAt: timestamp("last_seen_at"),
  credentialRotatedAt: timestamp("credential_rotated_at"),
  disabledAt: timestamp("disabled_at"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  agentIdUnique: uniqueIndex("print_agents_agent_id_unique_idx").on(table.agentId),
  tokenHashUnique: uniqueIndex("print_agents_token_hash_unique_idx").on(table.tokenHash),
  branchIdx: index("print_agents_branch_idx").on(table.branchId, table.status),
  seenIdx: index("print_agents_last_seen_idx").on(table.lastSeenAt),
}));

export const printersTable = pgTable("printers", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => printAgentsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  driverType: varchar("driver_type", { length: 20 }).notNull().default("windows"),
  paperSize: varchar("paper_size", { length: 10 }).notNull().default("80mm"),
  defaultCopies: integer("default_copies").notNull().default(1),
  autoPrintEnabled: boolean("auto_print_enabled").notNull().default(true),
  allowedDocumentTypes: jsonb("allowed_document_types").$type<string[]>().notNull().default(["sales_invoice"]),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  agentNameUnique: uniqueIndex("printers_agent_name_unique_idx").on(table.agentId, table.name),
  branchIdx: index("printers_branch_idx").on(table.branchId, table.isActive),
  agentIdx: index("printers_agent_idx").on(table.agentId, table.isActive),
}));

export const printJobsTable = pgTable("print_jobs", {
  id: serial("id").primaryKey(),
  jobNo: varchar("job_no", { length: 64 }).notNull(),
  documentType: varchar("document_type", { length: 40 }).notNull(),
  documentId: integer("document_id").notNull(),
  invoiceId: integer("invoice_id").references(() => salesInvoicesTable.id, { onDelete: "restrict" }),
  printerId: integer("printer_id").references(() => printersTable.id, { onDelete: "set null" }),
  branchId: integer("branch_id").references(() => enterpriseBranchesTable.id, { onDelete: "set null" }),
  computerAgentId: integer("computer_agent_id").references(() => printAgentsTable.id, { onDelete: "set null" }),
  paperSize: varchar("paper_size", { length: 10 }).notNull().default("80mm"),
  copies: integer("copies").notNull().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  idempotencyKey: varchar("idempotency_key", { length: 140 }).notNull(),
  requestedBy: integer("requested_by").references(() => staffTable.id, { onDelete: "set null" }),
  requestedByName: text("requested_by_name").notNull().default(""),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  claimedAt: timestamp("claimed_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  cancelledAt: timestamp("cancelled_at"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at"),
  originalPrintJobId: integer("original_print_job_id"),
  reprintReason: text("reprint_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  jobNoUnique: uniqueIndex("print_jobs_job_no_unique_idx").on(table.jobNo),
  idempotencyUnique: uniqueIndex("print_jobs_idempotency_unique_idx").on(table.idempotencyKey),
  queueIdx: index("print_jobs_queue_idx").on(table.computerAgentId, table.status, table.nextAttemptAt, table.requestedAt),
  invoiceIdx: index("print_jobs_invoice_idx").on(table.invoiceId, table.createdAt),
  branchIdx: index("print_jobs_branch_idx").on(table.branchId, table.status, table.createdAt),
}));

export type PrintAgent = typeof printAgentsTable.$inferSelect;
export type Printer = typeof printersTable.$inferSelect;
export type PrintJob = typeof printJobsTable.$inferSelect;
