import { boolean, date, index, integer, jsonb, numeric, pgTable, serial, text, time, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

/** One approved payroll configuration per employee. Legacy staff salary fields stay in place for compatibility. */
export const employeeSalarySettingsTable = pgTable("employee_salary_settings", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  employmentType: varchar("employment_type", { length: 30 }).notNull().default("full_time"),
  firstPayrollDate: date("first_payroll_date"),
  monthlyWorkingHours: numeric("monthly_working_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  shiftStart: time("shift_start"), shiftEnd: time("shift_end"), weeklyDaysOff: jsonb("weekly_days_off").$type<string[]>().notNull().default([]),
  riskAllowance: numeric("risk_allowance", { precision: 16, scale: 2 }).notNull().default("0"),
  weekendHourRate: numeric("weekend_hour_rate", { precision: 16, scale: 2 }).notNull().default("0"), holidayHourRate: numeric("holiday_hour_rate", { precision: 16, scale: 2 }).notNull().default("0"), maxMonthlyOvertime: numeric("max_monthly_overtime", { precision: 8, scale: 2 }).notNull().default("0"),
  taxDeduction: numeric("tax_deduction", { precision: 16, scale: 2 }).notNull().default("0"), insuranceDeduction: numeric("insurance_deduction", { precision: 16, scale: 2 }).notNull().default("0"), retirementDeduction: numeric("retirement_deduction", { precision: 16, scale: 2 }).notNull().default("0"), lateDeduction: numeric("late_deduction", { precision: 16, scale: 2 }).notNull().default("0"), absenceDeduction: numeric("absence_deduction", { precision: 16, scale: 2 }).notNull().default("0"), otherDeduction: numeric("other_deduction", { precision: 16, scale: 2 }).notNull().default("0"),
  monthlyBonus: numeric("monthly_bonus", { precision: 16, scale: 2 }).notNull().default("0"), performanceBonus: numeric("performance_bonus", { precision: 16, scale: 2 }).notNull().default("0"), commission: numeric("commission", { precision: 16, scale: 2 }).notNull().default("0"), annualBonus: numeric("annual_bonus", { precision: 16, scale: 2 }).notNull().default("0"), otherBonus: numeric("other_bonus", { precision: 16, scale: 2 }).notNull().default("0"),
  bankName: text("bank_name"), accountNumber: text("account_number"), iban: varchar("iban", { length: 64 }),
  generatePayrollAutomatically: boolean("generate_payroll_automatically").notNull().default(false), enableOvertime: boolean("enable_overtime").notNull().default(true), enableAttendanceIntegration: boolean("enable_attendance_integration").notNull().default(true), enableAdvanceDeduction: boolean("enable_advance_deduction").notNull().default(true), enableBonuses: boolean("enable_bonuses").notNull().default(true), enablePenalties: boolean("enable_penalties").notNull().default(true),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("approved"), approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }), approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({ staffUnique: uniqueIndex("employee_salary_settings_staff_unique").on(table.staffId) }));

export const employeeSalarySettingAuditsTable = pgTable("employee_salary_setting_audits", {
  id: serial("id").primaryKey(), staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
  actorId: integer("actor_id").references(() => staffTable.id, { onDelete: "set null" }), actorName: text("actor_name").notNull().default(""),
  action: varchar("action", { length: 40 }).notNull(), oldValue: jsonb("old_value").$type<Record<string, unknown>>().notNull().default({}), newValue: jsonb("new_value").$type<Record<string, unknown>>().notNull().default({}), ipAddress: varchar("ip_address", { length: 80 }), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({ staffCreatedIdx: index("employee_salary_setting_audits_staff_created_idx").on(table.staffId, table.createdAt) }));

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
  bonusType: varchar("bonus_type", { length: 60 }).notNull().default("manual"),
  bonusSource: varchar("bonus_source", { length: 60 }).notNull().default("manual"),
  sourceType: varchar("source_type", { length: 60 }),
  sourceId: varchar("source_id", { length: 120 }),
  calculationMethod: varchar("calculation_method", { length: 20 }).notNull().default("fixed"),
  quantity: numeric("quantity", { precision: 16, scale: 2 }).notNull().default("1"),
  ratePerUnit: numeric("rate_per_unit", { precision: 16, scale: 2 }).notNull().default("0"),
  percentage: numeric("percentage", { precision: 8, scale: 4 }).notNull().default("0"),
  baseAmount: numeric("base_amount", { precision: 16, scale: 2 }).notNull().default("0"),
  calculationFormula: text("calculation_formula"),
  relatedDepartment: varchar("related_department", { length: 60 }),
  notes: text("notes"),
  performanceScore: numeric("performance_score", { precision: 6, scale: 2 }),
  customerRating: numeric("customer_rating", { precision: 6, scale: 2 }),
  attachment: text("attachment"),
  approvedBy: integer("approved_by").references(() => staffTable.id, { onDelete: "set null" }),
  approvedByName: text("approved_by_name"),
  approvalDate: timestamp("approval_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  staffPeriodIdx: index("hr_incentive_events_staff_period_idx").on(table.staffId, table.period),
  rulePeriodIdx: index("hr_incentive_events_rule_period_idx").on(table.ruleId, table.staffId, table.period),
  sourceIdx: index("hr_incentive_events_source_idx").on(table.sourceType, table.sourceId),
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
