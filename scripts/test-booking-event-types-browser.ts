// Exercise original AJN components with local-only HTTP fixtures; never writes a database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { projectDailyBooking, type DailyBookingFact } from "../src/lib/booking-daily-operations";

assert.ok(process.env.AJN_BROWSER_RUNTIME, "Set AJN_BROWSER_RUNTIME to Playwright's package.json");
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") });
const styles = css.css + await readFile("src/views/admin/booking-center.css", "utf8") + await readFile("src/views/admin/booking-operations-workspace.css", "utf8");
const output = process.env.AJN_BROWSER_OUTPUT ?? resolve(".next/booking-event-type-review");
await mkdir(output, { recursive: true });

const customer = { id: 7, name: "عميل الاختبار", fullName: "عميل الاختبار", phone: "07700000000" };
const services = [{ id: 8, name: "Photography", nameAr: "التصوير", type: "photography", isActive: true }, { id: 9, name: "Sound", nameAr: "الصوت", type: "sound", isActive: true }];
const followup = { id: 11, serviceKey: "engagement", status: "new", customer };
const order = { id: 151, serviceId: 8, serviceName: "التصوير", serviceType: "photography", customerName: customer.name, phone: customer.phone, eventDate: "2026-11-15", eventLocation: "قاعة الاختبار", status: "confirmed", totalAmount: 50000, depositAmount: 10000, paymentStatus: "partial", customFields: { bookingCenterVersion: 1, departments: ["photography"], bookingCenterServices: [{ type: "photography", status: "waiting", amount: 0 }], photographyServiceKind: "photo_session", photoSessionLocation: "indoor", photoSessionDelivery: "shots", fixturePreserved: "keep-me" }, serviceItems: [] };
const native = { id: 151, customerName: customer.name, phone: customer.phone, eventDate: "2026-11-15", eventTime: "18:00", hallLocation: "قاعة الاختبار", status: "confirmed", trackingStatus: "booked", executionStage: "preparing", totalAmount: 50000, paidAmount: 10000, paymentStatus: "partial", bookingDetails: { pricing: { koshaPrice: 50000, totalAmount: 50000, paidAmount: 10000, remainingAmount: 40000, paymentMethod: "transfer" } } };
const base = { source: "service", id: 151, number: "AJN-151", customerName: customer.name, phone: customer.phone, eventDate: "2026-11-15", eventTime: "18:00", hall: "قاعة الاختبار", status: "confirmed", total: 50000, paid: 10000, remaining: 40000, paymentStatus: "partial", departments: ["photography"], services: [{ type: "photography", status: "waiting" }], customFields: order.customFields, raw: order };
const rows = [
  { ...base, id: 1, number: "AJN-1", customerName: "زفاف تصوير مطابق", eventType: "عرس" },
  { ...base, id: 2, number: "AJN-2", customerName: "حنة تصوير", eventType: "henna" },
  { ...base, id: 3, number: "AJN-3", customerName: "عميل قديم بلا نوع", eventType: null },
  { ...base, source: "kosha", id: 4, number: "KB-4", customerName: "عميل مناسبة مخصصة", eventType: "افتتاح قديم", departments: ["kosha"] },
  { ...base, id: 5, number: "AJN-5", customerName: "زفاف صوت", eventType: "wedding", departments: ["sound"] },
  { ...base, id: 6, number: "AJN-6", customerName: "تخرج أصلي", eventType: "graduation", customFields: { graduationOrderId: 83 }, departments: ["photography"] },
  { ...base, id: 7, number: "AJN-7", customerName: "زفاف خارج الفترة", eventType: "زفاف", eventDate: "2026-12-01" },
  { ...base, id: 8, number: "AJN-8", customerName: "زفاف ملغي", eventType: "wedding", status: "cancelled" },
];
const fact: DailyBookingFact = { source: "service", id: 151, number: base.number, customerName: base.customerName, eventDate: base.eventDate, eventTime: base.eventTime, location: base.hall, status: base.status, category: "photography", details: {}, assignedStaffId: null, staff: [], vehicleId: null, vehicleName: null, transportationMode: "customer", crewName: null, overdueTasks: 0, openTasks: 0, products: [] };
const readiness = { ...projectDailyBooking(fact, new Date("2026-11-13T10:00:00Z")).readiness, generatedAt: "2026-11-13T10:00:00Z" };
const bundle = await esbuild.build({ stdin: { contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PrintProvider} from './src/components/print/print-provider';import {TooltipProvider} from './src/components/ui/tooltip';import {Toaster} from './src/components/ui/toaster';
import BookingCenterPage,{UnifiedBookingForm} from './src/views/admin/booking-center';import {BookingOperationsWorkspace} from './src/views/admin/booking-operations-workspace';
import {EditServiceOrderModal} from './src/views/admin/orders';import {EditKoshaBookingModal} from './src/views/admin/koshas';
const params=new URLSearchParams(location.search),mode=params.get('mode')||'center',legacy=params.get('legacy');const order=${JSON.stringify(order)},native=${JSON.stringify(native)},base=${JSON.stringify(base)};
if(legacy==='custom'){order.customFields.eventType='افتتاح قديم';native.eventType='افتتاح قديم'}else if(legacy==='known'){order.customFields.eventType='حنة';native.eventType='حنة'};
const done=()=>{window.__saved=(window.__saved||0)+1};
const formProps={services:${JSON.stringify(services)},servicesLoading:false,servicesError:'',onRetryServices:()=>{},customers:[],onCancel:()=>{},onCreated:done};
let element=mode==='form'?<UnifiedBookingForm {...formProps}/>:mode==='followup'?<UnifiedBookingForm {...formProps} followup={${JSON.stringify(followup)}}/>:mode==='add'?<UnifiedBookingForm {...formProps} addTo={order}/>:mode==='service-editor'?<EditServiceOrderModal order={order} onClose={()=>{}} onSaved={done}/>:mode==='native-editor'?<EditKoshaBookingModal booking={native} onClose={()=>{}} onSaved={done}/>:mode==='workspace'?<BookingOperationsWorkspace booking={{...base,source:params.get('source')||'service',eventType:params.get('event')||null,raw:params.get('source')==='kosha'?native:{...order,customFields:{...order.customFields,graduationOrderId:83}}}} onEdit={()=>{}}/>:<BookingCenterPage/>;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><PrintProvider><div className="ajn-booking-center" dir="rtl">{element}</div><Toaster/></PrintProvider></TooltipProvider></QueryClientProvider>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outdir: ".next/event-type-browser-bundle", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
const javascript = bundle.outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(javascript); }
  else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(styles); }
  else if (req.url?.startsWith("/api/")) { res.statusCode = 500; res.end("Unmocked API request is forbidden"); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto"></main><script src="/fixture.js"></script></body></html>'); }
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ executablePath: process.env.AJN_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "ajn_admin_session", value: "event-fixture", url: origin }]);
    const writes: Array<{ path: string; method: string; body: any }> = [];
    let rejectCreate = false, rejectList = false, rejectReport = false;
    await context.route("**/api/**", async (route: any) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      assert.equal(url.origin, origin, "All requests must stay on the isolated local harness");
      if (request.method() !== "GET") {
        assert.ok((path === "/api/admin/service-orders" && request.method() === "POST") || ((path === "/api/admin/service-orders/151" || path === "/api/admin/kosha-bookings/151") && request.method() === "PATCH"), `Unexpected write ${request.method()} ${path}`);
        writes.push({ path, method: request.method(), body: request.postDataJSON() });
        if (rejectCreate) return route.fulfill({ status: 422, json: { message: "اختر مناسبة صالحة", code: "VALIDATION_ERROR", requestId: "REQ-event-browser", fieldErrors: { eventType: "نوع المناسبة غير صالح · REQ-event-browser" } } });
        return route.fulfill({ json: { id: 151, ...request.postDataJSON() } });
      }
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { user: { id: 1, role: "admin", username: "fixture", fullName: "مدير الاختبار", isActive: true, permissions: [] } } });
      if (path.endsWith("/booking-center")) {
        if (url.searchParams.get("scope") === "report") return rejectReport ? route.fulfill({ status: 503, json: { message: "تعذر تقرير الاختبار · REQ-report-browser", code: "DATABASE_ERROR", requestId: "REQ-report-browser" } }) : route.fulfill({ json: { rows, truncated: false } });
        return rejectList ? route.fulfill({ status: 503, json: { message: "تعذر سجل الاختبار", code: "DATABASE_ERROR", requestId: "REQ-list-browser" } }) : route.fulfill({ json: rows });
      }
      if (path.endsWith("/services")) return route.fulfill({ json: services });
      if (path.endsWith("/customers")) return route.fulfill({ json: [customer] });
      if (path.endsWith("/kosha-catalog")) return route.fulfill({ json: { packages: [], koshas: [] } });
      if (path.endsWith("/overview")) return route.fulfill({ json: { readiness: 100, bookingStage: "booked", warehouseStage: "reserved", warehouseHistory: [], readinessParts: {}, counts: { products: 0, assets: 0, tasks: 0, completedTasks: 0, documents: 0, alerts: 0 }, alerts: [], recentActivity: [], bookedKosha: null } });
      if (path.endsWith("/readiness")) return route.fulfill({ json: readiness });
      if (path.endsWith("/transportation")) return route.fulfill({ json: { transportation: { mode: "customer", fee: 0 } } });
      if (path.endsWith("/group-attendees")) return route.fulfill({ json: { attendees: [] } });
      if (path.endsWith("/staff-assignment")) return route.fulfill({ json: { types: ["photography"], assignedStaff: [], eligibleStaff: [] } });
      if (path.endsWith("/branches")) return route.fulfill({ json: { data: [], assignments: [] } });
      if (path.endsWith("/tasks")) return route.fulfill({ json: { data: [] } });
      if (path.endsWith("/photography-production/booking/151")) return route.fulfill({ json: { permissions: { canOrder: false, canManage: false, canViewAll: true }, items: [], eligible: { isPhotography: true }, progress: { complete: false, completed: 0, required: 0, percent: 0 }, booking: { id: 151 }, today: "2026-11-13" } });
      if (path.endsWith("/penalties/indicators")) return route.fulfill({ json: { indicators: {} } });
      if (path.endsWith("/enterprise/vehicles")) return route.fulfill({ json: { data: [] } });
      if (path.endsWith("/koshas/options")) return route.fulfill({ json: { addons: [], welcomeBoards: [], accessories: [], provinces: [] } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage(), errors: string[] = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error: Error) => errors.push(error.stack ?? error.message));
    const goto = (mode: string, query = "") => page.goto(`${origin}/admin/bookings?mode=${mode}${query}`, { waitUntil: "networkidle" });
    const fits = async (name: string) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name} RTL overflow at ${width}`);
    try {
      await goto("form");
      const group = page.getByRole("radiogroup", { name: "نوع المناسبة" });
      await group.waitFor();
      assert.equal(await group.getAttribute("aria-required"), "true");
      assert.equal(await group.getByRole("radio").count(), 6);
      assert.equal(await group.locator("input:required").count(), 6);
      assert.equal(await group.getByRole("radio", { checked: true }).count(), 0, "New booking never defaults to wedding");
      await page.locator("#booking-customer-search").fill("عميل");
      await page.getByRole("button", { name: /عميل الاختبار/ }).click();
      await page.locator("#booking-date").fill("2026-11-15");
      await page.getByRole("button", { name: "حفظ الحجز", exact: true }).click();
      await group.getByRole("alert").getByText("اختر نوع المناسبة", { exact: true }).waitFor();
      assert.equal(writes.length, 0, "Missing occasion cannot submit");
      assert.equal(await group.getByRole("radio").first().evaluate((input: HTMLInputElement) => document.activeElement === input), true, "Validation focuses the radio group");
      for (const label of ["خطوبة", "حنة", "زفاف", "عيد ميلاد", "تخرج", "مناسبة أخرى"]) {
        // Radios are visually hidden inside full-size icon labels; click the actual visible label.
        const radio = group.getByRole("radio", { name: label, exact: true });
        await radio.locator("..").click();
        assert.equal(await radio.isChecked(), true);
        assert.equal(await radio.locator("..").locator("svg").count(), 2, "Choice has occasion and selected icons");
        assert.equal(await page.locator("#booking-service-picker > div > button[aria-pressed=true]").count(), 1, "Occasion never selects another paid service");
        assert.equal(writes.length, 0, "Selecting an occasion cannot create a booking or graduation order");
      }
      const birthday = group.getByRole("radio", { name: "عيد ميلاد", exact: true });
      await birthday.focus(); await page.keyboard.press("Space");
      assert.equal(await birthday.isChecked(), true, "Native radio supports keyboard selection");
      await page.waitForFunction(() => { const radio = document.querySelector<HTMLInputElement>('#booking-event-type input[value="birthday"]'); return radio?.checked && getComputedStyle(radio.nextElementSibling!).backgroundColor === "rgb(118, 13, 59)"; });
      const checkedColor = await birthday.locator("..").locator(":scope > span").evaluate((span: HTMLElement) => getComputedStyle(span).backgroundColor);
      assert.equal(checkedColor, "rgb(118, 13, 59)", "Selected occasion is visibly filled");
      await page.locator("[toast-close]").click();
      await page.getByRole("status").filter({ hasText: "تعذر حفظ الحجز" }).waitFor({ state: "detached" });
      await fits("create form");
      await page.screenshot({ path: `${output}/create-${width}.png`, fullPage: true });
      await page.locator("#booking-total").fill("50000");
      await page.locator("#booking-deposit").fill("10000");
      await page.getByRole("button", { name: "حفظ الحجز", exact: true }).click();
      await page.waitForFunction(() => (window as any).__saved === 1);
      assert.equal(writes[0].method, "POST");
      assert.equal(writes[0].body.customFields.eventType, "عيد ميلاد");
      assert.equal(writes[0].body.customFields.bookingCenterVersion, 2);
      assert.equal(writes[0].body.totalAmount, 50000);
      assert.equal(writes[0].body.depositAmount, 10000);

      await goto("followup");
      assert.equal(await group.getByRole("radio", { name: "خطوبة", exact: true }).isChecked(), true);
      await group.getByRole("radio", { name: "حنة", exact: true }).locator("..").click();
      await page.locator("#booking-date").fill("2026-11-15");
      await page.locator("#booking-service-picker").getByRole("button", { name: "التصوير", exact: true }).click();
      await page.getByRole("button", { name: "حفظ الحجز", exact: true }).click();
      await page.waitForFunction(() => (window as any).__saved === 1);
      assert.equal(writes.at(-1)!.body.customFields.customerId, 7);
      assert.equal(writes.at(-1)!.body.customFields.customerFollowupId, 11);
      assert.equal(writes.at(-1)!.body.customFields.eventType, "حنة", "Explicit choice overrides followup preset");

      for (const legacy of ["missing", "custom"]) {
        await goto("add", `&legacy=${legacy}`);
        assert.equal(await page.getByRole("radiogroup").count(), 0, "Adding services never asks for occasion again");
        await page.locator("#booking-service-picker").getByRole("button", { name: "الصوت", exact: true }).click();
        await page.getByRole("button", { name: "إضافة للحجز", exact: true }).click();
        await page.waitForFunction(() => (window as any).__saved === 1);
        const body = writes.at(-1)!.body;
        assert.equal(body.customFields.eventType, legacy === "custom" ? "افتتاح قديم" : undefined);
        assert.equal(body.customFields.bookingCenterVersion, 1);
        assert.equal(body.customFields.fixturePreserved, "keep-me");
        assert.equal(body.totalAmount, 50000);
        assert.ok(!Object.hasOwn(body, "depositAmount"), "Add-services does not rewrite the original deposit");
      }

      rejectCreate = true;
      await goto("followup");
      await page.locator("#booking-date").fill("2026-11-15");
      await page.locator("#booking-service-picker").getByRole("button", { name: "التصوير", exact: true }).click();
      await page.getByRole("button", { name: "حفظ الحجز", exact: true }).click();
      await group.getByRole("alert").getByText("نوع المناسبة غير صالح · REQ-event-browser", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => (window as any).__saved ?? 0), 0, "Structured server failure does not report success");
      rejectCreate = false;

      await goto("center");
      const cards = page.locator(".ajn-booking-preview"), eventFilter = page.getByRole("group", { name: "تصفية حسب نوع المناسبة" });
      await cards.first().waitFor(); assert.equal(await cards.count(), rows.length);
      await cards.filter({ hasText: "عميل قديم بلا نوع" }).getByText("غير محدد", { exact: true }).waitFor();
      await cards.filter({ hasText: "عميل مناسبة مخصصة" }).getByText("افتتاح قديم", { exact: true }).waitFor();
      assert.equal(await cards.filter({ hasText: "تخرج أصلي" }).getByRole("link", { name: "إدارة التخرج", exact: true }).getAttribute("href"), "/admin/graduation/orders?order=83");
      await eventFilter.getByRole("button", { name: "زفاف", exact: true }).click();
      assert.equal(await cards.count(), 4);
      await page.getByRole("region", { name: "خدمات الحجوزات" }).getByRole("button", { name: /^التصوير/ }).click();
      assert.equal(await cards.count(), 3);
      await page.getByPlaceholder("رقم الحجز، العميل، الهاتف أو القاعة").fill("مطابق");
      assert.equal(await cards.count(), 1);
      await cards.getByRole("heading", { name: "زفاف تصوير مطابق" }).waitFor();
      await fits("composed center filters");
      await page.screenshot({ path: `${output}/filters-${width}.png`, fullPage: true });
      await page.getByPlaceholder("رقم الحجز، العميل، الهاتف أو القاعة").fill("wedding");
      assert.equal(await cards.count(), 3, "English occasion alias finds Arabic historical occasions");
      await page.getByPlaceholder("رقم الحجز، العميل، الهاتف أو القاعة").fill("عرس");
      assert.equal(await cards.count(), 3, "Arabic occasion alias finds equivalent stored labels");
      await page.getByPlaceholder("رقم الحجز، العميل، الهاتف أو القاعة").fill("حنة");
      assert.equal(await cards.count(), 0, "Search combines with department and occasion using AND");
      await eventFilter.getByRole("button", { name: "الكل", exact: true }).click();
      assert.equal(await cards.count(), 1, "Arabic occasion label is searchable for canonical English data");
      await page.getByPlaceholder("رقم الحجز، العميل، الهاتف أو القاعة").fill("");
      await page.getByRole("region", { name: "خدمات الحجوزات" }).getByRole("button", { name: /^التصوير/ }).click();
      await eventFilter.getByRole("button", { name: "أخرى", exact: true }).click();
      assert.equal(await cards.count(), 1); await cards.getByText("افتتاح قديم", { exact: true }).waitFor();
      await eventFilter.getByRole("button", { name: "الكل", exact: true }).click(); assert.equal(await cards.count(), rows.length);

      await eventFilter.getByRole("button", { name: "زفاف", exact: true }).click();
      await page.getByRole("button", { name: "التقارير", exact: true }).click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      assert.equal(await dialog.locator("#report-event-type").inputValue(), "wedding", "Report inherits the current occasion");
      await dialog.getByRole("button", { name: /^المبالغ المتبقية/ }).click();
      await dialog.locator("#report-department").selectOption("photography");
      await dialog.locator("#report-from").fill("2026-11-01"); await dialog.locator("#report-to").fill("2026-11-30");
      await fits("report dialog");
      await page.screenshot({ path: `${output}/report-${width}.png` });
      await dialog.getByRole("button", { name: "طباعة / حفظ PDF", exact: true }).click();
      await page.waitForFunction(() => Boolean(document.querySelector("iframe[srcdoc]")));
      const report = await page.locator("iframe[srcdoc]").last().getAttribute("srcdoc");
      assert.match(report, /نوع المناسبة/); assert.match(report, /زفاف تصوير مطابق/);
      for (const name of rows.slice(1).map(row => row.customerName)) assert.ok(!report.includes(name), `Printed composed report excludes ${name}`);
      rejectReport = true;
      await dialog.getByRole("button", { name: "طباعة / حفظ PDF", exact: true }).click();
      await dialog.getByRole("alert").getByText(/REQ-report-browser/).waitFor();
      rejectReport = false;
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      rejectList = true; await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "تعذر تحميل الحجوزات", exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "لا توجد حجوزات مطابقة", exact: true }).count(), 0);
      rejectList = false;

      for (const source of ["service", "kosha"]) {
        await goto("workspace", `&source=${source}&event=حنة`);
        await page.getByText("حنة", { exact: true }).first().waitFor();
        await fits(`${source} occasion badge`);
        await page.screenshot({ path: `${output}/workspace-${source}-${width}.png`, fullPage: true });
      }
      await goto("workspace", "&source=service&event=تخرج");
      assert.equal(await page.getByRole("link", { name: /إدارة التخرج/ }).first().getAttribute("href"), "/admin/graduation/orders?order=83");

      {
        for (const source of ["service", "native"]) {
          for (const legacy of ["missing", "custom", "known"]) {
            await goto(`${source}-editor`, `&legacy=${legacy}`);
            const editorGroup = page.getByRole("radiogroup", { name: "نوع المناسبة" }); await editorGroup.waitFor();
            assert.equal(await editorGroup.getAttribute("aria-required"), null, "Historical edit has no mandatory new choice");
            if (legacy === "known") await editorGroup.getByRole("radio", { name: "تخرج", exact: true }).locator("..").click();
            if (legacy === "custom") await editorGroup.getByText(/نوع المناسبة المحفوظ: افتتاح قديم/).waitFor();
            await fits(`${source} editor`);
            if (legacy === "known") {
              await editorGroup.getByRole("radio", { name: "تخرج", exact: true }).locator("..").locator(":scope > span").evaluate(async (element: HTMLElement) => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
              await page.screenshot({ path: `${output}/editor-${source}-${width}.png` });
            }
            await page.getByRole("button", { name: "معاينة التغييرات", exact: true }).click();
            await page.getByRole("button", { name: "حفظ التعديلات", exact: true }).click();
            await page.waitForFunction(() => (window as any).__saved === 1);
            const body = writes.at(-1)!.body;
            const savedEvent = source === "service" ? body.customFields.eventType : body.eventType;
            assert.equal(savedEvent || undefined, legacy === "known" ? "تخرج" : legacy === "custom" ? "افتتاح قديم" : undefined);
            assert.equal(body.totalAmount, 50000, "Occasion edit does not change the original total");
            assert.equal(source === "service" ? body.depositAmount : body.paidAmount, 10000, "Occasion edit does not change the paid amount");
          }
        }
      }
      assert.deepEqual(errors, [], `Runtime errors at ${width}`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
      console.error({ width, url: page.url(), errors, body: (await page.locator("body").innerText()).slice(0, 5000) });
      throw error;
    } finally { await context.close(); }
    console.log(`PASS original booking occasion browser flows at ${width}px`);
  }
  console.log("PASS six required icon radios, keyboard/selection styling, Arabic create payload/version 2, followup override, legacy add/edit preservation, composed center/report filters, errors, service/native badges and graduation links; local fixtures only");
} finally { await browser.close(); await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); }
