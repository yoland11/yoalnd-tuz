import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { serviceOrdersTable } from "./services";
import { staffTable } from "./staff";
import { photographyShootsTable } from "./photography-shoots";

export const photographyChecklistItemsTable = pgTable(
  "photography_checklist_items",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id").notNull().references(() => serviceOrdersTable.id, { onDelete: "cascade" }),
    shootId: integer("shoot_id").references(() => photographyShootsTable.id, { onDelete: "cascade" }),
    phase: varchar("phase", { length: 20 }).notNull(),
    itemKey: varchar("item_key", { length: 80 }).notNull(),
    label: text("label").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedBy: integer("completed_by").references(() => staffTable.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at"),
    evidenceUrl: text("evidence_url"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueItem: unique("photography_checklist_items_unique").on(table.bookingId, table.phase, table.itemKey),
    bookingIdx: index("photography_checklist_items_booking_idx").on(table.bookingId, table.phase),
  }),
);

export const photographyUploadsTable = pgTable(
  "photography_uploads",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id").notNull().references(() => serviceOrdersTable.id, { onDelete: "cascade" }),
    shootId: integer("shoot_id").references(() => photographyShootsTable.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    storagePath: text("storage_path"),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name"),
    mimeType: varchar("mime_type", { length: 120 }),
    accessLevel: varchar("access_level", { length: 20 }).notNull().default("team"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    uploadedBy: integer("uploaded_by").references(() => staffTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    bookingIdx: index("photography_uploads_booking_idx").on(table.bookingId, table.kind, table.createdAt),
  }),
);

export const photographyWorkflowSettingsTable = pgTable("photography_workflow_settings", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 40 }).notNull().unique().default("default"),
  activeStages: jsonb("active_stages").$type<string[]>().notNull().default([]),
  requireReacceptOnScheduleChange: boolean("require_reaccept_on_schedule_change").notNull().default(true),
  updatedBy: integer("updated_by").references(() => staffTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PhotographyChecklistItem = typeof photographyChecklistItemsTable.$inferSelect;
export type PhotographyUpload = typeof photographyUploadsTable.$inferSelect;
export type PhotographyWorkflowSettings = typeof photographyWorkflowSettingsTable.$inferSelect;
