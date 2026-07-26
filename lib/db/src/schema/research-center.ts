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
import { salesInvoicesTable } from "./sales-invoices";
import { staffTable } from "./staff";

export const researchUniversitiesTable = pgTable("research_universities", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 80 }).notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en"),
  country: text("country"),
  city: text("city"),
  logoUrl: text("logo_url"),
  colleges: jsonb("colleges").$type<Array<Record<string, unknown>>>().notNull().default([]),
  citationPreferences: jsonb("citation_preferences").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("research_universities_code_idx").on(table.code),
  index("research_universities_name_idx").on(table.nameAr),
]);

export const researchOrdersTable = pgTable("research_orders", {
  id: serial("id").primaryKey(),
  researchNo: varchar("research_no", { length: 50 }).notNull(),
  qrToken: varchar("qr_token", { length: 96 }).notNull(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "restrict" }),
  invoiceId: integer("invoice_id").references(() => salesInvoicesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  researchType: varchar("research_type", { length: 30 }).notNull(),
  universityId: integer("university_id").references(() => researchUniversitiesTable.id, { onDelete: "set null" }),
  universityName: text("university_name").notNull().default(""),
  college: text("college").notNull().default(""),
  department: text("department").notNull().default(""),
  supervisorName: text("supervisor_name"),
  language: varchar("language", { length: 20 }).notNull().default("ar"),
  researchField: text("research_field").notNull().default(""),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  requiredPages: integer("required_pages").notNull().default(1),
  deadline: date("deadline"),
  citationStyle: varchar("citation_style", { length: 20 }).notNull().default("APA7"),
  urgency: varchar("urgency", { length: 20 }).notNull().default("normal"),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("new"),
  progress: integer("progress").notNull().default(0),
  assignedWriterId: integer("assigned_writer_id").references(() => staffTable.id, { onDelete: "set null" }),
  assignedReviewerId: integer("assigned_reviewer_id").references(() => staffTable.id, { onDelete: "set null" }),
  assignedProofreaderId: integer("assigned_proofreader_id").references(() => staffTable.id, { onDelete: "set null" }),
  assignedFormatterId: integer("assigned_formatter_id").references(() => staffTable.id, { onDelete: "set null" }),
  assignedSupervisorId: integer("assigned_supervisor_id").references(() => staffTable.id, { onDelete: "set null" }),
  estimatedPrice: numeric("estimated_price", { precision: 14, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"),
  sourceCount: integer("source_count").notNull().default(0),
  chapterCount: integer("chapter_count").notNull().default(0),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  completedAt: timestamp("completed_at"),
  deliveredAt: timestamp("delivered_at"),
  archivedAt: timestamp("archived_at"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("research_orders_no_idx").on(table.researchNo),
  uniqueIndex("research_orders_qr_idx").on(table.qrToken),
  index("research_orders_customer_idx").on(table.customerId, table.createdAt),
  index("research_orders_status_idx").on(table.status, table.deadline),
  index("research_orders_search_idx").on(table.universityName, table.department),
]);

export const researchChaptersTable = pgTable("research_chapters", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  chapterType: varchar("chapter_type", { length: 40 }).notNull(),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("status", { length: 30 }).notNull().default("not_started"),
  progress: integer("progress").notNull().default(0),
  assignedWriterId: integer("assigned_writer_id").references(() => staffTable.id, { onDelete: "set null" }),
  deadline: date("deadline"),
  content: text("content"),
  wordCount: integer("word_count").notNull().default(0),
  currentVersion: integer("current_version").notNull().default(1),
  approvalStatus: varchar("approval_status", { length: 30 }).notNull().default("pending"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("research_chapters_order_type_idx").on(table.researchOrderId, table.chapterType),
  index("research_chapters_writer_idx").on(table.assignedWriterId, table.status),
]);

export const researchChapterVersionsTable = pgTable("research_chapter_versions", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id").notNull().references(() => researchChaptersTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  changeNote: text("change_note"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("research_chapter_versions_unique_idx").on(table.chapterId, table.version)]);

export const researchSourcesTable = pgTable("research_sources", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 30 }).notNull(),
  externalId: varchar("external_id", { length: 240 }).notNull(),
  title: text("title").notNull(),
  authors: jsonb("authors").$type<string[]>().notNull().default([]),
  journal: text("journal"),
  publicationYear: integer("publication_year"),
  abstract: text("abstract"),
  doi: varchar("doi", { length: 240 }),
  language: varchar("language", { length: 20 }),
  category: text("category"),
  url: text("url"),
  pdfUrl: text("pdf_url"),
  isOpenAccess: boolean("is_open_access").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("research_sources_provider_external_idx").on(table.provider, table.externalId),
  index("research_sources_doi_idx").on(table.doi),
  index("research_sources_year_idx").on(table.publicationYear),
]);

export const researchOrderSourcesTable = pgTable("research_order_sources", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => researchSourcesTable.id, { onDelete: "restrict" }),
  citationKey: varchar("citation_key", { length: 120 }),
  notes: text("notes"),
  selectedByCustomer: boolean("selected_by_customer").notNull().default(false),
  addedBy: integer("added_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("research_order_sources_unique_idx").on(table.researchOrderId, table.sourceId)]);

export const researchAssignmentsTable = pgTable("research_assignments", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  role: varchar("role", { length: 30 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("assigned"),
  hourlyRate: numeric("hourly_rate", { precision: 14, scale: 2 }).notNull().default("0"),
  workingMinutes: integer("working_minutes").notNull().default(0),
  rating: numeric("rating", { precision: 4, scale: 2 }),
  assignedBy: integer("assigned_by").references(() => staffTable.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [uniqueIndex("research_assignments_unique_idx").on(table.researchOrderId, table.staffId, table.role)]);

export const researchFilesTable = pgTable("research_files", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").references(() => researchChaptersTable.id, { onDelete: "set null" }),
  fileType: varchar("file_type", { length: 30 }).notNull(),
  title: text("title").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: varchar("mime_type", { length: 120 }),
  fileSize: integer("file_size"),
  version: integer("version").notNull().default(1),
  checksum: varchar("checksum", { length: 128 }),
  isCustomerVisible: boolean("is_customer_visible").notNull().default(false),
  uploadedBy: integer("uploaded_by").references(() => staffTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("research_files_order_idx").on(table.researchOrderId, table.fileType, table.createdAt)]);

export const researchPlagiarismReportsTable = pgTable("research_plagiarism_reports", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  fileId: integer("file_id").references(() => researchFilesTable.id, { onDelete: "set null" }),
  similarityPercentage: numeric("similarity_percentage", { precision: 5, scale: 2 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  provider: varchar("provider", { length: 80 }),
  reportUrl: text("report_url"),
  notes: text("notes"),
  checkedBy: integer("checked_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("research_plagiarism_order_idx").on(table.researchOrderId, table.createdAt)]);

export const researchCitationsTable = pgTable("research_citations", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").references(() => researchSourcesTable.id, { onDelete: "set null" }),
  style: varchar("style", { length: 20 }).notNull(),
  citationText: text("citation_text").notNull(),
  bibliographyText: text("bibliography_text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("research_citations_unique_idx").on(table.researchOrderId, table.sourceId, table.style)]);

export const researchMessagesTable = pgTable("research_messages", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").references(() => researchChaptersTable.id, { onDelete: "set null" }),
  senderType: varchar("sender_type", { length: 20 }).notNull(),
  senderId: integer("sender_id"),
  senderName: text("sender_name").notNull(),
  message: text("message").notNull(),
  attachments: jsonb("attachments").$type<Array<Record<string, unknown>>>().notNull().default([]),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("research_messages_order_idx").on(table.researchOrderId, table.createdAt)]);

export const researchTemplatesTable = pgTable("research_templates", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 80 }).notNull(),
  name: text("name").notNull(),
  researchType: varchar("research_type", { length: 30 }),
  universityId: integer("university_id").references(() => researchUniversitiesTable.id, { onDelete: "set null" }),
  language: varchar("language", { length: 20 }).notNull().default("ar"),
  citationStyle: varchar("citation_style", { length: 20 }).notNull().default("APA7"),
  structure: jsonb("structure").$type<Array<Record<string, unknown>>>().notNull().default([]),
  formatting: jsonb("formatting").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("research_templates_code_idx").on(table.code)]);

export const researchStatusEventsTable = pgTable("research_status_events", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  notes: text("notes"),
  changedBy: integer("changed_by").references(() => staffTable.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("research_status_events_order_idx").on(table.researchOrderId, table.createdAt)]);

export const researchAiGenerationsTable = pgTable("research_ai_generations", {
  id: serial("id").primaryKey(),
  researchOrderId: integer("research_order_id").notNull().references(() => researchOrdersTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").references(() => researchChaptersTable.id, { onDelete: "set null" }),
  action: varchar("action", { length: 50 }).notNull(),
  prompt: text("prompt").notNull(),
  output: text("output").notNull(),
  sourceIds: jsonb("source_ids").$type<number[]>().notNull().default([]),
  model: varchar("model", { length: 80 }),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("research_ai_generations_order_idx").on(table.researchOrderId, table.createdAt)]);

export type ResearchOrder = typeof researchOrdersTable.$inferSelect;
export type ResearchChapter = typeof researchChaptersTable.$inferSelect;
export type ResearchSource = typeof researchSourcesTable.$inferSelect;
