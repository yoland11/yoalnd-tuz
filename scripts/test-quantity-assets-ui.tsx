import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
// Match the CJS module instance used by tsx-transpiled view dependencies.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
const { Router } = createRequire(import.meta.url)("wouter") as typeof import("wouter");
(globalThis as any).React = React;
import { QuantityAssetPanel, type QuantitySummary } from "../src/views/admin/quantity-asset-panel";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const summary: QuantitySummary = {
  productId: 369,
  trackingMode: "quantity",
  unit: "قطعة",
  total: 100,
  inWarehouse: 65,
  checkedOut: 30,
  damaged: 3,
  maintenance: 0,
  missing: 2,
  reserved: 20,
  available: 45,
  availabilityDay: "2026-10-20",
  committedOnDay: 50,
  peakCommitment: 50,
  unitCost: 15000,
  totalValue: 1_500_000,
  lowAvailability: false,
  reconciliation: { outstandingInBookings: 30, matches: true },
  bookings: [
    { source: "kosha_booking", bookingId: 125, day: "2026-10-20", status: "confirmed", customerName: "حجز القاعة الملكية", required: 20, reserved: 20, prepared: 20, checkedOut: 20, outstanding: 0, returnedGood: 15, damaged: 3, missing: 2, returned: 20, stage: "returned" },
    { source: "service_order", bookingId: 126, day: "2026-10-20", status: "confirmed", customerName: "حفل تخرج", required: 30, reserved: 30, prepared: 30, checkedOut: 30, outstanding: 30, returnedGood: 0, damaged: 0, missing: 0, returned: 0, stage: "out" },
    { source: "kosha_booking", bookingId: 128, day: "2026-10-22", status: "confirmed", customerName: "زفاف", required: 20, reserved: 20, prepared: 0, checkedOut: 0, outstanding: 0, returnedGood: 0, damaged: 0, missing: 0, returned: 0, stage: "reserved" },
  ],
};
client.setQueryData(["admin", "asset-quantity", 369, ""], summary);
client.setQueryData(["admin", "me"], { id: 1, role: "manager", isActive: true, permissions: [] });

const markup = renderToStaticMarkup(
  createElement(
    QueryClientProvider,
    { client },
    createElement(
      Router,
      { ssrPath: "/admin/assets/new" },
      createElement("main", { className: "mx-auto max-w-6xl space-y-6 p-4", dir: "rtl" }, createElement(QuantityAssetPanel, { productId: 369 })),
    ),
  ),
);
for (const label of ["إدارة الكميات", "إجمالي الكمية", "المتوفر", "المحجوز", "الخارج", "التالف", "الصيانة", "المفقود", "إضافة كمية", "تعديل جرد", "عرض حركات الكمية", "طباعة QR", "الحجوزات المرتبطة", "تحويل بين المستودعات", "تسجيل تلف", "تسجيل فقدان"])
  assert.ok(markup.includes(label), `panel renders ${label}`);
assert.match(markup, /65 \+ خارج 30 \+ تالف 3 \+ صيانة 0 \+ مفقود 2 = 100/, "mutually exclusive states add up to the total");
assert.match(markup, /#126/);
assert.match(markup, /href="\/admin\/bookings\/service\/126"/);
assert.match(markup, /dir="rtl"/);
assert.doesNotMatch(markup, /لا تطابق مجموع الحجوزات/, "no reconciliation warning when counters match");
if (process.env.AJN_QUANTITY_UI_HTML) writeFileSync(process.env.AJN_QUANTITY_UI_HTML, markup);
console.log("PASS  quantity panel renders RTL cards, exclusive-state sum, bookings and actions");
