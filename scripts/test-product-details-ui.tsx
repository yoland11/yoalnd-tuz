import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
// Match the CJS module instances used by tsx-transpiled view dependencies.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
const { Router, Route } = createRequire(import.meta.url)("wouter") as typeof import("wouter");
(globalThis as any).React = React;
import * as detailsModule from "../src/views/admin/product-details";
// tsx/CJS interop can wrap the default export once more.
const ProductDetailsPage = ((detailsModule as any).default?.default ?? (detailsModule as any).default) as React.ComponentType;

const today = new Date().toISOString().slice(0, 10);
const channel = (quantity: number, net: number, cogs: number | null) => ({
  quantity, invoices: Math.max(1, Math.round(quantity / 5)), grossSales: net, discounts: 0, netSales: net,
  cogs, grossProfit: cogs == null ? null : net - cogs, margin: cogs == null ? null : Math.round(((net - cogs) / net) * 10000) / 100,
  returnsQuantity: 0, returnsValue: 0,
});
function payload(finance: boolean) {
  const retail = channel(120, 2_160_000, finance ? 1_200_000 : null);
  const wholesale = channel(200, 3_000_000, finance ? 2_000_000 : null);
  return {
    product: { id: 5, name: "قبعة تخرج", nameEn: "Graduation cap", barcode: "AJN00000005", code: "AJN00000005", category: "التخرج", unit: "قطعة", kind: "product", price: 18_000, wholesalePrice: 15_000, costPrice: finance ? 10_000 : null, margin: finance ? 44.44 : null, isActive: true, isRental: false, isAsset: false, description: "قبعة تخرج سوداء مع شرابة ذهبية", imageCount: 0, createdAt: "2025-09-01T10:00:00Z", sharedStockProductId: null },
    access: { finance, customers: finance },
    range: { from: "2000-01-01", to: today },
    kpis: { purchasedQuantity: finance ? 200 : null, soldQuantity: 320, bundleQuantity: 0, stock: 85, availableQuantity: 80, reservedQuantity: 5, damagedQuantity: 2, grossSales: 5_160_000, netSales: 5_160_000, cogs: finance ? 3_200_000 : null, grossProfit: finance ? 1_960_000 : null, margin: finance ? 37.98 : null, uncostedNetSales: 0 },
    sales: {
      totals: { ...channel(320, 5_160_000, finance ? 3_200_000 : null), averagePrice: 16_125, uncostedNetSales: 0 },
      retail, wholesale, online: channel(0, 0, null), bundles: { quantity: 0, invoices: 0 },
      series: ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((period, index) => ({ period, quantity: 40 + index * 20, net: 700_000 + index * 250_000, cogs: finance ? 400_000 + index * 150_000 : null })),
      customers: finance ? [{ customerId: 3, name: "مدرسة النور", quantity: 60, invoices: 2, net: 1_000_000, lastDate: today }] : null,
      employees: finance ? [{ staffId: 1, name: "علي", invoices: 20, quantity: 150, gross: 2_700_000, net: 2_650_000, returnsQuantity: 4 }] : null,
    },
    purchases: finance ? { quantity: 200, value: 2_000_000, attributableCosts: 50_000, averageCost: 10_000, averageLandedCost: 10_250, latestCost: 11_000, returnsQuantity: 10, returnsValue: 90_000, suppliers: [{ supplierId: 1, name: "مورد بغداد", quantity: 100, value: 1_100_000, returnsQuantity: 0, latestPrice: 11_000, averagePrice: 11_000, lastDate: today, purchases: 1 }], history: [{ invoiceId: 4, invoiceNo: "PI-4", date: today, supplier: "مورد بغداد", variantLabel: null, quantity: 100, unitCost: 11_000, total: 1_100_000, status: "active" }] } : null,
    inventory: { stock: 85, reserved: 5, available: 80, minStock: 10, checkedOut: null, damaged: 2, warehouses: [{ id: 1, name: "المخزن الرئيسي", quantity: 85 }], stockValue: finance ? 850_000 : null },
    movements: { total: 0, page: 1, totalPages: 1, data: [] },
    variants: [],
    prices: { changes: [{ at: `${today}T09:00:00Z`, employee: "المدير", changes: [{ field: "price", from: "16000", to: "18000", valuesRecorded: true }] }], sellingByMonth: [{ month: today.slice(0, 7), averagePrice: 17_500, minPrice: 16_000, maxPrice: 18_000 }] },
    timeline: [{ at: `${today}T09:00:00Z`, type: "movement", title: "بيع: -20", detail: "فاتورة بيع #9 · علي", href: "/admin/invoice/9" }, { at: "2025-09-01T10:00:00Z", type: "created", title: "إنشاء المنتج", detail: null, href: null }],
    intelligence: {
      slow: { ageDays: 410, daysSinceSale: 2, lastSaleDate: today, thresholdDays: 60, velocityPerDay: 3, isSlow: false, tooNew: false },
      forecast: { sufficient: true, averageDaily: 3, windowDays: 90, daysRemaining: 26, leadTimeDays: 14, reorderPoint: 52, recommendedQuantity: 62, reorderNow: false, seasonal: null },
      alerts: finance ? [{ key: "rising_cost", level: "warning", title: "ارتفاع تكلفة الشراء", reason: "آخر سعر شراء 11000 أعلى من المتوسط السابق 9000." }] : [],
    },
    related: { bundles: [{ id: 2, name: "بكج تخرج", quantity: 1, price: 45_000, isActive: true }], boughtTogether: [{ productId: 6, name: "روب تخرج", invoices: 22, quantity: 25 }] },
    asset: null,
  };
}
function render(finance: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["admin", "product-insights", 5, "group=month&slowDays=60&leadTime=14"], payload(finance));
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Router, { ssrPath: "/admin/products/5" }, createElement(Route, { path: "/admin/products/:id" }, createElement(ProductDetailsPage)))),
  );
}

const full = render(true);
for (const label of ["قبعة تخرج", "إجراءات سريعة", "الكمية المشتراة", "الكمية المباعة", "الكمية المتوفرة", "الكمية المحجوزة", "الكمية التالفة", "إجمالي المبيعات", "صافي المبيعات", "تكلفة البضاعة المباعة", "مجمل الربح", "هامش الربح", "نظرة عامة", "المبيعات", "المشتريات والتكاليف", "المخزون والحركات", "التقارير", "تنبيهات المنتج", "تحليل المنتجات الراكدة", "توقع نفاد المخزون", "مقارنة المفرد والجملة", "المنتجات المرتبطة والبكجات", "سجل تغيّر الأسعار", "سجل حياة المنتج", "كل الفترة"])
  assert.ok(full.includes(label), `page renders ${label}`);
assert.match(full, /dir="rtl"/);
const limited = render(false);
for (const hidden of ["تكلفة البضاعة المباعة", "هامش الربح", "المشتريات والتكاليف", "تكلفة الوحدة"])
  assert.ok(!limited.includes(hidden), `without accounting permission the page hides ${hidden}`);
assert.ok(!limited.includes("المتغيرات"), "no variants tab for a product without variants");
if (process.env.AJN_PRODUCT_DETAILS_HTML) writeFileSync(process.env.AJN_PRODUCT_DETAILS_HTML, full);
console.log("PASS  product details page renders RTL KPIs, tabs and sections, and hides finance without permission");
