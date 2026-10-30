import { warehouseBreakdowns } from "./warehouses";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  MOVEMENT_REASON_LABELS,
  assetReturn,
  channelFigures,
  combineChannels,
  depletionForecast,
  movementReference,
  productAlerts,
  productKind,
  slowMoving,
  type ChannelFigures,
} from "@/lib/product-insights";
import {
  baghdadDay,
  describeLines,
  quantityAssetSummary,
  quantityCommitmentRows,
  quantityProfilesFor,
} from "./quantity-assets";

/**
 * Read-only product intelligence. Every figure is derived from existing records:
 * sales invoices (active, not financially reversed — the same rule the
 * accounting reports use), online orders, bundle sale snapshots, purchase
 * invoices, stock movements, variants, reservations and audit logs.
 * Viewing never creates transactions, movements or notifications.
 */

type Executor = Pick<typeof db, "execute">;
export type InsightsAccess = { finance: boolean; customers: boolean };
export type InsightsRange = { from: string; to: string };

export class ProductInsightsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "ProductInsightsError";
  }
}

const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const textDate = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value == null ? null : String(value);
const ids = (values: number[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
const isDay = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Active sales invoice: the accounting reports' definition of a counted sale. */
const COUNTED_SALE = sql`si.status = 'active' AND si.financially_reversed = false`;
/** Online orders that were not cancelled, returned or financially reversed. */
const COUNTED_ORDER = sql`o.archived_at IS NULL AND COALESCE(o.status, '') NOT IN ('cancelled', 'returned') AND COALESCE(o.financially_reversed, false) = false`;

export function normalizeRange(input: { from?: string | null; to?: string | null }): InsightsRange {
  const today = baghdadDay();
  const from = isDay(input.from) ? String(input.from) : "2000-01-01";
  const to = isDay(input.to) ? String(input.to) : today;
  if (from > to) throw new ProductInsightsError("تاريخ البداية بعد تاريخ النهاية");
  return { from, to };
}

async function loadProduct(executor: Executor, productId: number) {
  const product = rowsOf(
    await executor.execute(sql`
      SELECT p.*, c.name_ar AS category_name_ar, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ${productId}
    `),
  )[0];
  if (!product) throw new ProductInsightsError("المنتج غير موجود", 404);
  const ownerId = Number(product.shared_stock_product_id ?? 0) || null;
  const owner = ownerId
    ? rowsOf(await executor.execute(sql`SELECT id, stock, min_stock FROM products WHERE id = ${ownerId}`))[0]
    : null;
  return { product, stockOwnerId: owner ? Number(owner.id) : productId, stock: num(owner ? owner.stock : product.stock) };
}

/** Sales per channel. Invoice-level discounts are allocated to lines by line value. */
async function salesChannels(executor: Executor, productId: number, range: InsightsRange) {
  const invoiceRows = rowsOf(
    await executor.execute(sql`
      WITH lines AS (
        SELECT sii.invoice_id, si.sale_type,
               (si.status = 'active' AND si.financially_reversed = false) AS counted,
               sii.quantity::numeric AS q, sii.unit_price::numeric AS up, sii.total::numeric AS lt,
               sii.cost_price::numeric AS uc,
               COALESCE(si.discount_amount, 0)::numeric + COALESCE(si.coupon_discount_amount, 0)::numeric AS inv_disc,
               (SELECT COALESCE(SUM(x.total::numeric), 0) FROM sales_invoice_items x WHERE x.invoice_id = sii.invoice_id) AS inv_lines
        FROM sales_invoice_items sii
        JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.product_id = ${productId} AND si.date >= ${range.from} AND si.date <= ${range.to}
      )
      SELECT CASE WHEN sale_type = 'wholesale' THEN 'wholesale' ELSE 'retail' END AS channel, counted,
             COALESCE(SUM(q), 0)::float AS quantity,
             COUNT(DISTINCT invoice_id)::int AS invoices,
             COALESCE(SUM(q * up), 0)::float AS gross,
             COALESCE(SUM((q * up - lt) + CASE WHEN inv_lines > 0 THEN inv_disc * lt / inv_lines ELSE 0 END), 0)::float AS discounts,
             COALESCE(SUM(q * uc), 0)::float AS cogs
      FROM lines GROUP BY 1, 2
    `),
  );
  const orderRows = rowsOf(
    await executor.execute(sql`
      WITH lines AS (
        SELECT o.id AS order_id,
               (o.archived_at IS NULL AND COALESCE(o.status, '') NOT IN ('cancelled', 'returned') AND COALESCE(o.financially_reversed, false) = false) AS counted,
               oi.quantity::numeric AS q, oi.price::numeric AS up,
               COALESCE(o.coupon_discount_amount, 0)::numeric + COALESCE(o.loyalty_discount_amount, 0)::numeric AS ord_disc,
               (SELECT COALESCE(SUM(x.price::numeric * x.quantity::numeric), 0) FROM order_items x WHERE x.order_id = o.id) AS ord_lines
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ${productId} AND o.created_at::date >= ${range.from} AND o.created_at::date <= ${range.to}
      )
      SELECT counted, COALESCE(SUM(q), 0)::float AS quantity, COUNT(DISTINCT order_id)::int AS invoices,
             COALESCE(SUM(q * up), 0)::float AS gross,
             COALESCE(SUM(CASE WHEN ord_lines > 0 THEN ord_disc * (q * up) / ord_lines ELSE 0 END), 0)::float AS discounts
      FROM lines GROUP BY 1
    `),
  );
  const bundleRow = rowsOf(
    await executor.execute(sql`
      SELECT COALESCE(SUM((c->>'totalQuantity')::numeric), 0)::float AS quantity,
             COUNT(DISTINCT s.invoice_id)::int AS invoices,
             COALESCE(SUM((c->>'totalQuantity')::numeric * COALESCE(NULLIF(c->>'costPrice', '')::numeric, 0)), 0)::float AS cogs
      FROM sales_invoice_bundle_snapshots s
      JOIN sales_invoices si ON si.id = s.invoice_id
      CROSS JOIN LATERAL jsonb_array_elements(s.components) AS c
      WHERE c->>'productId' = ${String(productId)} AND ${COUNTED_SALE}
        AND si.date >= ${range.from} AND si.date <= ${range.to}
    `),
  )[0];

  const pick = (rows: any[], channel: string | null, counted: boolean) =>
    rows.find((row) => (channel === null || row.channel === channel) && row.counted === counted);
  const invoiceChannel = (channel: "retail" | "wholesale"): ChannelFigures => {
    const live = pick(invoiceRows, channel, true);
    const returned = pick(invoiceRows, channel, false);
    return channelFigures({
      quantity: num(live?.quantity),
      invoices: num(live?.invoices),
      grossSales: num(live?.gross),
      discounts: num(live?.discounts),
      cogs: num(live?.cogs),
      returnsQuantity: num(returned?.quantity),
      returnsValue: num(returned?.gross) - num(returned?.discounts),
    });
  };
  const onlineLive = pick(orderRows, null, true);
  const onlineReturned = pick(orderRows, null, false);
  return {
    retail: invoiceChannel("retail"),
    wholesale: invoiceChannel("wholesale"),
    // Store orders carry no cost snapshot; their profit is not estimated.
    online: channelFigures({
      quantity: num(onlineLive?.quantity),
      invoices: num(onlineLive?.invoices),
      grossSales: num(onlineLive?.gross),
      discounts: num(onlineLive?.discounts),
      cogs: null,
      returnsQuantity: num(onlineReturned?.quantity),
      returnsValue: num(onlineReturned?.gross) - num(onlineReturned?.discounts),
    }),
    // Units sold inside bundles: stock left, but bundle revenue is not split per component.
    bundles: { quantity: num(bundleRow?.quantity), invoices: num(bundleRow?.invoices), cogs: num(bundleRow?.cogs) },
  };
}

async function salesSeries(executor: Executor, productId: number, range: InsightsRange, group: "day" | "month" | "year") {
  const rows = rowsOf(
    await executor.execute(sql`
      WITH lines AS (
        SELECT si.date::date AS d, sii.quantity::numeric AS q, sii.total::numeric AS lt, sii.cost_price::numeric AS uc,
               COALESCE(si.discount_amount, 0)::numeric + COALESCE(si.coupon_discount_amount, 0)::numeric AS inv_disc,
               (SELECT COALESCE(SUM(x.total::numeric), 0) FROM sales_invoice_items x WHERE x.invoice_id = sii.invoice_id) AS inv_lines
        FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.product_id = ${productId} AND ${COUNTED_SALE} AND si.date >= ${range.from} AND si.date <= ${range.to}
      ),
      online AS (
        SELECT o.created_at::date AS d, oi.quantity::numeric AS q, oi.price::numeric * oi.quantity::numeric AS lt
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ${productId} AND ${COUNTED_ORDER}
          AND o.created_at::date >= ${range.from} AND o.created_at::date <= ${range.to}
      )
      SELECT period, SUM(quantity)::float AS quantity, SUM(net)::float AS net, SUM(cogs)::float AS cogs FROM (
        SELECT to_char(date_trunc(${group}::text, d::timestamp), 'YYYY-MM-DD') AS period, q AS quantity,
               lt - CASE WHEN inv_lines > 0 THEN inv_disc * lt / inv_lines ELSE 0 END AS net, q * uc AS cogs
        FROM lines
        UNION ALL
        SELECT to_char(date_trunc(${group}::text, d::timestamp), 'YYYY-MM-DD'), q, lt, 0 FROM online
      ) s GROUP BY period ORDER BY period
    `),
  );
  return rows.map((row) => ({
    period: String(row.period),
    quantity: num(row.quantity),
    net: Math.round(num(row.net) * 100) / 100,
    cogs: Math.round(num(row.cogs) * 100) / 100,
  }));
}

async function topCustomers(executor: Executor, productId: number, range: InsightsRange) {
  return rowsOf(
    await executor.execute(sql`
      WITH lines AS (
        SELECT si.id AS invoice_id, si.customer_id, COALESCE(NULLIF(si.customer_name, ''), 'زبون نقدي') AS name, si.date,
               sii.quantity::numeric AS q, sii.total::numeric AS lt,
               COALESCE(si.discount_amount, 0)::numeric + COALESCE(si.coupon_discount_amount, 0)::numeric AS inv_disc,
               (SELECT COALESCE(SUM(x.total::numeric), 0) FROM sales_invoice_items x WHERE x.invoice_id = si.id) AS inv_lines
        FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.product_id = ${productId} AND ${COUNTED_SALE} AND si.date >= ${range.from} AND si.date <= ${range.to}
      )
      SELECT customer_id, name, SUM(q)::float AS quantity, COUNT(DISTINCT invoice_id)::int AS invoices,
             SUM(lt - CASE WHEN inv_lines > 0 THEN inv_disc * lt / inv_lines ELSE 0 END)::float AS net,
             MAX(date)::text AS last_date
      FROM lines GROUP BY customer_id, name ORDER BY net DESC LIMIT 15
    `),
  ).map((row) => ({
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    name: String(row.name),
    quantity: num(row.quantity),
    invoices: num(row.invoices),
    net: Math.round(num(row.net) * 100) / 100,
    lastDate: row.last_date ?? null,
  }));
}

/** Attribution is the invoice creator recorded at the time; nothing is inferred. */
async function employeeSales(executor: Executor, productId: number, range: InsightsRange) {
  return rowsOf(
    await executor.execute(sql`
      WITH lines AS (
        SELECT si.id AS invoice_id, si.created_by, COALESCE(NULLIF(si.created_by_name, ''), 'غير مسجل') AS name,
               (si.status = 'active' AND si.financially_reversed = false) AS counted,
               sii.quantity::numeric AS q, sii.unit_price::numeric AS up, sii.total::numeric AS lt,
               COALESCE(si.discount_amount, 0)::numeric + COALESCE(si.coupon_discount_amount, 0)::numeric AS inv_disc,
               (SELECT COALESCE(SUM(x.total::numeric), 0) FROM sales_invoice_items x WHERE x.invoice_id = si.id) AS inv_lines
        FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.product_id = ${productId} AND si.date >= ${range.from} AND si.date <= ${range.to}
      )
      SELECT created_by, name,
             COUNT(DISTINCT invoice_id) FILTER (WHERE counted)::int AS invoices,
             COALESCE(SUM(q) FILTER (WHERE counted), 0)::float AS quantity,
             COALESCE(SUM(q * up) FILTER (WHERE counted), 0)::float AS gross,
             COALESCE(SUM(lt - CASE WHEN inv_lines > 0 THEN inv_disc * lt / inv_lines ELSE 0 END) FILTER (WHERE counted), 0)::float AS net,
             COALESCE(SUM(q) FILTER (WHERE NOT counted), 0)::float AS returns_quantity
      FROM lines GROUP BY created_by, name ORDER BY net DESC LIMIT 20
    `),
  ).map((row) => ({
    staffId: row.created_by == null ? null : Number(row.created_by),
    name: String(row.name),
    invoices: num(row.invoices),
    quantity: num(row.quantity),
    gross: Math.round(num(row.gross) * 100) / 100,
    net: Math.round(num(row.net) * 100) / 100,
    returnsQuantity: num(row.returns_quantity),
  }));
}

/** Purchases: active invoices count; cancelled ones are purchase returns. */
async function purchases(executor: Executor, productId: number, range: InsightsRange) {
  const lines = rowsOf(
    await executor.execute(sql`
      SELECT pi.id AS invoice_id, pi.invoice_no, pi.date::text AS date, pi.supplier_id,
             COALESCE(NULLIF(pi.supplier_name, ''), 'مورد غير محدد') AS supplier, pi.status,
             pii.variant_label, pii.quantity::float AS quantity, pii.cost_price::float AS unit_cost, pii.total::float AS total,
             COALESCE(pi.shipping_cost, 0)::float AS shipping,
             (SELECT COALESCE(SUM(x.total::numeric), 0) FROM purchase_invoice_items x WHERE x.invoice_id = pi.id)::float AS invoice_lines,
             pi.created_at
      FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.invoice_id
      WHERE pii.product_id = ${productId} AND pi.date >= ${range.from} AND pi.date <= ${range.to}
      ORDER BY pi.date DESC, pi.id DESC
      LIMIT 2000
    `),
  );
  const active = lines.filter((line) => line.status === "active");
  const returned = lines.filter((line) => line.status !== "active");
  const quantity = active.reduce((sum, line) => sum + num(line.quantity), 0);
  const value = active.reduce((sum, line) => sum + num(line.total), 0);
  // Shipping on an invoice is an attributable acquisition cost, split by line value.
  const shipping = active.reduce(
    (sum, line) => sum + (num(line.invoice_lines) > 0 ? (num(line.shipping) * num(line.total)) / num(line.invoice_lines) : 0),
    0,
  );
  const suppliers = new Map<string, any>();
  for (const line of lines) {
    const key = `${line.supplier_id ?? ""}:${line.supplier}`;
    const entry = suppliers.get(key) ?? {
      supplierId: line.supplier_id == null ? null : Number(line.supplier_id),
      name: String(line.supplier),
      quantity: 0,
      value: 0,
      returnsQuantity: 0,
      latestPrice: null as number | null,
      lastDate: null as string | null,
      purchases: 0,
    };
    if (line.status === "active") {
      entry.quantity += num(line.quantity);
      entry.value += num(line.total);
      entry.purchases += 1;
      if (!entry.lastDate || String(line.date) > entry.lastDate) {
        entry.lastDate = String(line.date);
        entry.latestPrice = num(line.unit_cost);
      }
    } else entry.returnsQuantity += num(line.quantity);
    suppliers.set(key, entry);
  }
  const latest = active[0] ?? null;
  const earlier = active.slice(1);
  const earlierQuantity = earlier.reduce((sum, line) => sum + num(line.quantity), 0);
  return {
    quantity,
    value: Math.round(value * 100) / 100,
    attributableCosts: Math.round(shipping * 100) / 100,
    averageCost: quantity > 0 ? Math.round((value / quantity) * 100) / 100 : null,
    averageLandedCost: quantity > 0 ? Math.round(((value + shipping) / quantity) * 100) / 100 : null,
    latestCost: latest ? num(latest.unit_cost) : null,
    previousAverageCost: earlierQuantity > 0 ? earlier.reduce((sum, line) => sum + num(line.total), 0) / earlierQuantity : null,
    returnsQuantity: returned.reduce((sum, line) => sum + num(line.quantity), 0),
    returnsValue: Math.round(returned.reduce((sum, line) => sum + num(line.total), 0) * 100) / 100,
    suppliers: [...suppliers.values()]
      .map((entry) => ({ ...entry, value: Math.round(entry.value * 100) / 100, averagePrice: entry.quantity > 0 ? Math.round((entry.value / entry.quantity) * 100) / 100 : null }))
      .sort((a, b) => b.value - a.value),
    history: lines.slice(0, 100).map((line) => ({
      invoiceId: Number(line.invoice_id),
      invoiceNo: String(line.invoice_no),
      date: String(line.date),
      supplier: String(line.supplier),
      supplierId: line.supplier_id == null ? null : Number(line.supplier_id),
      variantLabel: line.variant_label ?? null,
      quantity: num(line.quantity),
      unitCost: num(line.unit_cost),
      total: num(line.total),
      status: String(line.status),
    })),
  };
}

/** All-time activity used by the slow-moving and depletion rules. */
async function salesActivity(executor: Executor, productId: number, today: string) {
  const row = rowsOf(
    await executor.execute(sql`
      WITH sold AS (
        SELECT si.date::date AS d, sii.quantity::numeric AS q
        FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.product_id = ${productId} AND ${COUNTED_SALE}
        UNION ALL
        SELECT o.created_at::date, oi.quantity::numeric
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ${productId} AND ${COUNTED_ORDER}
        UNION ALL
        SELECT si.date::date, (c->>'totalQuantity')::numeric
        FROM sales_invoice_bundle_snapshots s JOIN sales_invoices si ON si.id = s.invoice_id
        CROSS JOIN LATERAL jsonb_array_elements(s.components) AS c
        WHERE c->>'productId' = ${String(productId)} AND ${COUNTED_SALE}
      )
      SELECT MAX(d)::text AS last_sale,
             COALESCE(SUM(q) FILTER (WHERE d > ${today}::date - 30), 0)::float AS units_30,
             COALESCE(SUM(q) FILTER (WHERE d > ${today}::date - 90), 0)::float AS units_90,
             COUNT(DISTINCT d) FILTER (WHERE d > ${today}::date - 90)::int AS selling_days_90,
             COALESCE(SUM(q) FILTER (WHERE d > ${today}::date - 365 AND d <= ${today}::date - 335), 0)::float AS units_last_year_30,
             COUNT(*) FILTER (WHERE d <= ${today}::date - 335)::int AS rows_last_year
      FROM sold
    `),
  )[0];
  return {
    lastSale: row?.last_sale ?? null,
    units30: num(row?.units_30),
    units90: num(row?.units_90),
    sellingDays90: num(row?.selling_days_90),
    sameMonthLastYear: num(row?.rows_last_year) > 0 ? num(row?.units_last_year_30) : null,
  };
}

export async function productMovements(
  executor: Executor,
  productId: number,
  options: { page: number; limit: number; currentStock?: number },
) {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit)));
  const offset = Math.max(0, (Math.floor(options.page) - 1) * limit);
  const stock = options.currentStock ?? (await loadProduct(executor, productId)).stock;
  const [rows, count] = await Promise.all([
    executor.execute(sql`
      SELECT m.id, m.created_at, m.reason, m.movement_type, m.quantity_change::float AS quantity_change,
             m.related_type, m.related_id, m.sales_invoice_id, m.invoice_number, m.warehouse_id,
             w.name AS warehouse_name, m.created_by_name, m.variant_id, m.metadata,
             (${stock}::numeric - COALESCE(SUM(m.quantity_change::numeric) OVER (
               ORDER BY m.created_at DESC, m.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))::float AS balance_after
      FROM stock_movements m LEFT JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.product_id = ${productId} OR m.stock_source_product_id = ${productId}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    executor.execute(
      sql`SELECT COUNT(*)::int AS count FROM stock_movements m WHERE m.product_id = ${productId} OR m.stock_source_product_id = ${productId}`,
    ),
  ]);
  const total = num(rowsOf(count)[0]?.count);
  return {
    total,
    page: Math.floor(offset / limit) + 1,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    // The balance is reconstructed backwards from the current stock through the
    // recorded movements; stock changed outside the ledger cannot be shown.
    data: rowsOf(rows).map((row) => {
      const change = num(row.quantity_change);
      const metadata = row.metadata ?? {};
      return {
        id: Number(row.id),
        createdAt: textDate(row.created_at),
        reason: String(row.reason ?? ""),
        label: MOVEMENT_REASON_LABELS[String(row.reason ?? "")] ?? (metadata.label ? String(metadata.label) : String(row.reason ?? "")),
        quantityIn: change > 0 ? change : 0,
        quantityOut: change < 0 ? -change : 0,
        balanceAfter: num(row.balance_after),
        reference: movementReference({
          relatedType: row.related_type ?? null,
          relatedId: row.related_id == null ? null : Number(row.related_id),
          salesInvoiceId: row.sales_invoice_id == null ? null : Number(row.sales_invoice_id),
        }),
        invoiceNumber: row.invoice_number ?? null,
        warehouse: row.warehouse_name ?? null,
        employee: row.created_by_name || null,
        variantId: row.variant_id == null ? null : Number(row.variant_id),
        note: (metadata.reason ?? metadata.note ?? metadata.description ?? null) as string | null,
      };
    }),
  };
}

async function variantAnalytics(executor: Executor, productId: number, range: InsightsRange, finance: boolean) {
  const variants = rowsOf(
    await executor.execute(sql`
      SELECT id, color, size, sku, barcode, stock::float AS stock, price::float AS price, cost::float AS cost, is_active
      FROM product_variants WHERE product_id = ${productId} ORDER BY id
    `),
  );
  if (!variants.length) return [];
  const variantIds = variants.map((variant) => Number(variant.id));
  const [purchased, sold, online, reserved] = await Promise.all([
    executor.execute(sql`
      SELECT pii.variant_id, COALESCE(SUM(pii.quantity::numeric), 0)::float AS quantity
      FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.invoice_id
      WHERE pii.variant_id IN (${ids(variantIds)}) AND pi.status = 'active' AND pi.date >= ${range.from} AND pi.date <= ${range.to}
      GROUP BY pii.variant_id
    `),
    // Net units per invoice line and variant from the stock ledger; an edited
    // invoice's restore/deduct pairs cancel out instead of being counted twice.
    executor.execute(sql`
      WITH moved AS (
        SELECT m.variant_id, m.sales_invoice_item_id, -SUM(m.quantity_change::numeric) AS q
        FROM stock_movements m JOIN sales_invoices si ON si.id = m.sales_invoice_id
        WHERE m.variant_id IN (${ids(variantIds)}) AND m.sales_invoice_item_id IS NOT NULL AND ${COUNTED_SALE}
          AND si.date >= ${range.from} AND si.date <= ${range.to}
        GROUP BY m.variant_id, m.sales_invoice_item_id
        HAVING -SUM(m.quantity_change::numeric) > 0
      )
      SELECT moved.variant_id, SUM(moved.q)::float AS quantity,
             SUM(CASE WHEN sii.quantity::numeric > 0 THEN sii.total::numeric * moved.q / sii.quantity::numeric ELSE 0 END)::float AS revenue,
             SUM(moved.q * sii.cost_price::numeric)::float AS cogs
      FROM moved JOIN sales_invoice_items sii ON sii.id = moved.sales_invoice_item_id
      GROUP BY moved.variant_id
    `),
    executor.execute(sql`
      SELECT oi.variant_id, COALESCE(SUM(oi.quantity::numeric), 0)::float AS quantity,
             COALESCE(SUM(oi.quantity::numeric * oi.price::numeric), 0)::float AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.variant_id IN (${ids(variantIds)}) AND ${COUNTED_ORDER}
        AND o.created_at::date >= ${range.from} AND o.created_at::date <= ${range.to}
      GROUP BY oi.variant_id
    `),
    executor.execute(sql`
      SELECT variant_id, COALESCE(SUM(quantity::numeric), 0)::float AS quantity
      FROM stock_reservations WHERE variant_id IN (${ids(variantIds)}) AND status = 'reserved' GROUP BY variant_id
    `),
  ]);
  const byVariant = (result: any) => new Map(rowsOf(result).map((row) => [Number(row.variant_id), row]));
  const purchasedMap = byVariant(purchased);
  const soldMap = byVariant(sold);
  const onlineMap = byVariant(online);
  const reservedMap = byVariant(reserved);
  return variants.map((variant) => {
    const id = Number(variant.id);
    const invoiceSold = soldMap.get(id);
    const onlineSold = onlineMap.get(id);
    const revenue = num(invoiceSold?.revenue) + num(onlineSold?.revenue);
    const cogs = num(invoiceSold?.cogs);
    return {
      id,
      name: [variant.color, variant.size].filter(Boolean).join(" / ") || `#${id}`,
      color: variant.color ?? null,
      size: variant.size ?? null,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      isActive: variant.is_active !== false,
      stock: num(variant.stock),
      reserved: num(reservedMap.get(id)?.quantity),
      available: Math.max(0, num(variant.stock) - num(reservedMap.get(id)?.quantity)),
      purchased: finance ? num(purchasedMap.get(id)?.quantity) : null,
      sold: num(invoiceSold?.quantity) + num(onlineSold?.quantity),
      price: variant.price == null ? null : num(variant.price),
      cost: finance ? (variant.cost == null ? null : num(variant.cost)) : null,
      revenue: Math.round(revenue * 100) / 100,
      // Profit only over invoice sales, which carry a cost snapshot.
      grossProfit: finance ? Math.round((num(invoiceSold?.revenue) - cogs) * 100) / 100 : null,
    };
  });
}

async function priceHistory(executor: Executor, productId: number, range: InsightsRange) {
  const [changes, sellingByMonth] = await Promise.all([
    executor.execute(sql`
      SELECT created_at, user_name, metadata FROM admin_activity_logs
      WHERE entity_type = 'product' AND entity_id = ${productId} AND action = 'product_updated'
      ORDER BY created_at DESC LIMIT 200
    `),
    executor.execute(sql`
      SELECT to_char(date_trunc('month', si.date::timestamp), 'YYYY-MM') AS month,
             (SUM(sii.unit_price::numeric * sii.quantity::numeric) / NULLIF(SUM(sii.quantity::numeric), 0))::float AS average_price,
             MIN(sii.unit_price::numeric)::float AS min_price, MAX(sii.unit_price::numeric)::float AS max_price
      FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
      WHERE sii.product_id = ${productId} AND ${COUNTED_SALE} AND si.date >= ${range.from} AND si.date <= ${range.to}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 36
    `),
  ]);
  const priceFields = ["price", "costPrice", "wholesalePrice", "originalPrice"];
  return {
    changes: rowsOf(changes)
      .map((row) => {
        const metadata = row.metadata ?? {};
        const fields: string[] = Array.isArray(metadata.fields) ? metadata.fields.map(String) : [];
        const recorded = metadata.priceChanges && typeof metadata.priceChanges === "object" ? metadata.priceChanges : null;
        const touched = recorded ? Object.keys(recorded) : fields.filter((field) => priceFields.includes(field));
        if (!touched.length) return null;
        return {
          at: textDate(row.created_at),
          employee: row.user_name || null,
          changes: touched.map((field) => ({
            field,
            from: recorded?.[field]?.from ?? null,
            to: recorded?.[field]?.to ?? null,
            // Older logs stored only the changed field names.
            valuesRecorded: Boolean(recorded?.[field]),
          })),
          reason: metadata.reason ?? null,
        };
      })
      .filter(Boolean),
    sellingByMonth: rowsOf(sellingByMonth).map((row) => ({
      month: String(row.month),
      averagePrice: Math.round(num(row.average_price) * 100) / 100,
      minPrice: num(row.min_price),
      maxPrice: num(row.max_price),
    })),
  };
}

async function relatedProducts(executor: Executor, productId: number, product: any) {
  const [bundles, together] = await Promise.all([
    executor.execute(sql`
      SELECT b.id, b.name, bi.quantity::float AS quantity, b.offer_price::float AS offer_price,
             b.normal_price::float AS normal_price, b.is_active
      FROM product_bundle_items bi JOIN product_bundles b ON b.id = bi.bundle_id
      WHERE bi.product_id = ${productId} AND b.archived_at IS NULL ORDER BY b.id DESC LIMIT 20
    `),
    executor.execute(sql`
      SELECT x.product_id, COALESCE(p.name_ar, p.name) AS name, COUNT(DISTINCT x.invoice_id)::int AS invoices,
             SUM(x.quantity::numeric)::float AS quantity
      FROM sales_invoice_items mine
      JOIN sales_invoices si ON si.id = mine.invoice_id
      JOIN sales_invoice_items x ON x.invoice_id = mine.invoice_id AND x.product_id IS NOT NULL AND x.product_id <> ${productId}
      JOIN products p ON p.id = x.product_id
      WHERE mine.product_id = ${productId} AND ${COUNTED_SALE}
      GROUP BY x.product_id, p.name_ar, p.name ORDER BY invoices DESC, quantity DESC LIMIT 8
    `),
  ]);
  return {
    bundles: rowsOf(bundles).map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      quantity: num(row.quantity),
      price: num(row.offer_price) || num(row.normal_price),
      isActive: row.is_active !== false,
    })),
    boughtTogether: rowsOf(together).map((row) => ({
      productId: Number(row.product_id),
      name: String(row.name),
      invoices: num(row.invoices),
      quantity: num(row.quantity),
    })),
  };
}

async function assetDetails(executor: Executor, productId: number, quantityTracked: boolean, finance: boolean) {
  const [profile, passport, custody, rentals, timeline, lineRows] = await Promise.all([
    executor.execute(sql`SELECT status, purchase_price, current_value, usage_count, expected_life_uses, deleted_at FROM asset_profiles WHERE product_id = ${productId}`),
    executor.execute(sql`
      SELECT ap.qr_token, ap.serial_number, ap.last_location, ap.maintenance_cost, ap.next_maintenance_date, w.name AS warehouse_name
      FROM asset_passports ap LEFT JOIN warehouses w ON w.id = ap.warehouse_id WHERE ap.product_id = ${productId}
    `),
    executor.execute(sql`
      SELECT c.id, c.quantity, c.status, c.issued_at, c.returned_at, c.notes, COALESCE(s.full_name, s.username) AS staff_name
      FROM equipment_custody c LEFT JOIN staff s ON s.id = c.staff_id
      WHERE c.product_id = ${productId} ORDER BY c.issued_at DESC LIMIT 30
    `),
    executor.execute(sql`
      SELECT COUNT(*)::int AS rentals, COALESCE(SUM(total_amount::numeric), 0)::float AS revenue
      FROM rental_orders WHERE (product_id = ${productId} OR stock_source_product_id = ${productId})
        AND COALESCE(status, '') NOT IN ('cancelled', 'canceled')
    `),
    executor.execute(sql`
      SELECT type, title, body, actor_name, created_at FROM entity_timeline
      WHERE entity_type = 'asset' AND entity_id = ${productId}
        AND type IN ('maintenance', 'damage', 'repair', 'inspection', 'lost', 'retired', 'depreciation_updated')
      ORDER BY created_at DESC LIMIT 30
    `),
    quantityCommitmentRows(executor, [productId]),
  ]);
  const profileRow = rowsOf(profile)[0];
  const passportRow = rowsOf(passport)[0];
  const rentalRow = rowsOf(rentals)[0];
  const bookings = describeLines(lineRows.get(productId) ?? []);
  const acquisitionCost = num(profileRow?.purchase_price);
  const maintenanceCost = num(passportRow?.maintenance_cost);
  const rentalRevenue = num(rentalRow?.revenue);
  return {
    quantity: quantityTracked ? await quantityAssetSummary(executor, productId) : null,
    status: profileRow?.status ?? "active",
    usageCount: num(profileRow?.usage_count),
    expectedLifeUses: num(profileRow?.expected_life_uses) || null,
    qrToken: passportRow?.qr_token ?? null,
    serialNumber: passportRow?.serial_number ?? null,
    location: passportRow?.last_location ?? null,
    warehouse: passportRow?.warehouse_name ?? null,
    nextMaintenanceDate: passportRow?.next_maintenance_date ? String(passportRow.next_maintenance_date).slice(0, 10) : null,
    bookingsUsed: new Set(bookings.map((line) => `${line.source}:${line.bookingId}`)).size,
    activeBookings: bookings.filter((line) => line.outstanding > 0 || !["returned", "completed"].includes(line.stage)).length,
    bookings: bookings.slice(0, 50),
    custody: rowsOf(custody).map((row) => ({
      id: Number(row.id),
      quantity: num(row.quantity),
      status: String(row.status),
      issuedAt: textDate(row.issued_at),
      returnedAt: textDate(row.returned_at),
      staff: row.staff_name ?? null,
      notes: row.notes ?? null,
    })),
    maintenanceHistory: rowsOf(timeline).map((row) => ({
      type: String(row.type),
      title: String(row.title),
      body: row.body ?? null,
      actor: row.actor_name ?? null,
      at: textDate(row.created_at),
    })),
    finance: finance
      ? {
          acquisitionCost,
          currentValue: num(profileRow?.current_value),
          maintenanceCost,
          rentals: num(rentalRow?.rentals),
          // Only rental orders are attributable to one asset; booking revenue is
          // shared across many items and is deliberately not assigned here.
          attributableRevenue: rentalRevenue,
          roi: assetReturn({ acquisitionCost, maintenanceCost, attributableRevenue: rentalRevenue }),
        }
      : null,
  };
}

async function timelineEvents(
  executor: Executor,
  product: any,
  movements: Awaited<ReturnType<typeof productMovements>>["data"],
  prices: Awaited<ReturnType<typeof priceHistory>>["changes"],
) {
  const events: Array<{ at: string | null; type: string; title: string; detail: string | null; href: string | null }> = [
    { at: textDate(product.created_at), type: "created", title: "إنشاء المنتج", detail: null, href: null },
  ];
  for (const movement of movements)
    events.push({
      at: movement.createdAt,
      type: "movement",
      title: `${movement.label}: ${movement.quantityIn ? `+${movement.quantityIn}` : `-${movement.quantityOut}`}`,
      detail: [movement.reference?.label, movement.employee].filter(Boolean).join(" · ") || null,
      href: movement.reference?.href ?? null,
    });
  for (const change of prices as any[])
    events.push({
      at: change.at,
      type: "price",
      title: "تغيير السعر",
      detail: change.changes
        .map((item: any) => (item.valuesRecorded ? `${item.field}: ${item.from ?? "—"} ← ${item.to ?? "—"}` : `${item.field} (القيمة السابقة غير مسجلة)`))
        .join(" · "),
      href: null,
    });
  return events.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? ""))).slice(0, 80);
}

export async function productInsights(
  executor: Executor,
  productId: number,
  input: {
    range: InsightsRange;
    access: InsightsAccess;
    group: "day" | "month" | "year";
    slowDays: number;
    leadTimeDays: number;
  },
) {
  const { product, stock, stockOwnerId } = await loadProduct(executor, productId);
  const today = baghdadDay();
  const { range, access } = input;
  const [variantCountRow, reservedRow, warehouses, damagedRow, adjustmentsRow, quantityProfiles] = await Promise.all([
    executor.execute(sql`SELECT COUNT(*)::int AS count FROM product_variants WHERE product_id = ${productId}`),
    executor.execute(sql`SELECT COALESCE(SUM(quantity::numeric), 0)::float AS quantity FROM stock_reservations WHERE product_id = ${stockOwnerId} AND status = 'reserved'`),
    warehouseBreakdowns(executor as any, [stockOwnerId]).then((map) => ({ rows: (map.get(stockOwnerId)?.shares ?? []).filter((share) => share.inWarehouse !== 0).sort((a, b) => b.inWarehouse - a.inWarehouse).map((share) => ({ id: share.warehouseId, name: share.name, quantity: share.inWarehouse })) })),
    executor.execute(sql`
      SELECT COALESCE(SUM(-quantity_change::numeric) FILTER (WHERE quantity_change::numeric < 0), 0)::float AS quantity
      FROM stock_movements WHERE (product_id = ${productId} OR stock_source_product_id = ${productId})
        AND reason ~* '(damage|loss)' AND reason !~* 'quantity_asset_return'
    `),
    executor.execute(sql`
      SELECT COUNT(*)::int AS count FROM stock_movements
      WHERE (product_id = ${productId} OR stock_source_product_id = ${productId})
        AND reason = 'manual_stock_adjustment' AND created_at > now() - interval '30 days'
    `),
    quantityProfilesFor(executor, [productId]),
  ]);
  const quantityTracked = quantityProfiles.has(productId);
  const variantCount = num(rowsOf(variantCountRow)[0]?.count);
  const kind = productKind({
    itemType: product.item_type,
    trackInventory: product.track_inventory,
    isAsset: product.is_asset === true,
    quantityTracked,
    variantCount,
  });
  const reserved = num(rowsOf(reservedRow)[0]?.quantity);
  const available = Math.max(0, stock - reserved);
  const minStock = num(product.min_stock);

  const [channels, series, activity, movements, variants, prices, related] = await Promise.all([
    salesChannels(executor, productId, range),
    salesSeries(executor, productId, range, input.group),
    salesActivity(executor, productId, today),
    productMovements(executor, productId, { page: 1, limit: 50, currentStock: stock }),
    variantCount > 0 ? variantAnalytics(executor, productId, range, access.finance) : Promise.resolve([]),
    priceHistory(executor, productId, range),
    relatedProducts(executor, productId, product),
  ]);
  const [purchaseData, customers, employees, asset] = await Promise.all([
    access.finance ? purchases(executor, productId, range) : Promise.resolve(null),
    access.customers ? topCustomers(executor, productId, range) : Promise.resolve(null),
    access.finance ? employeeSales(executor, productId, range) : Promise.resolve(null),
    product.is_asset === true ? assetDetails(executor, productId, quantityTracked, access.finance) : Promise.resolve(null),
  ]);
  const totals = combineChannels([channels.retail, channels.wholesale, channels.online]);
  const slow = slowMoving({
    today,
    createdAt: textDate(product.created_at),
    lastSaleDate: activity.lastSale,
    stock,
    thresholdDays: input.slowDays,
    unitsLast30Days: activity.units30,
  });
  const forecast =
    kind === "service" || kind === "individual_asset"
      ? null
      : depletionForecast({
          available,
          unitsInWindow: activity.units90,
          sellingDaysInWindow: activity.sellingDays90,
          windowDays: 90,
          ageDays: slow.ageDays,
          leadTimeDays: input.leadTimeDays,
          coverDays: 30,
          minStock,
          sameMonthLastYear: activity.sameMonthLastYear,
          last30Days: activity.units30,
        });
  const costPrice = access.finance ? num(product.cost_price) : null;
  const alerts = productAlerts({
    productId,
    kind,
    stock,
    available,
    minStock,
    isSlow: slow.isSlow,
    daysSinceSale: slow.daysSinceSale,
    price: num(product.price),
    costPrice,
    latestPurchaseCost: purchaseData?.latestCost ?? null,
    previousAveragePurchaseCost: purchaseData?.previousAverageCost ?? null,
    soldQuantity: totals.quantity,
    returnsQuantity: totals.returnsQuantity,
    manualAdjustmentsLast30Days: num(rowsOf(adjustmentsRow)[0]?.count),
  }).filter((alert) => access.finance || !["negative_margin", "rising_cost"].includes(alert.key));
  const hideMoney = <T extends Record<string, any>>(figures: T) =>
    access.finance ? figures : { ...figures, cogs: null, grossProfit: null, margin: null };
  const images: string[] = Array.isArray(product.images) ? product.images : [];

  return {
    product: {
      id: productId,
      name: product.name_ar || product.name,
      nameEn: product.name ?? null,
      barcode: product.barcode ?? null,
      code: product.is_asset ? `AJN-A${String(productId).padStart(6, "0")}` : product.barcode ?? `#${productId}`,
      category: product.category_name_ar || product.category_name || product.category || null,
      subcategory: product.subcategory ?? null,
      unit: product.service_unit || "قطعة",
      itemType: product.item_type ?? "product",
      kind,
      price: num(product.price),
      wholesalePrice: product.wholesale_price == null ? null : num(product.wholesale_price),
      costPrice,
      margin:
        costPrice !== null && num(product.price) > 0 ? Math.round(((num(product.price) - costPrice) / num(product.price)) * 10000) / 100 : null,
      isActive: product.is_active !== false,
      isRental: product.is_rental === true,
      isAsset: product.is_asset === true,
      description: product.description_ar || product.description || null,
      imageCount: images.length,
      createdAt: textDate(product.created_at),
      sharedStockProductId: stockOwnerId !== productId ? stockOwnerId : null,
    },
    access,
    range,
    kpis: {
      purchasedQuantity: purchaseData ? purchaseData.quantity : null,
      soldQuantity: totals.quantity + channels.bundles.quantity,
      bundleQuantity: channels.bundles.quantity,
      stock,
      availableQuantity: available,
      reservedQuantity: reserved,
      damagedQuantity: num(rowsOf(damagedRow)[0]?.quantity),
      grossSales: totals.grossSales,
      netSales: totals.netSales,
      cogs: access.finance ? totals.cogs : null,
      grossProfit: access.finance ? totals.grossProfit : null,
      margin: access.finance ? totals.margin : null,
      uncostedNetSales: totals.uncostedNetSales,
    },
    sales: {
      totals: hideMoney(totals),
      retail: hideMoney(channels.retail),
      wholesale: hideMoney(channels.wholesale),
      online: channels.online,
      bundles: { quantity: channels.bundles.quantity, invoices: channels.bundles.invoices },
      series: series.map((point) => (access.finance ? point : { ...point, cogs: null })),
      customers,
      employees,
    },
    purchases: purchaseData,
    inventory: {
      stock,
      reserved,
      available,
      minStock,
      checkedOut: asset?.quantity?.checkedOut ?? null,
      damaged: asset?.quantity ? asset.quantity.damaged : num(rowsOf(damagedRow)[0]?.quantity),
      warehouses: rowsOf(warehouses).map((row) => ({ id: Number(row.id), name: String(row.name), quantity: num(row.quantity) })),
      stockValue: access.finance && costPrice !== null ? Math.round(stock * costPrice * 100) / 100 : null,
    },
    movements,
    variants,
    prices,
    timeline: await timelineEvents(executor, product, movements.data, prices.changes),
    intelligence: { slow, forecast, alerts },
    related,
    asset,
  };
}

/** Slow-moving products for the Products page filter (one aggregated query). */
export async function slowMovingProducts(executor: Executor, thresholdDays: number) {
  const today = baghdadDay();
  const rows = rowsOf(
    await executor.execute(sql`
      WITH sold AS (
        SELECT sii.product_id, si.date::date AS d, sii.quantity::numeric AS q
        FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE sii.product_id IS NOT NULL AND ${COUNTED_SALE}
        UNION ALL
        SELECT oi.product_id, o.created_at::date, oi.quantity::numeric
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id IS NOT NULL AND ${COUNTED_ORDER}
      ),
      last_sale AS (
        SELECT product_id, MAX(d) AS last_sale, COALESCE(SUM(q) FILTER (WHERE d > ${today}::date - 30), 0) AS units_30
        FROM sold GROUP BY product_id
      )
      SELECT p.id, p.stock::float AS stock, p.cost_price::float AS cost_price, p.created_at,
             l.last_sale::text AS last_sale, COALESCE(l.units_30, 0)::float AS units_30
      FROM products p LEFT JOIN last_sale l ON l.product_id = p.id
      WHERE p.is_active = true AND COALESCE(p.item_type, 'product') <> 'service'
        AND COALESCE(p.track_inventory, true) = true AND p.stock::numeric > 0
    `),
  );
  return rows
    .map((row) => ({
      productId: Number(row.id),
      stock: num(row.stock),
      stockValue: Math.round(num(row.stock) * num(row.cost_price) * 100) / 100,
      ...slowMoving({
        today,
        createdAt: textDate(row.created_at),
        lastSaleDate: row.last_sale ?? null,
        stock: num(row.stock),
        thresholdDays,
        unitsLast30Days: num(row.units_30),
      }),
    }))
    .filter((row) => row.isSlow);
}
