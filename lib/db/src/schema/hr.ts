import { date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const hrIncentiveRulesTable = pgTable("hr_incentive_rules", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: text("name").notNull(),
  kind: varchar("kind", { length: 20 }).notNull().default("bonus"),
  metric: varchar("metric", { length: 60 }).notNull(),
  operator: varchar("operator", { length: 10 }).notNull().default("gte"),
  threshold: numeric("threshold", { precision: 16, scale: 2 }).notNull().default("0"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  department: varchar("department", { length: 60 }),
  isActive: integer("is_active").notNull().default(1),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const hrIncentiveEventsTable = pgTable("hr_incentive_events", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  ruleId: integer("rule_id").references(() => hrIncentiveRulesTable.id, { onDelete: "set null" }),
  period: varchar("period", { length: 7 }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  points: integer("points").notNull().default(0),
  title: text("title").notNull().default(""),
  reason: text("reason"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  payrollLineId: integer("payroll_line_id"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default("system"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  staffPeriodIdx: index("hr_incentive_events_staff_period_idx").on(table.staffId, table.period),
  rulePeriodIdx: index("hr_incentive_events_rule_period_idx").on(table.ruleId, table.staffId, table.period),
}));

export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  runNo: varchar("run_no", { length: 40 }).notNull().unique(),
  period: varchar("period", { length: 7 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  notes: text("notes"),
  totalGross: numeric("total_gross", { precision: 16, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 16, scale: 2 }).notNull().default("0"),
  totalNet: numeric("total_net", { precision: 16, scale: 2 }).notNull().default("0"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }),
  approvedByName: text("approved_by_name").notNull().default(""),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const payrollLinesTable = pgTable("payroll_lines", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRunsTable.id, { onDelete: "restrict" }),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  baseSalary: numeric("base_salary", { precision: 16, scale: 2 }).notNull().default("0"),
  overtimeAmount: numeric("overtime_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  bonusAmount: numeric("bonus_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  penaltyAmount: numeric("penalty_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  advanceDeduction: numeric("advance_deduction", { precision: 16, scale: 2 }).notNull().default("0"),
  insuranceAmount: numeric("insurance_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  grossSalary: numeric("gross_salary", { precision: 16, scale: 2 }).notNull().default("0"),
  netSalary: numeric("net_salary", { precision: 16, scale: 2 }).notNull().default("0"),
  financialTransactionId: integer("financial_transaction_id"),
  signatureName: text("signature_name"),
  signedAt: timestamp("signed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  runStaffIdx: index("payroll_lines_run_staff_idx").on(table.payrollRunId, table.staffId),
  staffIdx: index("payroll_lines_staff_idx").on(table.staffId, table.createdAt),
}));

export const employeeTargetsTable = pgTable("employee_targets", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "cascade" }),
  department: varchar("department", { length: 60 }),
  period: varchar("period", { length: 7 }).notNull(),
  metric: varchar("metric", { length: 60 }).notNull(),
  target: numeric("target", { precision: 16, scale: 2 }).notNull(),
  completed: numeric("completed", { precision: 16, scale: 2 }).notNull().default("0"),
  rewardAmount: numeric("reward_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const employeeEvaluationsTable = pgTable("employee_evaluations", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  evaluatorId: integer("evaluator_id").references(() => staffTable.id, { onDelete: "set null" }),
  evaluatorName: text("evaluator_name").notNull().default(""),
  period: varchar("period", { length: 7 }).notNull(),
  discipline: integer("discipline").notNull().default(0),
  communication: integer("communication").notNull().default(0),
  leadership: integer("leadership").notNull().default(0),
  quality: integer("quality").notNull().default(0),
  responsibility: integer("responsibility").notNull().default(0),
  speed: integer("speed").notNull().default(0),
  innovation: integer("innovation").notNull().default(0),
  comments: text("comments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const employeeCareerHistoryTable = pgTable("employee_career_history", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  title: varchar("title", { length: 100 }).notNull(),
  level: varchar("level", { length: 60 }).notNull().default("worker"),
  effectiveDate: date("effective_date").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => staffTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const customerEmployeeRatingsTable = pgTable("customer_employee_ratings", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 80 }).notNull().unique(),
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  sourceType: varchar("source_type", { length: 40 }).notNull(),
  sourceId: integer("source_id").notNull(),
  quality: integer("quality"), speed: integer("speed"), behavior: integer("behavior"), professionalism: integer("professionalism"), overall: integer("overall"),
  message: text("message"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
