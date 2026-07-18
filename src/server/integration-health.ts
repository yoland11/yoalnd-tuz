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
  fn: () => Promise<Omit<HealthCheck, "key" | "label">>,
): Promise<HealthCheck> {
  try {
    return { key, label, ...(await fn()) };
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

export async function runSystemHealth(): Promise<HealthReport> {
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

  // 3) Entries awaiting approval / execution.
  checks.push(
    await safeCheck("unposted_entries", "قيود غير مرحّلة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from financial_transactions
          where approval_status in ('draft', 'pending')
        `),
      );
      return {
        status: c === 0 ? "ok" : "warn",
        value: `${c} قيد`,
        count: c,
        detail: c > 0 ? "بانتظار الاعتماد في مركز الموافقات" : undefined,
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

  // 6) Duplicate executed transactions for the same source event.
  checks.push(
    await safeCheck("duplicate_transactions", "حركات مكرّرة", async () => {
      const c = firstCount(
        await db.execute(sql`
          select count(*)::int as c from (
            select source_type, source_id, source_event
            from financial_transactions
            where approval_status = 'executed' and source_type is not null and source_id is not null
            group by source_type, source_id, source_event
            having count(*) > 1
          ) x
        `),
      );
      return {
        status: c === 0 ? "ok" : "warn",
        value: `${c} مجموعة`,
        count: c,
        detail: c > 0 ? "أكثر من حركة منفّذة لنفس المصدر والحدث" : undefined,
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
          where status <> 'deleted'
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

  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 },
  );

  return { generatedAt: new Date().toISOString(), summary, checks };
}

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
