import { pgTable, serial, text, integer, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";

export const printTemplatesTable = pgTable("print_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 30 }).notNull().default("sales"),
  paperSize: varchar("paper_size", { length: 20 }).notNull().default("a4"),
  isDefault: integer("is_default").notNull().default(0),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PrintTemplate = typeof printTemplatesTable.$inferSelect;
