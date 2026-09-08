// Presentation-only staff fixtures. Every API request is intercepted; no database writes.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

const browserPrerequisites = [
  "This browser fixture only uses intercepted API responses; it does not write to a database.",
  "PREREQUISITES:",
  "1. Start an AJN app that returns HTTP 2xx for /staff/koshas (for example: pnpm run dev -- --port 3105).",
  "2. Point AJN_BROWSER_RUNTIME at the package.json of a project whose resolver can load Playwright.",
  "   PowerShell: $env:AJN_BROWSER_RUNTIME=(Resolve-Path 'C:\\path\\to\\playwright-enabled-project\\package.json').Path",
  "3. Optionally target a non-default local app URL: $env:AJN_BROWSER_ORIGIN='http://127.0.0.1:3105'",
  "4. Run: pnpm run test:kosha-staff-instructions",
].join("\n");

const browserRuntime = process.env.AJN_BROWSER_RUNTIME;
if (!browserRuntime || !isAbsolute(browserRuntime) || !existsSync(browserRuntime)) {
  console.error([
    "PREREQUISITE: AJN_BROWSER_RUNTIME must be an existing absolute package.json path.",
    browserPrerequisites,
  ].join("\n"));
  process.exit(2);
}
let chromium;
try {
  ({ chromium } = createRequire(browserRuntime)("playwright"));
} catch (error) {
  console.error(`PREREQUISITE: Playwright could not be loaded from AJN_BROWSER_RUNTIME (${browserRuntime}).`);
  console.error(browserPrerequisites);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const origin = process.env.AJN_BROWSER_ORIGIN || "http://127.0.0.1:3105";
try {
  const response = await fetch(`${origin}/staff/koshas`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  console.error([
    `PREREQUISITE: the AJN app did not return a successful staff page at ${origin}.`,
    browserPrerequisites,
    `Cause: ${error instanceof Error ? error.message : String(error)}`,
  ].join("\n"));
  process.exit(2);
}
const longCaption = `${Array.from({ length: 32 }, () => "ثبت القوس الأبيض في المنتصف واترك ممراً آمناً حول منصة العروس.").join(" ")} نهاية التعليمات الطويلة`;

function booking(id, source, unreadInstructionCount) {
  return {
    id,
    source,
    koshaName: source === "service" ? "كوشة الخدمة" : "كوشة أصلية",
    departments: ["kosha"],
    departmentBadge: "كوشات",
    customerName: source === "service" ? "عميل الخدمة" : "عميل الكوشة",
    phone: "07700000000",
    eventDate: "2026-09-08",
    eventTime: "18:00",
    eventType: "زفاف",
    province: "أربيل",
    area: "عنكاوا",
    cityArea: "المركز",
    hallLocation: "قاعة الاختبار",
    addressNotes: "",
    status: "confirmed",
    executionStage: "preparing",
    totalAmount: 100000,
    paidAmount: 50000,
    remainingAmount: 50000,
    paymentStatus: "partial",
    bucket: "upcoming",
    notes: "اختبار معلومات المهمة",
    assignedEmployees: ["موظف اختبار"],
    unreadInstructionCount,
  };
}

const nativeBooking = booking(11, "kosha", 2);
const serviceBooking = booking(12, "service", 1);
const detail = (value) => ({
  booking: value,
  setup: { kosha: null, welcomeBoards: [], addons: [], accessories: [], package: null },
  timeline: [],
  media: [],
  delivery: null,
  paymentRequests: [],
  unreadInstructionCount: value.unreadInstructionCount,
});
const operations = (value) => ({
  bookingId: value.id,
  bookingSource: value.source,
  checklist: [],
  checklistCovered: false,
  checklistIssues: [],
  stageEvents: [],
  damages: [],
  damageAnswered: false,
  scanCounts: {},
});
const nativeInstructions = {
  instructions: [
    { id: 31, bookingSource: "kosha", bookingId: 11, kind: "image", mediaUrl: "/uploads/reference-one.png", caption: longCaption, uploadedByStaffId: 1, uploadedByName: "مدير الاختبار", revision: 1, bookingVersion: 1, createdAt: "2026-09-06T08:00:00.000Z", updatedAt: "2026-09-06T08:00:00.000Z", archivedAt: null, archivedByStaffId: null },
    { id: 32, bookingSource: "kosha", bookingId: 11, kind: "image", mediaUrl: "/uploads/reference-two.png", caption: "الورود الوردية", uploadedByStaffId: 1, uploadedByName: "مدير الاختبار", revision: 1, bookingVersion: 2, createdAt: "2026-09-06T08:05:00.000Z", updatedAt: "2026-09-06T08:05:00.000Z", archivedAt: null, archivedByStaffId: null },
    { id: 33, bookingSource: "kosha", bookingId: 11, kind: "note", mediaUrl: null, caption: "اترك ممراً آمناً خلف الكوشة.", uploadedByStaffId: 1, uploadedByName: "مدير الاختبار", revision: 2, bookingVersion: 3, createdAt: "2026-09-06T08:03:00.000Z", updatedAt: "2026-09-06T08:04:00.000Z", archivedAt: null, archivedByStaffId: null },
  ],
  latestAt: "2026-09-06T08:05:00.000Z",
  latestVersion: 3,
  viewedAt: null,
  viewedVersion: 0,
  unreadCount: 2,
};
const serviceInstructions = {
  instructions: [
    { id: 41, bookingSource: "service", bookingId: 12, kind: "note", mediaUrl: null, caption: "تعليمات الخدمة الأصلية.", uploadedByStaffId: 2, uploadedByName: "مشرف الخدمة", revision: 1, bookingVersion: 4, createdAt: "2026-09-06T09:00:00.000Z", updatedAt: "2026-09-06T09:00:00.000Z", archivedAt: null, archivedByStaffId: null },
  ],
  latestAt: "2026-09-06T09:00:00.000Z",
  latestVersion: 4,
  viewedAt: null,
  viewedVersion: 0,
  unreadCount: 1,
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "ajn_admin_session", value: "staff-instruction-fixture", url: origin }]);
  const page = await context.newPage();
  const errors = [];
  const instructionGets = [];
  const dashboardGets = [];
  const viewed = [];
  let failNativeViewed = true;
  let failServiceInstructions = true;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/admin/auth/me")) return route.fulfill({ json: { user: { id: 7, role: "employee", username: "crew", fullName: "موظف اختبار", isActive: true, permissions: ["koshas"] } } });
    if (path.endsWith("/staff/koshas/notifications")) return route.fulfill({ json: [] });
    if (path.endsWith("/staff/koshas/dashboard") && request.method() === "GET") {
      dashboardGets.push(path);
      return route.fulfill({
        json: {
          today: "2026-09-07",
          counts: { today: 1, tomorrow: 1, upcoming: 0, late: 0, completed: 0 },
          todayBookings: [nativeBooking],
          tomorrowBookings: [serviceBooking],
        },
      });
    }
    if (path.endsWith("/staff/koshas/bookings") && request.method() === "GET") return route.fulfill({ json: [nativeBooking, serviceBooking] });
    for (const value of [nativeBooking, serviceBooking]) {
      const detailPath = `/staff/koshas/bookings/${value.id}`;
      if (path.endsWith(`${detailPath}/instructions/viewed`)) {
        viewed.push({ id: value.id, source: url.searchParams.get("source"), body: request.postDataJSON() });
        if (value.source === "kosha" && failNativeViewed) {
          failNativeViewed = false;
          return route.fulfill({ status: 500, json: { error: { message: "تعذر تسجيل القراءة التجريبية", code: "TEST_ERROR" } } });
        }
        return route.fulfill({ json: { viewedAt: request.postDataJSON().viewedThrough, viewedVersion: request.postDataJSON().viewedVersion } });
      }
      if (path.endsWith(`${detailPath}/instructions`)) {
        instructionGets.push({ id: value.id, source: url.searchParams.get("source") });
        if (value.source === "service" && failServiceInstructions) {
          failServiceInstructions = false;
          return route.fulfill({ status: 500, json: { error: { message: "تعذر تحميل تعليمات الخدمة التجريبية", code: "TEST_ERROR" } } });
        }
        return route.fulfill({ json: value.source === "service" ? serviceInstructions : nativeInstructions });
      }
      if (path.endsWith(`${detailPath}/assets`)) return route.fulfill({ json: { assets: [], products: [] } });
      if (path.endsWith(detailPath)) return route.fulfill({ json: detail(value) });
      if (path.endsWith(`/staff/koshas/operations/${value.id}`)) return route.fulfill({ json: operations(value) });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/uploads/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/reference-one.png")) {
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="960" viewBox="0 0 240 960"><rect width="240" height="960" fill="#f3e8e5"/><path d="M40 900V210c0-180 160-180 160 0v690" fill="none" stroke="#7f1d3f" stroke-width="18"/></svg>',
      });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzp7wAAAABJRU5ErkJggg==", "base64") });
  });

  await page.goto(`${origin}/staff/koshas`);
  await page.getByRole("heading", { name: "حجوزات اليوم", exact: true }).waitFor({ timeout: 60000 });
  await page.getByText("تعليمات الإدارة • 2 جديد", { exact: true }).waitFor();
  await page.getByText("تعليمات الإدارة • 1 جديد", { exact: true }).waitFor();
  assert(dashboardGets.length > 0 && dashboardGets.every((path) => path === "/api/staff/koshas/dashboard"), "Dashboard loads cards only through its batched endpoint");
  assert.equal(instructionGets.length, 0, "Dashboard cards never perform per-booking instruction requests");
  assert.equal(await page.locator('a[href="/staff/koshas/booking/11?source=kosha"]').count(), 1, "Dashboard native card preserves source identity");
  assert.equal(await page.locator('a[href="/staff/koshas/booking/12?source=service"]').count(), 1, "Dashboard service card preserves source identity");

  await page.goto(`${origin}/staff/koshas/list/all`);
  await page.getByText("تعليمات الإدارة • 2 جديد", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText("تعليمات الإدارة • 1 جديد", { exact: true }).waitFor();
  const nativeLink = page.locator('a[href="/staff/koshas/booking/11?source=kosha"]');
  const serviceLink = page.locator('a[href="/staff/koshas/booking/12?source=service"]');
  assert.equal(await nativeLink.count(), 1, "Native card preserves the explicit source query");
  assert.equal(await serviceLink.count(), 1, "Service card preserves the explicit source query");

  await nativeLink.click();
  await page.getByRole("heading", { name: "تعليمات من الإدارة", exact: true }).waitFor();
  await page.getByText("اترك ممراً آمناً خلف الكوشة.", { exact: true }).waitFor();
  await page.getByText("مدير الاختبار", { exact: false }).first().waitFor();
  assert.deepEqual(instructionGets[0], { id: 11, source: "kosha" }, "Native instructions use the exact booking identity");
  assert(await page.evaluate(() => {
    const instructions = [...document.querySelectorAll("h2")].find((node) => node.textContent?.includes("تعليمات من الإدارة"));
    const stages = [...document.querySelectorAll("div")].find((node) => node.textContent === "مراحل التنفيذ");
    return Boolean(instructions && stages && (instructions.compareDocumentPosition(stages) & Node.DOCUMENT_POSITION_FOLLOWING));
  }), "Manager instructions render before execution stage controls on mobile");
  await page.getByRole("alert").filter({ hasText: "تعذر تسجيل قراءة التعليمات" }).waitFor();
  await page.getByText("تعليمات الإدارة • 2 جديد", { exact: true }).waitFor();
  assert.deepEqual(viewed, [{ id: 11, source: "kosha", body: { viewedThrough: nativeInstructions.latestAt, viewedVersion: nativeInstructions.latestVersion } }], "Failed acknowledgement uses only the rendered native cursor snapshot");
  await page.getByRole("button", { name: "إعادة تسجيل القراءة", exact: true }).click();
  await page.getByText("تم تسجيل قراءة التعليمات", { exact: true }).waitFor();
  assert.deepEqual(viewed.slice(0, 2), [
    { id: 11, source: "kosha", body: { viewedThrough: nativeInstructions.latestAt, viewedVersion: nativeInstructions.latestVersion } },
    { id: 11, source: "kosha", body: { viewedThrough: nativeInstructions.latestAt, viewedVersion: nativeInstructions.latestVersion } },
  ], "Retry resends the captured snapshot exactly");
  assert.equal(await page.getByText("تعليمات الإدارة • 2 جديد", { exact: true }).count(), 0, "Unread badge clears only after acknowledgement succeeds");

  await page.setViewportSize({ width: 390, height: 500 });
  await page.getByRole("button", { name: /تكبير صورة تعليمات الإدارة: ثبت القوس الأبيض/ }).click();
  const viewer = page.getByRole("dialog", { name: "عارض صور تعليمات الإدارة" });
  await viewer.waitFor();
  const caption = viewer.locator("figcaption");
  await caption.getByText("نهاية التعليمات الطويلة", { exact: false }).waitFor();
  await viewer.evaluate(async (dialog) => {
    await Promise.all(dialog.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  const viewerGeometry = await viewer.evaluate((dialog) => {
    const dialogRect = dialog.getBoundingClientRect();
    const image = dialog.querySelector("figure img")?.getBoundingClientRect();
    const captionRect = dialog.querySelector("figcaption")?.getBoundingClientRect();
    const actions = [...dialog.querySelectorAll('button[aria-label="الصورة السابقة"], button[aria-label="الصورة التالية"]')]
      .map((button) => button.getBoundingClientRect());
    const inside = (rect) => rect && rect.top >= dialogRect.top - 1 && rect.bottom <= dialogRect.bottom + 1;
    return {
      dialogRect: { top: dialogRect.top, bottom: dialogRect.bottom, height: dialogRect.height, viewportHeight: window.innerHeight },
      dialogFitsViewport: dialogRect.top >= 0 && dialogRect.bottom <= window.innerHeight,
      imageAndCaptionContained: inside(image) && inside(captionRect),
      actionsContained: actions.length === 2 && actions.every(inside),
      boundedContent: dialog.scrollHeight <= dialog.clientHeight + 1,
    };
  });
  assert(viewerGeometry.dialogFitsViewport, `Portrait viewer stays within the short mobile viewport: ${JSON.stringify(viewerGeometry.dialogRect)}`);
  assert(viewerGeometry.imageAndCaptionContained, "Portrait image and long caption remain inside the dialog");
  assert(viewerGeometry.actionsContained, "Viewer actions remain reachable on a short mobile viewport");
  assert(viewerGeometry.boundedContent, "Viewer uses a bounded layout instead of clipping overflowing content");
  assert(await caption.evaluate((node) => node.scrollHeight > node.clientHeight), "Long caption exposes an independent scroll region");
  await caption.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  assert(await caption.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1), "The full long caption can be reached by scrolling");
  await page.keyboard.press("ArrowLeft");
  await page.getByText("الورود الوردية", { exact: true }).last().waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile RTL viewer must not overflow horizontally");
  await page.keyboard.press("Escape");

  await page.goto(`${origin}/staff/koshas/booking/12?source=service`);
  await page.getByRole("alert").filter({ hasText: "تعذر تحميل تعليمات الإدارة" }).waitFor();
  assert.equal(viewed.filter((entry) => entry.id === 12).length, 0, "Unrendered service instructions are never acknowledged");
  await page.getByRole("button", { name: "إعادة تحميل التعليمات", exact: true }).click();
  await page.getByText("تعليمات الخدمة الأصلية.", { exact: true }).waitFor();
  await page.getByText("تم تسجيل قراءة التعليمات", { exact: true }).waitFor();
  assert.deepEqual(instructionGets.filter((entry) => entry.id === 12), [{ id: 12, source: "service" }, { id: 12, source: "service" }], "Service retry preserves the exact source query");
  assert.deepEqual(viewed.find((entry) => entry.id === 12), { id: 12, source: "service", body: { viewedThrough: serviceInstructions.latestAt, viewedVersion: serviceInstructions.latestVersion } }, "Service acknowledgement uses its rendered cursor snapshot");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile staff detail must not overflow horizontally");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: staff manager instructions — dashboard/list batching contract, native/service identity, unread failure/retry, mobile order and bounded RTL viewer access");
} finally {
  await browser.close();
}
