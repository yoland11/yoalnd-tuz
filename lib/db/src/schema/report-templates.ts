import { pgTable, serial, text, integer, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

// AJN REPX templates — imported DevExpress .repx reports as native, editable templates.
export const reportTemplatesTable = pgTable("report_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: varchar("category", { length: 30 }).notNull().default("custom"),
  paperKind: varchar("paper_kind", { length: 30 }).notNull().default("A4"),
  repxXml: text("repx_xml").notNull(),
  model: jsonb("model").$type<Record<string, unknown>>().notNull().default({}),
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  history: jsonb("history").$type<Array<Record<string, unknown>>>().notNull().default([]),
  isDefault: integer("is_default").notNull().default(0),
  fileName: text("file_name"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReportTemplate = typeof reportTemplatesTable.$inferSelect;
export type InsertReportTemplate = typeof reportTemplatesTable.$inferInsert;
