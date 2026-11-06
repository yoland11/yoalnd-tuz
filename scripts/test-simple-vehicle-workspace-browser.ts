/** Mounted original UI with intercepted synthetic HTTP only; never connects to a database. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const runtime = process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime, "Set AJN_BROWSER_RUNTIME to bundled playwright/package.json");
const { chromium } = createRequire(runtime)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = (await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") })).css;
const js = (await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Router} from 'wouter';import VehiclesPage from './src/views/admin/vehicles';const qc=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.fixtureRefresh=()=>qc.invalidateQueries({queryKey:['admin','vehicle',6]});createRoot(document.getElementById('root')).render(<Router><QueryClientProvider client={qc}><VehiclesPage/></QueryClientProvider></Router>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outdir: ".next/simple-vehicle-fixture", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } })).outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "application/javascript" : req.url === "/fixture.css" ? "text/css" : "text/html; charset=utf-8");
  res.end(req.url === "/fixture.js" ? js : req.url === "/fixture.css" ? css : '<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>');
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const stats = { tripCount: 1, transportationRevenue: 15000, vehicleExpenses: 1000, netProfit: 14000 };
const vehicle = { id: 6, name: "سيارة النقل المشتركة", plateNumber: "فحص 123", status: "available", isActive: true, odometerKm: 500, purchasePrice: 20000000, stats };
const monthParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit" }).formatToParts(new Date());
const thisMonth = `${monthParts.find(p => p.type === "year")!.value}-${monthParts.find(p => p.type === "month")!.value}`;
const term = { startsMonth: thisMonth, partnerName: "أبو حسين", partnerPhone: null, shareBasisPoints: 5000 };
const partner = { ready: true, thisMonth, canManage: true, partner: term, upcoming: null, terms: [term], months: [{ month: thisMonth, partnerName: "أبو حسين", shareBasisPoints: 5000, tripCount: 1, unallocatedTrips: 0, income: 15000, expenses: 1000, pendingExpenses: 0, net: 14000, partnerShare: 7000, companyShare: 7000 }], balance: { earned: 7000, paid: 0, pending: 0, remaining: 7000, available: 7000 }, payouts: [] };
const right = { id: 5, category: "profit", direction: "credit", memberId: 2, memberName: "الشريك الأول", amount: "100000.00", status: "approved", closingId: 23, closingVersion: 7, paymentState: { totalAmount: "100000.00", approvedPaidAmount: "20000.00", remainingAmount: "80000.00", reservedAmount: "30000.00", availableAmount: "50000.00", payable: true, approvalStatus: "approved" } };
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const writes: any[] = [], errors: string[] = [], unexpected: string[] = [];
    let failFinancial = false;
    page.on("pageerror", (error: any) => errors.push(error.message));
    await page.route("**/api/**", async (route: any) => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, "");
      if (req.method() !== "GET") {
        if (!path.endsWith("/partnership/distributions") && !path.endsWith("/partner/payouts")) unexpected.push(req.method() + " " + path);
        writes.push(req.postDataJSON());
        return route.fulfill({ status: 503, json: { error: "محاولة اختبار محفوظة؛ أعد بنفس المرجع", requestId: "fixture-write" } });
      }
      const send = (json: unknown) => route.fulfill({ json });
      if (path.endsWith("/details")) return send({ vehicle, maintenance: [], odometerHistory: [] });
      if (path.endsWith("/financial")) return failFinancial ? route.fulfill({ status: 503, json: { error: "تعذر تحديث حساب السيارة", requestId: "fixture-read" } }) : send({ summary: { ...stats, categories: {} }, trips: [{ source: "service", bookingId: 7, bookingNo: "B-7", customerName: "عميل عربي للاختبار", driverName: "السائق الأول", transportationFee: 15000, executedTransportationRevenue: 15000, tripExpense: 1000, tripProfit: 14000, operations: [] }], expenses: [] });
      if (path.endsWith("/partner")) return send(partner);
      if (path.endsWith("/partnership")) return send({ vehicle: { name: vehicle.name, plate_number: vehicle.plateNumber }, partnership: { id: 1, ownershipType: "partnership", registrationOwner: "الشركة", version: 7, agreements: [{ id: 1, revision: 1, effectiveFrom: "2026-01-01", status: "approved", policy: {}, members: [] }] }, configuredElsewhere: false, canApprove: false });
      if (path.endsWith("/partnership/workspace")) return send({ activity: { trips: [], externalIncome: [], internalIncome: [], investment: "0.00", blockers: [], collectionNotice: "النتيجة تقديرية حتى الاعتماد" }, closings: [], rights: [right], driverEntries: [], expenses: [], requests: [], canApprove: false });
      unexpected.push(path); return route.fulfill({ status: 500, json: { error: "Unexpected fixture request: " + path } });
    });
    const waitWrites = async (count: number) => { for (let i = 0; i < 100 && writes.length < count; i += 1) await page.waitForTimeout(100); assert.equal(writes.length, count); };
    const openMore = async () => { const more = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "المزيد" }) }); if (!(await more.evaluate((el: HTMLDetailsElement) => el.open))) await more.locator("summary").click(); };
    await page.goto(origin + "/admin/vehicles/6");
    await page.getByText("عميل عربي للاختبار", { exact: true }).waitFor();
    const primary = page.getByRole("navigation", { name: "التنقل اليومي للمركبة" });
    assert.equal(await primary.getByRole("button").count(), 3);
    assert.equal(await page.getByRole("button", { name: "الصيانة", exact: true }).isVisible(), false);
    assert.equal(await page.getByRole("group", { name: "فترة الحساب" }).isVisible(), true, "the month switcher sits above the numbers");
    await primary.getByRole("button", { name: "المصاريف", exact: true }).click();
    await page.getByText("ما اكو مصاريف بهذه الفترة.", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("tab"), "expenses");
    await page.getByRole("button", { name: "إضافة مصروف", exact: true }).first().click();
    await page.getByRole("dialog").getByText("نوع المصروف", { exact: true }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "إلغاء", exact: true }).click();
    await openMore();
    await page.getByRole("button", { name: "الصيانة", exact: true }).click();
    await page.getByRole("button", { name: "تسجيل صيانة", exact: true }).waitFor();
    // The simple split: balance, then a payout that keeps its reference across a failed send.
    await primary.getByRole("button", { name: "الشريك والأرباح", exact: true }).click();
    await page.getByRole("heading", { name: "الأرباح شهر بشهر" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "أبو حسين" }).isVisible(), true);
    await page.getByRole("button", { name: "صرف حصة الشريك", exact: true }).click();
    const payout = page.getByRole("dialog");
    assert.equal(await payout.getByLabel("المبلغ — د.ع", { exact: true }).inputValue(), "7000", "the payout starts at what is left for the partner");
    await payout.getByRole("button", { name: "إرسال للموافقة", exact: true }).click();
    await waitWrites(1);
    assert.equal(await payout.isVisible(), true, "a failed request keeps the dialog open");
    await payout.getByRole("button", { name: "إرسال للموافقة", exact: true }).click();
    await waitWrites(2);
    assert.deepEqual(writes[1], writes[0], "a retry resends the same amount and reference");
    assert.equal(writes[0].amount, 7000);
    await payout.getByRole("button", { name: "إلغاء", exact: true }).click();
    // The older detailed accounting stays under «المزيد».
    await openMore();
    await page.getByRole("button", { name: "المحاسبة التفصيلية", exact: true }).click();
    await page.getByRole("heading", { name: "المستحقات والتسويات" }).waitFor();
    assert.equal(await page.getByRole("navigation", { name: "العمل اليومي للشراكة" }).getByRole("link").count(), 3);
    assert.equal(await page.getByText("80,000.00 د.ع", { exact: true }).count(), 1);
    const balanceCard = page.getByRole("article").filter({ hasText: "الشريك الأول" });
    assert.equal(await balanceCard.getByRole("button", { name: "طلب صرف حصة", exact: true }).isVisible(), true);
    const balanceBounds = await balanceCard.boundingBox();
    assert.ok(balanceBounds && balanceBounds.width <= width, "identity, balances and payout fit together without horizontal scrolling");
    await page.getByRole("link", { name: "الإغلاق الشهري", exact: true }).click();
    const policyDetails = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "سياسات الإغلاق المتقدمة" }) });
    await policyDetails.locator("summary").click();
    assert.equal(await policyDetails.evaluate((el: HTMLDetailsElement) => el.open), false);
    await page.getByRole("button", { name: "احتساب ومعاينة الشهر", exact: true }).click();
    assert.equal(await policyDetails.evaluate((el: HTMLDetailsElement) => el.open), true, "invalid mandatory policy fields reveal themselves after collapse");
    assert.equal(writes.length, 2, "incomplete policy cannot bypass native validation");
    await page.getByRole("link", { name: "مستحقات الشركاء", exact: true }).click();
    await page.getByRole("button", { name: "طلب صرف حصة", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("مبلغ الصرف — د.ع *", { exact: true }).fill("40000");
    await dialog.getByLabel("سبب الصرف *", { exact: true }).fill("طلب صرف تجريبي لا يغادر الجهاز");
    await dialog.getByRole("button", { name: "إرسال للموافقة", exact: true }).click();
    await dialog.getByRole("button", { name: "إعادة المحاولة بالمرجع نفسه", exact: true }).waitFor();
    await waitWrites(3);
    failFinancial = true;
    await page.evaluate(() => (window as any).fixtureRefresh());
    await page.getByRole("alert", { includeHidden: true }).filter({ hasText: "تعذر تحديث حساب السيارة" }).waitFor();
    assert.equal(await dialog.getByLabel("مبلغ الصرف — د.ع *", { exact: true }).inputValue(), "40000", "cached refetch errors preserve the mounted frozen payment attempt");
    await dialog.getByRole("button", { name: "إعادة المحاولة بالمرجع نفسه", exact: true }).click();
    await dialog.getByRole("button", { name: "بدء محاولة جديدة", exact: true }).waitFor();
    await waitWrites(4); assert.deepEqual(writes[3], writes[2]);
    await dialog.getByRole("button", { name: "إلغاء", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mkdir(".next/simple-vehicle-review", { recursive: true });
    await page.screenshot({ path: `.next/simple-vehicle-review/partnership-${width}.png`, fullPage: true });
    // No cached data on a fresh document: failed reads must not become zero accounts.
    await page.reload(); await page.getByRole("alert", { includeHidden: true }).filter({ hasText: "تعذر تحديث حساب السيارة" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: vehicle.name, exact: true }).count(), 0);
    failFinancial = false;
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
    await page.getByRole("heading", { name: vehicle.name, exact: true }).waitFor();
    await page.screenshot({ path: `.next/simple-vehicle-review/partnership-healthy-${width}.png`, fullPage: true });
    await page.goto(origin + "/admin/vehicles/6?tab=history&partnershipTab=monthly&from=2026-10-01");
    await page.getByRole("heading", { name: "سجل العداد", exact: true }).waitFor();
    await page.getByRole("navigation", { name: "التنقل اليومي للمركبة" }).getByRole("button", { name: "المصاريف", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("partnershipTab"), "monthly");
    assert.equal(new URL(page.url()).searchParams.get("from"), "2026-10-01");
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS actual vehicle UI desktop/mobile: month switcher, three daily views and «المزيد», expense dialog on the page, simple partner payout with a stable retry, the detailed accounting under «المزيد» with its frozen retry, initial error/retry, query links and no overflow; all HTTP synthetic");
} finally { await browser.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
