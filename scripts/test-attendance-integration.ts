/**
 * Real PostgreSQL proof of attendance. Runs only in an isolated TEST database.
 * The attendance paths run in a transaction that is rolled back. Payroll uses its own connection, so
 * that part commits rows stamped for this run and removes exactly those rows afterwards.
 */
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true" || !url) {
  console.log("SKIPPED attendance PostgreSQL integration: needs AJN_ENV=test, ALLOW_TEST_WRITES=true and TEST_DATABASE_URL");
  process.exit(0);
}
if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must be a separate database");
// Payroll reads the shared connection. Point it at the isolated database before anything loads it.
process.env.DATABASE_URL = url;

const attendance = await import("../src/server/attendance");
const { baghdadMoment } = await import("../src/lib/attendance-rules");
const { issueKioskCode, parseKioskCode } = await import("../src/server/attendance-qr");
const { applyBonus, createPayrollRun, previewPayrollRun, recalculatePayrollDraftsForAttendance } = await import("../src/server/hr-intelligence");
const { AttendanceError } = attendance;

const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
const db: any = drizzle(client);
const rows = async (query: any) => (await db.execute(query)).rows as any[];
const actor = { id: null, name: "فحص الحضور" };
const stamp = Date.now();
class Rollback extends Error {}

const expectRefusal = async (work: () => Promise<unknown>, pattern: RegExp, code?: string) => {
  await db.execute(sql`savepoint refusal`);
  let caught: unknown = null;
  try { await work(); } catch (cause) { caught = cause; }
  await db.execute(sql`rollback to savepoint refusal`);
  assert.ok(caught instanceof AttendanceError, `expected a refusal matching ${pattern}, got ${caught}`);
  assert.match((caught as Error).message, pattern);
  if (code) assert.equal((caught as InstanceType<typeof AttendanceError>).code, code);
};
const at = (date: string, time: string, seconds = 0) => baghdadMoment(date, time).getTime() + seconds * 1000;
const MONDAY = "2026-09-14", TUESDAY = "2026-09-15", FRIDAY = "2026-09-18";
const SHOP = { latitude: 34.888, longitude: 44.633 };
const inside = { ...SHOP, accuracy: 15 };
const outside = { latitude: 34.95, longitude: 44.633, accuracy: 15 };

const newStaff = async (runner: (query: any) => Promise<any[]>, label: string, extra: { salaryType?: string; baseSalary?: number; hourlyRate?: number } = {}) => {
  const [row] = await runner(sql`
    insert into staff (username, password_hash, full_name, role, permissions, is_active, salary_type, base_salary, hourly_rate, daily_working_hours, working_days_per_week, payment_method, salary_status)
    values (${`att_${stamp}_${label}`}, 'x', ${`موظف ${label} ${stamp}`}, 'employee', '[]'::jsonb, true, ${extra.salaryType ?? "monthly"}, ${String(extra.baseSalary ?? 600000)}, ${String(extra.hourlyRate ?? 0)}, 8, 6, 'cash', 'active')
    returning id
  `);
  return Number(row.id);
};
const staffMoney = async () => (await rows(sql`select count(*)::int as total from financial_transactions`))[0].total as number;
const recordCount = async (staffId: number) => (await rows(sql`select count(*)::int as total from attendance_records where staff_id = ${staffId}`))[0].total as number;

const moneyBefore = await staffMoney();
const staffBefore = (await rows(sql`select count(*)::int as total from staff`))[0].total;

await db.execute(sql`begin`);
try {
  // ─── Locations and kiosks ─────────────────────────────────
  const shop = await attendance.saveLocation(db, null, { name: `المحل ${stamp}`, kind: "office", ...SHOP, radiusMeters: 100, maxAccuracyMeters: 50, requiredMethod: "qr_gps" }, actor);
  const store = await attendance.saveLocation(db, null, { name: `المخزن ${stamp}`, kind: "warehouse", latitude: 34.9, longitude: 44.7, radiusMeters: 100, maxAccuracyMeters: 50, requiredMethod: "qr" }, actor);
  const hall = await attendance.saveLocation(db, null, { name: `القاعة ${stamp}`, kind: "event", latitude: 34.8, longitude: 44.6, radiusMeters: 150, maxAccuracyMeters: 50, requiredMethod: "gps" }, actor);
  await expectRefusal(() => attendance.saveLocation(db, null, { name: "بلا إحداثيات", requiredMethod: "gps" }, actor), /تتطلب GPS/);
  await expectRefusal(() => attendance.saveLocation(db, null, { name: "نصف إحداثيات", latitude: 34 }, actor), /معاً/);
  const kiosk = await attendance.createKiosk(db, { locationId: shop }, actor);
  const storeKiosk = await attendance.createKiosk(db, { locationId: store }, actor);
  const [storedKiosk] = await rows(sql`select device_token_hash from attendance_kiosks where id = ${kiosk.id}`);
  assert.notEqual(storedKiosk.device_token_hash, kiosk.deviceToken, "only a hash of the device link is stored");
  const display = await attendance.kioskDisplay(db, kiosk.deviceToken, at(MONDAY, "09:00"));
  assert.deepEqual(Object.keys(display).sort(), ["code", "locationName", "name", "rotatesAt", "serverTime"], "the kiosk receives no employee or payroll field");
  await expectRefusal(() => attendance.kioskDisplay(db, "not-a-real-device-link", at(MONDAY, "09:00")), /غير مفعلة/, "NOT_FOUND");
  const codeAt = async (ms: number, deviceToken = kiosk.deviceToken) => (await attendance.kioskDisplay(db, deviceToken, ms)).code;

  // ─── Settings, with a legacy employee left untouched ──────
  const fixed = (requiredMethod: string, extra: Record<string, unknown> = {}) => ({ enabled: true, primaryLocationId: shop, requiredMethod, allowedMethods: ["qr", "gps", "qr_gps"], scheduleType: "fixed", shiftStart: "09:00", shiftEnd: "17:00", weeklyDaysOff: ["fri"], graceMinutes: 10, ...extra });
  const legacy = await newStaff(rows, "legacy");
  assert.equal((await attendance.readEmployeeSettings(db, legacy)).enabled, false, "an employee with no row stays on the old flow");
  await expectRefusal(() => attendance.recordAttendance(db, legacy, { action: "check_in" }, at(MONDAY, "09:00")), /غير مفعل/, "NOT_ENABLED");
  await db.execute(sql`insert into attendance_records (staff_id, check_in_at, status) values (${legacy}, '2026-09-13 06:00:00', 'present'), (${legacy}, '2026-09-14 06:00:00', 'present')`);
  assert.equal(await recordCount(legacy), 2, "two old open rows with no method cannot fail the one-open-session index");
  const missingLocation = await newStaff(rows, "noloc");
  await expectRefusal(() => attendance.saveEmployeeSettings(db, missingLocation, { enabled: true, requiredMethod: "qr", scheduleType: "fixed" }, actor), /موقع عمل أساسي/);

  // ─── QR check-in, duplicates, replay, expiry ──────────────
  const qrUser = await newStaff(rows, "qr");
  await attendance.saveEmployeeSettings(db, qrUser, fixed("qr"), actor);
  const nine = at(MONDAY, "09:02");
  const firstCode = await codeAt(nine);
  await expectRefusal(() => attendance.recordAttendance(db, qrUser, { action: "check_in" }, nine), /امسح رمز QR/, "QR_REQUIRED");
  await expectRefusal(() => attendance.recordAttendance(db, qrUser, { action: "check_in", qrCode: "AJN1.1.1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, nine), /غير صالح/);
  await expectRefusal(async () => attendance.recordAttendance(db, qrUser, { action: "check_in", qrCode: await codeAt(nine - 120_000) }, nine), /انتهت صلاحية/, "QR_INVALID");
  await expectRefusal(async () => attendance.recordAttendance(db, qrUser, { action: "check_in", qrCode: await codeAt(nine, storeKiosk.deviceToken) }, nine), /لموقع عمل آخر/, "QR_WRONG_LOCATION");
  assert.equal(await recordCount(qrUser), 0, "no refused attempt leaves a record");
  const checkedIn = await attendance.recordAttendance(db, qrUser, { action: "check_in", qrCode: firstCode }, nine);
  assert.equal(checkedIn.status, "present");
  assert.equal(checkedIn.method, "qr");
  await expectRefusal(() => attendance.recordAttendance(db, qrUser, { action: "check_in", qrCode: firstCode }, nine + 1000), /مفتوح بالفعل/, "CONFLICT");
  await expectRefusal(() => attendance.recordAttendance(db, qrUser, { action: "check_out", qrCode: firstCode }, nine + 1000), /استُخدم هذا الرمز/, "QR_REPLAYED");
  const colleague = await newStaff(rows, "queue");
  await attendance.saveEmployeeSettings(db, colleague, fixed("qr"), actor);
  assert.equal((await attendance.recordAttendance(db, colleague, { action: "check_in", qrCode: firstCode }, nine + 1000)).method, "qr", "a queue of staff can share the code on screen");
  const leaving = at(MONDAY, "17:00");
  await attendance.recordAttendance(db, qrUser, { action: "check_out", qrCode: await codeAt(leaving) }, leaving);
  const closed = await attendance.attendanceToday(db, qrUser, leaving + 60_000);
  assert.equal(closed.status, "out");
  assert.equal(closed.workedMinutes, 478);
  assert.equal(closed.canCheckOut, false);
  await expectRefusal(async () => attendance.recordAttendance(db, qrUser, { action: "check_out", qrCode: await codeAt(leaving + 60_000) }, leaving + 60_000), /لا يوجد حضور مفتوح/, "CONFLICT");
  const lateUser = await newStaff(rows, "late");
  await attendance.saveEmployeeSettings(db, lateUser, fixed("qr"), actor);
  const lateAt = at(MONDAY, "09:40");
  assert.equal((await attendance.recordAttendance(db, lateUser, { action: "check_in", qrCode: await codeAt(lateAt) }, lateAt)).status, "late");
  assert.equal((await attendance.attendanceToday(db, lateUser, lateAt + 1000)).status, "late");

  // A forged kiosk number and a revoked screen both fail.
  const [secretRow] = await rows(sql`select qr_secret from attendance_kiosks where id = ${kiosk.id}`);
  const forged = issueKioskCode(storeKiosk.id, String(secretRow.qr_secret), lateAt + 1000).code;
  await expectRefusal(() => attendance.recordAttendance(db, lateUser, { action: "check_out", qrCode: forged }, lateAt + 1000), /غير صالح/);
  assert.ok(parseKioskCode(forged));
  const spare = await attendance.createKiosk(db, { locationId: shop }, actor);
  const spareCode = await codeAt(nine, spare.deviceToken);
  await attendance.revokeKiosk(db, spare.id);
  await expectRefusal(() => attendance.kioskDisplay(db, spare.deviceToken, nine), /غير مفعلة/);
  const revokedUser = await newStaff(rows, "revoked");
  await attendance.saveEmployeeSettings(db, revokedUser, fixed("qr"), actor);
  await expectRefusal(() => attendance.recordAttendance(db, revokedUser, { action: "check_in", qrCode: spareCode }, nine), /غير صالح/);

  // ─── GPS ──────────────────────────────────────────────────
  const gpsUser = await newStaff(rows, "gps");
  await attendance.saveEmployeeSettings(db, gpsUser, fixed("gps"), actor);
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: outside }, nine), /^أنت خارج نطاق موقع العمل المسموح\.$/, "GPS_REJECTED");
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: { ...inside, accuracy: 300 } }, nine), /دقة تحديد الموقع ضعيفة/, "GPS_REJECTED");
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in" }, nine), /لم يصل موقعك/, "GPS_REJECTED");
  assert.equal(await recordCount(gpsUser), 0, "a rejected location leaves no record");
  const gpsIn = await attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: inside }, nine);
  const [evidence] = await rows(sql`select event, method, latitude, accuracy_meters, distance_meters, location_id from attendance_verifications where record_id = ${gpsIn.recordId}`);
  assert.equal(evidence.event, "check_in");
  assert.equal(Number(evidence.location_id), shop);
  assert.ok(Number(evidence.distance_meters) < 1, "the distance is kept as evidence");
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_out", gps: outside }, at(MONDAY, "17:00")), /خارج نطاق/, "GPS_REJECTED");
  await attendance.recordAttendance(db, gpsUser, { action: "check_out", gps: inside }, at(MONDAY, "17:00"));

  // ─── QR + GPS: every step must pass ───────────────────────
  const bothUser = await newStaff(rows, "both");
  await attendance.saveEmployeeSettings(db, bothUser, fixed("qr_gps"), actor);
  const bothCode = await codeAt(nine);
  await expectRefusal(() => attendance.recordAttendance(db, bothUser, { action: "check_in", gps: inside }, nine), /امسح رمز QR/, "QR_REQUIRED");
  await expectRefusal(() => attendance.recordAttendance(db, bothUser, { action: "check_in", qrCode: bothCode, gps: outside }, nine), /خارج نطاق/, "GPS_REJECTED");
  await expectRefusal(() => attendance.recordAttendance(db, bothUser, { action: "check_in", qrCode: bothCode }, nine), /لم يصل موقعك/, "GPS_REJECTED");
  assert.equal(await recordCount(bothUser), 0, "QR + GPS writes nothing when one step fails");
  assert.equal((await rows(sql`select count(*)::int as total from attendance_qr_uses where staff_id = ${bothUser}`))[0].total, 0, "a rejected attempt does not burn the code");
  assert.equal((await attendance.recordAttendance(db, bothUser, { action: "check_in", qrCode: bothCode, gps: inside }, nine)).method, "qr_gps");

  // ─── Alternatives: whichever allowed evidence is brought ──
  const anyUser = await newStaff(rows, "any");
  await attendance.saveEmployeeSettings(db, anyUser, fixed("any", { allowedMethods: ["gps"] }), actor);
  await expectRefusal(() => attendance.recordAttendance(db, anyUser, { action: "check_in", qrCode: bothCode }, nine), /طرق التسجيل المسموحة/, "METHOD_REQUIRED");
  assert.equal((await attendance.recordAttendance(db, anyUser, { action: "check_in", gps: inside }, nine)).method, "gps");
  const manualUser = await newStaff(rows, "manual");
  await attendance.saveEmployeeSettings(db, manualUser, fixed("manual"), actor);
  await expectRefusal(() => attendance.recordAttendance(db, manualUser, { action: "check_in", gps: inside }, nine), /يدوياً بموافقة المدير/, "MANUAL_ONLY");

  // ─── Rest days and windows ────────────────────────────────
  const restAt = at(FRIDAY, "10:00");
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: inside }, restAt), /لا توجد لك وردية/, "NO_SHIFT");
  assert.equal((await attendance.attendanceToday(db, gpsUser, restAt)).status, "rest");
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: inside }, at(TUESDAY, "06:00")), /لم يبدأ وقت/, "OUTSIDE_SHIFT");
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: inside }, at(TUESDAY, "18:00")), /انتهى وقت ورديتك/, "OUTSIDE_SHIFT");
  await db.execute(sql`insert into attendance_records (staff_id, check_in_at, status) values (${gpsUser}, ${new Date(at(TUESDAY, "00:00")).toISOString()}::timestamptz at time zone 'utc', 'paid_leave')`);
  await expectRefusal(() => attendance.recordAttendance(db, gpsUser, { action: "check_in", gps: inside }, at(TUESDAY, "09:00")), /إجازة معتمدة/, "CONFLICT");

  // ─── Flexible and overnight ───────────────────────────────
  const flexUser = await newStaff(rows, "flex");
  await attendance.saveEmployeeSettings(db, flexUser, { enabled: true, primaryLocationId: shop, requiredMethod: "gps", scheduleType: "flexible" }, actor);
  assert.equal((await attendance.attendanceToday(db, flexUser, restAt)).status, "not_scheduled", "a flexible employee is never absent without a shift");
  const flexIn = await attendance.recordAttendance(db, flexUser, { action: "check_in", gps: inside }, restAt);
  assert.equal(flexIn.status, "present", "flexible hours have no lateness");

  const nightUser = await newStaff(rows, "night");
  await attendance.saveEmployeeSettings(db, nightUser, { enabled: true, primaryLocationId: shop, requiredMethod: "gps", scheduleType: "rotating" }, actor);
  await attendance.createShifts(db, { staffId: nightUser, date: MONDAY, start: "22:00", end: "06:00", kind: "overnight", locationId: shop }, actor);
  await expectRefusal(() => attendance.createShifts(db, { staffId: nightUser, date: MONDAY, start: "23:00", end: "23:30", locationId: shop }, actor), /متداخلة/, "CONFLICT");
  const nightIn = await attendance.recordAttendance(db, nightUser, { action: "check_in", gps: inside }, at(MONDAY, "22:00"));
  const afterMidnight = at(TUESDAY, "01:00");
  const nightNow = await attendance.attendanceToday(db, nightUser, afterMidnight);
  assert.equal(nightNow.canCheckOut, true, "the shift is still open after midnight");
  assert.equal(nightNow.status, "present");
  await attendance.recordAttendance(db, nightUser, { action: "check_out", gps: inside }, at(TUESDAY, "06:00"));
  const [nightRow] = await rows(sql`select check_in_at, check_out_at, shift_id from attendance_records where id = ${nightIn.recordId}`);
  assert.equal(Math.round((Date.parse(`${String(nightRow.check_out_at).replace(" ", "T")}Z`) - Date.parse(`${String(nightRow.check_in_at).replace(" ", "T")}Z`)) / 3_600_000), 8, "overnight stored as one 8-hour session");
  assert.ok(nightRow.shift_id, "linked to its shift");
  const nightReport = await attendance.attendanceReport(db, { from: MONDAY, to: TUESDAY, staffId: nightUser });
  assert.equal(nightReport.data[0].scheduledDays, 1, "one overnight shift is one scheduled day");
  assert.equal(nightReport.data[0].presentDays, 1);
  assert.equal(nightReport.data[0].absentDays, 0, "the morning after is not an absence");
  assert.equal(nightReport.data[0].workedHours, 8);

  // ─── Events: linked to the booking, no double counting ────
  const eventUser = await newStaff(rows, "event", { salaryType: "per_event", baseSalary: 0 });
  await attendance.saveEmployeeSettings(db, eventUser, { enabled: true, primaryLocationId: shop, requiredMethod: "qr_gps", eventMethod: "gps", scheduleType: "event" }, actor);
  const eventDay = "2026-09-16";
  assert.equal((await attendance.attendanceToday(db, eventUser, at(eventDay, "12:00"))).status, "not_scheduled", "an events employee with no event today is not absent");
  const bookingShift = await attendance.createBookingShift(db, { bookingSource: "kosha", bookingId: 900001, staffId: eventUser, date: eventDay, start: "16:00", end: "20:00", locationId: hall, payAmount: 50000 }, actor);
  await expectRefusal(() => attendance.createBookingShift(db, { bookingSource: "kosha", bookingId: 900002, staffId: eventUser, date: eventDay, start: "19:00", end: "21:00", locationId: hall, payAmount: 50000 }, actor), /متداخلة على الحجز #900001/, "CONFLICT");
  const [serviceRow] = await rows(sql`insert into services (name, name_ar, type) values (${`service ${stamp}`}, ${`خدمة ${stamp}`}, 'general') returning id`);
  const [serviceOrder] = await rows(sql`insert into service_orders (service_id, customer_name, phone) values (${serviceRow.id}, ${`زبون ${stamp}`}, '07700000000') returning id`);
  const laterShift = await attendance.createBookingShift(db, { bookingSource: "service", bookingId: Number(serviceOrder.id), staffId: eventUser, date: eventDay, start: "21:00", end: "23:00", locationId: hall, payAmount: 30000 }, actor);
  const today = await attendance.attendanceToday(db, eventUser, at(eventDay, "15:00"));
  assert.equal(today.shifts.length, 2, "both events show in the portal");
  assert.equal(today.shifts[0].bookingId, 900001, "with their original booking");
  assert.equal(today.shifts[0].method, "gps", "the event rule applies");
  assert.equal(today.status, "not_started");
  await expectRefusal(() => attendance.approveEventCompensation(db, bookingShift.id, actor), /لم يُتحقق/, "NOT_VERIFIED");
  const eventGps = { latitude: 34.8, longitude: 44.6, accuracy: 10 };
  await expectRefusal(() => attendance.recordAttendance(db, eventUser, { action: "check_in", gps: inside }, at(eventDay, "16:00")), /خارج نطاق/, "GPS_REJECTED");
  await attendance.recordAttendance(db, eventUser, { action: "check_in", gps: eventGps }, at(eventDay, "16:00"));
  assert.equal((await attendance.attendanceToday(db, eventUser, at(eventDay, "17:00"))).status, "mission", "at an event the employee is on an external task");
  await expectRefusal(() => attendance.cancelShift(db, bookingShift.id), /لا يمكن إلغاؤها/, "CONFLICT");
  await attendance.recordAttendance(db, eventUser, { action: "check_out", gps: eventGps }, at(eventDay, "20:00"));
  await attendance.recordAttendance(db, eventUser, { action: "check_in", gps: eventGps }, at(eventDay, "21:00"));
  await attendance.recordAttendance(db, eventUser, { action: "check_out", gps: eventGps }, at(eventDay, "23:00"));
  await expectRefusal(() => attendance.recordAttendance(db, eventUser, { action: "check_in", gps: eventGps, shiftId: laterShift.id }, at(eventDay, "22:30")), /مسبقاً/, "CONFLICT");
  assert.equal((await attendance.attendanceToday(db, eventUser, at(eventDay, "23:30"))).workedMinutes, 360, "two events add up with no overlap");
  const eventReport = await attendance.attendanceReport(db, { from: eventDay, to: eventDay, staffId: eventUser });
  assert.equal(eventReport.data[0].eventShifts, 2);
  assert.equal(eventReport.data[0].eventAttended, 2);

  // Pay for an attended event becomes one approved bonus. It is not paid and not in a line yet.
  const paid = await attendance.approveEventCompensation(db, bookingShift.id, actor);
  assert.equal(paid.created, true);
  assert.equal((await attendance.approveEventCompensation(db, bookingShift.id, actor)).duplicate, true, "approving twice never makes a second payment");
  const bonuses = await rows(sql`select status, amount, bonus_type, payroll_line_id from hr_incentive_events where staff_id = ${eventUser}`);
  assert.equal(bonuses.length, 1);
  assert.equal(bonuses[0].status, "approved", "only eligible for the manager's picker");
  assert.equal(Number(bonuses[0].amount), 50000);
  assert.equal(bonuses[0].payroll_line_id, null);
  // A driver wage on the same booking blocks a second payment for the same work.
  const [vehicle] = await rows(sql`insert into fleet_vehicles (name, plate_number) values (${`سيارة ${stamp}`}, ${`T${stamp}`}) returning id`);
  await db.execute(sql`insert into vehicle_expenses (vehicle_id, expense_type, amount, idempotency_key, driver_id, service_order_id, status) values (${vehicle.id}, 'driver_wage', '30000', ${`att-${stamp}`}, ${eventUser}, ${serviceOrder.id}, 'approved')`);
  await expectRefusal(() => attendance.approveEventCompensation(db, laterShift.id, actor), /أجرة سائق/, "CONFLICT");
  const unattended = await attendance.createBookingShift(db, { bookingSource: "kosha", bookingId: 900004, staffId: eventUser, date: "2026-09-17", start: "16:00", end: "20:00", locationId: hall }, actor);
  await attendance.cancelShift(db, unattended.id);
  await attendance.createBookingShift(db, { bookingSource: "kosha", bookingId: 900004, staffId: eventUser, date: "2026-09-17", start: "16:00", end: "20:00", locationId: hall }, actor);

  // ─── Missing check-out and corrections ────────────────────
  const forgetful = await newStaff(rows, "forgot");
  await attendance.saveEmployeeSettings(db, forgetful, fixed("gps"), actor);
  const openIn = await attendance.recordAttendance(db, forgetful, { action: "check_in", gps: inside }, nine);
  const nextDay = await attendance.attendanceDashboard(db, { date: MONDAY, nowMs: at(TUESDAY, "10:00"), staffId: forgetful });
  assert.equal(nextDay.rows[0].missingCheckOut, true, "yesterday's open session is flagged");
  assert.equal(nextDay.rows[0].workedMinutes, 0, "and pays no hours");
  await expectRefusal(() => attendance.recordAttendance(db, forgetful, { action: "check_in", gps: inside }, at(TUESDAY, "09:00")), /مفتوح بالفعل/, "CONFLICT");
  await expectRefusal(() => attendance.createCorrection(db, forgetful, { workDate: MONDAY, requestType: "nonsense", reason: "نسيت", checkOutTime: "17:00" }), /نوع الطلب/);
  await expectRefusal(() => attendance.createCorrection(db, forgetful, { workDate: MONDAY, requestType: "forgot_check_out", reason: "", checkOutTime: "17:00" }), /سبب الطلب/);
  await expectRefusal(() => attendance.createCorrection(db, forgetful, { workDate: MONDAY, requestType: "forgot_check_out", reason: "نسيت" }), /وقت الحضور أو الانصراف/);
  await expectRefusal(() => attendance.createCorrection(db, forgetful, { workDate: "2099-01-01", requestType: "forgot_check_out", reason: "نسيت", checkOutTime: "17:00" }), /ليوم قادم/);
  const request = await attendance.createCorrection(db, forgetful, { workDate: MONDAY, requestType: "forgot_check_out", reason: "نسيت تسجيل الانصراف", checkOutTime: "17:00", attachment: "data:image/png;base64,AAAA" });
  await expectRefusal(() => attendance.createCorrection(db, forgetful, { workDate: MONDAY, requestType: "forgot_check_out", reason: "مرة ثانية", checkOutTime: "17:00" }), /بانتظار الموافقة/, "CONFLICT");
  const pending = await attendance.listCorrections(db, { staffId: forgetful, status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].hasAttachment, true);
  assert.equal(pending[0].attachment, undefined, "attachments stay out of the list");
  await expectRefusal(() => attendance.reviewCorrection(db, request.id, { approve: true }, { id: forgetful, name: "نفسه" }), /طلبك أنت/, "PERMISSION_DENIED");
  const approved = await attendance.reviewCorrection(db, request.id, { approve: true, note: "مؤكد" }, actor);
  assert.equal(approved.recordId, openIn.recordId, "approval closes the same record");
  await expectRefusal(() => attendance.reviewCorrection(db, request.id, { approve: false }, actor), /مسبقاً/, "CONFLICT");
  const [fixedRow] = await rows(sql`select status, check_out_at, notes from attendance_records where id = ${openIn.recordId}`);
  assert.equal(fixedRow.status, "out");
  assert.match(String(fixedRow.notes), new RegExp(`تصحيح معتمد #${request.id}`));
  const fixedDay = await attendance.attendanceDashboard(db, { date: MONDAY, nowMs: at(TUESDAY, "10:00"), staffId: forgetful });
  assert.equal(fixedDay.rows[0].workedMinutes, 478);
  assert.equal(fixedDay.rows[0].missingCheckOut, false);
  const trail = await rows(sql`select type from entity_timeline where entity_type = 'attendance_correction' and entity_id = ${request.id}`);
  assert.equal(trail[0]?.type, "attendance_correction_approved", "the review leaves an audit entry");
  assert.equal((await rows(sql`select count(*)::int as total from attendance_verifications where record_id = ${openIn.recordId} and event = 'correction'`))[0].total, 1);
  const rejected = await attendance.createCorrection(db, forgetful, { workDate: TUESDAY, requestType: "gps_unavailable", reason: "الموقع لا يعمل", checkInTime: "09:00" });
  const beforeRejection = await recordCount(forgetful);
  await attendance.reviewCorrection(db, rejected.id, { approve: false, note: "لا يوجد ما يثبت" }, actor);
  assert.equal(await recordCount(forgetful), beforeRejection, "a rejected request changes no attendance");
  const created = await attendance.createCorrection(db, forgetful, { workDate: TUESDAY, requestType: "qr_unavailable", reason: "الشاشة متوقفة", checkInTime: "09:00", checkOutTime: "17:00" });
  const createdResult = await attendance.reviewCorrection(db, created.id, { approve: true }, actor);
  const [manualRow] = await rows(sql`select method, status from attendance_records where id = ${createdResult.recordId}`);
  assert.equal(manualRow.method, "manual", "a day with no record gets one marked as manually approved");
  assert.equal(manualRow.status, "out");
  // Opening a second session through a correction explains itself instead of failing as a server error.
  const stillOpen = await newStaff(rows, "stillopen");
  await attendance.saveEmployeeSettings(db, stillOpen, fixed("gps"), actor);
  await attendance.recordAttendance(db, stillOpen, { action: "check_in", gps: inside }, nine);
  const second = await attendance.createCorrection(db, stillOpen, { workDate: TUESDAY, requestType: "wrong_time", reason: "وقت خطأ", checkInTime: "09:00" });
  await expectRefusal(() => attendance.reviewCorrection(db, second.id, { approve: true }, actor), /حضور مفتوح/, "CONFLICT");

  // ─── Overtime approval ────────────────────────────────────
  await expectRefusal(() => attendance.approveOvertime(db, openIn.recordId, -5, actor), /الإضافي غير صحيح/);
  await expectRefusal(() => attendance.approveOvertime(db, 999999999, 30, actor), /غير موجود/, "NOT_FOUND");
  assert.equal((await attendance.approveOvertime(db, openIn.recordId, 45, actor)).staffId, forgetful);

  // ─── Dashboard: only real schedules count ─────────────────
  const noSchedule = await newStaff(rows, "noschedule");
  const scheduledAbsent = await newStaff(rows, "absent");
  await attendance.saveEmployeeSettings(db, scheduledAbsent, fixed("gps"), actor);
  const board = await attendance.attendanceDashboard(db, { date: MONDAY, nowMs: at(MONDAY, "12:00") });
  const rowOf = (id: number) => board.rows.find((row: any) => row.staffId === id)!;
  assert.equal(rowOf(noSchedule).status, "not_scheduled", "no shift, not absent");
  assert.equal(rowOf(scheduledAbsent).status, "absent", "a started shift with no check-in is absent");
  assert.equal(rowOf(lateUser).status, "late");
  assert.equal(rowOf(lateUser).isLate, true);
  assert.equal(rowOf(bothUser).status, "present");
  const friday = await attendance.attendanceDashboard(db, { date: FRIDAY, nowMs: at(FRIDAY, "12:00"), staffId: scheduledAbsent });
  assert.equal(friday.rows[0].status, "rest", "the rest day is not an absence");
  assert.equal(friday.summary.absent, (await attendance.attendanceDashboard(db, { date: FRIDAY, nowMs: at(FRIDAY, "12:00") })).summary.absent, "filters do not change the cards");
  const filtered = await attendance.attendanceDashboard(db, { date: MONDAY, nowMs: at(MONDAY, "12:00"), method: "qr", search: String(stamp) });
  assert.ok(filtered.rows.length >= 1 && filtered.rows.every((row: any) => row.method === "qr"), "the method filter works");

  // ─── Records: coordinates only for those allowed ──────────
  const hidden = await attendance.attendanceRecords(db, { from: MONDAY, to: MONDAY, staffId: gpsUser });
  assert.equal(hidden.data[0].evidence, undefined, "evidence is opt-in");
  const shown = await attendance.attendanceRecords(db, { from: MONDAY, to: MONDAY, staffId: gpsUser, includeLocation: true });
  assert.equal(shown.data[0].evidence?.length, 2, "check-in and check-out evidence");
  assert.equal((await attendance.attendanceRecords(db, { from: MONDAY, to: MONDAY, staffId: gpsUser, method: "qr" })).total, 0);

  // ─── Retention: coordinates age out, the audit stays ──────
  await db.execute(sql`update attendance_verifications set created_at = now() - interval '200 days' where record_id = ${gpsIn.recordId}`);
  assert.ok((await attendance.sweepLocationEvidence(db, 90)).cleared >= 1, "the sweep reports what it cleared");
  const [aged] = await rows(sql`select latitude, longitude, distance_meters from attendance_verifications where record_id = ${gpsIn.recordId} and event = 'check_in'`);
  assert.equal(aged.latitude, null, "old coordinates are cleared");
  assert.equal(aged.longitude, null);
  assert.notEqual(aged.distance_meters, null, "the check result stays for audit");

  // ─── Reports and shifts over a date range ─────────────────
  const rotating = await newStaff(rows, "rotating");
  await attendance.saveEmployeeSettings(db, rotating, { enabled: true, primaryLocationId: shop, requiredMethod: "gps", scheduleType: "rotating" }, actor);
  const range = await attendance.createShifts(db, { staffId: rotating, from: "2026-09-13", to: "2026-09-19", days: ["mon", "wed"], start: "10:00", end: "14:00", locationId: shop }, actor);
  assert.equal(range.created.length, 2, "only the chosen weekdays");
  const again = await attendance.createShifts(db, { staffId: rotating, from: "2026-09-14", to: "2026-09-15", start: "10:00", end: "14:00", locationId: shop }, actor);
  assert.equal(again.created.length, 1, "a day already holding a shift is skipped, not doubled");
  const rotatingReport = await attendance.attendanceReport(db, { from: "2026-09-13", to: "2026-09-19", staffId: rotating });
  assert.equal(rotatingReport.data[0].scheduledDays, 3);
  assert.equal(rotatingReport.data[0].absentDays, 3, "every scheduled shift with no attendance is an absence");
  await expectRefusal(() => attendance.attendanceReport(db, { from: "2026-09-20", to: "2026-09-13" }), /الفترة غير صحيحة/);

  assert.equal(await staffMoney(), moneyBefore, "attendance created no financial transaction");
  await db.execute(sql`rollback`);
  throw new Rollback();
} catch (cause) {
  if (!(cause instanceof Rollback)) {
    await db.execute(sql`rollback`).catch(() => undefined);
    client.release();
    await pool.end();
    throw cause;
  }
}
client.release();
assert.equal((await pool.query("select count(*)::int as total from staff")).rows[0].total, staffBefore, "the rolled-back part left nothing behind");

// ─── Payroll, through the existing payroll engine ───────────
// Committed rows, each stamped for this run and removed again below.
const committed = async (query: any) => (await drizzle(pool).execute(query)).rows as any[];
const payrollActor = { id: null as any, name: "فحص الحضور" };
const owned: number[] = [];
const ownedRuns: number[] = [];
const period = "2019-03"; // Long finished, so empty scheduled days count as absences, and no other run uses it.
const day = (n: number) => `${period}-${String(n).padStart(2, "0")}`;
const openRecord = async (staffId: number, date: string, start: string, end: string | null, extra: { shiftId?: number } = {}) => committed(sql`
  insert into attendance_records (staff_id, check_in_at, check_out_at, status, shift_id, method)
  values (${staffId}, (${baghdadMoment(date, start).toISOString()}::timestamptz at time zone 'utc'), ${end ? sql`(${baghdadMoment(date, end).toISOString()}::timestamptz at time zone 'utc')` : null}, ${end ? "out" : "present"}, ${extra.shiftId ?? null}, 'gps') returning id
`);
const makePayee = async (label: string, extra: { salaryType: string; baseSalary: number; hourlyRate?: number }) => {
  const id = await newStaff(committed, `pay_${label}`, extra);
  owned.push(id);
  await committed(sql`insert into employee_salary_settings (staff_id, approval_status, enable_attendance_integration, enable_overtime, shift_start, shift_end, weekly_days_off) values (${id}, 'approved', true, true, '09:00', '17:00', ${JSON.stringify(["fri"])}::jsonb)`);
  await attendance.saveEmployeeSettings({ execute: (query: any) => drizzle(pool).execute(query) } as any, id, { enabled: true, requiredMethod: "gps", scheduleType: "event" }, payrollActor);
  return id;
};
const payrollExecutor = { execute: (query: any) => drizzle(pool).execute(query) } as any;
try {
  const monthly = await makePayee("monthly", { salaryType: "monthly", baseSalary: 600000 });
  const daily = await makePayee("daily", { salaryType: "daily", baseSalary: 20000 });
  const hourly = await makePayee("hourly", { salaryType: "hourly", baseSalary: 5000, hourlyRate: 5000 });
  const perEvent = await makePayee("event", { salaryType: "per_event", baseSalary: 0 });
  const shiftFor = async (staffId: number, n: number, extra: Record<string, unknown> = {}) => (await attendance.createShifts(payrollExecutor, { staffId, date: day(n), start: "09:00", end: "17:00", locationId: null, ...extra }, payrollActor)).created[0];
  // Monthly: two shifts, one attended fully and one with no record at all (unexcused absence).
  await openRecord(monthly, day(3), "09:00", "17:00", { shiftId: await shiftFor(monthly, 3) });
  await shiftFor(monthly, 4);
  // Daily: two full days, and a third with no check-out that is not paid as a full shift.
  await openRecord(daily, day(3), "09:00", "17:00", { shiftId: await shiftFor(daily, 3) });
  await openRecord(daily, day(4), "09:00", "17:00", { shiftId: await shiftFor(daily, 4) });
  await openRecord(daily, day(5), "09:00", null, { shiftId: await shiftFor(daily, 5) });
  // Hourly: three hours worked, overlapping records counted once.
  await openRecord(hourly, day(3), "09:00", "11:00", { shiftId: await shiftFor(hourly, 3, { start: "09:00", end: "12:00" }) });
  await openRecord(hourly, day(3), "10:00", "12:00");
  // Per event: pay flows only through the approved bonus.
  const eventShift = (await attendance.createBookingShift(payrollExecutor, { bookingSource: "kosha", bookingId: 900100, staffId: perEvent, date: day(5), start: "16:00", end: "20:00", payAmount: 75000 }, payrollActor)).id;
  await openRecord(perEvent, day(5), "16:00", "20:00", { shiftId: eventShift });

  const preview: any = await previewPayrollRun({ period, employeeIds: owned });
  const line = (id: number) => preview.employees.find((row: any) => Number(row.employeeId) === id);
  assert.equal(line(monthly).baseSalary, 600000, "monthly keeps its base");
  assert.equal(line(monthly).scheduledWorkingDays, 2, "scheduled follows the shifts");
  assert.equal(line(monthly).attendanceDays, 1);
  assert.equal(line(monthly).absenceDays, 1, "the shift with no attendance is an unexcused absence");
  assert.equal(line(daily).baseSalary, 40000, "daily pays verified days at the configured rate, not the open one");
  assert.equal(line(daily).missingCheckOut, 1, "and shows the open day for review");
  assert.equal(line(hourly).totalWorkingHours, 3, "hourly counts each minute once");
  assert.equal(line(hourly).baseSalary, 15000, "hourly pays worked hours at the configured rate");
  assert.equal(line(perEvent).baseSalary, 0, "per event has no base");
  assert.equal(line(perEvent).netSalary ?? 0, 0, "and pays nothing before approval");

  const moneyAtPayroll = await staffMoney2();
  const run: any = await createPayrollRun({ period, employeeIds: owned }, payrollActor);
  const runId = Number(run.id ?? run.run?.id);
  assert.ok(runId, "the run exists in the existing payroll table");
  ownedRuns.push(runId);
  const lineOf = async (staffId: number) => (await committed(sql`select * from payroll_lines where payroll_run_id = ${runId} and staff_id = ${staffId}`))[0];
  assert.equal(Number((await lineOf(perEvent)).bonus_amount), 0, "approval alone does not touch the line");

  const compensation = await attendance.approveEventCompensation(payrollExecutor, eventShift, payrollActor);
  assert.equal(compensation.created, true);
  assert.equal((await attendance.approveEventCompensation(payrollExecutor, eventShift, payrollActor)).duplicate, true);
  assert.equal(Number((await lineOf(perEvent)).bonus_amount), 0, "still nothing until a manager selects it");
  await applyBonus(Number(compensation.bonusId), payrollActor, { payrollRunId: runId });
  assert.equal(Number((await lineOf(perEvent)).bonus_amount), 75000, "the manager's selection adds it once");
  await applyBonus(Number(compensation.bonusId), payrollActor, { payrollRunId: runId });
  assert.equal(Number((await lineOf(perEvent)).bonus_amount), 75000, "selecting twice does not pay twice");

  // A correction refreshes a draft but never rewrites a finalized run.
  const before = await lineOf(monthly);
  await openRecord(monthly, day(4), "09:00", "17:00");
  const refreshed = await recalculatePayrollDraftsForAttendance(monthly, day(4), payrollActor);
  assert.equal(refreshed.recalculated.length, 1, "a draft run is recalculated");
  assert.ok(Number((await lineOf(monthly)).attendance_days) > Number(before.attendance_days), "and shows the new attendance");
  assert.equal(Number((await lineOf(monthly)).absence_days), 0, "the absence is gone from the draft");
  await committed(sql`update payroll_runs set status = 'paid' where id = ${runId}`);
  const paidLine = await lineOf(monthly);
  await openRecord(monthly, day(6), "09:00", "17:00", { shiftId: await shiftFor(monthly, 6) });
  const protectedResult = await recalculatePayrollDraftsForAttendance(monthly, day(6), payrollActor);
  assert.equal(protectedResult.recalculated.length, 0);
  assert.equal(protectedResult.protectedRuns.length, 1, "a paid run is reported for manager action");
  const unchanged = await lineOf(monthly);
  assert.equal(unchanged.net_salary, paidLine.net_salary, "and is not silently changed");
  assert.equal(unchanged.attendance_days, paidLine.attendance_days);
  assert.equal(await staffMoney2(), moneyAtPayroll, "building and refreshing payroll from attendance moved no money");
} finally {
  // Only what this run created.
  const ids = sql.join(owned.map((id) => sql`${id}`), sql`, `);
  for (const runId of ownedRuns) {
    await committed(sql`update hr_incentive_events set payroll_line_id = null where payroll_line_id in (select id from payroll_lines where payroll_run_id = ${runId})`);
    await committed(sql`delete from payroll_lines where payroll_run_id = ${runId}`);
    await committed(sql`delete from payroll_runs where id = ${runId}`);
  }
  if (owned.length) {
    await committed(sql`delete from attendance_verifications where staff_id in (${ids})`);
    await committed(sql`delete from attendance_records where staff_id in (${ids})`);
    await committed(sql`delete from attendance_shifts where staff_id in (${ids})`);
    await committed(sql`delete from attendance_employee_settings where staff_id in (${ids})`);
    await committed(sql`delete from hr_incentive_events where staff_id in (${ids})`);
    await committed(sql`delete from employee_salary_settings where staff_id in (${ids})`);
    await committed(sql`delete from entity_timeline where entity_type = 'staff' and entity_id in (${ids})`);
    await committed(sql`update staff set is_active = false where id in (${ids})`);
  }
}
async function staffMoney2() {
  return (await pool.query("select count(*)::int as total from financial_transactions")).rows[0].total as number;
}
await pool.end();
console.log("attendance PostgreSQL integration passed");
process.exit(0);
