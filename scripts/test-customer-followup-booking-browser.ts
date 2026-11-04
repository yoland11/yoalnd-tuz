/** Actual BookingCenterPage, original controls/CSS, and synthetic HTTP only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

assert.ok(
  process.env.AJN_BROWSER_RUNTIME,
  "Set AJN_BROWSER_RUNTIME to installed Playwright package.json",
);
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME!)(
  "playwright",
);
const esbuild = createRequire(
  realpathSync(resolve("lib/db/node_modules/tsx/package.json")),
)("esbuild");
const postcss = createRequire(
  realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")),
)("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css =
  (
    await postcss([tailwind()]).process(
      await readFile("src/index.css", "utf8"),
      { from: resolve("src/index.css") },
    )
  ).css +
  "\n" +
  (await readFile("src/views/admin/booking-center.css", "utf8"));
const javascript = (
  await esbuild.build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Router} from 'wouter';import {TooltipProvider} from './src/components/ui/tooltip';import {Toaster} from './src/components/ui/toaster';import BookingCenterPage from './src/views/admin/booking-center';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}})}><Router><TooltipProvider><BookingCenterPage/><Toaster/></TooltipProvider></Router></QueryClientProvider>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outdir: ".next/customer-followup-booking-browser-bundle",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"development"' },
  })
).outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js"
      ? "application/javascript"
      : req.url === "/fixture.css"
        ? "text/css"
        : "text/html;charset=utf-8",
  );
  res.end(
    req.url === "/fixture.js"
      ? javascript
      : req.url === "/fixture.css"
        ? css
        : '<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto;min-width:0"></main><script src="/fixture.js"></script></body></html>',
  );
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const output = ".next/customer-followup-review";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.AJN_BROWSER_EXECUTABLE ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    const initial = {
      id: 17,
      customer: { id: 5, name: "عميل التخرج الأصلي", phone: "07701234567" },
      serviceKey: "graduation",
      followupAt: "2026-11-03T09:00:00.000Z",
      status: "interested",
      employee: { id: 7, fullName: "موظف المتابعة" },
      note: "ملاحظة متابعة داخلية لا تُنسخ للحجز",
      completedAt: null,
      version: 1,
      contactBlocked: false,
      booking: null,
      createdAt: "2026-11-01T09:00:00.000Z",
    };
    let row: any = { ...initial },
      contextFails = true,
      conflict = true;
    const requests: { method: string; path: string; search: string }[] = [],
      posts: any[] = [],
      unexpected: string[] = [];
    await page.route("**/*", async (route: any) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.route("**/api/**", async (route: any) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname;
      requests.push({ method: req.method(), path, search: url.search });
      if (path === "/api/admin/auth/me" && req.method() === "GET")
        return route.fulfill({
          json: {
            user: {
              id: 1,
              role: "admin",
              username: "local-fixture",
              fullName: "مدير الاختبار",
              isActive: true,
              permissions: [],
            },
          },
        });
      if (path === "/api/admin/customer-followups/17" && req.method() === "GET")
        return contextFails
          ? route.fulfill({
              status: 503,
              json: {
                message: "تعذر قراءة مصدر المتابعة",
                code: "DATABASE_ERROR",
                requestId: "REQ-booking-source",
              },
            })
          : route.fulfill({ json: { followup: row } });
      if (path === "/api/admin/booking-center" && req.method() === "GET") {
        assert.equal(url.searchParams.get("readiness"), "1");
        return route.fulfill({ json: [] });
      }
      if (path === "/api/admin/penalties/indicators" && req.method() === "GET")
        return route.fulfill({ json: { indicators: {} } });
      if (path === "/api/admin/services" && req.method() === "GET")
        return route.fulfill({
          json: [
            {
              id: 11,
              name: "Graduation",
              nameAr: "تخرج",
              type: "graduation",
              isActive: true,
            },
          ],
        });
      if (path === "/api/admin/service-orders" && req.method() === "POST") {
        const body = req.postDataJSON();
        posts.push(body);
        if (conflict)
          return route.fulfill({
            status: 409,
            json: {
              message: "هذه المتابعة مرتبطة بحجز محفوظ",
              code: "FOLLOWUP_ALREADY_CONVERTED",
              requestId: "REQ-existing-booking",
              existingBooking: {
                source: "service",
                id: 501,
                number: "SRV-501",
                href: "https://untrusted.invalid/external",
              },
            },
          });
        row = {
          ...row,
          status: "converted",
          booking: {
            source: "service",
            id: 602,
            number: "SRV-602",
            href: "/admin/bookings/service/602",
          },
        };
        return route.fulfill({ json: { id: 602, trackingCode: "SRV-602" } });
      }
      unexpected.push(`${req.method()} ${path}`);
      return route.fulfill({
        status: 403,
        json: {
          message: "غير مسموح ضمن الاختبار المحلي",
          code: "PERMISSION_DENIED",
          requestId: "REQ-test-only",
        },
      });
    });
    const go = async () =>
      page.goto(`${origin}/admin/bookings?followup=17`, {
        waitUntil: "networkidle",
      });
    const form = () => page.locator("#booking-create-form");
    const save = () =>
      form().getByRole("button", { name: "حفظ الحجز", exact: true });
    const fill = async () => {
      await form().waitFor();
      const date = page.locator("#booking-date");
      await date.focus();
      await date.press("ControlOrMeta+A");
      await date.fill("2026-11-10");
      await date.press("Tab");
      assert.equal(
        await form().locator('input[type="date"]').inputValue(),
        "2026-11-10",
      );
      await page.locator("#booking-total").fill("75000");
      await page.locator("#booking-deposit").fill("15000");
      await page.locator("#booking-time").fill("18:30");
      await page.locator("#booking-hall").fill("قاعة الاختبار");
      await page.locator("#booking-contract").fill("CN-17");
      await page
        .locator("#booking-map")
        .fill("https://maps.google.com/?q=test");
      await page.locator("#booking-notes").fill("موعد التخرج");
    };
    function assertOriginalPayload(body: any) {
      assert.deepEqual(
        body,
        {
          serviceId: 11,
          customerName: initial.customer.name,
          phone: initial.customer.phone,
          eventDate: "2026-11-10",
          eventLocation: "قاعة الاختبار",
          totalAmount: 75000,
          baseTotalAmount: 75000,
          serviceItems: [],
          depositAmount: 15000,
          paymentStatus: "partial",
          notes: "موعد التخرج",
          customFields: {
            bookingCenterVersion: 1,
            customerId: 5,
            customerFollowupId: 17,
            eventType: "تخرج",
            eventTime: "18:30",
            hallName: "قاعة الاختبار",
            mapUrl: "https://maps.google.com/?q=test",
            contractNumber: "CN-17",
            bookingPhotos: [],
            bookingImage: null,
            departments: ["graduation"],
            bookingCenterServices: [
              { type: "graduation", status: "waiting", amount: 0 },
            ],
          },
        },
        "original financial/service payload is preserved; only canonical followup and explicit occasion metadata are additive",
      );
      assert.ok(
        !JSON.stringify(body).includes(initial.note),
        "private followup note is never copied",
      );
    }
    await go();
    await page
      .getByRole("alert")
      .filter({ hasText: "تعذر قراءة مصدر المتابعة" })
      .waitFor();
    assert.equal(
      await form().count(),
      0,
      "context read failure never becomes a manual create form",
    );
    await page
      .getByRole("button", { name: "حجز موحّد جديد", exact: true })
      .click();
    assert.equal(
      await form().count(),
      0,
      "global create cannot bypass a failed source read",
    );
    assert.equal(posts.length, 0);
    contextFails = false;
    await page
      .getByRole("button", { name: "إعادة المحاولة", exact: true })
      .click();
    await form().getByText(initial.customer.name, { exact: true }).waitFor();
    assert.equal(
      await page.locator("#booking-customer-search").count(),
      0,
      "source customer has no editable global picker",
    );
    assert.equal(
      await form()
        .getByRole("button", { name: "عميل جديد", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await form()
        .getByRole("button", { name: "التخرج", exact: true })
        .getAttribute("aria-pressed"),
      "true",
      "real graduation department is preselected",
    );
    await fill();
    await save().click();
    const recovery = page.getByRole("link", {
      name: "فتح الحجز المحفوظ SRV-501",
      exact: true,
    });
    await recovery.waitFor();
    assert.equal(
      await recovery.getAttribute("href"),
      "/admin/bookings/service/501",
      "typed conflict recovery ignores arbitrary server hrefs",
    );
    assert.equal(posts.length, 1);
    assertOriginalPayload(posts[0]);
    assert.equal(
      await save().isDisabled(),
      true,
      "conflict recovery blocks a second booking POST",
    );
    await save().evaluate((button: HTMLButtonElement) => button.click());
    await page
      .getByRole("button", { name: "حجز موحّد جديد", exact: true })
      .click();
    await page.waitForLoadState("networkidle");
    assert.equal(posts.length, 1);
    assert.equal(
      await page
        .getByText("تم إنشاء الحجز الموحد بنجاح", { exact: true })
        .count(),
      0,
      "conflict never reports success",
    );
    assert.deepEqual(
      unexpected,
      [],
      "source conversion reads no global customer directory or unrelated catalogues",
    );
    await recovery.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${output}/booking-conflict-${width}.png`,
      fullPage: true,
    });

    conflict = false;
    row = { ...initial };
    await go();
    await fill();
    await save().click();
    await page
      .getByText("تم إنشاء الحجز الموحد بنجاح", { exact: true })
      .waitFor();
    await form().waitFor({ state: "hidden" });
    await page.waitForLoadState("networkidle");
    assert.equal(posts.length, 2);
    assertOriginalPayload(posts[1]);
    assert.deepEqual(
      unexpected,
      [],
      "successful followup conversion never falls through to the historical global customer GET",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      `PASS actual BookingCenterPage ${width}px: scoped failed-read gate, locked original customer, graduation, original financial payload, typed conflict recovery/no duplicate and successful conversion without broad customer reads`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}
