import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { ensureHrTables, type HrActor } from "@/server/hr-intelligence";
import { ensureMasterCashBoxTables, reverseFinancialTransaction } from "@/server/master-cash-box";

const rows = <T = any>(value: any): T[] => (value?.rows ?? []) as T[];
const num = (value: unknown) => Number.isFinite(Number(value)) ? Math.round((Number(value) + Number.EPSILON) * 100) / 100 : 0;
const todayBaghdad = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const PAYMENT_METHODS = ["cash", "main_cash_box", "bank", "transfer"] as const;

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  paymentDate: z.string().date().optional(),
  referenceNo: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(180).optional(),
  attachment: z.string().max(7_000_000).optional().nullable(),
});
const adjustmentSchema = z.object({
  direction: z.enum(["addition", "deduction"]),
  adjustmentType: z.string().trim().min(2).max(60),
  amount: z.coerce.number().positive().max(1_000_000_000),
  reason: z.string().trim().min(3).max(1000),
  notes: z.string().trim().max(2000).optional().nullable(),
  effectiveDate: z.string().date().optional(),
  includeIn: z.enum(["current", "next"]).default("current"),
  attachment: z.string().max(7_000_000).optional().nullable(),
});
const attachmentSchema = z.object({ name: z.string().trim().min(1).max(240), mimeType: z.string().trim().min(1).max(120), dataUrl: z.string().min(20).max(7_000_000), notes: z.string().trim().max(1000).optional().nullable() });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const correctionSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  baseSalary: z.coerce.number().min(0).max(1_000_000_000),
  overtimeAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  bonusAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  manualAddition: z.coerce.number().min(0).max(1_000_000_000).default(0),
  manualDeduction: z.coerce.number().min(0).max(1_000_000_000).default(0),
  advanceDeduction: z.coerce.number().min(0).max(1_000_000_000).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function ensureEmployeeSalaryManagementTables() {
  await ensureHrTables();
  await ensureMasterCashBoxTables();
  await db.execute(sql`
    create table if not exists employee_salary_payments (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      staff_id integer not null references staff(id) on delete restrict,
      amount numeric(16,2) not null,
      payment_date date not null,
      payment_method varchar(30) not null default 'cash',
      reference_no varchar(120),
      financial_transaction_id integer not null references financial_transactions(id) on delete restrict,
      status varchar(20) not null default 'paid',
      origin varchar(30) not null default 'salary_module',
      idempotency_key varchar(180) not null unique,
      notes text,
      attachment text,
      created_by integer references staff(id) on delete set null,
      created_by_name text not null default '',
      reversed_transaction_id integer references financial_transactions(id) on delete restrict,
      reversed_at timestamp,
      reversed_by integer references staff(id) on delete set null,
      reversal_reason text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    );
    create index if not exists employee_salary_payments_line_idx on employee_salary_payments(payroll_line_id,created_at);
    create unique index if not exists employee_salary_payments_financial_uq on employee_salary_payments(financial_transaction_id);
    create table if not exists employee_salary_adjustments (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      staff_id integer not null references staff(id) on delete restrict,
      direction varchar(20) not null,
      adjustment_type varchar(60) not null,
      amount numeric(16,2) not null,
      reason text not null,
      notes text,
      attachment text,
      effective_date date not null,
      include_in varchar(20) not null default 'current',
      status varchar(20) not null default 'applied',
      old_values jsonb not null default '{}'::jsonb,
      new_values jsonb not null default '{}'::jsonb,
      created_by integer references staff(id) on delete set null,
      created_by_name text not null default '',
      created_at timestamp not null default now()
    );
    create index if not exists employee_salary_adjustments_line_idx on employee_salary_adjustments(payroll_line_id,created_at);
    create table if not exists employee_salary_attachments (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      name varchar(240) not null,
      mime_type varchar(120) not null,
      data_url text not null,
      notes text,
      uploaded_by integer references staff(id) on delete set null,
      uploaded_by_name text not null default '',
      created_at timestamp not null default now()
    );
    create index if not exists employee_salary_attachments_line_idx on employee_salary_attachments(payroll_line_id,created_at);
    create table if not exists employee_salary_events (
      id serial primary key,
      payroll_run_id integer not null references payroll_runs(id) on delete restrict,
      payroll_line_id integer not null references payroll_lines(id) on delete restrict,
      staff_id integer not null references staff(id) on delete restrict,
      action varchar(60) not null,
      reason text,
      old_values jsonb not null default '{}'::jsonb,
      new_values jsonb not null default '{}'::jsonb,
      actor_id integer references staff(id) on delete set null,
      actor_name text not null default '',
      ip_address varchar(80),
      device text,
      financial_transaction_id integer references financial_transactions(id) on delete restrict,
      created_at timestamp not null default now()
    );
    create index if not exists employee_salary_events_line_idx on employee_salary_events(payroll_line_id,created_at);
  `);
}

async function salaryContext(runId: number, lineId: number, lock = false, tx: any = db) {
  const suffix = lock ? sql` for update` : sql``;
  return rows<any>(await tx.execute(sql`select l.*,r.run_no,r.period,r.status as run_status,r.payment_date,s.full_name,s.username,s.department from payroll_lines l join payroll_runs r on r.id=l.payroll_run_id join staff s on s.id=l.staff_id where r.id=${runId} and l.id=${lineId} and r.deleted_at is null${suffix}`))[0] ?? null;
}

async function addEvent(tx: any, line: any, actor: HrActor, action: string, reason: string | null, oldValues: any, newValues: any, financialTransactionId?: number | null) {
  await tx.execute(sql`insert into employee_salary_events(payroll_run_id,payroll_line_id,staff_id,action,reason,old_values,new_values,actor_id,actor_name,financial_transaction_id) values(${line.payroll_run_id},${line.id},${line.staff_id},${action},${reason},${JSON.stringify(oldValues ?? {})}::jsonb,${JSON.stringify(newValues ?? {})}::jsonb,${actor.id},${actor.name},${financialTransactionId || null})`);
}

async function refreshRunStatus(tx: any, runId: number) {
  const summary = rows<any>(await tx.execute(sql`select count(*)::int as total,count(*) filter(where amount_paid>=net_salary and net_salary>0)::int as paid,count(*) filter(where amount_paid>0 and amount_paid<net_salary)::int as partial,coalesce(sum(amount_paid),0)::float as amount_paid,coalesce(sum(net_salary),0)::float as total_net from payroll_lines where payroll_run_id=${runId}`))[0];
  const status = Number(summary.total) > 0 && Number(summary.paid) === Number(summary.total) ? "paid" : Number(summary.amount_paid) > 0 ? "partially_paid" : "approved";
  await tx.execute(sql`update payroll_runs set status=${status},paid_at=case when ${status}='paid' then coalesce(paid_at,now()) else null end,updated_at=now() where id=${runId}`);
  return status;
}

function salaryNumbers(line: any) {
  const allowances = num(line.attendance_allowance) + num(line.transportation_allowance) + num(line.food_allowance) + num(line.phone_allowance) + num(line.housing_allowance) + num(line.other_fixed_allowances);
  const additions = num(line.overtime_amount) + num(line.bonus_amount) + num(line.commission_amount) + num(line.manual_earnings);
  const deductions = num(line.penalty_amount) + num(line.advance_deduction) + num(line.insurance_amount) + num(line.attendance_deduction) + num(line.absence_deduction) + num(line.late_deduction) + num(line.early_leave_deduction) + num(line.unpaid_leave_deduction) + num(line.fixed_deduction) + num(line.manual_deduction) + num(line.other_deductions);
  const gross = num(num(line.base_salary) + allowances + additions);
  return { allowances, additions, deductions, gross, net: Math.max(0, num(gross - deductions)) };
}

async function applyAdvanceInsideTransaction(tx: any, line: any, payrollReference: string, actor: HrActor) {
  let budget = num(line.advance_deduction);
  if (budget <= 0) return 0;
  const existing = rows<any>(await tx.execute(sql`select id from employee_advance_repayments where employee_id=${line.staff_id} and payroll_reference=${payrollReference} and kind='payroll' limit 1`));
  if (existing.length) return 0;
  const advances = rows<any>(await tx.execute(sql`select * from employee_advances where employee_id=${line.staff_id} and status in ('paid','approved') and remaining_amount>0 order by request_date,id for update`));
  let applied = 0;
  for (const advance of advances) {
    if (budget <= 0) break;
    const deduction = Math.min(num(advance.monthly_deduction) || num(advance.remaining_amount), num(advance.remaining_amount), budget);
    if (deduction <= 0) continue;
    const nextRemaining = num(advance.remaining_amount) - deduction;
    const nextRepaid = num(advance.repaid_amount) + deduction;
    await tx.execute(sql`insert into employee_advance_repayments(advance_id,employee_id,payment_date,amount,method,kind,notes,payroll_reference,received_by,received_by_name) values(${advance.id},${line.staff_id},${todayBaghdad()},${deduction},'payroll','payroll',${`خصم من راتب ${payrollReference}`},${payrollReference},${actor.id},${actor.name})`);
    await tx.execute(sql`update employee_advances set repaid_amount=${nextRepaid},remaining_amount=${nextRemaining},status=case when ${nextRemaining}=0 then 'completed' else 'paid' end,last_deduction_at=now(),payroll_reference=${payrollReference},updated_at=now() where id=${advance.id}`);
    budget = num(budget - deduction); applied = num(applied + deduction);
  }
  return applied;
}

async function restoreAdvanceInsideTransaction(tx: any, payrollReference: string, actor: HrActor, reason: string) {
  const repayments = rows<any>(await tx.execute(sql`select * from employee_advance_repayments where payroll_reference=${payrollReference} and kind='payroll' for update`));
  let restored = 0;
  for (const repayment of repayments) {
    const advance = rows<any>(await tx.execute(sql`select * from employee_advances where id=${Number(repayment.advance_id)} for update`))[0];
    if (!advance) throw new Error("تعذر العثور على السلفة المرتبطة بخصم الراتب");
    const amount = num(repayment.amount);
    const nextRepaid = Math.max(0, num(advance.repaid_amount) - amount);
    const nextRemaining = Math.min(num(advance.amount), num(advance.remaining_amount) + amount);
    await tx.execute(sql`update employee_advances set repaid_amount=${nextRepaid},remaining_amount=${nextRemaining},status=case when ${nextRemaining}>0 then 'paid' else 'completed' end,last_deduction_at=null,updated_at=now() where id=${Number(advance.id)}`);
    await tx.execute(sql`update employee_advance_repayments set kind='reversed_payroll',notes=concat_ws(E'\n',notes,${`عكس خصم الراتب بواسطة ${actor.name}: ${reason}`}) where id=${Number(repayment.id)} and kind='payroll'`);
    restored = num(restored + amount);
  }
  return restored;
}

function financialNo(id: number, date = new Date()) {
  return `FIN-${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}-${String(id).padStart(6, "0")}`;
}

export async function payEmployeeSalary(runId: number, lineId: number, input: unknown, actor: HrActor) {
  if (!["admin", "manager", "accountant"].includes(actor.role)) throw new Error("لا تملك صلاحية صرف راتب الموظف");
  await ensureEmployeeSalaryManagementTables();
  const data = paymentSchema.parse(input);
  const idempotency = data.idempotencyKey || `salary:${lineId}:payment:${randomUUID()}`;
  return db.transaction(async (tx) => {
    const line = await salaryContext(runId, lineId, true, tx);
    if (!line) throw new Error("سجل الراتب غير موجود");
    const previous = rows<any>(await tx.execute(sql`select * from employee_salary_payments where idempotency_key=${idempotency} limit 1`))[0];
    if (previous) return { payment: previous, duplicate: true };
    if (!["approved", "partially_paid"].includes(String(line.run_status))) throw new Error("يجب اعتماد دورة الرواتب قبل الدفع");
    const oldPaid = num(line.amount_paid), remaining = Math.max(0, num(line.net_salary) - oldPaid);
    if (remaining <= 0) throw new Error("تم صرف هذا الراتب مسبقًا");
    if (data.amount > remaining) throw new Error("مبلغ الدفع أكبر من المتبقي على الراتب");
    const cash = rows<any>(await tx.execute(sql`select * from master_cash_box where code='MASTER' for update`))[0];
    if (!cash) throw new Error("الصندوق الرئيسي غير مهيأ");
    const before = num(cash.current_balance);
    if (before < data.amount) throw new Error("رصيد الصندوق غير كافٍ");
    const after = num(before - data.amount);
    const now = new Date();
    const txRow = rows<any>(await tx.execute(sql`insert into financial_transactions(transaction_no,transaction_date,direction,amount,department,transaction_type,reference_no,description,payment_method,source_type,source_id,source_event,idempotency_key,approval_status,requested_by,requested_by_name,submitted_at,approved_by,approved_by_name,approved_at,executed_by,executed_by_name,executed_at,balance_before,balance_after,responsible_user_id,responsible_user_name,notes,attachments) values(${`FIN-TMP-${randomUUID()}`},${data.paymentDate || todayBaghdad()},'expense',${data.amount},'hr','payroll_settlement',${data.referenceNo || null},${`دفعة راتب ${line.period}: ${line.full_name || line.username}`},${data.paymentMethod},'payroll_line',${String(lineId)},'salary_partial_payment',${idempotency},'executed',${actor.id},${actor.name},${now},${actor.id},${actor.name},${now},${actor.id},${actor.name},${now},${before},${after},${line.staff_id},${line.full_name || line.username},${data.notes || null},${JSON.stringify(data.attachment ? [data.attachment] : [])}::jsonb) returning *`))[0];
    const transactionNo = financialNo(Number(txRow.id), now);
    await tx.execute(sql`update financial_transactions set transaction_no=${transactionNo} where id=${txRow.id}`);
    const accounts = rows<any>(await tx.execute(sql`select id,code from financial_accounts where code in ('1000','2100','5070','5071','5072','1300','2200')`));
    const account = new Map(accounts.map((entry) => [String(entry.code), Number(entry.id)]));
    if (["1000", "2100", "5070", "5071", "5072", "1300", "2200"].some((code) => !account.has(code))) throw new Error("دليل حسابات الرواتب غير مكتمل");
    await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("2100")!},'debit',${data.amount},'تسديد مستحق راتب'),(${txRow.id},${account.get("1000")!},'credit',${data.amount},'صرف راتب من الصندوق')`);
    const hasAccrual = rows<any>(await tx.execute(sql`select 1 from employee_salary_payments where payroll_line_id=${lineId} and status='paid' limit 1`)).length > 0;
    if (!hasAccrual) {
      const numbers = salaryNumbers(line); const otherDeductions = Math.max(0, num(numbers.deductions - num(line.advance_deduction)));
      const baseOvertime = num(line.base_salary) + num(line.overtime_amount);
      const bonuses = num(line.bonus_amount) + num(line.commission_amount) + num(line.manual_earnings);
      if (baseOvertime > 0) await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("5070")!},'debit',${baseOvertime},'إثبات مصروف الراتب والعمل الإضافي')`);
      if (bonuses > 0) await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("5071")!},'debit',${bonuses},'إثبات المكافآت والإضافات')`);
      if (numbers.allowances > 0) await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("5072")!},'debit',${numbers.allowances},'إثبات بدلات الراتب')`);
      if (num(line.net_salary) > 0) await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("2100")!},'credit',${line.net_salary},'إثبات صافي مستحق الراتب')`);
      if (num(line.advance_deduction) > 0) await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("1300")!},'credit',${line.advance_deduction},'تسوية سلفة الموظف')`);
      if (otherDeductions > 0) await tx.execute(sql`insert into financial_ledger_entries(transaction_id,account_id,entry_side,amount,description) values(${txRow.id},${account.get("2200")!},'credit',${otherDeductions},'استقطاعات الراتب')`);
    }
    await tx.execute(sql`update master_cash_box set current_balance=${after},available_balance=${after},total_expenses=total_expenses+${data.amount},net_profit=total_revenue-(total_expenses+${data.amount}),version=version+1,updated_by=${actor.id},updated_by_name=${actor.name},updated_at=now() where id=${cash.id}`);
    const payment = rows<any>(await tx.execute(sql`insert into employee_salary_payments(payroll_run_id,payroll_line_id,staff_id,amount,payment_date,payment_method,reference_no,financial_transaction_id,status,origin,idempotency_key,notes,attachment,created_by,created_by_name) values(${runId},${lineId},${line.staff_id},${data.amount},${data.paymentDate || todayBaghdad()},${data.paymentMethod},${data.referenceNo || null},${txRow.id},'paid','salary_module',${idempotency},${data.notes || null},${data.attachment || null},${actor.id},${actor.name}) returning *`))[0];
    const nextPaid = num(oldPaid + data.amount), paymentStatus = nextPaid >= num(line.net_salary) ? "paid" : "partially_paid";
    await tx.execute(sql`update payroll_lines set amount_paid=${nextPaid},payment_status=${paymentStatus},financial_transaction_id=coalesce(financial_transaction_id,${txRow.id}) where id=${lineId}`);
    if (paymentStatus === "paid") await applyAdvanceInsideTransaction(tx, line, `${line.run_no}:line:${lineId}`, actor);
    const runStatus = await refreshRunStatus(tx, runId);
    await addEvent(tx, line, actor, "salary_paid", data.notes || null, { amountPaid: oldPaid }, { amountPaid: nextPaid, paymentStatus, runStatus }, Number(txRow.id));
    return { payment: { ...payment, transaction_no: transactionNo }, amountPaid: nextPaid, remaining: Math.max(0, num(line.net_salary) - nextPaid), paymentStatus, runStatus };
  });
}

export async function addEmployeeSalaryAdjustment(runId: number, lineId: number, input: unknown, actor: HrActor) {
  await ensureEmployeeSalaryManagementTables(); const data = adjustmentSchema.parse(input);
  return db.transaction(async (tx) => {
    const line = await salaryContext(runId, lineId, true, tx); if (!line) throw new Error("سجل الراتب غير موجود");
    if (num(line.amount_paid) > 0 && data.includeIn === "current") throw new Error("لا يمكن تعديل راتب مصروف مباشرة؛ استخدم تصحيح الراتب أو أضف التعديل للشهر التالي");
    if (data.includeIn === "current" && !["draft", "calculated", "under_review", "pending_manager_approval", "rejected", "approved"].includes(String(line.run_status))) throw new Error("حالة الراتب لا تسمح بالتعديل");
    if (data.includeIn === "next" && ["cancelled", "reversed"].includes(String(line.run_status))) throw new Error("لا يمكن جدولة تعديل من راتب ملغي أو معكوس");
    const before = salaryNumbers(line); const status = data.includeIn === "next" ? "scheduled" : "applied";
    if (data.includeIn === "current") {
      if (data.direction === "addition") line.manual_earnings = num(line.manual_earnings) + data.amount;
      else line.manual_deduction = num(line.manual_deduction) + data.amount;
      const after = salaryNumbers(line);
      await tx.execute(sql`update payroll_lines set manual_earnings=${line.manual_earnings},manual_deduction=${line.manual_deduction},gross_salary=${after.gross},net_salary=${after.net},payment_status='unpaid',line_notes=concat_ws(E'\n',line_notes,${`${data.direction === "addition" ? "إضافة" : "خصم"}: ${data.reason} (${data.amount})`}) where id=${lineId}`);
      await tx.execute(sql`update payroll_runs set total_gross=(select coalesce(sum(gross_salary),0) from payroll_lines where payroll_run_id=${runId}),total_deductions=(select coalesce(sum(gross_salary-net_salary),0) from payroll_lines where payroll_run_id=${runId}),total_net=(select coalesce(sum(net_salary),0) from payroll_lines where payroll_run_id=${runId}),updated_at=now() where id=${runId}`);
      await addEvent(tx, line, actor, data.direction === "addition" ? "salary_amount_added" : "salary_amount_reduced", data.reason, before, after);
    }
    const afterValues = data.includeIn === "current" ? salaryNumbers(line) : before;
    const adjustment = rows<any>(await tx.execute(sql`insert into employee_salary_adjustments(payroll_run_id,payroll_line_id,staff_id,direction,adjustment_type,amount,reason,notes,attachment,effective_date,include_in,status,old_values,new_values,created_by,created_by_name) values(${runId},${lineId},${line.staff_id},${data.direction},${data.adjustmentType},${data.amount},${data.reason},${data.notes || null},${data.attachment || null},${data.effectiveDate || todayBaghdad()},${data.includeIn},${status},${JSON.stringify(before)}::jsonb,${JSON.stringify(afterValues)}::jsonb,${actor.id},${actor.name}) returning *`))[0];
    if (data.includeIn === "next") await addEvent(tx, line, actor, data.direction === "addition" ? "salary_addition_scheduled" : "salary_deduction_scheduled", data.reason, before, { ...before, scheduledAdjustmentId: adjustment.id, amount: data.amount });
    return { adjustment, before, after: afterValues };
  });
}

export async function addEmployeeSalaryAttachment(runId: number, lineId: number, input: unknown, actor: HrActor) {
  await ensureEmployeeSalaryManagementTables(); const data = attachmentSchema.parse(input);
  return db.transaction(async (tx) => {
    const line = await salaryContext(runId, lineId, true, tx); if (!line) throw new Error("سجل الراتب غير موجود");
    const saved = rows<any>(await tx.execute(sql`insert into employee_salary_attachments(payroll_run_id,payroll_line_id,name,mime_type,data_url,notes,uploaded_by,uploaded_by_name) values(${runId},${lineId},${data.name},${data.mimeType},${data.dataUrl},${data.notes || null},${actor.id},${actor.name}) returning *`))[0];
    await addEvent(tx, line, actor, "salary_attachment_added", data.notes || null, {}, { attachmentId: saved.id, name: data.name });
    return saved;
  });
}

export async function getEmployeeSalaryManagementDetail(runId: number, lineId: number) {
  await ensureEmployeeSalaryManagementTables(); const line = await salaryContext(runId, lineId); if (!line) return null;
  const [payments, adjustments, attachments, events, suggestions] = await Promise.all([
    db.execute(sql`select p.*,ft.transaction_no,ft.balance_before,ft.balance_after,ft.reversal_txn_id from employee_salary_payments p join financial_transactions ft on ft.id=p.financial_transaction_id where p.payroll_line_id=${lineId} order by p.payment_date desc,p.id desc`),
    db.execute(sql`select * from employee_salary_adjustments where payroll_line_id=${lineId} order by created_at desc,id desc`),
    db.execute(sql`select id,name,mime_type,data_url,notes,uploaded_by_name,created_at from employee_salary_attachments where payroll_line_id=${lineId} order by created_at desc,id desc`),
    db.execute(sql`select * from employee_salary_events where payroll_line_id=${lineId} order by created_at desc,id desc limit 200`),
    db.execute(sql`select ft.id,ft.transaction_no,ft.transaction_date,ft.amount::float as amount,ft.payment_method,ft.description,ft.responsible_user_id,case when ft.responsible_user_id=${line.staff_id} then 60 else 0 end + case when abs(ft.amount::numeric-${line.net_salary}::numeric)<0.01 then 30 else 0 end + case when to_char(ft.transaction_date,'YYYY-MM')=${line.period} then 10 else 0 end as match_score from financial_transactions ft where ft.direction='expense' and ft.approval_status='executed' and ft.reversed_at is null and abs(ft.amount::numeric-${line.net_salary}::numeric)<0.01 and ft.transaction_date between (${line.period}||'-01')::date-interval '45 days' and ((${line.period}||'-01')::date+interval '2 months') and not exists(select 1 from employee_salary_payments sp where sp.financial_transaction_id=ft.id) order by match_score desc,ft.transaction_date desc limit 12`),
  ]);
  return { line, payments: rows(payments), adjustments: rows(adjustments), attachments: rows(attachments), events: rows(events), suggestions: rows(suggestions) };
}

export async function linkHistoricalSalaryPayment(runId: number, lineId: number, input: unknown, actor: HrActor) {
  if (!["admin", "manager", "accountant"].includes(actor.role)) throw new Error("ربط الرواتب القديمة يتطلب صلاحية المدير");
  await ensureEmployeeSalaryManagementTables();
  const data = z.object({ financialTransactionId: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(1000) }).parse(input);
  return db.transaction(async (tx) => {
    const line = await salaryContext(runId, lineId, true, tx); if (!line) throw new Error("سجل الراتب غير موجود");
    const financial = rows<any>(await tx.execute(sql`select * from financial_transactions where id=${data.financialTransactionId} for update`))[0];
    if (!financial || financial.direction !== "expense" || financial.approval_status !== "executed" || financial.reversed_at) throw new Error("الحركة المالية المقترحة غير صالحة للربط");
    if (Math.abs(num(financial.amount) - num(line.net_salary)) > 0.01) throw new Error("مبلغ الحركة لا يطابق صافي الراتب");
    const used = rows<any>(await tx.execute(sql`select id from employee_salary_payments where financial_transaction_id=${financial.id} limit 1`)); if (used.length) throw new Error("الحركة المالية مرتبطة براتب آخر");
    const payment = rows<any>(await tx.execute(sql`insert into employee_salary_payments(payroll_run_id,payroll_line_id,staff_id,amount,payment_date,payment_method,reference_no,financial_transaction_id,status,origin,idempotency_key,notes,created_by,created_by_name) values(${runId},${lineId},${line.staff_id},${financial.amount},${financial.transaction_date},${financial.payment_method},${financial.reference_no || null},${financial.id},'paid','legacy_reconciliation',${`legacy-salary:${lineId}:financial:${financial.id}`},${data.reason},${actor.id},${actor.name}) returning *`))[0];
    await tx.execute(sql`update payroll_lines set financial_transaction_id=${financial.id},amount_paid=least(net_salary,${financial.amount}),payment_status=case when ${financial.amount}>=net_salary then 'paid' else 'partially_paid' end where id=${lineId}`);
    const runStatus = await refreshRunStatus(tx, runId);
    await addEvent(tx, line, actor, "historical_salary_linked", data.reason, { financialTransactionId: line.financial_transaction_id }, { financialTransactionId: financial.id, runStatus }, Number(financial.id));
    return { payment, runStatus };
  });
}

export async function reverseEmployeeSalaryPayment(runId: number, lineId: number, paymentId: number, input: unknown, actor: HrActor, existingTransaction?: any) {
  if (!existingTransaction) await ensureEmployeeSalaryManagementTables(); const data = reasonSchema.parse(input);
  const executor = existingTransaction || db;
  const payment = rows<any>(await executor.execute(sql`select * from employee_salary_payments where id=${paymentId} and payroll_run_id=${runId} and payroll_line_id=${lineId} limit 1`))[0];
  if (!payment) throw new Error("دفعة الراتب غير موجودة"); if (payment.status === "reversed") return payment;
  let salaryResult: any = null;
  const reversed = await reverseFinancialTransaction(Number(payment.financial_transaction_id), actor, data.reason, async (tx, financialResult) => {
    const line = await salaryContext(runId, lineId, true, tx); if (!line) throw new Error("سجل الراتب غير موجود");
    const nextPaid = Math.max(0, num(line.amount_paid) - num(payment.amount)); const status = nextPaid <= 0 ? "unpaid" : nextPaid < num(line.net_salary) ? "partially_paid" : "paid";
    await tx.execute(sql`update employee_salary_payments set status='reversed',reversed_transaction_id=${financialResult.reverse.id},reversed_at=now(),reversed_by=${actor.id},reversal_reason=${data.reason},updated_at=now() where id=${paymentId} and status='paid'`);
    await tx.execute(sql`update payroll_lines set amount_paid=${nextPaid},payment_status=${status},financial_transaction_id=(select financial_transaction_id from employee_salary_payments where payroll_line_id=${lineId} and status='paid' order by id limit 1) where id=${lineId}`);
    const restoredAdvance = status !== "paid" ? await restoreAdvanceInsideTransaction(tx, `${line.run_no}:line:${lineId}`, actor, data.reason) : 0;
    const runStatus = await refreshRunStatus(tx, runId);
    await addEvent(tx, line, actor, "salary_payment_reversed", data.reason, { amountPaid: line.amount_paid }, { amountPaid: nextPaid, paymentStatus: status, runStatus, restoredAdvance }, Number(financialResult.reverse.id));
    salaryResult = { paymentId, reversedTransactionId: financialResult.reverse.id, amountPaid: nextPaid, paymentStatus: status, runStatus, restoredAdvance };
  }, existingTransaction);
  return salaryResult || { paymentId, reversedTransactionId: reversed.reverse.id };
}

export async function correctPaidEmployeeSalary(runId: number, lineId: number, input: unknown, actor: HrActor) {
  if (!["admin", "manager"].includes(actor.role)) throw new Error("تصحيح راتب مصروف يتطلب صلاحية المدير");
  await ensureEmployeeSalaryManagementTables(); const data = correctionSchema.parse(input);
  return db.transaction(async (tx) => {
    const initialLine = await salaryContext(runId, lineId, true, tx); if (!initialLine) throw new Error("سجل الراتب غير موجود");
    const activePayments = rows<any>(await tx.execute(sql`select * from employee_salary_payments where payroll_run_id=${runId} and payroll_line_id=${lineId} and status='paid' order by id for update`));
    if (!activePayments.length && num(initialLine.amount_paid) > 0) throw new Error("راتب قديم غير مربوط ماليًا؛ أصلح الرابط المالي أولاً");
    for (const payment of activePayments) await reverseEmployeeSalaryPayment(runId, lineId, Number(payment.id), { reason: data.reason }, actor, tx);
    const line = await salaryContext(runId, lineId, true, tx); if (!line) throw new Error("سجل الراتب غير موجود"); const before = { ...initialLine };
    line.base_salary = data.baseSalary; line.overtime_amount = data.overtimeAmount; line.bonus_amount = data.bonusAmount; line.manual_earnings = data.manualAddition; line.manual_deduction = data.manualDeduction; line.advance_deduction = data.advanceDeduction;
    const numbers = salaryNumbers(line);
    await tx.execute(sql`update payroll_lines set base_salary=${data.baseSalary},overtime_amount=${data.overtimeAmount},bonus_amount=${data.bonusAmount},manual_earnings=${data.manualAddition},manual_deduction=${data.manualDeduction},advance_deduction=${data.advanceDeduction},gross_salary=${numbers.gross},net_salary=${numbers.net},amount_paid=0,payment_status='unpaid',line_notes=${data.notes || line.line_notes},financial_transaction_id=null,calculation_details=jsonb_set(coalesce(calculation_details,'{}'::jsonb),'{paidCorrection}',${JSON.stringify({ reason: data.reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() })}::jsonb,true) where id=${lineId}`);
    await tx.execute(sql`update payroll_runs set status='approved',total_gross=(select coalesce(sum(gross_salary),0) from payroll_lines where payroll_run_id=${runId}),total_deductions=(select coalesce(sum(gross_salary-net_salary),0) from payroll_lines where payroll_run_id=${runId}),total_net=(select coalesce(sum(net_salary),0) from payroll_lines where payroll_run_id=${runId}),paid_at=null,updated_at=now() where id=${runId}`);
    await addEvent(tx, line, actor, "paid_salary_corrected", data.reason, before, { ...numbers, amountPaid: 0, paymentStatus: "unpaid" });
    return { before, after: numbers, status: "approved" };
  });
}
