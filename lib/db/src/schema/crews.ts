import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const crewsTable = pgTable("crews", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Crew = typeof crewsTable.$inferSelect;
