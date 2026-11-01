/** The attendance rules with no database: QR, GPS, schedules, day status, worked minutes and payroll figures. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QR_GRACE_SECONDS,
  QR_ROTATION_SECONDS,
  addDays,
  baghdadDate,
  baghdadMoment,
  baghdadTime,
  checkGps,
  dayStatusFor,
  expectedShiftsFor,
  fixedShiftFor,
  haversineMeters,
  methodSteps,
  nonOverlappingSessions,
  resolveMethod,
  shiftAdherence,
  toMs,
  workedMinutes,
  type ExpectedShift,
} from "../src/lib/attendance-rules";
import { issueKioskCode, newKioskDeviceToken, newKioskSecret, parseKioskCode, qrWindow, sha256, verifyKioskCode } from "../src/server/attendance-qr";
import { calculateAttendancePayroll, normalizeAttendancePolicy } from "../src/server/attendance-payroll";

// ─── Baghdad clock ───────────────────────────────────────────
assert.equal(baghdadDate(new Date("2026-10-29T21:30:00Z")), "2026-10-30", "the Baghdad date moves at Baghdad midnight, not UTC");
assert.equal(baghdadMoment("2026-10-30", "09:00").toISOString(), "2026-10-30T06:00:00.000Z");
assert.equal(baghdadTime("2026-10-30 06:05:00"), "09:05", "a naive database timestamp is UTC");
assert.equal(toMs("2026-10-30 06:05:00"), Date.parse("2026-10-30T06:05:00Z"));
assert.equal(toMs(null), null);
assert.equal(toMs(Date.parse("2026-10-30T06:05:00Z")), Date.parse("2026-10-30T06:05:00Z"), "the API sends times as numbers");
assert.equal(baghdadTime(Date.parse("2026-10-30T06:05:00Z")), "09:05", "and the screens must show them");
assert.equal(toMs(Number.NaN), null);
assert.equal(addDays("2026-12-31", 1), "2027-01-01");

// ─── Rotating QR ─────────────────────────────────────────────
const secret = newKioskSecret();
const at = Date.parse("2026-10-30T06:00:10Z");
const issued = issueKioskCode(7, secret, at);
const parsed = parseKioskCode(issued.code)!;
assert.ok(parsed, "a code from the kiosk parses");
assert.equal(parsed.kioskId, 7);
assert.ok(!/staff|employee|name/i.test(issued.code), "a code carries no employee data");
assert.equal(issued.rotatesAt, (qrWindow(at) + 1) * QR_ROTATION_SECONDS * 1000, "the kiosk knows when to rotate");
assert.equal(parseKioskCode(`https://example.test/staff?attendanceQr=${encodeURIComponent(issued.code)}`)?.signature, parsed.signature, "the link inside the QR reads the same");

const live = verifyKioskCode(parsed, secret, at);
assert.equal(live.ok, true, "a live code is accepted");
if (live.ok) assert.equal(live.tokenHash, sha256(issued.code));
assert.equal(verifyKioskCode(parsed, secret, issued.rotatesAt + (QR_GRACE_SECONDS - 1) * 1000).ok, true, "a scan in progress survives the rotation by the grace period");
const expired = verifyKioskCode(parsed, secret, issued.rotatesAt + QR_GRACE_SECONDS * 1000);
assert.equal(expired.ok, false, "a screenshot stops working after the window and the grace");
if (!expired.ok) assert.match(expired.reason, /انتهت صلاحية/);
assert.equal(verifyKioskCode(parsed, secret, at - 60_000).ok, false, "a code from the future is refused");
assert.equal(verifyKioskCode(parsed, newKioskSecret(), at).ok, false, "another kiosk's secret does not verify");
const flipped = parsed.signature[0] === "A" ? `B${parsed.signature.slice(1)}` : `A${parsed.signature.slice(1)}`;
assert.equal(verifyKioskCode({ ...parsed, signature: flipped }, secret, at).ok, false, "a changed signature is refused");
assert.equal(verifyKioskCode({ ...parsed, kioskId: 8 }, secret, at).ok, false, "a code cannot move to another kiosk");
assert.equal(verifyKioskCode({ ...parsed, window: parsed.window + 40 }, secret, at).ok, false, "a window cannot be moved forward");
for (const bad of [null, undefined, 12, "", "hello", "AJN1.7.1.short", "AJN2.7.1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", `AJN1.0.1.${"a".repeat(32)}`, "x".repeat(500)])
  assert.equal(parseKioskCode(bad), null, `a malformed code is refused: ${String(bad).slice(0, 20)}`);
assert.notEqual(newKioskDeviceToken(), newKioskDeviceToken(), "device tokens are random");

// ─── GPS ─────────────────────────────────────────────────────
const shop = { latitude: 34.888, longitude: 44.633, radiusMeters: 100, maxAccuracyMeters: 50 };
const near = { latitude: 34.8884, longitude: 44.633, accuracy: 20 };
const nearCheck = checkGps(near, shop);
assert.equal(nearCheck.ok, true, "inside the radius passes");
if (nearCheck.ok) assert.ok(nearCheck.distance > 30 && nearCheck.distance < 60, `distance is measured: ${nearCheck.distance}`);
const far = checkGps({ latitude: 34.9, longitude: 44.633, accuracy: 10 }, shop);
assert.equal(far.ok, false, "outside the radius fails");
if (!far.ok) assert.equal(far.reason, "أنت خارج نطاق موقع العمل المسموح.", "the exact message in the requirement");
const blurry = checkGps({ ...near, accuracy: 200 }, shop);
assert.equal(blurry.ok, false, "poor accuracy fails even inside the radius");
if (!blurry.ok) assert.match(blurry.reason, /دقة تحديد الموقع ضعيفة/);
assert.equal(checkGps(null, shop).ok, false, "no position fails");
assert.equal(checkGps({ latitude: 95, longitude: 44, accuracy: 5 }, shop).ok, false, "impossible coordinates fail");
assert.equal(checkGps({ ...near, accuracy: 0 }, shop).ok, false, "a zero accuracy is not believed");
assert.equal(checkGps(near, { ...shop, latitude: null, longitude: null }).ok, false, "a location with no coordinates cannot verify anyone");
assert.ok(Math.abs(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111_195) < 50, "haversine distance");

// ─── Method policy ───────────────────────────────────────────
assert.deepEqual(methodSteps("qr_gps"), { qr: true, gps: true, manual: false }, "QR + GPS needs both");
assert.deepEqual(methodSteps("qr"), { qr: true, gps: false, manual: false });
assert.deepEqual(methodSteps("gps"), { qr: false, gps: true, manual: false });
assert.deepEqual(methodSteps("manual"), { qr: false, gps: false, manual: true });
assert.equal(resolveMethod({ isEvent: true, eventMethod: "gps", employeeMethod: "qr_gps" }), "gps", "employee D: GPS for events");
assert.equal(resolveMethod({ isEvent: false, eventMethod: "gps", employeeMethod: "qr_gps" }), "qr_gps", "employee D: QR + GPS at the warehouse");
assert.equal(resolveMethod({ shiftMethod: "qr", isEvent: true, eventMethod: "gps", employeeMethod: "qr_gps" }), "qr", "this shift's rule wins");
assert.equal(resolveMethod({ locationMethod: "gps" }), "gps", "the location is the last rule");
assert.equal(resolveMethod({ employeeMethod: "nonsense" }), "qr_gps", "an unknown method falls to the strictest");

// ─── Schedules ───────────────────────────────────────────────
const schedule = { scheduleType: "fixed", shiftStart: "09:00", shiftEnd: "17:00", weeklyDaysOff: ["fri"], graceMinutes: 10, holidays: ["2026-11-01"] };
assert.ok(fixedShiftFor("2026-10-29", schedule), "a Thursday is a work day");
assert.equal(fixedShiftFor("2026-10-30", schedule), null, "the rest day expects nobody");
assert.equal(fixedShiftFor("2026-11-01", schedule), null, "a holiday expects nobody");
assert.equal(fixedShiftFor("2026-10-29", { ...schedule, scheduleType: "flexible" }), null, "a flexible employee has no fixed shift");
assert.equal(fixedShiftFor("2026-10-29", { ...schedule, scheduleType: "event" }), null, "an events employee has no fixed shift");
const night = fixedShiftFor("2026-10-29", { ...schedule, shiftStart: "22:00", shiftEnd: "06:00" })!;
assert.equal(night.endMs - night.startMs, 8 * 3_600_000, "an overnight shift ends the next morning");

const shiftAt = (date: string, start: string, end: string, extra: Partial<ExpectedShift> = {}): ExpectedShift => {
  const startMs = baghdadMoment(date, start).getTime();
  let endMs = baghdadMoment(date, end).getTime();
  if (endMs <= startMs) endMs += 86_400_000;
  return { shiftId: 1, startMs, endMs, graceMinutes: 10, kind: "rotating", locationId: null, requiredMethod: null, title: null, bookingSource: null, bookingId: null, ...extra };
};
assert.equal(expectedShiftsFor("2026-10-30", schedule, [shiftAt("2026-10-30", "10:00", "14:00")]).length, 1, "a shift row on a rest day counts");
assert.equal(expectedShiftsFor("2026-10-30", schedule, []).length, 0, "a rest day with no row expects nobody");
assert.deepEqual(expectedShiftsFor("2026-10-29", schedule, [shiftAt("2026-10-29", "18:00", "20:00", { shiftId: 2 }), shiftAt("2026-10-29", "08:00", "10:00", { shiftId: 3 })]).map((row) => row.shiftId), [3, 2], "multiple shifts in order");

// ─── Day status ──────────────────────────────────────────────
const dayShift = shiftAt("2026-10-29", "09:00", "17:00");
const clock = (time: string) => baghdadMoment("2026-10-29", time).getTime();
const status = (nowMs: number, sessions: Array<{ startMs: number; endMs: number | null; isEvent?: boolean }>, expected: ExpectedShift[] = [dayShift], extra: { onLeave?: boolean; isRestDay?: boolean } = {}) =>
  dayStatusFor({ nowMs, expected, sessions, onLeave: extra.onLeave ?? false, isRestDay: extra.isRestDay ?? false });
assert.equal(status(clock("08:00"), []), "not_started");
assert.equal(status(clock("09:05"), []), "not_started", "inside the grace period is not absent yet");
assert.equal(status(clock("09:30"), []), "absent", "after the grace with no check-in");
assert.equal(status(clock("09:30"), [], [], { isRestDay: true }), "rest", "a rest day is not an absence");
assert.equal(status(clock("09:30"), [], []), "not_scheduled", "no schedule is not an absence");
assert.equal(status(clock("09:30"), [], [dayShift], { onLeave: true }), "leave", "approved leave is not an absence");
assert.equal(status(clock("10:00"), [{ startMs: clock("09:00"), endMs: null }]), "present");
assert.equal(status(clock("10:00"), [{ startMs: clock("09:30"), endMs: null }]), "late");
assert.equal(status(clock("10:00"), [{ startMs: clock("09:00"), endMs: null, isEvent: true }]), "mission");
assert.equal(status(clock("12:00"), [{ startMs: clock("09:00"), endMs: clock("11:00") }]), "on_break", "checked out with the shift still running");
assert.equal(status(clock("18:00"), [{ startMs: clock("09:00"), endMs: clock("17:00") }]), "out");

// ─── Worked minutes: no double counting ──────────────────────
assert.equal(workedMinutes([{ startMs: clock("09:00"), endMs: clock("11:00") }, { startMs: clock("10:00"), endMs: clock("12:00") }]), 180, "overlapping sessions count each minute once");
assert.equal(workedMinutes([{ startMs: clock("09:00"), endMs: clock("17:00") }, { startMs: clock("10:00"), endMs: clock("11:00") }]), 480, "a session inside another adds nothing");
assert.equal(workedMinutes([{ startMs: clock("09:00"), endMs: clock("10:00") }, { startMs: clock("12:00"), endMs: clock("13:00") }]), 120, "separate sessions add up");
assert.equal(workedMinutes([{ startMs: clock("09:00"), endMs: null }]), 0, "a missing check-out is not a full shift");
assert.equal(nonOverlappingSessions([{ startMs: 200, endMs: 300 }, { startMs: 100, endMs: 250 }]).at(-1)?.effectiveStartMs, 250, "clipping follows time order");
assert.deepEqual(shiftAdherence(dayShift, [{ startMs: clock("09:25"), endMs: clock("16:30") }]), { lateMinutes: 15, earlyMinutes: 30 }, "late after grace, early against the end");
assert.deepEqual(shiftAdherence(dayShift, [{ startMs: clock("09:05"), endMs: null }]), { lateMinutes: 0, earlyMinutes: 0 }, "no early leaving is invented for a missing check-out");
const nightShift = shiftAt("2026-10-29", "22:00", "06:00");
assert.deepEqual(shiftAdherence(nightShift, [{ startMs: baghdadMoment("2026-10-29", "22:30").getTime(), endMs: baghdadMoment("2026-10-30", "05:00").getTime() }]), { lateMinutes: 20, earlyMinutes: 60 }, "an overnight shift is measured across midnight");

// ─── Payroll figures ─────────────────────────────────────────
const base = {
  periodStart: "2026-10-26", periodEnd: "2026-10-26", baseSalary: 600_000, dailyWorkingHours: 8, workingDaysPerWeek: 6, weeklyDaysOff: ["fri"], shiftStart: "09:00", shiftEnd: "17:00",
  overtimeRate: 3_000, lateDeductionRate: 100, absenceDeductionRate: 20_000,
  policy: { lateGraceMinutes: 10, lateDeductionRule: "per_minute" as const, absenceDeductionRule: "fixed_per_day" as const },
};
const iso = (date: string, time: string) => baghdadMoment(date, time).toISOString();
const record = (date: string, inAt: string, outAt: string | null, extra: Record<string, unknown> = {}) => ({ status: "out", checkInAt: iso(date, inAt), checkOutAt: outAt ? iso(date, outAt) : null, ...extra });
const legacy = calculateAttendancePayroll({ ...base, records: [] });
assert.equal(legacy.absenceDays, 1, "an employee off this system keeps the old absence rule");
const asOf = calculateAttendancePayroll({ ...base, records: [], asOfDate: "2026-10-26" });
assert.equal(asOf.absenceDays, 0, "today is not an absence before the day is over");
assert.equal(asOf.absenceDeduction, 0);
const eventsOnly = calculateAttendancePayroll({ ...base, records: [], scheduleMode: "shifts_only" });
assert.equal(eventsOnly.scheduledWorkingDays, 0, "a shifts-only employee has no day without a shift");
assert.equal(eventsOnly.absenceDays, 0, "and is not absent on it");
const shift = shiftAt("2026-10-26", "12:00", "18:00");
const shifted = calculateAttendancePayroll({ ...base, scheduleMode: "shifts_only", shifts: [{ date: "2026-10-26", startMs: shift.startMs, endMs: shift.endMs, graceMinutes: 10 }], records: [record("2026-10-26", "12:30", "18:00")] });
assert.equal(shifted.scheduledWorkingDays, 1, "the shift day is scheduled");
assert.equal(shifted.lateMinutes, 20, "lateness follows the shift, not the weekly pattern");
assert.equal(shifted.workedHours, 5.5);
const overlap = calculateAttendancePayroll({ ...base, records: [record("2026-10-26", "09:00", "13:00"), record("2026-10-26", "12:00", "17:00")] });
assert.equal(overlap.workedHours, 8, "overlapping records do not double the hours");
assert.equal(overlap.overtimeHours, 0, "and do not invent overtime");
const missing = calculateAttendancePayroll({ ...base, records: [record("2026-10-26", "09:00", null, { status: "present" })] });
assert.equal(missing.workedHours, 0, "a missing check-out pays no hours");
assert.equal(missing.missingCheckOut, 1);
const overnightRun = calculateAttendancePayroll({ ...base, shiftStart: "22:00", shiftEnd: "06:00", records: [{ status: "out", checkInAt: iso("2026-10-26", "22:00"), checkOutAt: iso("2026-10-27", "06:00") }] });
assert.equal(overnightRun.workedHours, 8, "overnight hours");
assert.equal(overnightRun.lateMinutes, 0, "overnight on time");
assert.equal(overnightRun.earlyLeaveMinutes, 0, "overnight leaves on time");
const overtime = (policy: Record<string, unknown>, approved: number | null) => calculateAttendancePayroll({ ...base, policy: { ...base.policy, ...policy }, records: [record("2026-10-26", "09:00", "19:00", { overtimeApprovedMinutes: approved })] }).overtimeHours;
assert.equal(overtime({}, null), 2, "overtime keeps counting by default");
assert.equal(overtime({ overtimeRequiresApproval: true }, null), 0, "with approval on, nothing counts before approval");
assert.equal(overtime({ overtimeRequiresApproval: true }, 60), 1, "only the approved part counts");
assert.equal(overtime({ overtimeRequiresApproval: true }, 600), 2, "approval cannot exceed the time worked");
const policy = normalizeAttendancePolicy({});
assert.equal(policy.overtimeRequiresApproval, false, "an existing policy keeps its behaviour");
assert.equal(policy.locationRetentionDays, 90);
assert.equal(normalizeAttendancePolicy({ locationRetentionDays: 0 }).locationRetentionDays, 1, "coordinates cannot be kept for less than a day or forever");

// ─── Wiring and limits that matter to the owner ──────────────
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const server = read("src/server/attendance.ts");
assert.ok(!/financial_transactions|cash_box|cashbox/i.test(server), "attendance never touches cash or the ledger");
assert.ok(!/payroll_payments|payroll_lines/i.test(server), "attendance never writes payroll lines or payments");
const migration = read("lib/db/migrations/0133_attendance_system.sql");
assert.ok(!/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migration), "the migration is additive");
assert.ok(/WHERE "check_out_at" IS NULL AND "method" IS NOT NULL/i.test(migration), "legacy open rows cannot break the one-open-session index");
const center = read("src/views/admin/attendance-center.tsx");
assert.match(center, /لا توجد أجهزة مرتبطة حالياً\./, "biometric section shows the honest empty state");
for (const tab of ["لوحة الحضور", "سجل الدوام", "الورديات", "مواقع العمل", "شاشة QR", "طلبات التصحيح", "التقارير", "الإعدادات"]) assert.ok(center.includes(tab), `tab ${tab}`);
const kiosk = read("src/views/attendance-kiosk.tsx");
assert.ok(!/staffName|employeeName|fullName|salary/i.test(kiosk), "the public kiosk shows nothing about employees");
const card = read("src/components/attendance-today-card.tsx");
assert.ok(!/watchPosition/.test(card), "location is read once at the event; no continuous tracking");
assert.match(read("src/views/staff/unified-portal.tsx"), /<AttendanceTodayCard \/>/, "the card sits in the existing staff portal");
assert.match(read("src/views/admin/employee-salaries.tsx"), /ملخص الحضور والانصراف/, "payroll shows the summary");
assert.match(read("src/views/admin/staff.tsx"), /<AttendanceSettingsPanel staffId=\{editing\.id\} \/>/, "the employee profile holds the settings");
assert.match(read("src/views/admin/booking-operations-workspace.tsx"), /<BookingAttendancePanel /, "the booking holds its attendance tab");
const app = read("src/App.tsx");
assert.ok(app.indexOf('"/attendance-kiosk/:token"') > 0 && app.indexOf('"/attendance-kiosk/:token"') < app.indexOf("Customer routes wrapped in Layout"), "the kiosk is public and has no site navigation");
const headers = read("next.config.mjs");
assert.match(headers, /camera=\(self\), microphone=\(\), geolocation=\(self\), payment=\(\)/, "GPS and QR need the browser policy to allow this origin, and only this origin");
const api = read("src/server/api.ts");
assert.match(api, /if \(\(await readEmployeeSettings\(db as any, auth\.id\)\)\.enabled\)\n\s+return error\("سجّل من «دوامي اليوم»/, "the old self check-in has no way around verification");
assert.match(api, /action: "attendance-punch"/, "check-in is rate limited");
assert.match(api, /normalizeAttendancePolicy\(\{ \.\.\.previous, \.\.\.\(await body\(req\)\) \}\)/, "a partial policy save keeps the other rules");
assert.equal(api.match(/sweepLocationEvidence\(db/g)?.length, 1, "coordinates age out in one place");
assert.match(api, /parts\[1\] === "smart-notifications"[\s\S]{0,700}sweepLocationEvidence\(db/, "the daily cron enforces location retention, so a dashboard GET writes nothing");
assert.match(read("src/components/booking-attendance-panel.tsx"), /\/admin\/attendance\/booking-team\?/, "an attendance manager sees the team without booking-assignment rights");
assert.match(read("src/views/admin/attendance-center.tsx"), /XLSX\.writeFile\(workbook, `attendance-/, "the report's Excel button gives a real workbook");

console.log("attendance rules passed");
