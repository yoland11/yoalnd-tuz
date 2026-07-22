import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  financialAccountsTable,
  financialAuditLogsTable,
  financialLedgerEntriesTable,
  financialTransactionsTable,
  masterCashBoxTable,
} from "@workspace/db";

export type FinancialActor = {
  id: number | null;
  name: string;
  role: string;
  permissions?: string[];
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صحيحة");
const optionalText = z.string().trim().max(2000).optional().nullable();

export const financialTransactionInputSchema = z.object({
  transactionDate: dateSchema.optional(),
  direction: z.enum(["revenue", "expense"], { error: "نوع الحركة مطلوب" }),
  amount: z.coerce
    .number()
    .positive("المبلغ يجب أن يكون أكبر من صفر")
    .max(999_999_999_999),
  department: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "رمز القسم غير صحيح")
    .default("general"),
  transactionType: z.string().trim().min(1, "نوع المعاملة مطلوب").max(60),
  referenceNo: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().default(""),
  paymentMethod: z
    .enum(["cash", "transfer", "card", "pos", "other"])
    .default("cash"),
  sourceType: z.string().trim().max(60).optional().nullable(),
  sourceId: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((value) => (value == null ? null : String(value))),
  sourceEvent: z.string().trim().max(60).optional().default("primary"),
  idempotencyKey: z.string().trim().max(180).optional(),
  approvalStatus: z.enum(["draft", "pending"]).optional().default("pending"),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  customerName: z.string().trim().max(200).optional().nullable(),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  dueDate: dateSchema.optional().nullable(),
  inventoryItemId: z.coerce.number().int().positive().optional().nullable(),
  responsibleUserId: z.coerce.number().int().positive().optional().nullable(),
  responsibleUserName: z.string().trim().max(200).optional().nullable(),
  notes: optionalText,
  attachments: z.array(z.string().max(2000)).max(20).optional().default([]),
});

export const financialTransactionPatchSchema = financialTransactionInputSchema
  .omit({ direction: true, amount: true, transactionType: true })
  .partial()
  .extend({
    direction: z.enum(["revenue", "expense"]).optional(),
    amount: z.coerce.number().positive().max(999_999_999_999).optional(),
    transactionType: z.string().trim().min(1).max(60).optional(),
    reason: z.string().trim().min(3, "سبب التعديل مطلوب").max(500),
  });

export const financialTransactionListSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z
    .enum(["draft", "pending", "approved", "rejected", "executed"])
    .optional(),
  direction: z.enum(["revenue", "expense"]).optional(),
  department: z.string().trim().max(40).optional(),
  voucherType: z.string().trim().max(60).optional(),
  search: z.string().trim().max(120).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  // Approval feeds request a large single page so the displayed rows match
  // the dashboard badge even when older pending rows accumulate.
  limit: z.coerce.number().int().min(5).max(5000).optional().default(20),
});

const ACCOUNT_SEEDS = [
  ["1200", "ذمم العملاء", "asset", null],
  ["1300", "Employee advances", "asset", "hr"],
  ["5070", "Payroll and incentives", "expense", "hr"],
  ["5071", "Bonus expense", "expense", "hr"],
  ["5072", "Allowance expense", "expense", "hr"],
  ["2100", "Salary payable", "liability", "hr"],
  ["2200", "Payroll deductions payable", "liability", "hr"],
  ["1000", "الصندوق الرئيسي", "asset", null],
  ["4000", "إيرادات عامة", "revenue", "general"],
  ["4010", "إيرادات المتجر", "revenue", "store"],
  ["4020", "إيرادات الكوشات", "revenue", "koshas"],
  ["4030", "إيرادات التصوير", "revenue", "photography"],
  ["4040", "إيرادات الصوتيات", "revenue", "audio"],
  ["4050", "إيرادات الهدايا والتوزيعات", "revenue", "gifts"],
  ["4060", "إيرادات تجهيزات التخرج", "revenue", "graduation"],
  ["5000", "مصاريف عامة", "expense", "general"],
  ["5010", "مصاريف المتجر", "expense", "store"],
  ["5020", "مصاريف الكوشات", "expense", "koshas"],
  ["5030", "مصاريف التصوير", "expense", "photography"],
  ["5040", "مصاريف الصوتيات", "expense", "audio"],
  ["5050", "مصاريف الهدايا والتوزيعات", "expense", "gifts"],
  ["5060", "مصاريف تجهيزات التخرج", "expense", "graduation"],
  ["5090", "خسائر التلف والفقدان", "expense", "inventory"],
] as const;

let masterCashTablesReady: Promise<void> | null = null;

export async function ensureMasterCashBoxTables() {
  if (!masterCashTablesReady) {
    masterCashTablesReady = db
      .execute(
        sql`
      CREATE TABLE IF NOT EXISTS "master_cash_box" (
        "id" serial PRIMARY KEY,
        "code" varchar(30) NOT NULL DEFAULT 'MASTER',
        "name" text NOT NULL DEFAULT 'الصندوق الرئيسي',
        "opening_balance" numeric(16,2) NOT NULL DEFAULT 0,
        "current_balance" numeric(16,2) NOT NULL DEFAULT 0,
        "total_revenue" numeric(16,2) NOT NULL DEFAULT 0,
        "total_expenses" numeric(16,2) NOT NULL DEFAULT 0,
        "net_profit" numeric(16,2) NOT NULL DEFAULT 0,
        "available_balance" numeric(16,2) NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 0,
        "updated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "master_cash_box_code_idx" ON "master_cash_box" ("code");

      CREATE TABLE IF NOT EXISTS "financial_accounts" (
        "id" serial PRIMARY KEY,
        "code" varchar(30) NOT NULL,
        "name_ar" text NOT NULL,
        "account_type" varchar(20) NOT NULL,
        "department" varchar(40),
        "is_system" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_accounts_code_idx" ON "financial_accounts" ("code");

      CREATE TABLE IF NOT EXISTS "financial_transactions" (
        "id" serial PRIMARY KEY,
        "transaction_no" varchar(50) NOT NULL,
        "transaction_date" date NOT NULL,
        "transaction_time" timestamp NOT NULL DEFAULT now(),
        "direction" varchar(20) NOT NULL,
        "amount" numeric(16,2) NOT NULL,
        "department" varchar(40) NOT NULL DEFAULT 'general',
        "transaction_type" varchar(60) NOT NULL,
        "reference_no" varchar(120),
        "description" text NOT NULL DEFAULT '',
        "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
        "source_type" varchar(60),
        "source_id" varchar(80),
        "source_event" varchar(60) NOT NULL DEFAULT 'primary',
        "idempotency_key" varchar(180) NOT NULL,
        "approval_status" varchar(20) NOT NULL DEFAULT 'draft',
        "requested_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "requested_by_name" text NOT NULL DEFAULT '',
        "submitted_at" timestamp,
        "approved_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "approved_by_name" text NOT NULL DEFAULT '',
        "approved_at" timestamp,
        "rejected_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "rejected_by_name" text NOT NULL DEFAULT '',
        "rejected_at" timestamp,
        "rejection_reason" text,
        "executed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "executed_by_name" text NOT NULL DEFAULT '',
        "executed_at" timestamp,
        "balance_before" numeric(16,2),
        "balance_after" numeric(16,2),
        "customer_id" integer REFERENCES "customers"("id") ON DELETE SET NULL,
        "customer_name" text,
        "customer_phone" varchar(30),
        "due_date" date,
        "inventory_item_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
        "responsible_user_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "responsible_user_name" text,
        "notes" text,
        "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_no_idx" ON "financial_transactions" ("transaction_no");
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_idempotency_idx" ON "financial_transactions" ("idempotency_key");
      CREATE INDEX IF NOT EXISTS "financial_transactions_date_idx" ON "financial_transactions" ("transaction_date");
      CREATE INDEX IF NOT EXISTS "financial_transactions_status_idx" ON "financial_transactions" ("approval_status");
      CREATE INDEX IF NOT EXISTS "financial_transactions_department_idx" ON "financial_transactions" ("department");
      CREATE INDEX IF NOT EXISTS "financial_transactions_direction_idx" ON "financial_transactions" ("direction");
      CREATE INDEX IF NOT EXISTS "financial_transactions_source_idx" ON "financial_transactions" ("source_type", "source_id");
      CREATE INDEX IF NOT EXISTS "financial_transactions_customer_idx" ON "financial_transactions" ("customer_id");
      CREATE INDEX IF NOT EXISTS "financial_transactions_due_date_idx" ON "financial_transactions" ("due_date");

      CREATE TABLE IF NOT EXISTS "financial_ledger_entries" (
        "id" serial PRIMARY KEY,
        "transaction_id" integer NOT NULL REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
        "account_id" integer NOT NULL REFERENCES "financial_accounts"("id") ON DELETE RESTRICT,
        "entry_side" varchar(10) NOT NULL,
        "amount" numeric(16,2) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "financial_ledger_entries_transaction_idx" ON "financial_ledger_entries" ("transaction_id");
      CREATE INDEX IF NOT EXISTS "financial_ledger_entries_account_idx" ON "financial_ledger_entries" ("account_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "financial_ledger_entries_unique_idx" ON "financial_ledger_entries" ("transaction_id", "account_id", "entry_side");

      CREATE TABLE IF NOT EXISTS "financial_audit_logs" (
        "id" serial PRIMARY KEY,
        "transaction_id" integer REFERENCES "financial_transactions"("id") ON DELETE RESTRICT,
        "action" varchar(60) NOT NULL,
        "actor_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
        "actor_name" text NOT NULL DEFAULT '',
        "old_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "new_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reason" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "financial_audit_logs_transaction_idx" ON "financial_audit_logs" ("transaction_id");
      CREATE INDEX IF NOT EXISTS "financial_audit_logs_actor_idx" ON "financial_audit_logs" ("actor_id");
      CREATE INDEX IF NOT EXISTS "financial_audit_logs_created_at_idx" ON "financial_audit_logs" ("created_at");

      INSERT INTO "master_cash_box" ("code", "name") VALUES ('MASTER', 'الصندوق الرئيسي')
      ON CONFLICT ("code") DO NOTHING;

      ALTER TABLE IF EXISTS "expenses" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
      ALTER TABLE IF EXISTS "expenses" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;
      ALTER TABLE IF EXISTS "receipt_vouchers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
      ALTER TABLE IF EXISTS "receipt_vouchers" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;
      ALTER TABLE IF EXISTS "payment_vouchers" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'executed';
      ALTER TABLE IF EXISTS "payment_vouchers" ADD COLUMN IF NOT EXISTS "financial_transaction_id" integer;
      ALTER TABLE IF EXISTS "orders" ADD COLUMN IF NOT EXISTS "due_date" date;
      ALTER TABLE IF EXISTS "service_orders" ADD COLUMN IF NOT EXISTS "due_date" date;
      ALTER TABLE IF EXISTS "sales_invoices" ADD COLUMN IF NOT EXISTS "due_date" date;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "total_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "remaining_amount" numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "payment_status" varchar(20) NOT NULL DEFAULT 'unpaid';
      ALTER TABLE IF EXISTS "kosha_bookings" ADD COLUMN IF NOT EXISTS "due_date" date;

      CREATE OR REPLACE FUNCTION ajn_prevent_financial_delete() RETURNS trigger AS $immutable$
      BEGIN
        RAISE EXCEPTION 'Financial records are immutable and cannot be deleted';
      END;
      $immutable$ LANGUAGE plpgsql;

      DO $triggers$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_transactions_no_delete') THEN
          CREATE TRIGGER financial_transactions_no_delete BEFORE DELETE ON financial_transactions
          FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_ledger_entries_no_delete') THEN
          CREATE TRIGGER financial_ledger_entries_no_delete BEFORE DELETE ON financial_ledger_entries
          FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_audit_logs_no_delete') THEN
          CREATE TRIGGER financial_audit_logs_no_delete BEFORE DELETE ON financial_audit_logs
          FOR EACH ROW EXECUTE FUNCTION ajn_prevent_financial_delete();
        END IF;
      END $triggers$;
    `,
      )
      .then(async () => {
        // Reversal / adjustment linkage columns (additive, idempotent).
        await db.execute(sql`
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_transaction_id" integer;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reference_no" varchar(120);
        CREATE INDEX IF NOT EXISTS "financial_transactions_reference_no_idx" ON "financial_transactions" ("reference_no");
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversal_txn_id" integer;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversal_reason" text;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_by" integer;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_by_name" text;
        ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp;
        ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
        ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
        ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "financially_reversed" boolean NOT NULL DEFAULT false;
      `);
        for (const [code, nameAr, accountType, department] of ACCOUNT_SEEDS) {
          await db
            .insert(financialAccountsTable)
            .values({ code, nameAr, accountType, department })
            .onConflictDoNothing();
        }
      })
      .then(() => undefined)
      .catch((error) => {
        masterCashTablesReady = null;
        throw error;
      });
  }
  await masterCashTablesReady;
}

function todayBaghdad(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function money(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : 0;
}

function snapshot(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

function transactionNumber(id: number, date = new Date()) {
  const y = String(date.getFullYear()).slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `FIN-${y}${m}-${String(id).padStart(6, "0")}`;
}

function counterAccountCode(
  direction: "revenue" | "expense",
  department: string,
  transactionType: string,
) {
  // A receipt settles a customer receivable; it is not a second sale/revenue.
  // The charge remains in its originating booking/invoice journal.
  if (transactionType === "receipt_voucher") return "1200";
  if (
    transactionType === "employee_advance" ||
    transactionType === "employee_advance_repayment"
  )
    return "1300";
  if (transactionType === "payroll_settlement") return "2100";
  if (direction === "expense" && transactionType === "damage_loss")
    return "5090";
  const revenue: Record<string, string> = {
    store: "4010",
    koshas: "4020",
    photography: "4030",
    audio: "4040",
    gifts: "4050",
    graduation: "4060",
  };
  const expense: Record<string, string> = {
    store: "5010",
    koshas: "5020",
    photography: "5030",
    audio: "5040",
    gifts: "5050",
    graduation: "5060",
    hr: "5070",
  };
  return direction === "revenue"
    ? (revenue[department] ?? "4000")
    : (expense[department] ?? "5000");
}

async function addAudit(
  transactionId: number | null,
  action: string,
  actor: FinancialActor,
  oldValues: Record<string, unknown> = {},
  newValues: Record<string, unknown> = {},
  reason?: string | null,
) {
  await db.insert(financialAuditLogsTable).values({
    transactionId,
    action,
    actorId: actor.id,
    actorName: actor.name,
    oldValues,
    newValues,
    reason: reason?.trim() || null,
  });
}

export async function createFinancialTransaction(
  input: unknown,
  actor: FinancialActor,
) {
  await ensureMasterCashBoxTables();
  const data = financialTransactionInputSchema.parse(input);
  const now = new Date();
  const idempotencyKey =
    data.idempotencyKey || `manual:${actor.id ?? "system"}:${randomUUID()}`;
  const existing = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.idempotencyKey, idempotencyKey),
  });
  if (existing) return existing;
  const [row] = await db
    .insert(financialTransactionsTable)
    .values({
      transactionNo: `FIN-TMP-${randomUUID()}`,
      transactionDate: data.transactionDate ?? todayBaghdad(),
      direction: data.direction,
      amount: String(money(data.amount)),
      department: data.department,
      transactionType: data.transactionType,
      referenceNo: data.referenceNo,
      description: data.description,
      paymentMethod: data.paymentMethod === "card" ? "pos" : data.paymentMethod,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      sourceEvent: data.sourceEvent,
      idempotencyKey,
      approvalStatus: data.approvalStatus,
      requestedBy: actor.id,
      requestedByName: actor.name,
      submittedAt: data.approvalStatus === "pending" ? now : null,
      customerId: data.customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      dueDate: data.dueDate,
      inventoryItemId: data.inventoryItemId,
      responsibleUserId: data.responsibleUserId,
      responsibleUserName: data.responsibleUserName,
      notes: data.notes,
      attachments: data.attachments,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const transactionNo = transactionNumber(row.id, now);
  const [saved] = await db
    .update(financialTransactionsTable)
    .set({ transactionNo })
    .where(eq(financialTransactionsTable.id, row.id))
    .returning();
  await addAudit(
    saved.id,
    saved.approvalStatus === "pending" ? "submitted" : "created_draft",
    actor,
    {},
    snapshot(saved as any),
  );
  return saved;
}

export async function updateFinancialTransaction(
  id: number,
  input: unknown,
  actor: FinancialActor,
) {
  await ensureMasterCashBoxTables();
  const data = financialTransactionPatchSchema.parse(input);
  const existing = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.id, id),
  });
  if (!existing) throw new Error("المعاملة غير موجودة");
  if (!["draft", "rejected"].includes(existing.approvalStatus))
    throw new Error("لا يمكن تعديل المعاملة بعد إرسالها أو تنفيذها");
  const reason = data.reason;
  const {
    reason: _reason,
    approvalStatus: _approvalStatus,
    idempotencyKey: _key,
    ...values
  } = data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined)
      update[key] = key === "amount" ? String(money(value)) : value;
  }
  const [saved] = await db
    .update(financialTransactionsTable)
    .set(update as any)
    .where(eq(financialTransactionsTable.id, id))
    .returning();
  await addAudit(
    id,
    "updated",
    actor,
    snapshot(existing as any),
    snapshot(saved as any),
    reason,
  );
  return saved;
}

export async function submitFinancialTransaction(
  id: number,
  actor: FinancialActor,
) {
  await ensureMasterCashBoxTables();
  const existing = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.id, id),
  });
  if (!existing) throw new Error("المعاملة غير موجودة");
  if (!["draft", "rejected"].includes(existing.approvalStatus))
    throw new Error("المعاملة مرسلة مسبقاً");
  const [saved] = await db
    .update(financialTransactionsTable)
    .set({
      approvalStatus: "pending",
      submittedAt: new Date(),
      rejectedAt: null,
      rejectedBy: null,
      rejectedByName: "",
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(financialTransactionsTable.id, id))
    .returning();
  await addAudit(
    id,
    "submitted",
    actor,
    snapshot(existing as any),
    snapshot(saved as any),
  );
  return saved;
}

export async function syncSourceFinancialRequest(
  id: number,
  input: unknown,
  actor: FinancialActor,
  reason: string,
) {
  await ensureMasterCashBoxTables();
  const data = financialTransactionInputSchema.parse({
    ...(input as Record<string, unknown>),
    approvalStatus: "pending",
  });
  const existing = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.id, id),
  });
  if (!existing) throw new Error("المعاملة المالية المرتبطة غير موجودة");
  if (existing.approvalStatus === "executed")
    throw new Error(
      "تم تنفيذ المعاملة المالية؛ أنشئ حركة تصحيح بدلاً من تعديلها",
    );
  const [saved] = await db
    .update(financialTransactionsTable)
    .set({
      transactionDate: data.transactionDate ?? existing.transactionDate,
      direction: data.direction,
      amount: String(money(data.amount)),
      department: data.department,
      transactionType: data.transactionType,
      description: data.description,
      paymentMethod: data.paymentMethod === "card" ? "pos" : data.paymentMethod,
      customerId: data.customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      dueDate: data.dueDate,
      inventoryItemId: data.inventoryItemId,
      responsibleUserId: data.responsibleUserId,
      responsibleUserName: data.responsibleUserName,
      notes: data.notes,
      attachments: data.attachments,
      approvalStatus: "pending",
      submittedAt: new Date(),
      rejectedBy: null,
      rejectedByName: "",
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(financialTransactionsTable.id, id))
    .returning();
  await addAudit(
    id,
    "source_synced",
    actor,
    snapshot(existing as any),
    snapshot(saved as any),
    reason,
  );
  return saved;
}

export async function cancelFinancialTransactionRequest(
  id: number,
  actor: FinancialActor,
  reason: string,
) {
  await ensureMasterCashBoxTables();
  const existing = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.id, id),
  });
  if (!existing) return null;
  if (existing.approvalStatus === "executed")
    throw new Error("لا يمكن حذف أو إلغاء حركة مالية منفذة");
  const [saved] = await db
    .update(financialTransactionsTable)
    .set({
      approvalStatus: "rejected",
      rejectedBy: actor.id,
      rejectedByName: actor.name,
      rejectedAt: new Date(),
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(financialTransactionsTable.id, id))
    .returning();
  await addAudit(
    id,
    "cancelled_by_source",
    actor,
    snapshot(existing as any),
    snapshot(saved as any),
    reason,
  );
  return saved;
}

export function canApproveFinancialTransactions(actor: FinancialActor) {
  return (
    actor.role === "admin" ||
    actor.role === "manager" ||
    Boolean(actor.permissions?.includes("voucher_approve")) ||
    Boolean(actor.permissions?.includes("voucher_reverse"))
  );
}

/** Posts the receipt plan inside the same transaction as cashbox and journal. */
async function postReceiptVoucherAllocations(tx: any, voucherId: number, amount: number) {
  const result = await tx.execute(sql`
    SELECT id, customer_id, source_type, source_id, amount::numeric AS amount
    FROM receipt_voucher_allocations
    WHERE receipt_voucher_id = ${voucherId} AND posted_at IS NULL
    ORDER BY id FOR UPDATE
  `);
  const allocations = (result.rows ?? []) as Array<{ id: number; customer_id: number; source_type: string; source_id: number | null; amount: string }>;
  if (!allocations.length)
    throw new Error("لا توجد توزيعات لسند القبض. اربط السند بمعاملة أو احفظه كرصيد للعميل.");
  const allocated = money(allocations.reduce((sum, row) => sum + money(row.amount), 0));
  if (Math.abs(allocated - amount) >= 0.01)
    throw new Error("إجمالي توزيعات سند القبض لا يساوي المبلغ المستلم.");

  for (const allocation of allocations) {
    const value = money(allocation.amount);
    if (allocation.source_type === "customer_credit") continue;
    if (!allocation.source_id) throw new Error("مرجع التوزيع غير صحيح.");
    let updated: any;
    if (allocation.source_type === "kosha_booking") {
      updated = await tx.execute(sql`
        UPDATE kosha_bookings
        SET paid_amount = paid_amount::numeric + ${value},
            remaining_amount = greatest(total_amount::numeric - paid_amount::numeric - ${value}, 0),
            payment_status = CASE
              WHEN total_amount::numeric - paid_amount::numeric - ${value} <= 0 THEN 'paid'
              WHEN paid_amount::numeric + ${value} > 0 THEN 'partial'
              ELSE 'unpaid' END,
            updated_at = now()
        WHERE id = ${allocation.source_id} AND customer_id = ${allocation.customer_id}
          AND remaining_amount::numeric >= ${value}
        RETURNING id
      `);
    } else if (allocation.source_type === "sales_invoice") {
      updated = await tx.execute(sql`
        UPDATE sales_invoices SET paid_amount = paid_amount::numeric + ${value},
          remaining_amount = greatest(total::numeric - paid_amount::numeric - ${value}, 0),
          payment_status = CASE WHEN total::numeric - paid_amount::numeric - ${value} <= 0 THEN 'paid' ELSE 'partial' END,
          updated_at = now()
        WHERE id = ${allocation.source_id} AND customer_id = ${allocation.customer_id}
          AND remaining_amount::numeric >= ${value} RETURNING id
      `);
    } else if (allocation.source_type === "order") {
      updated = await tx.execute(sql`
        UPDATE orders SET deposit_amount = deposit_amount::numeric + ${value},
          remaining_amount = greatest(total::numeric - deposit_amount::numeric - ${value}, 0),
          payment_status = CASE WHEN total::numeric - deposit_amount::numeric - ${value} <= 0 THEN 'paid' ELSE 'partial' END,
          updated_at = now()
        WHERE id = ${allocation.source_id} AND customer_id = ${allocation.customer_id}
          AND remaining_amount::numeric >= ${value} RETURNING id
      `);
    } else if (allocation.source_type === "service_order") {
      updated = await tx.execute(sql`
        UPDATE service_orders SET deposit_amount = deposit_amount::numeric + ${value},
          remaining_amount = greatest(total_amount::numeric - deposit_amount::numeric - ${value}, 0),
          payment_status = CASE WHEN total_amount::numeric - deposit_amount::numeric - ${value} <= 0 THEN 'paid' ELSE 'partial' END
        WHERE id = ${allocation.source_id} AND remaining_amount::numeric >= ${value}
          AND EXISTS (SELECT 1 FROM customers c WHERE c.id = ${allocation.customer_id}
            AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(service_orders.phone, ''), '[^0-9]', '', 'g'))
        RETURNING id
      `);
    } else if (allocation.source_type === "graduation_order") {
      updated = await tx.execute(sql`
        UPDATE graduation_orders SET paid_amount = paid_amount::numeric + ${value},
          remaining_amount = greatest(total_amount::numeric - paid_amount::numeric - ${value}, 0),
          payment_status = CASE WHEN total_amount::numeric - paid_amount::numeric - ${value} <= 0 THEN 'paid' ELSE 'partial' END,
          updated_at = now()
        WHERE id = ${allocation.source_id} AND customer_id = ${allocation.customer_id}
          AND remaining_amount::numeric >= ${value} RETURNING id
      `);
    } else {
      throw new Error("نوع توزيع سند القبض غير مدعوم.");
    }
    if (!(updated.rows ?? []).length)
      throw new Error("لا يمكن توزيع المبلغ لأن الرصيد المتبقي تغيّر أو أن السجل لا يتبع للعميل.");
  }
  await tx.execute(sql`UPDATE receipt_voucher_allocations SET posted_at = now() WHERE receipt_voucher_id = ${voucherId} AND posted_at IS NULL`);
  return allocations;
}

export async function approveAndExecuteFinancialTransaction(
  id: number,
  actor: FinancialActor,
  note?: string | null,
) {
  await ensureMasterCashBoxTables();
  if (!canApproveFinancialTransactions(actor))
    throw new Error("اعتماد المعاملات متاح للمدير فقط");

  const result = await db.transaction(async (tx) => {
    const [transaction] = await tx
      .select()
      .from(financialTransactionsTable)
      .where(eq(financialTransactionsTable.id, id))
      .limit(1);
    if (!transaction) throw new Error("المعاملة غير موجودة");
    if (transaction.approvalStatus === "executed") return transaction;
    if (transaction.approvalStatus !== "pending")
      throw new Error("يجب إرسال المعاملة للموافقة أولاً");

    const locked = await tx.execute(
      sql`SELECT * FROM master_cash_box WHERE code = 'MASTER' FOR UPDATE`,
    );
    const cashRaw = (locked.rows?.[0] ?? {}) as any;
    if (!cashRaw.id) throw new Error("الصندوق الرئيسي غير مهيأ");
    const amount = money(transaction.amount);
    const before = money(cashRaw.current_balance);
    const after = money(
      transaction.direction === "revenue" ? before + amount : before - amount,
    );
    if (transaction.direction === "expense" && after < 0)
      throw new Error("رصيد الصندوق غير كافٍ لتنفيذ المصروف");

    const [cashAccount] = await tx
      .select()
      .from(financialAccountsTable)
      .where(eq(financialAccountsTable.code, "1000"))
      .limit(1);
    const counterCode = counterAccountCode(
      transaction.direction as "revenue" | "expense",
      transaction.department,
      transaction.transactionType,
    );
    const [counterAccount] = await tx
      .select()
      .from(financialAccountsTable)
      .where(eq(financialAccountsTable.code, counterCode))
      .limit(1);
    if (!cashAccount || !counterAccount)
      throw new Error("دليل الحسابات غير مكتمل");

    const now = new Date();
    const [saved] = await tx
      .update(financialTransactionsTable)
      .set({
        approvalStatus: "executed",
        approvedBy: actor.id,
        approvedByName: actor.name,
        approvedAt: now,
        executedBy: actor.id,
        executedByName: actor.name,
        executedAt: now,
        balanceBefore: String(before),
        balanceAfter: String(after),
        notes: note?.trim()
          ? [transaction.notes, note.trim()].filter(Boolean).join("\n")
          : transaction.notes,
        updatedAt: now,
      })
      .where(
        and(
          eq(financialTransactionsTable.id, id),
          eq(financialTransactionsTable.approvalStatus, "pending"),
        ),
      )
      .returning();
    if (!saved) {
      const [current] = await tx
        .select()
        .from(financialTransactionsTable)
        .where(eq(financialTransactionsTable.id, id))
        .limit(1);
      if (current?.approvalStatus === "executed") return current;
      throw new Error("تغيّرت حالة المعاملة، أعد المحاولة");
    }

    await tx
      .insert(financialLedgerEntriesTable)
      .values(
        transaction.direction === "revenue"
          ? [
              {
                transactionId: id,
                accountId: cashAccount.id,
                entrySide: "debit",
                amount: String(amount),
                description: transaction.description,
              },
              {
                transactionId: id,
                accountId: counterAccount.id,
                entrySide: "credit",
                amount: String(amount),
                description: transaction.description,
              },
            ]
          : [
              {
                transactionId: id,
                accountId: counterAccount.id,
                entrySide: "debit",
                amount: String(amount),
                description: transaction.description,
              },
              {
                transactionId: id,
                accountId: cashAccount.id,
                entrySide: "credit",
                amount: String(amount),
                description: transaction.description,
              },
            ],
      )
      .onConflictDoNothing();

    const isReversal = transaction.transactionType.endsWith("_reversal");
    // An employee advance and its repayment move value between cash and a
    // receivable asset. They must not inflate operating revenue/expenses.
    const isBalanceSheetTransfer = [
      "employee_advance",
      "employee_advance_repayment",
    ].includes(transaction.transactionType);
    const nextRevenue = money(
      Math.max(
        0,
        money(cashRaw.total_revenue) +
          (transaction.direction === "revenue" && !isReversal && !isBalanceSheetTransfer ? amount : 0) -
          (transaction.direction === "expense" && isReversal ? amount : 0),
      ),
    );
    const nextExpenses = money(
      Math.max(
        0,
        money(cashRaw.total_expenses) +
          (transaction.direction === "expense" && !isReversal && !isBalanceSheetTransfer ? amount : 0) -
          (transaction.direction === "revenue" && isReversal ? amount : 0),
      ),
    );
    await tx
      .update(masterCashBoxTable)
      .set({
        currentBalance: String(after),
        availableBalance: String(after),
        totalRevenue: String(nextRevenue),
        totalExpenses: String(nextExpenses),
        netProfit: String(money(nextRevenue - nextExpenses)),
        version: Number(cashRaw.version ?? 0) + 1,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(eq(masterCashBoxTable.id, Number(cashRaw.id)));

    const sourceId = Number(transaction.sourceId);
    let receiptAllocations: any[] = [];
    if (Number.isInteger(sourceId) && sourceId > 0) {
      if (transaction.sourceType === "expense") {
        await tx.execute(
          sql`UPDATE expenses SET approval_status = 'executed', updated_at = now() WHERE id = ${sourceId} AND financial_transaction_id = ${id}`,
        );
      } else if (transaction.sourceType === "receipt_voucher") {
        await tx.execute(
          sql`UPDATE receipt_vouchers SET approval_status = 'executed' WHERE id = ${sourceId} AND financial_transaction_id = ${id}`,
        );
        receiptAllocations = await postReceiptVoucherAllocations(tx, sourceId, amount);
      } else if (transaction.sourceType === "payment_voucher") {
        await tx.execute(
          sql`UPDATE payment_vouchers SET approval_status = 'executed' WHERE id = ${sourceId} AND financial_transaction_id = ${id}`,
        );
      }
    }

    await tx.insert(financialAuditLogsTable).values([
      {
        transactionId: id,
        action: "approved",
        actorId: actor.id,
        actorName: actor.name,
        oldValues: { approvalStatus: transaction.approvalStatus },
        newValues: { approvalStatus: "approved" },
        reason: note?.trim() || null,
      },
      {
        transactionId: id,
        action: "executed",
        actorId: actor.id,
        actorName: actor.name,
        oldValues: { balance: before },
        newValues: { balance: after, debit: amount, credit: amount },
        reason: note?.trim() || null,
      },
      ...(receiptAllocations.length ? [{
        transactionId: id,
        action: "receipt_allocations_posted",
        actorId: actor.id,
        actorName: actor.name,
        oldValues: {},
        newValues: { voucherId: sourceId, allocations: receiptAllocations.map((row) => ({ sourceType: row.source_type, sourceId: row.source_id, amount: money(row.amount) })) },
        reason: null,
      }] : []),
    ]);
    return saved;
  });
  return result;
}

export async function rejectFinancialTransaction(
  id: number,
  actor: FinancialActor,
  reason: string,
) {
  await ensureMasterCashBoxTables();
  if (!canApproveFinancialTransactions(actor))
    throw new Error("رفض المعاملات متاح للمدير فقط");
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw new Error("سبب الرفض مطلوب");
  const existing = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.id, id),
  });
  if (!existing) throw new Error("المعاملة غير موجودة");
  if (existing.approvalStatus !== "pending")
    throw new Error("يمكن رفض المعاملات المعلّقة فقط");
  const [saved] = await db
    .update(financialTransactionsTable)
    .set({
      approvalStatus: "rejected",
      rejectedBy: actor.id,
      rejectedByName: actor.name,
      rejectedAt: new Date(),
      rejectionReason: cleanReason,
      updatedAt: new Date(),
    })
    .where(eq(financialTransactionsTable.id, id))
    .returning();
  const sourceId = Number(existing.sourceId);
  if (Number.isInteger(sourceId) && sourceId > 0) {
    if (existing.sourceType === "expense") {
      await db.execute(
        sql`UPDATE expenses SET approval_status = 'rejected', updated_at = now() WHERE id = ${sourceId} AND financial_transaction_id = ${id}`,
      );
    } else if (existing.sourceType === "receipt_voucher") {
      await db.execute(
        sql`UPDATE receipt_vouchers SET approval_status = 'rejected' WHERE id = ${sourceId} AND financial_transaction_id = ${id}`,
      );
    } else if (existing.sourceType === "payment_voucher") {
      await db.execute(
        sql`UPDATE payment_vouchers SET approval_status = 'rejected' WHERE id = ${sourceId} AND financial_transaction_id = ${id}`,
      );
    }
  }
  await addAudit(
    id,
    "rejected",
    actor,
    snapshot(existing as any),
    snapshot(saved as any),
    cleanReason,
  );
  return saved;
}

/**
 * Reverse (void) an executed transaction by creating an opposite adjustment entry.
 * Never deletes. Net effect = 0. Admin/Manager only. Cannot reverse twice.
 */
export async function reverseFinancialTransaction(
  id: number,
  actor: FinancialActor,
  reason: string,
  withinTransaction?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    result: { original: typeof financialTransactionsTable.$inferSelect; reverse: typeof financialTransactionsTable.$inferSelect },
  ) => Promise<void>,
  existingTransaction?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  options?: {
    amount?: number;
    idempotencyKey?: string;
    sourceType?: string;
    sourceId?: string | number;
    sourceEvent?: string;
    description?: string;
  },
) {
  if (!existingTransaction) await ensureMasterCashBoxTables();
  if (!canApproveFinancialTransactions(actor))
    throw new Error("عكس الحركة المالية متاح للمدير فقط");
  const cleanReason = String(reason ?? "").trim();
  if (cleanReason.length < 3) throw new Error("سبب العكس مطلوب");

  const reverseInsideTransaction = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const [original] = await tx
      .select()
      .from(financialTransactionsTable)
      .where(eq(financialTransactionsTable.id, id))
      .limit(1);
    if (!original) throw new Error("المعاملة غير موجودة");
    if (original.approvalStatus !== "executed")
      throw new Error("يمكن عكس الحركات المنفّذة فقط");
    if (original.transactionType.endsWith("_reversal"))
      throw new Error("لا يمكن عكس حركة عكسية");
    if (options?.idempotencyKey) {
      const [existingReverse] = await tx
        .select()
        .from(financialTransactionsTable)
        .where(eq(financialTransactionsTable.idempotencyKey, options.idempotencyKey))
        .limit(1);
      if (existingReverse)
        return { original, reverse: existingReverse, alreadyReversed: true };
    }
    if (original.reversedAt || original.reversalTxnId)
      throw new Error("تم عكس هذه الحركة مسبقًا");

    const [priorReversal] = await tx
      .select({
        amount: sql<number>`coalesce(sum(${financialTransactionsTable.amount}::numeric), 0)::float`,
      })
      .from(financialTransactionsTable)
      .where(
        and(
          eq(financialTransactionsTable.reversedTransactionId, original.id),
          eq(financialTransactionsTable.approvalStatus, "executed"),
        ),
      );
    const originalAmount = money(original.amount);
    const alreadyReversedAmount = money(priorReversal?.amount);
    const remainingReversible = money(Math.max(originalAmount - alreadyReversedAmount, 0));
    const requestedAmount = options?.amount == null ? originalAmount : money(options.amount);
    if (requestedAmount <= 0 || requestedAmount - remainingReversible > 0.005)
      throw new Error("مبلغ العكس يتجاوز المبلغ المتبقي القابل للعكس");

    const lock = await tx.execute(
      sql`SELECT * FROM master_cash_box WHERE code = 'MASTER' FOR UPDATE`,
    );
    const cashRaw = (lock.rows?.[0] ?? {}) as any;
    if (!cashRaw.id) throw new Error("الصندوق الرئيسي غير مهيأ");

    const reverseDir: "revenue" | "expense" =
      original.direction === "revenue" ? "expense" : "revenue";
    const amount = requestedAmount;
    const completesOriginal = alreadyReversedAmount + amount >= originalAmount - 0.005;
    const before = money(cashRaw.current_balance);
    const after = money(
      reverseDir === "revenue" ? before + amount : before - amount,
    );
    const now = new Date();

    const originalLedgerEntries = await tx
      .select()
      .from(financialLedgerEntriesTable)
      .where(eq(financialLedgerEntriesTable.transactionId, original.id));

    const [cashAccount] = await tx
      .select()
      .from(financialAccountsTable)
      .where(eq(financialAccountsTable.code, "1000"))
      .limit(1);
    const counterCode = counterAccountCode(
      reverseDir,
      original.department,
      original.transactionType,
    );
    const [counterAccount] = await tx
      .select()
      .from(financialAccountsTable)
      .where(eq(financialAccountsTable.code, counterCode))
      .limit(1);
    if (!cashAccount || !counterAccount)
      throw new Error("دليل الحسابات غير مكتمل");

    // 1) Create the reverse (adjustment) entry — executed immediately.
    const [insertedRaw] = await tx
      .insert(financialTransactionsTable)
      .values({
        transactionNo: `FIN-TMP-${randomUUID()}`,
        transactionDate: todayBaghdad(),
        direction: reverseDir,
        amount: String(amount),
        department: original.department,
        transactionType: "manual_reversal",
        description:
          options?.description ??
          `عكس الحركة ${original.transactionNo}: ${cleanReason}`,
        paymentMethod: original.paymentMethod,
        sourceType: options?.sourceType ?? original.sourceType,
        sourceId: options?.sourceId == null ? original.sourceId : String(options.sourceId),
        sourceEvent: options?.sourceEvent ?? "reversal",
        idempotencyKey: options?.idempotencyKey ?? `reversal:${original.id}`,
        approvalStatus: "executed",
        requestedBy: actor.id,
        requestedByName: actor.name,
        approvedBy: actor.id,
        approvedByName: actor.name,
        approvedAt: now,
        executedBy: actor.id,
        executedByName: actor.name,
        executedAt: now,
        balanceBefore: String(before),
        balanceAfter: String(after),
        reversedTransactionId: original.id,
        reversalReason: cleanReason,
        reversedBy: actor.id,
        reversedByName: actor.name,
        reversedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [reverse] = await tx
      .update(financialTransactionsTable)
      .set({ transactionNo: transactionNumber(insertedRaw.id, now) })
      .where(eq(financialTransactionsTable.id, insertedRaw.id))
      .returning();

    // 2) Double-entry ledger (flipped sides).
    await tx
      .insert(financialLedgerEntriesTable)
      .values(
        originalLedgerEntries.length
          ? originalLedgerEntries.map((entry) => ({
              transactionId: reverse.id,
              accountId: entry.accountId,
              entrySide: entry.entrySide === "debit" ? "credit" : "debit",
              amount: String(
                money(
                  money(entry.amount) *
                    (originalAmount > 0 ? amount / originalAmount : 1),
                ),
              ),
              description: reverse.description,
            }))
          : reverseDir === "revenue"
          ? [
              {
                transactionId: reverse.id,
                accountId: cashAccount.id,
                entrySide: "debit",
                amount: String(amount),
                description: reverse.description,
              },
              {
                transactionId: reverse.id,
                accountId: counterAccount.id,
                entrySide: "credit",
                amount: String(amount),
                description: reverse.description,
              },
            ]
          : [
              {
                transactionId: reverse.id,
                accountId: counterAccount.id,
                entrySide: "debit",
                amount: String(amount),
                description: reverse.description,
              },
              {
                transactionId: reverse.id,
                accountId: cashAccount.id,
                entrySide: "credit",
                amount: String(amount),
                description: reverse.description,
              },
            ],
      )
      .onConflictDoNothing();

    // 3) Flag the original only after all allocated portions have been reversed.
    if (completesOriginal) {
      await tx
        .update(financialTransactionsTable)
        .set({
          reversalTxnId: reverse.id,
          reversalReason: cleanReason,
          reversedBy: actor.id,
          reversedByName: actor.name,
          reversedAt: now,
          updatedAt: now,
        })
        .where(eq(financialTransactionsTable.id, original.id));
    }

    // 4) Recompute master balance from executed entries (_reversal nets to zero).
    const [tot] = await tx
      .select({
        revenue: sql<number>`coalesce(sum(case
        when ${financialTransactionsTable.approvalStatus}='executed' and ${financialTransactionsTable.direction}='revenue' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric
        when ${financialTransactionsTable.approvalStatus}='executed' and ${financialTransactionsTable.direction}='expense' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric
        else 0 end),0)::float`,
        expenses: sql<number>`coalesce(sum(case
        when ${financialTransactionsTable.approvalStatus}='executed' and ${financialTransactionsTable.direction}='expense' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric
        when ${financialTransactionsTable.approvalStatus}='executed' and ${financialTransactionsTable.direction}='revenue' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric
        else 0 end),0)::float`,
      })
      .from(financialTransactionsTable);
    const revenue = money(tot?.revenue);
    const expenses = money(tot?.expenses);
    const current = money(money(cashRaw.opening_balance) + revenue - expenses);
    await tx
      .update(masterCashBoxTable)
      .set({
        currentBalance: String(current),
        availableBalance: String(current),
        totalRevenue: String(revenue),
        totalExpenses: String(expenses),
        netProfit: String(money(revenue - expenses)),
        version: Number(cashRaw.version ?? 0) + 1,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(eq(masterCashBoxTable.id, Number(cashRaw.id)));

    // 5) Flag the linked source (order / service order / sales invoice / kosha) — never deleted, excluded from net.
    const sid = Number(original.sourceId);
    let sourceFlagged: { type: string; id: number } | null = null;
    if (completesOriginal && Number.isInteger(sid) && sid > 0) {
      if (original.sourceType === "kosha_booking") {
        await tx.execute(
          sql`UPDATE kosha_bookings SET booking_details = jsonb_set(coalesce(booking_details, '{}'::jsonb), '{financiallyReversed}', 'true'::jsonb, true), updated_at = now() WHERE id = ${sid}`,
        );
        sourceFlagged = { type: "kosha_booking", id: sid };
      } else if (original.sourceType === "order") {
        await tx.execute(
          sql`UPDATE orders SET financially_reversed = true, updated_at = now() WHERE id = ${sid}`,
        );
        sourceFlagged = { type: "order", id: sid };
      } else if (original.sourceType === "service_order") {
        await tx.execute(
          sql`UPDATE service_orders SET financially_reversed = true WHERE id = ${sid}`,
        );
        sourceFlagged = { type: "service_order", id: sid };
      } else if (original.sourceType === "sales_invoice") {
        await tx.execute(
          sql`UPDATE sales_invoices SET financially_reversed = true WHERE id = ${sid}`,
        );
        sourceFlagged = { type: "sales_invoice", id: sid };
      } else if (original.sourceType === "photography_order") {
        // Restore the photography order so it can be cancelled once its collection is reversed:
        // mark the linked approved payment request as reversed, then recompute paid/remaining from
        // whatever approved requests remain. Without this the order keeps paid_amount > 0 forever
        // and "إلغاء الطلب" stays blocked even after the manager reverses the cash entry.
        await tx.execute(
          sql`UPDATE photography_payment_requests SET status = 'reversed', reviewed_at = now() WHERE financial_transaction_id = ${original.id} AND status = 'approved'`,
        );
        await tx.execute(sql`
          UPDATE photography_orders o SET
            paid_amount = sub.paid,
            remaining_amount = GREATEST(o.total_amount::numeric - sub.paid, 0),
            payment_status = CASE WHEN sub.paid <= 0 THEN 'unpaid' WHEN sub.paid >= o.total_amount::numeric THEN 'paid' ELSE 'partial' END,
            updated_at = now()
          FROM (SELECT COALESCE(SUM(amount::numeric), 0) AS paid FROM photography_payment_requests WHERE order_id = ${sid} AND status = 'approved') sub
          WHERE o.id = ${sid}`);
        sourceFlagged = { type: "photography_order", id: sid };
      }
    }

    // 6) Audit on both records (+ a dedicated entry for the flagged source).
    const auditRows: Array<typeof financialAuditLogsTable.$inferInsert> = [
      {
        transactionId: original.id,
        action: completesOriginal ? "reversed" : "partially_reversed",
        actorId: actor.id,
        actorName: actor.name,
        oldValues: snapshot(original as any),
        newValues: {
          reversalTxnId: completesOriginal ? reverse.id : null,
          reversedAt: now.toISOString(),
          reversedAmount: amount,
          totalReversedAmount: money(alreadyReversedAmount + amount),
          partial: !completesOriginal,
          sourceFlagged,
        },
        reason: cleanReason,
      },
      {
        transactionId: reverse.id,
        action: "reversal_created",
        actorId: actor.id,
        actorName: actor.name,
        oldValues: { reversedTransactionId: original.id },
        newValues: snapshot(reverse as any),
        reason: cleanReason,
      },
    ];
    if (sourceFlagged) {
      auditRows.push({
        transactionId: original.id,
        action: "source_financially_reversed",
        actorId: actor.id,
        actorName: actor.name,
        oldValues: {},
        newValues: { source: sourceFlagged },
        reason: cleanReason,
      });
    }
    await tx.insert(financialAuditLogsTable).values(auditRows);

    if (withinTransaction) await withinTransaction(tx, { original, reverse });
    return { original, reverse };
  };
  return existingTransaction
    ? reverseInsideTransaction(existingTransaction)
    : db.transaction(reverseInsideTransaction);
}

export async function listFinancialTransactions(input: unknown) {
  await ensureMasterCashBoxTables();
  const filters = financialTransactionListSchema.parse(input);
  const conditions: any[] = [];
  if (filters.from)
    conditions.push(
      gte(financialTransactionsTable.transactionDate, filters.from),
    );
  if (filters.to)
    conditions.push(
      lte(financialTransactionsTable.transactionDate, filters.to),
    );
  if (filters.status)
    conditions.push(
      eq(financialTransactionsTable.approvalStatus, filters.status),
    );
  if (filters.direction)
    conditions.push(
      eq(financialTransactionsTable.direction, filters.direction),
    );
  if (filters.department)
    conditions.push(
      eq(financialTransactionsTable.department, filters.department),
    );
  if (filters.voucherType)
    conditions.push(
      eq(financialTransactionsTable.transactionType, filters.voucherType),
    );
  if (filters.search) {
    const value = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(financialTransactionsTable.transactionNo, value),
        ilike(financialTransactionsTable.description, value),
        ilike(financialTransactionsTable.customerName, value),
        ilike(financialTransactionsTable.referenceNo, value),
        ilike(financialTransactionsTable.sourceId, value),
      ),
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (filters.page - 1) * filters.limit;
  const [rows, countRows, totals] = await Promise.all([
    db
      .select()
      .from(financialTransactionsTable)
      .where(where)
      .orderBy(
        desc(financialTransactionsTable.transactionDate),
        desc(financialTransactionsTable.id),
      )
      .limit(filters.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(financialTransactionsTable)
      .where(where),
    db
      .select({
        revenue: sql<number>`coalesce(sum(case when ${financialTransactionsTable.direction} = 'revenue' and ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric when ${financialTransactionsTable.direction} = 'expense' and ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
        expenses: sql<number>`coalesce(sum(case when ${financialTransactionsTable.direction} = 'expense' and ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric when ${financialTransactionsTable.direction} = 'revenue' and ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
        pending: sql<number>`coalesce(sum(case when ${financialTransactionsTable.approvalStatus} = 'pending' then ${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
      })
      .from(financialTransactionsTable)
      .where(where),
  ]);
  return {
    data: rows,
    page: filters.page,
    limit: filters.limit,
    total: countRows[0]?.count ?? 0,
    totals: {
      revenue: money(totals[0]?.revenue),
      expenses: money(totals[0]?.expenses),
      net: money(money(totals[0]?.revenue) - money(totals[0]?.expenses)),
      pending: money(totals[0]?.pending),
    },
  };
}

export async function getFinancialTransaction(id: number) {
  await ensureMasterCashBoxTables();
  const transaction = await db.query.financialTransactionsTable.findFirst({
    where: eq(financialTransactionsTable.id, id),
  });
  if (!transaction) return null;
  const [entries, audits] = await Promise.all([
    db
      .select({
        id: financialLedgerEntriesTable.id,
        side: financialLedgerEntriesTable.entrySide,
        amount: financialLedgerEntriesTable.amount,
        description: financialLedgerEntriesTable.description,
        accountCode: financialAccountsTable.code,
        accountName: financialAccountsTable.nameAr,
      })
      .from(financialLedgerEntriesTable)
      .innerJoin(
        financialAccountsTable,
        eq(financialLedgerEntriesTable.accountId, financialAccountsTable.id),
      )
      .where(eq(financialLedgerEntriesTable.transactionId, id))
      .orderBy(asc(financialLedgerEntriesTable.id)),
    db
      .select()
      .from(financialAuditLogsTable)
      .where(eq(financialAuditLogsTable.transactionId, id))
      .orderBy(desc(financialAuditLogsTable.createdAt)),
  ]);
  return { ...transaction, entries, audits };
}

export async function recalculateMasterCashBox(actor?: FinancialActor) {
  await ensureMasterCashBoxTables();
  const [totals] = await db
    .select({
      revenue: sql<number>`coalesce(sum(case
      when ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.direction} = 'revenue' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric
      when ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.direction} = 'expense' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric
      else 0 end),0)::float`,
      expenses: sql<number>`coalesce(sum(case
      when ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.direction} = 'expense' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric
      when ${financialTransactionsTable.approvalStatus} = 'executed' and ${financialTransactionsTable.direction} = 'revenue' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric
      else 0 end),0)::float`,
    })
    .from(financialTransactionsTable);
  const [cashBox] = await db
    .select()
    .from(masterCashBoxTable)
    .where(eq(masterCashBoxTable.code, "MASTER"))
    .limit(1);
  if (!cashBox) throw new Error("الصندوق الرئيسي غير مهيأ");
  const revenue = money(totals?.revenue);
  const expenses = money(totals?.expenses);
  const current = money(cashBox.openingBalance) + revenue - expenses;
  const [saved] = await db
    .update(masterCashBoxTable)
    .set({
      currentBalance: String(current),
      availableBalance: String(current),
      totalRevenue: String(revenue),
      totalExpenses: String(expenses),
      netProfit: String(money(revenue - expenses)),
      updatedBy: actor?.id ?? null,
      updatedByName: actor?.name ?? "النظام",
      updatedAt: new Date(),
    })
    .where(eq(masterCashBoxTable.id, cashBox.id))
    .returning();
  return saved;
}

export async function getMasterCashDashboard() {
  await ensureMasterCashBoxTables();
  const today = todayBaghdad();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [cashBox] = await db
    .select()
    .from(masterCashBoxTable)
    .where(eq(masterCashBoxTable.code, "MASTER"))
    .limit(1);
  if (!cashBox) throw new Error("الصندوق الرئيسي غير مهيأ");
  const [
    todayTotals,
    pending,
    outstanding,
    overdue,
    damage,
    departmentRows,
    trendRows,
  ] = await Promise.all([
    db
      .select({
        revenue: sql<number>`coalesce(sum(case when ${financialTransactionsTable.direction}='revenue' then ${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
        expenses: sql<number>`coalesce(sum(case when ${financialTransactionsTable.direction}='expense' then ${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
      })
      .from(financialTransactionsTable)
      .where(
        and(
          eq(financialTransactionsTable.approvalStatus, "executed"),
          eq(financialTransactionsTable.transactionDate, today),
        ),
      ),
    db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${financialTransactionsTable.amount}::numeric),0)::float`,
      })
      .from(financialTransactionsTable)
      .where(eq(financialTransactionsTable.approvalStatus, "pending")),
    db.execute(sql`
      SELECT COALESCE(SUM(remaining),0)::float AS total FROM (
        SELECT remaining_amount::numeric AS remaining FROM orders WHERE archived_at IS NULL AND status <> 'cancelled' AND remaining_amount::numeric > 0
        UNION ALL SELECT remaining_amount::numeric FROM service_orders WHERE archived_at IS NULL AND status <> 'cancelled' AND remaining_amount::numeric > 0
        UNION ALL SELECT remaining_amount::numeric FROM sales_invoices WHERE status = 'active' AND remaining_amount::numeric > 0
        UNION ALL SELECT remaining_amount::numeric FROM kosha_bookings WHERE status <> 'cancelled' AND remaining_amount::numeric > 0
      ) balances
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(remaining),0)::float AS total FROM (
        SELECT remaining_amount::numeric AS remaining FROM orders WHERE archived_at IS NULL AND status <> 'cancelled' AND due_date < ${today} AND remaining_amount::numeric > 0
        UNION ALL SELECT remaining_amount::numeric FROM service_orders WHERE archived_at IS NULL AND status <> 'cancelled' AND due_date < ${today} AND remaining_amount::numeric > 0
        UNION ALL SELECT remaining_amount::numeric FROM sales_invoices WHERE status = 'active' AND due_date < ${today} AND remaining_amount::numeric > 0
        UNION ALL SELECT remaining_amount::numeric FROM kosha_bookings WHERE status <> 'cancelled' AND due_date < ${today} AND remaining_amount::numeric > 0
      ) balances
    `),
    db
      .select({
        total: sql<number>`coalesce(sum(${financialTransactionsTable.amount}::numeric),0)::float`,
      })
      .from(financialTransactionsTable)
      .where(
        and(
          eq(financialTransactionsTable.approvalStatus, "executed"),
          eq(financialTransactionsTable.transactionType, "damage_loss"),
          gte(financialTransactionsTable.transactionDate, monthStart),
        ),
      ),
    db
      .select({
        department: financialTransactionsTable.department,
        revenue: sql<number>`coalesce(sum(case when ${financialTransactionsTable.direction}='revenue' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric when ${financialTransactionsTable.direction}='expense' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
        expenses: sql<number>`coalesce(sum(case when ${financialTransactionsTable.direction}='expense' and ${financialTransactionsTable.transactionType} not like '%_reversal' then ${financialTransactionsTable.amount}::numeric when ${financialTransactionsTable.direction}='revenue' and ${financialTransactionsTable.transactionType} like '%_reversal' then -${financialTransactionsTable.amount}::numeric else 0 end),0)::float`,
      })
      .from(financialTransactionsTable)
      .where(
        and(
          eq(financialTransactionsTable.approvalStatus, "executed"),
          gte(financialTransactionsTable.transactionDate, monthStart),
        ),
      )
      .groupBy(financialTransactionsTable.department),
    db.execute(sql`
      SELECT to_char(transaction_date, 'YYYY-MM') AS month,
        COALESCE(SUM(CASE WHEN direction='revenue' AND transaction_type NOT LIKE '%_reversal' THEN amount::numeric WHEN direction='expense' AND transaction_type LIKE '%_reversal' THEN -amount::numeric ELSE 0 END),0)::float AS revenue,
        COALESCE(SUM(CASE WHEN direction='expense' AND transaction_type NOT LIKE '%_reversal' THEN amount::numeric WHEN direction='revenue' AND transaction_type LIKE '%_reversal' THEN -amount::numeric ELSE 0 END),0)::float AS expenses
      FROM financial_transactions
      WHERE approval_status='executed' AND transaction_date >= (${today}::date - interval '11 months')
      GROUP BY to_char(transaction_date, 'YYYY-MM') ORDER BY month
    `),
  ]);

  const todayRevenue = money(todayTotals[0]?.revenue);
  const todayExpenses = money(todayTotals[0]?.expenses);
  return {
    cashBox: {
      ...cashBox,
      openingBalance: money(cashBox.openingBalance),
      currentBalance: money(cashBox.currentBalance),
      totalRevenue: money(cashBox.totalRevenue),
      totalExpenses: money(cashBox.totalExpenses),
      netProfit: money(cashBox.netProfit),
      availableBalance: money(cashBox.availableBalance),
    },
    today: {
      revenue: todayRevenue,
      expenses: todayExpenses,
      net: money(todayRevenue - todayExpenses),
    },
    pending: {
      count: pending[0]?.count ?? 0,
      amount: money(pending[0]?.amount),
    },
    outstanding: money((outstanding.rows?.[0] as any)?.total),
    overdue: money((overdue.rows?.[0] as any)?.total),
    damageLosses: money(damage[0]?.total),
    departments: departmentRows
      .map((row) => ({
        department: row.department,
        revenue: money(row.revenue),
        expenses: money(row.expenses),
        profit: money(row.revenue - row.expenses),
      }))
      .sort((a, b) => b.profit - a.profit),
    trend: ((trendRows.rows ?? []) as any[]).map((row) => ({
      month: row.month,
      revenue: money(row.revenue),
      expenses: money(row.expenses),
    })),
  };
}

export async function createSourceFinancialRequest(
  input: Omit<
    z.input<typeof financialTransactionInputSchema>,
    "approvalStatus" | "idempotencyKey"
  > & { idempotencyKey: string },
  actor: FinancialActor,
) {
  return createFinancialTransaction(
    { ...input, approvalStatus: "pending" },
    actor,
  );
}

export async function syncSourcePaymentTarget(
  input: {
    sourceType: string;
    sourceId: string | number;
    sourceEvent?: string;
    targetAmount: number;
    normalDirection: "revenue" | "expense";
    transactionDate?: string;
    department: string;
    transactionType: string;
    description: string;
    paymentMethod?: "cash" | "transfer" | "card" | "pos" | "other";
    customerId?: number | null;
    customerName?: string | null;
    customerPhone?: string | null;
    dueDate?: string | null;
    notes?: string | null;
    attachments?: string[];
  },
  actor: FinancialActor,
) {
  await ensureMasterCashBoxTables();
  const sourceId = String(input.sourceId);
  const sourceEvent = input.sourceEvent ?? "payment";
  const rows = await db
    .select()
    .from(financialTransactionsTable)
    .where(
      and(
        eq(financialTransactionsTable.sourceType, input.sourceType),
        eq(financialTransactionsTable.sourceId, sourceId),
        eq(financialTransactionsTable.sourceEvent, sourceEvent),
      ),
    )
    .orderBy(desc(financialTransactionsTable.id));
  const executedSigned = rows
    .filter((row) => row.approvalStatus === "executed")
    .reduce(
      (sum, row) =>
        sum +
        (row.direction === "revenue" ? money(row.amount) : -money(row.amount)),
      0,
    );
  const desiredSigned =
    money(Math.max(0, input.targetAmount)) *
    (input.normalDirection === "revenue" ? 1 : -1);
  const delta = money(desiredSigned - executedSigned);
  const pending = rows.find((row) =>
    ["draft", "pending", "rejected"].includes(row.approvalStatus),
  );

  if (Math.abs(delta) < 0.005) {
    if (pending)
      await cancelFinancialTransactionRequest(
        pending.id,
        actor,
        "لا يوجد فرق مالي متبقٍ بعد مزامنة المصدر",
      );
    return rows.find((row) => row.approvalStatus === "executed") ?? null;
  }

  const direction: "revenue" | "expense" = delta > 0 ? "revenue" : "expense";
  const payload = {
    transactionDate: input.transactionDate,
    direction,
    amount: Math.abs(delta),
    department: input.department,
    transactionType:
      direction === input.normalDirection
        ? input.transactionType
        : `${input.transactionType}_reversal`,
    description:
      direction === input.normalDirection
        ? input.description
        : `تصحيح: ${input.description}`,
    paymentMethod: input.paymentMethod ?? "cash",
    sourceType: input.sourceType,
    sourceId,
    sourceEvent,
    idempotencyKey: `${input.sourceType}:${sourceId}:${sourceEvent}:v${rows.length + 1}:${direction}:${Math.abs(delta)}`,
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    dueDate: input.dueDate,
    notes: input.notes,
    attachments: input.attachments ?? [],
  };
  if (pending)
    return syncSourceFinancialRequest(
      pending.id,
      payload,
      actor,
      "مزامنة المبلغ المدفوع مع المصدر",
    );
  return createSourceFinancialRequest(payload, actor);
}
