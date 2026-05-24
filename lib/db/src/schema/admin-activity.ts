import { pgTable, serial, integer, text, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const adminActivityLogsTable = pgTable("admin_activity_logs", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").references(() => staffTable.id),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }),
  entityId: integer("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminActivityLog = typeof adminActivityLogsTable.$inferSelect;
