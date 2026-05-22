import { pgTable, serial, text, varchar, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
// Note: provider credentials are NOT stored in the DB. They are read from
// environment variables (Replit secrets) only. The settings table holds
// non-sensitive configuration: provider name, toggles, and templates.

export const whatsappSettingsTable = pgTable("whatsapp_settings", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 30 }).notNull().default("ultramsg"),
  enabledEvents: jsonb("enabled_events").$type<Record<string, boolean>>().notNull().default({}),
  templates: jsonb("templates").$type<Record<string, string>>().notNull().default({}),
  automationEnabled: boolean("automation_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappLogTable = pgTable("whatsapp_log", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 30 }).notNull(),
  event: varchar("event", { length: 40 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  error: text("error"),
  provider: varchar("provider", { length: 30 }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export type WhatsappSettings = typeof whatsappSettingsTable.$inferSelect;
export type WhatsappLog = typeof whatsappLogTable.$inferSelect;
