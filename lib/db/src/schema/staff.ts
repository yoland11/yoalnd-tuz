import { pgTable, serial, text, boolean, varchar, timestamp, jsonb, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffTable = pgTable("staff", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull().default(""),
  role: varchar("role", { length: 30 }).notNull().default("employee"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  department: varchar("department", { length: 60 }).notNull().default("general"),
  baseSalary: numeric("base_salary", { precision: 16, scale: 2 }).notNull().default("0"),
  hiredAt: date("hired_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  lastActivityAt: timestamp("last_activity_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true, createdAt: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
