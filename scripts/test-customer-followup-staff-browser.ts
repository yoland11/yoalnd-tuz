/** Actual staff portal, original CSS and fully intercepted synthetic HTTP. No database. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

assert.ok(process.env.AJN_BROWSER_RUNTIME, "Set AJN_BROWSER_RUNTIME to installed Playwright package.json");
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME!)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = (await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") })).css;
const javascript = (await esbuild.build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClientProvider} from '@tanstack/react-query';import {Router} from 'wouter';import {queryClient} from './src/lib/query-client';import {TooltipProvider} from './src/components/ui/tooltip';import {Toaster} from './src/components/ui/toaster';import UnifiedStaffPortal from './src/views/staff/unified-portal';queryClient.setDefaultOptions({queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><Router><TooltipProvider><UnifiedStaffPortal/><Toaster/></TooltipProvider></Router></QueryClientProvider>);`,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, outdir: ".next/customer-followup-staff-browser-bundle",
  platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"development"' },
})).outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "application/javascript" : req.url === "/fixture.css" ? "text/css" : "text/html;charset=utf-8");
  res.end(req.url === "/fixture.js" ? javascript : req.url === "/fixture.css" ? css : '<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
await mkdir(".next/customer-followup-review", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AJN_BROWSER_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors: string[] = [], unexpected: string[] = [];
    const requests: Array<{ path: string; scope: string | null }> = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    let failSummary = true;
    const summary = { today: 2, overdue: 1, upcoming: 3, converted: 1, total: 7, completed: 1 };
    await page.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route("**/api/**", async (route: any) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      requests.push({ path, scope: url.searchParams.get("scope") });
      assert.equal(req.method(), "GET", "navigation/reminders never write notifications, contacts or financial data");
      if (path === "/api/admin/auth/me") return route.fulfill({ json: { user: { id: 8, username: "assigned-employee", fullName: "موظف المتابعة", role: "staff", permissions: [], isActive: true } } });
      if (path === "/api/staff/portal/dashboard") return route.fulfill({ json: { staff: { id: 8, name: "موظف المتابعة" }, summary: { todayTasks: 0, overdueTasks: 0 }, tasks: [], today: "2026-11-03", attendance: null } });
      if (["/api/staff/portal/bookings", "/api/staff/portal/notifications"].includes(path)) return route.fulfill({ json: { today: "2026-11-03", data: [] } });
      if (path === "/api/staff/portal/salary") return route.fulfill({ json: { current: null, data: [] } });
      if (path === "/api/admin/attendance/me") return route.fulfill({ json: { enabled: false, shifts: [] } });
      if (path === "/api/admin/customer-followups/summary") {
        assert.equal(url.searchParams.get("scope"), "mine");
        return failSummary ? route.fulfill({ status: 503, json: { code: "DATABASE_ERROR", message: "تعذر قراءة تذكير المتابعات", requestId: "REQ-staff-summary" } }) : route.fulfill({ json: { summary } });
      }
      if (path === "/api/admin/customer-followups") {
        assert.equal(url.searchParams.get("scope"), "mine");
        return route.fulfill({ json: {
          rows: [{ id: 17, customer: { id: 5, name: "عميل الموظف المعيّن", phone: "07701234567" }, employee: { id: 8, fullName: "موظف المتابعة" }, serviceKey: "photography", followupAt: "2026-11-03T09:00:00.000Z", status: "waiting", note: "", completedAt: null, version: 1, contactBlocked: false, booking: null, createdAt: "2026-11-01T09:00:00.000Z" }],
          page: 1, pageSize: 25, total: 1, summary, suggestions: [],
          capabilities: { canManage: false, canCreate: false, canBook: false, canCreateCustomer: false, canOpenCustomer: true },
        } });
      }
      unexpected.push(path);
      return route.fulfill({ status: 403, json: { code: "FORBIDDEN", message: "No unconfigured API allowed" } });
    });
    await page.goto(`${origin}/staff`);
    const reminder = page.getByRole("region", { name: "تذكير متابعات العملاء" });
    await reminder.getByRole("alert").waitFor();
    assert.equal(await reminder.getByText("0 اليوم", { exact: false }).count(), 0, "failed summaries are not zero counters");
    failSummary = false;
    await reminder.getByRole("button", { name: "إعادة المحاولة" }).click();
    await reminder.getByText("2 اليوم · 1 متأخرة", { exact: true }).waitFor();
    const mobileNav = page.getByRole("navigation", { name: "أقسام بوابة الموظف" });
    if (width < 1024) {
      const buttons = mobileNav.getByRole("button"); assert.equal(await buttons.count(), 9);
      const bounds = await buttons.evaluateAll((nodes: HTMLElement[]) => nodes.map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })));
      assert.equal(new Set(bounds.map(b => b.top)).size, 1, "all mobile navigation buttons stay in one row");
      assert.ok(bounds.every(b => b.height >= 44), "touch-friendly navigation");
    }
    await reminder.getByRole("link", { name: "فتح المتابعات" }).click();
    await page.getByRole("region", { name: "قائمة المتابعات" }).waitFor();
    assert.equal(new URL(page.url()).search, "?tab=followups", "query-only navigation opens the mounted followup view");
    await page.getByText("عميل الموظف المعيّن", { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "إضافة متابعة", exact: true }).count(), 0);
    assert.equal(await page.getByLabel("تصفية حسب الموظف").count(), 0);
    assert.ok(requests.filter(r => r.path.startsWith("/api/admin/customer-followups")).every(r => r.scope === "mine"));
    assert.ok(!requests.some(r => r.path.includes("/customers") || r.path.endsWith("/options") || r.path.endsWith("/employees")));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no page horizontal overflow");
    if (width < 1024) {
      await page.getByText("ملخص المتابعة", { exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const reportBox = await page.getByText("حجوزات ناتجة عن المتابعة", { exact: true }).locator("..").boundingBox(), footerBox = await mobileNav.boundingBox();
      assert.ok(reportBox && footerBox && reportBox.y + reportBox.height <= footerBox.y, "final content is above fixed mobile navigation");
    }
    await page.screenshot({ path: `.next/customer-followup-review/staff-portal-${width}.png`, fullPage: true });
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`PASS staff portal ${width}: reminder error/retry, query-only navigation, assigned-only reads, mobile navigation and overflow`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
}
