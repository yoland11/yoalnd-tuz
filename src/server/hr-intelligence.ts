import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { computeEmployeeScores, type EmployeeScore } from "@/server/employee-performance";
import { applyPayrollAdvanceDeductions, ensureEmployeeAdvanceTables, getEmployeeAdvanceSummary } from "@/server/employee-advances";
import { approveAndExecuteFinancialTransaction, createFinancialTransaction, ensureMasterCashBoxTables, type FinancialActor } from "@/server/master-cash-box";

export type HrActor = FinancialActor;
const rows = <T = any>(value: any): T[] => (value?.rows ?? []) as T[];
const num = (value: unknown) => Number.isFinite(Number(value)) ? Math.round((Number(value) + Number.EPSILON) * 100) / 100 : 0;
const periodNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const validPeriod = (period: string) => /^\d{4}-\d{2}$/.test(period);
const BONUS_TYPES = ["performance", "attendance", "perfect_attendance", "overtime", "sales_commission", "profit_commission", "kosha_completion", "photography_session", "editing", "delivery", "collection", "graduation_order", "production", "customer_satisfaction", "employee_of_month", "manual", "other"] as const;
const BONUS_STATUSES = ["draft", "pending_approval", "approved", "rejected", "applied_to_payroll", "paid", "cancelled", "pending"] as const;
const bonusPayloadSchema = z.object({
  staffId: z.coerce.number().int().positive({ message: "الموظف مطلوب" }),
  period: z.string().regex(/^\d{4}-\d{2}$/, "فترة الرواتب يجب أن تكون بصيغة YYYY-MM"),
  bonusType: z.enum(BONUS_TYPES, { message: "نوع المكافأة غير صالح" }),
  calculationMethod: z.enum(["fixed", "quantity_rate", "percentage"], { message: "طريقة الحساب غير صالحة" }),
  quantity: z.coerce.number().min(0, "الكمية لا يمكن أن تكون سالبة").optional(),
  ratePerUnit: z.coerce.number().min(0, "السعر للوحدة لا يمكن أن يكون سالباً").optional(),
  percentage: z.coerce.number().min(0, "النسبة لا يمكن أن تكون سالبة").optional(),
  baseAmount: z.coerce.number().min(0, "المبلغ الأساسي لا يمكن أن يكون سالباً").optional(),
  amount: z.coerce.number().min(0, "المبلغ لا يمكن أن يكون سالباً").optional(),
  finalAmount: z.coerce.number().min(0, "المبلغ النهائي لا يمكن أن يكون سالباً").optional(),
  bonusSource: z.string().trim().min(1, "مصدر المكافأة مطلوب"),
}).passthrough();

const payrollInputSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  department: z.string().trim().max(60).optional().nullable(),
  employeeIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
  periodStartDate: z.string().date().optional(),
  periodEndDate: z.string().date().optional(),
  paymentDate: z.string().date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** Manual corrections are deliberately isolated from calculated attendance and advance data. */
const payrollLineEditSchema = z.object({
  baseSalary: z.coerce.number().min(0).max(1_000_000_000).optional(),
  overtimeAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  bonusAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  commissionAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  attendanceDeduction: z.coerce.number().min(0).max(1_000_000_000).optional(),
  absenceDeduction: z.coerce.number().min(0).max(1_000_000_000).optional(),
  lateDeduction: z.coerce.number().min(0).max(1_000_000_000).optional(),
  advanceDeduction: z.coerce.number().min(0).max(1_000_000_000).optional(),
  manualDeduction: z.coerce.number().min(0).max(1_000_000_000).optional(),
  otherEarnings: z.coerce.number().min(0).max(1_000_000_000).optional(),
  otherDeductions: z.coerce.number().min(0).max(1_000_000_000).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  paymentMethod: z.enum(["main_cash_box", "bank", "cash", "transfer"]).optional(),
  paymentDate: z.string().date().optional().nullable(),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export class PayrollConflictError extends Error {
  constructor(public readonly existing: any) {
    super("Payroll already exists for this period.");
  }
}

function payrollDates(period: string, input: z.infer<typeof payrollInputSchema>) {
  const start = input.periodStartDate ?? `${period}-01`;
  const fallbackEnd = new Date(`${period}-01T00:00:00Z`);
  fallbackEnd.setUTCMonth(fallbackEnd.getUTCMonth() + 1, 0);
  const end = input.periodEndDate ?? fallbackEnd.toISOString().slice(0, 10);
  if (start > end) throw new Error("تاريخ بداية فترة الرواتب يجب أن يسبق تاريخ النهاية");
  return { start, end, paymentDate: input.paymentDate ?? end };
}

function scheduledDays(start: string, end: string, workingDaysPerWeek: number) {
  let count = 0;
  const day = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  // AJN's default workweek starts Saturday.  Working-day count, not calendar days,
  // is deliberately used by absence deductions.
  while (day <= last) { if (day.getUTCDay() < Math.min(7, Math.max(1, workingDaysPerWeek))) count++; day.setUTCDate(day.getUTCDate() + 1); }
  return count;
}

/** Runtime provisioning keeps deployments safe even before the migration runner is invoked. */
export async function ensureHrTables() {
  await ensureMasterCashBoxTables();
  await db.execute(sql`
    alter table "staff" add column if not exists "department" varchar(60) not null default 'general';
    alter table "staff" add column if not exists "base_salary" numeric(16,2) not null default 0;
    alter table "staff" add column if not exists "hired_at" date not null default current_date;
    create table if not exists employee_salary_settings (id serial primary key, staff_id integer not null unique references staff(id) on delete cascade, employment_type varchar(30) not null default 'full_time', first_payroll_date date, monthly_working_hours numeric(8,2) not null default 0, shift_start time, shift_end time, weekly_days_off jsonb not null default '[]'::jsonb, risk_allowance numeric(16,2) not null default 0, weekend_hour_rate numeric(16,2) not null default 0, holiday_hour_rate numeric(16,2) not null default 0, max_monthly_overtime numeric(8,2) not null default 0, tax_deduction numeric(16,2) not null default 0, insurance_deduction numeric(16,2) not null default 0, retirement_deduction numeric(16,2) not null default 0, late_deduction numeric(16,2) not null default 0, absence_deduction numeric(16,2) not null default 0, other_deduction numeric(16,2) not null default 0, monthly_bonus numeric(16,2) not null default 0, performance_bonus numeric(16,2) not null default 0, commission numeric(16,2) not null default 0, annual_bonus numeric(16,2) not null default 0, other_bonus numeric(16,2) not null default 0, bank_name text, account_number text, iban varchar(64), generate_payroll_automatically boolean not null default false, enable_overtime boolean not null default true, enable_attendance_integration boolean not null default true, enable_advance_deduction boolean not null default true, enable_bonuses boolean not null default true, enable_penalties boolean not null default true, approval_status varchar(20) not null default 'approved', approved_by integer references staff(id) on delete set null, approved_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists employee_salary_setting_audits (id serial primary key, staff_id integer not null references staff(id) on delete restrict, actor_id integer references staff(id) on delete set null, actor_name text not null default '', action varchar(40) not null, old_value jsonb not null default '{}'::jsonb, new_value jsonb not null default '{}'::jsonb, ip_address varchar(80), created_at timestamp not null default now());
    create index if not exists employee_salary_setting_audits_staff_created_idx on employee_salary_setting_audits(staff_id, created_at);
    create table if not exists hr_incentive_rules (id serial primary key, code varchar(60) not null unique, name text not null, kind varchar(20) not null default 'bonus', metric varchar(60) not null, operator varchar(10) not null default 'gte', threshold numeric(16,2) not null default 0, amount numeric(16,2) not null default 0, department varchar(60), is_active integer not null default 1, metadata jsonb not null default '{}'::jsonb, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists hr_incentive_events (id serial primary key, staff_id integer not null references staff(id) on delete restrict, rule_id integer references hr_incentive_rules(id) on delete set null, period varchar(7) not null, kind varchar(20) not null, amount numeric(16,2) not null default 0, points integer not null default 0, title text not null default '', reason text, status varchar(20) not null default 'pending', payroll_line_id integer, created_by integer references staff(id) on delete set null, created_by_name text not null default 'system', created_at timestamp not null default now());
    alter table hr_incentive_events add column if not exists bonus_type varchar(60) not null default 'manual', add column if not exists bonus_source varchar(60) not null default 'manual', add column if not exists source_type varchar(60), add column if not exists source_id varchar(120), add column if not exists calculation_method varchar(20) not null default 'fixed', add column if not exists quantity numeric(16,2) not null default 1, add column if not exists rate_per_unit numeric(16,2) not null default 0, add column if not exists percentage numeric(8,4) not null default 0, add column if not exists base_amount numeric(16,2) not null default 0, add column if not exists calculation_formula text, add column if not exists related_department varchar(60), add column if not exists notes text, add column if not exists performance_score numeric(6,2), add column if not exists customer_rating numeric(6,2), add column if not exists attachment text, add column if not exists approved_by integer references staff(id) on delete set null, add column if not exists approved_by_name text, add column if not exists approval_date timestamp;
    create index if not exists hr_incentive_events_source_idx on hr_incentive_events(source_type,source_id);
    create unique index if not exists hr_incentive_events_source_period_uq on hr_incentive_events(staff_id,source_type,source_id,period,bonus_type) where source_type is not null and source_id is not null;
    create index if not exists hr_incentive_events_staff_period_idx on hr_incentive_events(staff_id, period);
    create table if not exists payroll_runs (id serial primary key, run_no varchar(40) not null unique, period varchar(7) not null unique, status varchar(20) not null default 'draft', notes text, total_gross numeric(16,2) not null default 0, total_deductions numeric(16,2) not null default 0, total_net numeric(16,2) not null default 0, created_by integer references staff(id) on delete set null, created_by_name text not null default '', approved_by integer references staff(id) on delete set null, approved_by_name text not null default '', approved_at timestamp, paid_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
    alter table payroll_runs add column if not exists period_start_date date, add column if not exists period_end_date date, add column if not exists payment_date date, add column if not exists department varchar(60), add column if not exists attendance_warning text, add column if not exists deleted_at timestamp, add column if not exists deleted_by integer references staff(id) on delete set null, add column if not exists delete_reason text, add column if not exists cancelled_at timestamp, add column if not exists cancelled_by integer references staff(id) on delete set null, add column if not exists cancel_reason text, add column if not exists reopened_at timestamp, add column if not exists reopened_by integer references staff(id) on delete set null, add column if not exists reopen_reason text;
    create table if not exists payroll_lines (id serial primary key, payroll_run_id integer not null references payroll_runs(id) on delete restrict, staff_id integer not null references staff(id) on delete restrict, base_salary numeric(16,2) not null default 0, overtime_amount numeric(16,2) not null default 0, bonus_amount numeric(16,2) not null default 0, penalty_amount numeric(16,2) not null default 0, advance_deduction numeric(16,2) not null default 0, insurance_amount numeric(16,2) not null default 0, gross_salary numeric(16,2) not null default 0, net_salary numeric(16,2) not null default 0, financial_transaction_id integer, signature_name text, signed_at timestamp, created_at timestamp not null default now());
    alter table payroll_lines add column if not exists salary_type varchar(20) not null default 'monthly', add column if not exists payment_method varchar(30) not null default 'cash', add column if not exists scheduled_working_days integer not null default 0, add column if not exists attendance_days integer not null default 0, add column if not exists absence_days integer not null default 0, add column if not exists paid_leave_days integer not null default 0, add column if not exists unpaid_leave_days integer not null default 0, add column if not exists late_arrivals integer not null default 0, add column if not exists total_late_minutes integer not null default 0, add column if not exists early_leave_count integer not null default 0, add column if not exists total_working_hours numeric(16,2) not null default 0, add column if not exists overtime_hours numeric(16,2) not null default 0, add column if not exists missing_check_in integer not null default 0, add column if not exists missing_check_out integer not null default 0, add column if not exists attendance_allowance numeric(16,2) not null default 0, add column if not exists transportation_allowance numeric(16,2) not null default 0, add column if not exists food_allowance numeric(16,2) not null default 0, add column if not exists phone_allowance numeric(16,2) not null default 0, add column if not exists housing_allowance numeric(16,2) not null default 0, add column if not exists other_fixed_allowances numeric(16,2) not null default 0, add column if not exists absence_deduction numeric(16,2) not null default 0, add column if not exists late_deduction numeric(16,2) not null default 0, add column if not exists early_leave_deduction numeric(16,2) not null default 0, add column if not exists unpaid_leave_deduction numeric(16,2) not null default 0, add column if not exists fixed_deduction numeric(16,2) not null default 0, add column if not exists manual_earnings numeric(16,2) not null default 0, add column if not exists commission_amount numeric(16,2) not null default 0, add column if not exists attendance_deduction numeric(16,2) not null default 0, add column if not exists manual_deduction numeric(16,2) not null default 0, add column if not exists other_deductions numeric(16,2) not null default 0, add column if not exists line_notes text, add column if not exists amount_paid numeric(16,2) not null default 0, add column if not exists payment_status varchar(20) not null default 'unpaid', add column if not exists calculation_details jsonb not null default '{}'::jsonb;
    create index if not exists payroll_lines_run_staff_idx on payroll_lines(payroll_run_id,staff_id);
    create unique index if not exists payroll_lines_run_staff_unique_idx on payroll_lines(payroll_run_id,staff_id);
    create table if not exists employee_targets (id serial primary key, staff_id integer references staff(id) on delete cascade, department varchar(60), period varchar(7) not null, metric varchar(60) not null, target numeric(16,2) not null, completed numeric(16,2) not null default 0, reward_amount numeric(16,2) not null default 0, status varchar(20) not null default 'active', created_by integer references staff(id) on delete set null, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists employee_evaluations (id serial primary key, staff_id integer not null references staff(id) on delete restrict, evaluator_id integer references staff(id) on delete set null, evaluator_name text not null default '', period varchar(7) not null, discipline integer not null default 0, communication integer not null default 0, leadership integer not null default 0, quality integer not null default 0, responsibility integer not null default 0, speed integer not null default 0, innovation integer not null default 0, comments text, created_at timestamp not null default now());
    create table if not exists employee_career_history (id serial primary key, staff_id integer not null references staff(id) on delete restrict, title varchar(100) not null, level varchar(60) not null default 'worker', effective_date date not null, notes text, created_by integer references staff(id) on delete set null, created_at timestamp not null default now());
    create table if not exists customer_employee_ratings (id serial primary key, token varchar(80) not null unique, staff_id integer references staff(id) on delete set null, source_type varchar(40) not null, source_id integer not null, quality integer, speed integer, behavior integer, professionalism integer, overall integer, message text, submitted_at timestamp, created_at timestamp not null default now());
  `);
  const defaults = [
    ["attendance_98", "حافز حضور 98%", "bonus", "attendance", 98, 50000],
    ["no_lateness", "حافز الانضباط الشهري", "bonus", "late", 0, 25000],
    ["performance_90", "حافز أداء متميز", "bonus", "performance", 90, 100000],
    ["kosha_30", "حافز إنجاز الكوشات", "bonus", "koshas", 30, 100000],
  ];
  for (const [code, name, kind, metric, threshold, amount] of defaults) {
    await db.execute(sql`insert into hr_incentive_rules(code,name,kind,metric,threshold,amount) values(${code},${name},${kind},${metric},${threshold},${amount}) on conflict(code) do nothing`);
  }
}

function metricValue(score: EmployeeScore, metric: string) {
  const d = score.details;
  if (metric === "performance") return score.overall;
  if (metric === "attendance") { const total = d.present + d.late + d.absent; return total ? (d.present / total) * 100 : 100; }
  if (metric === "late") return d.late;
  if (metric === "revenue") return d.revenue;
  if (metric === "jobs") return d.jobsCompleted;
  if (metric === "koshas") return score.department.includes("كوش") ? d.jobsCompleted : 0;
  if (metric === "photography") return score.department.includes("تصوير") ? d.jobsCompleted : 0;
  return 0;
}

function qualifies(value: number, operator: string, threshold: number) {
  return operator === "lte" ? value <= threshold : operator === "eq" ? value === threshold : value >= threshold;
}

export async function evaluateAutomaticIncentives(period = periodNow()) {
  await ensureHrTables();
  if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const [scores, ruleResult] = await Promise.all([computeEmployeeScores({ from: `${period}-01`, to: `${period}-31` }), db.execute(sql`select * from hr_incentive_rules where is_active=1`)]);
  const created: any[] = [];
  for (const rule of rows<any>(ruleResult)) for (const employee of scores) {
    if (rule.department && rule.department !== employee.department) continue;
    const value = metricValue(employee, String(rule.metric));
    if (!qualifies(value, String(rule.operator), num(rule.threshold))) continue;
    const exists = await db.execute(sql`select id from hr_incentive_events where rule_id=${rule.id} and staff_id=${employee.staffId} and period=${period} limit 1`);
    if (rows(exists).length) continue;
    const inserted = await db.execute(sql`insert into hr_incentive_events(staff_id,rule_id,period,kind,amount,title,reason,status,created_by_name,bonus_type,bonus_source,calculation_method,quantity,rate_per_unit,base_amount,calculation_formula,related_department,performance_score) values(${employee.staffId},${rule.id},${period},${rule.kind},${rule.amount},${rule.name},${`قيمة المؤشر: ${Math.round(value * 100) / 100}`},'pending_approval','النظام',${String(rule.metric || rule.code || 'other')},${String(rule.metric || 'automatic')},'fixed',1,${num(rule.amount)},${num(rule.amount)},${String(rule.amount)},${employee.department || null},${rule.metric === 'performance' ? num(value) : null}) returning *`);
    created.push(rows(inserted)[0]);
  }
  return created;
}

export async function hrDashboard(period = periodNow()) {
  await ensureHrTables();
  const [scores, payroll, events, targets, cash, attendance] = await Promise.all([
    computeEmployeeScores({ from: `${period}-01`, to: `${period}-31` }),
    db.execute(sql`select * from payroll_runs where deleted_at is null order by created_at desc limit 12`),
    db.execute(sql`select e.*, s.full_name, s.username from hr_incentive_events e join staff s on s.id=e.staff_id where e.period=${period} order by e.created_at desc limit 100`),
    db.execute(sql`select t.*, s.full_name, s.username from employee_targets t left join staff s on s.id=t.staff_id where t.period=${period} order by t.created_at desc`),
    db.execute(sql`select current_balance from master_cash_box where code='MASTER' limit 1`),
    db.execute(sql`select count(*) filter(where status='present')::int as present, count(*) filter(where status='late')::int as late, count(*) filter(where status in ('absent','no_show'))::int as absent from attendance_records where check_in_at >= ${period + '-01'} and check_in_at < (${period + '-01'}::date + interval '1 month')`),
  ]);
  const departments = new Map<string, { count: number; score: number; revenue: number; rating: number }>();
  for (const score of scores) { const item = departments.get(score.department) ?? { count: 0, score: 0, revenue: 0, rating: 0 }; item.count++; item.score += score.overall; item.revenue += score.details.revenue; item.rating += score.details.avgRating; departments.set(score.department, item); }
  return { period, employees: scores, attendance: rows<any>(attendance)[0] ?? { present: 0, late: 0, absent: 0 }, payroll: rows<any>(payroll), incentives: rows<any>(events).map((e) => ({ ...e, amount: num(e.amount), name: e.full_name || e.username })), targets: rows<any>(targets).map((t) => ({ ...t, target: num(t.target), completed: num(t.completed), rewardAmount: num(t.reward_amount), employeeName: t.full_name || t.username || "القسم" })), cashboxBalance: num(rows<any>(cash)[0]?.current_balance), departments: [...departments.entries()].map(([department, d]) => ({ department, count: d.count, performance: Math.round(d.score / Math.max(1, d.count)), revenue: d.revenue, rating: Math.round((d.rating / Math.max(1, d.count)) * 10) / 10 })), topEmployee: [...scores].sort((a, b) => b.overall - a.overall)[0] ?? null };
}

export async function payrollDashboard(period = periodNow()) {
  await Promise.all([ensureHrTables(), ensureEmployeeAdvanceTables()]);
  if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const [staff, runs, attendance, advances, events, departments] = await Promise.all([
    db.execute(sql`select count(*) filter(where is_active=true)::int as employees from staff`),
    db.execute(sql`select coalesce(sum(total_net::numeric),0)::float as monthly_payroll, coalesce(sum(total_net::numeric) filter(where status='paid'),0)::float as paid_salaries, coalesce(sum(total_net::numeric) filter(where status not in ('paid','cancelled')),0)::float as pending_salaries, coalesce(sum(total_deductions::numeric),0)::float as deductions from payroll_runs where period=${period} and deleted_at is null`),
    db.execute(sql`select count(*) filter(where lower(status) in ('present','late','out'))::int as attendance, count(*) filter(where lower(status) in ('absent','no_show'))::int as absence, count(*) filter(where lower(status)='late')::int as late_employees, coalesce(sum(greatest(extract(epoch from (check_out_at-check_in_at))/3600.0 - 8,0)) filter(where check_out_at is not null),0)::float as overtime from attendance_records where check_in_at >= ${period + '-01'} and check_in_at < (${period + '-01'}::date + interval '1 month')`),
    db.execute(sql`select coalesce(sum(remaining_amount::numeric),0)::float as advances from employee_advances where status in ('approved','paid')`),
    db.execute(sql`select coalesce(sum(amount::numeric) filter(where kind in ('bonus','reward')),0)::float as bonuses from hr_incentive_events where period=${period} and status <> 'cancelled'`),
    db.execute(sql`select s.department, count(*)::int as employees, coalesce(sum(l.net_salary::numeric),0)::float as net_salary from staff s left join payroll_lines l on l.staff_id=s.id left join payroll_runs r on r.id=l.payroll_run_id and r.period=${period} and r.deleted_at is null where s.is_active=true group by s.department order by s.department`),
  ]);
  const totals = rows<any>(runs)[0] ?? {};
  return { period, employees: Number(rows<any>(staff)[0]?.employees ?? 0), ...totals, netSalary: num(totals.monthly_payroll), ...rows<any>(attendance)[0], ...rows<any>(advances)[0], ...rows<any>(events)[0], departments: rows<any>(departments).map((row) => ({ department: row.department || "general", employees: Number(row.employees), netSalary: num(row.net_salary) })) };
}

export async function createManualIncentive(input: any, actor: HrActor) {
  await ensureHrTables();
  const staffId = Number(input?.staffId); const amount = num(input?.amount); const kind = ["bonus", "penalty", "reward"].includes(String(input?.kind)) ? String(input.kind) : "bonus";
  if (!Number.isInteger(staffId) || staffId <= 0 || amount < 0) throw new Error("بيانات الحافز غير صالحة");
  const period = String(input?.period || periodNow()); if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const result = await db.execute(sql`insert into hr_incentive_events(staff_id,period,kind,amount,points,title,reason,status,created_by,created_by_name) values(${staffId},${period},${kind},${amount},${Math.round(num(input?.points))},${String(input?.title || "إجراء إداري")},${String(input?.reason || "") || null},'pending',${actor.id},${actor.name}) returning *`);
  return rows(result)[0];
}

function formatIncentive(row: any) { return { ...row, amount: num(row.amount), quantity: num(row.quantity), ratePerUnit: num(row.rate_per_unit), percentage: num(row.percentage), baseAmount: num(row.base_amount), performanceScore: row.performance_score == null ? null : num(row.performance_score), customerRating: row.customer_rating == null ? null : num(row.customer_rating), employeeName: row.full_name || row.username || "", department: row.department || row.related_department || null, bonusType: row.bonus_type || row.title || "manual", bonusSource: row.bonus_source || "manual", calculationMethod: row.calculation_method || "fixed", calculationFormula: row.calculation_formula || String(row.amount || 0), createdByName: row.created_by_name || "system", approvedByName: row.approved_by_name || null, approvalDate: row.approval_date || null, sourceType: row.source_type || null, sourceId: row.source_id || null, payrollLineId: row.payroll_line_id || null }; }
function validateExistingBonus(row: any) { const issues: any[] = []; if (!Number.isInteger(Number(row.staff_id)) || Number(row.staff_id) <= 0) issues.push({ path: ["staffId"], message: "الموظف مطلوب" }); if (!validPeriod(String(row.period || ""))) issues.push({ path: ["period"], message: "فترة الرواتب غير صالحة" }); if (!BONUS_TYPES.includes(String(row.bonus_type || row.title || "manual") as any)) issues.push({ path: ["bonusType"], message: "نوع المكافأة غير صالح" }); if (!(num(row.amount) > 0)) issues.push({ path: ["amount"], message: "يجب أن يكون مبلغ المكافأة أكبر من صفر" }); if (!BONUS_STATUSES.includes(String(row.status) as any)) issues.push({ path: ["status"], message: "حالة المكافأة غير صالحة" }); if (issues.length) { console.error("Bonus record validation failed", { bonusId: row.id, issues, record: row }); const error: any = new Error(issues[0].message); error.name = "BonusValidationError"; error.issues = issues; throw error; } }

/** Validate a persisted bonus before every mutation. */
export async function validateBonusUpdate(id: number, input: any) {
  await ensureHrTables();
  const current = rows<any>(await db.execute(sql`select * from hr_incentive_events where id=${id} limit 1`))[0];
  if (!current) throw new Error("Bonus not found");
  const merged = { ...input, staffId: input?.staffId ?? current.staff_id, period: input?.period ?? current.period, bonusType: input?.bonusType ?? current.bonus_type ?? "manual", bonusSource: input?.bonusSource ?? current.bonus_source ?? "manual", calculationMethod: input?.calculationMethod ?? current.calculation_method ?? "fixed", amount: input?.amount ?? current.amount, quantity: input?.quantity ?? current.quantity, ratePerUnit: input?.ratePerUnit ?? current.rate_per_unit, percentage: input?.percentage ?? current.percentage, baseAmount: input?.baseAmount ?? current.base_amount };
  const parsed = bonusPayloadSchema.safeParse(merged);
  if (!parsed.success) { console.error("Bonus validation failed", { operation: "edit", bonusId: id, payload: input, issues: parsed.error.issues }); throw parsed.error; }
  const method = String(parsed.data.calculationMethod); const amount = method === "quantity_rate" ? num(parsed.data.quantity) * num(parsed.data.ratePerUnit) : method === "percentage" ? num(parsed.data.baseAmount) * num(parsed.data.percentage) / 100 : num(parsed.data.amount ?? parsed.data.finalAmount);
  if (!(amount > 0)) { const issue = { path: [method === "quantity_rate" ? "quantity" : method === "percentage" ? "baseAmount" : "amount"], message: "يجب أن يكون مبلغ المكافأة أكبر من صفر" }; console.error("Bonus validation failed", { operation: "edit", bonusId: id, payload: input, issues: [issue] }); const error: any = new Error(issue.message); error.name = "BonusValidationError"; error.issues = [issue]; throw error; }
  return parsed.data;
}

export async function validateBonus(id: number) {
  await ensureHrTables();
  const found = rows<any>(await db.execute(sql`select * from hr_incentive_events where id=${id} limit 1`))[0];
  if (!found) throw new Error("Bonus not found");
  if (!found.bonus_type) found.bonus_type = "manual";
  validateExistingBonus(found);
  return formatIncentive(found);
}

export async function createBonus(input: any, actor: HrActor) {
  await ensureHrTables();
  let periodValue: unknown = input?.period ?? input?.payrollPeriodId ?? input?.payroll_period_id;
  if (typeof periodValue === "number" || /^\d+$/.test(String(periodValue || ""))) {
    const payrollPeriodId = Number(periodValue);
    const run = rows<any>(await db.execute(sql`select period from payroll_runs where id=${payrollPeriodId} and deleted_at is null limit 1`))[0];
    if (!run) { const issue = { path: ["payrollPeriodId"], message: "دورة الرواتب غير موجودة" }; console.error("Bonus validation failed", { payload: input, issues: [issue] }); const error: any = new Error(issue.message); error.name = "BonusValidationError"; error.issues = [issue]; throw error; }
    periodValue = run.period;
  }
  const normalized = { ...input, staffId: input?.staffId ?? input?.employeeId, period: periodValue, bonusType: input?.bonusType ?? "manual", calculationMethod: input?.calculationMethod ?? "fixed", bonusSource: input?.bonusSource ?? input?.sourceType ?? "manual" };
  const parsed = bonusPayloadSchema.safeParse(normalized);
  if (!parsed.success) { console.error("Bonus validation failed", { payload: input, issues: parsed.error.issues }); throw parsed.error; }
  const staffId = Number(parsed.data.staffId); const period = String(parsed.data.period); const method = String(parsed.data.calculationMethod); const quantity = Math.max(0, num(parsed.data.quantity ?? 1)); const rate = Math.max(0, num(parsed.data.ratePerUnit)); const percentage = Math.max(0, num(parsed.data.percentage)); const base = Math.max(0, num(parsed.data.baseAmount)); const amount = method === "quantity_rate" ? num(quantity * rate) : method === "percentage" ? num(base * percentage / 100) : Math.max(0, num(parsed.data.amount ?? parsed.data.finalAmount)); const sourceType = String(input?.sourceType || "").trim() || null; const sourceId = String(input?.sourceId || "").trim() || null; const bonusType = String(parsed.data.bonusType).trim();
  const employee = rows<any>(await db.execute(sql`select id from staff where id=${staffId} and is_active=true limit 1`)); if (!employee.length) { const issue = { path: ["staffId"], message: "الموظف غير موجود أو غير نشط" }; console.error("Bonus validation failed", { payload: input, issues: [issue] }); const error: any = new Error(issue.message); error.name = "BonusValidationError"; error.issues = [issue]; throw error; }
  if (!(amount > 0)) { const issue = { path: [method === "quantity_rate" ? "quantity" : method === "percentage" ? "baseAmount" : "amount"], message: "يجب أن يكون مبلغ المكافأة أكبر من صفر" }; console.error("Bonus validation failed", { payload: input, issues: [issue] }); const error: any = new Error(issue.message); error.name = "BonusValidationError"; error.issues = [issue]; throw error; }
  if (sourceType && sourceId) { const duplicate = await db.execute(sql`select id from hr_incentive_events where staff_id=${staffId} and source_type=${sourceType} and source_id=${sourceId} and period=${period} and bonus_type=${bonusType} limit 1`); if (rows(duplicate).length) throw new Error("A bonus already exists for this source and payroll period"); }
  const formula = method === "quantity_rate" ? `${quantity} × ${rate}` : method === "percentage" ? `${percentage}% × ${base}` : `${amount}`; const result = await db.execute(sql`insert into hr_incentive_events(staff_id,period,kind,amount,title,reason,status,created_by,created_by_name,bonus_type,bonus_source,source_type,source_id,calculation_method,quantity,rate_per_unit,percentage,base_amount,calculation_formula,related_department,notes,performance_score,customer_rating,attachment) values(${staffId},${period},'bonus',${amount},${String(input?.title || bonusType)},${String(input?.reason || "") || null},'draft',${actor.id},${actor.name},${bonusType},${String(input?.bonusSource || "manual")},${sourceType},${sourceId},${method},${quantity},${rate},${percentage},${base},${formula},${String(input?.relatedDepartment || "") || null},${String(input?.notes || "") || null},${input?.performanceScore == null ? null : num(input.performanceScore)},${input?.customerRating == null ? null : num(input.customerRating)},${String(input?.attachment || "") || null}) returning *`); return formatIncentive(rows(result)[0]);
}

export async function listIncentives(filters: any = {}) { await ensureHrTables(); const clauses: any[] = []; if (filters.period && validPeriod(String(filters.period))) clauses.push(sql`e.period=${String(filters.period)}`); if (filters.staffId) clauses.push(sql`e.staff_id=${Number(filters.staffId)}`); if (filters.status) clauses.push(sql`e.status=${String(filters.status)}`); if (filters.bonusType) clauses.push(sql`e.bonus_type=${String(filters.bonusType)}`); if (filters.bonusSource) clauses.push(sql`e.bonus_source=${String(filters.bonusSource)}`); if (filters.department) clauses.push(sql`coalesce(s.department,e.related_department)=${String(filters.department)}`); const search = String(filters.search || "").trim(); if (search) clauses.push(sql`(s.full_name ilike ${`%${search}%`} or s.username ilike ${`%${search}%`} or coalesce(e.source_id,'') ilike ${`%${search}%`} or coalesce(e.title,'') ilike ${`%${search}%`})`); const where = clauses.length ? sql`where ${sql.join(clauses, sql` and `)}` : sql``; const result = await db.execute(sql`select e.*,s.full_name,s.username,s.department from hr_incentive_events e join staff s on s.id=e.staff_id ${where} order by e.created_at desc,e.id desc limit 500`); return rows<any>(result).map(formatIncentive); }

export async function updateBonus(id: number, input: any, actor: HrActor) { await ensureHrTables(); const current = rows<any>(await db.execute(sql`select * from hr_incentive_events where id=${id} limit 1`))[0]; if (!current) throw new Error("Bonus not found"); if (!["draft", "pending_approval", "rejected", "pending"].includes(String(current.status))) throw new Error("Approved or applied bonuses cannot be edited"); const method = ["fixed", "quantity_rate", "percentage"].includes(String(input?.calculationMethod)) ? String(input.calculationMethod) : String(current.calculation_method || "fixed"); const quantity = input?.quantity == null ? num(current.quantity) : Math.max(0, num(input.quantity)); const rate = input?.ratePerUnit == null ? num(current.rate_per_unit) : Math.max(0, num(input.ratePerUnit)); const percentage = input?.percentage == null ? num(current.percentage) : Math.max(0, num(input.percentage)); const base = input?.baseAmount == null ? num(current.base_amount) : Math.max(0, num(input.baseAmount)); const amount = method === "quantity_rate" ? num(quantity * rate) : method === "percentage" ? num(base * percentage / 100) : Math.max(0, num(input?.amount ?? current.amount)); const formula = method === "quantity_rate" ? `${quantity} × ${rate}` : method === "percentage" ? `${percentage}% × ${base}` : `${amount}`; const saved = rows<any>(await db.execute(sql`update hr_incentive_events set bonus_type=${String(input?.bonusType ?? current.bonus_type ?? current.title)},bonus_source=${String(input?.bonusSource ?? current.bonus_source ?? "manual")},period=${String(input?.period ?? current.period)},calculation_method=${method},quantity=${quantity},rate_per_unit=${rate},percentage=${percentage},base_amount=${base},amount=${amount},calculation_formula=${formula},title=${String(input?.title ?? current.title)},reason=${String(input?.reason ?? current.reason ?? "") || null},notes=${String(input?.notes ?? current.notes ?? "") || null} where id=${id} returning *`)); return formatIncentive(saved[0]); }
export async function approveBonus(id: number, actor: HrActor) { await ensureHrTables(); const saved = rows<any>(await db.execute(sql`update hr_incentive_events set status='approved',approved_by=${actor.id},approved_by_name=${actor.name},approval_date=now() where id=${id} and status in ('draft','pending_approval','pending','rejected') returning *`)); if (!saved.length) throw new Error("Bonus cannot be approved"); return formatIncentive(saved[0]); }
export async function rejectBonus(id: number, actor: HrActor, reason: string) { await ensureHrTables(); const saved = rows<any>(await db.execute(sql`update hr_incentive_events set status='rejected',reason=${reason} where id=${id} and status in ('draft','pending_approval','pending') returning *`)); if (!saved.length) throw new Error("Bonus cannot be rejected"); return formatIncentive(saved[0]); }
export async function deleteBonus(id: number, actor: HrActor) { await ensureHrTables(); const saved = rows<any>(await db.execute(sql`update hr_incentive_events set status='cancelled' where id=${id} and status in ('draft','pending_approval','pending','rejected') returning id`)); if (!saved.length) throw new Error("Approved or applied bonuses cannot be deleted"); return { id, status: "cancelled" }; }
export async function applyBonus(id: number, actor: HrActor) { await ensureHrTables(); const event = rows<any>(await db.execute(sql`select * from hr_incentive_events where id=${id} limit 1`))[0]; if (!event) throw new Error("Bonus not found"); if (!["approved", "applied_to_payroll"].includes(String(event.status))) throw new Error("Approve the bonus before applying it to payroll"); const run = rows<any>(await db.execute(sql`select * from payroll_runs where period=${event.period} and deleted_at is null limit 1`))[0]; if (!run) throw new Error("Create the payroll run for this period first"); const line = rows<any>(await db.execute(sql`select * from payroll_lines where payroll_run_id=${run.id} and staff_id=${event.staff_id} limit 1`))[0]; if (!line) throw new Error("No payroll line exists for this employee in this period"); if (event.payroll_line_id) return formatIncentive(event); await db.execute(sql`update hr_incentive_events set status='applied_to_payroll',payroll_line_id=${line.id} where id=${id} and status='approved'`); if (["draft", "calculated", "under_review"].includes(String(run.status))) await recalculatePayrollRun(Number(run.id), actor); return formatIncentive(rows<any>(await db.execute(sql`select * from hr_incentive_events where id=${id} limit 1`))[0]); }

export async function recalculateBonusPeriod(period: string, actor: HrActor) {
  await ensureHrTables();
  const run = rows<any>(await db.execute(sql`select id,status from payroll_runs where period=${period} and deleted_at is null limit 1`))[0];
  if (!run || !["draft", "calculated", "under_review"].includes(String(run.status))) return null;
  return recalculatePayrollRun(Number(run.id), actor);
}

export async function listBonusRules() { await ensureHrTables(); const result = await db.execute(sql`select * from hr_incentive_rules order by is_active desc,updated_at desc,id desc`); return rows<any>(result).map((r) => ({ ...r, threshold: num(r.threshold), amount: num(r.amount), active: Number(r.is_active) === 1 })); }
export async function saveBonusRule(input: any) { await ensureHrTables(); const code = String(input?.code || `rule_${Date.now()}`).trim().slice(0, 60); const name = String(input?.name || "قاعدة مكافأة").trim(); const metric = String(input?.metric || "performance").trim(); if (!name || !metric) throw new Error("بيانات قاعدة المكافأة غير مكتملة"); const result = await db.execute(sql`insert into hr_incentive_rules(code,name,kind,metric,operator,threshold,amount,department,is_active,metadata,updated_at) values(${code},${name},'bonus',${metric},${String(input?.operator || "gte")},${num(input?.threshold)},${num(input?.amount)},${String(input?.department || "") || null},${input?.isActive === false ? 0 : 1},${JSON.stringify(input?.metadata || {})}::jsonb,now()) on conflict(code) do update set name=excluded.name,metric=excluded.metric,operator=excluded.operator,threshold=excluded.threshold,amount=excluded.amount,department=excluded.department,is_active=excluded.is_active,metadata=excluded.metadata,updated_at=now() returning *`); return rows<any>(result)[0]; }
export async function deleteBonusRule(id: number) { await ensureHrTables(); await db.execute(sql`update hr_incentive_rules set is_active=0,updated_at=now() where id=${id}`); return { id, active: false }; }

async function createPayrollRunLegacy(period: string, actor: HrActor, notes = "") {
  await ensureHrTables();
  if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const existing = await db.execute(sql`select * from payroll_runs where period=${period} limit 1`);
  if (rows(existing).length) return getPayrollRun(Number(rows<any>(existing)[0].id));
  await evaluateAutomaticIncentives(period);
  const [staff, events] = await Promise.all([db.execute(sql`select id, full_name, username, base_salary from staff where is_active=true order by id`), db.execute(sql`select staff_id, kind, coalesce(sum(amount::numeric),0)::float as amount from hr_incentive_events where period=${period} and status in ('approved','applied_to_payroll','pending') group by staff_id,kind`)]);
  const eventMap = new Map<number, { bonus: number; penalty: number }>();
  for (const event of rows<any>(events)) { const row = eventMap.get(Number(event.staff_id)) ?? { bonus: 0, penalty: 0 }; if (["bonus", "reward"].includes(event.kind)) row.bonus += num(event.amount); if (event.kind === "penalty") row.penalty += num(event.amount); eventMap.set(Number(event.staff_id), row); }
  const [run] = rows<any>(await db.execute(sql`insert into payroll_runs(run_no,period,status,notes,created_by,created_by_name) values(${`PAY-${period.replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`},${period},'draft',${notes || null},${actor.id},${actor.name}) returning *`));
  let grossTotal = 0, deductionTotal = 0, netTotal = 0;
  for (const employee of rows<any>(staff)) {
    const advance = await getEmployeeAdvanceSummary(Number(employee.id));
    const incentive = eventMap.get(Number(employee.id)) ?? { bonus: 0, penalty: 0 };
    const base = num(employee.base_salary), gross = base + incentive.bonus, advanceDeduction = Math.min(advance.outstandingBalance, gross), net = Math.max(0, gross - incentive.penalty - advanceDeduction);
    await db.execute(sql`insert into payroll_lines(payroll_run_id,staff_id,base_salary,bonus_amount,penalty_amount,advance_deduction,gross_salary,net_salary) values(${run.id},${employee.id},${base},${incentive.bonus},${incentive.penalty},${advanceDeduction},${gross},${net})`);
    grossTotal += gross; deductionTotal += incentive.penalty + advanceDeduction; netTotal += net;
  }
  await db.execute(sql`update payroll_runs set total_gross=${grossTotal},total_deductions=${deductionTotal},total_net=${netTotal},updated_at=now() where id=${run.id}`);
  return getPayrollRun(run.id);
}

async function buildPayroll(input: unknown, persist: boolean, actor?: HrActor, replaceRunId?: number) {
  await ensureHrTables();
  const data = payrollInputSchema.parse(input);
  const dates = payrollDates(data.period, data);
  const existing = rows<any>(await db.execute(sql`select * from payroll_runs where period=${data.period} limit 1`))[0];
  if (existing && persist && !replaceRunId) throw new PayrollConflictError(await getPayrollRun(Number(existing.id)));
  await evaluateAutomaticIncentives(data.period);
  const ids = [...new Set(data.employeeIds ?? [])];
  const staffResult = await db.execute(sql`select s.*, ss.approval_status as salary_settings_approval, ss.enable_overtime, ss.enable_attendance_integration, ss.enable_advance_deduction, ss.enable_bonuses, ss.enable_penalties, ss.risk_allowance, ss.tax_deduction, ss.insurance_deduction, ss.retirement_deduction, ss.late_deduction as setting_late_deduction, ss.absence_deduction as setting_absence_deduction, ss.other_deduction, ss.monthly_bonus, ss.performance_bonus, ss.commission, ss.annual_bonus, ss.other_bonus, ss.max_monthly_overtime from staff s left join employee_salary_settings ss on ss.staff_id=s.id where s.is_active=true ${data.department ? sql`and s.department=${data.department}` : sql``} ${ids.length ? sql`and s.id in (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})` : sql``} order by s.id`);
  const staff = rows<any>(staffResult);
  if (!staff.length) throw new Error("لا يوجد موظفون نشطون يطابقون اختيار الرواتب");
  const incomplete = staff.map((s) => ({ staff: s, missing: [num(s.base_salary) <= 0 ? "الراتب الأساسي" : null, !["monthly", "weekly", "daily", "hourly"].includes(String(s.salary_type ?? "")) ? "نوع الراتب" : null, !["main_cash_box", "bank", "cash", "transfer"].includes(String(s.payment_method ?? "")) ? "طريقة الدفع" : null, String(s.salary_status ?? "") !== "active" ? "حالة الرواتب النشطة" : null, !s.salary_settings_approval ? "إعدادات الراتب" : null, s.salary_settings_approval === "pending" ? "اعتماد إعدادات الراتب" : null].filter(Boolean) })).filter((entry) => entry.missing.length);
  if (incomplete.length) {
    const error: any = new Error("Salary settings are incomplete for this employee.");
    error.code = "SALARY_SETTINGS_INCOMPLETE";
    error.employees = incomplete.map(({ staff: s, missing }) => ({ id: s.id, name: s.full_name || s.username, missing }));
    throw error;
  }
  const [attendanceResult, eventResult] = await Promise.all([
    db.execute(sql`select staff_id, count(distinct check_in_at::date)::int as attendance_days, count(*) filter(where lower(status)='late')::int as late_arrivals, count(*) filter(where check_out_at is null)::int as missing_check_out, coalesce(sum(extract(epoch from (check_out_at-check_in_at))/3600.0) filter(where check_out_at is not null),0)::float as working_hours from attendance_records where check_in_at >= ${dates.start} and check_in_at < (${dates.end}::date + interval '1 day') group by staff_id`),
    db.execute(sql`select staff_id, kind, coalesce(sum(amount::numeric),0)::float as amount from hr_incentive_events where period=${data.period} and status in ('approved','applied_to_payroll','pending') group by staff_id,kind`),
  ]);
  const attendance = new Map<number, any>(rows<any>(attendanceResult).map((a) => [Number(a.staff_id), a]));
  const incentives = new Map<number, { bonus: number; penalty: number }>();
  for (const event of rows<any>(eventResult)) { const row = incentives.get(Number(event.staff_id)) ?? { bonus: 0, penalty: 0 }; if (["bonus", "reward"].includes(String(event.kind))) row.bonus += num(event.amount); else if (event.kind === "penalty") row.penalty += num(event.amount); incentives.set(Number(event.staff_id), row); }
  const lines: any[] = [];
  for (const employee of staff) {
    const attendanceEnabled = employee.enable_attendance_integration !== false; const overtimeEnabled = employee.enable_overtime !== false; const att = attendance.get(Number(employee.id)); const scheduled = scheduledDays(dates.start, dates.end, num(employee.working_days_per_week)); const attendanceDays = attendanceEnabled ? Math.min(scheduled, Number(att?.attendance_days ?? 0)) : scheduled; const absenceDays = attendanceEnabled ? Math.max(0, scheduled - attendanceDays) : 0; const hours = attendanceEnabled ? num(att?.working_hours) : scheduled * num(employee.daily_working_hours); const rawOvertimeHours = overtimeEnabled ? Math.max(0, hours - attendanceDays * num(employee.daily_working_hours)) : 0; const overtimeHours = Math.min(rawOvertimeHours, num(employee.max_monthly_overtime) || rawOvertimeHours); const type = String(employee.salary_type ?? "monthly"); const configuredBase = num(employee.base_salary);
    const base = type === "weekly" ? configuredBase * (scheduled / 7) : type === "daily" ? configuredBase * attendanceDays : type === "hourly" ? (num(employee.hourly_rate) || configuredBase) * hours : configuredBase;
    const absenceDeduction = type === "monthly" && scheduled && att ? base / scheduled * absenceDays : 0; const overtimeAmount = overtimeHours * (num(employee.overtime_rate) || num(employee.hourly_rate)); const allowances = num(employee.attendance_allowance) + num(employee.transportation_allowance) + num(employee.food_allowance) + num(employee.phone_allowance) + num(employee.housing_allowance) + num(employee.other_fixed_allowances) + num(employee.risk_allowance); const incentive = incentives.get(Number(employee.id)) ?? { bonus: 0, penalty: 0 }; const annualBonus = String(employee.hired_at ?? "").slice(5, 7) === data.period.slice(5, 7) ? num(employee.annual_bonus) : 0; const fixedBonuses = employee.enable_bonuses === false ? 0 : num(employee.monthly_bonus) + num(employee.performance_bonus) + num(employee.commission) + annualBonus + num(employee.other_bonus); const gross = num(base + allowances + overtimeAmount + incentive.bonus + fixedBonuses);
    const advance = await getEmployeeAdvanceSummary(Number(employee.id)); const advanceInstallment = advance.history.filter((a: any) => ["approved", "paid"].includes(a.status)).reduce((sum: number, a: any) => sum + Math.min(num(a.monthlyDeduction), num(a.remainingAmount)), 0); const advanceDeduction = employee.enable_advance_deduction === false ? 0 : Math.min(Math.max(0, gross - absenceDeduction - incentive.penalty - num(employee.fixed_deduction)), advanceInstallment, advance.outstandingBalance); const settingsDeductions = num(employee.tax_deduction) + num(employee.insurance_deduction) + num(employee.retirement_deduction) + num(employee.other_deduction) + num(employee.setting_late_deduction) * Number(att?.late_arrivals ?? 0) + num(employee.setting_absence_deduction) * absenceDays; const deductions = absenceDeduction + incentive.penalty + num(employee.fixed_deduction) + advanceDeduction + settingsDeductions; const net = Math.max(0, gross - deductions);
    const calculationDetails = { formulas: { absenceDeduction: `${base} ÷ ${scheduled} × ${absenceDays}`, overtime: `${overtimeHours} × ${num(employee.overtime_rate) || num(employee.hourly_rate)}`, advanceDeduction: "مجموع الأقساط الشهرية النشطة ضمن صافي الراتب المستحق" }, sources: { attendance: att ? "attendance_records" : "لا توجد سجلات حضور للفترة", advances: advance.history.filter((a: any) => ["approved", "paid"].includes(a.status)).map((a: any) => ({ advanceNo: a.advanceNo, monthlyDeduction: a.monthlyDeduction, remainingAmount: a.remainingAmount })) } };
    lines.push({ employee, type, scheduled, attendanceDays, absenceDays, hours, overtimeHours, base, overtimeAmount, incentive, advanceDeduction, absenceDeduction, gross, deductions, net, calculationDetails, att });
  }
  const totals = lines.reduce((t, line) => ({ gross: t.gross + line.gross, deductions: t.deductions + line.deductions, net: t.net + line.net }), { gross: 0, deductions: 0, net: 0 });
  const attendanceWarning = lines.some((l) => !l.att) ? "لا توجد سجلات حضور لبعض الموظفين؛ لم تُعامل الأيام المفقودة كحضور." : null;
  if (!persist) return { period: data.period, ...dates, employees: lines.map((l) => ({ employeeId: l.employee.id, employeeName: l.employee.full_name || l.employee.username, department: l.employee.department, baseSalary: l.base, scheduledWorkingDays: l.scheduled, attendanceDays: l.attendanceDays, absenceDays: l.absenceDays, overtimeHours: l.overtimeHours, overtimeAmount: l.overtimeAmount, bonusAmount: l.incentive.bonus, penaltyAmount: l.incentive.penalty, advanceDeduction: l.advanceDeduction, absenceDeduction: l.absenceDeduction, totalAllowances: num(l.employee.attendance_allowance) + num(l.employee.transportation_allowance) + num(l.employee.food_allowance) + num(l.employee.phone_allowance) + num(l.employee.housing_allowance) + num(l.employee.other_fixed_allowances), grossSalary: l.gross, totalDeductions: l.deductions, netSalary: l.net, calculationDetails: l.calculationDetails })), totals, attendanceWarning };
  const [run] = replaceRunId ? rows<any>(await db.execute(sql`update payroll_runs set status='calculated',notes=${data.notes || null},period_start_date=${dates.start},period_end_date=${dates.end},payment_date=${dates.paymentDate},department=${data.department || null},attendance_warning=${attendanceWarning},updated_at=now() where id=${replaceRunId} returning *`)) : rows<any>(await db.execute(sql`insert into payroll_runs(run_no,period,status,notes,period_start_date,period_end_date,payment_date,department,attendance_warning,created_by,created_by_name) values(${`PAY-${data.period.replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`},${data.period},'calculated',${data.notes || null},${dates.start},${dates.end},${dates.paymentDate},${data.department || null},${attendanceWarning},${actor!.id},${actor!.name}) returning *`));
  if (replaceRunId) await db.execute(sql`delete from payroll_lines where payroll_run_id=${replaceRunId}`);
  for (const l of lines) await db.execute(sql`insert into payroll_lines(payroll_run_id,staff_id,base_salary,salary_type,payment_method,scheduled_working_days,attendance_days,absence_days,late_arrivals,total_working_hours,overtime_hours,missing_check_out,overtime_amount,attendance_allowance,transportation_allowance,food_allowance,phone_allowance,housing_allowance,other_fixed_allowances,bonus_amount,penalty_amount,advance_deduction,absence_deduction,fixed_deduction,gross_salary,net_salary,calculation_details) values(${run.id},${l.employee.id},${l.base},${l.type},${l.employee.payment_method || 'cash'},${l.scheduled},${l.attendanceDays},${l.absenceDays},${Number(l.att?.late_arrivals ?? 0)},${l.hours},${l.overtimeHours},${Number(l.att?.missing_check_out ?? 0)},${l.overtimeAmount},${num(l.employee.attendance_allowance)},${num(l.employee.transportation_allowance)},${num(l.employee.food_allowance)},${num(l.employee.phone_allowance)},${num(l.employee.housing_allowance)},${num(l.employee.other_fixed_allowances)},${l.incentive.bonus},${l.incentive.penalty},${l.advanceDeduction},${l.absenceDeduction},${num(l.employee.fixed_deduction)},${l.gross},${l.net},${JSON.stringify(l.calculationDetails)}::jsonb)`);
  await db.execute(sql`update payroll_runs set total_gross=${totals.gross},total_deductions=${totals.deductions},total_net=${totals.net},updated_at=now() where id=${run.id}`);
  return getPayrollRun(run.id);
}

export async function previewPayrollRun(input: unknown) { return buildPayroll(input, false); }
export async function createPayrollRun(input: unknown, actor: HrActor) { return buildPayroll(input, true, actor); }

export async function recalculatePayrollRun(id: number, actor: HrActor) {
  const run = await getPayrollRun(id);
  if (!run) throw new Error("دورة الرواتب غير موجودة");
  if (!["draft", "calculated", "under_review"].includes(run.status)) throw new Error("لا يمكن إعادة حساب دورة رواتب معتمدة أو مدفوعة");
  return buildPayroll({ period: run.period, department: run.department || undefined, employeeIds: run.lines.map((line: any) => Number(line.staff_id)), periodStartDate: run.periodStartDate || undefined, periodEndDate: run.periodEndDate || undefined, paymentDate: run.paymentDate || undefined, notes: run.notes || undefined }, true, actor, id);
}

async function payrollFinancialBlock(run: any) {
  await ensureEmployeeAdvanceTables();
  const linked = rows<any>(await db.execute(sql`select l.id from payroll_lines l where l.payroll_run_id=${run.id} and (l.financial_transaction_id is not null or l.amount_paid > 0 or exists (select 1 from financial_transactions ft where ft.source_type='payroll_line' and ft.source_id=cast(l.id as text))) limit 1`));
  if (linked.length) return "توجد دفعة أو قيد محاسبي مرتبط بهذا الراتب";
  const advances = rows<any>(await db.execute(sql`select id from employee_advance_repayments where payroll_reference=${run.run_no} limit 1`));
  return advances.length ? "توجد استقطاعات سلف مرتبطة بهذا الراتب" : null;
}

async function applyPayrollAdvanceDeductionOnce(line: any, run: any, actor: HrActor) {
  if (num(line.advanceDeduction) <= 0) return;
  await ensureEmployeeAdvanceTables();
  const existing = rows<any>(await db.execute(sql`select id from employee_advance_repayments where employee_id=${line.staff_id} and payroll_reference=${run.run_no} and kind='payroll' limit 1`));
  if (!existing.length) await applyPayrollAdvanceDeductions({ employeeId: line.staff_id, payrollReference: run.run_no, amount: line.advanceDeduction }, actor);
}

async function updatePayrollTotals(id: number) {
  const totals = rows<any>(await db.execute(sql`select coalesce(sum(gross_salary),0)::float as gross,coalesce(sum(gross_salary-net_salary),0)::float as deductions,coalesce(sum(net_salary),0)::float as net from payroll_lines where payroll_run_id=${id}`))[0] ?? {};
  await db.execute(sql`update payroll_runs set total_gross=${num(totals.gross)},total_deductions=${num(totals.deductions)},total_net=${num(totals.net)},updated_at=now() where id=${id}`);
}

export async function editPayrollLine(runId: number, lineId: number, input: unknown, actor: HrActor) {
  await ensureHrTables(); const changes = payrollLineEditSchema.parse(input); const run = await getPayrollRun(runId);
  if (!run || run.deleted_at) throw new Error("دورة الرواتب غير موجودة");
  if (!["draft", "calculated", "under_review"].includes(run.status)) throw new Error("لا يمكن تعديل راتب معتمد أو مدفوع");
  const current = rows<any>(await db.execute(sql`select * from payroll_lines where id=${lineId} and payroll_run_id=${runId} limit 1`))[0];
  if (!current) throw new Error("سجل راتب الموظف غير موجود"); if (current.financial_transaction_id || num(current.amount_paid) > 0) throw new Error("توجد دفعة مرتبطة بهذا الراتب");
  const value = (key: keyof z.infer<typeof payrollLineEditSchema>, field: string) => changes[key] === undefined ? num(current[field]) : num(changes[key]);
  const baseSalary = value("baseSalary", "base_salary"), overtimeAmount = value("overtimeAmount", "overtime_amount"), bonusAmount = value("bonusAmount", "bonus_amount"), commissionAmount = value("commissionAmount", "commission_amount"), otherEarnings = value("otherEarnings", "manual_earnings");
  const attendanceDeduction = value("attendanceDeduction", "attendance_deduction"), absenceDeduction = value("absenceDeduction", "absence_deduction"), lateDeduction = value("lateDeduction", "late_deduction"), advanceDeduction = value("advanceDeduction", "advance_deduction"), manualDeduction = value("manualDeduction", "manual_deduction"), otherDeductions = value("otherDeductions", "other_deductions");
  const allowances = num(current.attendance_allowance) + num(current.transportation_allowance) + num(current.food_allowance) + num(current.phone_allowance) + num(current.housing_allowance) + num(current.other_fixed_allowances);
  const grossSalary = num(baseSalary + allowances + overtimeAmount + bonusAmount + commissionAmount + otherEarnings);
  const deductions = num(attendanceDeduction + absenceDeduction + lateDeduction + advanceDeduction + manualDeduction + otherDeductions + num(current.penalty_amount) + num(current.insurance_amount) + num(current.fixed_deduction) + num(current.early_leave_deduction) + num(current.unpaid_leave_deduction));
  const netSalary = Math.max(0, num(grossSalary - deductions)); const details = { ...(current.calculation_details ?? {}), manualEdit: { actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), totalDeductions: deductions } };
  const saved = rows<any>(await db.execute(sql`update payroll_lines set base_salary=${baseSalary},overtime_amount=${overtimeAmount},bonus_amount=${bonusAmount},commission_amount=${commissionAmount},manual_earnings=${otherEarnings},attendance_deduction=${attendanceDeduction},absence_deduction=${absenceDeduction},late_deduction=${lateDeduction},advance_deduction=${advanceDeduction},manual_deduction=${manualDeduction},other_deductions=${otherDeductions},line_notes=${changes.notes === undefined ? current.line_notes : changes.notes || null},payment_method=${changes.paymentMethod ?? current.payment_method},gross_salary=${grossSalary},net_salary=${netSalary},calculation_details=${JSON.stringify(details)}::jsonb where id=${lineId} and payroll_run_id=${runId} and exists (select 1 from payroll_runs r where r.id=${runId} and r.status in ('draft','calculated','under_review') and r.deleted_at is null) returning id`));
  if (!saved.length) throw new Error("لا يمكن تعديل الراتب بعد تغيّر حالته");
  if (changes.paymentDate !== undefined) await db.execute(sql`update payroll_runs set payment_date=${changes.paymentDate || null},updated_at=now() where id=${runId}`);
  await updatePayrollTotals(runId); const updated = await getPayrollRun(runId); return { run: updated, oldValues: current, newValues: updated?.lines.find((line: any) => Number(line.id) === lineId) };
}

export async function deleteDraftPayrollRun(id: number, actor: HrActor, input?: unknown) {
  await ensureHrTables();
  const currentRun = await getPayrollRun(id);
  if (!currentRun) throw new Error("دورة الرواتب غير موجودة");
  if (!["draft", "calculated", "cancelled"].includes(currentRun.status)) throw new Error("لا يمكن حذف راتب معتمد أو مدفوع");
  const blocked = await payrollFinancialBlock(currentRun);
  if (blocked) throw new Error(`${blocked}. استخدم إلغاء الراتب بدلاً من الحذف.`);
  const reason = input && typeof input === "object" && "reason" in (input as any)
    ? reasonSchema.parse(input).reason
    : "حذف مسودة الرواتب";
  const deleted = rows<any>(await db.execute(sql`update payroll_runs set deleted_at=now(),deleted_by=${actor.id},delete_reason=${reason},status='cancelled',cancelled_at=now(),cancelled_by=${actor.id},cancel_reason=${reason},updated_at=now() where id=${id} and status in ('draft','calculated','cancelled') and deleted_at is null returning id`));
  if (!deleted.length) throw new Error("لا يمكن حذف الراتب بعد تغيّر حالته");
  return { id, oldValues: currentRun };
}

export async function cancelPayrollRun(id: number, actor: HrActor, input: unknown) {
  await ensureHrTables(); const data = reasonSchema.parse(input); const run = await getPayrollRun(id);
  if (!run) throw new Error("دورة الرواتب غير موجودة");
  if (["paid", "partially_paid", "processing"].includes(run.status)) throw new Error("لا يمكن إلغاء راتب مدفوع أو قيد الدفع");
  const blocked = await payrollFinancialBlock(run); if (blocked) throw new Error(blocked);
  await db.execute(sql`update payroll_runs set status='cancelled',cancelled_at=now(),cancelled_by=${actor.id},cancel_reason=${data.reason},updated_at=now() where id=${id}`);
  return getPayrollRun(id);
}

export async function reopenPayrollRun(id: number, actor: HrActor, input: unknown) {
  await ensureHrTables(); const data = reasonSchema.parse(input); const run = await getPayrollRun(id);
  if (!run) throw new Error("دورة الرواتب غير موجودة");
  if (run.status !== "approved") throw new Error("يمكن إعادة فتح راتب معتمد فقط");
  const blocked = await payrollFinancialBlock(run); if (blocked) throw new Error(`${blocked}. لا يمكن إعادة فتحه قبل عكس القيد المالي بأمان.`);
  await db.execute(sql`update payroll_runs set status='calculated',reopened_at=now(),reopened_by=${actor.id},reopen_reason=${data.reason},approved_by=null,approved_by_name='',approved_at=null,updated_at=now() where id=${id}`);
  return getPayrollRun(id);
}

export async function getPayrollRun(id: number) {
  await ensureHrTables();
  const run = rows<any>(await db.execute(sql`select * from payroll_runs where id=${id} limit 1`))[0];
  if (!run) return null;
  const lines = rows<any>(await db.execute(sql`select l.*,s.full_name,s.username,s.department,s.job_title from payroll_lines l join staff s on s.id=l.staff_id where l.payroll_run_id=${id} order by s.full_name`)).map((line) => ({ ...line, employeeName: line.full_name || line.username, department: line.department, jobTitle: line.job_title, salaryType: line.salary_type, paymentMethod: line.payment_method, paymentStatus: line.payment_status, baseSalary: num(line.base_salary), overtimeAmount: num(line.overtime_amount), bonusAmount: num(line.bonus_amount), commissionAmount: num(line.commission_amount), otherEarnings: num(line.manual_earnings), penaltyAmount: num(line.penalty_amount), advanceDeduction: num(line.advance_deduction), grossSalary: num(line.gross_salary), netSalary: num(line.net_salary), totalDeductions: num(line.gross_salary) - num(line.net_salary), amountPaid: num(line.amount_paid), remainingSalary: Math.max(0, num(line.net_salary) - num(line.amount_paid)), scheduledWorkingDays: Number(line.scheduled_working_days ?? 0), attendanceDays: Number(line.attendance_days ?? 0), absenceDays: Number(line.absence_days ?? 0), totalWorkingHours: num(line.total_working_hours), overtimeHours: num(line.overtime_hours), attendanceAllowance: num(line.attendance_allowance), transportationAllowance: num(line.transportation_allowance), foodAllowance: num(line.food_allowance), phoneAllowance: num(line.phone_allowance), housingAllowance: num(line.housing_allowance), otherFixedAllowances: num(line.other_fixed_allowances), attendanceDeduction: num(line.attendance_deduction), absenceDeduction: num(line.absence_deduction), lateDeduction: num(line.late_deduction), manualDeduction: num(line.manual_deduction), otherDeductions: num(line.other_deductions), fixedDeduction: num(line.fixed_deduction), lineNotes: line.line_notes ?? null, calculationDetails: line.calculation_details ?? {} }));
  return { ...run, periodStartDate: run.period_start_date ? String(run.period_start_date) : null, periodEndDate: run.period_end_date ? String(run.period_end_date) : null, paymentDate: run.payment_date ? String(run.payment_date) : null, attendanceWarning: run.attendance_warning ?? null, totalGross: num(run.total_gross), totalDeductions: num(run.total_deductions), totalNet: num(run.total_net), lines };
}

export async function listPayrollRuns() { await ensureHrTables(); const result = await db.execute(sql`select * from payroll_runs where deleted_at is null order by period desc limit 36`); return Promise.all(rows<any>(result).map((run) => getPayrollRun(Number(run.id)))); }

export async function approvePayrollRun(id: number, actor: HrActor) {
  if (!['admin', 'manager', 'accountant'].includes(actor.role)) throw new Error("اعتماد الرواتب يتطلب صلاحية إدارية أو محاسبية");
  const run = await getPayrollRun(id);
  if (!run) throw new Error("دورة الرواتب غير موجودة");
  if (run.status === "approved" || run.status === "paid") return run;
  if (!["draft", "calculated", "under_review"].includes(run.status)) throw new Error("دورة الرواتب مقفلة ولا يمكن اعتمادها");
  await db.execute(sql`update payroll_runs set status='approved',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),updated_at=now() where id=${id}`);
  return getPayrollRun(id);
}

async function payPayrollRunLegacy(id: number, actor: HrActor) {
  if (!['admin', 'manager', 'accountant'].includes(actor.role)) throw new Error("دفع الرواتب يتطلب صلاحية إدارية أو محاسبية");
  const run = await getPayrollRun(id); if (!run) throw new Error("دورة الرواتب غير موجودة"); if (run.status === 'paid') return run; if (run.status !== 'draft') throw new Error("دورة الرواتب غير قابلة للدفع");
  if (run.status !== 'approved') throw new Error("يجب اعتماد دورة الرواتب قبل الدفع");
  const claimed = rows<any>(await db.execute(sql`update payroll_runs set status='processing',updated_at=now() where id=${id} and status='approved' returning id`))[0];
  if (!claimed) throw new Error("دورة الرواتب قيد المعالجة بالفعل؛ لا تعِد الدفع حتى تكتمل أو تُراجع.");
  try {
  for (const line of run.lines) {
    if (line.netSalary <= 0) continue;
    if (line.financial_transaction_id || num(line.amountPaid) > 0) { await applyPayrollAdvanceDeductionOnce(line, run, actor); continue; }
    const tx = await createFinancialTransaction({ transactionDate: `${run.period}-01`, direction: 'expense', amount: line.netSalary, department: 'hr', transactionType: 'payroll_salary', description: `راتب ${run.period}: ${line.employeeName}`, paymentMethod: 'cash', sourceType: 'payroll_line', sourceId: String(line.id), sourceEvent: 'salary_paid', idempotencyKey: `payroll:${id}:line:${line.id}`, approvalStatus: 'pending', responsibleUserId: line.staff_id, responsibleUserName: line.employeeName, notes: `دورة رواتب ${run.run_no}`, attachments: [] }, actor);
    const executed = await approveAndExecuteFinancialTransaction(tx.id, actor);
    await db.execute(sql`update payroll_lines set financial_transaction_id=${executed.id} where id=${line.id}`);
    await applyPayrollAdvanceDeductionOnce(line, run, actor);
  }
  await db.execute(sql`update hr_incentive_events set status='applied_to_payroll' where period=${run.period} and status in ('approved','pending')`);
  await db.execute(sql`update payroll_runs set status='paid', approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),paid_at=now(),updated_at=now() where id=${id}`);
  return getPayrollRun(id);
  } catch (err) {
    await db.execute(sql`update payroll_runs set status='approved',updated_at=now() where id=${id} and status='processing'`);
    throw err;
  }
}

export async function payPayrollRun(id: number, actor: HrActor) {
  if (!['admin', 'manager', 'accountant'].includes(actor.role)) throw new Error("دفع الرواتب يتطلب صلاحية إدارية أو محاسبية");
  const run = await getPayrollRun(id);
  if (!run) throw new Error("دورة الرواتب غير موجودة");
  if (run.status === "paid") return run;
  if (run.status !== "approved") throw new Error("يجب اعتماد دورة الرواتب قبل الدفع");
  const claimed = rows<any>(await db.execute(sql`update payroll_runs set status='processing',updated_at=now() where id=${id} and status='approved' returning id`))[0];
  if (!claimed) throw new Error("دورة الرواتب قيد المعالجة بالفعل");
  try {
    for (const line of run.lines) {
      if (line.netSalary <= 0) continue;
      if (line.financial_transaction_id || num(line.amountPaid) > 0) { await applyPayrollAdvanceDeductionOnce(line, run, actor); continue; }
      const tx = await createFinancialTransaction({ transactionDate: run.paymentDate || `${run.period}-01`, direction: 'expense', amount: line.netSalary, department: 'hr', transactionType: 'payroll_salary', description: `راتب ${run.period}: ${line.employeeName}`, paymentMethod: line.paymentMethod || 'cash', sourceType: 'payroll_line', sourceId: String(line.id), sourceEvent: 'salary_paid', idempotencyKey: `payroll:${id}:line:${line.id}`, approvalStatus: 'pending', responsibleUserId: line.staff_id, responsibleUserName: line.employeeName, notes: `دورة رواتب ${run.run_no}`, attachments: [] }, actor);
      const executed = await approveAndExecuteFinancialTransaction(tx.id, actor);
      await db.execute(sql`update payroll_lines set financial_transaction_id=${executed.id},amount_paid=net_salary,payment_status='paid' where id=${line.id}`);
      await applyPayrollAdvanceDeductionOnce(line, run, actor);
    }
    await db.execute(sql`update hr_incentive_events set status='applied_to_payroll' where period=${run.period} and status in ('approved','pending')`);
    await db.execute(sql`update payroll_runs set status='paid',paid_at=now(),updated_at=now() where id=${id}`);
    return getPayrollRun(id);
  } catch (err) {
    await db.execute(sql`update payroll_runs set status='approved',updated_at=now() where id=${id} and status='processing'`);
    throw err;
  }
}

export async function upsertTarget(input: any, actor: HrActor) {
  await ensureHrTables(); const period = String(input?.period || periodNow()); const metric = String(input?.metric || '').trim(); const target = num(input?.target);
  if (!validPeriod(period) || !metric || target <= 0) throw new Error("بيانات الهدف غير صالحة");
  const r = await db.execute(sql`insert into employee_targets(staff_id,department,period,metric,target,completed,reward_amount,status,created_by) values(${Number(input?.staffId) || null},${String(input?.department || '') || null},${period},${metric},${target},${num(input?.completed)},${num(input?.rewardAmount)},'active',${actor.id}) returning *`); return rows(r)[0];
}

export async function createEvaluation(input: any, actor: HrActor) {
  await ensureHrTables(); const staffId = Number(input?.staffId); if (!Number.isInteger(staffId) || staffId <= 0) throw new Error("الموظف مطلوب"); const score = (key: string) => Math.max(0, Math.min(100, Math.round(num(input?.[key]))));
  const r = await db.execute(sql`insert into employee_evaluations(staff_id,evaluator_id,evaluator_name,period,discipline,communication,leadership,quality,responsibility,speed,innovation,comments) values(${staffId},${actor.id},${actor.name},${String(input?.period || periodNow())},${score('discipline')},${score('communication')},${score('leadership')},${score('quality')},${score('responsibility')},${score('speed')},${score('innovation')},${String(input?.comments || '') || null}) returning *`); return rows(r)[0];
}

export async function addCareerEvent(input: any, actor: HrActor) {
  await ensureHrTables(); const staffId = Number(input?.staffId); const title = String(input?.title || '').trim(); if (!Number.isInteger(staffId) || !title) throw new Error("الموظف والمسمى الوظيفي مطلوبان"); const r = await db.execute(sql`insert into employee_career_history(staff_id,title,level,effective_date,notes,created_by) values(${staffId},${title},${String(input?.level || 'worker')},${String(input?.effectiveDate || new Date().toISOString().slice(0,10))},${String(input?.notes || '') || null},${actor.id}) returning *`); return rows(r)[0];
}

export async function executiveDashboard(period = periodNow()) {
  const hr = await hrDashboard(period);
  const [revenue, orders, products, advances, production] = await Promise.all([
    db.execute(sql`select coalesce(sum(amount::numeric) filter(where transaction_date::text like ${period + '%'}),0)::float as monthly, coalesce(sum(amount::numeric) filter(where transaction_date=current_date),0)::float as today from financial_transactions where approval_status='executed' and direction='revenue'`),
    db.execute(sql`select count(*) filter(where lower(status) not in ('completed','delivered','cancelled','canceled'))::int as pending from orders`),
    db.execute(sql`select name_ar, coalesce(sum(quantity),0)::float as qty from order_items oi join products p on p.id=oi.product_id group by name_ar order by qty desc limit 1`),
    db.execute(sql`select coalesce(sum(remaining_amount::numeric),0)::float as outstanding from employee_advances where status in ('paid','approved')`),
    db.execute(sql`select count(*) filter(where lower(status) not in ('completed','done'))::int as pending from tasks`),
  ]);
  return { ...hr, revenue: rows<any>(revenue)[0] ?? { monthly: 0, today: 0 }, pendingOrders: Number(rows<any>(orders)[0]?.pending || 0), topProduct: rows<any>(products)[0] ?? null, outstandingAdvances: num(rows<any>(advances)[0]?.outstanding), productionPending: Number(rows<any>(production)[0]?.pending || 0), aiInsights: aiInsights(hr) };
}

function aiInsights(hr: any) {
  const insights: string[] = []; const best = hr.topEmployee;
  if (best) insights.push(`أفضل موظف هذا الشهر: ${best.name} بنتيجة أداء ${best.overall}%.`);
  for (const employee of hr.employees.filter((x: EmployeeScore) => x.details.late >= 3).slice(0, 3)) insights.push(`${employee.name}: تكرار التأخير (${employee.details.late}) قد يفسر انخفاض الأداء.`);
  for (const employee of hr.employees.filter((x: EmployeeScore) => x.overall >= 90).slice(0, 3)) insights.push(`${employee.name}: مؤهل لمكافأة أو ترقية بناءً على الأداء.`);
  if (!insights.length) insights.push("لا توجد مؤشرات مخاطرة عالية حاليًا؛ استمر في متابعة الحضور والأهداف."); return insights;
}
