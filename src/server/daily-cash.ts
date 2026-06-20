import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  dailyCashReconciliationsTable,
  dailyCashReportsTable,
  db,
} from "@workspace/db";
import { ensureMasterCashBoxTables } from "@/server/master-cash-box";

export type DailyCashActor = {
  id: number | null;
  name: string;
  /** المدير/الأدمن يستطيع تعديل/إعادة فتح الأيام المقفلة */
  canOverride?: boolean;
};

export type DailyCashReportStatus = "open" | "closed";
export type DailyCashApprovalStatus = "none" | "pending" | "approved";

export type DailyCashStatus = "balanced" | "surplus" | "shortage";

export type DailyCashBreakdown = {
  invoiceSales: number;
  productOrderSales: number;
  serviceOrderSales: number;
  otherRevenue: number;
  invoiceCount: number;
  productOrderCount: number;
  serviceOrderCount: number;
};

export type DailyCashRow = {
  reportDate: string;
  openingBalance: number;
  totalSales: number;
  totalExpenses: number;
  closingBalance: number;
  expectedCashBalance: number;
  actualCashInDrawer: number | null;
  difference: number | null;
  status: DailyCashStatus | "not_reconciled";
  notes: string;
  reconciliationNotes: string;
  createdByName: string;
  updatedByName: string;
  updatedAt: string | null;
  reconciliationUpdatedAt: string | null;
  hasManualOpeningBalance: boolean;
  reportStatus: DailyCashReportStatus;
  closedByName: string;
  closedAt: string | null;
  approvalStatus: DailyCashApprovalStatus;
  approvedByName: string;
  approvalNote: string;
  approvedAt: string | null;
  breakdown: DailyCashBreakdown;
};

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صحيحة");

export const dailyCashListQuerySchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  search: z.string().trim().max(120).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export const upsertDailyCashReportSchema = z.object({
  reportDate: dateStringSchema,
  openingBalance: z.coerce.number().min(0, "رصيد الافتتاح لا يمكن أن يكون سالباً").default(0),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const upsertDailyCashReconciliationSchema = z.object({
  reportDate: dateStringSchema,
  openingBalance: z.coerce.number().min(0, "رصيد الافتتاح لا يمكن أن يكون سالباً").optional(),
  actualCashInDrawer: z.coerce.number().min(0, "النقد الفعلي لا يمكن أن يكون سالباً"),
  notes: z.string().trim().max(1000).optional().nullable(),
});

let dailyCashTablesReady: Promise<void> | null = null;

export async function ensureDailyCashTables() {
  if (!dailyCashTablesReady) {
    dailyCashTablesReady = db.execute(sql`
      CREATE TABLE IF NOT EXISTS "daily_cash_reports" (
        "id" serial PRIMARY KEY,
        "report_date" date NOT NULL,
        "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "total_sales" numeric(14,2) NOT NULL DEFAULT 0,
        "total_expenses" numeric(14,2) NOT NULL DEFAULT 0,
        "closing_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "notes" text,
        "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_reports_report_date_idx"
        ON "daily_cash_reports" ("report_date");
      CREATE INDEX IF NOT EXISTS "daily_cash_reports_created_by_idx"
        ON "daily_cash_reports" ("created_by");
      CREATE INDEX IF NOT EXISTS "daily_cash_reports_updated_at_idx"
        ON "daily_cash_reports" ("updated_at");

      CREATE TABLE IF NOT EXISTS "daily_cash_reconciliations" (
        "id" serial PRIMARY KEY,
        "report_date" date NOT NULL,
        "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "total_sales" numeric(14,2) NOT NULL DEFAULT 0,
        "total_expenses" numeric(14,2) NOT NULL DEFAULT 0,
        "expected_cash_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "actual_cash_in_drawer" numeric(14,2) NOT NULL DEFAULT 0,
        "difference" numeric(14,2) NOT NULL DEFAULT 0,
        "status" varchar(20) NOT NULL DEFAULT 'balanced',
        "notes" text,
        "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_reconciliations_report_date_idx"
        ON "daily_cash_reconciliations" ("report_date");
      CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_status_idx"
        ON "daily_cash_reconciliations" ("status");
      CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_created_by_idx"
        ON "daily_cash_reconciliations" ("created_by");
      CREATE INDEX IF NOT EXISTS "daily_cash_reconciliations_updated_at_idx"
        ON "daily_cash_reconciliations" ("updated_at");

      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'open';
      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_by" integer;
      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_by_name" text NOT NULL DEFAULT '';
      ALTER TABLE "daily_cash_reports" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
      CREATE INDEX IF NOT EXISTS "daily_cash_reports_status_idx" ON "daily_cash_reports" ("status");

      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'none';
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_by" integer;
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_by_name" text NOT NULL DEFAULT '';
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approval_note" text;
      ALTER TABLE "daily_cash_reconciliations" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;

      ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '';
      ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'cash';
      ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "receipt_image" text;
    `).then(() => undefined).catch((err) => {
      dailyCashTablesReady = null;
      throw err;
    });
  }
  await dailyCashTablesReady;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function todayBaghdad(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalizeRange(from?: string, to?: string) {
  const today = todayBaghdad();
  const end = to && dateStringSchema.safeParse(to).success ? to : today;
  const start = from && dateStringSchema.safeParse(from).success ? from : addDays(end, -29);
  const normalizedFrom = start <= end ? start : end;
  const normalizedTo = start <= end ? end : start;
  const maxDays = 370;
  const fromDate = new Date(`${normalizedFrom}T00:00:00.000Z`);
  const toDate = new Date(`${normalizedTo}T00:00:00.000Z`);
  const diff = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
  return {
    from: diff > maxDays ? addDays(normalizedTo, -maxDays) : normalizedFrom,
    to: normalizedTo,
  };
}

function dateRangeDesc(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = to; day >= from; day = addDays(day, -1)) {
    days.push(day);
    if (days.length > 371) break;
  }
  return days;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function reconciliationStatus(difference: number): DailyCashStatus {
  if (Math.abs(difference) < 0.005) return "balanced";
  return difference > 0 ? "surplus" : "shortage";
}

async function aggregateDailyCash(from: string, to: string) {
  await ensureMasterCashBoxTables();
  const [invoiceRows, productOrderRows, serviceOrderRows, otherRevenueRows, expenseRows] = await Promise.all([
    db.execute(sql`
      SELECT day, COALESCE(SUM(total),0)::float AS total, COALESCE(SUM(count),0)::int AS count FROM (
        SELECT date::text AS day, COALESCE(SUM(total::numeric),0) AS total, COUNT(*)::int AS count
        FROM sales_invoices invoice
        WHERE status='active' AND date >= ${from} AND date <= ${to}
          AND NOT EXISTS (SELECT 1 FROM financial_transactions ft WHERE ft.source_type='sales_invoice' AND ft.source_id=invoice.id::text)
        GROUP BY date
        UNION ALL
        SELECT transaction_date::text AS day,
          COALESCE(SUM(CASE WHEN direction='revenue' THEN amount::numeric ELSE -amount::numeric END),0) AS total,
          COUNT(*)::int AS count
        FROM financial_transactions
        WHERE approval_status='executed' AND source_type='sales_invoice' AND transaction_date >= ${from} AND transaction_date <= ${to}
        GROUP BY transaction_date
      ) rows GROUP BY day
    `),
    db.execute(sql`
      SELECT day, COALESCE(SUM(total),0)::float AS total, COALESCE(SUM(count),0)::int AS count FROM (
        SELECT DATE(created_at)::text AS day, COALESCE(SUM(total::numeric - COALESCE(delivery_fee::numeric,0)),0) AS total, COUNT(*)::int AS count
        FROM orders order_row
        WHERE archived_at IS NULL AND status IN ('completed','delivered')
          AND created_at >= ${from}::date AND created_at < (${to}::date + interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM financial_transactions ft WHERE ft.source_type='order' AND ft.source_id=order_row.id::text)
        GROUP BY DATE(created_at)
        UNION ALL
        SELECT transaction_date::text AS day,
          COALESCE(SUM(CASE WHEN direction='revenue' THEN amount::numeric ELSE -amount::numeric END),0) AS total,
          COUNT(*)::int AS count
        FROM financial_transactions
        WHERE approval_status='executed' AND source_type='order' AND transaction_date >= ${from} AND transaction_date <= ${to}
        GROUP BY transaction_date
      ) rows GROUP BY day
    `),
    db.execute(sql`
      SELECT day, COALESCE(SUM(total),0)::float AS total, COALESCE(SUM(count),0)::int AS count FROM (
        SELECT DATE(created_at)::text AS day, COALESCE(SUM(total_amount::numeric),0) AS total, COUNT(*)::int AS count
        FROM service_orders service_row
        WHERE archived_at IS NULL AND status IN ('completed','delivered')
          AND created_at >= ${from}::date AND created_at < (${to}::date + interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM financial_transactions ft WHERE ft.source_type='service_order' AND ft.source_id=service_row.id::text)
        GROUP BY DATE(created_at)
        UNION ALL
        SELECT transaction_date::text AS day,
          COALESCE(SUM(CASE WHEN direction='revenue' THEN amount::numeric ELSE -amount::numeric END),0) AS total,
          COUNT(*)::int AS count
        FROM financial_transactions
        WHERE approval_status='executed' AND source_type IN ('service_order','kosha_booking') AND transaction_date >= ${from} AND transaction_date <= ${to}
        GROUP BY transaction_date
      ) rows GROUP BY day
    `),
    db.execute(sql`
      SELECT transaction_date::text AS day,
        COALESCE(SUM(CASE WHEN direction='revenue' AND transaction_type NOT LIKE '%_reversal' THEN amount::numeric WHEN direction='expense' AND transaction_type LIKE '%_reversal' THEN -amount::numeric ELSE 0 END),0)::float AS total
      FROM financial_transactions
      WHERE approval_status='executed'
        AND COALESCE(source_type,'') NOT IN ('sales_invoice','order','service_order','kosha_booking')
        AND transaction_date >= ${from} AND transaction_date <= ${to}
      GROUP BY transaction_date
    `),
    db.execute(sql`
      SELECT day, COALESCE(SUM(total),0)::float AS total FROM (
        SELECT date::text AS day, COALESCE(SUM(amount::numeric),0) AS total
        FROM expenses
        WHERE date >= ${from} AND date <= ${to} AND deleted_at IS NULL
          AND COALESCE(approval_status,'executed')='executed' AND financial_transaction_id IS NULL
        GROUP BY date
        UNION ALL
        SELECT transaction_date::text AS day,
          COALESCE(SUM(CASE WHEN direction='expense' AND transaction_type NOT LIKE '%_reversal' THEN amount::numeric WHEN direction='revenue' AND transaction_type LIKE '%_reversal' THEN -amount::numeric ELSE 0 END),0) AS total
        FROM financial_transactions
        WHERE approval_status='executed' AND transaction_date >= ${from} AND transaction_date <= ${to}
        GROUP BY transaction_date
      ) rows GROUP BY day
    `),
  ]);

  const map = new Map<string, {
    invoiceSales: number;
    productOrderSales: number;
    serviceOrderSales: number;
    otherRevenue: number;
    totalExpenses: number;
    invoiceCount: number;
    productOrderCount: number;
    serviceOrderCount: number;
  }>();
  const ensure = (day: string) => {
    const existing = map.get(day);
    if (existing) return existing;
    const next = {
      invoiceSales: 0,
      productOrderSales: 0,
      serviceOrderSales: 0,
      otherRevenue: 0,
      totalExpenses: 0,
      invoiceCount: 0,
      productOrderCount: 0,
      serviceOrderCount: 0,
    };
    map.set(day, next);
    return next;
  };
  for (const row of (invoiceRows.rows ?? []) as any[]) {
    const item = ensure(String(row.day));
    item.invoiceSales = toNumber(row.total);
    item.invoiceCount = Number(row.count ?? 0);
  }
  for (const row of (productOrderRows.rows ?? []) as any[]) {
    const item = ensure(String(row.day));
    item.productOrderSales = toNumber(row.total);
    item.productOrderCount = Number(row.count ?? 0);
  }
  for (const row of (serviceOrderRows.rows ?? []) as any[]) {
    const item = ensure(String(row.day));
    item.serviceOrderSales = toNumber(row.total);
    item.serviceOrderCount = Number(row.count ?? 0);
  }
  for (const row of (otherRevenueRows.rows ?? []) as any[]) {
    ensure(String(row.day)).otherRevenue = toNumber(row.total);
  }
  for (const row of (expenseRows.rows ?? []) as any[]) {
    ensure(String(row.day)).totalExpenses = toNumber(row.total);
  }
  return map;
}

function buildCashRow(
  reportDate: string,
  aggregate: Awaited<ReturnType<typeof aggregateDailyCash>>,
  report: any | undefined,
  reconciliation: any | undefined,
): DailyCashRow {
  const day = aggregate.get(reportDate);
  const invoiceSales = money(day?.invoiceSales ?? 0);
  const productOrderSales = money(day?.productOrderSales ?? 0);
  const serviceOrderSales = money(day?.serviceOrderSales ?? 0);
  const otherRevenue = money(day?.otherRevenue ?? 0);
  const totalSales = money(invoiceSales + productOrderSales + serviceOrderSales + otherRevenue);
  const totalExpenses = money(day?.totalExpenses ?? 0);
  const openingBalance = money(toNumber(report?.openingBalance ?? reconciliation?.openingBalance ?? 0));
  const closingBalance = money(openingBalance + totalSales - totalExpenses);
  const actualCashInDrawer = reconciliation ? money(toNumber(reconciliation.actualCashInDrawer)) : null;
  const difference = reconciliation ? money(toNumber(reconciliation.difference)) : null;
  return {
    reportDate,
    openingBalance,
    totalSales,
    totalExpenses,
    closingBalance,
    expectedCashBalance: closingBalance,
    actualCashInDrawer,
    difference,
    status: reconciliation ? (reconciliation.status as DailyCashStatus) : "not_reconciled",
    notes: String(report?.notes ?? ""),
    reconciliationNotes: String(reconciliation?.notes ?? ""),
    createdByName: String(report?.createdByName ?? reconciliation?.createdByName ?? ""),
    updatedByName: String(report?.updatedByName ?? reconciliation?.updatedByName ?? ""),
    updatedAt: report?.updatedAt ? new Date(report.updatedAt).toISOString() : null,
    reconciliationUpdatedAt: reconciliation?.updatedAt ? new Date(reconciliation.updatedAt).toISOString() : null,
    hasManualOpeningBalance: Boolean(report),
    reportStatus: (report?.status === "closed" ? "closed" : "open"),
    closedByName: String(report?.closedByName ?? ""),
    closedAt: report?.closedAt ? new Date(report.closedAt).toISOString() : null,
    approvalStatus: ((reconciliation?.approvalStatus as DailyCashApprovalStatus) ?? "none"),
    approvedByName: String(reconciliation?.approvedByName ?? ""),
    approvalNote: String(reconciliation?.approvalNote ?? ""),
    approvedAt: reconciliation?.approvedAt ? new Date(reconciliation.approvedAt).toISOString() : null,
    breakdown: {
      invoiceSales,
      productOrderSales,
      serviceOrderSales,
      otherRevenue,
      invoiceCount: Number(day?.invoiceCount ?? 0),
      productOrderCount: Number(day?.productOrderCount ?? 0),
      serviceOrderCount: Number(day?.serviceOrderCount ?? 0),
    },
  };
}

export async function listDailyCashRows(input: unknown) {
  await ensureDailyCashTables();
  const parsed = dailyCashListQuerySchema.parse(input);
  const range = normalizeRange(parsed.from, parsed.to);
  const aggregate = await aggregateDailyCash(range.from, range.to);
  const [reports, reconciliations] = await Promise.all([
    db
      .select()
      .from(dailyCashReportsTable)
      .where(and(gte(dailyCashReportsTable.reportDate, range.from), lte(dailyCashReportsTable.reportDate, range.to)))
      .orderBy(desc(dailyCashReportsTable.reportDate)),
    db
      .select()
      .from(dailyCashReconciliationsTable)
      .where(and(gte(dailyCashReconciliationsTable.reportDate, range.from), lte(dailyCashReconciliationsTable.reportDate, range.to)))
      .orderBy(desc(dailyCashReconciliationsTable.reportDate)),
  ]);
  const reportMap = new Map(reports.map((row) => [row.reportDate, row]));
  const reconciliationMap = new Map(reconciliations.map((row) => [row.reportDate, row]));
  let rows = dateRangeDesc(range.from, range.to).map((day) => buildCashRow(day, aggregate, reportMap.get(day), reconciliationMap.get(day)));
  const search = parsed.search.toLowerCase();
  if (search) {
    rows = rows.filter((row) => [
      row.reportDate,
      row.notes,
      row.reconciliationNotes,
      row.createdByName,
      row.updatedByName,
      row.status,
    ].some((value) => String(value ?? "").toLowerCase().includes(search)));
  }
  const total = rows.length;
  const offset = (parsed.page - 1) * parsed.limit;
  const pageRows = rows.slice(offset, offset + parsed.limit);
  const totals = rows.reduce((acc, row) => {
    acc.openingBalance += row.openingBalance;
    acc.totalSales += row.totalSales;
    acc.totalExpenses += row.totalExpenses;
    acc.closingBalance += row.closingBalance;
    acc.actualCashInDrawer += row.actualCashInDrawer ?? 0;
    acc.difference += row.difference ?? 0;
    return acc;
  }, {
    openingBalance: 0,
    totalSales: 0,
    totalExpenses: 0,
    closingBalance: 0,
    actualCashInDrawer: 0,
    difference: 0,
  });
  return {
    data: pageRows,
    chart: rows.slice().reverse().map((row) => ({
      date: row.reportDate,
      sales: row.totalSales,
      expenses: row.totalExpenses,
      closing: row.closingBalance,
      difference: row.difference ?? 0,
    })),
    totals: {
      openingBalance: money(totals.openingBalance),
      totalSales: money(totals.totalSales),
      totalExpenses: money(totals.totalExpenses),
      closingBalance: money(totals.closingBalance),
      actualCashInDrawer: money(totals.actualCashInDrawer),
      difference: money(totals.difference),
    },
    page: parsed.page,
    limit: parsed.limit,
    total,
    from: range.from,
    to: range.to,
  };
}

export async function getDailyCashRow(reportDate: string) {
  await ensureDailyCashTables();
  const parsedDate = dateStringSchema.parse(reportDate);
  const aggregate = await aggregateDailyCash(parsedDate, parsedDate);
  const [report, reconciliation] = await Promise.all([
    db.query.dailyCashReportsTable.findFirst({ where: eq(dailyCashReportsTable.reportDate, parsedDate) }),
    db.query.dailyCashReconciliationsTable.findFirst({ where: eq(dailyCashReconciliationsTable.reportDate, parsedDate) }),
  ]);
  return buildCashRow(parsedDate, aggregate, report, reconciliation);
}

async function assertDayEditable(reportDate: string, actor: DailyCashActor) {
  const report = await db.query.dailyCashReportsTable.findFirst({ where: eq(dailyCashReportsTable.reportDate, reportDate) }) as any;
  if (report?.status === "closed" && !actor.canOverride) {
    throw new Error("هذا اليوم مقفل ولا يمكن تعديله — يتطلب صلاحية مدير لإعادة الفتح");
  }
}

export async function upsertDailyCashReport(input: unknown, actor: DailyCashActor) {
  await ensureDailyCashTables();
  const parsed = upsertDailyCashReportSchema.parse(input);
  await assertDayEditable(parsed.reportDate, actor);
  const aggregate = await aggregateDailyCash(parsed.reportDate, parsed.reportDate);
  const snapshot = buildCashRow(parsed.reportDate, aggregate, { openingBalance: parsed.openingBalance }, undefined);
  const notes = parsed.notes?.trim() || null;
  const now = new Date();
  await db
    .insert(dailyCashReportsTable)
    .values({
      reportDate: parsed.reportDate,
      openingBalance: String(snapshot.openingBalance),
      totalSales: String(snapshot.totalSales),
      totalExpenses: String(snapshot.totalExpenses),
      closingBalance: String(snapshot.closingBalance),
      notes,
      createdBy: actor.id,
      createdByName: actor.name,
      updatedBy: actor.id,
      updatedByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dailyCashReportsTable.reportDate,
      set: {
        openingBalance: String(snapshot.openingBalance),
        totalSales: String(snapshot.totalSales),
        totalExpenses: String(snapshot.totalExpenses),
        closingBalance: String(snapshot.closingBalance),
        notes,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      },
    });
  return getDailyCashRow(parsed.reportDate);
}

export async function upsertDailyCashReconciliation(input: unknown, actor: DailyCashActor) {
  await ensureDailyCashTables();
  const parsed = upsertDailyCashReconciliationSchema.parse(input);
  await assertDayEditable(parsed.reportDate, actor);
  const current = await getDailyCashRow(parsed.reportDate);
  const openingBalance = money(parsed.openingBalance ?? current.openingBalance);
  const expectedCashBalance = money(openingBalance + current.totalSales - current.totalExpenses);
  const actualCashInDrawer = money(parsed.actualCashInDrawer);
  const difference = money(actualCashInDrawer - expectedCashBalance);
  const status = reconciliationStatus(difference);
  const notes = parsed.notes?.trim() || null;
  const now = new Date();

  await db
    .insert(dailyCashReportsTable)
    .values({
      reportDate: parsed.reportDate,
      openingBalance: String(openingBalance),
      totalSales: String(current.totalSales),
      totalExpenses: String(current.totalExpenses),
      closingBalance: String(expectedCashBalance),
      createdBy: actor.id,
      createdByName: actor.name,
      updatedBy: actor.id,
      updatedByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dailyCashReportsTable.reportDate,
      set: {
        openingBalance: String(openingBalance),
        totalSales: String(current.totalSales),
        totalExpenses: String(current.totalExpenses),
        closingBalance: String(expectedCashBalance),
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      },
    });

  await db
    .insert(dailyCashReconciliationsTable)
    .values({
      reportDate: parsed.reportDate,
      openingBalance: String(openingBalance),
      totalSales: String(current.totalSales),
      totalExpenses: String(current.totalExpenses),
      expectedCashBalance: String(expectedCashBalance),
      actualCashInDrawer: String(actualCashInDrawer),
      difference: String(difference),
      status,
      notes,
      createdBy: actor.id,
      createdByName: actor.name,
      updatedBy: actor.id,
      updatedByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dailyCashReconciliationsTable.reportDate,
      set: {
        openingBalance: String(openingBalance),
        totalSales: String(current.totalSales),
        totalExpenses: String(current.totalExpenses),
        expectedCashBalance: String(expectedCashBalance),
        actualCashInDrawer: String(actualCashInDrawer),
        difference: String(difference),
        status,
        notes,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      },
    });

  return getDailyCashRow(parsed.reportDate);
}

export async function getDailyCashDashboardSummary(reportDate = todayBaghdad()) {
  const row = await getDailyCashRow(reportDate);
  return {
    reportDate: row.reportDate,
    totalSales: row.totalSales,
    totalExpenses: row.totalExpenses,
    expectedCashBalance: row.expectedCashBalance,
    actualCashInDrawer: row.actualCashInDrawer,
    difference: row.difference,
    status: row.status,
  };
}

/** الرصيد الافتتاحي المقترَح = رصيد إغلاق اليوم السابق (ترحيل تلقائي). */
export async function suggestOpeningBalance(reportDate: string): Promise<number> {
  await ensureDailyCashTables();
  const parsedDate = dateStringSchema.parse(reportDate);
  const previousRow = await getDailyCashRow(addDays(parsedDate, -1));
  return money(previousRow.closingBalance);
}

/** إقفال نهاية اليوم: يثبّت التقرير ويقفله، ويرحّل رصيد الإغلاق لافتتاح الغد ضمنياً. */
export async function closeDailyCashDay(reportDate: string, actor: DailyCashActor) {
  await ensureDailyCashTables();
  const parsedDate = dateStringSchema.parse(reportDate);
  const current = await getDailyCashRow(parsedDate);
  const openingBalance = current.hasManualOpeningBalance ? current.openingBalance : await suggestOpeningBalance(parsedDate);
  const closingBalance = money(openingBalance + current.totalSales - current.totalExpenses);
  const now = new Date();
  await db
    .insert(dailyCashReportsTable)
    .values({
      reportDate: parsedDate,
      openingBalance: String(openingBalance),
      totalSales: String(current.totalSales),
      totalExpenses: String(current.totalExpenses),
      closingBalance: String(closingBalance),
      status: "closed",
      closedBy: actor.id,
      closedByName: actor.name,
      closedAt: now,
      createdBy: actor.id,
      createdByName: actor.name,
      updatedBy: actor.id,
      updatedByName: actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dailyCashReportsTable.reportDate,
      set: {
        openingBalance: String(openingBalance),
        totalSales: String(current.totalSales),
        totalExpenses: String(current.totalExpenses),
        closingBalance: String(closingBalance),
        status: "closed",
        closedBy: actor.id,
        closedByName: actor.name,
        closedAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      },
    });
  return getDailyCashRow(parsedDate);
}

/** إعادة فتح يوم مقفل (تتطلب صلاحية مدير). */
export async function reopenDailyCashDay(reportDate: string, actor: DailyCashActor) {
  await ensureDailyCashTables();
  if (!actor.canOverride) throw new Error("إعادة فتح اليوم تتطلب صلاحية مدير");
  const parsedDate = dateStringSchema.parse(reportDate);
  const now = new Date();
  await db
    .update(dailyCashReportsTable)
    .set({ status: "open", closedBy: null, closedByName: "", closedAt: null, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
    .where(eq(dailyCashReportsTable.reportDate, parsedDate));
  return getDailyCashRow(parsedDate);
}

/** موافقة المدير على فرق الصندوق. */
export async function approveDailyCashReconciliation(reportDate: string, note: string, actor: DailyCashActor) {
  await ensureDailyCashTables();
  if (!actor.canOverride) throw new Error("اعتماد فرق الصندوق يتطلب صلاحية مدير");
  const parsedDate = dateStringSchema.parse(reportDate);
  const reconciliation = await db.query.dailyCashReconciliationsTable.findFirst({ where: eq(dailyCashReconciliationsTable.reportDate, parsedDate) });
  if (!reconciliation) throw new Error("لا يوجد جرد لهذا اليوم بعد");
  const now = new Date();
  await db
    .update(dailyCashReconciliationsTable)
    .set({
      approvalStatus: "approved",
      approvedBy: actor.id,
      approvedByName: actor.name,
      approvalNote: note.trim() || null,
      approvedAt: now,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    })
    .where(eq(dailyCashReconciliationsTable.reportDate, parsedDate));
  return getDailyCashRow(parsedDate);
}

/** لوحة الإدارة المالية: كروت اليوم + الترحيل المقترَح. */
export async function getFinanceDashboard(reportDate = todayBaghdad()) {
  await ensureDailyCashTables();
  const parsedDate = dateStringSchema.parse(reportDate);
  const [row, suggestedOpening] = await Promise.all([
    getDailyCashRow(parsedDate),
    suggestOpeningBalance(parsedDate),
  ]);
  const netProfit = money(row.totalSales - row.totalExpenses);
  const totalOrders = row.breakdown.productOrderCount + row.breakdown.serviceOrderCount;
  return {
    reportDate: row.reportDate,
    suggestedOpeningBalance: suggestedOpening,
    cards: {
      todaySales: row.totalSales,
      todayExpenses: row.totalExpenses,
      openingBalance: row.openingBalance,
      closingBalance: row.closingBalance,
      cashDifference: row.difference,
      netProfit,
      totalOrders,
      totalInvoices: row.breakdown.invoiceCount,
    },
    reportStatus: row.reportStatus,
    reconciliationStatus: row.status,
    approvalStatus: row.approvalStatus,
    needsApproval: row.difference != null && Math.abs(row.difference) >= 0.005 && row.approvalStatus !== "approved",
    actualCashInDrawer: row.actualCashInDrawer,
    breakdown: row.breakdown,
  };
}
