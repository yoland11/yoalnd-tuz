import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  assetReturn,
  channelFigures,
  combineChannels,
  depletionForecast,
  movementReference,
  productAlerts,
  productKind,
  slowMoving,
} from "../src/lib/product-insights";
import { productInsights, productMovements, slowMovingProducts } from "../src/server/product-insights";
import { baghdadDay } from "../src/server/quantity-assets";

const today = baghdadDay();
const shift = (days: number) => {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// ── 1. Pure rules ────────────────────────────────────────────────────────────
{
  // Spec example: 120 sold at 18,000, cost 10,000 → 2,160,000 / 1,200,000 / 960,000.
  const retail = channelFigures({ quantity: 120, invoices: 40, grossSales: 2_160_000, discounts: 0, cogs: 1_200_000 });
  assert.deepEqual([retail.netSales, retail.cogs, retail.grossProfit, retail.margin], [2_160_000, 1_200_000, 960_000, 44.44]);
  const wholesale = channelFigures({ quantity: 200, invoices: 4, grossSales: 3_000_000, discounts: 100_000, cogs: 2_000_000, returnsQuantity: 10, returnsValue: 150_000 });
  assert.equal(wholesale.netSales, 2_900_000);
  const online = channelFigures({ quantity: 5, invoices: 5, grossSales: 90_000, discounts: 0, cogs: null });
  assert.equal(online.grossProfit, null, "no cost snapshot → no invented profit");
  const totals = combineChannels([retail, wholesale, online]);
  assert.equal(totals.quantity, 325);
  assert.equal(totals.netSales, 5_150_000);
  assert.equal(totals.cogs, 3_200_000);
  assert.equal(totals.grossProfit, 1_860_000, "profit only over revenue that has a recorded cost");
  assert.equal(totals.uncostedNetSales, 90_000);
  assert.equal(totals.margin, Math.round((1_860_000 / 5_060_000) * 10000) / 100);
  assert.equal(totals.returnsQuantity, 10);

  assert.equal(productKind({ isAsset: true, quantityTracked: true }), "quantity_asset");
  assert.equal(productKind({ isAsset: true }), "individual_asset");
  assert.equal(productKind({ itemType: "service" }), "service");
  assert.equal(productKind({ trackInventory: false }), "service");
  assert.equal(productKind({ variantCount: 4 }), "variants");
  assert.equal(productKind({}), "product");

  // A new product is never "slow"; an old one with stock and no recent sale is.
  assert.equal(slowMoving({ today, createdAt: shift(-10), lastSaleDate: null, stock: 50, thresholdDays: 60, unitsLast30Days: 0 }).isSlow, false);
  assert.equal(slowMoving({ today, createdAt: shift(-200), lastSaleDate: shift(-75), stock: 50, thresholdDays: 60, unitsLast30Days: 0 }).isSlow, true);
  assert.equal(slowMoving({ today, createdAt: shift(-200), lastSaleDate: shift(-5), stock: 50, thresholdDays: 60, unitsLast30Days: 9 }).isSlow, false);
  assert.equal(slowMoving({ today, createdAt: shift(-200), lastSaleDate: null, stock: 0, thresholdDays: 60, unitsLast30Days: 0 }).isSlow, false, "no stock → nothing is stagnating");

  const insufficient = depletionForecast({ available: 150, unitsInWindow: 4, sellingDaysInWindow: 2, windowDays: 90, ageDays: 300, leadTimeDays: 14, coverDays: 30, minStock: 0, sameMonthLastYear: null, last30Days: 4 });
  assert.deepEqual(insufficient, { sufficient: false, message: "البيانات غير كافية للتوقع" });
  // Spec example: 150 available, 10/day → 15 days.
  const forecast = depletionForecast({ available: 150, unitsInWindow: 900, sellingDaysInWindow: 60, windowDays: 90, ageDays: 300, leadTimeDays: 14, coverDays: 30, minStock: 10, sameMonthLastYear: 900, last30Days: 300 });
  assert.ok(forecast.sufficient);
  if (forecast.sufficient) {
    assert.equal(forecast.averageDaily, 10);
    assert.equal(forecast.daysRemaining, 15);
    assert.equal(forecast.reorderPoint, 150);
    assert.equal(forecast.reorderNow, true);
    assert.equal(forecast.recommendedQuantity, 300);
    assert.match(String(forecast.seasonal), /السنة الماضية/);
  }

  const alerts = productAlerts({ productId: 1, kind: "product", stock: 3, available: 3, minStock: 5, isSlow: true, daysSinceSale: 80, price: 9000, costPrice: 10000, latestPurchaseCost: 12000, previousAveragePurchaseCost: 10000, soldQuantity: 20, returnsQuantity: 5, manualAdjustmentsLast30Days: 4 });
  assert.deepEqual(alerts.map((alert) => alert.key), ["low_stock", "slow_moving", "negative_margin", "rising_cost", "high_returns", "adjustments"]);
  assert.deepEqual(productAlerts({ productId: 1, kind: "service", stock: 0, available: 0, minStock: 0, isSlow: false, daysSinceSale: null, price: 10000, costPrice: null, latestPurchaseCost: null, previousAveragePurchaseCost: null, soldQuantity: 0, returnsQuantity: 0, manualAdjustmentsLast30Days: 0 }), [], "services never get stock alerts");

  assert.deepEqual(assetReturn({ acquisitionCost: 1_500_000, maintenanceCost: 100_000, attributableRevenue: 0 }), { calculable: false, reason: "لا توجد إيرادات منسوبة مباشرة لهذا الأصل" });
  assert.deepEqual(assetReturn({ acquisitionCost: 1_000_000, maintenanceCost: 100_000, attributableRevenue: 600_000 }), { calculable: true, contribution: 500_000, roi: 50 });

  assert.deepEqual(movementReference({ relatedType: "sales_invoice", relatedId: 7, salesInvoiceId: null }), { label: "فاتورة بيع #7", href: "/admin/invoice/7" });
  assert.deepEqual(movementReference({ relatedType: "purchase_invoice", relatedId: 3, salesInvoiceId: null }), { label: "فاتورة شراء #3", href: "/admin/purchases?invoice=3" });
  console.log("PASS  product rules: channels, COGS/profit, kinds, slow-moving, forecast, alerts, ROI, references");
}

// ── 2. Real module against a SQL-level mock ──────────────────────────────────
const dialect = new PgDialect();
function database(options: { product?: Record<string, unknown>; variants?: any[] } = {}) {
  const statements: string[] = [];
  const product = {
    id: 5, name: "Graduation cap", name_ar: "قبعة تخرج", barcode: "AJN00000005", category: "تخرج", category_name_ar: "التخرج",
    item_type: "product", track_inventory: true, price: "18000", wholesale_price: "15000", cost_price: "10000", stock: "80", min_stock: "10",
    is_asset: false, is_active: true, images: ["a", "b"], created_at: new Date(`${shift(-400)}T10:00:00Z`), shared_stock_product_id: null,
    service_unit: "", description_ar: "قبعة سوداء",
    ...options.product,
  };
  const execute = async (query: any) => {
    const built = dialect.sqlToQuery(query);
    const q = built.sql.replace(/\s+/g, " ").trim();
    statements.push(q);
    const rows = (value: any[]) => ({ rows: value });
    if (q.startsWith("SELECT p.*, c.name_ar AS category_name_ar")) return rows([product]);
    if (q.includes("information_schema.tables")) return rows([{ ready: true }]);
    if (q.includes("from asset_quantity_profiles")) return rows([]);
    if (q.startsWith("SELECT COUNT(*)::int AS count FROM product_variants")) return rows([{ count: options.variants?.length ?? 0 }]);
    if (q.startsWith("SELECT COALESCE(SUM(quantity::numeric), 0)::float AS quantity FROM stock_reservations WHERE product_id")) return rows([{ quantity: 5 }]);
    if (q.includes("FROM warehouse_stock ws JOIN warehouses w")) return rows([{ id: 1, name: "المخزن الرئيسي", quantity: 80 }]);
    if (q.includes("reason ~* '(damage|loss)'")) return rows([{ quantity: 2 }]);
    if (q.includes("reason = 'manual_stock_adjustment'")) return rows([{ count: 1 }]);
    if (q.includes("FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id WHERE sii.product_id = $1 AND si.date >= $2") && q.includes("GROUP BY 1, 2"))
      return rows([
        { channel: "retail", counted: true, quantity: 100, invoices: 30, gross: 1_800_000, discounts: 50_000, cogs: 1_000_000 },
        { channel: "retail", counted: false, quantity: 4, invoices: 2, gross: 72_000, discounts: 0, cogs: 40_000 },
        { channel: "wholesale", counted: true, quantity: 200, invoices: 3, gross: 3_000_000, discounts: 0, cogs: 2_000_000 },
      ]);
    if (q.includes("FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = $1 AND o.created_at::date >= $2") && q.includes("GROUP BY 1"))
      return rows([{ counted: true, quantity: 10, invoices: 8, gross: 180_000, discounts: 10_000 }]);
    if (q.includes("FROM sales_invoice_bundle_snapshots s JOIN sales_invoices si") && q.includes("COUNT(DISTINCT s.invoice_id)")) return rows([{ quantity: 6, invoices: 3, cogs: 60_000 }]);
    if (q.includes("to_char(date_trunc($")) return rows([{ period: `${today.slice(0, 7)}-01`, quantity: 310, net: 4_920_000, cogs: 3_000_000 }]);
    if (q.includes("MAX(d)::text AS last_sale")) return rows([{ last_sale: shift(-2), units_30: 90, units_90: 270, selling_days_90: 40, units_last_year_30: 0, rows_last_year: 0 }]);
    if (q.includes("FROM stock_movements m LEFT JOIN warehouses w")) {
      assert.match(q, /OVER \( ORDER BY m\.created_at DESC, m\.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING\)/, "balance reconstructed backwards from current stock");
      return rows([
        { id: 2, created_at: new Date(), reason: "sales_invoice_stock_deducted", quantity_change: -20, related_type: "sales_invoice", related_id: 9, sales_invoice_id: 9, warehouse_name: "المخزن الرئيسي", created_by_name: "علي", metadata: {}, balance_after: 80 },
        { id: 1, created_at: new Date(Date.now() - 86_400_000), reason: "purchase_invoice_stock_increased", quantity_change: 100, related_type: "purchase_invoice", related_id: 4, sales_invoice_id: null, warehouse_name: null, created_by_name: "حسين", metadata: {}, balance_after: 100 },
      ]);
    }
    if (q.startsWith("SELECT COUNT(*)::int AS count FROM stock_movements m")) return rows([{ count: 2 }]);
    if (q.startsWith("SELECT id, color, size, sku, barcode, stock::float")) return rows(options.variants ?? []);
    if (q.includes("WHERE pii.variant_id IN")) return rows([{ variant_id: 11, quantity: 50 }]);
    if (q.includes("WITH moved AS")) return rows([{ variant_id: 11, quantity: 30, revenue: 540_000, cogs: 300_000 }]);
    if (q.includes("WHERE oi.variant_id IN")) return rows([]);
    if (q.includes("FROM stock_reservations WHERE variant_id IN")) return rows([]);
    if (q.startsWith("SELECT created_at, user_name, metadata FROM admin_activity_logs"))
      return rows([
        { created_at: new Date(), user_name: "المدير", metadata: { fields: ["price", "updatedAt"], priceChanges: { price: { from: "16000", to: "18000" } } } },
        { created_at: new Date(Date.now() - 86_400_000 * 30), user_name: "المدير", metadata: { fields: ["costPrice", "updatedAt"] } },
        { created_at: new Date(), user_name: "المدير", metadata: { fields: ["nameAr", "updatedAt"] } },
      ]);
    if (q.includes("AS average_price")) return rows([{ month: today.slice(0, 7), average_price: 17_500, min_price: 16_000, max_price: 18_000 }]);
    if (q.includes("FROM product_bundle_items bi JOIN product_bundles b")) return rows([{ id: 2, name: "بكج تخرج", quantity: 1, offer_price: 45_000, normal_price: 50_000, is_active: true }]);
    if (q.includes("JOIN sales_invoice_items x ON x.invoice_id = mine.invoice_id")) return rows([{ product_id: 6, name: "روب تخرج", invoices: 22, quantity: 25 }]);
    if (q.includes("FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.invoice_id WHERE pii.product_id"))
      return rows([
        { invoice_id: 4, invoice_no: "PI-4", date: shift(-30), supplier_id: 1, supplier: "مورد بغداد", status: "active", variant_label: null, quantity: 100, unit_cost: 11_000, total: 1_100_000, shipping: 50_000, invoice_lines: 1_100_000 },
        { invoice_id: 3, invoice_no: "PI-3", date: shift(-90), supplier_id: 2, supplier: "مورد أربيل", status: "active", variant_label: null, quantity: 100, unit_cost: 9_000, total: 900_000, shipping: 0, invoice_lines: 900_000 },
        { invoice_id: 2, invoice_no: "PI-2", date: shift(-120), supplier_id: 2, supplier: "مورد أربيل", status: "cancelled", variant_label: null, quantity: 10, unit_cost: 9_000, total: 90_000, shipping: 0, invoice_lines: 90_000 },
      ]);
    if (q.includes("COALESCE(NULLIF(si.customer_name, ''), 'زبون نقدي')")) return rows([{ customer_id: 3, name: "مدرسة النور", quantity: 60, invoices: 2, net: 1_000_000, last_date: shift(-3) }]);
    if (q.includes("COALESCE(NULLIF(si.created_by_name, ''), 'غير مسجل')")) return rows([{ created_by: 1, name: "علي", invoices: 20, quantity: 150, gross: 2_700_000, net: 2_650_000, returns_quantity: 4 }]);
    if (q.includes("WITH sold AS") && q.includes("last_sale AS")) return rows([
      { id: 5, stock: 80, cost_price: 10_000, created_at: new Date(`${shift(-400)}T10:00:00Z`), last_sale: shift(-100), units_30: 0 },
      { id: 6, stock: 10, cost_price: 5_000, created_at: new Date(`${shift(-400)}T10:00:00Z`), last_sale: shift(-1), units_30: 9 },
    ]);
    throw new Error(`Unexpected SQL in product insights test: ${q}`);
  };
  return { execute, statements };
}

async function run() {
  const finance = database();
  const full = await productInsights(finance as any, 5, {
    range: { from: "2000-01-01", to: today },
    access: { finance: true, customers: true },
    group: "month",
    slowDays: 60,
    leadTimeDays: 14,
  });
  assert.equal(full.product.kind, "product");
  assert.equal(full.product.margin, 44.44);
  assert.equal(full.kpis.soldQuantity, 316, "retail 100 + wholesale 200 + online 10 + bundles 6");
  assert.equal(full.kpis.availableQuantity, 75, "stock 80 − 5 reserved");
  assert.equal(full.kpis.cogs, 3_000_000, "COGS from the invoice cost snapshots; online has none");
  assert.equal(full.kpis.netSales, 1_750_000 + 3_000_000 + 170_000);
  assert.equal(full.kpis.grossProfit, 1_750_000 + 3_000_000 - 3_000_000);
  assert.equal(full.kpis.uncostedNetSales, 170_000);
  assert.equal(full.sales.retail.returnsQuantity, 4, "cancelled invoices are returns, excluded from net");
  assert.equal(full.purchases?.quantity, 200, "cancelled purchase invoice is a return, not a purchase");
  assert.equal(full.purchases?.returnsQuantity, 10);
  assert.equal(full.purchases?.averageCost, 10_000);
  assert.equal(full.purchases?.attributableCosts, 50_000, "shipping allocated by line value");
  assert.equal(full.purchases?.latestCost, 11_000);
  assert.deepEqual(full.purchases?.suppliers.map((row) => [row.name, row.quantity, row.returnsQuantity]), [["مورد بغداد", 100, 0], ["مورد أربيل", 100, 10]]);
  assert.ok(full.intelligence.alerts.some((alert) => alert.key === "rising_cost"), "11,000 vs previous 9,000");
  assert.equal(full.intelligence.slow.isSlow, false);
  assert.ok(full.intelligence.forecast && full.intelligence.forecast.sufficient);
  assert.equal(full.movements.data[0].quantityOut, 20);
  assert.equal(full.movements.data[0].reference?.href, "/admin/invoice/9");
  assert.equal(full.movements.data[1].label, "استلام شراء");
  assert.equal(full.prices.changes.length, 2, "only logs that touched a price field");
  assert.deepEqual(full.prices.changes[0]?.changes[0], { field: "price", from: "16000", to: "18000", valuesRecorded: true });
  assert.equal(full.prices.changes[1]?.changes[0].valuesRecorded, false, "older logs keep their honest 'not recorded' state");
  assert.equal(full.related.bundles[0].name, "بكج تخرج");
  assert.equal(full.sales.customers?.[0].name, "مدرسة النور");
  assert.equal(full.sales.employees?.[0].name, "علي");
  assert.ok(full.timeline.some((event) => event.type === "created"));
  for (const statement of finance.statements)
    assert.match(statement, /^(SELECT|WITH|select)\b/, `viewing analytics must never write: ${statement.slice(0, 80)}`);

  // Without accounting permission: no costs, profit, suppliers, employees or customer names.
  const limited = await productInsights(database() as any, 5, {
    range: { from: "2000-01-01", to: today },
    access: { finance: false, customers: false },
    group: "month",
    slowDays: 60,
    leadTimeDays: 14,
  });
  assert.equal(limited.purchases, null);
  assert.equal(limited.product.costPrice, null);
  assert.equal(limited.product.margin, null);
  assert.equal(limited.kpis.cogs, null);
  assert.equal(limited.kpis.grossProfit, null);
  assert.equal(limited.sales.retail.grossProfit, null);
  assert.equal(limited.sales.customers, null);
  assert.equal(limited.sales.employees, null);
  assert.equal(limited.inventory.stockValue, null);
  assert.ok(limited.sales.series.every((point) => point.cogs === null));
  assert.ok(!limited.intelligence.alerts.some((alert) => ["negative_margin", "rising_cost"].includes(alert.key)));

  // Variants aggregate under the parent without new parent records.
  const variantDb = database({ variants: [{ id: 11, color: "أسود", size: "M", sku: "ROBE-BK-M", barcode: "111", stock: 12, price: 30_000, cost: 18_000, is_active: true }] });
  const withVariants = await productInsights(variantDb as any, 5, { range: { from: "2000-01-01", to: today }, access: { finance: true, customers: true }, group: "month", slowDays: 60, leadTimeDays: 14 });
  assert.equal(withVariants.product.kind, "variants");
  assert.deepEqual(
    [withVariants.variants[0].name, withVariants.variants[0].purchased, withVariants.variants[0].sold, withVariants.variants[0].grossProfit],
    ["أسود / M", 50, 30, 240_000],
  );
  assert.ok(variantDb.statements.some((q) => q.includes("HAVING -SUM(m.quantity_change::numeric) > 0")), "invoice edits net out per line");

  // Services: no stock forecast.
  const service = await productInsights(database({ product: { item_type: "service", track_inventory: false } }) as any, 5, { range: { from: "2000-01-01", to: today }, access: { finance: true, customers: true }, group: "month", slowDays: 60, leadTimeDays: 14 });
  assert.equal(service.product.kind, "service");
  assert.equal(service.intelligence.forecast, null);

  const page = await productMovements(database() as any, 5, { page: 1, limit: 50, currentStock: 80 });
  assert.equal(page.total, 2);
  const slow = await slowMovingProducts(database() as any, 60);
  assert.deepEqual(slow.map((row) => row.productId), [5], "100 days without a sale is slow; yesterday's sale is not");
  console.log("PASS  product insights module: KPIs, channels, returns, purchases, variants, movements, prices, permissions, read-only");

  // ── 3. Wiring ──────────────────────────────────────────────────────────────
  const api = readFileSync("src/server/api.ts", "utf8");
  const index = readFileSync("src/views/admin/index.tsx", "utf8");
  const productsPage = readFileSync("src/views/admin/products.tsx", "utf8");
  assert.match(api, /if \(section === "product-insights"\) \{\s*if \(method !== "GET"\) return error\("الإجراء غير مدعوم", 405\);\s*const auth = await requirePermission\(req, "products"\);/);
  assert.match(api, /hasPermission\(auth, "accounting"\);\s*const customerAccess = financeAccess \|\| hasPermission\(auth, "customers"\) \|\| hasPermission\(auth, "invoices"\);/);
  assert.match(api, /\.\.\.\(Object\.keys\(priceChanges\)\.length \? \{ priceChanges \} : \{\}\)/, "price changes keep before/after in the existing audit log");
  assert.ok(index.indexOf('path="/admin/products/:id"') < index.indexOf('path="/admin/products"'), "details route registered before the list route");
  assert.match(productsPage, /<option value="slow">المنتجات الراكدة<\/option>/);
  assert.match(productsPage, /get\("edit"\)/);
  console.log("PASS  product details wiring: GET-only route, server-side finance gating, audit price history, products filter");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
