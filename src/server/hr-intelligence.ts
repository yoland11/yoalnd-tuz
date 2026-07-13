import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { computeEmployeeScores, type EmployeeScore } from "@/server/employee-performance";
import { applyPayrollAdvanceDeductions, getEmployeeAdvanceSummary } from "@/server/employee-advances";
import { approveAndExecuteFinancialTransaction, createFinancialTransaction, ensureMasterCashBoxTables, type FinancialActor } from "@/server/master-cash-box";

export type HrActor = FinancialActor;
const rows = <T = any>(value: any): T[] => (value?.rows ?? []) as T[];
const num = (value: unknown) => Number.isFinite(Number(value)) ? Math.round((Number(value) + Number.EPSILON) * 100) / 100 : 0;
const periodNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const validPeriod = (period: string) => /^\d{4}-\d{2}$/.test(period);

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
    create table if not exists payroll_lines (id serial primary key, payroll_run_id integer not null references payroll_runs(id) on delete restrict, staff_id integer not null references staff(id) on delete restrict, base_salary numeric(16,2) not null default 0, overtime_amount numeric(16,2) not null default 0, bonus_amount numeric(16,2) not null default 0, penalty_amount numeric(16,2) not null default 0, advance_deduction numeric(16,2) not null default 0, insurance_amount numeric(16,2) not null default 0, gross_salary numeric(16,2) not null default 0, net_salary numeric(16,2) not null default 0, financial_transaction_id integer, signature_name text, signed_at timestamp, created_at timestamp not null default now());
    create index if not exists payroll_lines_run_staff_idx on payroll_lines(payroll_run_id,staff_id);
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

export async function createManualIncentive(input: any, actor: HrActor) {
  await ensureHrTables();
  const staffId = Number(input?.staffId); const amount = num(input?.amount); const kind = ["bonus", "penalty", "reward"].includes(String(input?.kind)) ? String(input.kind) : "bonus";
  if (!Number.isInteger(staffId) || staffId <= 0 || amount < 0) throw new Error("بيانات الحافز غير صالحة");
  const period = String(input?.period || periodNow()); if (!validPeriod(period)) throw new Error("صيغة الشهر غير صحيحة");
  const result = await db.execute(sql`insert into hr_incentive_events(staff_id,period,kind,amount,points,title,reason,status,created_by,created_by_name) values(${staffId},${period},${kind},${amount},${Math.round(num(input?.points))},${String(input?.title || "إجراء إداري")},${String(input?.reason || "") || null},'pending',${actor.id},${actor.name}) returning *`);
  return rows(result)[0];
}

export async function createPayrollRun(period: string, actor: HrActor, notes = "") {
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

export async function getPayrollRun(id: number) {
  await ensureHrTables();
  const run = rows<any>(await db.execute(sql`select * from payroll_runs where id=${id} limit 1`))[0];
  if (!run) return null;
  const lines = rows<any>(await db.execute(sql`select l.*,s.full_name,s.username from payroll_lines l join staff s on s.id=l.staff_id where l.payroll_run_id=${id} order by s.full_name`)).map((line) => ({ ...line, baseSalary: num(line.base_salary), overtimeAmount: num(line.overtime_amount), bonusAmount: num(line.bonus_amount), penaltyAmount: num(line.penalty_amount), advanceDeduction: num(line.advance_deduction), grossSalary: num(line.gross_salary), netSalary: num(line.net_salary), employeeName: line.full_name || line.username }));
  return { ...run, totalGross: num(run.total_gross), totalDeductions: num(run.total_deductions), totalNet: num(run.total_net), lines };
}

export async function listPayrollRuns() { await ensureHrTables(); const result = await db.execute(sql`select * from payroll_runs order by period desc limit 36`); return Promise.all(rows<any>(result).map((run) => getPayrollRun(Number(run.id)))); }

export async function payPayrollRun(id: number, actor: HrActor) {
  if (!['admin', 'manager', 'accountant'].includes(actor.role)) throw new Error("دفع الرواتب يتطلب صلاحية إدارية أو محاسبية");
  const run = await getPayrollRun(id); if (!run) throw new Error("دورة الرواتب غير موجودة"); if (run.status === 'paid') return run; if (run.status !== 'draft') throw new Error("دورة الرواتب غير قابلة للدفع");
  const claimed = rows<any>(await db.execute(sql`update payroll_runs set status='processing',updated_at=now() where id=${id} and status='draft' returning id`))[0];
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
    await db.execute(sql`update payroll_runs set status='draft',updated_at=now() where id=${id} and status='processing'`);
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
