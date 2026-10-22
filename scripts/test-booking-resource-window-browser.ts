import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
const runtime = process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime, "AJN_BROWSER_RUNTIME must point to the installed browser runtime package.json");
const { chromium } = createRequire(runtime)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const styles = (await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") })).css;
const bundle = await esbuild.build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {BookingResourceWindowPanel} from './src/views/admin/booking-resource-window-panel';function App(){const [base,setBase]=useState('/admin/booking-operations/kosha/7');window.scope=setBase;return <BookingResourceWindowPanel base={base} queryKey={['operations',base]}/>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(styles); }
  else { res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto"></main><script src="/fixture.js"></script></body></html>'); }
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const output = ".next/booking-resource-window-review"; await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    const posts: any[] = [], snapshots = new Map<string, any>(), errors: string[] = [];
    let failSave = true, failRead = false, delay = false, received!: () => void, release!: () => void;
    let arrival = Promise.resolve(), response = Promise.resolve();
    const defer = () => { delay = true; arrival = new Promise<void>(done => received = done); response = new Promise<void>(done => release = done); };
    page.on("pageerror", (cause: any) => errors.push(cause.message));
    await page.route("**/api/**", async (route: any) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      assert.ok(path.endsWith("/resource-window"), "only the original resource-window endpoint is used");
      if (req.method() === "GET") return failRead ? route.fulfill({ status: 503, json: { message: "المواعيد غير متاحة", requestId: "fixture-read" } }) : route.fulfill({ json: { resourceWindow: snapshots.get(path) ?? null, expectedWindow: snapshots.get(path) ?? null, eventDate: "2026-10-22", eventTime: "20:00", canEdit: true } });
      assert.equal(req.method(), "PUT"); const body = req.postDataJSON(); posts.push({ path, body });
      if (delay) { delay = false; received(); await response; }
      if (failSave) return route.fulfill({ status: 409, json: { message: "المعدة مشغولة؛ راجع الحجز الآخر", code: "CONFLICT", requestId: "fixture-write" } });
      snapshots.set(path, body.window); return route.fulfill({ json: { ok: true, resourceWindow: body.window } });
    });
    try {
      await page.goto(origin); await page.getByLabel("بداية التجهيز", { exact: true }).waitFor();
      const save = () => page.getByRole("button", { name: "حفظ فترة التشغيل", exact: true });
      const fill = async (end = "2026-10-23T12:00") => {
        await page.getByLabel("بداية التجهيز", { exact: true }).fill("2026-10-22T12:00");
        await page.getByLabel("بداية المناسبة", { exact: true }).fill("2026-10-22T20:00");
        await page.getByLabel("نهاية المناسبة", { exact: true }).fill("2026-10-23T01:00");
        await page.getByLabel("اكتمال الإرجاع", { exact: true }).fill(end);
      };
      assert.equal(await save().isDisabled(), true);
      await fill("2026-10-22T10:00"); await save().click(); await page.getByRole("alert").filter({ hasText: "ترتيب المواعيد" }).waitFor(); assert.equal(posts.length, 0);
      await fill(); await save().click(); await page.getByRole("alert").filter({ hasText: "المعدة مشغولة" }).waitFor();
      assert.equal(await page.getByLabel("اكتمال الإرجاع", { exact: true }).inputValue(), "2026-10-23T12:00");
      assert.equal(posts.length, 1); assert.equal(posts[0].body.expectedWindow, null);
      failSave = false; defer(); await save().click(); await arrival;
      assert.equal(await page.getByRole("button", { name: "جارٍ حفظ المواعيد", exact: true }).isDisabled(), true);
      await page.locator("form").evaluate((form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      release(); await page.getByText("تم حفظ فترة تشغيل الموارد", { exact: true }).waitFor(); assert.equal(posts.length, 2, "pending duplicate submission is ignored");
      assert.equal(posts[1].body.window.preparationStart, "2026-10-22T12:00:00+03:00");
      await page.screenshot({ path: `${output}/period-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `RTL overflow ${width}`);
      for (const input of await page.locator('input[type="datetime-local"]').all()) assert.ok((await input.boundingBox())!.height >= 44, "touch targets stay comfortable");
      // Actual panel is reused across source changes. A late old-source success
      // must not clear the new booking's draft or show an unrelated saved notice.
      await page.getByLabel("اكتمال الإرجاع", { exact: true }).fill("2026-10-24T12:00"); defer(); await save().click(); await arrival;
      await page.evaluate(() => (window as any).scope("/admin/booking-operations/service/7"));
      await page.getByLabel("بداية التجهيز", { exact: true }).waitFor();
      await fill("2026-10-25T12:00"); release();
      await page.waitForFunction(() => !document.body.textContent?.includes("جارٍ حفظ المواعيد"));
      assert.equal(await page.getByLabel("اكتمال الإرجاع", { exact: true }).inputValue(), "2026-10-25T12:00");
      assert.equal(await page.getByText("تم حفظ فترة تشغيل الموارد", { exact: true }).count(), 0);
      failRead = true; await page.evaluate(() => (window as any).scope("/admin/booking-operations/service/8"));
      await page.getByRole("alert").filter({ hasText: "تعذر قراءة المواعيد" }).waitFor(); assert.equal(await page.locator('input[type="datetime-local"]').count(), 0);
      failRead = false; await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click(); await page.getByLabel("بداية التجهيز", { exact: true }).waitFor();
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log(`PASS actual resource-period editor ${width}px: validation, failed-save draft, duplicate submit, source switch, late response, read failure/retry and RTL`);
    } finally { release?.(); await context.close(); }
  }
} finally { await browser.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
