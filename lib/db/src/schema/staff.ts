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
  jobTitle: varchar("job_title", { length: 100 }),
  salaryType: varchar("salary_type", { length: 20 }).notNull().default("monthly"),
  currency: varchar("currency", { length: 10 }).notNull().default("IQD"),
  workingDaysPerWeek: numeric("working_days_per_week", { precision: 4, scale: 1 }).notNull().default("6"),
  dailyWorkingHours: numeric("daily_working_hours", { precision: 5, scale: 2 }).notNull().default("8"),
  hourlyRate: numeric("hourly_rate", { precision: 16, scale: 2 }).notNull().default("0"),
  overtimeRate: numeric("overtime_rate", { precision: 16, scale: 2 }).notNull().default("0"),
  attendanceAllowance: numeric("attendance_allowance", { precision: 16, scale: 2 }).notNull().default("0"),
  transportationAllowance: numeric("transportation_allowance", { precision: 16, scale: 2 }).notNull().default("0"),
  foodAllowance: numeric("food_allowance", { precision: 16, scale: 2 }).notNull().default("0"),
  phoneAllowance: numeric("phone_allowance", { precision: 16, scale: 2 }).notNull().default("0"),
  housingAllowance: numeric("housing_allowance", { precision: 16, scale: 2 }).notNull().default("0"),
  otherFixedAllowances: numeric("other_fixed_allowances", { precision: 16, scale: 2 }).notNull().default("0"),
  fixedDeduction: numeric("fixed_deduction", { precision: 16, scale: 2 }).notNull().default("0"),
  salesCommissionPercentage: numeric("sales_commission_percentage", { precision: 6, scale: 2 }).notNull().default("0"),
  profitCommissionPercentage: numeric("profit_commission_percentage", { precision: 6, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 30 }).notNull().default("cash"),
  paymentReference: text("payment_reference"),
  salaryStatus: varchar("salary_status", { length: 20 }).notNull().default("active"),
  salaryNotes: text("salary_notes"),
  isActive: boolean("is_active").notNull().default(true),
  lastActivityAt: timestamp("last_activity_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true, createdAt: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
