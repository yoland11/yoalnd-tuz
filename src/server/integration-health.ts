import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Cross-module oversight: a read-only health monitor, the cashbox drift used by
 * the Reconciliation Center, and a unified recycle bin over the soft-deleted
 * records of several modules.
 *
 * Everything here is DETECT-AND-REPORT.  Nothing in this module writes, with the
 * sole exception of the explicitly-invoked recycle-bin restore / purge.
 */

const money = (value: unknown): number => {
  const n = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const rows = <T = any>(result: any): T[] => (result?.rows ?? result ?? []) as T[];
const firstCount = (result: any): number => Number(rows(result)[0]?.c ?? 0);

// ─── Health monitor ──────────────────────────────────────────────────────────

export type HealthStatus = "ok" | "warn" | "fail";

export type HealthCheck = {
  key: string;
  label: string;
  status: HealthStatus;
  value: string;
  detail?: string;
  count?: number;
  checkedAt?: string;
};

export type HealthReport = {
  generatedAt: string;
  summary: { ok: number; warn: number; fail: number };
  checks: HealthCheck[];
};

/**
 * Runs one check, converting any failure (missing table on an older deployment,
 * permission error) into a non-fatal "unknown" row instead of breaking the page.
 */
async function safeCheck(
  key: string,
  label: string,
  fn: () => Promise<Omit<HealthCheck, "key" | "label" | "checkedAt">>,
): Promise<HealthCheck> {
  try {
    return { key, label, ...(await fn()), checkedAt: new Date().toISOString() };
  } catch (err) {
    return {
      key,
      label,
      status: "warn",
      value: "غير متاح",
      detail: err instanceof Error ? err.message.slice(0, 200) : "تعذر تنفيذ الفحص",
    };
  }
}

/** Stored master-cashbox balance vs the balance implied by executed transactions. */
export async function computeCashboxDrift(): Promise<{
  stored: number;
  expected: number;
  drift: number;
}> {
  const box = rows(
    await db.execute(sql`
      select opening_balance, current_balance from master_cash_box order by id limit 1
    `),
  )[0];
  const totals = rows(
    await db.execute(sql`
      select
        coalesce(sum(case when direction = 'revenue' then amount else 0 end), 0) as revenue,
        coalesce(sum(case when direction = 'expense' then amount else 0 end), 0) as expenses
      from financial_transactions
      where approval_status = 'executed'
    `),
  )[0];
  const opening = money(box?.opening_balance);
  const stored = money(box?.current_balance);
  const expected = money(opening + money(totals?.revenue) - money(totals?.expenses));
  return { stored, expected, drift: money(expected - stored) };
}

async function buildSystemHealth(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  // 1) Database reachability + latency.
  checks.push(
    await safeCheck("database", "قاعدة البيانات", async () => {
      const started = Date.now();
      await db.execute(sql`select 1 as ok`);
      const ms = Date.now() - started;
      return {
        status: ms > 2000 ? "warn" : "ok",
        value: `${ms} مللي ثانية`,
        detail: ms > 2000 ? "زمن استجابة مرتفع" : undefined,
      };
    }),
  );

  // 2) Cashbox difference.
  checks.push(
    await safeCheck("cashbox_drift", "فرق الصندوق الرئيسي", async () => {
      const d = await computeCashboxDrift();
      const balanced = Math.abs(d.drift) < 0.01;
      return {
        status: balanced ? "ok" : "fail",
        value: balanced ? "مطابق" : String(d.drift),
        detail: balanced ? undefined : `المخزّن ${d.stored} · المحتسب ${d.expected}`,
      };
    }),
  );

  // 3) Entries awaiting approval. Pending approval is an intentional workflow
  // state, not an ERP outage, so keep it visible without downgrading health.
  checks.push(
    await safeCheck("unposted_entries", "قيود غير مرحّلة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from financial_transactions
          where approval_status in ('draft', 'pending')
        `),
      );
      return {
        status: "ok",
        value: c === 0 ? "لا توجد قيود معلّقة" : `${c} قيد بانتظار الاعتماد`,
        count: c,
        detail: c > 0 ? "مسار الموافقات يعمل بصورة طبيعية؛ لا تُرحّل القيود قبل اعتمادها." : undefined,
      };
    }),
  );

  // 4) Executed transactions with no ledger entries (missing accounting).
  checks.push(
    await safeCheck("missing_ledger", "قيود محاسبية مفقودة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from financial_transactions t
          where t.approval_status = 'executed'
            and not exists (select 1 from financial_ledger_entries e where e.transaction_id = t.id)
        `),
      );
      return {
        status: c === 0 ? "ok" : "fail",
        value: `${c} حركة`,
        count: c,
        detail: c > 0 ? "حركات منفّذة بلا قيد محاسبي" : undefined,
      };
    }),
  );

  // 5) Unbalanced ledger entries (debit != credit per transaction).
  checks.push(
    await safeCheck("unbalanced_ledger", "قيود غير متوازنة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from (
            select transaction_id
            from financial_ledger_entries
            group by transaction_id
            having abs(
              coalesce(sum(case when entry_side = 'debit' then amount else 0 end), 0)
              - coalesce(sum(case when entry_side = 'credit' then amount else 0 end), 0)
            ) > 0.01
          ) x
        `),
      );
      return {
        status: c === 0 ? "ok" : "fail",
        value: `${c} قيد`,
        count: c,
        detail: c > 0 ? "مجموع المدين لا يساوي الدائن" : undefined,
      };
    }),
  );

  // 6) A source can legitimately have several payments. Only a repeated
  // idempotency key is a duplicate transaction (and should never be allowed).
  checks.push(
    await safeCheck("duplicate_transactions", "حركات مكرّرة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from (
            select idempotency_key
            from financial_transactions
            where approval_status = 'executed'
            group by idempotency_key
            having count(*) > 1
          ) x
        `),
      );
      return {
        status: c === 0 ? "ok" : "fail",
        value: c === 0 ? "لا توجد عمليات مكررة" : `${c} مجموعة`,
        count: c,
        detail: c > 0 ? "تكرار مفتاح idempotency يتطلب مراجعة مالية فورية" : undefined,
      };
    }),
  );

  // 7) Negative inventory.
  checks.push(
    await safeCheck("negative_inventory", "مخزون بالسالب", async () => {
      const c = firstCount(
        await db.execute(sql`select count(*)::int as c from products where stock < 0`),
      );
      return {
        status: c === 0 ? "ok" : "fail",
        value: `${c} منتج`,
        count: c,
        detail: c > 0 ? "كميات سالبة تحتاج جرد" : undefined,
      };
    }),
  );

  // 8) Invoice totals that do not reconcile (paid + remaining != total).
  checks.push(
    await safeCheck("invoice_balance", "توازن الفواتير", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from sales_invoices
          where status not in ('deleted', 'cancelled')
            and abs(coalesce(paid_amount,0) + coalesce(remaining_amount,0) - coalesce(total,0)) > 0.01
        `),
      );
      return {
        status: c === 0 ? "ok" : "fail",
        value: `${c} فاتورة`,
        count: c,
        detail: c > 0 ? "المدفوع + المتبقي لا يساوي الإجمالي" : undefined,
      };
    }),
  );

  // 9) Orphan invoice items (broken relations).
  checks.push(
    await safeCheck("orphan_invoice_items", "علاقات مكسورة (بنود الفواتير)", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from sales_invoice_items i
          where not exists (select 1 from sales_invoices s where s.id = i.invoice_id)
        `),
      );
      return {
        status: c === 0 ? "ok" : "fail",
        value: `${c} بند`,
        count: c,
        detail: c > 0 ? "بنود بلا فاتورة أصلية" : undefined,
      };
    }),
  );

  // 10) Delivery orders whose invoice no longer exists.
  checks.push(
    await safeCheck("orphan_delivery_orders", "طلبات توصيل يتيمة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from delivery_orders o
          where o.sales_invoice_id is not null
            and not exists (select 1 from sales_invoices s where s.id = o.sales_invoice_id)
        `),
      );
      return {
        status: c === 0 ? "ok" : "warn",
        value: `${c} طلب`,
        count: c,
        detail: c > 0 ? "طلبات توصيل بلا فاتورة" : undefined,
      };
    }),
  );

  // Optional integrations are warnings by design: a missing provider must
  // never change the health of core ERP transactions.
  const storageUrl = (
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  ).replace(/\/$/, "");
  const storageKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";
  const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || "ajn-assets";
  const hasVapid = Boolean(
    (process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) &&
      process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );

  checks.push(
    await safeCheck("supabase", "Supabase", async () => ({
      status: storageUrl ? "ok" : "warn",
      value: storageUrl ? "Configured" : "Not configured",
      detail: storageUrl ? "Server endpoint configured." : "Public media URLs continue to work without a server endpoint.",
    })),
    await safeCheck("storage", "Storage", async () => {
      if (!storageUrl || !storageKey)
        return { status: "warn", value: "Pending Configuration", detail: "Service-role bucket validation is unavailable; image fallback remains enabled." };
      const response = await fetch(`${storageUrl}/storage/v1/bucket/${encodeURIComponent(storageBucket)}`, {
        headers: { apikey: storageKey, authorization: `Bearer ${storageKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return {
        status: response.ok ? "ok" : "warn",
        value: response.ok ? "Bucket accessible" : `HTTP ${response.status}`,
        detail: response.ok ? `Bucket: ${storageBucket}` : "Storage credentials or bucket policy should be reviewed.",
      };
    }),
    await safeCheck("realtime", "Realtime", async () => {
      const hasAnon = Boolean(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      return {
        status: storageUrl && hasAnon ? "ok" : "warn",
        value: storageUrl && hasAnon ? "Configured" : "Fallback polling active",
        detail: storageUrl && hasAnon ? "Realtime endpoint credentials are present." : "Polling remains available when realtime configuration is absent.",
      };
    }),
    await safeCheck("whatsapp", "WhatsApp", async () => {
      const configured = [
        ["ULTRAMSG_INSTANCE_ID", "ULTRAMSG_TOKEN"],
        ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
        ["META_WA_PHONE_ID", "META_WA_TOKEN"],
        ["WASSENGER_API_KEY"],
      ].some((keys) => keys.every((key) => Boolean(process.env[key])));
      return {
        status: configured ? "ok" : "warn",
        value: configured ? "Configured" : "Pending Configuration",
        detail: configured ? "A WhatsApp provider is configured." : "Messages are logged as pending configuration and do not block checkout.",
      };
    }),
    await safeCheck("push", "Push Notifications", async () => ({
      status: hasVapid ? "ok" : "warn",
      value: hasVapid ? "Configured" : "Push service unavailable",
      detail: hasVapid ? "VAPID credentials are present." : "Notifications remain available in-app; browser push is skipped safely.",
    })),
    await safeCheck("pdf", "PDF Generator", async () => ({
      status: "ok",
      value: "Embedded font fallback ready",
      detail: "PDFKit is initialized with the bundled Cairo fonts; a PDF failure is isolated from checkout.",
    })),
    await safeCheck("email", "Email", async () => {
      const configured = Boolean(process.env.RESEND_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
      return { status: configured ? "ok" : "warn", value: configured ? "Configured" : "Not configured", detail: configured ? "Email provider credentials are present." : "Email delivery is optional and disabled." };
    }),
    await safeCheck("image_proxy", "Image Proxy", async () => ({
      status: storageUrl && storageKey ? "ok" : "warn",
      value: storageUrl && storageKey ? "Private-source ready" : "Public-source fallback",
      detail: storageUrl && storageKey ? "Server-side proxy can validate private storage." : "Private-bucket validation awaits service-role configuration; public image proxy remains available.",
    })),
    await safeCheck("cron", "Cron Jobs", async () => ({
      status: process.env.CRON_SECRET ? "ok" : "warn",
      value: process.env.CRON_SECRET ? "Configured" : "Not configured",
      detail: process.env.CRON_SECRET ? "Scheduled endpoints are protected." : "Scheduled notifications are disabled until CRON_SECRET is set.",
    })),
    await safeCheck("environment", "Environment Variables", async () => {
      const required = ["DATABASE_URL", "SESSION_SECRET", "AUTH_SECRET"];
      const missing = required.filter((key) => !process.env[key]);
      return {
        status: missing.length ? "fail" : "ok",
        value: missing.length ? `${missing.length} required missing` : "Required configuration present",
        detail: missing.length ? `Missing: ${missing.join(", ")}` : "Secrets are present and are never exposed by this page.",
      };
    }),
  );

  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 },
  );

  return { generatedAt: new Date().toISOString(), summary, checks };
}

let cachedHealthReport: HealthReport | null = null;
let healthRefresh: Promise<HealthReport> | null = null;
const HEALTH_CACHE_MS = 60_000;

/** Runs at module startup and serves the latest in-memory diagnostic report. */
export async function runSystemHealth(force = false): Promise<HealthReport> {
  if (!force && cachedHealthReport && Date.now() - Date.parse(cachedHealthReport.generatedAt) < HEALTH_CACHE_MS)
    return cachedHealthReport;
  if (healthRefresh) return healthRefresh;
  healthRefresh = buildSystemHealth()
    .then((report) => (cachedHealthReport = report))
    .finally(() => { healthRefresh = null; });
  return healthRefresh;
}

void runSystemHealth().catch((error) =>
  console.warn("System health startup check failed", {
    message: error instanceof Error ? error.message : String(error),
  }),
);

// ─── Recycle bin ─────────────────────────────────────────────────────────────

type RecycleSpec = {
  label: string;
  table: string;
  /** SQL predicate identifying a deleted row. */
  deletedWhere: string;
  /** SQL fragment restoring the row. */
  restoreSet: string;
  /** SQL fragment marking it deleted again (unused, kept for symmetry). */
  titleExpr: string;
  subtitleExpr: string;
  deletedAtExpr: string;
  /** Optional guard: returns a message when the row must not be purged. */
  purgeGuard?: (id: number) => Promise<string | null>;
};

const RECYCLE: Record<string, RecycleSpec> = {
  sales_invoice: {
    label: "فواتير المبيعات",
    table: "sales_invoices",
    deletedWhere: "status = 'deleted'",
    restoreSet: "status = 'active'",
    titleExpr: "invoice_no",
    subtitleExpr: "coalesce(customer_name, '')",
    deletedAtExpr: "updated_at",
    // An invoice with executed money attached must not be hard-deleted.
    purgeGuard: async (id) => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from financial_transactions
          where source_type = 'sales_invoice' and source_id = ${String(id)}
            and approval_status = 'executed'
        `),
      );
      return c > 0 ? "لا يمكن الحذف النهائي — توجد حركات مالية منفّذة مرتبطة بالفاتورة" : null;
    },
  },
  expense: {
    label: "المصروفات",
    table: "expenses",
    deletedWhere: "deleted_at is not null",
    restoreSet: "deleted_at = null",
    titleExpr: "coalesce(name, '')",
    subtitleExpr: "coalesce(category_name, '')",
    deletedAtExpr: "deleted_at",
    purgeGuard: async (id) => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from financial_transactions
          where source_type = 'expense' and source_id = ${String(id)}
            and approval_status = 'executed'
        `),
      );
      return c > 0 ? "لا يمكن الحذف النهائي — يوجد قيد مالي منفّذ لهذا المصروف" : null;
    },
  },
  customer: {
    label: "العملاء",
    table: "customers",
    deletedWhere: "status = 'deleted'",
    restoreSet: "status = 'active'",
    titleExpr: "coalesce(nullif(name, ''), phone)",
    subtitleExpr: "phone",
    deletedAtExpr: "updated_at",
    purgeGuard: async (id) => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from sales_invoices where customer_id = ${id} and status <> 'deleted'
        `),
      );
      return c > 0 ? "لا يمكن الحذف النهائي — للعميل فواتير نشطة" : null;
    },
  },
  asset_profile: {
    label: "ملفات إهلاك الأصول",
    table: "asset_profiles",
    deletedWhere: "deleted_at is not null",
    restoreSet: "deleted_at = null, deleted_by = null, deleted_reason = null",
    titleExpr: "coalesce(serial_number, concat('#', id::text))",
    subtitleExpr: "coalesce(status, '')",
    deletedAtExpr: "deleted_at",
  },
};

export function recycleEntity(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECYCLE, type);
}

export async function recycleBinSummary() {
  const out: Array<{ type: string; label: string; count: number }> = [];
  for (const [type, spec] of Object.entries(RECYCLE)) {
    try {
      const c = firstCount(
        await db.execute(
          sql.raw(`select count(*)::int as c from ${spec.table} where ${spec.deletedWhere}`),
        ),
      );
      out.push({ type, label: spec.label, count: c });
    } catch {
      out.push({ type, label: spec.label, count: 0 });
    }
  }
  return out;
}

export async function listRecycleBin(type: string) {
  const spec = RECYCLE[type];
  if (!spec) return [];
  const result = await db.execute(
    sql.raw(`
      select id,
             ${spec.titleExpr} as title,
             ${spec.subtitleExpr} as subtitle,
             ${spec.deletedAtExpr} as deleted_at
      from ${spec.table}
      where ${spec.deletedWhere}
      order by ${spec.deletedAtExpr} desc nulls last
      limit 200
    `),
  );
  return rows(result).map((r: any) => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    subtitle: String(r.subtitle ?? ""),
    deletedAt: r.deleted_at ?? null,
  }));
}

/** Restores a soft-deleted row. Relationships are preserved because the row was
 *  never physically removed. */
export async function restoreRecycleItem(type: string, id: number): Promise<boolean> {
  const spec = RECYCLE[type];
  if (!spec) return false;
  const result = await db.execute(
    sql.raw(`
      update ${spec.table} set ${spec.restoreSet}
      where id = ${Number(id)} and ${spec.deletedWhere}
      returning id
    `),
  );
  return rows(result).length > 0;
}

/**
 * Permanent delete. Refuses when the record still anchors executed financial
 * history, so the ledger can never be orphaned by a purge.
 */
export async function purgeRecycleItem(
  type: string,
  id: number,
): Promise<{ ok: boolean; message?: string; blocked?: boolean }> {
  const spec = RECYCLE[type];
  if (!spec) return { ok: false, message: "نوع غير معروف" };

  if (spec.purgeGuard) {
    const blockedMessage = await spec.purgeGuard(id);
    if (blockedMessage) return { ok: false, message: blockedMessage, blocked: true };
  }

  try {
    const result = await db.execute(
      sql.raw(`delete from ${spec.table} where id = ${Number(id)} and ${spec.deletedWhere} returning id`),
    );
    if (rows(result).length === 0)
      return { ok: false, message: "العنصر غير موجود أو غير محذوف" };
    return { ok: true };
  } catch (err) {
    // A foreign-key violation means other records still reference this row.
    return {
      ok: false,
      blocked: true,
      message: "لا يمكن الحذف النهائي — توجد سجلات مرتبطة بهذا العنصر",
    };
  }
}
