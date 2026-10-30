import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { reconcilePaymentState } from "./payment-state";
import { cancelFinancialTransactionRequest, createSourceFinancialRequest, type FinancialActor } from "./master-cash-box";
import type { ApiErrorCode } from "./write-safety";
import {
  ACTIVE_RETURN_STATUSES,
  RETURN_CONDITIONS,
  RETURN_REASONS,
  SalesReturnRuleError,
  allocateFifo,
  allocateInvoiceCredit,
  availableMilli,
  fromCents,
  fromMilli,
  lineRefundableCents,
  returnAmountCents,
  returnProductKey,
  toCents,
  toMilli,
  validateAllocation,
  validateSettlementPlan,
  type ReturnAllocation,
  type ReturnCondition,
  type ReturnableLine,
} from "@/lib/sales-returns";

/**
 * Grouped multi-invoice sales returns.
 *
 * One customer-facing return document (RET-xxxxxx) links every returned
 * quantity to its exact original invoice line. Each step is its own audited
 * action: submit → physical receipt → approval → inventory acceptance →
 * settlement. Money only moves through existing rails: a debt deduction is an
 * invoice_credit row read by the canonical payment-state reconciliation, and a
 * cash refund is a pending request in the existing financial approvals.
 */

export class SalesReturnError extends Error {
  constructor(message: string, public status = 409, public code: ApiErrorCode = "CONFLICT") {
    super(message);
    this.name = "SalesReturnError";
  }
}

type Executor = { execute: (query: SQL) => Promise<any> };
type Transaction = Executor & Record<string, any>;
export type SalesReturnDatabase = Executor & { transaction: <T>(run: (tx: any) => Promise<T>) => Promise<T> };
export type SalesReturnActor = { id: number; name: string; role: string; permissions: readonly string[] };

export const SALES_RETURN_PERMISSIONS = [
  "sales_returns.view",
  "sales_returns.create",
  "sales_returns.approve",
  "sales_returns.inventory",
  "sales_returns.settle",
  "sales_returns.allocation_override",
  "sales_returns.reverse",
  "sales_returns.print",
] as const;
type SalesReturnPermission = (typeof SALES_RETURN_PERMISSIONS)[number];

const ACTIVE = sql.raw(`(${ACTIVE_RETURN_STATUSES.map((status) => `'${status}'`).join(",")})`);
// Graduation and research orders own their mirror invoice's lines and balance
// and rewrite both, so returns and credits for those stay in their modules.
const selfOwnedInvoice = (invoiceId: SQL) => sql`NOT EXISTS (SELECT 1 FROM graduation_orders owner WHERE owner.invoice_id = ${invoiceId})
  AND NOT EXISTS (SELECT 1 FROM research_orders owner WHERE owner.invoice_id = ${invoiceId})`;

/** Integer ids as an `IN (...)` list; an empty list matches nothing. */
const idList = (ids: number[]) => (ids.length ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql`NULL`);

function rows(result: any): any[] {
  if (!Array.isArray(result?.rows)) throw new Error("Invalid sales returns database response");
  return result.rows;
}
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value));
const positiveId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
const text = (value: unknown, max = 2000) => {
  const parsed = typeof value === "string" ? value.trim() : "";
  return parsed ? parsed.slice(0, max) : null;
};
const today = () => new Date().toISOString().slice(0, 10);

// ── Readiness ──────────────────────────────────────────────────────────────
let readyCache = false;
/** True once migration 0130 exists. A missing table means no returns can exist. */
export async function salesReturnsReady(executor: Executor = db): Promise<boolean> {
  if (readyCache) return true;
  const [row] = rows(
    await executor.execute(sql`
      SELECT to_regclass('public.sales_returns') IS NOT NULL
        AND to_regclass('public.sales_return_items') IS NOT NULL
        AND to_regclass('public.sales_return_settlements') IS NOT NULL
        AND to_regclass('public.sales_return_events') IS NOT NULL AS ready
    `),
  );
  readyCache = row?.ready === true;
  return readyCache;
}
async function requireReady(executor: Executor) {
  if (!(await salesReturnsReady(executor)))
    throw new SalesReturnError(
      "مرتجعات المبيعات تحتاج تطبيق ملف قاعدة البيانات lib/db/migrations/0130_sales_returns.sql أولاً",
      503,
      "DATABASE_ERROR",
    );
}

// ── Permissions ────────────────────────────────────────────────────────────
export const canReturn = (actor: Pick<SalesReturnActor, "role" | "permissions">, permission: SalesReturnPermission) =>
  actor.role === "admin" || actor.permissions.includes(permission);
function requireReturnPermission(actor: SalesReturnActor, permission: SalesReturnPermission, message: string) {
  if (!canReturn(actor, permission)) throw new SalesReturnError(message, 403, "PERMISSION_DENIED");
}
const financialActorOf = (actor: SalesReturnActor): FinancialActor => ({
  id: actor.id,
  name: actor.name,
  role: actor.role,
  permissions: [...actor.permissions],
});

async function addEvent(tx: Executor, returnId: number, event: string, actor: SalesReturnActor | null, note?: string | null, metadata: Record<string, unknown> = {}) {
  await tx.execute(sql`
    INSERT INTO sales_return_events (return_id, event, actor_id, actor_name, note, metadata)
    VALUES (${returnId}, ${event}, ${actor?.id ?? null}, ${actor?.name ?? "النظام"}, ${note ?? null}, ${JSON.stringify(metadata)}::jsonb)
  `);
}

// ── Invoice guards used by the existing invoice edit/cancel/delete paths ──
/** Returns that reference the invoice. `active` excludes rejected/cancelled/reversed. */
export async function salesReturnsForInvoice(executor: Executor, invoiceId: number, scope: "any" | "active"): Promise<string[]> {
  if (!(await salesReturnsReady(executor))) return [];
  const statuses = scope === "active" ? sql`AND r.status IN ('draft','pending_approval','approved','completed')` : sql``;
  return rows(
    await executor.execute(sql`
      SELECT DISTINCT r.return_no FROM sales_return_items ri
      JOIN sales_returns r ON r.id = ri.return_id
      WHERE ri.invoice_id = ${invoiceId} ${statuses}
      ORDER BY r.return_no LIMIT 20
    `),
  ).map((row) => String(row.return_no));
}

/** Ids among `invoiceIds` that any grouped return references. */
export async function invoicesWithSalesReturns(executor: Executor, invoiceIds: number[]): Promise<Set<number>> {
  if (!invoiceIds.length || !(await salesReturnsReady(executor))) return new Set();
  return new Set(
    rows(
      await executor.execute(sql`
        SELECT DISTINCT invoice_id FROM sales_return_items WHERE invoice_id IN (${idList(invoiceIds)})
        UNION SELECT DISTINCT invoice_id FROM sales_return_settlements WHERE invoice_id IN (${idList(invoiceIds)})
      `),
    ).map((row) => Number(row.invoice_id)),
  );
}

/**
 * Applied debt deductions lower an invoice's remaining debt without being
 * cash. Writers and views that derive remaining from paid use this so a
 * credited invoice never shows or is rewritten as owing that amount again.
 * Zero before migration 0130.
 */
export async function salesInvoiceReturnCredits(executor: Executor, invoiceId: number): Promise<number> {
  if (!(await salesReturnsReady(executor))) return 0;
  const [row] = rows(
    await executor.execute(sql`
      SELECT coalesce(sum(amount::numeric), 0)::text AS credited FROM sales_return_settlements
      WHERE kind = 'invoice_credit' AND status = 'applied' AND invoice_id = ${invoiceId}
    `),
  );
  return num(row?.credited);
}

/** Correlated SQL of an invoice id expression's applied return credits; `0` before migration 0130. */
export async function salesInvoiceReturnCreditsSql(invoiceId: unknown, executor: Executor = db): Promise<SQL> {
  if (!(await salesReturnsReady(executor))) return sql`0::numeric`;
  return sql`(SELECT coalesce(sum(credit.amount::numeric), 0) FROM sales_return_settlements credit
    WHERE credit.kind = 'invoice_credit' AND credit.status = 'applied' AND credit.invoice_id = ${invoiceId})`;
}

// ── Customer + original invoice lines ─────────────────────────────────────
// The generic walk-in customer («عميل نقدي») that POS invoices use when no
// customer is chosen. Different buyers share it, so its returns stay inside
// one invoice: no FIFO across buyers, no credit held on the shared account.
const CASH_CUSTOMER_ID = sql`coalesce(
  (SELECT cash.id FROM settings setting JOIN customers cash ON cash.id::text = setting.value->>'customerId'
   WHERE setting.key = 'salesCashCustomer' AND cash.status = 'active' LIMIT 1),
  (SELECT cash.id FROM customers cash WHERE cash.phone = '00000000000' AND cash.status = 'active' ORDER BY cash.id LIMIT 1)
)`;
async function cashCustomerId(executor: Executor): Promise<number | null> {
  const [row] = rows(await executor.execute(sql`SELECT ${CASH_CUSTOMER_ID} AS id`));
  return positiveId(row?.id);
}

type CustomerRow = { id: number; name: string; phone: string; code: string | null; customerType: string; isCashCustomer: boolean };
async function readCustomer(executor: Executor, customerId: number, lock = false): Promise<CustomerRow> {
  const [row] = rows(
    await executor.execute(sql`
      SELECT c.id, coalesce(nullif(c.full_name, ''), nullif(c.name, ''), c.phone) AS name, c.phone, c.customer_type,
             (SELECT a.customer_code FROM customer_accounts a WHERE a.customer_id = c.id LIMIT 1) AS code,
             c.id = ${CASH_CUSTOMER_ID} AS is_cash
      FROM customers c WHERE c.id = ${customerId} ${lock ? sql`FOR UPDATE OF c` : sql``}
    `),
  );
  if (!row) throw new SalesReturnError("العميل غير موجود", 404, "NOT_FOUND");
  return { id: Number(row.id), name: String(row.name ?? ""), phone: String(row.phone ?? ""), code: row.code ?? null, customerType: String(row.customer_type ?? "retail"), isCashCustomer: row.is_cash === true };
}

/**
 * Invoices a return may use: `null` (all of the customer's) for a real
 * customer; for the walk-in customer the return's own invoice, or the one it
 * was opened from.
 */
async function invoiceScope(executor: Executor, customer: CustomerRow, options: { returnId?: number | null; invoiceId?: number | null }): Promise<number[] | null> {
  if (!customer.isCashCustomer) return null;
  if (options.returnId) {
    const used = rows(await executor.execute(sql`SELECT DISTINCT invoice_id FROM sales_return_items WHERE return_id = ${options.returnId} ORDER BY invoice_id`)).map((row) => Number(row.invoice_id));
    if (used.length) return used;
  }
  if (!options.invoiceId)
    throw new SalesReturnError("العميل النقدي يشترك فيه عدة مشترين؛ ابحث برقم الفاتورة أو اسم المشتري وافتح المرتجع منها", 422, "VALIDATION_ERROR");
  const [invoice] = rows(await executor.execute(sql`SELECT id FROM sales_invoices WHERE id = ${options.invoiceId} AND customer_id = ${customer.id}`));
  if (!invoice) throw new SalesReturnError("الفاتورة المحددة لا تخص هذا العميل", 409);
  return [options.invoiceId];
}

type LineFacts = ReturnableLine & {
  productId: number | null;
  productName: string;
  unit: string | null;
  barcode: string | null;
  image: string | null;
  productKey: string;
  unitPrice: number;
  lineTotal: number;
  trackInventory: boolean;
  refundableCents: number;
  consumedAmountCents: number;
  returnedMilli: number;
  reservedMilli: number;
};

/**
 * Every returnable line of the customer's active invoices with what active
 * returns already took from it. `itemIds` narrows to locked lines.
 */
async function readCustomerLines(executor: Executor, customerId: number, options: { excludeReturnId?: number | null; itemIds?: number[]; invoiceIds?: number[] | null } = {}): Promise<LineFacts[]> {
  const exclude = options.excludeReturnId ?? 0;
  const narrow = sql`${options.itemIds ? sql`AND i.id IN (${idList(options.itemIds)})` : sql``} ${options.invoiceIds ? sql`AND s.id IN (${idList(options.invoiceIds)})` : sql``}`;
  const result = rows(
    await executor.execute(sql`
      SELECT i.id AS invoice_item_id, i.invoice_id, s.invoice_no, s.date::text AS invoice_date,
             i.product_id, i.product_name, i.unit_snapshot, i.barcode,
             i.quantity::text AS quantity, i.unit_price::text AS unit_price, i.total::text AS line_total,
             coalesce(i.track_inventory_snapshot, true) AS track_inventory,
             s.discount_amount::text AS discount_amount, s.tax_amount::text AS tax_amount,
             totals.lines_net::text AS lines_net, totals.lines_discount::text AS lines_discount,
             (SELECT p.images->>0 FROM products p WHERE p.id = i.product_id) AS image,
             coalesce(used.returned, 0)::text AS returned, coalesce(used.reserved, 0)::text AS reserved,
             coalesce(used.amount, 0)::text AS consumed_amount
      FROM sales_invoice_items i
      JOIN sales_invoices s ON s.id = i.invoice_id
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(x.total::numeric), 0) AS lines_net, coalesce(sum(x.discount::numeric), 0) AS lines_discount
        FROM sales_invoice_items x WHERE x.invoice_id = s.id
      ) totals
      LEFT JOIN LATERAL (
        SELECT sum(ri.quantity::numeric) FILTER (WHERE r.status IN ('approved','completed')) AS returned,
               sum(ri.quantity::numeric) FILTER (WHERE r.status = 'pending_approval') AS reserved,
               sum(ri.amount::numeric) AS amount
        FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id
        WHERE ri.invoice_item_id = i.id AND r.status IN ${ACTIVE} AND r.id <> ${exclude}
      ) used ON true
      WHERE s.customer_id = ${customerId} AND s.status = 'active' AND s.financially_reversed = false
        AND ${selfOwnedInvoice(sql`s.id`)}
        AND i.bundle_id IS NULL AND i.quantity::numeric > 0 ${narrow}
      ORDER BY s.date, s.id, i.id
      LIMIT 5001
    `),
  );
  if (result.length > 5000) throw new SalesReturnError("سجل مشتريات العميل كبير جداً؛ ضيّق البحث بفاتورة محددة", 422, "VALIDATION_ERROR");
  return result.map((row) => {
    const productId = positiveId(row.product_id);
    const productName = String(row.product_name ?? "");
    const unit = row.unit_snapshot ? String(row.unit_snapshot) : null;
    const quantityMilli = toMilli(row.quantity);
    const returnedMilli = toMilli(row.returned);
    const reservedMilli = toMilli(row.reserved);
    return {
      invoiceItemId: Number(row.invoice_item_id),
      invoiceId: Number(row.invoice_id),
      invoiceNo: String(row.invoice_no ?? `SI-${row.invoice_id}`),
      invoiceDate: String(row.invoice_date ?? ""),
      quantityMilli,
      consumedMilli: returnedMilli + reservedMilli,
      returnedMilli,
      reservedMilli,
      productId,
      productName,
      unit,
      barcode: row.barcode ?? null,
      image: row.image ?? null,
      productKey: returnProductKey({ productId, productName, unit }),
      unitPrice: num(row.unit_price),
      lineTotal: num(row.line_total),
      trackInventory: row.track_inventory !== false,
      refundableCents: lineRefundableCents(
        { total: num(row.line_total) },
        { linesNetTotal: num(row.lines_net), linesDiscountTotal: num(row.lines_discount), discountAmount: num(row.discount_amount), taxAmount: num(row.tax_amount) },
      ),
      consumedAmountCents: toCents(row.consumed_amount),
    };
  });
}

function groupProducts(lines: LineFacts[]) {
  const groups = new Map<string, { key: string; productId: number | null; productName: string; unit: string | null; image: string | null; barcode: string | null; lines: LineFacts[] }>();
  for (const line of lines) {
    const group = groups.get(line.productKey) ?? { key: line.productKey, productId: line.productId, productName: line.productName, unit: line.unit, image: line.image, barcode: line.barcode, lines: [] };
    group.lines.push(line);
    groups.set(line.productKey, group);
  }
  return [...groups.values()].map((group) => {
    const purchased = group.lines.reduce((sum, line) => sum + line.quantityMilli, 0);
    const returned = group.lines.reduce((sum, line) => sum + line.returnedMilli, 0);
    const reserved = group.lines.reduce((sum, line) => sum + line.reservedMilli, 0);
    const available = group.lines.reduce((sum, line) => sum + availableMilli(line), 0);
    return {
      key: group.key,
      productId: group.productId,
      productName: group.productName,
      unit: group.unit,
      image: group.image,
      barcode: group.barcode,
      purchased: fromMilli(purchased),
      returned: fromMilli(returned),
      reserved: fromMilli(reserved),
      available: fromMilli(available),
      lines: group.lines.map((line) => ({
        invoiceItemId: line.invoiceItemId,
        invoiceId: line.invoiceId,
        invoiceNo: line.invoiceNo,
        invoiceDate: line.invoiceDate,
        quantity: fromMilli(line.quantityMilli),
        returned: fromMilli(line.returnedMilli),
        reserved: fromMilli(line.reservedMilli),
        available: fromMilli(availableMilli(line)),
        unitPrice: line.unitPrice,
        netUnit: line.quantityMilli > 0 ? fromCents(line.refundableCents) / fromMilli(line.quantityMilli) : 0,
        refundable: fromCents(line.refundableCents),
        refundableRemaining: fromCents(Math.max(line.refundableCents - line.consumedAmountCents, 0)),
        trackInventory: line.trackInventory,
      })),
    };
  });
}

export async function readCustomerPurchases(database: SalesReturnDatabase, actor: SalesReturnActor, customerId: number, excludeReturnId?: number | null, invoiceId?: number | null) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.create") && !canReturn(actor, "sales_returns.view"))
    throw new SalesReturnError("ليس لديك صلاحية عرض مشتريات العميل للمرتجعات", 403, "PERMISSION_DENIED");
  const customer = await readCustomer(database, customerId);
  const scope = await invoiceScope(database, customer, { returnId: excludeReturnId, invoiceId });
  const scoped = scope ? sql`AND s.id IN (${idList(scope)})` : sql``;
  const [lines, totals, scopeInvoices] = await Promise.all([
    readCustomerLines(database, customerId, { excludeReturnId, invoiceIds: scope }),
    database.execute(sql`
      SELECT coalesce(sum(s.total::numeric), 0)::text AS purchases,
             coalesce(sum(s.paid_amount::numeric), 0)::text AS payments,
             coalesce(sum(s.remaining_amount::numeric), 0)::text AS outstanding,
             (SELECT coalesce(sum(r.total_amount::numeric), 0) FROM sales_returns r
              WHERE r.customer_id = ${customerId} AND r.status IN ('approved','completed')
                ${scope ? sql`AND EXISTS (SELECT 1 FROM sales_return_items ri WHERE ri.return_id = r.id AND ri.invoice_id IN (${idList(scope)}))` : sql``})::text AS approved_returns,
             (SELECT coalesce(sum(cc.amount::numeric - coalesce((SELECT sum(ch.amount::numeric) FROM sales_return_settlements ch
                WHERE ch.parent_settlement_id = cc.id AND ch.status = 'applied'), 0)), 0)
              FROM sales_return_settlements cc
              WHERE cc.customer_id = ${customerId} AND cc.kind = 'customer_credit' AND cc.status = 'applied')::text AS available_credit
      FROM sales_invoices s
      WHERE s.customer_id = ${customerId} AND s.status = 'active' AND s.financially_reversed = false ${scoped}
    `),
    scope
      ? database.execute(sql`SELECT id, invoice_no, date::text AS date, customer_name, customer_phone FROM sales_invoices WHERE id IN (${idList(scope)}) ORDER BY id`)
      : Promise.resolve({ rows: [] }),
  ]);
  const [summary] = rows(totals);
  return {
    customer: {
      ...customer,
      purchases: num(summary?.purchases),
      payments: num(summary?.payments),
      outstanding: num(summary?.outstanding),
      approvedReturns: num(summary?.approved_returns),
      availableCredit: customer.isCashCustomer ? 0 : num(summary?.available_credit),
    },
    // Walk-in returns are limited to these invoices; the buyer is named on them.
    scopeInvoices: rows(scopeInvoices).map((row) => ({ id: Number(row.id), invoiceNo: String(row.invoice_no ?? ""), date: String(row.date ?? ""), buyerName: row.customer_name ? String(row.customer_name) : null, buyerPhone: row.customer_phone ? String(row.customer_phone) : null })),
    products: groupProducts(lines).filter((product) => product.purchased > 0),
    canOverrideAllocation: canReturn(actor, "sales_returns.allocation_override"),
  };
}

// ── Customer search for the return editor ─────────────────────────────────
/** Arabic-insensitive text: أ/إ/آ→ا, ى→ي, ة→ه, no tatweel, single spaces. */
export const normalizeArabicSearch = (value: string) =>
  value.toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ـ/g, "").replace(/\s+/g, " ").trim();
const normalizedSql = (value: SQL) => sql`regexp_replace(translate(lower(coalesce(${value}, '')), 'أإآٱىةـ', 'اااايه'), '\\s+', ' ', 'g')`;
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Registered customers by name, phone, code or one of their invoice numbers /
 * written buyer names, plus walk-in invoices (shared cash customer) and
 * invoices never linked to a customer. Only the returns permission is needed.
 */
export async function searchReturnCustomers(database: SalesReturnDatabase, actor: SalesReturnActor, rawQuery: string | null) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.create") && !canReturn(actor, "sales_returns.view"))
    throw new SalesReturnError("ليس لديك صلاحية البحث عن عملاء المرتجعات", 403, "PERMISSION_DENIED");
  const term = String(rawQuery ?? "").trim().slice(0, 80);
  if (!term) return { customers: [], walkInInvoices: [], unlinkedInvoices: [] };
  const name = likePattern(normalizeArabicSearch(term));
  const invoiceNo = likePattern(term);
  const digits = term.replace(/\D/g, "");
  const phone = digits.length >= 3 ? likePattern(digits) : null;
  const code = term.match(/^CUS-?0*(\d+)$/i);
  const customerNo = code ? Number(code[1]) : /^\d{1,7}$/.test(term) ? Number(term) : 0;
  const cashId = (await cashCustomerId(database)) ?? 0;
  const invoiceMatch = (alias: string) => sql`(${sql.raw(alias)}.invoice_no ILIKE ${invoiceNo}
    OR ${normalizedSql(sql.raw(`${alias}.customer_name`))} LIKE ${name}
    OR (${phone}::text IS NOT NULL AND regexp_replace(coalesce(${sql.raw(alias)}.customer_phone, ''), '[^0-9]', '', 'g') LIKE ${phone}))`;
  const returnable = (alias: string) => sql`${sql.raw(alias)}.status = 'active' AND ${sql.raw(alias)}.financially_reversed = false AND ${selfOwnedInvoice(sql.raw(`${alias}.id`))}`;
  const [customers, invoices] = await Promise.all([
    database.execute(sql`
      SELECT c.id, coalesce(nullif(c.full_name, ''), nullif(c.name, ''), c.phone) AS name, c.phone, c.customer_type,
        (SELECT a.customer_code FROM customer_accounts a WHERE a.customer_id = c.id LIMIT 1) AS code,
        stats.invoices, stats.outstanding::text AS outstanding, stats.last_date,
        (SELECT m.id FROM sales_invoices m WHERE m.customer_id = c.id AND ${returnable("m")} AND m.invoice_no ILIKE ${invoiceNo} ORDER BY m.date DESC, m.id DESC LIMIT 1) AS matched_invoice_id
      FROM customers c
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS invoices, coalesce(sum(s.remaining_amount::numeric), 0) AS outstanding, max(s.date)::text AS last_date
        FROM sales_invoices s WHERE s.customer_id = c.id AND ${returnable("s")}
      ) stats
      WHERE c.status <> 'deleted' AND c.id <> ${cashId}
        AND (${normalizedSql(sql`c.name`)} LIKE ${name} OR ${normalizedSql(sql`c.full_name`)} LIKE ${name} OR ${normalizedSql(sql`c.business_name`)} LIKE ${name}
          OR (${phone}::text IS NOT NULL AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE ${phone})
          OR c.id = ${customerNo}
          OR EXISTS (SELECT 1 FROM sales_invoices m WHERE m.customer_id = c.id AND ${returnable("m")} AND ${invoiceMatch("m")}))
      ORDER BY stats.invoices DESC, c.id DESC
      LIMIT 15
    `),
    database.execute(sql`
      SELECT s.id, s.invoice_no, s.date::text AS date, s.customer_name, s.customer_phone, s.total::text AS total, s.customer_id
      FROM sales_invoices s
      WHERE (s.customer_id IS NULL OR s.customer_id = ${cashId}) AND ${returnable("s")} AND ${invoiceMatch("s")}
      ORDER BY s.date DESC, s.id DESC
      LIMIT 20
    `),
  ]);
  const invoiceRows = rows(invoices).map((row) => ({
    id: Number(row.id),
    invoiceNo: String(row.invoice_no ?? `SI-${row.id}`),
    date: String(row.date ?? ""),
    buyerName: row.customer_name ? String(row.customer_name) : null,
    buyerPhone: row.customer_phone ? String(row.customer_phone) : null,
    total: num(row.total),
    customerId: positiveId(row.customer_id),
  }));
  return {
    customers: rows(customers).map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ""),
      phone: String(row.phone ?? ""),
      code: row.code ? String(row.code) : `CUS-${String(row.id).padStart(6, "0")}`,
      customerType: String(row.customer_type ?? "retail"),
      invoices: Number(row.invoices ?? 0),
      outstanding: num(row.outstanding),
      lastInvoiceDate: row.last_date ? String(row.last_date) : null,
      matchedInvoiceId: positiveId(row.matched_invoice_id),
    })),
    walkInInvoices: invoiceRows.filter((row) => row.customerId != null),
    unlinkedInvoices: invoiceRows.filter((row) => row.customerId == null),
  };
}

// ── Building validated return lines ───────────────────────────────────────
export type ReturnItemInput = {
  productKey: string;
  quantity: number;
  condition: ReturnCondition;
  allocations?: { invoiceItemId: number; quantity: number }[] | null;
};
type BuiltLine = {
  line: LineFacts;
  quantityMilli: number;
  amountCents: number;
  condition: ReturnCondition;
};

/** Lock the involved original lines, then allocate and price against fresh facts. */
async function buildReturnLines(tx: Transaction, actor: SalesReturnActor, customerId: number, items: ReturnItemInput[], excludeReturnId: number | null, lock: boolean, allocationsAuthorized = false, scope: number[] | null = null): Promise<BuiltLine[]> {
  if (!items.length) throw new SalesReturnError("أضف منتجاً واحداً على الأقل للمرتجع", 422, "VALIDATION_ERROR");
  const keys = new Set<string>();
  for (const item of items) {
    if (keys.has(item.productKey)) throw new SalesReturnError("المنتج مكرر في المرتجع", 422, "VALIDATION_ERROR");
    keys.add(item.productKey);
    if (!RETURN_CONDITIONS.some((condition) => condition.code === item.condition))
      throw new SalesReturnError("حالة المنتج المرتجع غير صالحة", 422, "VALIDATION_ERROR");
  }
  const candidates = await readCustomerLines(tx, customerId, { excludeReturnId, invoiceIds: scope });
  const involved = candidates.filter((line) => keys.has(line.productKey)).map((line) => line.invoiceItemId).sort((a, b) => a - b);
  if (!involved.length) throw new SalesReturnError("المنتجات المحددة غير موجودة في فواتير هذا العميل", 409);
  // Same lock order for every writer: original invoice lines by ascending id.
  if (lock) await tx.execute(sql`SELECT id FROM sales_invoice_items WHERE id IN (${idList(involved)}) ORDER BY id FOR UPDATE`);
  const fresh = lock ? await readCustomerLines(tx, customerId, { excludeReturnId, itemIds: involved, invoiceIds: scope }) : candidates.filter((line) => involved.includes(line.invoiceItemId));
  const built: BuiltLine[] = [];
  for (const item of items) {
    const lines = fresh.filter((line) => line.productKey === item.productKey);
    if (!lines.length) throw new SalesReturnError("أحد المنتجات لم يعد قابلاً للإرجاع من فواتير هذا العميل", 409);
    const requestedMilli = toMilli(item.quantity);
    if (requestedMilli <= 0) throw new SalesReturnError(`كمية «${lines[0].productName}» يجب أن تكون أكبر من صفر`, 422, "VALIDATION_ERROR");
    let allocations: ReturnAllocation[];
    try {
      const fifo = allocateFifo(lines, requestedMilli);
      if (item.allocations && item.allocations.length) {
        const manual = validateAllocation(lines, requestedMilli, item.allocations.map((allocation) => ({ invoiceItemId: Number(allocation.invoiceItemId), quantityMilli: toMilli(allocation.quantity) })));
        const differs = manual.length !== fifo.length || manual.some((allocation) => fifo.find((row) => row.invoiceItemId === allocation.invoiceItemId)?.quantityMilli !== allocation.quantityMilli);
        // Stored allocations were authorized when saved; only new manual splits need the permission.
        if (differs && !allocationsAuthorized) requireReturnPermission(actor, "sales_returns.allocation_override", "تعديل توزيع الكميات على الفواتير يتطلب صلاحية خاصة");
        allocations = manual;
      } else allocations = fifo;
    } catch (cause) {
      if (cause instanceof SalesReturnRuleError) throw new SalesReturnError(`«${lines[0].productName}»: ${cause.message}`, cause.status, cause.status === 422 ? "VALIDATION_ERROR" : "CONFLICT");
      throw cause;
    }
    for (const allocation of allocations) {
      const line = lines.find((row) => row.invoiceItemId === allocation.invoiceItemId)!;
      const amountCents = returnAmountCents({
        lineQuantityMilli: line.quantityMilli,
        lineRefundableCents: line.refundableCents,
        quantityMilli: allocation.quantityMilli,
        consumedQuantityMilli: line.consumedMilli,
        consumedAmountCents: line.consumedAmountCents,
      });
      built.push({ line, quantityMilli: allocation.quantityMilli, amountCents, condition: item.condition });
    }
  }
  return built;
}

async function writeReturnItems(tx: Transaction, returnId: number, lines: BuiltLine[]) {
  await tx.execute(sql`DELETE FROM sales_return_items WHERE return_id = ${returnId}`);
  for (const built of lines) {
    const { line } = built;
    await tx.execute(sql`
      INSERT INTO sales_return_items (return_id, invoice_id, invoice_item_id, product_id, product_key, product_name, unit_snapshot,
        quantity, original_unit_price, net_unit_amount, amount, condition, track_inventory)
      VALUES (${returnId}, ${line.invoiceId}, ${line.invoiceItemId}, ${line.productId}, ${line.productKey}, ${line.productName}, ${line.unit},
        ${String(fromMilli(built.quantityMilli))}, ${String(line.unitPrice)},
        ${String(line.quantityMilli > 0 ? (fromCents(line.refundableCents) / fromMilli(line.quantityMilli)).toFixed(4) : 0)},
        ${String(fromCents(built.amountCents))}, ${built.condition}, ${line.trackInventory && line.productId != null})
    `);
  }
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantityMilli, 0);
  const totalAmount = lines.reduce((sum, line) => sum + line.amountCents, 0);
  return { totalQuantity: fromMilli(totalQuantity), totalAmount: fromCents(totalAmount) };
}

/** Rebuild a stored return's request from its rows (to re-validate on submit). */
async function storedItemInputs(tx: Executor, returnId: number): Promise<ReturnItemInput[]> {
  const stored = rows(await tx.execute(sql`SELECT product_key, invoice_item_id, quantity::text AS quantity, condition FROM sales_return_items WHERE return_id = ${returnId} ORDER BY id`));
  const byKey = new Map<string, ReturnItemInput>();
  for (const row of stored) {
    const item = byKey.get(row.product_key) ?? { productKey: String(row.product_key), quantity: 0, condition: row.condition as ReturnCondition, allocations: [] };
    item.quantity = fromMilli(toMilli(item.quantity) + toMilli(row.quantity));
    item.allocations!.push({ invoiceItemId: Number(row.invoice_item_id), quantity: num(row.quantity) });
    byKey.set(row.product_key, item);
  }
  return [...byKey.values()];
}

// ── Create / edit / submit ─────────────────────────────────────────────────
export type SaveReturnInput = {
  customerId: number;
  returnDate?: string | null;
  warehouseId?: number | null;
  reasonCode: string;
  notes?: string | null;
  attachmentUrl?: string | null;
  employeeId?: number | null;
  settlementPlan?: Record<string, unknown>;
  items: ReturnItemInput[];
  submit: boolean;
  expectedVersion?: number | null;
  idempotencyKey: string;
  /** The invoice the return was opened from; required for the walk-in customer. */
  invoiceId?: number | null;
};

function normalizeHeader(input: SaveReturnInput) {
  if (!RETURN_REASONS.some((reason) => reason.code === input.reasonCode))
    throw new SalesReturnError("حدد سبب الإرجاع", 422, "VALIDATION_ERROR");
  if (input.reasonCode === "other" && !text(input.notes))
    throw new SalesReturnError("اكتب ملاحظة توضح سبب الإرجاع الآخر", 422, "VALIDATION_ERROR");
  const returnDate = input.returnDate && /^\d{4}-\d{2}-\d{2}$/.test(input.returnDate) ? input.returnDate : today();
  const attachment = text(input.attachmentUrl, 1000);
  if (attachment && !/^https?:\/\//i.test(attachment)) throw new SalesReturnError("رابط المرفق يجب أن يبدأ بـ http", 422, "VALIDATION_ERROR");
  return { returnDate, notes: text(input.notes), attachment, warehouseId: positiveId(input.warehouseId), employeeId: positiveId(input.employeeId) };
}

async function staffName(tx: Executor, staffId: number | null) {
  if (!staffId) return null;
  const [row] = rows(await tx.execute(sql`SELECT id, coalesce(nullif(full_name, ''), username) AS name, is_active FROM staff WHERE id = ${staffId}`));
  if (!row) throw new SalesReturnError("الموظف المسؤول غير موجود", 422, "VALIDATION_ERROR");
  return String(row.name ?? "");
}

async function lockReturn(tx: Executor, returnId: number) {
  const [row] = rows(await tx.execute(sql`SELECT * FROM sales_returns WHERE id = ${returnId} FOR UPDATE`));
  if (!row) throw new SalesReturnError("المرتجع غير موجود", 404, "NOT_FOUND");
  return row;
}

export async function saveSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, input: SaveReturnInput, returnId: number | null) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.create", "ليس لديك صلاحية إنشاء أو تعديل مرتجعات المبيعات");
  const header = normalizeHeader(input);
  const key = (input.idempotencyKey ?? "").trim().slice(0, 120);
  if (!returnId && key.length < 8) throw new SalesReturnError("مفتاح منع التكرار مطلوب", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    if (!returnId) {
      const [replay] = rows(await tx.execute(sql`SELECT id, customer_id FROM sales_returns WHERE idempotency_key = ${key}`));
      if (replay) {
        if (Number(replay.customer_id) !== input.customerId) throw new SalesReturnError("مفتاح التكرار مستخدم لمرتجع عميل آخر", 409);
        return { id: Number(replay.id), replayed: true };
      }
    }
    // Customer first, then the return row, then original lines (a fixed lock order).
    const customer = await readCustomer(tx, input.customerId, true);
    let current: any = null;
    if (returnId) {
      current = await lockReturn(tx, returnId);
      if (current.status !== "draft") throw new SalesReturnError("يمكن تعديل المرتجع وهو مسودة فقط", 409);
      if (Number(current.customer_id) !== input.customerId) throw new SalesReturnError("لا يمكن تغيير عميل المرتجع؛ أنشئ مرتجعاً جديداً", 409);
      if (input.expectedVersion != null && Number(current.version) !== Number(input.expectedVersion))
        throw new SalesReturnError("تغيّر المرتجع من مستخدم آخر؛ حدّث الصفحة قبل الحفظ", 409, "STALE_DATA");
    }
    const employeeName = (await staffName(tx, header.employeeId)) ?? "";
    const scope = await invoiceScope(tx, customer, { returnId, invoiceId: input.invoiceId });
    const built = await buildReturnLines(tx, actor, input.customerId, input.items, returnId, input.submit, false, scope);
    const status = input.submit ? "pending_approval" : "draft";
    let id = returnId;
    if (!id) {
      const [created] = rows(await tx.execute(sql`
        INSERT INTO sales_returns (return_no, customer_id, status, return_date, warehouse_id, reason_code, notes, attachment_url,
          employee_id, employee_name, settlement_plan, idempotency_key, created_by, created_by_name, submitted_at, submitted_by)
        VALUES (${`TMP-${randomUUID().slice(0, 20)}`}, ${input.customerId}, ${status}, ${header.returnDate}, ${header.warehouseId}, ${input.reasonCode},
          ${header.notes}, ${header.attachment}, ${header.employeeId}, ${employeeName}, ${JSON.stringify(input.settlementPlan ?? {})}::jsonb,
          ${key}, ${actor.id}, ${actor.name}, ${input.submit ? sql`now()` : null}, ${input.submit ? actor.id : null})
        RETURNING id
      `));
      id = Number(created.id);
      await tx.execute(sql`UPDATE sales_returns SET return_no = 'RET-' || lpad(id::text, 6, '0') WHERE id = ${id}`);
      await addEvent(tx, id, "created", actor, null, { status });
    } else {
      await tx.execute(sql`
        UPDATE sales_returns SET status = ${status}, return_date = ${header.returnDate}, warehouse_id = ${header.warehouseId},
          reason_code = ${input.reasonCode}, notes = ${header.notes}, attachment_url = ${header.attachment},
          employee_id = ${header.employeeId}, employee_name = ${employeeName},
          settlement_plan = ${JSON.stringify(input.settlementPlan ?? {})}::jsonb,
          submitted_at = ${input.submit ? sql`now()` : null}, submitted_by = ${input.submit ? actor.id : null},
          version = version + 1, updated_at = now()
        WHERE id = ${id}
      `);
      await addEvent(tx, id, "edited", actor, null, { status });
    }
    const totals = await writeReturnItems(tx, id!, built);
    await tx.execute(sql`UPDATE sales_returns SET total_quantity = ${String(totals.totalQuantity)}, total_amount = ${String(totals.totalAmount)} WHERE id = ${id}`);
    if (input.submit) await addEvent(tx, id!, "submitted", actor, null, totals);
    return { id: id!, replayed: false };
  });
}

/** Draft → pending approval, re-validating every line under lock. */
export async function submitSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.create", "ليس لديك صلاحية إرسال المرتجع للموافقة");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (current.status === "pending_approval") return { id: returnId, replayed: true };
    if (current.status !== "draft") throw new SalesReturnError("يمكن إرسال المسودات فقط للموافقة", 409);
    const customer = await readCustomer(tx, Number(current.customer_id), true);
    const built = await buildReturnLines(tx, actor, Number(current.customer_id), await storedItemInputs(tx, returnId), returnId, true, true, await invoiceScope(tx, customer, { returnId }));
    const totals = await writeReturnItems(tx, returnId, built);
    await tx.execute(sql`
      UPDATE sales_returns SET status = 'pending_approval', total_quantity = ${String(totals.totalQuantity)}, total_amount = ${String(totals.totalAmount)},
        submitted_at = now(), submitted_by = ${actor.id}, version = version + 1, updated_at = now()
      WHERE id = ${returnId}
    `);
    await addEvent(tx, returnId, "submitted", actor, null, totals);
    return { id: returnId, replayed: false };
  });
}

// ── Receipt / approval / rejection / cancellation ─────────────────────────
export async function receiveSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, note: string | null) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.create") && !canReturn(actor, "sales_returns.inventory"))
    throw new SalesReturnError("ليس لديك صلاحية تأكيد استلام البضاعة المرتجعة", 403, "PERMISSION_DENIED");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (current.received_at) return { id: returnId, replayed: true };
    if (!["pending_approval", "approved", "completed"].includes(current.status)) throw new SalesReturnError("أرسل المرتجع للموافقة قبل تأكيد استلام البضاعة", 409);
    await tx.execute(sql`UPDATE sales_returns SET received_at = now(), received_by = ${actor.id}, received_by_name = ${actor.name}, version = version + 1, updated_at = now() WHERE id = ${returnId}`);
    await addEvent(tx, returnId, "received", actor, note);
    return { id: returnId, replayed: false };
  });
}

export async function approveSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, note: string | null) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.approve", "اعتماد المرتجعات يتطلب صلاحية الموافقة");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (current.status === "approved" || current.status === "completed") return { id: returnId, replayed: true };
    if (current.status !== "pending_approval") throw new SalesReturnError("يمكن اعتماد المرتجعات المرسلة للموافقة فقط", 409);
    const customer = await readCustomer(tx, Number(current.customer_id), true);
    // Original lines may have changed since submission (invoice cancelled or
    // another return approved): re-validate against fresh, locked facts.
    const built = await buildReturnLines(tx, actor, Number(current.customer_id), await storedItemInputs(tx, returnId), returnId, true, true, await invoiceScope(tx, customer, { returnId }));
    const totals = await writeReturnItems(tx, returnId, built);
    if (toCents(totals.totalAmount) !== toCents(current.total_amount))
      await addEvent(tx, returnId, "amount_recalculated", actor, null, { previous: num(current.total_amount), next: totals.totalAmount });
    await tx.execute(sql`
      UPDATE sales_returns SET status = 'approved', total_quantity = ${String(totals.totalQuantity)}, total_amount = ${String(totals.totalAmount)},
        approved_at = now(), approved_by = ${actor.id}, approved_by_name = ${actor.name}, approval_note = ${note},
        version = version + 1, updated_at = now()
      WHERE id = ${returnId}
    `);
    await addEvent(tx, returnId, "approved", actor, note, totals);
    return { id: returnId, replayed: false };
  });
}

export async function rejectSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, reason: string) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.approve", "رفض المرتجعات يتطلب صلاحية الموافقة");
  if (!text(reason)) throw new SalesReturnError("سبب الرفض مطلوب", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (current.status === "rejected") return { id: returnId, replayed: true };
    if (current.status !== "pending_approval") throw new SalesReturnError("يمكن رفض المرتجعات المرسلة للموافقة فقط", 409);
    await tx.execute(sql`UPDATE sales_returns SET status = 'rejected', rejected_at = now(), rejected_by = ${actor.id}, rejection_reason = ${text(reason)}, version = version + 1, updated_at = now() WHERE id = ${returnId}`);
    await addEvent(tx, returnId, "rejected", actor, text(reason));
    return { id: returnId, replayed: false };
  });
}

export async function cancelSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, reason: string) {
  await requireReady(database);
  if (!text(reason)) throw new SalesReturnError("سبب الإلغاء مطلوب", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (current.status === "cancelled") return { id: returnId, replayed: true };
    if (!["draft", "pending_approval"].includes(current.status)) throw new SalesReturnError("يمكن إلغاء المسودات والمرتجعات غير المعتمدة فقط؛ المعتمد يُعكس", 409);
    const own = Number(current.created_by) === actor.id;
    if (!(own && canReturn(actor, "sales_returns.create")) && !canReturn(actor, "sales_returns.approve"))
      throw new SalesReturnError("ليس لديك صلاحية إلغاء هذا المرتجع", 403, "PERMISSION_DENIED");
    await tx.execute(sql`UPDATE sales_returns SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${actor.id}, cancellation_reason = ${text(reason)}, version = version + 1, updated_at = now() WHERE id = ${returnId}`);
    await addEvent(tx, returnId, "cancelled", actor, text(reason));
    return { id: returnId, replayed: false };
  });
}

// ── Inventory ─────────────────────────────────────────────────────────────
async function stockOwnerId(tx: Executor, productId: number) {
  let current = productId;
  const visited = new Set<number>();
  for (let depth = 0; depth < 20; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const [row] = rows(await tx.execute(sql`SELECT id, shared_stock_product_id FROM products WHERE id = ${current}`));
    if (!row) throw new SalesReturnError("أحد منتجات المرتجع لم يعد موجوداً في الكتالوج", 409);
    const next = positiveId(row.shared_stock_product_id);
    if (!next) return current;
    current = next;
  }
  return current;
}

/** One stock movement per item and purpose; the unique key makes replays no-ops. */
async function moveStock(tx: Executor, item: any, ret: any, actor: SalesReturnActor, purpose: "restock" | "inspection" | "damaged" | "unsellable" | "reversal", quantity: number) {
  const ownerId = await stockOwnerId(tx, Number(item.product_id));
  const reason = { restock: "customer_return_restock", inspection: "customer_return_inspection_hold", damaged: "customer_return_damaged", unsellable: "customer_return_unsellable", reversal: "customer_return_reversal_deduct" }[purpose];
  const [inserted] = rows(await tx.execute(sql`
    INSERT INTO stock_movements (product_id, stock_source_product_id, quantity_change, reason, related_type, related_id,
      sales_invoice_id, sales_invoice_item_id, invoice_number, warehouse_id, movement_type, idempotency_key, metadata, created_by, created_by_name)
    VALUES (${Number(item.product_id)}, ${ownerId}, ${String(quantity)}, ${reason}, 'sales_return', ${Number(ret.id)},
      ${Number(item.invoice_id)}, ${Number(item.invoice_item_id)}, ${item.invoice_no ?? null}, ${positiveId(ret.warehouse_id)}, 'sales_return',
      ${`sales_return_item:${item.id}:${purpose}`}, ${JSON.stringify({ returnNo: ret.return_no, condition: item.condition })}::jsonb, ${actor.id}, ${actor.name})
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id
  `));
  if (!inserted || quantity === 0) return { ownerId, moved: Boolean(inserted) };
  if (quantity > 0) {
    await tx.execute(sql`UPDATE products SET stock = stock + ${quantity}, updated_at = now() WHERE id = ${ownerId}`);
  } else {
    const [updated] = rows(await tx.execute(sql`UPDATE products SET stock = stock + ${quantity}, updated_at = now() WHERE id = ${ownerId} AND stock >= ${-quantity} RETURNING id`));
    if (!updated) throw new SalesReturnError(`مخزون «${item.product_name}» أقل من الكمية المرتجعة؛ يبدو أنها بيعت. استخدم تصحيح مخزون موثقاً بدل العكس التلقائي`, 409);
  }
  const warehouseId = positiveId(ret.warehouse_id);
  if (warehouseId) {
    if (quantity > 0) {
      await tx.execute(sql`
        INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES (${warehouseId}, ${ownerId}, ${String(quantity)})
        ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = warehouse_stock.quantity + excluded.quantity, updated_at = now()
      `);
    } else {
      await tx.execute(sql`UPDATE warehouse_stock SET quantity = greatest(quantity + ${quantity}, 0), updated_at = now() WHERE warehouse_id = ${warehouseId} AND product_id = ${ownerId}`);
    }
  }
  return { ownerId, moved: true };
}

async function maybeComplete(tx: Executor, returnId: number, actor: SalesReturnActor) {
  const [state] = rows(await tx.execute(sql`
    SELECT r.status, r.total_amount::numeric AS total,
      (SELECT count(*) FROM sales_return_items i WHERE i.return_id = r.id AND i.inventory_state = 'pending')::int AS pending_items,
      ${settledSql(sql`r.id`)} AS settled
    FROM sales_returns r WHERE r.id = ${returnId}
  `));
  if (state?.status !== "approved" || Number(state.pending_items) > 0) return false;
  if (toCents(state.settled) < toCents(state.total)) return false;
  await tx.execute(sql`UPDATE sales_returns SET status = 'completed', completed_at = now(), version = version + 1, updated_at = now() WHERE id = ${returnId}`);
  await addEvent(tx, returnId, "completed", actor);
  return true;
}

/** Inventory acceptance after approval and physical receipt, by item condition. */
export async function acceptSalesReturnInventory(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, conditions: { itemId: number; condition: ReturnCondition }[]) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.inventory", "قبول المخزون المرتجع يتطلب صلاحية المخزون");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (!["approved", "completed"].includes(current.status)) throw new SalesReturnError("اعتمد المرتجع قبل قبول المخزون", 409);
    if (!current.received_at) throw new SalesReturnError("أكّد استلام البضاعة فعلياً قبل قبول المخزون", 409);
    const items = rows(await tx.execute(sql`
      SELECT i.*, s.invoice_no FROM sales_return_items i JOIN sales_invoices s ON s.id = i.invoice_id
      WHERE i.return_id = ${returnId} AND i.inventory_state = 'pending' ORDER BY i.product_id NULLS LAST, i.id FOR UPDATE OF i
    `));
    const processed: { itemId: number; state: string }[] = [];
    for (const item of items) {
      const override = conditions.find((row) => row.itemId === Number(item.id))?.condition;
      if (override && !RETURN_CONDITIONS.some((condition) => condition.code === override)) throw new SalesReturnError("حالة المنتج غير صالحة", 422, "VALIDATION_ERROR");
      const condition = (override ?? item.condition) as ReturnCondition;
      let state: string;
      if (!item.track_inventory || !item.product_id) state = "not_tracked";
      else if (condition === "good") {
        await moveStock(tx, item, current, actor, "restock", num(item.quantity));
        state = "restocked";
      } else {
        await moveStock(tx, item, current, actor, condition, 0);
        state = condition;
      }
      await tx.execute(sql`
        UPDATE sales_return_items SET condition = ${condition}, inventory_state = ${state}, inventory_processed_at = now(), inventory_processed_by = ${actor.id}
        WHERE id = ${Number(item.id)} AND inventory_state = 'pending'
      `);
      processed.push({ itemId: Number(item.id), state });
    }
    if (processed.length) {
      await tx.execute(sql`UPDATE sales_returns SET inventory_completed_at = now(), version = version + 1, updated_at = now() WHERE id = ${returnId}`);
      await addEvent(tx, returnId, "inventory_accepted", actor, null, { items: processed });
    }
    await maybeComplete(tx, returnId, actor);
    return { id: returnId, processed };
  });
}

/** An inspection hold is later released to sale or written off as damaged. */
export async function resolveInspection(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, itemId: number, decision: "restock" | "damaged", note: string | null) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.inventory", "قرار الفحص يتطلب صلاحية المخزون");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (!["approved", "completed"].includes(current.status)) throw new SalesReturnError("المرتجع غير معتمد أو معكوس", 409);
    const [item] = rows(await tx.execute(sql`
      SELECT i.*, s.invoice_no FROM sales_return_items i JOIN sales_invoices s ON s.id = i.invoice_id
      WHERE i.id = ${itemId} AND i.return_id = ${returnId} FOR UPDATE OF i
    `));
    if (!item) throw new SalesReturnError("بند المرتجع غير موجود", 404, "NOT_FOUND");
    if (item.inventory_state !== "inspection") throw new SalesReturnError("هذا البند ليس محجوزاً للفحص", 409);
    if (decision === "restock") await moveStock(tx, item, current, actor, "restock", num(item.quantity));
    else await moveStock(tx, item, current, actor, "damaged", 0);
    const state = decision === "restock" ? "restocked" : "damaged";
    await tx.execute(sql`UPDATE sales_return_items SET inventory_state = ${state}, condition = ${decision === "restock" ? "good" : "damaged"} WHERE id = ${itemId}`);
    await addEvent(tx, returnId, "inspection_resolved", actor, note, { itemId, decision });
    return { id: returnId, itemId, state };
  });
}

// ── Settlement ────────────────────────────────────────────────────────────
/** Value of the return already settled (refunds count while not rejected/cancelled). */
function settledSql(returnIdExpr: SQL) {
  return sql`(SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s
    LEFT JOIN financial_transactions f ON f.id = s.financial_transaction_id
    WHERE s.return_id = ${returnIdExpr} AND s.parent_settlement_id IS NULL AND (
      (s.kind IN ('invoice_credit','customer_credit') AND s.status = 'applied')
      OR (s.kind = 'refund' AND s.status = 'requested' AND f.approval_status IN ('draft','pending','executed'))
    ))`;
}

export type SettleInput = {
  invoiceCredit: number;
  customerCredit: number;
  refund: number;
  refundMethod?: "cash" | "transfer" | "card" | null;
  exchange?: boolean;
  note?: string | null;
  idempotencyKey: string;
};

export async function settleSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, input: SettleInput) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.settle", "التسوية المالية للمرتجع تتطلب صلاحية التسوية");
  const key = (input.idempotencyKey ?? "").trim().slice(0, 120);
  if (key.length < 8) throw new SalesReturnError("مفتاح منع التكرار مطلوب", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    const [replay] = rows(await tx.execute(sql`SELECT id FROM sales_return_settlements WHERE starts_with(idempotency_key, ${`${key}:`}) LIMIT 1`));
    if (replay) return { id: returnId, replayed: true };
    if (!["approved", "completed"].includes(current.status)) throw new SalesReturnError("اعتمد المرتجع قبل التسوية المالية", 409);
    const customerId = Number(current.customer_id);
    const customer = await readCustomer(tx, customerId, true);
    const [settledRow] = rows(await tx.execute(sql`SELECT ${settledSql(sql`${returnId}`)} AS settled`));
    const unsettled = toCents(current.total_amount) - toCents(settledRow?.settled);
    let plan;
    try {
      plan = validateSettlementPlan({ invoiceCredit: input.invoiceCredit, customerCredit: input.customerCredit, refund: input.refund, refundMethod: input.refundMethod ?? null }, unsettled);
    } catch (cause) {
      if (cause instanceof SalesReturnRuleError) throw new SalesReturnError(cause.message, cause.status, cause.status === 422 ? "VALIDATION_ERROR" : "CONFLICT");
      throw cause;
    }
    // A credit on the shared walk-in account could be spent by another buyer.
    if (customer.isCashCustomer && plan.customerCreditCents > 0)
      throw new SalesReturnError("لا يمكن حفظ رصيد دائن على العميل النقدي؛ اخصم من الفاتورة نفسها أو اطلب استرداد المبلغ", 409);
    const written: { kind: string; amount: number; invoiceId?: number }[] = [];
    if (plan.invoiceCreditCents > 0) {
      // The return's own source invoices first (oldest first), then the
      // customer's other open invoices — never another customer's invoice.
      // The walk-in customer's other invoices belong to other buyers.
      const open = rows(await tx.execute(sql`
        SELECT s.id, s.date::text AS date,
          EXISTS (SELECT 1 FROM sales_return_items ri WHERE ri.return_id = ${returnId} AND ri.invoice_id = s.id) AS is_source
        FROM sales_invoices s
        WHERE s.customer_id = ${customerId} AND s.status = 'active' AND s.financially_reversed = false AND s.remaining_amount::numeric > 0
          AND ${selfOwnedInvoice(sql`s.id`)}
          ${customer.isCashCustomer ? sql`AND EXISTS (SELECT 1 FROM sales_return_items ri WHERE ri.return_id = ${returnId} AND ri.invoice_id = s.id)` : sql``}
        ORDER BY s.id FOR UPDATE
      `));
      const fresh = [];
      for (const invoice of open) {
        const state = await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: Number(invoice.id) });
        fresh.push({ invoiceId: Number(invoice.id), date: String(invoice.date), isSource: invoice.is_source === true, remainingCents: toCents(state?.remainingAmount) });
      }
      fresh.sort((a, b) => Number(b.isSource) - Number(a.isSource) || a.date.localeCompare(b.date) || a.invoiceId - b.invoiceId);
      let allocations;
      try {
        allocations = allocateInvoiceCredit(fresh, plan.invoiceCreditCents);
      } catch (cause) {
        if (cause instanceof SalesReturnRuleError) throw new SalesReturnError(cause.message, cause.status);
        throw cause;
      }
      for (const allocation of allocations) {
        await tx.execute(sql`
          INSERT INTO sales_return_settlements (return_id, customer_id, kind, invoice_id, amount, status, note, idempotency_key, created_by, created_by_name)
          VALUES (${returnId}, ${customerId}, 'invoice_credit', ${allocation.invoiceId}, ${String(fromCents(allocation.amountCents))}, 'applied',
            ${text(input.note)}, ${`${key}:invoice:${allocation.invoiceId}`}, ${actor.id}, ${actor.name})
        `);
        await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: allocation.invoiceId });
        written.push({ kind: "invoice_credit", amount: fromCents(allocation.amountCents), invoiceId: allocation.invoiceId });
      }
    }
    if (plan.customerCreditCents > 0) {
      await tx.execute(sql`
        INSERT INTO sales_return_settlements (return_id, customer_id, kind, amount, status, is_exchange, note, idempotency_key, created_by, created_by_name)
        VALUES (${returnId}, ${customerId}, 'customer_credit', ${String(fromCents(plan.customerCreditCents))}, 'applied', ${input.exchange === true},
          ${text(input.note)}, ${`${key}:credit`}, ${actor.id}, ${actor.name})
      `);
      written.push({ kind: "customer_credit", amount: fromCents(plan.customerCreditCents) });
    }
    if (plan.refundCents > 0) {
      // Cash can only go back for money the customer actually paid on the
      // return's source invoices, net of refunds already requested on them.
      const [cap] = rows(await tx.execute(sql`
        WITH sources AS (SELECT DISTINCT invoice_id FROM sales_return_items WHERE return_id = ${returnId}),
        related AS (SELECT DISTINCT ri.return_id FROM sales_return_items ri WHERE ri.invoice_id IN (SELECT invoice_id FROM sources))
        SELECT (SELECT coalesce(sum(s.paid_amount::numeric), 0) FROM sales_invoices s WHERE s.id IN (SELECT invoice_id FROM sources))::text AS paid,
               (SELECT coalesce(sum(x.amount::numeric), 0) FROM sales_return_settlements x
                JOIN financial_transactions f ON f.id = x.financial_transaction_id
                WHERE x.kind = 'refund' AND x.status = 'requested' AND x.return_id IN (SELECT return_id FROM related)
                  AND f.approval_status IN ('draft','pending','executed'))::text AS refunded
      `));
      const refundable = toCents(cap?.paid) - toCents(cap?.refunded);
      if (plan.refundCents > refundable)
        throw new SalesReturnError(`لا يمكن استرجاع ${fromCents(plan.refundCents)} نقداً: المدفوع فعلياً على فواتير المرتجع المتبقي للاسترجاع ${fromCents(Math.max(refundable, 0))}. اجعل الباقي خصماً من المديونية أو رصيداً دائناً`, 409);
      const method = input.refundMethod === "transfer" ? "transfer" : input.refundMethod === "card" ? "card" : "cash";
      const transaction = await createSourceFinancialRequest(
        {
          transactionDate: today(),
          direction: "expense",
          amount: fromCents(plan.refundCents),
          department: "store",
          transactionType: "sales_return_refund",
          description: `استرجاع مبلغ مرتجع مبيعات ${current.return_no}`,
          paymentMethod: method,
          sourceType: "sales_return",
          sourceId: String(returnId),
          sourceEvent: "refund",
          idempotencyKey: `sales_return:${returnId}:refund:${key}`,
          customerId,
          customerName: customer.name,
          customerPhone: customer.phone,
          notes: text(input.note),
        } as any,
        financialActorOf(actor),
        tx,
      );
      const transactionId = Number((transaction as any)?.id);
      if (!transactionId) throw new Error("Sales return refund request was not created");
      await tx.execute(sql`
        INSERT INTO sales_return_settlements (return_id, customer_id, kind, amount, status, payment_method, financial_transaction_id, note, idempotency_key, created_by, created_by_name)
        VALUES (${returnId}, ${customerId}, 'refund', ${String(fromCents(plan.refundCents))}, 'requested', ${method}, ${transactionId}, ${text(input.note)},
          ${`${key}:refund`}, ${actor.id}, ${actor.name})
      `);
      written.push({ kind: "refund", amount: fromCents(plan.refundCents) });
    }
    await tx.execute(sql`UPDATE sales_returns SET version = version + 1, updated_at = now() WHERE id = ${returnId}`);
    await addEvent(tx, returnId, "settled", actor, text(input.note), { settlements: written, exchange: input.exchange === true });
    await maybeComplete(tx, returnId, actor);
    return { id: returnId, replayed: false, settlements: written };
  });
}

/** Use the customer's available return credit on one of their open invoices. */
export async function applyCustomerCredit(database: SalesReturnDatabase, actor: SalesReturnActor, input: { customerId: number; invoiceId: number; amount: number; idempotencyKey: string }) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.settle", "استخدام الرصيد الدائن يتطلب صلاحية التسوية");
  const key = (input.idempotencyKey ?? "").trim().slice(0, 120);
  if (key.length < 8) throw new SalesReturnError("مفتاح منع التكرار مطلوب", 422, "VALIDATION_ERROR");
  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new SalesReturnError("مبلغ الاستخدام يجب أن يكون أكبر من صفر", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    const [replay] = rows(await tx.execute(sql`SELECT id FROM sales_return_settlements WHERE starts_with(idempotency_key, ${`${key}:`}) LIMIT 1`));
    if (replay) return { replayed: true };
    await readCustomer(tx, input.customerId, true);
    const credits = rows(await tx.execute(sql`
      SELECT c.id, c.return_id, c.amount::numeric - coalesce((SELECT sum(ch.amount::numeric) FROM sales_return_settlements ch
        WHERE ch.parent_settlement_id = c.id AND ch.status = 'applied'), 0) AS available
      FROM sales_return_settlements c
      WHERE c.customer_id = ${input.customerId} AND c.kind = 'customer_credit' AND c.status = 'applied'
      ORDER BY c.id FOR UPDATE
    `)).filter((row) => toCents(row.available) > 0);
    const available = credits.reduce((sum, row) => sum + toCents(row.available), 0);
    if (amountCents > available) throw new SalesReturnError(`الرصيد الدائن المتاح ${fromCents(available)} أقل من المبلغ المطلوب`, 409);
    const [invoice] = rows(await tx.execute(sql`SELECT s.id, s.customer_id, s.status, s.financially_reversed, s.invoice_no, ${selfOwnedInvoice(sql`s.id`)} AS self_owned
      FROM sales_invoices s WHERE s.id = ${input.invoiceId} FOR UPDATE OF s`));
    if (!invoice) throw new SalesReturnError("الفاتورة غير موجودة", 404, "NOT_FOUND");
    if (Number(invoice.customer_id) !== input.customerId) throw new SalesReturnError("الفاتورة لا تخص هذا العميل", 409);
    if (invoice.status !== "active" || invoice.financially_reversed) throw new SalesReturnError("لا يمكن استخدام الرصيد على فاتورة ملغاة أو معكوسة", 409);
    if (invoice.self_owned !== true) throw new SalesReturnError("هذه الفاتورة تتبع طلب تخرج أو بحث؛ سدّدها من قسمها", 409);
    const state = await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: input.invoiceId });
    if (amountCents > toCents(state?.remainingAmount)) throw new SalesReturnError(`المبلغ أكبر من المتبقي على الفاتورة (${num(state?.remainingAmount)})`, 409);
    let left = amountCents;
    const used: { creditId: number; amount: number }[] = [];
    for (const credit of credits) {
      if (left <= 0) break;
      const take = Math.min(toCents(credit.available), left);
      await tx.execute(sql`
        INSERT INTO sales_return_settlements (return_id, customer_id, kind, invoice_id, parent_settlement_id, amount, status, idempotency_key, created_by, created_by_name)
        VALUES (${Number(credit.return_id)}, ${input.customerId}, 'invoice_credit', ${input.invoiceId}, ${Number(credit.id)}, ${String(fromCents(take))}, 'applied',
          ${`${key}:credit:${credit.id}`}, ${actor.id}, ${actor.name})
      `);
      await addEvent(tx, Number(credit.return_id), "credit_applied", actor, null, { invoiceId: input.invoiceId, invoiceNo: invoice.invoice_no, amount: fromCents(take) });
      used.push({ creditId: Number(credit.id), amount: fromCents(take) });
      left -= take;
    }
    await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: input.invoiceId });
    return { replayed: false, used };
  });
}

/** Undo one applied debt deduction (direct or from credit); the invoice debt returns. */
export async function reverseSettlement(database: SalesReturnDatabase, actor: SalesReturnActor, settlementId: number, reason: string) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.settle", "عكس التسوية يتطلب صلاحية التسوية");
  if (!text(reason)) throw new SalesReturnError("سبب العكس مطلوب", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    const [settlement] = rows(await tx.execute(sql`SELECT * FROM sales_return_settlements WHERE id = ${settlementId}`));
    if (!settlement) throw new SalesReturnError("التسوية غير موجودة", 404, "NOT_FOUND");
    await lockReturn(tx, Number(settlement.return_id));
    const [locked] = rows(await tx.execute(sql`SELECT * FROM sales_return_settlements WHERE id = ${settlementId} FOR UPDATE`));
    if (locked.status === "reversed") return { replayed: true };
    if (locked.kind !== "invoice_credit" || locked.status !== "applied") throw new SalesReturnError("يمكن عكس الخصم من المديونية فقط؛ الرصيد والاسترجاع يُعكسان مع المرتجع", 409);
    await tx.execute(sql`SELECT id FROM sales_invoices WHERE id = ${Number(locked.invoice_id)} FOR UPDATE`);
    await tx.execute(sql`UPDATE sales_return_settlements SET status = 'reversed', reversed_at = now(), reversed_by = ${actor.id}, reversal_reason = ${text(reason)} WHERE id = ${settlementId}`);
    await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: Number(locked.invoice_id) });
    const returnId = Number(locked.return_id);
    const [ret] = rows(await tx.execute(sql`SELECT status FROM sales_returns WHERE id = ${returnId}`));
    if (ret?.status === "completed" && locked.parent_settlement_id == null)
      await tx.execute(sql`UPDATE sales_returns SET status = 'approved', completed_at = NULL, version = version + 1, updated_at = now() WHERE id = ${returnId}`);
    await addEvent(tx, returnId, "settlement_reversed", actor, text(reason), { settlementId, invoiceId: Number(locked.invoice_id), amount: num(locked.amount) });
    return { replayed: false };
  });
}

// ── Reversal of a whole approved/completed return ─────────────────────────
export async function reverseSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number, reason: string) {
  await requireReady(database);
  requireReturnPermission(actor, "sales_returns.reverse", "عكس المرتجع متاح للإدارة فقط");
  if (!text(reason)) throw new SalesReturnError("سبب عكس المرتجع مطلوب", 422, "VALIDATION_ERROR");
  return database.transaction(async (tx) => {
    const current = await lockReturn(tx, returnId);
    if (current.status === "reversed") return { id: returnId, replayed: true };
    if (!["approved", "completed"].includes(current.status)) throw new SalesReturnError("يمكن عكس المرتجعات المعتمدة أو المكتملة فقط؛ غير المعتمد يُلغى", 409);
    const settlements = rows(await tx.execute(sql`
      SELECT s.*, f.approval_status AS tx_status, f.transaction_no, inv.invoice_no,
        (SELECT coalesce(sum(ch.amount::numeric), 0) FROM sales_return_settlements ch WHERE ch.parent_settlement_id = s.id AND ch.status = 'applied') AS used
      FROM sales_return_settlements s
      LEFT JOIN financial_transactions f ON f.id = s.financial_transaction_id
      LEFT JOIN sales_invoices inv ON inv.id = s.invoice_id
      WHERE s.return_id = ${returnId} AND s.parent_settlement_id IS NULL
      ORDER BY s.id FOR UPDATE OF s
    `));
    const blockers: string[] = [];
    for (const settlement of settlements) {
      if (settlement.kind === "refund" && settlement.tx_status === "executed")
        blockers.push(`تم صرف مبلغ ${num(settlement.amount)} للعميل (${settlement.transaction_no ?? "طلب مالي"})؛ يلزم استرداد مالي موثق قبل العكس`);
      if (settlement.kind === "customer_credit" && settlement.status === "applied" && toCents(settlement.used) > 0)
        blockers.push(`استُخدم ${num(settlement.used)} من الرصيد الدائن على فواتير أخرى؛ اعكس الاستخدام أولاً من تفاصيل المرتجع`);
    }
    const items = rows(await tx.execute(sql`
      SELECT i.*, s.invoice_no FROM sales_return_items i JOIN sales_invoices s ON s.id = i.invoice_id
      WHERE i.return_id = ${returnId} ORDER BY i.product_id NULLS LAST, i.id FOR UPDATE OF i
    `));
    for (const item of items.filter((row) => row.inventory_state === "restocked")) {
      const ownerId = await stockOwnerId(tx, Number(item.product_id));
      const [stock] = rows(await tx.execute(sql`SELECT stock::numeric AS stock FROM products WHERE id = ${ownerId} FOR UPDATE`));
      if (num(stock?.stock) < num(item.quantity))
        blockers.push(`«${item.product_name}»: المخزون الحالي ${num(stock?.stock)} أقل من الكمية المرتجعة ${num(item.quantity)}؛ يبدو أنها بيعت. صحّح المخزون أولاً`);
    }
    if (blockers.length) throw new SalesReturnError(`لا يمكن عكس المرتجع تلقائياً:\n• ${blockers.join("\n• ")}`, 409);
    for (const settlement of settlements) {
      if (settlement.kind === "invoice_credit" && settlement.status === "applied") {
        await tx.execute(sql`SELECT id FROM sales_invoices WHERE id = ${Number(settlement.invoice_id)} FOR UPDATE`);
        await tx.execute(sql`UPDATE sales_return_settlements SET status = 'reversed', reversed_at = now(), reversed_by = ${actor.id}, reversal_reason = ${text(reason)} WHERE id = ${Number(settlement.id)}`);
        await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: Number(settlement.invoice_id) });
      } else if (settlement.kind === "customer_credit" && settlement.status === "applied") {
        await tx.execute(sql`UPDATE sales_return_settlements SET status = 'reversed', reversed_at = now(), reversed_by = ${actor.id}, reversal_reason = ${text(reason)} WHERE id = ${Number(settlement.id)}`);
      } else if (settlement.kind === "refund" && settlement.status === "requested") {
        if (["draft", "pending"].includes(String(settlement.tx_status)))
          await cancelFinancialTransactionRequest(Number(settlement.financial_transaction_id), financialActorOf(actor), `عكس مرتجع ${current.return_no}: ${text(reason)}`, tx);
        await tx.execute(sql`UPDATE sales_return_settlements SET status = 'cancelled', reversed_at = now(), reversed_by = ${actor.id}, reversal_reason = ${text(reason)} WHERE id = ${Number(settlement.id)}`);
      }
    }
    for (const item of items) {
      if (item.inventory_state === "restocked") await moveStock(tx, item, current, actor, "reversal", -num(item.quantity));
      await tx.execute(sql`UPDATE sales_return_items SET inventory_state = 'reversed' WHERE id = ${Number(item.id)}`);
    }
    await tx.execute(sql`
      UPDATE sales_returns SET status = 'reversed', reversed_at = now(), reversed_by = ${actor.id}, reversed_by_name = ${actor.name},
        reversal_reason = ${text(reason)}, reversal_no = 'REV-' || lpad(id::text, 6, '0'), version = version + 1, updated_at = now()
      WHERE id = ${returnId}
    `);
    await addEvent(tx, returnId, "reversed", actor, text(reason));
    return { id: returnId, replayed: false };
  });
}

// ── Reads: details, list, summaries, reports ──────────────────────────────
function settlementStatusOf(row: any) {
  const total = toCents(row.total_amount);
  const settled = toCents(row.settled);
  if (["draft", "pending_approval", "rejected", "cancelled"].includes(row.status)) return "not_started";
  if (row.status === "reversed") return "reversed";
  if (settled <= 0) return "unsettled";
  if (settled < total) return "partial";
  return toCents(row.refund_pending) > 0 ? "refund_pending" : "settled";
}

export async function readSalesReturn(database: SalesReturnDatabase, actor: SalesReturnActor, returnId: number) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.view") && !canReturn(actor, "sales_returns.create"))
    throw new SalesReturnError("ليس لديك صلاحية عرض المرتجعات", 403, "PERMISSION_DENIED");
  const [ret] = rows(await database.execute(sql`
    SELECT r.*, ${settledSql(sql`r.id`)}::text AS settled,
      (SELECT name FROM warehouses w WHERE w.id = r.warehouse_id) AS warehouse_name
    FROM sales_returns r WHERE r.id = ${returnId}
  `));
  if (!ret) throw new SalesReturnError("المرتجع غير موجود", 404, "NOT_FOUND");
  const [customer, items, settlements, events] = await Promise.all([
    readCustomer(database, Number(ret.customer_id)),
    database.execute(sql`
      SELECT i.*, i.quantity::text AS quantity, i.amount::text AS amount, i.original_unit_price::text AS original_unit_price,
        i.net_unit_amount::text AS net_unit_amount, s.invoice_no, s.date::text AS invoice_date
      FROM sales_return_items i JOIN sales_invoices s ON s.id = i.invoice_id
      WHERE i.return_id = ${returnId} ORDER BY i.product_name, s.date, i.id
    `),
    database.execute(sql`
      SELECT s.*, s.amount::text AS amount, f.approval_status AS tx_status, f.transaction_no, inv.invoice_no,
        (SELECT coalesce(sum(ch.amount::numeric), 0) FROM sales_return_settlements ch WHERE ch.parent_settlement_id = s.id AND ch.status = 'applied')::text AS used
      FROM sales_return_settlements s
      LEFT JOIN financial_transactions f ON f.id = s.financial_transaction_id
      LEFT JOIN sales_invoices inv ON inv.id = s.invoice_id
      WHERE s.return_id = ${returnId} ORDER BY s.id
    `),
    database.execute(sql`SELECT * FROM sales_return_events WHERE return_id = ${returnId} ORDER BY created_at, id`),
  ]);
  const settlementRows = rows(settlements);
  const refundPending = settlementRows.filter((s) => s.kind === "refund" && s.status === "requested" && ["draft", "pending"].includes(String(s.tx_status))).reduce((sum, s) => sum + toCents(s.amount), 0);
  const status = String(ret.status);
  return {
    return: {
      id: Number(ret.id),
      returnNo: String(ret.return_no),
      status,
      returnDate: String(ret.return_date ?? "").slice(0, 10),
      warehouseId: positiveId(ret.warehouse_id),
      warehouseName: ret.warehouse_name ?? null,
      reasonCode: String(ret.reason_code ?? ""),
      notes: ret.notes ?? null,
      attachmentUrl: ret.attachment_url ?? null,
      employeeId: positiveId(ret.employee_id),
      employeeName: String(ret.employee_name ?? ""),
      totalQuantity: num(ret.total_quantity),
      totalAmount: num(ret.total_amount),
      settled: num(ret.settled),
      unsettled: fromCents(Math.max(toCents(ret.total_amount) - toCents(ret.settled), 0)),
      settlementStatus: settlementStatusOf({ ...ret, refund_pending: fromCents(refundPending) }),
      settlementPlan: ret.settlement_plan ?? {},
      version: Number(ret.version),
      createdByName: String(ret.created_by_name ?? ""),
      createdAt: iso(ret.created_at),
      submittedAt: iso(ret.submitted_at),
      receivedAt: iso(ret.received_at),
      receivedByName: ret.received_by_name ?? null,
      approvedAt: iso(ret.approved_at),
      approvedByName: ret.approved_by_name ?? null,
      approvalNote: ret.approval_note ?? null,
      rejectedAt: iso(ret.rejected_at),
      rejectionReason: ret.rejection_reason ?? null,
      cancelledAt: iso(ret.cancelled_at),
      cancellationReason: ret.cancellation_reason ?? null,
      inventoryCompletedAt: iso(ret.inventory_completed_at),
      completedAt: iso(ret.completed_at),
      reversedAt: iso(ret.reversed_at),
      reversedByName: ret.reversed_by_name ?? null,
      reversalReason: ret.reversal_reason ?? null,
      reversalNo: ret.reversal_no ?? null,
    },
    customer,
    items: rows(items).map((item) => ({
      id: Number(item.id),
      invoiceId: Number(item.invoice_id),
      invoiceNo: String(item.invoice_no ?? ""),
      invoiceDate: String(item.invoice_date ?? ""),
      invoiceItemId: Number(item.invoice_item_id),
      productId: positiveId(item.product_id),
      productKey: String(item.product_key),
      productName: String(item.product_name ?? ""),
      unit: item.unit_snapshot ?? null,
      quantity: num(item.quantity),
      originalUnitPrice: num(item.original_unit_price),
      netUnitAmount: num(item.net_unit_amount),
      amount: num(item.amount),
      condition: String(item.condition),
      inventoryState: String(item.inventory_state),
      trackInventory: item.track_inventory === true,
    })),
    settlements: settlementRows.map((settlement) => ({
      id: Number(settlement.id),
      kind: String(settlement.kind),
      invoiceId: positiveId(settlement.invoice_id),
      invoiceNo: settlement.invoice_no ?? null,
      parentSettlementId: positiveId(settlement.parent_settlement_id),
      amount: num(settlement.amount),
      used: num(settlement.used),
      status: String(settlement.status),
      isExchange: settlement.is_exchange === true,
      paymentMethod: settlement.payment_method ?? null,
      financialTransactionId: positiveId(settlement.financial_transaction_id),
      transactionNo: settlement.transaction_no ?? null,
      transactionStatus: settlement.tx_status ?? null,
      note: settlement.note ?? null,
      createdByName: String(settlement.created_by_name ?? ""),
      createdAt: iso(settlement.created_at),
      reversedAt: iso(settlement.reversed_at),
      reversalReason: settlement.reversal_reason ?? null,
    })),
    events: rows(events).map((event) => ({
      id: Number(event.id),
      event: String(event.event),
      actorName: String(event.actor_name ?? ""),
      note: event.note ?? null,
      metadata: event.metadata ?? {},
      createdAt: iso(event.created_at),
    })),
    permissions: {
      edit: status === "draft" && canReturn(actor, "sales_returns.create"),
      submit: status === "draft" && canReturn(actor, "sales_returns.create"),
      receive: !ret.received_at && ["pending_approval", "approved", "completed"].includes(status) && (canReturn(actor, "sales_returns.create") || canReturn(actor, "sales_returns.inventory")),
      approve: status === "pending_approval" && canReturn(actor, "sales_returns.approve"),
      cancel: ["draft", "pending_approval"].includes(status) && (canReturn(actor, "sales_returns.approve") || (Number(ret.created_by) === actor.id && canReturn(actor, "sales_returns.create"))),
      inventory: ["approved", "completed"].includes(status) && Boolean(ret.received_at) && canReturn(actor, "sales_returns.inventory"),
      settle: ["approved", "completed"].includes(status) && canReturn(actor, "sales_returns.settle"),
      reverse: ["approved", "completed"].includes(status) && canReturn(actor, "sales_returns.reverse"),
      print: canReturn(actor, "sales_returns.print") || canReturn(actor, "sales_returns.view"),
    },
  };
}

export type ReturnListFilters = {
  customerId?: number | null;
  q?: string | null;
  invoiceNo?: string | null;
  product?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  settlement?: string | null;
  employeeId?: number | null;
  page?: number;
};

export async function listSalesReturns(database: SalesReturnDatabase, actor: SalesReturnActor, filters: ReturnListFilters) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.view") && !canReturn(actor, "sales_returns.create"))
    throw new SalesReturnError("ليس لديك صلاحية عرض المرتجعات", 403, "PERMISSION_DENIED");
  const page = Math.max(1, Math.min(Number(filters.page) || 1, 500));
  const pageSize = 25;
  const date = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const conditions: SQL[] = [sql`true`];
  if (filters.customerId) conditions.push(sql`r.customer_id = ${filters.customerId}`);
  if (text(filters.q)) conditions.push(sql`(r.return_no ILIKE ${`%${text(filters.q)}%`} OR r.reversal_no ILIKE ${`%${text(filters.q)}%`} OR c.name ILIKE ${`%${text(filters.q)}%`} OR c.full_name ILIKE ${`%${text(filters.q)}%`} OR c.phone ILIKE ${`%${text(filters.q)}%`})`);
  if (text(filters.invoiceNo)) conditions.push(sql`EXISTS (SELECT 1 FROM sales_return_items ri JOIN sales_invoices s ON s.id = ri.invoice_id WHERE ri.return_id = r.id AND s.invoice_no ILIKE ${`%${text(filters.invoiceNo)}%`})`);
  if (text(filters.product)) conditions.push(sql`EXISTS (SELECT 1 FROM sales_return_items ri WHERE ri.return_id = r.id AND ri.product_name ILIKE ${`%${text(filters.product)}%`})`);
  if (date(filters.from)) conditions.push(sql`r.return_date >= ${date(filters.from)}`);
  if (date(filters.to)) conditions.push(sql`r.return_date <= ${date(filters.to)}`);
  if (filters.status && Object.prototype.hasOwnProperty.call({ draft: 1, pending_approval: 1, approved: 1, rejected: 1, cancelled: 1, completed: 1, reversed: 1 }, filters.status))
    conditions.push(sql`r.status = ${filters.status}`);
  if (filters.employeeId) conditions.push(sql`(r.employee_id = ${filters.employeeId} OR r.created_by = ${filters.employeeId})`);
  const where = sql.join(conditions, sql` AND `);
  const base = sql`
    SELECT r.id, r.return_no, r.status, r.return_date::text AS return_date, r.total_quantity::text AS total_quantity, r.total_amount::text AS total_amount,
      r.received_at, r.employee_name, r.created_by_name, r.reversal_no, r.customer_id,
      coalesce(nullif(c.full_name, ''), nullif(c.name, ''), c.phone) AS customer_name, c.phone AS customer_phone,
      (SELECT count(DISTINCT ri.product_key) FROM sales_return_items ri WHERE ri.return_id = r.id)::int AS product_count,
      (SELECT count(DISTINCT ri.invoice_id) FROM sales_return_items ri WHERE ri.return_id = r.id)::int AS invoice_count,
      (SELECT count(*) FROM sales_return_items ri WHERE ri.return_id = r.id AND ri.inventory_state = 'pending')::int AS pending_inventory,
      ${settledSql(sql`r.id`)}::text AS settled,
      (SELECT string_agg(DISTINCT s.kind, ',') FROM sales_return_settlements s WHERE s.return_id = r.id AND s.parent_settlement_id IS NULL AND s.status IN ('applied','requested')) AS kinds,
      (SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s JOIN financial_transactions f ON f.id = s.financial_transaction_id
        WHERE s.return_id = r.id AND s.kind = 'refund' AND s.status = 'requested' AND f.approval_status IN ('draft','pending'))::text AS refund_pending
    FROM sales_returns r JOIN customers c ON c.id = r.customer_id
    WHERE ${where}
  `;
  const all = rows(await database.execute(sql`SELECT * FROM (${base}) x ORDER BY x.return_date DESC, x.id DESC LIMIT 2001`));
  const settlementFilter = filters.settlement && ["not_started", "unsettled", "partial", "refund_pending", "settled", "reversed"].includes(filters.settlement) ? filters.settlement : null;
  const shaped = all.slice(0, 2000).map((row) => ({
    id: Number(row.id),
    returnNo: String(row.return_no),
    reversalNo: row.reversal_no ?? null,
    customerId: Number(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    customerPhone: String(row.customer_phone ?? ""),
    returnDate: String(row.return_date ?? ""),
    productCount: Number(row.product_count ?? 0),
    invoiceCount: Number(row.invoice_count ?? 0),
    totalQuantity: num(row.total_quantity),
    totalAmount: num(row.total_amount),
    settlementKinds: String(row.kinds ?? "").split(",").filter(Boolean),
    status: String(row.status),
    received: Boolean(row.received_at),
    pendingInventory: Number(row.pending_inventory ?? 0),
    settlementStatus: settlementStatusOf(row),
    employeeName: String(row.employee_name || row.created_by_name || ""),
  })).filter((row) => !settlementFilter || row.settlementStatus === settlementFilter);
  const [summary] = rows(await database.execute(sql`
    SELECT count(*) FILTER (WHERE r.status NOT IN ('draft','cancelled'))::int AS total_returns,
      count(*) FILTER (WHERE r.status = 'pending_approval')::int AS pending,
      count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
      coalesce(sum(r.total_amount::numeric) FILTER (WHERE r.status IN ('approved','completed')), 0)::text AS value,
      (SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s JOIN financial_transactions f ON f.id = s.financial_transaction_id
        WHERE s.kind = 'refund' AND f.approval_status = 'executed')::text AS refunds_paid,
      (SELECT coalesce(sum(cc.amount::numeric - coalesce((SELECT sum(ch.amount::numeric) FROM sales_return_settlements ch WHERE ch.parent_settlement_id = cc.id AND ch.status = 'applied'), 0)), 0)
        FROM sales_return_settlements cc WHERE cc.kind = 'customer_credit' AND cc.status = 'applied')::text AS open_credit
    FROM sales_returns r
  `));
  return {
    rows: shaped.slice((page - 1) * pageSize, page * pageSize),
    total: shaped.length,
    truncated: all.length > 2000,
    page,
    pageSize,
    summary: {
      totalReturns: Number(summary?.total_returns ?? 0),
      pending: Number(summary?.pending ?? 0),
      completed: Number(summary?.completed ?? 0),
      value: num(summary?.value),
      refundsPaid: num(summary?.refunds_paid),
      openCredit: num(summary?.open_credit),
    },
  };
}

/** Return history, credit and refund totals for one customer (customer file + statement). */
export async function readCustomerReturnsSummary(database: SalesReturnDatabase, actor: SalesReturnActor, customerId: number) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.view") && !canReturn(actor, "sales_returns.create"))
    throw new SalesReturnError("ليس لديك صلاحية عرض المرتجعات", 403, "PERMISSION_DENIED");
  await readCustomer(database, customerId);
  const [totals] = rows(await database.execute(sql`
    SELECT coalesce(sum(r.total_amount::numeric) FILTER (WHERE r.status IN ('approved','completed')), 0)::text AS approved_returns,
      (SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s JOIN financial_transactions f ON f.id = s.financial_transaction_id
        WHERE s.customer_id = ${customerId} AND s.kind = 'refund' AND f.approval_status = 'executed')::text AS refunds_paid,
      (SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s JOIN financial_transactions f ON f.id = s.financial_transaction_id
        WHERE s.customer_id = ${customerId} AND s.kind = 'refund' AND s.status = 'requested' AND f.approval_status IN ('draft','pending'))::text AS refunds_pending,
      (SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s
        WHERE s.customer_id = ${customerId} AND s.kind = 'invoice_credit' AND s.status = 'applied')::text AS debt_deducted,
      (SELECT coalesce(sum(cc.amount::numeric - coalesce((SELECT sum(ch.amount::numeric) FROM sales_return_settlements ch WHERE ch.parent_settlement_id = cc.id AND ch.status = 'applied'), 0)), 0)
        FROM sales_return_settlements cc WHERE cc.customer_id = ${customerId} AND cc.kind = 'customer_credit' AND cc.status = 'applied')::text AS available_credit
    FROM sales_returns r WHERE r.customer_id = ${customerId}
  `));
  const history = rows(await database.execute(sql`
    SELECT r.id, r.return_no, r.status, r.return_date::text AS return_date, r.total_quantity::text AS total_quantity, r.total_amount::text AS total_amount,
      r.employee_name, r.created_by_name, r.reversal_no, ${settledSql(sql`r.id`)}::text AS settled,
      (SELECT string_agg(DISTINCT s.invoice_no, '، ') FROM sales_return_items ri JOIN sales_invoices s ON s.id = ri.invoice_id WHERE ri.return_id = r.id) AS invoices,
      (SELECT string_agg(DISTINCT ri.product_name, '، ') FROM sales_return_items ri WHERE ri.return_id = r.id) AS products,
      (SELECT string_agg(DISTINCT ri.condition, ',') FROM sales_return_items ri WHERE ri.return_id = r.id) AS conditions,
      '0' AS refund_pending
    FROM sales_returns r WHERE r.customer_id = ${customerId}
    ORDER BY r.return_date DESC, r.id DESC LIMIT 200
  `));
  const openInvoices = rows(await database.execute(sql`
    SELECT id, invoice_no, date::text AS date, total::text AS total, remaining_amount::text AS remaining
    FROM sales_invoices
    WHERE customer_id = ${customerId} AND status = 'active' AND financially_reversed = false AND remaining_amount::numeric > 0
      AND ${selfOwnedInvoice(sql`sales_invoices.id`)}
    ORDER BY date, id LIMIT 200
  `));
  return {
    openInvoices: openInvoices.map((row) => ({ id: Number(row.id), invoiceNo: String(row.invoice_no ?? ""), date: String(row.date ?? ""), total: num(row.total), remaining: num(row.remaining) })),
    approvedReturns: num(totals?.approved_returns),
    refundsPaid: num(totals?.refunds_paid),
    refundsPending: num(totals?.refunds_pending),
    debtDeducted: num(totals?.debt_deducted),
    availableCredit: num(totals?.available_credit),
    history: history.map((row) => ({
      id: Number(row.id),
      returnNo: String(row.return_no),
      reversalNo: row.reversal_no ?? null,
      status: String(row.status),
      returnDate: String(row.return_date ?? ""),
      totalQuantity: num(row.total_quantity),
      totalAmount: num(row.total_amount),
      invoices: String(row.invoices ?? ""),
      products: String(row.products ?? ""),
      conditions: String(row.conditions ?? "").split(",").filter(Boolean),
      settlementStatus: settlementStatusOf(row),
      employeeName: String(row.employee_name || row.created_by_name || ""),
    })),
  };
}

export async function readSalesReturnOptions(database: SalesReturnDatabase, actor: SalesReturnActor) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.view") && !canReturn(actor, "sales_returns.create"))
    throw new SalesReturnError("ليس لديك صلاحية المرتجعات", 403, "PERMISSION_DENIED");
  const [warehouses, staff] = await Promise.all([
    database.execute(sql`SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 200`),
    database.execute(sql`SELECT id, coalesce(nullif(full_name, ''), username) AS name FROM staff WHERE is_active = true ORDER BY name LIMIT 500`),
  ]);
  return {
    warehouses: rows(warehouses).map((row) => ({ id: Number(row.id), name: String(row.name ?? "") })),
    staff: rows(staff).map((row) => ({ id: Number(row.id), name: String(row.name ?? "") })),
    reasons: RETURN_REASONS,
    conditions: RETURN_CONDITIONS,
    permissions: Object.fromEntries(SALES_RETURN_PERMISSIONS.map((permission) => [permission, canReturn(actor, permission)])),
  };
}

export async function readSalesReturnReports(database: SalesReturnDatabase, actor: SalesReturnActor, range: { from?: string | null; to?: string | null }) {
  await requireReady(database);
  if (!canReturn(actor, "sales_returns.view")) throw new SalesReturnError("ليس لديك صلاحية تقارير المرتجعات", 403, "PERMISSION_DENIED");
  const date = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const from = date(range.from);
  const to = date(range.to);
  const window = sql`r.status IN ('approved','completed') ${from ? sql`AND r.return_date >= ${from}` : sql``} ${to ? sql`AND r.return_date <= ${to}` : sql``}`;
  const group = async (label: SQL, extraJoin: SQL = sql``) =>
    rows(await database.execute(sql`
      SELECT ${label} AS label, count(DISTINCT r.id)::int AS returns, coalesce(sum(i.quantity::numeric), 0)::text AS quantity, coalesce(sum(i.amount::numeric), 0)::text AS amount
      FROM sales_returns r JOIN sales_return_items i ON i.return_id = r.id ${extraJoin}
      WHERE ${window} GROUP BY 1 ORDER BY sum(i.amount::numeric) DESC NULLS LAST LIMIT 100
    `)).map((row) => ({ label: String(row.label ?? "—"), returns: Number(row.returns ?? 0), quantity: num(row.quantity), amount: num(row.amount) }));
  const [byCustomer, byProduct, byInvoice, byEmployee, byReason, byDate, byWarehouse, byCondition] = await Promise.all([
    group(sql`coalesce(nullif(c.full_name, ''), nullif(c.name, ''), c.phone)`, sql`JOIN customers c ON c.id = r.customer_id`),
    group(sql`i.product_name`),
    group(sql`s.invoice_no`, sql`JOIN sales_invoices s ON s.id = i.invoice_id`),
    group(sql`coalesce(nullif(r.employee_name, ''), r.created_by_name)`),
    group(sql`r.reason_code`),
    group(sql`to_char(r.return_date, 'YYYY-MM-DD')`),
    group(sql`coalesce(w.name, 'بدون مخزن')`, sql`LEFT JOIN warehouses w ON w.id = r.warehouse_id`),
    group(sql`i.condition`),
  ]);
  const [totals] = rows(await database.execute(sql`
    SELECT count(DISTINCT r.id)::int AS returns, coalesce(sum(r.total_quantity::numeric), 0)::text AS quantity, coalesce(sum(r.total_amount::numeric), 0)::text AS amount,
      (SELECT coalesce(sum(s.amount::numeric), 0) FROM sales_return_settlements s JOIN financial_transactions f ON f.id = s.financial_transaction_id
        WHERE s.kind = 'refund' AND f.approval_status = 'executed' ${from ? sql`AND f.executed_at::date >= ${from}` : sql``} ${to ? sql`AND f.executed_at::date <= ${to}` : sql``})::text AS refunds_paid,
      (SELECT coalesce(sum(cc.amount::numeric - coalesce((SELECT sum(ch.amount::numeric) FROM sales_return_settlements ch WHERE ch.parent_settlement_id = cc.id AND ch.status = 'applied'), 0)), 0)
        FROM sales_return_settlements cc WHERE cc.kind = 'customer_credit' AND cc.status = 'applied')::text AS open_credit
    FROM sales_returns r WHERE ${window}
  `));
  const reversals = rows(await database.execute(sql`
    SELECT r.id, r.return_no, r.reversal_no, r.reversed_at, r.reversed_by_name, r.reversal_reason, r.total_amount::text AS total_amount,
      coalesce(nullif(c.full_name, ''), nullif(c.name, ''), c.phone) AS customer_name
    FROM sales_returns r JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'reversed' ${from ? sql`AND r.reversed_at::date >= ${from}` : sql``} ${to ? sql`AND r.reversed_at::date <= ${to}` : sql``}
    ORDER BY r.reversed_at DESC LIMIT 100
  `));
  return {
    totals: { returns: Number(totals?.returns ?? 0), quantity: num(totals?.quantity), amount: num(totals?.amount), refundsPaid: num(totals?.refunds_paid), openCredit: num(totals?.open_credit) },
    byCustomer,
    byProduct,
    byInvoice,
    byEmployee,
    byReason,
    byDate,
    byWarehouse,
    byCondition,
    reversals: reversals.map((row) => ({
      id: Number(row.id),
      returnNo: String(row.return_no),
      reversalNo: row.reversal_no ?? null,
      reversedAt: iso(row.reversed_at),
      reversedByName: row.reversed_by_name ?? null,
      reason: row.reversal_reason ?? null,
      amount: num(row.total_amount),
      customerName: String(row.customer_name ?? ""),
    })),
  };
}

/**
 * Statement lines for the customer كشف حساب. Credits: debt deducted directly by
 * a return and customer credit issued. Refunds: owed while requested, paid when
 * executed. Credit later used on an invoice moves value already counted, so it
 * adds no line. Reversals keep the original line and add an opposite one.
 */
export async function salesReturnStatementLines(executor: Executor, customerId: number) {
  if (!(await salesReturnsReady(executor))) return [];
  const result = rows(await executor.execute(sql`
    SELECT s.kind, s.status, s.amount::numeric AS amount, s.created_at::text AS created_at, s.reversed_at::text AS reversed_at,
      r.return_no, inv.invoice_no, f.approval_status AS tx_status, f.executed_at::text AS executed_at, f.transaction_no
    FROM sales_return_settlements s
    JOIN sales_returns r ON r.id = s.return_id
    LEFT JOIN sales_invoices inv ON inv.id = s.invoice_id
    LEFT JOIN financial_transactions f ON f.id = s.financial_transaction_id
    WHERE s.customer_id = ${customerId} AND s.parent_settlement_id IS NULL
  `));
  const lines: { date: string | null; type: string; reference: string; description: string; debit: number; credit: number }[] = [];
  for (const row of result) {
    const amount = num(row.amount);
    if (row.kind === "invoice_credit") {
      lines.push({ date: row.created_at, type: "مرتجع مبيعات", reference: row.return_no, description: `مرتجع معتمد — خصم من مديونية ${row.invoice_no ?? ""}`.trim(), debit: 0, credit: amount });
      if (row.status === "reversed") lines.push({ date: row.reversed_at, type: "عكس مرتجع", reference: row.return_no, description: "عكس خصم المرتجع من المديونية", debit: amount, credit: 0 });
    } else if (row.kind === "customer_credit") {
      lines.push({ date: row.created_at, type: "مرتجع مبيعات", reference: row.return_no, description: "مرتجع معتمد — رصيد دائن للعميل", debit: 0, credit: amount });
      if (row.status === "reversed") lines.push({ date: row.reversed_at, type: "عكس مرتجع", reference: row.return_no, description: "عكس الرصيد الدائن للمرتجع", debit: amount, credit: 0 });
    } else if (row.kind === "refund" && ["draft", "pending", "executed"].includes(String(row.tx_status))) {
      lines.push({ date: row.created_at, type: "مرتجع مبيعات", reference: row.return_no, description: "مرتجع معتمد — مبلغ مستحق للعميل", debit: 0, credit: amount });
      if (row.tx_status === "executed")
        lines.push({ date: row.executed_at, type: "استرجاع مبلغ", reference: row.transaction_no ?? row.return_no, description: "دفع مبلغ مرتجع للعميل", debit: amount, credit: 0 });
    }
  }
  return lines;
}
