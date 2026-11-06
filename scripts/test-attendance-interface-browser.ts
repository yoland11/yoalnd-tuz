/** Real attendance components + synthetic HTTP only. Never connects to a database. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { issueKioskCode } from "../src/server/attendance-qr";

assert.ok(process.env.AJN_BROWSER_RUNTIME, "Set AJN_BROWSER_RUNTIME to installed Playwright package.json");
const { chromium } = createRequire(process.env.AJN_BROWSER_RUNTIME!)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = (await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") })).css;
const javascript = (await esbuild.build({ stdin: {
  contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClientProvider} from '@tanstack/react-query';import {Router} from 'wouter';import {queryClient} from './src/lib/query-client';import {TooltipProvider} from './src/components/ui/tooltip';import {Toaster} from './src/components/ui/toaster';import UnifiedStaffPortal from './src/views/staff/unified-portal';import {AttendanceCenter} from './src/views/admin/attendance-center';queryClient.setDefaultOptions({queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><Router><TooltipProvider>{location.pathname.startsWith('/admin/')?<AttendanceCenter policyEditor={<p>السياسة الحالية</p>}/>:<UnifiedStaffPortal/>}<Toaster/></TooltipProvider></Router></QueryClientProvider>);`,
  resolveDir: process.cwd(), loader: "tsx",
}, bundle: true, write: false, outdir: ".next/attendance-interface-bundle", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } })).outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "application/javascript" : req.url === "/fixture.css" ? "text/css" : "text/html;charset=utf-8");
  res.end(req.url === "/fixture.js" ? javascript : req.url === "/fixture.css" ? css : '<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
await mkdir(".next/cache/attendance-interface-review", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AJN_BROWSER_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const now = Date.parse("2026-11-04T06:30:00Z"), date = "2026-11-04";
const { code: qrCode } = issueKioskCode(1, "attendance-interface-fixture-only", now);
const position = { latitude: 33.3, longitude: 44.4, accuracy: 10 };
const shift = { shiftId: 6, startMs: now - 1800000, endMs: now + 27000000, kind: "fixed", title: null, bookingSource: null, bookingId: null, locationName: "المكتب الرئيسي" };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "America/Los_Angeles" });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors: string[] = [], unexpected: string[] = [], writes: any[] = [], reads: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    let failMe = true, checkedIn = false, checkedOut = false, enabled = true, manager = true, rejectPunch = false, failDashboard = false, signedIn = true;
    let canViewGeofence = true, failGeofence = false, consented = false;
    const geofenceWrites: unknown[] = [];
    const visits = [
      { id: 44, staffId: 8, staffName: "أحمد محمد", workplace: "المكتب الرئيسي", exitAt: now, returnAt: null, endedAt: now + 600_000, outsideSeconds: 510, verification: "interrupted", reviewStatus: "pending" },
      { id: 45, staffId: 9, staffName: "مريم علي", workplace: "المكتب الرئيسي", exitAt: now, returnAt: null, endedAt: null, outsideSeconds: 300, verification: "interrupted", reviewStatus: "pending" },
    ];
    const exceptions: Array<{ id: number; staffId: number; staffName: string; kind: string; startsAt: number; endsAt: number; reason: string; revokedAt: number | null }> = [];
    let mode: "any" | "qr" | "gps" | "manual" = "any";
    const leaveTimestamp = Date.parse("2026-11-02T12:00:00Z");
    const recent = [{ id: 12, name: "أحمد محمد", checkInMs: now - 86400000, checkOutMs: now - 86400000 + 28800000, workedMinutes: 480, method: "qr", status: "out", locationName: "المكتب الرئيسي" }, { id: 11, name: "أحمد محمد", checkInMs: leaveTimestamp, checkOutMs: leaveTimestamp, workedMinutes: 0, method: null, status: "paid_leave", locationName: null }];
    const effectiveShift = () => ({ ...shift, method: mode, needsQr: mode === "qr", needsGps: mode === "gps", manualOnly: mode === "manual", allowedMethods: mode === "any" ? ["qr", "gps", "qr_gps"] : [mode] });
    const employee = () => ({ enabled, employeeName: "أحمد محمد", date, serverTime: now, status: checkedOut ? "out" : checkedIn ? "present" : "scheduled", statusLabel: checkedOut ? "منصرف" : checkedIn ? "حاضر" : "بانتظار الحضور", workedMinutes: checkedOut ? 60 : 0, open: checkedIn && !checkedOut ? { id: 20, startMs: now } : null, shifts: enabled ? [effectiveShift()] : [], current: effectiveShift(), canCheckIn: enabled && !checkedIn, canCheckOut: checkedIn && !checkedOut, recent, corrections: [{ id: 2, workDate: "2026-11-02", requestType: "forgot_check_out", status: "pending" }] });
    const rows = [{ staffId: 8, name: "أحمد محمد", department: "فريق الكوشات", photoUrl: null, locationName: "المكتب الرئيسي", shiftStartMs: now - 1800000, shiftEndMs: now + 27000000, checkInMs: now, checkOutMs: null, workedMinutes: 0, method: "qr", status: "present", statusLabel: "حاضر", isLate: false, missingCheckOut: false, bookingId: null, bookingSource: null }];
    await page.addInitScript((coords: typeof position) => {
      const gps = window as Window & { __gpsReads: number; __gpsAllowed: boolean };
      gps.__gpsReads = 0;
      gps.__gpsAllowed = true;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition() { throw new Error("Employee web must never track location continuously"); },
          getCurrentPosition(success: PositionCallback, failure: PositionErrorCallback) {
            gps.__gpsReads++;
            if (gps.__gpsAllowed) success({ coords } as GeolocationPosition);
            else failure({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
          },
        },
      });
    }, position);
    await page.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route("**/api/**", async (route: any) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (req.method() === "GET") reads.push(path);
      if (path === "/api/admin/auth/login") { assert.equal(req.method(), "POST"); signedIn = true; return route.fulfill({ json: { user: { id: 8, username: "employee", fullName: "أحمد محمد", role: "staff", permissions: [], isActive: true } } }); }
      if (path === "/api/admin/auth/me") return route.fulfill({ json: { user: signedIn ? { id: 8, username: "employee", fullName: "أحمد محمد", role: "staff", permissions: [], isActive: true } : null } });
      if (path === "/api/staff/portal/dashboard") return route.fulfill({ json: { staff: { id: 8, name: "أحمد محمد" }, summary: { todayTasks: 0, overdueTasks: 0 }, tasks: [], today: date, attendance: null } });
      if (["/api/staff/portal/bookings", "/api/staff/portal/notifications"].includes(path)) return route.fulfill({ json: { today: date, data: [] } });
      if (path === "/api/staff/portal/salary") return route.fulfill({ json: { current: null, data: [] } });
      if (path === "/api/admin/customer-followups/summary") {
        assert.equal(req.method(), "GET");
        assert.equal(url.searchParams.get("scope"), "mine");
        return route.fulfill({ json: { summary: { today: 0, overdue: 0, upcoming: 0, converted: 0, total: 0, completed: 0 } } });
      }
      if (path === "/api/admin/attendance/me") return failMe ? route.fulfill({ status: 503, json: { code: "DATABASE_ERROR", message: "تعذر قراءة سجل الحضور", requestId: "REQ-attendance" } }) : route.fulfill({ json: employee() });
      if (path === "/api/admin/attendance/punch") {
        assert.equal(req.method(), "POST"); const input = req.postDataJSON(); writes.push(input);
        assert.ok(!("staffId" in input) && !("atMs" in input), "identity and punch time come from the original server");
        assert.equal(input.shiftId, shift.shiftId, "the displayed shift is sent for verification");
        if (mode === "qr") {
          assert.equal(input.qrCode, qrCode);
          assert.equal(input.gps, null);
        } else {
          assert.deepEqual(Object.keys(input).sort(), ["action", "gps", "shiftId"]);
          assert.deepEqual(input.gps, position);
        }
        if (rejectPunch) return route.fulfill({ status: 409, json: { code: "ATTENDANCE_REJECTED", message: "رمز الحضور غير صالح" } });
        if (input.action === "check_in") checkedIn = true; else checkedOut = true;
        const { recent: _recent, corrections: _corrections, ...today } = employee();
        return route.fulfill({ json: { action: input.action, atMs: now, locationName: "المكتب الرئيسي", today } });
      }
      if (path === "/api/admin/attendance/geofence") return failGeofence
        ? route.fulfill({ status: 503, json: { code: "DATABASE_ERROR", message: "تعذر تحميل حالة الموقع", requestId: "REQ-geofence" } })
        : route.fulfill({ json: { recordId: checkedIn ? 20 : null, eligible: checkedIn && !checkedOut, consented, status: consented ? "unavailable" : "inactive", workplace: checkedIn ? shift.locationName : null, startsAt: now, endsAt: shift.endMs } });
      if (path === "/api/admin/attendance/geofence/consent") {
        const input = req.postDataJSON();
        assert.equal(req.method(), "POST");
        assert.deepEqual(input, { recordId: 20, consent: false });
        geofenceWrites.push(input);
        consented = false;
        return route.fulfill({ json: { recordId: 20, eligible: true, consented, status: "inactive", workplace: shift.locationName, startsAt: now, endsAt: shift.endMs } });
      }
      if (path === "/api/admin/attendance/geofence/dashboard") {
        assert.ok(canViewGeofence, "dashboard location data is never requested without permission");
        assert.ok(url.searchParams.get("date"));
        return failGeofence
          ? route.fulfill({ status: 503, json: { code: "DATABASE_ERROR", message: "تعذر تحميل حالة الموقع", requestId: "REQ-geofence" } })
          : route.fulfill({ json: { statuses: [{ staffId: 8, recordId: 20, status: "outside", workplace: shift.locationName }], visits, exceptions } });
      }
      if (path === "/api/admin/attendance/geofence/visits/44/review") {
        assert.equal(req.method(), "POST");
        const input = req.postDataJSON();
        assert.deepEqual(input, { approved: true, note: "راجعت سجل الوردية" });
        geofenceWrites.push(input);
        visits[0].reviewStatus = "approved";
        return route.fulfill({ json: { success: true } });
      }
      if (path === "/api/admin/attendance/geofence/exceptions") {
        assert.equal(req.method(), "POST");
        const input = req.postDataJSON();
        assert.deepEqual(input, { staffId: 8, kind: "delivery", startsAt: Date.parse("2026-11-04T09:00:00Z"), endsAt: Date.parse("2026-11-04T10:00:00Z"), reason: "تسليم طلب" });
        geofenceWrites.push(input);
        exceptions.push({ ...input, id: 91, staffName: "أحمد محمد", revokedAt: null });
        return route.fulfill({ json: { success: true } });
      }
      if (path === "/api/admin/attendance/geofence/exceptions/91/revoke") {
        assert.equal(req.method(), "POST");
        exceptions[0].revokedAt = now;
        return route.fulfill({ json: { success: true } });
      }
      if (path === "/api/admin/attendance/options") return route.fulfill({ json: { locations: [], staff: [{ id: 8, fullName: "أحمد محمد", department: "فريق الكوشات" }], capabilities: { canManage: manager, canApprove: manager, canManagePolicy: manager, canViewLocation: false, canViewGeofence, canManageGeofence: manager, canReviewGeofence: manager }, policy: {} } });
      if (path === "/api/admin/attendance/dashboard") return failDashboard ? route.fulfill({ status: 503, json: { code: "DATABASE_ERROR", message: "تعذر تحميل حضور الموظفين" } }) : route.fulfill({ json: { date: url.searchParams.get("date"), serverTime: now, summary: { total: 1, presentNow: 1, late: 0, absent: 0, out: 0, mission: 0, onLeave: 0, scheduled: 1 }, rows: url.searchParams.get("search") === "لا يوجد" ? [] : rows, departments: ["فريق الكوشات"], locations: [] } });
      unexpected.push(path); return route.fulfill({ status: 403, json: { code: "FORBIDDEN", message: "Unconfigured endpoint" } });
    });
    await page.goto(`${origin}/staff?tab=attendance`);
    await page.getByRole("heading", { name: "حضوري", exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "تعذر قراءة سجل الحضور" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "تسجيل حضور", exact: true }).count(), 0, "failure is not empty attendance");
    failMe = false;
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
    await page.getByRole("heading", { name: "سجل حضوري", exact: true }).waitFor();
    await page.getByText("2026-11-03", { exact: true }).waitFor();
    const leave = page.getByRole("region", { name: "سجل حضوري", exact: true }).getByRole("listitem").filter({ hasText: "إجازة مدفوعة" });
    await leave.waitFor();
    assert.ok(!(await leave.innerText()).includes("15:00"), "approved leave synthetic timestamp is not an attendance punch");
    const attendanceRefresh = page.waitForResponse((response: any) => response.url().endsWith("/api/admin/attendance/me"));
    await page.getByRole("button", { name: "تحديث دوامي", exact: true }).click();
    await attendanceRefresh;
    assert.equal(await page.getByRole("button", { name: "تسجيل انصراف", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "تسجيل حضور", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "تم تسجيل حضورك" }).first().waitFor();
    await page.getByRole("button", { name: "تسجيل انصراف", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "تم تسجيل انصرافك" }).first().waitFor();
    assert.deepEqual(writes.map(input => input.action), ["check_in", "check_out"]);
    assert.ok(!reads.some(path => path.endsWith("/options") || path.endsWith("/records") || path.endsWith("/dashboard") && path.includes("attendance")), "employee uses only their own attendance endpoint");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "staff no horizontal overflow");
    if (width < 1024) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = await page.getByText("آخر تحديث من النظام:", { exact: false }).boundingBox();
      const footer = await page.getByRole("navigation", { name: "أقسام بوابة الموظف" }).boundingBox();
      assert.ok(last && footer && last.y + last.height <= footer.y, "attendance history can be scrolled above mobile navigation");
    }
    await page.screenshot({ path: `.next/cache/attendance-interface-review/staff-${width}.png`, fullPage: true });
    checkedIn = false; checkedOut = false; mode = "qr"; rejectPunch = true;
    await page.goto(`${origin}/staff?tab=attendance&attendanceQr=${qrCode}`);
    await page.getByText("تمت قراءة رمز الحضور. اختر حضور أو انصراف.", { exact: true }).waitFor();
    assert.equal(writes.length, 2, "loading a valid QR link never punches automatically");
    assert.equal(await page.evaluate(() => (window as any).__gpsReads), 0, "QR-only verification never requests GPS");
    assert.equal(new URL(page.url()).search, "?tab=attendance", "the QR is removed without discarding the selected tab");
    await page.getByRole("button", { name: "تسجيل حضور", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "رمز الحضور غير صالح" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "تسجيل انصراف", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("status").filter({ hasText: "تم تسجيل حضورك" }).count(), 0, "rejected QR is never successful attendance");
    rejectPunch = false;
    await page.getByRole("button", { name: "تسجيل حضور", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "تم تسجيل حضورك" }).first().waitFor();
    assert.equal(writes.at(-1).qrCode, qrCode, "QR retry keeps the original scanned code");
    checkedIn = false; mode = "gps";
    await page.goto(`${origin}/staff?tab=attendance`);
    await page.evaluate(() => { (window as any).__gpsAllowed = false; });
    const beforeGps = writes.length;
    await page.getByRole("button", { name: "تسجيل حضور", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "اسمح للموقع" }).waitFor();
    assert.equal(writes.length, beforeGps, "GPS permission failure never submits a punch");
    await page.evaluate(() => { (window as any).__gpsAllowed = true; });
    await page.getByRole("button", { name: "تسجيل حضور", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "تم تسجيل حضورك" }).first().waitFor();
    assert.equal(await page.evaluate(() => (window as any).__gpsReads), 2, "GPS is requested only on the two explicit attempts");
    checkedIn = false; mode = "manual";
    await page.reload();
    const beforeManual = writes.length;
    await page.getByRole("button", { name: "تسجيل حضور", exact: true }).click();
    await page.getByRole("dialog", { name: "طلب تصحيح حضور" }).waitFor();
    assert.equal(writes.length, beforeManual, "manual attendance opens approval request, never direct punch");
    await page.getByRole("button", { name: "إلغاء", exact: true }).click();
    enabled = false; checkedIn = true; checkedOut = false;
    await page.reload();
    await page.getByText("تسجيل الحضور غير مفعّل لحسابك", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "تسجيل حضور", exact: true }).isEnabled(), false);
    assert.equal(await page.getByRole("button", { name: "تسجيل انصراف", exact: true }).isEnabled(), false, "disabled attendance cannot checkout despite a legacy open record");
    await page.getByRole("button", { name: "طلب تصحيح", exact: true }).click();
    await page.getByRole("dialog", { name: "طلب تصحيح حضور" }).waitFor();
    await page.getByRole("button", { name: "إلغاء", exact: true }).click();
    enabled = true; checkedIn = true; checkedOut = false; consented = true; failGeofence = true;
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "تعذر تحميل حالة الموقع" }).waitFor();
    assert.ok(await page.getByRole("button", { name: "تسجيل انصراف", exact: true }).isEnabled(), "geofence failure leaves ordinary checkout available");
    failGeofence = false;
    await page.getByRole("alert").filter({ hasText: "تعذر تحميل حالة الموقع" }).getByRole("button", { name: "إعادة المحاولة" }).click();
    await page.getByText("تعذر التحقق من الموقع", { exact: true }).waitFor();
    await page.getByRole("button", { name: "إيقاف متابعة موقعي" }).click();
    await page.getByText("أوقفت متابعة موقعك", { exact: true }).waitFor();
    assert.deepEqual(geofenceWrites, [{ recordId: 20, consent: false }]);
    assert.equal(await page.evaluate(() => (window as any).__gpsReads), 0, "geofence notice and revocation never request GPS");
    await page.goto(`${origin}/admin/attendance`);
    await page.getByRole("heading", { name: "الحضور والانصراف", exact: true }).waitFor();
    const list = width < 768 ? page.getByRole("list", { name: "حضور الموظفين" }) : page.getByRole("table").first();
    await list.getByText("أحمد محمد", { exact: true }).waitFor();
    await list.getByText("خارج نطاق العمل", { exact: true }).waitFor();
    failGeofence = true;
    await page.getByRole("button", { name: "تحديث الحضور", exact: true }).click();
    const geofenceError = page.getByRole("alert").filter({ hasText: "تعذر تحميل حالة الموقع" });
    await geofenceError.waitFor();
    await list.getByText("أحمد محمد", { exact: true }).waitFor();
    assert.equal(await list.getByText("خارج نطاق العمل", { exact: true }).count(), 0, "stale location is not shown when verification fails");
    failGeofence = false;
    await geofenceError.getByRole("button", { name: "إعادة المحاولة" }).click();
    await list.getByText("خارج نطاق العمل", { exact: true }).waitFor();
    await page.getByRole("button", { name: "تصفية إضافية", exact: true }).click();
    await page.getByLabel("طريقة التحقق", { exact: true }).waitFor();
    await page.getByRole("button", { name: "تحديث الحضور", exact: true }).click();
    await page.getByRole("searchbox", { name: "ابحث عن موظف", exact: true }).fill("لا يوجد");
    await page.getByText("لا يوجد موظفون يطابقون التصفية.", { exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "ابحث عن موظف", exact: true }).fill("");
    await list.getByText("أحمد محمد", { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "admin no horizontal overflow");
    await page.screenshot({ path: `.next/cache/attendance-interface-review/admin-${width}.png`, fullPage: true });
    failDashboard = true;
    await page.getByRole("button", { name: "تحديث الحضور", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "تعذر تحميل حضور الموظفين" }).waitFor();
    assert.equal(await page.getByText("لا يوجد موظفون يطابقون التصفية.", { exact: true }).count(), 0, "admin API failure is not empty employees");
    failDashboard = false;
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
    await list.getByText("أحمد محمد", { exact: true }).waitFor();
    const dayPicker = page.getByLabel("التاريخ", { exact: true });
    await dayPicker.fill("2026/11/04");
    await dayPicker.press("Tab");
    await page.getByRole("tab", { name: "نطاق العمل" }).click();
    assert.equal(await page.getByRole("tabpanel").locator('input[type="date"]').inputValue(), date, "geofence history uses the date selected on the daily dashboard");
    const visitHistory = page.getByRole("region", { name: "سجل الخروج والعودة" });
    const closedVisit = visitHistory.getByRole("listitem").filter({ hasText: "أحمد محمد" });
    const openVisit = visitHistory.getByRole("listitem").filter({ hasText: "مريم علي" });
    await closedVisit.getByText("وقت العودة غير معروف", { exact: true }).waitFor();
    await closedVisit.getByText("المدة المتحقق منها", { exact: true }).waitFor();
    await closedVisit.getByText("8 د 30 ث", { exact: true }).waitFor();
    await openVisit.getByText("تعذر التحقق من الموقع", { exact: true }).waitFor();
    await openVisit.getByText("وقت العودة غير معروف", { exact: true }).waitFor();
    await openVisit.getByText("5 د", { exact: true }).waitFor();
    assert.equal(await openVisit.getByText("خروج جارٍ", { exact: true }).count(), 0, "stale evidence does not confirm ongoing outside presence");
    await page.getByRole("button", { name: "مراجعة الخروج" }).click();
    const reviewDialog = page.getByRole("dialog", { name: "مراجعة الخروج" });
    await reviewDialog.getByLabel("ملاحظة المراجعة").fill("راجعت سجل الوردية");
    await reviewDialog.getByRole("button", { name: "اعتماد السجل" }).click();
    await page.getByText("معتمد في التقرير", { exact: true }).waitFor();
    await page.getByRole("button", { name: "إضافة إذن خروج" }).click();
    const exceptionDialog = page.getByRole("dialog", { name: "إضافة إذن خروج" });
    await exceptionDialog.getByLabel("الموظف", { exact: true }).selectOption("8");
    await exceptionDialog.getByLabel("نوع الإذن", { exact: true }).selectOption("delivery");
    await exceptionDialog.getByLabel("تاريخ البداية").fill("2026/11/04");
    await exceptionDialog.getByRole("group", { name: "بداية الإذن" }).getByLabel("الوقت").fill("12:00");
    await exceptionDialog.getByLabel("تاريخ النهاية").fill("2026/11/04");
    await exceptionDialog.getByRole("group", { name: "نهاية الإذن" }).getByLabel("الوقت").fill("13:00");
    await exceptionDialog.getByLabel("سبب الإذن").fill("تسليم طلب");
    await exceptionDialog.getByRole("button", { name: "حفظ الإذن" }).click();
    await page.getByText("تسليم طلب", { exact: true }).waitFor();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "geofence history has no horizontal overflow");
    await page.screenshot({ path: `.next/cache/attendance-interface-review/geofence-${width}.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "إلغاء الإذن", exact: true }).click();
    await page.getByRole("dialog", { name: "إلغاء الإذن" }).getByRole("button", { name: "تأكيد الإلغاء" }).click();
    await page.getByText("إذن ملغى", { exact: true }).waitFor();
    manager = false;
    visits[0].reviewStatus = "pending";
    await page.reload();
    await page.getByRole("heading", { name: "الحضور والانصراف", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "إعدادات أحمد محمد", exact: true }).count(), 0, "read-only viewer gets no employee settings action");
    await page.getByRole("tab", { name: "نطاق العمل" }).click();
    await closedVisit.getByText("بانتظار المراجعة", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "إضافة إذن خروج" }).count(), 0, "read-only geofence viewer cannot manage exceptions");
    assert.equal(await page.getByRole("button", { name: "مراجعة الخروج" }).count(), 0, "read-only geofence viewer cannot review visits");
    canViewGeofence = false;
    await page.reload();
    await page.getByRole("heading", { name: "الحضور والانصراف", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "نطاق العمل" }).count(), 0, "ordinary attendance access does not grant geofence visibility");
    signedIn = false;
    await page.goto(`${origin}/staff?tab=attendance`);
    await page.getByPlaceholder("اسم المستخدم", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/staff/login?tab=attendance", "login retains attendance destination");
    await page.getByPlaceholder("اسم المستخدم", { exact: true }).fill("employee");
    await page.getByPlaceholder("كلمة المرور", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
    await page.getByRole("heading", { name: "حضوري", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/staff?tab=attendance", "login returns to own attendance");
    await page.getByRole("button", { name: "مهامي", exact: true }).filter({ visible: true }).first().click();
    await page.getByRole("heading", { name: "مهامي", exact: true }).waitFor();
    await page.getByRole("button", { name: "حضوري", exact: true }).filter({ visible: true }).first().click();
    await page.getByRole("heading", { name: "سجل حضوري", exact: true }).waitFor();
    await page.goto(`${origin}/staff`);
    await page.getByRole("button", { name: "سجل حضوري وطلبات التصحيح", exact: true }).click();
    await page.getByRole("region", { name: "سجل حضوري", exact: true }).waitFor();
    assert.equal(await page.getByRole("region", { name: "سجل حضوري", exact: true }).count(), 1);
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`PASS attendance ${width}: self scope, punches, geofence failure/retry and revocation, visits and review, Baghdad exception times, read-only permissions, mobile clearance, RTL overflow`);
    await context.close();
  }
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
