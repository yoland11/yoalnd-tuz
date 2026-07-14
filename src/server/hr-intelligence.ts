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

const payrollInputSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  department: z.string().trim().max(60).optional().nullable(),
  employeeIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
  periodStartDate: z.string().date().optional(),
  periodEndDate: z.string().date().optional(),
  paymentDate: z.string().date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

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
    create table if not exists hr_incentive_rules (id serial primary key, code varchar(60) not null unique, name text not null, kind varchar(20) not null default 'bonus', metric varchar(60) not null, operator varchar(10) not null default 'gte', threshold numeric(16,2) not null default 0, amount numeric(16,2) not null default 0, department varchar(60), is_active integer not null default 1, metadata jsonb not null default '{}'::jsonb, created_at timestamp not null default now(), updated_at timestamp not null default now());
    create table if not exists hr_incentive_events (id serial primary key, staff_id integer not null references staff(id) on delete restrict, rule_id integer references hr_incentive_rules(id) on delete set null, period varchar(7) not null, kind varchar(20) not null, amount numeric(16,2) not null default 0, points integer not null default 0, title text not null default '', reason text, status varchar(20) not null default 'pending', payroll_line_id integer, created_by integer references staff(id) on delete set null, created_by_name text not null default 'system', created_at timestamp not null default now());
    create index if not exists hr_incentive_events_staff_period_idx on hr_incentive_events(staff_id, period);
    create table if not exists payroll_runs (id serial primary key, run_no varchar(40) not null unique, period varchar(7) not null unique, status varchar(20) not null default 'draft', notes text, total_gross numeric(16,2) not null default 0, total_deductions numeric(16,2) not null default 0, total_net numeric(16,2) not null default 0, created_by integer references staff(id) on delete set null, created_by_name text not null default '', approved_by integer references staff(id) on delete set null, approved_by_name text not null default '', approved_at timestamp, paid_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
    alter table payroll_runs add column if not exists period_start_date date, add column if not exists period_end_date date, add column if not exists payment_date date, add column if not exists department varchar(60), add column if not exists attendance_warning text;
    create table if not exists payroll_lines (id serial primary key, payroll_run_id integer not null references payroll_runs(id) on delete restrict, staff_id integer not null references staff(id) on delete restrict, base_salary numeric(16,2) not null default 0, overtime_amount numeric(16,2) not null default 0, bonus_amount numeric(16,2) not null default 0, penalty_amount numeric(16,2) not null default 0, advance_deduction numeric(16,2) not null default 0, insurance_amount numeric(16,2) not null default 0, gross_salary numeric(16,2) not null default 0, net_salary numeric(16,2) not null default 0, financial_transaction_id integer, signature_name text, signed_at timestamp, created_at timestamp not null default now());
    alter table payroll_lines add column if not exists salary_type varchar(20) not null default 'monthly', add column if not exists payment_method varchar(30) not null default 'cash', add column if not exists scheduled_working_days integer not null default 0, add column if not exists attendance_days integer not null default 0, add column if not exists absence_days integer not null default 0, add column if not exists paid_leave_days integer not null default 0, add column if not exists unpaid_leave_days integer not null default 0, add column if not exists late_arrivals integer not null default 0, add column if not exists total_late_minutes integer not null default 0, add column if not exists early_leave_count integer not null default 0, add column if not exists total_working_hours numeric(16,2) not null default 0, add column if not exists overtime_hours numeric(16,2) not null default 0, add column if not exists missing_check_in integer not null default 0, add column if not exists missing_check_out integer not null default 0, add column if not exists attendance_allowance numeric(16,2) not null default 0, add column if not exists transportation_allowance numeric(16,2) not null default 0, add column if not exists food_allowance numeric(16,2) not null default 0, add column if not exists phone_allowance numeric(16,2) not null default 0, add column if not exists housing_allowance numeric(16,2) not null default 0, add column if not exists other_fixed_allowances numeric(16,2) not null default 0, add column if not exists absence_deduction numeric(16,2) not null default 0, add column if not exists late_deduction numeric(16,2) not null default 0, add column if not exists early_leave_deduction numeric(16,2) not null default 0, add column if not exists unpaid_leave_deduction numeric(16,2) not null default 0, add column if not exists fixed_deduction numeric(16,2) not null default 0, add column if not exists amount_paid numeric(16,2) not null default 0, add column if not exists payment_status varchar(20) not null default 'unpaid', add column if not exists calculation_details jsonb not null default '{}'::jsonb;
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
    const inserted = await db.execute(sql`insert into hr_incentive_events(staff_id,rule_id,period,kind,amount,title,reason,status,created_by_name) values(${employee.staffId},${rule.id},${period},${rule.kind},${rule.amount},${rule.name},${`قيمة المؤشر: ${Math.round(value * 100) / 100}`},'pending','النظام') returning *`);
    created.push(rows(inserted)[0]);
  }
  return created;
}

export async function hrDashboard(period = periodNow()) {
  await ensureHrTables();
  const [scores, payroll, events, targets, cash, attendance] = await Promise.all([
    computeEmployeeScores({ from: `${period}-01`, to: `${period}-31` }),
    db.execute(sql`select * from payroll_runs order by created_at desc limit 12`),
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
    db.execute(sql`select coalesce(sum(total_net::numeric),0)::float as monthly_payroll, coalesce(sum(total_net::numeric) filter(where status='paid'),0)::float as paid_salaries, coalesce(sum(total_net::numeric) filter(where status not in ('paid','cancelled')),0)::float as pending_salaries, coalesce(sum(total_deductions::numeric),0)::float as deductions from payroll_runs where period=${period}`),
    db.execute(sql`select count(*) filter(where lower(status) in ('present','late'))::int as attendance, count(*) filter(where lower(status)='late')::int as late_employees, coalesce(sum(greatest(extract(epoch from (check_out_at-check_in_at))/3600.0 - 8,0)) filter(where check_out_at is not null),0)::float as overtime from attendance_records where check_in_at >= ${period + '-01'} and check_in_at < (${period + '-01'}::date + interval '1 month')`),
    db.execute(sql`select coalesce(sum(remaining_amount::numeric),0)::float as advances from employee_advances where status in ('approved','paid')`),
    db.execute(sql`select coalesce(sum(amount::numeric) filter(where kind in ('bonus','reward')),0)::float as bonuses from hr_incentive_events where period=${period} and status <> 'cancelled'`),
    db.execute(sql`select s.department, count(*)::int as employees, coalesce(sum(l.net_salary::numeric),0)::float as net_salary from staff s left join payroll_lines l on l.staff_id=s.id left join payroll_runs r on r.id=l.payroll_run_id and r.period=${period} where s.is_active=true group by s.department order by s.department`),
  ]);
  return { period, employees: Number(rows<any>(staff)[0]?.employees ?? 0), ...rows<any>(runs)[0], ...rows<any>(attendance)[0], ...rows<any>(advances)[0], ...rows<any>(events)[0], departments: rows<any>(departments).map((row) => ({ department: row.department || "general", employees: Number(row.employees), netSalary: num(row.net_salary) })) };
}

export async function createManualIncentive(input: any, actor: HrActor) {
  await ensureHrTables();
  const staffId = Number(input?.staffId); const amount = num(input?.amount); const kind = ["bonus", "penalty", "reward"].includes(String(input?.kind)) ? String(input.kind) : "bonus";
  if (!Number.isInteger(staffId) || staffId <= 0 || amount < 0) throw new Error("بيانات الحافز غير صالحة");
  const period = String(input?.period || periodNow()); if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const result = await db.execute(sql`insert into hr_incentive_events(staff_id,period,kind,amount,points,title,reason,status,created_by,created_by_name) values(${staffId},${period},${kind},${amount},${Math.round(num(input?.points))},${String(input?.title || "إجراء إداري")},${String(input?.reason || "") || null},'pending',${actor.id},${actor.name}) returning *`);
  return rows(result)[0];
}

async function createPayrollRunLegacy(period: string, actor: HrActor, notes = "") {
  await ensureHrTables();
  if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const existing = await db.execute(sql`select * from payroll_runs where period=${period} limit 1`);
  if (rows(existing).length) return getPayrollRun(Number(rows<any>(existing)[0].id));
  await evaluateAutomaticIncentives(period);
  const [staff, events] = await Promise.all([db.execute(sql`select id, full_name, username, base_salary from staff where is_active=true order by id`), db.execute(sql`select staff_id, kind, coalesce(sum(amount::numeric),0)::float as amount from hr_incentive_events where period=${period} and status='pending' group by staff_id,kind`)]);
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
  const staffResult = await db.execute(sql`select * from staff where is_active=true and coalesce(salary_status,'active')='active' ${data.department ? sql`and department=${data.department}` : sql``} ${ids.length ? sql`and id in (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})` : sql``} order by id`);
  const staff = rows<any>(staffResult);
  if (!staff.length) throw new Error("لا يوجد موظفون نشطون يطابقون اختيار الرواتب");
  const incomplete = staff.map((s) => ({ staff: s, missing: [num(s.base_salary) <= 0 ? "الراتب الأساسي" : null, !["monthly", "weekly", "daily", "hourly"].includes(String(s.salary_type ?? "monthly")) ? "نوع الراتب" : null, String(s.salary_status ?? "active") !== "active" ? "حالة الراتب النشطة" : null].filter(Boolean) })).filter((entry) => entry.missing.length);
  if (incomplete.length) {
    const error: any = new Error("Salary settings are incomplete for this employee.");
    error.code = "SALARY_SETTINGS_INCOMPLETE";
    error.employees = incomplete.map(({ staff: s, missing }) => ({ id: s.id, name: s.full_name || s.username, missing }));
    throw error;
  }
  const [attendanceResult, eventResult] = await Promise.all([
    db.execute(sql`select staff_id, count(distinct check_in_at::date)::int as attendance_days, count(*) filter(where lower(status)='late')::int as late_arrivals, count(*) filter(where check_out_at is null)::int as missing_check_out, coalesce(sum(extract(epoch from (check_out_at-check_in_at))/3600.0) filter(where check_out_at is not null),0)::float as working_hours from attendance_records where check_in_at >= ${dates.start} and check_in_at < (${dates.end}::date + interval '1 day') group by staff_id`),
    db.execute(sql`select staff_id, kind, coalesce(sum(amount::numeric),0)::float as amount from hr_incentive_events where period=${data.period} and status='pending' group by staff_id,kind`),
  ]);
  const attendance = new Map<number, any>(rows<any>(attendanceResult).map((a) => [Number(a.staff_id), a]));
  const incentives = new Map<number, { bonus: number; penalty: number }>();
  for (const event of rows<any>(eventResult)) { const row = incentives.get(Number(event.staff_id)) ?? { bonus: 0, penalty: 0 }; if (["bonus", "reward"].includes(String(event.kind))) row.bonus += num(event.amount); else if (event.kind === "penalty") row.penalty += num(event.amount); incentives.set(Number(event.staff_id), row); }
  const lines: any[] = [];
  for (const employee of staff) {
    const att = attendance.get(Number(employee.id)); const scheduled = scheduledDays(dates.start, dates.end, num(employee.working_days_per_week)); const attendanceDays = Math.min(scheduled, Number(att?.attendance_days ?? 0)); const absenceDays = Math.max(0, scheduled - attendanceDays); const hours = num(att?.working_hours); const overtimeHours = Math.max(0, hours - attendanceDays * num(employee.daily_working_hours)); const type = String(employee.salary_type ?? "monthly"); const configuredBase = num(employee.base_salary);
    const base = type === "weekly" ? configuredBase * (scheduled / 7) : type === "daily" ? configuredBase * attendanceDays : type === "hourly" ? (num(employee.hourly_rate) || configuredBase) * hours : configuredBase;
    const absenceDeduction = type === "monthly" && scheduled && att ? base / scheduled * absenceDays : 0; const overtimeAmount = overtimeHours * (num(employee.overtime_rate) || num(employee.hourly_rate)); const allowances = num(employee.attendance_allowance) + num(employee.transportation_allowance) + num(employee.food_allowance) + num(employee.phone_allowance) + num(employee.housing_allowance) + num(employee.other_fixed_allowances); const incentive = incentives.get(Number(employee.id)) ?? { bonus: 0, penalty: 0 }; const gross = num(base + allowances + overtimeAmount + incentive.bonus);
    const advance = await getEmployeeAdvanceSummary(Number(employee.id)); const advanceInstallment = advance.history.filter((a: any) => ["approved", "paid"].includes(a.status)).reduce((sum: number, a: any) => sum + Math.min(num(a.monthlyDeduction), num(a.remainingAmount)), 0); const advanceDeduction = Math.min(Math.max(0, gross - absenceDeduction - incentive.penalty - num(employee.fixed_deduction)), advanceInstallment, advance.outstandingBalance); const deductions = absenceDeduction + incentive.penalty + num(employee.fixed_deduction) + advanceDeduction; const net = Math.max(0, gross - deductions);
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
  if (!["draft", "calculated"].includes(run.status)) throw new Error("لا يمكن إعادة حساب دورة رواتب معتمدة أو مدفوعة");
  return buildPayroll({ period: run.period, department: run.department || undefined, employeeIds: run.lines.map((line: any) => Number(line.staff_id)), periodStartDate: run.periodStartDate || undefined, periodEndDate: run.periodEndDate || undefined, paymentDate: run.paymentDate || undefined, notes: run.notes || undefined }, true, actor, id);
}

export async function deleteDraftPayrollRun(id: number) {
  const run = await getPayrollRun(id);
  if (!run) throw new Error("دورة الرواتب غير موجودة");
  if (run.status !== "draft") throw new Error("يمكن حذف دورة الرواتب في حالة مسودة فقط");
  await db.execute(sql`delete from payroll_lines where payroll_run_id=${id}`);
  await db.execute(sql`delete from payroll_runs where id=${id} and status='draft'`);
  return { id };
}

export async function getPayrollRun(id: number) {
  await ensureHrTables();
  const run = rows<any>(await db.execute(sql`select * from payroll_runs where id=${id} limit 1`))[0];
  if (!run) return null;
  const lines = rows<any>(await db.execute(sql`select l.*,s.full_name,s.username,s.department,s.job_title from payroll_lines l join staff s on s.id=l.staff_id where l.payroll_run_id=${id} order by s.full_name`)).map((line) => ({ ...line, employeeName: line.full_name || line.username, department: line.department, jobTitle: line.job_title, salaryType: line.salary_type, paymentMethod: line.payment_method, paymentStatus: line.payment_status, baseSalary: num(line.base_salary), overtimeAmount: num(line.overtime_amount), bonusAmount: num(line.bonus_amount), penaltyAmount: num(line.penalty_amount), advanceDeduction: num(line.advance_deduction), grossSalary: num(line.gross_salary), netSalary: num(line.net_salary), amountPaid: num(line.amount_paid), remainingSalary: Math.max(0, num(line.net_salary) - num(line.amount_paid)), scheduledWorkingDays: Number(line.scheduled_working_days ?? 0), attendanceDays: Number(line.attendance_days ?? 0), absenceDays: Number(line.absence_days ?? 0), totalWorkingHours: num(line.total_working_hours), overtimeHours: num(line.overtime_hours), attendanceAllowance: num(line.attendance_allowance), transportationAllowance: num(line.transportation_allowance), foodAllowance: num(line.food_allowance), phoneAllowance: num(line.phone_allowance), housingAllowance: num(line.housing_allowance), otherFixedAllowances: num(line.other_fixed_allowances), absenceDeduction: num(line.absence_deduction), fixedDeduction: num(line.fixed_deduction), calculationDetails: line.calculation_details ?? {} }));
  return { ...run, periodStartDate: run.period_start_date ? String(run.period_start_date) : null, periodEndDate: run.period_end_date ? String(run.period_end_date) : null, paymentDate: run.payment_date ? String(run.payment_date) : null, attendanceWarning: run.attendance_warning ?? null, totalGross: num(run.total_gross), totalDeductions: num(run.total_deductions), totalNet: num(run.total_net), lines };
}

export async function listPayrollRuns() { await ensureHrTables(); const result = await db.execute(sql`select * from payroll_runs order by period desc limit 36`); return Promise.all(rows<any>(result).map((run) => getPayrollRun(Number(run.id)))); }

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
    const tx = await createFinancialTransaction({ transactionDate: `${run.period}-01`, direction: 'expense', amount: line.netSalary, department: 'hr', transactionType: 'payroll_salary', description: `راتب ${run.period}: ${line.employeeName}`, paymentMethod: 'cash', sourceType: 'payroll_line', sourceId: String(line.id), sourceEvent: 'salary_paid', idempotencyKey: `payroll:${id}:line:${line.id}`, approvalStatus: 'pending', responsibleUserId: line.staff_id, responsibleUserName: line.employeeName, notes: `دورة رواتب ${run.run_no}`, attachments: [] }, actor);
    const executed = await approveAndExecuteFinancialTransaction(tx.id, actor);
    await db.execute(sql`update payroll_lines set financial_transaction_id=${executed.id} where id=${line.id}`);
    if (line.advanceDeduction > 0) await applyPayrollAdvanceDeductions({ employeeId: line.staff_id, payrollReference: run.run_no, amount: line.advanceDeduction }, actor);
  }
  await db.execute(sql`update hr_incentive_events set status='paid' where period=${run.period} and status='pending'`);
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
      const tx = await createFinancialTransaction({ transactionDate: run.paymentDate || `${run.period}-01`, direction: 'expense', amount: line.netSalary, department: 'hr', transactionType: 'payroll_salary', description: `راتب ${run.period}: ${line.employeeName}`, paymentMethod: line.paymentMethod || 'cash', sourceType: 'payroll_line', sourceId: String(line.id), sourceEvent: 'salary_paid', idempotencyKey: `payroll:${id}:line:${line.id}`, approvalStatus: 'pending', responsibleUserId: line.staff_id, responsibleUserName: line.employeeName, notes: `دورة رواتب ${run.run_no}`, attachments: [] }, actor);
      const executed = await approveAndExecuteFinancialTransaction(tx.id, actor);
      await db.execute(sql`update payroll_lines set financial_transaction_id=${executed.id},amount_paid=net_salary,payment_status='paid' where id=${line.id}`);
      if (line.advanceDeduction > 0) await applyPayrollAdvanceDeductions({ employeeId: line.staff_id, payrollReference: run.run_no, amount: line.advanceDeduction }, actor);
    }
    await db.execute(sql`update hr_incentive_events set status='paid' where period=${run.period} and status='pending'`);
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
