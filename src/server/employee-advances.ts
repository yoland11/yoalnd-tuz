import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  employeeAdvanceRepaymentsTable,
  employeeAdvancesTable,
  employeeAdvanceSettingsTable,
  staffTable,
} from "@workspace/db";
import {
  approveAndExecuteFinancialTransaction,
  createFinancialTransaction,
  ensureMasterCashBoxTables,
  type FinancialActor,
} from "@/server/master-cash-box";

export type AdvanceActor = FinancialActor;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["pending", "approved", "rejected", "cancelled", "paid", "completed"] as const;
const TYPES = ["salary_advance", "cash_withdrawal", "emergency_loan"] as const;
const METHODS = ["cash", "bank", "transfer", "main_cashbox", "payroll"] as const;

const amount = z.coerce.number().positive().max(999_999_999_999);
const optionalDate = z.string().regex(DATE).optional().nullable();

export const createAdvanceSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  requestDate: z.string().regex(DATE).optional(),
  advanceType: z.enum(TYPES).default("salary_advance"),
  amount,
  monthlyDeduction: z.coerce.number().min(0).default(0),
  reason: z.string().trim().min(3).max(2000),
  notes: z.string().trim().max(4000).optional().default(""),
  attachmentUrl: z.string().trim().max(2000).optional().nullable(),
  dueDate: optionalDate,
});

export const updateAdvanceSchema = createAdvanceSchema
  .omit({ employeeId: true })
  .partial()
  .extend({ status: z.enum(STATUSES).optional() });

export const repaymentSchema = z.object({
  amount,
  paymentDate: z.string().regex(DATE).optional(),
  method: z.enum(METHODS).default("cash"),
  notes: z.string().trim().max(4000).optional().default(""),
  payrollReference: z.string().trim().max(80).optional().nullable(),
});

export const settingsSchema = z.object({
  maxAdvanceAmount: z.coerce.number().min(0).default(0),
  maxSalaryPercentage: z.coerce.number().min(0).max(100).default(100),
  maxActiveAdvances: z.coerce.number().int().min(1).max(20).default(1),
  minimumEmploymentDays: z.coerce.number().int().min(0).max(36500).default(0),
  managerApprovalAmount: z.coerce.number().min(0).default(0),
});

export const advanceFilterSchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  department: z.string().trim().max(60).optional(),
  status: z.enum(STATUSES).optional(),
  from: optionalDate,
  to: optionalDate,
  q: z.string().trim().max(100).optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  outstandingOnly: z.enum(["true", "false"]).optional(),
});

function dateInBaghdad() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function toPlain<T extends Record<string, any>>(row: T) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  ) as T;
}

function advanceNumber(id: number) {
  const date = dateInBaghdad().replaceAll("-", "");
  return `ADV-${date}-${String(id).padStart(5, "0")}`;
}

function canManage(actor: AdvanceActor) {
  return actor.role === "admin" || actor.role === "manager" || actor.role === "accountant";
}

export async function ensureEmployeeAdvanceTables() {
  await ensureMasterCashBoxTables();
  await db.execute(sql`
    ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "department" varchar(60) NOT NULL DEFAULT 'general';
    ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "base_salary" numeric(16,2) NOT NULL DEFAULT 0;
    ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "hired_at" date NOT NULL DEFAULT CURRENT_DATE;
    CREATE TABLE IF NOT EXISTS "employee_advances" (
      "id" serial PRIMARY KEY, "advance_no" varchar(40) NOT NULL UNIQUE,
      "employee_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
      "request_date" date NOT NULL, "advance_type" varchar(30) NOT NULL DEFAULT 'salary_advance',
      "amount" numeric(16,2) NOT NULL, "repaid_amount" numeric(16,2) NOT NULL DEFAULT 0,
      "remaining_amount" numeric(16,2) NOT NULL DEFAULT 0, "monthly_deduction" numeric(16,2) NOT NULL DEFAULT 0,
      "reason" text NOT NULL DEFAULT '', "notes" text, "attachment_url" text,
      "status" varchar(20) NOT NULL DEFAULT 'pending',
      "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "requested_by_name" text NOT NULL DEFAULT '',
      "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "approved_by_name" text NOT NULL DEFAULT '', "approved_at" timestamp,
      "rejected_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "rejected_by_name" text NOT NULL DEFAULT '', "rejected_at" timestamp, "rejection_reason" text,
      "paid_at" timestamp, "due_date" date, "last_deduction_at" timestamp, "financial_transaction_id" integer,
      "payroll_reference" varchar(80), "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "employee_advances_employee_idx" ON "employee_advances" ("employee_id", "created_at");
    CREATE INDEX IF NOT EXISTS "employee_advances_status_idx" ON "employee_advances" ("status", "request_date");
    CREATE TABLE IF NOT EXISTS "employee_advance_repayments" (
      "id" serial PRIMARY KEY, "advance_id" integer NOT NULL REFERENCES "employee_advances"("id") ON DELETE RESTRICT,
      "employee_id" integer NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT, "payment_date" date NOT NULL,
      "amount" numeric(16,2) NOT NULL, "method" varchar(20) NOT NULL DEFAULT 'cash', "kind" varchar(20) NOT NULL DEFAULT 'manual',
      "notes" text, "payroll_reference" varchar(80), "financial_transaction_id" integer,
      "received_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "received_by_name" text NOT NULL DEFAULT '',
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "employee_advance_repayments_advance_idx" ON "employee_advance_repayments" ("advance_id", "payment_date");
    CREATE TABLE IF NOT EXISTS "employee_advance_settings" (
      "id" serial PRIMARY KEY, "max_advance_amount" numeric(16,2) NOT NULL DEFAULT 0,
      "max_salary_percentage" numeric(5,2) NOT NULL DEFAULT 100, "max_active_advances" integer NOT NULL DEFAULT 1,
      "minimum_employment_days" integer NOT NULL DEFAULT 0, "manager_approval_amount" numeric(16,2) NOT NULL DEFAULT 0,
      "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL, "updated_at" timestamp NOT NULL DEFAULT now()
    );
    INSERT INTO "employee_advance_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
  `);
}

export async function getAdvanceSettings() {
  await ensureEmployeeAdvanceTables();
  const row = await db.query.employeeAdvanceSettingsTable.findFirst({
    where: eq(employeeAdvanceSettingsTable.id, 1),
  });
  return row ?? { id: 1, maxAdvanceAmount: "0", maxSalaryPercentage: "100", maxActiveAdvances: 1, minimumEmploymentDays: 0, managerApprovalAmount: "0" };
}

export async function saveAdvanceSettings(input: unknown, actor: AdvanceActor) {
  const data = settingsSchema.parse(input);
  await ensureEmployeeAdvanceTables();
  const values = {
    maxAdvanceAmount: String(data.maxAdvanceAmount),
    maxSalaryPercentage: String(data.maxSalaryPercentage),
    maxActiveAdvances: data.maxActiveAdvances,
    minimumEmploymentDays: data.minimumEmploymentDays,
    managerApprovalAmount: String(data.managerApprovalAmount),
    updatedBy: actor.id,
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(employeeAdvanceSettingsTable)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: employeeAdvanceSettingsTable.id, set: values })
    .returning();
  return saved;
}

async function enforceLimits(employeeId: number, requestedAmount: number) {
  const [employee, settings, active] = await Promise.all([
    db.query.staffTable.findFirst({ where: eq(staffTable.id, employeeId) }),
    getAdvanceSettings(),
    db.query.employeeAdvancesTable.findMany({
      where: and(eq(employeeAdvancesTable.employeeId, employeeId), sql`${employeeAdvancesTable.status} IN ('approved', 'paid')`),
    }),
  ]);
  if (!employee || !employee.isActive) throw new Error("الموظف غير موجود أو غير فعّال");
  if (active.length >= Number(settings.maxActiveAdvances)) throw new Error("تم بلوغ الحد الأقصى للسلف النشطة لهذا الموظف");
  if (asNumber(settings.maxAdvanceAmount) > 0 && requestedAmount > asNumber(settings.maxAdvanceAmount)) throw new Error("المبلغ يتجاوز الحد الأقصى المسموح للسلفة");
  const salary = asNumber(employee.baseSalary);
  const percentage = asNumber(settings.maxSalaryPercentage);
  if (salary > 0 && percentage > 0 && requestedAmount > salary * percentage / 100) throw new Error("المبلغ يتجاوز النسبة المسموح بها من الراتب");
  const hired = employee.hiredAt ? new Date(String(employee.hiredAt)) : null;
  const days = hired ? Math.floor((Date.now() - hired.getTime()) / 86_400_000) : 0;
  if (days < Number(settings.minimumEmploymentDays)) throw new Error("الموظف لم يكمل مدة الخدمة المطلوبة");
  return { employee, settings };
}

export async function createEmployeeAdvance(input: unknown, actor: AdvanceActor) {
  const data = createAdvanceSchema.parse(input);
  await ensureEmployeeAdvanceTables();
  await enforceLimits(data.employeeId, data.amount);
  const now = new Date();
  const [created] = await db.insert(employeeAdvancesTable).values({
    advanceNo: `ADV-TMP-${crypto.randomUUID()}`,
    employeeId: data.employeeId,
    requestDate: data.requestDate ?? dateInBaghdad(),
    advanceType: data.advanceType,
    amount: String(data.amount),
    remainingAmount: String(data.amount),
    monthlyDeduction: String(data.monthlyDeduction),
    reason: data.reason,
    notes: data.notes || null,
    attachmentUrl: data.attachmentUrl || null,
    dueDate: data.dueDate || null,
    requestedBy: actor.id,
    requestedByName: actor.name,
    createdAt: now,
    updatedAt: now,
  }).returning();
  const [saved] = await db.update(employeeAdvancesTable).set({ advanceNo: advanceNumber(created.id) }).where(eq(employeeAdvancesTable.id, created.id)).returning();
  return saved;
}

export async function listEmployeeAdvances(input: unknown = {}) {
  const filters = advanceFilterSchema.parse(input);
  await ensureEmployeeAdvanceTables();
  const clauses: any[] = [];
  if (filters.employeeId) clauses.push(eq(employeeAdvancesTable.employeeId, filters.employeeId));
  if (filters.status) clauses.push(eq(employeeAdvancesTable.status, filters.status));
  if (filters.from) clauses.push(gte(employeeAdvancesTable.requestDate, filters.from));
  if (filters.to) clauses.push(lte(employeeAdvancesTable.requestDate, filters.to));
  if (filters.minAmount !== undefined) clauses.push(gte(employeeAdvancesTable.amount, String(filters.minAmount)));
  if (filters.maxAmount !== undefined) clauses.push(lte(employeeAdvancesTable.amount, String(filters.maxAmount)));
  if (filters.department) clauses.push(eq(staffTable.department, filters.department));
  if (filters.outstandingOnly === "true") clauses.push(sql`${employeeAdvancesTable.remainingAmount} > 0`);
  if (filters.q) {
    const term = `%${filters.q}%`;
    clauses.push(or(ilike(staffTable.fullName, term), ilike(staffTable.username, term), ilike(employeeAdvancesTable.advanceNo, term)));
  }
  const rows = await db.select({ advance: employeeAdvancesTable, employeeName: staffTable.fullName, employeeUsername: staffTable.username, department: staffTable.department, baseSalary: staffTable.baseSalary }).from(employeeAdvancesTable).innerJoin(staffTable, eq(employeeAdvancesTable.employeeId, staffTable.id)).where(clauses.length ? and(...clauses) : undefined).orderBy(desc(employeeAdvancesTable.createdAt));
  return rows.map((row) => ({ ...toPlain(row.advance), amount: asNumber(row.advance.amount), repaidAmount: asNumber(row.advance.repaidAmount), remainingAmount: asNumber(row.advance.remainingAmount), monthlyDeduction: asNumber(row.advance.monthlyDeduction), employeeName: row.employeeName || row.employeeUsername, employeeUsername: row.employeeUsername, department: row.department, baseSalary: asNumber(row.baseSalary) }));
}

export async function getEmployeeAdvance(id: number) {
  const rows = await listEmployeeAdvances({});
  const advance = rows.find((row) => row.id === id);
  if (!advance) return null;
  const repayments = await db.query.employeeAdvanceRepaymentsTable.findMany({ where: eq(employeeAdvanceRepaymentsTable.advanceId, id), orderBy: [desc(employeeAdvanceRepaymentsTable.paymentDate), desc(employeeAdvanceRepaymentsTable.id)] });
  return { ...advance, repayments: repayments.map((r) => ({ ...toPlain(r), amount: asNumber(r.amount) })) };
}

export async function updateEmployeeAdvance(id: number, input: unknown, actor: AdvanceActor) {
  const data = updateAdvanceSchema.parse(input);
  const existing = await db.query.employeeAdvancesTable.findFirst({ where: eq(employeeAdvancesTable.id, id) });
  if (!existing) throw new Error("السلفة غير موجودة");
  if (!["pending", "rejected"].includes(existing.status)) throw new Error("لا يمكن تعديل سلفة بعد صرفها");
  const [saved] = await db.update(employeeAdvancesTable).set({
    ...(data.requestDate ? { requestDate: data.requestDate } : {}),
    ...(data.advanceType ? { advanceType: data.advanceType } : {}),
    ...(data.amount !== undefined ? { amount: String(data.amount), remainingAmount: String(data.amount) } : {}),
    ...(data.monthlyDeduction !== undefined ? { monthlyDeduction: String(data.monthlyDeduction) } : {}),
    ...(data.reason !== undefined ? { reason: data.reason } : {}),
    ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
    ...(data.attachmentUrl !== undefined ? { attachmentUrl: data.attachmentUrl || null } : {}),
    ...(data.dueDate !== undefined ? { dueDate: data.dueDate || null } : {}),
    updatedAt: new Date(),
  }).where(eq(employeeAdvancesTable.id, id)).returning();
  return { before: existing, saved, actor };
}

export async function approveEmployeeAdvance(id: number, actor: AdvanceActor, note?: string) {
  if (!canManage(actor)) throw new Error("اعتماد السلف متاح للمدير أو المحاسب فقط");
  await ensureEmployeeAdvanceTables();
  const advance = await db.query.employeeAdvancesTable.findFirst({ where: eq(employeeAdvancesTable.id, id) });
  if (!advance) throw new Error("السلفة غير موجودة");
  if (advance.status === "paid") return { advance, transaction: null };
  if (advance.status !== "pending") throw new Error("يمكن اعتماد الطلبات المعلّقة فقط");
  const employee = await db.query.staffTable.findFirst({ where: eq(staffTable.id, advance.employeeId) });
  if (!employee) throw new Error("الموظف غير موجود");
  const transaction = await createFinancialTransaction({
    transactionDate: advance.requestDate,
    direction: "expense",
    amount: asNumber(advance.amount),
    department: "hr",
    transactionType: "employee_advance",
    description: `سلفة موظف: ${employee.fullName || employee.username} (${advance.advanceNo})`,
    paymentMethod: "cash",
    sourceType: "employee_advance",
    sourceId: String(advance.id),
    sourceEvent: "advance_paid",
    idempotencyKey: `employee-advance:${advance.id}:payment`,
    approvalStatus: "pending",
    responsibleUserId: employee.id,
    responsibleUserName: employee.fullName || employee.username,
    dueDate: advance.dueDate,
    notes: [advance.notes, note].filter(Boolean).join("\n"),
    attachments: advance.attachmentUrl ? [advance.attachmentUrl] : [],
  }, actor);
  const executed = await approveAndExecuteFinancialTransaction(transaction.id, actor, note);
  const now = new Date();
  const [saved] = await db.update(employeeAdvancesTable).set({ status: "paid", financialTransactionId: executed.id, approvedBy: actor.id, approvedByName: actor.name, approvedAt: now, paidAt: now, updatedAt: now }).where(eq(employeeAdvancesTable.id, id)).returning();
  return { advance: saved, transaction: executed };
}

export async function rejectEmployeeAdvance(id: number, actor: AdvanceActor, reason: string) {
  if (!canManage(actor)) throw new Error("رفض السلف متاح للمدير أو المحاسب فقط");
  const clean = reason.trim();
  if (clean.length < 3) throw new Error("سبب الرفض مطلوب");
  const existing = await db.query.employeeAdvancesTable.findFirst({ where: eq(employeeAdvancesTable.id, id) });
  if (!existing) throw new Error("السلفة غير موجودة");
  if (existing.status !== "pending") throw new Error("يمكن رفض الطلبات المعلّقة فقط");
  const [saved] = await db.update(employeeAdvancesTable).set({ status: "rejected", rejectedBy: actor.id, rejectedByName: actor.name, rejectedAt: new Date(), rejectionReason: clean, updatedAt: new Date() }).where(eq(employeeAdvancesTable.id, id)).returning();
  return { before: existing, saved };
}

export async function cancelEmployeeAdvance(id: number, actor: AdvanceActor, reason?: string) {
  const existing = await db.query.employeeAdvancesTable.findFirst({ where: eq(employeeAdvancesTable.id, id) });
  if (!existing) throw new Error("السلفة غير موجودة");
  if (!canManage(actor) && existing.requestedBy !== actor.id) throw new Error("ليس لديك صلاحية إلغاء هذا الطلب");
  if (!["pending", "rejected"].includes(existing.status)) throw new Error("لا يمكن إلغاء سلفة تم صرفها");
  const [saved] = await db.update(employeeAdvancesTable).set({ status: "cancelled", notes: [existing.notes, reason?.trim() ? `إلغاء: ${reason.trim()}` : ""].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(employeeAdvancesTable.id, id)).returning();
  return { before: existing, saved };
}

export async function recordEmployeeAdvanceRepayment(id: number, input: unknown, actor: AdvanceActor, kind: "manual" | "payroll" = "manual") {
  if (!canManage(actor)) throw new Error("تسديد السلف متاح للمدير أو المحاسب فقط");
  const data = repaymentSchema.parse(input);
  const advance = await db.query.employeeAdvancesTable.findFirst({ where: eq(employeeAdvancesTable.id, id) });
  if (!advance) throw new Error("السلفة غير موجودة");
  if (!["approved", "paid"].includes(advance.status) || asNumber(advance.remainingAmount) <= 0) throw new Error("هذه السلفة غير قابلة للتسديد");
  const paid = Math.min(data.amount, asNumber(advance.remainingAmount));
  if (paid <= 0) throw new Error("مبلغ التسديد غير صالح");
  let transaction: any = null;
  if (kind === "manual") {
    const employee = await db.query.staffTable.findFirst({ where: eq(staffTable.id, advance.employeeId) });
    transaction = await createFinancialTransaction({
      transactionDate: data.paymentDate ?? dateInBaghdad(), direction: "revenue", amount: paid, department: "hr",
      transactionType: "employee_advance_repayment", description: `تسديد سلفة ${advance.advanceNo} — ${employee?.fullName || employee?.username || "موظف"}`,
      paymentMethod: data.method === "main_cashbox" ? "cash" : data.method === "bank" ? "transfer" : data.method,
      sourceType: "employee_advance", sourceId: String(advance.id), sourceEvent: "repayment",
      idempotencyKey: `employee-advance:${advance.id}:repayment:${crypto.randomUUID()}`, approvalStatus: "pending",
      responsibleUserId: advance.employeeId, responsibleUserName: employee?.fullName || employee?.username || "",
      notes: data.notes, attachments: [],
    }, actor);
    transaction = await approveAndExecuteFinancialTransaction(transaction.id, actor, data.notes);
  }
  const nextRepaid = asNumber(advance.repaidAmount) + paid;
  const nextRemaining = Math.max(0, asNumber(advance.remainingAmount) - paid);
  const now = new Date();
  const [repayment] = await db.insert(employeeAdvanceRepaymentsTable).values({ advanceId: advance.id, employeeId: advance.employeeId, paymentDate: data.paymentDate ?? dateInBaghdad(), amount: String(paid), method: data.method, kind, notes: data.notes || null, payrollReference: data.payrollReference || null, financialTransactionId: transaction?.id ?? null, receivedBy: actor.id, receivedByName: actor.name }).returning();
  const [saved] = await db.update(employeeAdvancesTable).set({ repaidAmount: String(nextRepaid), remainingAmount: String(nextRemaining), status: nextRemaining === 0 ? "completed" : "paid", lastDeductionAt: kind === "payroll" ? now : advance.lastDeductionAt, payrollReference: data.payrollReference || advance.payrollReference, updatedAt: now }).where(eq(employeeAdvancesTable.id, id)).returning();
  return { before: advance, advance: saved, repayment, transaction };
}

export async function applyPayrollAdvanceDeductions(input: { employeeId: number; payrollReference: string; amount?: number }, actor: AdvanceActor) {
  const active = await listEmployeeAdvances({ employeeId: input.employeeId, outstandingOnly: "true" });
  let remainingBudget = input.amount ?? Number.MAX_SAFE_INTEGER;
  const deductions: any[] = [];
  for (const advance of active.filter((row) => row.status === "paid" || row.status === "approved")) {
    if (remainingBudget <= 0) break;
    const deduction = Math.min(advance.monthlyDeduction || advance.remainingAmount, advance.remainingAmount, remainingBudget);
    if (deduction <= 0) continue;
    deductions.push(await recordEmployeeAdvanceRepayment(advance.id, { amount: deduction, method: "payroll", payrollReference: input.payrollReference, notes: `خصم تلقائي من الراتب: ${input.payrollReference}` }, actor, "payroll"));
    remainingBudget -= deduction;
  }
  return deductions;
}

export async function getEmployeeAdvanceSummary(employeeId: number) {
  const advances = await listEmployeeAdvances({ employeeId });
  const totalAdvances = advances.filter((a) => ["paid", "completed", "approved"].includes(a.status)).reduce((sum, a) => sum + a.amount, 0);
  const outstandingBalance = advances.reduce((sum, a) => sum + a.remainingAmount, 0);
  const paidAmount = advances.reduce((sum, a) => sum + a.repaidAmount, 0);
  const last = advances[0] ?? null;
  return { totalAdvances, outstandingBalance, paidAmount, remainingBalance: outstandingBalance, lastAdvanceDate: last?.requestDate ?? null, history: advances };
}

export async function getEmployeeAdvanceDashboard(input: unknown = {}) {
  const rows = await listEmployeeAdvances(input);
  const active = rows.filter((r) => ["approved", "paid"].includes(r.status));
  const totalOutstanding = rows.reduce((sum, r) => sum + r.remainingAmount, 0);
  const totalRepaid = rows.reduce((sum, r) => sum + r.repaidAmount, 0);
  const issued = rows.filter((r) => ["paid", "completed", "approved"].includes(r.status));
  const monthly = new Map<string, { advances: number; repayments: number }>();
  for (const row of issued) {
    const key = String(row.requestDate).slice(0, 7);
    const value = monthly.get(key) ?? { advances: 0, repayments: 0 };
    value.advances += row.amount;
    value.repayments += row.repaidAmount;
    monthly.set(key, value);
  }
  const departments = new Map<string, { count: number; outstanding: number }>();
  for (const row of rows) {
    const value = departments.get(row.department || "general") ?? { count: 0, outstanding: 0 };
    value.count += 1; value.outstanding += row.remainingAmount; departments.set(row.department || "general", value);
  }
  const today = dateInBaghdad();
  return {
    cards: { totalActiveAdvances: active.length, totalOutstanding, totalRepaid, totalPendingRequests: rows.filter((r) => r.status === "pending").length, averageAdvance: issued.length ? issued.reduce((s, r) => s + r.amount, 0) / issued.length : 0, highestAdvance: issued.reduce((max, r) => Math.max(max, r.amount), 0), overdueRepayments: rows.filter((r) => r.remainingAmount > 0 && !!r.dueDate && String(r.dueDate) < today).length },
    recentlyApproved: rows.filter((r) => r.status === "paid").slice(0, 6), recentlyPaid: rows.filter((r) => r.repaidAmount > 0).slice(0, 6),
    monthly: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ month, ...values })),
    departments: [...departments.entries()].map(([department, values]) => ({ department, ...values })),
  };
}

export async function getEmployeeAdvanceReport(input: unknown = {}) {
  const rows = await listEmployeeAdvances(input);
  return rows.map((row) => ({ number: row.advanceNo, employee: row.employeeName, department: row.department, date: row.requestDate, type: row.advanceType, amount: row.amount, repaid: row.repaidAmount, outstanding: row.remainingAmount, status: row.status, notes: row.notes || "" }));
}
