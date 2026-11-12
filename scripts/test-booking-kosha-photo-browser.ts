// Original workspace and AJN styles, local API fixtures only. No Production writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { projectDailyBooking, type DailyBookingFact } from "../src/lib/booking-daily-operations";

assert.ok(process.env.AJN_BROWSER_RUNTIME, "Set AJN_BROWSER_RUNTIME to Playwright's package.json");
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") });
const styles = css.css + await readFile("src/views/admin/booking-operations-workspace.css", "utf8");
const booking = { source: "service", id: 151, number: "AJN-151", customerName: "عميل الاختبار", phone: "07700000000", eventDate: "2026-11-15", eventTime: "18:00", hall: "قاعة الاختبار", status: "confirmed", total: 500000, paid: 100000, remaining: 400000, paymentStatus: "partial", services: [{ type: "kosha", status: "waiting" }], raw: {} };
const reference = { url: "/fixture-photos/reference-original.svg", thumbnailUrl: "/fixture-photos/reference-thumb.svg", checksum: "reference-one" };
const nativeReference = { url: "/fixture-photos/native-original.svg", thumbnailUrl: "/fixture-photos/native-thumb.svg", checksum: "native-one" };
const fixtures = {
  photography: { services: [{ type: "photography", status: "waiting" }], raw: { serviceId: 8, serviceName: "تصوير استوديو", serviceImage: "/fixture-photos/photography.svg", customFields: {} } },
  sound: { services: [{ type: "sound", status: "waiting" }], raw: { serviceId: 9, serviceName: "منظومة الصوت", serviceImage: "/fixture-photos/sound.svg", customFields: {} } },
  mixed: { services: [{ type: "sound", status: "waiting" }, { type: "flowers", status: "waiting" }], raw: { serviceId: 9, serviceName: "خدمة لا تستبدل صور الحجز", serviceImage: "/fixture-photos/sound.svg", customFields: { bookingPhotos: [reference, { url: "/fixture-photos/detail-original.svg", thumbnailUrl: "/fixture-photos/detail-thumb.svg", checksum: "reference-two" }, reference], bookingImage: reference }, bookedProductPhotos: [{ productId: 32, name: "ورد أبيض — كبير", imageUrl: "/fixture-photos/flower.svg" }, { productId: 32, name: "منتج مكرر", imageUrl: "/fixture-photos/flower.svg" }, { productId: 77, name: "مكبر صوت", imageUrl: "/fixture-photos/speaker.svg" }, { productId: 99, name: "صورة مكررة مع مرفقات الحجز", imageUrl: reference.url }] } },
  legacy: { services: [{ type: "gifts", status: "waiting" }], raw: { customFields: { bookingImage: "/fixture-photos/legacy-original.svg" } } },
  native: { services: [{ type: "kosha", status: "waiting" }], raw: { bookingDetails: { bookingPhotos: [nativeReference, nativeReference], bookingImage: nativeReference } } },
  empty: { services: [{ type: "transportation", status: "waiting" }], raw: {} },
  "thumbnail-broken": { services: [{ type: "decorations", status: "waiting" }], raw: { customFields: { bookingPhotos: [{ url: reference.url, thumbnailUrl: "/broken.jpg" }] } } },
  "original-broken": { services: [{ type: "graduation", status: "waiting" }], raw: { customFields: { bookingPhotos: [{ url: "/broken.jpg", thumbnailUrl: reference.thumbnailUrl }] } } },
};
const fact: DailyBookingFact = { source: "service", id: 151, number: booking.number, customerName: booking.customerName, eventDate: booking.eventDate, eventTime: booking.eventTime, location: booking.hall, status: booking.status, category: "kosha", details: {}, assignedStaffId: null, staff: [], vehicleId: null, vehicleName: null, transportationMode: "customer", crewName: null, overdueTasks: 0, openTasks: 0, products: [] };
const readiness = { ...projectDailyBooking(fact, new Date("2026-11-12T10:00:00Z")).readiness, generatedAt: "2026-11-12T10:00:00Z" };
const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {PrintProvider} from './src/components/print/print-provider';import {TooltipProvider} from './src/components/ui/tooltip';import {BookingOperationsWorkspace} from './src/views/admin/booking-operations-workspace';const fixtures=${JSON.stringify(fixtures)};const booking={...${JSON.stringify(booking)},...(fixtures[new URLSearchParams(location.search).get('fixture')]||{})};if(location.pathname.includes('/kosha/'))booking.source='kosha';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><PrintProvider><BookingOperationsWorkspace booking={booking} onEdit={()=>window.__photoEditorOpened=true}/></PrintProvider></TooltipProvider></QueryClientProvider>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outdir: ".next/kosha-photo-browser-bundle", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
const javascript = bundle.outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const output = process.env.AJN_BROWSER_OUTPUT ?? resolve(".next/booking-kosha-photo-review");
await mkdir(output, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(javascript); }
  else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(styles); }
  else if (req.url === "/kosha-photo.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#f6e9ec"/><path d="M200 400V120Q450-40 700 120V400" fill="none" stroke="#8a2548" stroke-width="25"/><text x="450" y="270" text-anchor="middle" font-size="40" fill="#691c35">KOSHA 32</text></svg>'); }
  else if (req.url?.startsWith("/fixture-photos/")) { const thumbnail = req.url.includes("-thumb"); res.setHeader("Content-Type", "image/svg+xml"); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${thumbnail ? 120 : 900}" height="${thumbnail ? 80 : 500}"><rect width="100%" height="100%" fill="#f6e9ec"/><circle cx="50%" cy="50%" r="${thumbnail ? 25 : 150}" fill="#8a2548"/></svg>`); }
  else if (req.url === "/broken.jpg") { res.statusCode = 404; res.end(); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto"></main><script src="/fixture.js"></script></body></html>'); }
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ executablePath: process.env.AJN_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "ajn_admin_session", value: "kosha-photo-fixture", url: origin }]);
    let mode = "photo";
    let fixture: string | null = null;
    await context.route("**/api/**", async (route: any) => {
      assert.equal(route.request().method(), "GET", "Photo display must never change booking data");
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { user: { id: 1, role: "admin", username: "fixture", fullName: "مدير الاختبار", isActive: true, permissions: [] } } });
      if (path.endsWith("/overview")) {
        if (mode === "error") return route.fulfill({ status: 503, json: { message: "تعذر الاتصال · REQ-photo-fixture", code: "DATABASE_ERROR", requestId: "REQ-photo-fixture" } });
        return route.fulfill({ json: { readiness: 100, bookingStage: "booked", warehouseStage: "reserved", warehouseHistory: [], readinessParts: {}, counts: { products: 0, assets: 0, tasks: 0, completedTasks: 0, documents: 0, alerts: 0 }, alerts: [], recentActivity: [], bookedKosha: fixture ? null : { id: 32, kind: "kosha", name: "الكوشة الملكية", imageUrl: mode === "missing" ? null : mode === "broken" ? "/broken.jpg" : "/kosha-photo.svg" } } });
      }
      if (path.endsWith("/readiness")) return route.fulfill({ json: readiness });
      if (path.endsWith("/transportation")) return route.fulfill({ json: { transportation: { mode: "customer", fee: 0 } } });
      if (path.endsWith("/group-attendees")) return route.fulfill({ json: { attendees: [] } });
      if (path.endsWith("/staff-assignment")) return route.fulfill({ json: { types: ["kosha"], assignedStaff: [], eligibleStaff: [] } });
      if (path.endsWith("/branches")) return route.fulfill({ json: { data: [], assignments: [] } });
      if (path.endsWith("/tasks")) return route.fulfill({ json: { data: [] } });
      if (path.endsWith("/photography-production/booking/151")) return route.fulfill({ json: { permissions: { canOrder: false, canManage: false, canViewAll: true }, items: [], eligible: { isPhotography: true }, progress: { complete: false, completed: 0, required: 0, percent: 0 }, booking: { id: 151 }, today: "2026-11-12" } });
      if (path.endsWith("/penalties/indicators")) return route.fulfill({ json: { indicators: {} } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.stack ?? error.message));
    for (const source of ["service", "kosha"]) {
      await page.goto(`${origin}/admin/bookings/${source}/151?tab=tasks`, { waitUntil: "networkidle" });
      const card = page.getByRole("region", { name: "الكوشة المحجوزة", exact: true });
      await card.getByRole("button", { name: "عرض صورة الكوشة الملكية", exact: true }).waitFor().catch(async (error: Error) => {
        await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
        console.error({ errors, body: (await page.locator("body").innerText()).slice(0, 2500) });
        throw error;
      });
      assert.ok(await page.getByRole("tab", { selected: true }).textContent().then((label: string) => label.includes("المهام")));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${source} RTL overflow at ${width}`);
      assert.equal(await card.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth), 900);
      await card.getByRole("button").click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      await dialog.evaluate(async (element: HTMLElement) => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      assert.equal(await dialog.getAttribute("dir"), "rtl");
      const frame = await dialog.boundingBox();
      assert.ok(frame && frame.x >= 0 && frame.x + frame.width <= width + 1, `preview fits ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `preview overflow ${width}px`);
      assert.equal(await dialog.getByRole("img").evaluate((image: HTMLImageElement) => getComputedStyle(image).objectFit), "contain");
      await page.screenshot({ path: `${output}/preview-${source}-${width}.png` });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.screenshot({ path: `${output}/tasks-${source}-${width}.png`, fullPage: true });
    }
    mode = "missing"; await page.reload({ waitUntil: "networkidle" }); await page.getByText("لا توجد صورة لهذه الكوشة", { exact: true }).waitFor();
    mode = "broken"; await page.reload({ waitUntil: "networkidle" }); await page.getByText("تعذر تحميل الصورة", { exact: true }).waitFor();
    mode = "error"; await page.reload({ waitUntil: "networkidle" }); await page.getByText("تعذر تحميل بيانات الكوشة المحجوزة", { exact: true }).waitFor();
    assert.equal(await page.getByText("لا توجد صورة لهذه الكوشة", { exact: true }).count(), 0);
    mode = "photo"; await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click(); await page.getByRole("button", { name: "عرض صورة الكوشة الملكية", exact: true }).waitFor();
    for (const scenario of [
      { fixture: "photography", source: "service", count: 1, first: "تصوير استوديو", label: "الخدمة المحجوزة", original: "/fixture-photos/photography.svg" },
      { fixture: "sound", source: "service", count: 1, first: "منظومة الصوت", label: "الخدمة المحجوزة", original: "/fixture-photos/sound.svg" },
      { fixture: "mixed", source: "service", count: 4, first: "صورة الحجز 1", label: "صورة مرفقة بالحجز", original: reference.url, thumbnail: reference.thumbnailUrl },
      { fixture: "legacy", source: "service", count: 1, first: "صورة الحجز 1", label: "صورة مرفقة بالحجز", original: "/fixture-photos/legacy-original.svg" },
      { fixture: "native", source: "kosha", count: 1, first: "صورة الحجز 1", label: "صورة مرفقة بالحجز", original: nativeReference.url, thumbnail: nativeReference.thumbnailUrl },
    ]) {
      fixture = scenario.fixture;
      await page.goto(`${origin}/admin/bookings/${scenario.source}/151?tab=tasks&fixture=${fixture}`, { waitUntil: "networkidle" });
      const references = page.getByRole("region", { name: "صور الحجز", exact: true });
      await references.getByText(`عدد الصور: ${scenario.count}`, { exact: true }).waitFor();
      await references.scrollIntoViewIfNeeded();
      assert.equal(await references.getAttribute("dir"), "rtl");
      assert.equal(await references.getByRole("button", { name: /^عرض صورة / }).count(), scenario.count);
      assert.ok(await references.getByText(scenario.label, { exact: true }).count());
      assert.ok(await page.getByRole("tab", { selected: true }).textContent().then((label: string) => label.includes("المهام")));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${fixture} reference overflow at ${width}`);
      const first = references.getByRole("button", { name: `عرض صورة ${scenario.first}`, exact: true });
      assert.equal(await first.getByRole("img").getAttribute("src"), scenario.thumbnail ?? scenario.original);
      assert.equal(await first.getByRole("img").evaluate((image: HTMLImageElement) => getComputedStyle(image).objectFit), "contain");
      if (fixture === "mixed") {
        assert.equal(await references.getByText("المنتج المحجوز", { exact: true }).count(), 2);
        assert.equal(await references.getByRole("button", { name: "عرض صورة ورد أبيض — كبير", exact: true }).count(), 1);
        assert.equal(await references.getByRole("button", { name: "عرض صورة مكبر صوت", exact: true }).count(), 1);
        assert.equal(await references.getByText("المنتج المكرر", { exact: true }).count(), 0);
        assert.equal(await references.getByText("خدمة لا تستبدل صور الحجز", { exact: true }).count(), 0);
      }
      await first.click();
      const preview = page.getByRole("dialog"); await preview.waitFor();
      await preview.evaluate(async (element: HTMLElement) => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      assert.equal(await preview.getByRole("img").getAttribute("src"), scenario.original, "Preview uses the original image, not the thumbnail");
      await page.waitForFunction(() => (document.querySelector('[role="dialog"] img') as HTMLImageElement)?.naturalWidth === 900);
      assert.equal(await preview.getAttribute("dir"), "rtl");
      const frame = await preview.boundingBox(); assert.ok(frame && frame.x >= 0 && frame.x + frame.width <= width + 1, `${fixture} preview fits ${width}px`);
      if (fixture === "mixed") await page.screenshot({ path: `${output}/reference-preview-${fixture}-${width}.png` });
      await page.keyboard.press("Escape"); await preview.waitFor({ state: "detached" });
      assert.equal(await first.evaluate((button: HTMLButtonElement) => document.activeElement === button), true, "Closing returns keyboard focus to the image");
      await page.screenshot({ path: `${output}/reference-${fixture}-${width}.png`, fullPage: true });
    }
    fixture = "empty"; await page.goto(`${origin}/admin/bookings/service/151?tab=tasks&fixture=${fixture}`, { waitUntil: "networkidle" });
    const emptyReferences = page.getByRole("region", { name: "صور الحجز", exact: true });
    await emptyReferences.getByText("لا توجد صور مرتبطة بهذا الحجز", { exact: true }).waitFor();
    assert.equal(await emptyReferences.getByRole("button", { name: /^عرض صورة / }).count(), 0);
    await emptyReferences.getByRole("button", { name: "إضافة صور", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).__photoEditorOpened), true, "Add photos uses the existing editor callback");
    fixture = "thumbnail-broken"; await page.goto(`${origin}/admin/bookings/service/151?tab=tasks&fixture=${fixture}`, { waitUntil: "networkidle" });
    const thumbnailFallback = page.getByRole("region", { name: "صور الحجز", exact: true }).getByRole("img");
    await thumbnailFallback.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => (document.querySelector('[aria-label="صور الحجز"] img') as HTMLImageElement)?.getAttribute("src") === "/fixture-photos/reference-original.svg");
    assert.equal(await thumbnailFallback.getAttribute("src"), reference.url);
    fixture = "original-broken"; await page.goto(`${origin}/admin/bookings/service/151?tab=tasks&fixture=${fixture}`, { waitUntil: "networkidle" });
    await page.getByRole("region", { name: "صور الحجز", exact: true }).getByRole("button", { name: "عرض صورة صورة الحجز 1", exact: true }).click();
    const brokenPreview = page.getByRole("dialog"); await brokenPreview.getByText("تعذر تحميل الصورة الأصلية", { exact: true }).waitFor();
    await brokenPreview.getByRole("button", { name: "إعادة تحميل الصورة", exact: true }).click(); await brokenPreview.getByText("تعذر تحميل الصورة الأصلية", { exact: true }).waitFor();
    await page.keyboard.press("Escape"); await brokenPreview.waitFor({ state: "detached" });
    assert.deepEqual(errors, [], `workspace runtime errors at ${width}`);
    await context.close();
  }
  console.log("PASS original service/native workspaces at 1440/768/390px: Kosha scenarios preserved; photography/sound/mixed products, original uploads, legacy/native photos, deduplication, original-quality previews, focus, empty/editor and broken-image fallback");
} finally { await browser.close(); await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); }
