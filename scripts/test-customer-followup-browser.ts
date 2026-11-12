/** Mounted production component and AJN CSS. Every API call uses a synthetic route. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
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
const css = (
  await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), {
    from: resolve("src/index.css"),
  })
).css;
const javascript = (
  await esbuild.build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import CustomerFollowupsPage from './src/views/admin/customer-followups';import {Toaster} from './src/components/ui/toaster';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><CustomerFollowupsPage mode={location.pathname.startsWith('/staff')?'staff':'admin'}/><Toaster/></QueryClientProvider>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outdir: ".next/customer-followup-browser-bundle",
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
        : "text/html; charset=utf-8",
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
    page.setDefaultTimeout(10000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const customer = { id: 9, name: "أحمد علي", phone: "07701234567" };
    const employee = { id: 7, fullName: "زينب كريم", department: "sales" };
    const replacementEmployee = {
      id: 8,
      fullName: "علي حسن",
      department: "sales",
    };
    const inactiveEmployee = { id: 99, fullName: "موظف سابق غير نشط" };
    const initialRow = {
      id: 17,
      customer,
      serviceKey: "photography",
      followupAt: "2026-11-03T09:00:00.000Z",
      status: "interested",
      employee,
      note: "يرغب بتصوير المناسبة",
      completedAt: null,
      version: 1,
      contactBlocked: false,
      booking: null,
      createdAt: "2026-11-01T09:00:00.000Z",
    };
    let row: any = { ...initialRow },
      staff = false,
      failRead = true,
      loseReply = false,
      writes = 0,
      completedEvents = 0,
      assignmentEvents = 0,
      customerReads = 0,
      canCreate = true,
      managerRole = true,
      failAssignees = true,
      savedPayload: any;
    const requests: {
      path: string;
      scope: string | null;
      employeeId: string | null;
    }[] = [];
    const replay = new Map<string, any>();
    await page.route("**/*", async (route: any) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.route("**/api/**", async (route: any) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname;
      requests.push({
        path,
        scope: url.searchParams.get("scope"),
        employeeId: url.searchParams.get("employeeId"),
      });
      assert.ok(
        path.startsWith("/api/admin/customer-followups"),
        `No broad/backfill/customer API: ${path}`,
      );
      if (staff)
        assert.equal(
          url.searchParams.get("scope"),
          "mine",
          "all staff requests explicitly scope=mine",
        );
      if (path.endsWith("/options"))
        return route.fulfill({
          json: { customers: [customer], employees: [employee] },
        });
      if (path.endsWith("/employees")) {
        assert.equal(staff, false, "staff never requests manager filter data");
        return route.fulfill({
          json: {
            employees: [
              employee,
              ...(row.employee.id === replacementEmployee.id
                ? [replacementEmployee]
                : []),
              inactiveEmployee,
            ],
          },
        });
      }
      if (path.endsWith("/17/assignees")) {
        assert.equal(
          staff,
          false,
          "staff never requests manager assignment data",
        );
        return failAssignees
          ? route.fulfill({
              status: 503,
              json: {
                message: "تعذر تحميل موظفي التعيين",
                requestId: "REQ-assignees",
              },
            })
          : route.fulfill({
              json: { employees: [employee, replacementEmployee] },
            });
      }
      if (path.endsWith("/17/customer")||path.endsWith('/17/history')) {
        customerReads++;
        return route.fulfill({ json: { customer,followup:row,history:[],related:[row],bookings:[] } });
      }
      if (req.method() === "GET")
        return failRead
          ? route.fulfill({
              status: 503,
              json: {
                message: "تعذر قراءة المتابعات",
                requestId: "REQ-followup-ui",
                code: "DATABASE_ERROR",
              },
            })
          : route.fulfill({
              json: {
                rows: [row],
                page: 1,
                pageSize: 25,
                total: 1,
                summary: {
                  today: 1,
                  overdue: 0,
                  upcoming: 0,
                  converted: row.booking ? 1 : 0,
                  total: 1,
                  completed: row.completedAt ? 1 : 0,
                },
                suggestions: staff
                  ? []
                  : [
                      {
                        key: "source:17:album",
                        customer,
                        serviceKey: "album",
                        reason: "استفسار سابق عن الألبوم",
                        sourceBooking: null,
                      },
                    ],
                capabilities: {
                  canManage: managerRole,
                  canCreate: !staff && canCreate,
                  canBook: !staff,
                  canCreateCustomer: !staff,
                  canOpenCustomer: true,
                },
              },
            });
      assert.equal(req.method(), "POST");
      writes++;
      const body = req.postDataJSON();
      assert.ok(body.idempotencyKey, "mutations have idempotency key");
      if (replay.has(body.idempotencyKey)) {
        assert.deepEqual(
          body,
          savedPayload,
          "lost response retry uses exact payload/key",
        );
        return route.fulfill({ json: replay.get(body.idempotencyKey) });
      }
      savedPayload = body;
      if (path.endsWith("/actions")) {
        assert.equal(body.expectedVersion, row.version);
        if (body.action === "complete") {
          completedEvents++;
          row = {
            ...row,
            completedAt: new Date().toISOString(),
            version: row.version + 1,
          };
        }
        if (body.action === "postpone")
          row = {
            ...row,
            followupAt: body.followupAt,
            note: body.note || row.note,
            version: row.version + 1,
          };
        if (body.action === "status")
          row = { ...row, status: body.status, version: row.version + 1 };
        if (body.action === "stop_contact")
          row = { ...row, contactBlocked: true, version: row.version + 1 };
        if (body.action === "resume_contact") {
          assert.equal(body.confirmResume, true);
          row = { ...row, contactBlocked: false, version: row.version + 1 };
        }
        if (body.action === "link_booking")
          row = {
            ...row,
            status: "converted",
            booking: {
              source: body.booking.source,
              id: body.booking.id,
              number: "BK-45",
              href: "/admin/bookings/service/45",
            },
            version: row.version + 1,
          };
        if (body.action === "assign") {
          assert.equal(path, "/api/admin/customer-followups/17/actions");
          assert.equal(body.assignedStaffId, 8);
          assert.ok(
            !("customerId" in body),
            "assignment keeps canonical customer identity on the original row",
          );
          assignmentEvents++;
          row = {
            ...row,
            employee: replacementEmployee,
            version: row.version + 1,
          };
        }
      } else {
        assert.equal(body.customerId, 9);
        assert.equal(body.assignedStaffId, 7);
      }
      const result = { followup: row };
      replay.set(body.idempotencyKey, result);
      if (loseReply) {
        loseReply = false;
        return route.fulfill({
          status: 503,
          json: {
            message: "انقطع الرد بعد الحفظ",
            requestId: "REQ-followup-lost",
            retryable: true,
          },
        });
      }
      return route.fulfill({ json: result });
    });
    const go = async () => {
      await page.goto(
        `${origin}${staff ? "/staff?tab=followups" : "/admin/customer-followups"}`,
        { waitUntil: "networkidle" },
      );
    };
    const click = async (name: string) =>
      page
        .getByRole("button", { name, exact: true })
        .filter({ visible: true })
        .click();
    const more = async () => click("المزيد لمتابعة أحمد علي");
    const selectMenu = async (name: string) => {
      await more();
      await page.getByRole("menuitem", { name, exact: true }).click();
      await page.getByRole("menu").waitFor({ state: "hidden" });
    };
    const fillDate = async (label: string, value: string) => {
      const input = page.getByLabel(label, { exact: true });
      await input.focus();
      await input.press("ControlOrMeta+A");
      await input.fill(value);
      await input.press("Tab");
      await page.getByLabel("الوقت", { exact: true }).fill("12:00");
      assert.equal(
        await page
          .getByRole("dialog")
          .locator('input[type="datetime-local"]')
          .inputValue(),
        `${value}T12:00`,
      );
    };

    await go();
    await page.getByText("تعذر قراءة المتابعات", { exact: true }).waitFor();
    assert.equal(
      await page.locator("[data-followup-kpi]").count(),
      0,
      "errors never fabricate zero counters",
    );
    assert.equal(
      await page.getByText("لا توجد متابعات", { exact: false }).count(),
      0,
    );
    failRead = false;
    await click("إعادة المحاولة");
    await page
      .getByRole("heading", { name: "متابعة المناسبات والإرسال الجماعي", exact: true })
      .waitFor();
    await page.locator('[data-followup-kpi="today"]').waitFor();
    assert.equal(await page.locator("[data-followup-kpi]").count(), 6);
    assert.equal(
      await page
        .locator(`[data-followup-layout="${width < 1280 ? "cards" : "table"}"]`)
        .isVisible(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `no horizontal overflow at ${width}px`,
    );
    await page.screenshot({
      path: `${output}/admin-${width}.png`,
      fullPage: true,
    });
    canCreate = false;
    row = {
      ...initialRow,
      employee: inactiveEmployee,
    };
    const optionsBeforeAssignment = requests.filter((request) =>
      request.path.endsWith("/options"),
    ).length;
    await go();
    const employeeFilter = page.getByRole("combobox", {
      name: "تصفية حسب الموظف",
      exact: true,
    });
    await employeeFilter.click();
    assert.equal(
      await page.getByRole("option", { name: /زينب كريم/ }).count(),
      1,
      "manager without create permission can filter by a current assignee",
    );
    assert.equal(
      await page.getByRole("option", { name: /موظف سابق غير نشط/ }).count(),
      1,
      "manager filter retains inactive employees with existing followups",
    );
    for (const [name, id] of [
      [/زينب كريم/, "7"],
      [/موظف سابق غير نشط/, "99"],
    ] as const) {
      const filteredRequest = page.waitForRequest((request: any) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/admin/customer-followups" &&
          url.searchParams.get("employeeId") === id
        );
      });
      await page.getByRole("option", { name }).click();
      await filteredRequest;
      await employeeFilter.click();
    }
    await page.getByRole("option", { name: "كل الموظفين", exact: true }).click();
    await employeeFilter.getByText("كل الموظفين", { exact: true }).waitFor();
    assert.deepEqual(
      requests
        .filter(
          (request) =>
            request.path === "/api/admin/customer-followups" &&
            request.employeeId,
        )
        .map((request) => request.employeeId),
      ["7", "99"],
      "employee selection filters the list for active and inactive assignees",
    );
    assert.equal(
      requests.some((request) => request.path.endsWith("/employees")),
      true,
      "manager filter uses the employee-only endpoint",
    );
    assert.equal(
      requests.filter((request) => request.path.endsWith("/options")).length,
      0,
      "manager filter never loads the customer creation directory",
    );
    await selectMenu("تعيين موظف");
    const assignmentDialog = page.getByRole("dialog", {
      name: "تعيين موظف",
      exact: true,
    });
    await assignmentDialog
      .getByText("تعذر تحميل موظفي التعيين", { exact: true })
      .waitFor();
    assert.equal(
      await assignmentDialog
        .getByRole("button", { name: "حفظ التعيين", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      requests.filter((request) => request.path.endsWith("/options")).length,
      optionsBeforeAssignment,
      "manager assignment needs no global customer lookup permission",
    );
    failAssignees = false;
    await assignmentDialog
      .getByRole("button", { name: "إعادة المحاولة", exact: true })
      .click();
    await assignmentDialog
      .getByRole("combobox", { name: "الموظف المسؤول الجديد", exact: true })
      .click();
    await page.getByRole("option", { name: /علي حسن/ }).click();
    await page
      .getByRole("option", { name: /علي حسن/ })
      .waitFor({ state: "hidden" });
    assert.equal(
      await assignmentDialog.evaluate(
        (element: HTMLElement) => element.scrollWidth > element.clientWidth + 1,
      ),
      false,
      `assignment dialog stays within ${width}px`,
    );
    await assignmentDialog.screenshot({
      path: `${output}/assign-${width}.png`,
    });
    loseReply = true;
    await assignmentDialog
      .getByRole("button", { name: "حفظ التعيين", exact: true })
      .click();
    await assignmentDialog
      .getByText("انقطع الرد بعد الحفظ", { exact: true })
      .waitFor();
    await assignmentDialog
      .getByRole("button", { name: "حفظ التعيين", exact: true })
      .click();
    await assignmentDialog.waitFor({ state: "hidden" });
    assert.equal(
      assignmentEvents,
      1,
      "reassignment lost-response retry applies once",
    );
    assert.equal(savedPayload.action, "assign");
    assert.equal(savedPayload.expectedVersion, 1);
    await page
      .locator("[data-followup-layout]")
      .filter({ visible: true })
      .getByText("علي حسن", { exact: true })
      .waitFor();
    await employeeFilter.click();
    assert.equal(
      await page.getByRole("option", { name: /علي حسن/ }).count(),
      1,
      "successful reassignment refreshes existing-assignee filter membership",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("[data-followup-kpi]").count(),
      6,
      "reassignment preserves six occasion KPIs",
    );
    canCreate = true;
    row = { ...initialRow };
    managerRole = false;
    await go();
    await more();
    assert.equal(
      await page
        .getByRole("menuitem", { name: "تعيين موظف", exact: true })
        .count(),
      0,
      "admin portal without manager capability cannot reassign",
    );
    await page.keyboard.press("Escape");
    managerRole = true;
    await go();
    assert.match(
      await page
        .getByRole("link", { name: "واتساب أحمد علي", exact: true })
        .filter({ visible: true })
        .getAttribute("href"),
      /^https:\/\/wa.me\/9647701234567\?text=/,
    );
    assert.equal(
      await page
        .getByRole("link", { name: "إنشاء حجز", exact: true })
        .filter({ visible: true })
        .getAttribute("href"),
      "/admin/bookings?followup=17",
    );
    await selectMenu("عرض العميل");
    await page
      .getByRole("dialog")
      .getByText("أحمد علي", { exact: true })
      .waitFor();
    assert.equal(customerReads, 1);
    await page.keyboard.press("Escape");

    loseReply = true;
    await click("إكمال");
    await page.getByText("انقطع الرد بعد الحفظ", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "plain completion is one click",
    );
    assert.equal(
      await page.getByText("تم حفظ المتابعة", { exact: true }).count(),
      0,
      "failed response never shows success",
    );
    await click("إعادة المحاولة");
    await page
      .getByText("مكتملة", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(completedEvents, 1);

    row = { ...initialRow };
    await go();
    await selectMenu("تأجيل");
    await fillDate("الموعد الجديد", "2026-11-05");
    await page.getByLabel("ملاحظة", { exact: false }).fill("طلب موعداً آخر");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "حفظ", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(savedPayload.followupAt, "2026-11-05T09:00:00.000Z");
    await selectMenu("غير مهتم");
    await page
      .getByText("غير مهتم", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(
      row.contactBlocked,
      false,
      "service decline does not stop global contact",
    );
    await selectMenu("إيقاف التواصل مع العميل");
    const beforeStop = writes;
    await page.getByRole("dialog").waitFor();
    assert.equal(
      writes,
      beforeStop,
      "opening stop-contact dialog never writes",
    );
    await page.keyboard.press("Escape");
    assert.equal(row.contactBlocked, false);
    await selectMenu("إيقاف التواصل مع العميل");
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: "تأكيد إيقاف التواصل لكل الخدمات",
        exact: true,
      })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.getByRole("link", { name: "واتساب أحمد علي" }).count(),
      0,
    );
    await selectMenu("استئناف التواصل مع العميل");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "تأكيد استئناف التواصل", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });

    const beforeSuggestion = writes;
    await page
      .getByRole("region", { name: "متابعات مقترحة", exact: true })
      .getByRole("button", { name: "إضافة متابعة", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      writes,
      beforeSuggestion,
      "suggestions only prefill the add dialog",
    );
    await dialog
      .getByRole("combobox", { name: "الخدمة محل الاهتمام", exact: true })
      .getByText("الألبوم", { exact: true })
      .waitFor();
    await fillDate("موعد المتابعة", "2026-11-06");
    await dialog
      .getByRole("button", { name: "حفظ المتابعة", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(savedPayload.suggestionKey, "source:17:album");
    await page
      .locator("header")
      .getByRole("button", { name: "إضافة متابعة", exact: true })
      .click();
    await page.getByRole("combobox", { name: "العميل", exact: true }).click();
    await page
      .getByRole("combobox", { name: "البحث عن عميل موجود", exact: true })
      .fill("أحمد");
    await page.getByRole("option", { name: /أحمد علي/ }).click();
    await fillDate("موعد المتابعة", "2026-11-07");
    await page
      .getByRole("dialog", { name: "إضافة متابعة", exact: true })
      .getByRole("button", { name: "حفظ المتابعة", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "إضافة متابعة", exact: true })
      .waitFor({ state: "hidden" });
    assert.ok(
      !savedPayload.suggestionKey,
      "manual creation does not inherit previous suggestion provenance",
    );
    row = { ...initialRow };
    await go();
    await selectMenu("إكمال مع ملاحظة أو موعد تالٍ");
    await page.getByLabel("ملاحظة", { exact: false }).fill("تواصلنا مع العميل");
    await fillDate("موعد متابعة تالٍ (اختياري)", "2026-11-08");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "حفظ", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(savedPayload.nextFollowupAt, "2026-11-08T09:00:00.000Z");
    assert.equal(savedPayload.note, "تواصلنا مع العميل");
    row = { ...initialRow };
    await go();
    await selectMenu("ربط حجز موجود");
    await page.getByLabel("معرّف الحجز الأصلي", { exact: true }).fill("45");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "حفظ", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual(savedPayload.booking, { source: "service", id: 45 });
    await page
      .getByRole("link", { name: "الحجز BK-45", exact: true })
      .filter({ visible: true })
      .waitFor();
    staff = true;
    row = { ...initialRow };
    await go();
    await page.locator('[data-followup-mode="staff"]').waitFor();
    await more();
    assert.equal(
      await page
        .getByRole("menuitem", { name: "تعيين موظف", exact: true })
        .count(),
      0,
      "staff mode cannot reassign even for a manager actor",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "إكمال", exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "إضافة متابعة", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("link", { name: "إنشاء حجز", exact: true }).count(),
      0,
    );
    await selectMenu("عرض العميل");
    await page
      .getByRole("dialog")
      .getByText("أحمد علي", { exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await click("إكمال");
    await page
      .getByText("مكتملة", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
    await page.screenshot({
      path: `${output}/staff-${width}.png`,
      fullPage: true,
    });
    await context.close();
    console.log(
      `PASS mounted customer followup ${width}px: manager reassignment/permissions/replay, errors, 6 KPIs, scoped preview, one-click complete, exact replay, postpone, consent, suggestion/manual create, complete+next, canonical link and staff scope`,
    );
  }
} finally {
  await browser.close();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}
