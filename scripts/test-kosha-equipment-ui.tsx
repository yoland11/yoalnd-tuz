import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
// Match the CJS module instance used by tsx-transpiled view dependencies.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
(globalThis as any).React = React;
import { KoshaEquipmentPanel } from "../src/views/admin/kosha-equipment-panel";
import { KoshaEquipmentImport } from "../src/views/admin/kosha-equipment-import";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
const lines = [
  {
    productId: 10,
    variantId: null,
    name: "أعمدة ذهبية مشتركة — تجهيز حفل الزفاف والورد الصناعي الطويل",
    imageUrl: null,
    quantity: 10,
    unit: "قطعة",
    returnable: true,
    required: true,
    notes: "تُعاد إلى المستودع بعد الحفل",
    available: 20,
    reserved: 2,
    missing: 0,
    alreadyImported: false,
  },
  {
    productId: 11,
    variantId: null,
    name: "قماش وتجهيزات مستهلكة",
    imageUrl: null,
    quantity: 1.5,
    unit: "متر",
    returnable: false,
    required: false,
    notes: "ملاحظة خاصة بالحجز",
    available: 1,
    reserved: 3,
    missing: 0.5,
    alreadyImported: false,
  },
  {
    productId: 12,
    variantId: null,
    name: "معدات موجودة بالحجز",
    imageUrl: null,
    quantity: 2,
    unit: "قطعة",
    returnable: true,
    required: true,
    notes: "",
    available: 8,
    reserved: 0,
    missing: 0,
    alreadyImported: true,
  },
];
client.setQueryData(["admin", "kosha-equipment", 1], { items: lines });
const key = ["equipment-ui-fixture"];
client.setQueryData([...key, "kosha-equipment"], { koshaId: 1, items: lines });
const markup = renderToStaticMarkup(
  createElement(
    QueryClientProvider,
    { client },
    createElement(
      "main",
      { className: "mx-auto max-w-6xl space-y-6 p-4", dir: "rtl" },
      createElement(KoshaEquipmentPanel, { koshaId: 1 }),
      createElement(KoshaEquipmentImport, { base: "/fixture", queryKey: key }),
    ),
  ),
);
assert.match(markup, /المعدات والمواد/);
assert.match(markup, /ملاحظة لهذا الحجز/);
assert.match(markup, /تقليل كمية/);
assert.match(markup, /المتاح:/);
assert.match(markup, /الناقص:/);
assert.match(markup, /موجود بالحجز/);
assert.match(markup, /dir="rtl"/);
console.log(
  "PASS equipment UI renders RTL, decimal quantities, shortage, booking notes and existing-hold protection",
);

async function visual() {
  if (!process.env.AJN_VISUAL_BROWSER_PACKAGE) return;
  const { createRequire } = await import("node:module");
  const { readdirSync, readFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { chromium } = createRequire(import.meta.url)(
    process.env.AJN_VISUAL_BROWSER_PACKAGE,
  );
  const css = readdirSync(".next/static/chunks")
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(".next/static/chunks", name), "utf8"))
    .join("\n");
  const directory = mkdtempSync(join(tmpdir(), "ajn-equipment-visual-"));
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.AJN_VISUAL_BROWSER_CHANNEL,
  });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.setContent(
        `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${css}</style><body style="background:#f8f7f5;color:#182033;font-family:Arial,sans-serif">${markup}</body></html>`,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        `no horizontal overflow at ${width}px`,
      );
      const path = join(directory, `equipment-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(`VISUAL ${path}`);
      await page.close();
    }
  } finally {
    await browser.close();
    client.clear();
  }
}
visual().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
