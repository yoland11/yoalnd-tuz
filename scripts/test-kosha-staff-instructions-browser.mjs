// Presentation-only staff fixtures. Every API request is intercepted; no database writes.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(process.env.AJN_BROWSER_RUNTIME);
const { chromium } = require("playwright");
const origin = "http://127.0.0.1:3105";

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
    { id: 31, bookingSource: "kosha", bookingId: 11, kind: "image", mediaUrl: "/uploads/reference-one.png", caption: "القوس الأبيض", uploadedByStaffId: 1, uploadedByName: "مدير الاختبار", revision: 1, createdAt: "2026-09-06T08:00:00.000Z", updatedAt: "2026-09-06T08:00:00.000Z", archivedAt: null, archivedByStaffId: null },
    { id: 32, bookingSource: "kosha", bookingId: 11, kind: "image", mediaUrl: "/uploads/reference-two.png", caption: "الورود الوردية", uploadedByStaffId: 1, uploadedByName: "مدير الاختبار", revision: 1, createdAt: "2026-09-06T08:05:00.000Z", updatedAt: "2026-09-06T08:05:00.000Z", archivedAt: null, archivedByStaffId: null },
    { id: 33, bookingSource: "kosha", bookingId: 11, kind: "note", mediaUrl: null, caption: "اترك ممراً آمناً خلف الكوشة.", uploadedByStaffId: 1, uploadedByName: "مدير الاختبار", revision: 2, createdAt: "2026-09-06T08:03:00.000Z", updatedAt: "2026-09-06T08:04:00.000Z", archivedAt: null, archivedByStaffId: null },
  ],
  latestAt: "2026-09-06T08:05:00.000Z",
  viewedAt: null,
  unreadCount: 2,
};
const serviceInstructions = {
  instructions: [
    { id: 41, bookingSource: "service", bookingId: 12, kind: "note", mediaUrl: null, caption: "تعليمات الخدمة الأصلية.", uploadedByStaffId: 2, uploadedByName: "مشرف الخدمة", revision: 1, createdAt: "2026-09-06T09:00:00.000Z", updatedAt: "2026-09-06T09:00:00.000Z", archivedAt: null, archivedByStaffId: null },
  ],
  latestAt: "2026-09-06T09:00:00.000Z",
  viewedAt: null,
  unreadCount: 1,
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "ajn_admin_session", value: "staff-instruction-fixture", url: origin }]);
  const page = await context.newPage();
  const errors = [];
  const instructionGets = [];
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
    if (path.endsWith("/staff/koshas/bookings") && request.method() === "GET") return route.fulfill({ json: [nativeBooking, serviceBooking] });
    for (const value of [nativeBooking, serviceBooking]) {
      const detailPath = `/staff/koshas/bookings/${value.id}`;
      if (path.endsWith(`${detailPath}/instructions/viewed`)) {
        viewed.push({ id: value.id, source: url.searchParams.get("source"), body: request.postDataJSON() });
        if (value.source === "kosha" && failNativeViewed) {
          failNativeViewed = false;
          return route.fulfill({ status: 500, json: { error: { message: "تعذر تسجيل القراءة التجريبية", code: "TEST_ERROR" } } });
        }
        return route.fulfill({ json: { viewedAt: request.postDataJSON().viewedThrough } });
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
  await page.route("**/uploads/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzp7wAAAABJRU5ErkJggg==", "base64") }));

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
  assert.deepEqual(viewed, [{ id: 11, source: "kosha", body: { viewedThrough: nativeInstructions.latestAt } }], "Failed acknowledgement uses only the rendered native snapshot");
  await page.getByRole("button", { name: "إعادة تسجيل القراءة", exact: true }).click();
  await page.getByText("تم تسجيل قراءة التعليمات", { exact: true }).waitFor();
  assert.deepEqual(viewed.slice(0, 2), [
    { id: 11, source: "kosha", body: { viewedThrough: nativeInstructions.latestAt } },
    { id: 11, source: "kosha", body: { viewedThrough: nativeInstructions.latestAt } },
  ], "Retry resends the captured snapshot exactly");
  assert.equal(await page.getByText("تعليمات الإدارة • 2 جديد", { exact: true }).count(), 0, "Unread badge clears only after acknowledgement succeeds");

  await page.getByRole("button", { name: "تكبير صورة تعليمات الإدارة: القوس الأبيض", exact: true }).click();
  await page.getByRole("dialog", { name: "عارض صور تعليمات الإدارة" }).waitFor();
  await page.getByText("القوس الأبيض", { exact: true }).last().waitFor();
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
  assert.deepEqual(viewed.find((entry) => entry.id === 12), { id: 12, source: "service", body: { viewedThrough: serviceInstructions.latestAt } }, "Service acknowledgement uses its rendered snapshot");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile staff detail must not overflow horizontally");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: staff manager instructions — native/service identity, unread failure/retry, mobile order and RTL viewer keyboard navigation");
} finally {
  await browser.close();
}
