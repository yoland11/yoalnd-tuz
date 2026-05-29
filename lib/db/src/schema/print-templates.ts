import { pgTable, serial, text, integer, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const printTemplatesTable = pgTable("print_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 30 }).notNull().default("sales"),
  paperSize: varchar("paper_size", { length: 20 }).notNull().default("a4"),
  isDefault: integer("is_default").notNull().default(0),
  config: text("config").notNull().default("{}"),
  createdBy: integer("created_by").references(() => staffTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PrintTemplate = typeof printTemplatesTable.$inferSelect;
export type InsertPrintTemplate = typeof printTemplatesTable.$inferInsert;
