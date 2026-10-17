import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
// Match the CJS module instances used by tsx-transpiled view dependencies.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
const { Router } = createRequire(import.meta.url)("wouter") as typeof import("wouter");
(globalThis as any).React = React;
import { AssetsPage } from "../src/views/admin/operations";

// Server: every asset row carries its main photo through the media route.
const api = readFileSync("src/server/api.ts", "utf8");
assert.match(api, /imageUrl:\s*publicMediaList\("product", product, product\.images\)\[0\] \?\?/);

const photo =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#1f2937"/><circle cx="40" cy="40" r="22" fill="#9ca3af"/></svg>');
const row = (productId: number, name: string, imageUrl: string | null) => ({
  productId,
  name,
  assetCode: `AJN-A${String(productId).padStart(6, "0")}`,
  imageUrl,
  purchasePrice: 0,
  expectedLifeUses: 50,
  usageCount: 0,
  currentValue: 0,
  serialNumber: null,
  barcode: `AJN${String(productId).padStart(8, "0")}`,
  category: "تجهيزات",
  status: "active",
  availabilityStatus: "available",
  maintenanceDue: false,
  trackingMode: "individual",
  totalQuantity: 1,
});
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
client.setQueryData(["admin", "assets", "page=1&limit=25&quick=all&sort=updated&order=desc"], {
  data: [row(370, "استاند خلفية اسود", photo), row(57, "ورد مجفف", null)],
  pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
  summary: { total: 2, available: 2, inUse: 0, maintenance: 0, damaged: 0, currentValue: 0, purchaseValue: 0 },
  filters: { categories: [], brands: [], models: [], employees: [], warehouses: [], locations: [], assetCategories: [] },
});
client.setQueryData(["admin", "me"], { id: 1, role: "admin", isActive: true, permissions: [] });

const markup = renderToStaticMarkup(
  createElement(QueryClientProvider, { client }, createElement(Router, { ssrPath: "/admin/assets" }, createElement(AssetsPage))),
);
assert.match(markup, /<th class="w-20 p-3 text-center">الصورة<\/th>/);
assert.match(markup, /<img src="data:image\/svg\+xml[^"]*" alt="استاند خلفية اسود" title="استاند خلفية اسود" loading="lazy" decoding="async"/);
assert.match(markup, /title="لا توجد صورة"/, "assets without a photo get a placeholder, not a broken image");
if (process.env.AJN_ASSET_LIST_HTML) writeFileSync(process.env.AJN_ASSET_LIST_HTML, markup);
console.log("PASS  asset list shows each asset's photo as a small thumbnail");
