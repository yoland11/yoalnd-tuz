import { sql } from "drizzle-orm";
import {
  ATTENDANCE_METHODS,
  CORRECTION_TYPES,
  DAY_STATUS_LABELS,
  addDays,
  baghdadDate,
  baghdadMoment,
  checkGps,
  dayKey,
  dayStatusFor,
  expectedShiftsFor,
  methodSteps,
  resolveMethod,
  toMs,
  workedMinutes,
  type AttendanceDayStatus,
  type ExpectedShift,
  type GpsEvidence,
  type ScheduleInput,
} from "../lib/attendance-rules";
import { issueKioskCode, newKioskDeviceToken, newKioskSecret, parseKioskCode, sha256, verifyKioskCode } from "./attendance-qr";
import { calculateAttendancePayroll, normalizeAttendancePolicy, type AttendancePolicy } from "./attendance-payroll";

export type Executor = { execute: (query: any) => Promise<any> };
export type AttendanceActor = { id: number | null; name: string };

export class AttendanceError extends Error {
  constructor(message: string, public status = 422, public code = "ATTENDANCE_REJECTED") {
    super(message);
    this.name = "AttendanceError";
  }
}

export function rowsOf(result: any): any[] {
  if (!Array.isArray(result?.rows)) throw new Error("Invalid attendance database response");
  return result.rows;
}
const idList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const clean = (value: unknown, max: number) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length > max) throw new AttendanceError("أحد الحقول أطول من الحد المسموح");
  return text || null;
};
const positive = (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d/.test(value);
const validMethod = (value: unknown) => (ATTENDANCE_METHODS as readonly string[]).includes(String(value));

export async function readAttendancePolicy(executor: Executor): Promise<AttendancePolicy> {
  const row = rowsOf(await executor.execute(sql`select value from settings where key = 'attendancePolicy' limit 1`))[0];
  return normalizeAttendancePolicy(row?.value);
}

// ─── Work locations ──────────────────────────────────────────

const locationFromRow = (row: any) => ({
  id: Number(row.id),
  name: String(row.name),
  kind: String(row.kind),
  address: row.address ?? null,
  latitude: row.latitude == null ? null : Number(row.latitude),
  longitude: row.longitude == null ? null : Number(row.longitude),
  radiusMeters: Number(row.radius_meters),
  maxAccuracyMeters: Number(row.max_accuracy_meters),
  requiredMethod: String(row.required_method),
  warehouseId: row.warehouse_id == null ? null : Number(row.warehouse_id),
  warehouseName: row.warehouse_name ?? null,
  isActive: row.is_active === true,
});
export type AttendanceLocation = ReturnType<typeof locationFromRow>;

export async function listLocations(executor: Executor) {
  const rows = rowsOf(await executor.execute(sql`
    select l.*, w.name as warehouse_name from attendance_locations l left join warehouses w on w.id = l.warehouse_id order by l.is_active desc, l.name asc
  `));
  return rows.map(locationFromRow);
}

export async function saveLocation(executor: Executor, id: number | null, input: any, actor: AttendanceActor) {
  const name = clean(input?.name, 160);
  if (!name) throw new AttendanceError("اكتب اسم موقع العمل");
  const hasLat = input?.latitude !== "" && input?.latitude != null, hasLng = input?.longitude !== "" && input?.longitude != null;
  if (hasLat !== hasLng) throw new AttendanceError("أدخل خط العرض وخط الطول معاً");
  const latitude = hasLat ? Number(input.latitude) : null, longitude = hasLng ? Number(input.longitude) : null;
  if (latitude != null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) throw new AttendanceError("خط العرض غير صحيح");
  if (longitude != null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) throw new AttendanceError("خط الطول غير صحيح");
  const radius = Math.round(Number(input?.radiusMeters ?? 100));
  if (!Number.isFinite(radius) || radius < 10 || radius > 5000) throw new AttendanceError("نطاق الموقع يجب أن يكون بين 10 و5000 متر");
  const accuracy = Math.round(Number(input?.maxAccuracyMeters ?? 100));
  if (!Number.isFinite(accuracy) || accuracy < 5 || accuracy > 1000) throw new AttendanceError("أقصى دقة مقبولة يجب أن تكون بين 5 و1000 متر");
  const method = validMethod(input?.requiredMethod) ? String(input.requiredMethod) : "qr_gps";
  if (methodSteps(method).gps && latitude == null) throw new AttendanceError("طريقة التحقق تتطلب GPS؛ أدخل إحداثيات الموقع");
  const kind = ["office", "warehouse", "event", "photography", "transport", "other"].includes(String(input?.kind)) ? String(input.kind) : "office";
  const warehouseId = positive(input?.warehouseId);
  const isActive = input?.isActive !== false;
  if (id) {
    const saved = rowsOf(await executor.execute(sql`
      update attendance_locations set name = ${name}, kind = ${kind}, address = ${clean(input?.address, 500)}, latitude = ${latitude}, longitude = ${longitude}, radius_meters = ${radius},
        max_accuracy_meters = ${accuracy}, required_method = ${method}, warehouse_id = ${warehouseId}, is_active = ${isActive}, updated_at = now()
      where id = ${id} returning id
    `))[0];
    if (!saved) throw new AttendanceError("موقع العمل غير موجود", 404);
    return id;
  }
  const row = rowsOf(await executor.execute(sql`
    insert into attendance_locations (name, kind, address, latitude, longitude, radius_meters, max_accuracy_meters, required_method, warehouse_id, is_active, created_by)
    values (${name}, ${kind}, ${clean(input?.address, 500)}, ${latitude}, ${longitude}, ${radius}, ${accuracy}, ${method}, ${warehouseId}, ${isActive}, ${actor.id}) returning id
  `))[0];
  return Number(row.id);
}

// ─── Employee settings ───────────────────────────────────────

export type EmployeeAttendanceSettings = {
  staffId: number; enabled: boolean; primaryLocationId: number | null; requiredMethod: string; eventMethod: string | null; allowedMethods: string[]; scheduleType: string;
  shiftStart: string | null; shiftEnd: string | null; weeklyDaysOff: string[] | null; graceMinutes: number | null; overtimeEligible: boolean | null; payrollIntegration: boolean | null; eventAttendance: boolean;
};
const DEFAULT_ALLOWED = ["qr", "gps", "qr_gps"];
const settingsFromRow = (staffId: number, row: any): EmployeeAttendanceSettings => ({
  staffId,
  enabled: row?.enabled === true,
  primaryLocationId: row?.primary_location_id == null ? null : Number(row.primary_location_id),
  requiredMethod: String(row?.required_method ?? "qr_gps"),
  eventMethod: row?.event_method ?? null,
  allowedMethods: Array.isArray(row?.allowed_methods) ? row.allowed_methods.map(String) : DEFAULT_ALLOWED,
  scheduleType: String(row?.schedule_type ?? "fixed"),
  shiftStart: row?.shift_start ? String(row.shift_start).slice(0, 5) : null,
  shiftEnd: row?.shift_end ? String(row.shift_end).slice(0, 5) : null,
  weeklyDaysOff: Array.isArray(row?.weekly_days_off) ? row.weekly_days_off.map(String) : null,
  graceMinutes: row?.grace_minutes == null ? null : Number(row.grace_minutes),
  overtimeEligible: row?.overtime_eligible ?? null,
  payrollIntegration: row?.payroll_integration ?? null,
  eventAttendance: row?.event_attendance !== false,
});

export async function readEmployeeSettings(executor: Executor, staffId: number) {
  const row = rowsOf(await executor.execute(sql`select * from attendance_employee_settings where staff_id = ${staffId}`))[0];
  return settingsFromRow(staffId, row);
}

export async function saveEmployeeSettings(executor: Executor, staffId: number, input: any, actor: AttendanceActor) {
  if (!rowsOf(await executor.execute(sql`select id from staff where id = ${staffId}`)).length) throw new AttendanceError("الموظف غير موجود", 404);
  const method = validMethod(input?.requiredMethod) ? String(input.requiredMethod) : "qr_gps";
  const eventMethod = input?.eventMethod ? (validMethod(input.eventMethod) ? String(input.eventMethod) : null) : null;
  const allowed = Array.isArray(input?.allowedMethods) ? [...new Set(input.allowedMethods.map(String).filter(validMethod))] : DEFAULT_ALLOWED;
  if (method !== "manual" && !allowed.includes(method)) allowed.push(method);
  if (eventMethod && eventMethod !== "manual" && !allowed.includes(eventMethod)) allowed.push(eventMethod);
  const schedule = ["fixed", "rotating", "flexible", "event", "part_time"].includes(String(input?.scheduleType)) ? String(input.scheduleType) : "fixed";
  const shiftStart = input?.shiftStart ? (isTime(input.shiftStart) ? String(input.shiftStart).slice(0, 5) : null) : null;
  const shiftEnd = input?.shiftEnd ? (isTime(input.shiftEnd) ? String(input.shiftEnd).slice(0, 5) : null) : null;
  if (Boolean(shiftStart) !== Boolean(shiftEnd)) throw new AttendanceError("أدخل بداية الدوام ونهايته معاً");
  const grace = input?.graceMinutes === "" || input?.graceMinutes == null ? null : Math.round(Number(input.graceMinutes));
  if (grace != null && (!Number.isFinite(grace) || grace < 0 || grace > 240)) throw new AttendanceError("فترة السماح يجب أن تكون بين 0 و240 دقيقة");
  const daysOff = Array.isArray(input?.weeklyDaysOff) ? [...new Set(input.weeklyDaysOff.map(String).filter((day: string) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(day)))] : null;
  const locationId = positive(input?.primaryLocationId);
  const enabled = input?.enabled === true;
  if (enabled && methodSteps(method).qr && !locationId && schedule !== "event") throw new AttendanceError("طريقة QR تحتاج موقع عمل أساسي");
  const tri = (value: unknown) => (value === true ? true : value === false ? false : null);
  await executor.execute(sql`
    insert into attendance_employee_settings (staff_id, enabled, primary_location_id, required_method, event_method, allowed_methods, schedule_type, shift_start, shift_end, weekly_days_off, grace_minutes, overtime_eligible, payroll_integration, event_attendance, updated_by, updated_at)
    values (${staffId}, ${enabled}, ${locationId}, ${method}, ${eventMethod}, ${JSON.stringify(allowed)}::jsonb, ${schedule}, ${shiftStart}, ${shiftEnd}, ${daysOff ? JSON.stringify(daysOff) : null}::jsonb, ${grace}, ${tri(input?.overtimeEligible)}, ${tri(input?.payrollIntegration)}, ${input?.eventAttendance !== false}, ${actor.id}, now())
    on conflict (staff_id) do update set enabled = excluded.enabled, primary_location_id = excluded.primary_location_id, required_method = excluded.required_method, event_method = excluded.event_method,
      allowed_methods = excluded.allowed_methods, schedule_type = excluded.schedule_type, shift_start = excluded.shift_start, shift_end = excluded.shift_end, weekly_days_off = excluded.weekly_days_off,
      grace_minutes = excluded.grace_minutes, overtime_eligible = excluded.overtime_eligible, payroll_integration = excluded.payroll_integration, event_attendance = excluded.event_attendance, updated_by = excluded.updated_by, updated_at = now()
  `);
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, actor_id, actor_name, metadata)
    values ('staff', ${staffId}, 'attendance_settings_updated', 'تحديث إعدادات الحضور والانصراف', ${actor.id}, ${actor.name}, ${JSON.stringify({ enabled, requiredMethod: method, eventMethod, scheduleType: schedule })}::jsonb)
  `);
  return readEmployeeSettings(executor, staffId);
}

/** Effective schedule: this employee's attendance override, then salary settings, then company policy. */
export async function scheduleContexts(executor: Executor, staffIds: number[]) {
  const ids = [...new Set(staffIds)];
  const map = new Map<number, { settings: EmployeeAttendanceSettings; schedule: ScheduleInput }>();
  if (!ids.length) return map;
  const policy = await readAttendancePolicy(executor);
  const settingsRows = rowsOf(await executor.execute(sql`select * from attendance_employee_settings where staff_id in (${idList(ids)})`));
  const salaryRows = rowsOf(await executor.execute(sql`select staff_id, shift_start, shift_end, weekly_days_off from employee_salary_settings where staff_id in (${idList(ids)})`));
  const settingsBy = new Map(settingsRows.map((row) => [Number(row.staff_id), row]));
  const salaryBy = new Map(salaryRows.map((row) => [Number(row.staff_id), row]));
  for (const id of ids) {
    const settings = settingsFromRow(id, settingsBy.get(id));
    const salary = salaryBy.get(id);
    const salaryDays = Array.isArray(salary?.weekly_days_off) && salary.weekly_days_off.length ? salary.weekly_days_off.map(String) : null;
    map.set(id, {
      settings,
      schedule: {
        enabled: settings.enabled,
        scheduleType: settings.scheduleType,
        shiftStart: settings.shiftStart ?? (salary?.shift_start ? String(salary.shift_start).slice(0, 5) : policy.workStart),
        shiftEnd: settings.shiftEnd ?? (salary?.shift_end ? String(salary.shift_end).slice(0, 5) : policy.workEnd),
        weeklyDaysOff: settings.weeklyDaysOff ?? salaryDays ?? ["fri"],
        graceMinutes: settings.graceMinutes ?? policy.lateGraceMinutes,
        holidays: policy.holidays,
        primaryLocationId: settings.primaryLocationId,
      },
    });
  }
  return map;
}

// ─── Shifts ──────────────────────────────────────────────────

const shiftFromRow = (row: any): ExpectedShift & { staffId: number; date: string; status: string; payAmount: number | null; locationName: string | null; staffName: string | null; notes: string | null } => ({
  shiftId: Number(row.id),
  staffId: Number(row.staff_id),
  date: String(row.shift_date).slice(0, 10),
  startMs: toMs(row.start_at) as number,
  endMs: toMs(row.end_at) as number,
  graceMinutes: row.grace_minutes == null ? 0 : Number(row.grace_minutes),
  kind: String(row.kind),
  locationId: row.location_id == null ? null : Number(row.location_id),
  requiredMethod: row.required_method ?? null,
  title: row.title ?? null,
  bookingSource: row.booking_source ?? null,
  bookingId: row.booking_id == null ? null : Number(row.booking_id),
  status: String(row.status),
  payAmount: row.pay_amount == null ? null : Number(row.pay_amount),
  locationName: row.location_name ?? null,
  staffName: row.staff_name ?? null,
  notes: row.notes ?? null,
});

export async function shiftsBetween(executor: Executor, options: { staffIds?: number[]; from: string; to: string; bookingSource?: string | null; bookingId?: number | null; includeCancelled?: boolean; limit?: number }) {
  const rows = rowsOf(await executor.execute(sql`
    select s.*, l.name as location_name, st.full_name as staff_name
    from attendance_shifts s left join attendance_locations l on l.id = s.location_id left join staff st on st.id = s.staff_id
    where s.shift_date between ${options.from}::date and ${options.to}::date
      ${options.includeCancelled ? sql`` : sql`and s.status <> 'cancelled'`}
      ${options.staffIds ? (options.staffIds.length ? sql`and s.staff_id in (${idList(options.staffIds)})` : sql`and false`) : sql``}
      ${options.bookingId ? sql`and s.booking_source = ${options.bookingSource ?? null} and s.booking_id = ${options.bookingId}` : sql``}
    order by s.shift_date asc, s.start_at asc, s.id asc ${options.limit ? sql`limit ${options.limit}` : sql``}
  `));
  return rows.map(shiftFromRow);
}

function shiftTimes(date: string, start: unknown, end: unknown) {
  if (!isDate(date)) throw new AttendanceError("تاريخ الوردية غير صحيح");
  if (!isTime(start) || !isTime(end)) throw new AttendanceError("أدخل وقت بداية الوردية ونهايتها");
  const startAt = baghdadMoment(date, String(start));
  let endAt = baghdadMoment(date, String(end));
  if (endAt.getTime() <= startAt.getTime()) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000); // Crosses midnight.
  return { startAt, endAt };
}

async function insertShift(executor: Executor, input: { staffId: number; date: string; startAt: Date; endAt: Date; kind: string; locationId: number | null; requiredMethod: string | null; graceMinutes: number | null; title: string | null; bookingSource: string | null; bookingId: number | null; payAmount: number | null; notes: string | null }, actor: AttendanceActor) {
  const row = rowsOf(await executor.execute(sql`
    insert into attendance_shifts (staff_id, shift_date, start_at, end_at, kind, location_id, required_method, grace_minutes, title, booking_source, booking_id, pay_amount, notes, created_by)
    values (${input.staffId}, ${input.date}, ${input.startAt.toISOString()}, ${input.endAt.toISOString()}, ${input.kind}, ${input.locationId}, ${input.requiredMethod}, ${input.graceMinutes}, ${input.title}, ${input.bookingSource}, ${input.bookingId}, ${input.payAmount == null ? null : String(input.payAmount)}, ${input.notes}, ${actor.id})
    returning id
  `))[0];
  return Number(row.id);
}

const shiftOptions = (input: any) => {
  const kind = ["fixed", "rotating", "flexible", "event", "part_time", "overnight"].includes(String(input?.kind)) ? String(input.kind) : "rotating";
  const requiredMethod = input?.requiredMethod ? (validMethod(input.requiredMethod) ? String(input.requiredMethod) : null) : null;
  const grace = input?.graceMinutes === "" || input?.graceMinutes == null ? null : Math.round(Number(input.graceMinutes));
  if (grace != null && (!Number.isFinite(grace) || grace < 0 || grace > 240)) throw new AttendanceError("فترة السماح يجب أن تكون بين 0 و240 دقيقة");
  return { kind, requiredMethod, graceMinutes: grace, locationId: positive(input?.locationId), title: clean(input?.title, 200), notes: clean(input?.notes, 1000) };
};

/** One day, or a date range with the weekdays to include. Days already holding a shift are skipped, never doubled. */
export async function createShifts(executor: Executor, input: any, actor: AttendanceActor) {
  const staffId = positive(input?.staffId);
  if (!staffId) throw new AttendanceError("اختر الموظف");
  const from = input?.date ?? input?.from, to = input?.to ?? from;
  if (!isDate(from) || !isDate(to) || from > to) throw new AttendanceError("الفترة غير صحيحة");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw new AttendanceError("الفترة لا تزيد عن ثلاثة أشهر");
  const options = shiftOptions(input);
  const days = Array.isArray(input?.days) && input.days.length ? new Set(input.days.map(String)) : null;
  const created: number[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (days && !days.has(["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T00:00:00Z`).getUTCDay()])) continue;
    const { startAt, endAt } = shiftTimes(date, input?.start, input?.end);
    const clash = rowsOf(await executor.execute(sql`
      select id from attendance_shifts where staff_id = ${staffId} and status <> 'cancelled' and start_at < ${endAt.toISOString()} and end_at > ${startAt.toISOString()} limit 1
    `))[0];
    if (clash) continue;
    created.push(await insertShift(executor, { staffId, date, startAt, endAt, ...options, bookingSource: null, bookingId: null, payAmount: null }, actor));
  }
  if (!created.length) throw new AttendanceError("لا يوجد يوم متاح: الفترة كلها فيها ورديات متداخلة لهذا الموظف", 409, "CONFLICT");
  return { created };
}

/** An attendance shift points at the original booking; it never adds a second assignment. */
export async function createBookingShift(executor: Executor, input: any, actor: AttendanceActor) {
  const staffId = positive(input?.staffId), bookingId = positive(input?.bookingId);
  const bookingSource = input?.bookingSource === "kosha" || input?.bookingSource === "service" ? String(input.bookingSource) : null;
  if (!staffId || !bookingId || !bookingSource) throw new AttendanceError("اختر الحجز والموظف");
  const options = shiftOptions({ ...input, kind: "event" });
  const { startAt, endAt } = shiftTimes(input?.date, input?.start, input?.end);
  const payAmount = input?.payAmount === "" || input?.payAmount == null ? null : Number(input.payAmount);
  if (payAmount != null && (!Number.isFinite(payAmount) || payAmount < 0 || payAmount > 1_000_000_000)) throw new AttendanceError("أجر المناسبة غير صحيح");
  const clash = rowsOf(await executor.execute(sql`
    select s.id, s.booking_id from attendance_shifts s where s.staff_id = ${staffId} and s.status <> 'cancelled' and s.start_at < ${endAt.toISOString()} and s.end_at > ${startAt.toISOString()} limit 1
  `))[0];
  if (clash) throw new AttendanceError(clash.booking_id ? `لهذا الموظف وردية متداخلة على الحجز #${clash.booking_id}` : "لهذا الموظف وردية متداخلة في هذا الوقت", 409, "CONFLICT");
  const id = await insertShift(executor, { staffId, date: input.date, startAt, endAt, ...options, kind: "event", title: options.title, bookingSource, bookingId, payAmount, notes: options.notes }, actor);
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, actor_id, actor_name, metadata)
    values (${bookingSource === "kosha" ? "kosha_booking" : "service_order"}, ${bookingId}, 'attendance_shift_created', 'إنشاء وردية حضور للحجز', ${actor.id}, ${actor.name}, ${JSON.stringify({ shiftId: id, staffId })}::jsonb)
  `);
  return { id };
}

export async function cancelShift(executor: Executor, id: number) {
  const row = rowsOf(await executor.execute(sql`select id, status from attendance_shifts where id = ${id} for update`))[0];
  if (!row) throw new AttendanceError("الوردية غير موجودة", 404);
  if (rowsOf(await executor.execute(sql`select id from attendance_records where shift_id = ${id} limit 1`)).length)
    throw new AttendanceError("سُجل حضور على هذه الوردية؛ لا يمكن إلغاؤها", 409, "CONFLICT");
  await executor.execute(sql`update attendance_shifts set status = 'cancelled', updated_at = now() where id = ${id}`);
}

// ─── Kiosks ──────────────────────────────────────────────────

export async function listKiosks(executor: Executor) {
  const rows = rowsOf(await executor.execute(sql`
    select k.id, k.name, k.location_id, l.name as location_name, k.is_active, k.last_seen_at, k.created_at
    from attendance_kiosks k join attendance_locations l on l.id = k.location_id order by k.is_active desc, k.id desc
  `));
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), locationId: Number(row.location_id), locationName: String(row.location_name), isActive: row.is_active === true, lastSeenAt: row.last_seen_at ?? null, createdAt: row.created_at ?? null }));
}

/** The device link appears once; only its hash is stored. */
export async function createKiosk(executor: Executor, input: any, actor: AttendanceActor) {
  const locationId = positive(input?.locationId);
  if (!locationId) throw new AttendanceError("اختر موقع العمل");
  const location = rowsOf(await executor.execute(sql`select id, name, is_active from attendance_locations where id = ${locationId}`))[0];
  if (!location || location.is_active !== true) throw new AttendanceError("موقع العمل غير نشط");
  const deviceToken = newKioskDeviceToken();
  const name = clean(input?.name, 120) ?? `شاشة ${location.name}`;
  const row = rowsOf(await executor.execute(sql`
    insert into attendance_kiosks (name, location_id, device_token_hash, qr_secret, created_by) values (${name}, ${locationId}, ${sha256(deviceToken)}, ${newKioskSecret()}, ${actor.id}) returning id
  `))[0];
  return { id: Number(row.id), deviceToken };
}

export async function revokeKiosk(executor: Executor, id: number) {
  const row = rowsOf(await executor.execute(sql`update attendance_kiosks set is_active = false, revoked_at = now() where id = ${id} returning id`))[0];
  if (!row) throw new AttendanceError("الشاشة غير موجودة", 404);
}

/** What the public kiosk may show: no employee, payroll or attendance history ever leaves here. */
export async function kioskDisplay(executor: Executor, deviceToken: string, nowMs = Date.now()) {
  const row = rowsOf(await executor.execute(sql`
    select k.id, k.name, k.qr_secret, l.name as location_name, k.last_seen_at
    from attendance_kiosks k join attendance_locations l on l.id = k.location_id
    where k.device_token_hash = ${sha256(deviceToken)} and k.is_active = true and l.is_active = true limit 1
  `))[0];
  if (!row) throw new AttendanceError("هذه الشاشة غير مفعلة", 404, "NOT_FOUND");
  const seen = toMs(row.last_seen_at);
  if (seen == null || nowMs - seen > 60_000) await executor.execute(sql`update attendance_kiosks set last_seen_at = now() where id = ${row.id}`);
  const { code, rotatesAt } = issueKioskCode(Number(row.id), String(row.qr_secret), nowMs);
  return { name: String(row.name), locationName: String(row.location_name), code, rotatesAt, serverTime: nowMs };
}

// ─── Today's state ───────────────────────────────────────────

type SessionRow = { id: number; startMs: number; endMs: number | null; shiftId: number | null; method: string | null; isEvent: boolean };

/** Sessions that belong to a day: started that day, or still open from before. */
async function sessionsFor(executor: Executor, staffIds: number[], date: string) {
  const map = new Map<number, SessionRow[]>();
  const leave = new Set<number>();
  if (!staffIds.length) return { sessions: map, leave };
  const start = baghdadMoment(date, "00:00").toISOString();
  const end = baghdadMoment(addDays(date, 1), "00:00").toISOString();
  const rows = rowsOf(await executor.execute(sql`
    select r.id, r.staff_id, r.check_in_at, r.check_out_at, r.status, r.shift_id, r.method, l.kind as location_kind, s.kind as shift_kind
    from attendance_records r left join attendance_shifts s on s.id = r.shift_id left join attendance_locations l on l.id = r.location_id
    where r.staff_id in (${idList(staffIds)}) and (
      (r.check_in_at >= (${start}::timestamptz at time zone 'utc') and r.check_in_at < (${end}::timestamptz at time zone 'utc'))
      or (r.check_out_at is null and r.check_in_at < (${end}::timestamptz at time zone 'utc') and r.status in ('present', 'late', 'out'))
    )
    order by r.check_in_at asc, r.id asc
  `));
  for (const row of rows) {
    const staffId = Number(row.staff_id);
    if (row.status === "paid_leave" || row.status === "unpaid_leave") { leave.add(staffId); continue; }
    if (row.status === "absent") continue;
    const startMs = toMs(row.check_in_at);
    if (startMs == null) continue;
    map.set(staffId, [...(map.get(staffId) ?? []), {
      id: Number(row.id), startMs, endMs: toMs(row.check_out_at), shiftId: row.shift_id == null ? null : Number(row.shift_id), method: row.method ?? null,
      isEvent: row.shift_kind === "event" || ["event", "photography", "transport"].includes(String(row.location_kind)),
    }]);
  }
  return { sessions: map, leave };
}

/** Only a weekly pattern has rest days; a flexible or shift-based employee simply has no shift that day. */
const hasWeeklyRest = (schedule: ScheduleInput, date: string) => (schedule.scheduleType === "fixed" || schedule.scheduleType === "part_time") && schedule.weeklyDaysOff.includes(dayKey(date));

function resolveShiftRow(rows: ReturnType<typeof shiftFromRow>[], staffId: number, schedule: ScheduleInput, date: string) {
  return rows.filter((row) => row.staffId === staffId && row.date === date).map((row) => ({ ...row, graceMinutes: row.graceMinutes || schedule.graceMinutes }));
}

export async function attendanceToday(executor: Executor, staffId: number, nowMs = Date.now()) {
  const date = baghdadDate(nowMs);
  const contexts = await scheduleContexts(executor, [staffId]);
  const { settings, schedule } = contexts.get(staffId)!;
  const staff = rowsOf(await executor.execute(sql`select full_name, username from staff where id = ${staffId}`))[0];
  const rows = await shiftsBetween(executor, { staffIds: [staffId], from: addDays(date, -1), to: date });
  const running = rows.filter((row) => (row.date === date) || (row.date < date && row.endMs > nowMs)).map((row) => ({ ...row, graceMinutes: row.graceMinutes || schedule.graceMinutes }));
  const expected = settings.enabled || running.length ? expectedShiftsFor(date, schedule, running) : [];
  const { sessions, leave } = await sessionsFor(executor, [staffId], date);
  const mine = sessions.get(staffId) ?? [];
  const open = mine.find((row) => row.endMs == null) ?? null;
  const isRestDay = hasWeeklyRest(schedule, date) && !running.length;
  const status: AttendanceDayStatus = dayStatusFor({ nowMs, expected, sessions: mine, onLeave: leave.has(staffId), isRestDay });
  const locations = await listLocations(executor);
  const byLocation = new Map(locations.map((row) => [row.id, row]));
  const describe = (shift: ExpectedShift) => {
    const location = byLocation.get(shift.locationId ?? settings.primaryLocationId ?? 0);
    const method = resolveMethod({ shiftMethod: shift.requiredMethod, isEvent: shift.kind === "event", eventMethod: settings.eventMethod, employeeMethod: settings.requiredMethod, locationMethod: location?.requiredMethod });
    return {
      shiftId: shift.shiftId, startMs: shift.startMs, endMs: shift.endMs, kind: shift.kind, title: shift.title, bookingSource: shift.bookingSource, bookingId: shift.bookingId,
      locationId: location?.id ?? null, locationName: location?.name ?? null, method, needsQr: methodSteps(method).qr, needsGps: methodSteps(method).gps, manualOnly: methodSteps(method).manual, allowedMethods: settings.allowedMethods,
    };
  };
  const shifts = expected.map(describe);
  const openShift = open ? shifts.find((row) => row.shiftId === open.shiftId) ?? null : null;
  const current = openShift ?? shifts.find((row) => row.endMs > nowMs) ?? shifts[0] ?? null;
  const fallback = !current ? describe({ shiftId: null, startMs: nowMs, endMs: nowMs, graceMinutes: 0, kind: "flexible", locationId: settings.primaryLocationId, requiredMethod: null, title: null, bookingSource: null, bookingId: null }) : null;
  return {
    enabled: settings.enabled,
    employeeName: staff?.full_name || staff?.username || "",
    date,
    serverTime: nowMs,
    status,
    statusLabel: DAY_STATUS_LABELS[status],
    workedMinutes: workedMinutes(mine),
    open: open ? { id: open.id, startMs: open.startMs } : null,
    shifts,
    current: current ?? fallback,
    scheduleType: settings.scheduleType,
    canCheckIn: settings.enabled && !open && !leave.has(staffId),
    canCheckOut: Boolean(open),
  };
}

// ─── Check-in and check-out ─────────────────────────────────

export type AttendanceSubmission = { action: "check_in" | "check_out"; qrCode?: unknown; gps?: Partial<GpsEvidence> | null; shiftId?: unknown };

const EARLY_WINDOW_MS = (policy: AttendancePolicy) => (policy.checkInEarlyMinutes ?? 120) * 60000;

/**
 * Every required step must pass before anything is written, and the server clock is the only clock.
 * Runs in the caller's transaction under a per-employee lock; the partial unique index is the last
 * line of defence against two open sessions.
 */
export async function recordAttendance(executor: Executor, staffId: number, input: AttendanceSubmission, nowMs = Date.now()) {
  await executor.execute(sql`select pg_advisory_xact_lock(${staffId})`);
  const policy = await readAttendancePolicy(executor);
  const contexts = await scheduleContexts(executor, [staffId]);
  const { settings, schedule } = contexts.get(staffId)!;
  if (!settings.enabled) throw new AttendanceError("التسجيل بالتحقق غير مفعل لحسابك؛ راجع المدير", 409, "NOT_ENABLED");
  const date = baghdadDate(nowMs);
  const open = rowsOf(await executor.execute(sql`select * from attendance_records where staff_id = ${staffId} and check_out_at is null and status in ('present', 'late', 'out') order by check_in_at desc, id desc limit 1 for update`))[0];
  let locationId: number | null;
  let method: string;
  let shiftId: number | null = null;
  let status = "present";
  let isEvent = false;

  if (input.action === "check_out") {
    if (!open) throw new AttendanceError("لا يوجد حضور مفتوح لتسجيل الانصراف", 409, "CONFLICT");
    if (nowMs < (toMs(open.check_in_at) as number)) throw new AttendanceError("وقت الانصراف لا يمكن أن يسبق الحضور", 409, "CONFLICT");
    shiftId = open.shift_id == null ? null : Number(open.shift_id);
    const shift = shiftId ? rowsOf(await executor.execute(sql`select * from attendance_shifts where id = ${shiftId}`))[0] : null;
    isEvent = shift?.kind === "event";
    locationId = open.location_id == null ? (shift?.location_id == null ? settings.primaryLocationId : Number(shift.location_id)) : Number(open.location_id);
    const location = locationId ? rowsOf(await executor.execute(sql`select required_method from attendance_locations where id = ${locationId}`))[0] : null;
    method = resolveMethod({ shiftMethod: shift?.required_method, isEvent, eventMethod: settings.eventMethod, employeeMethod: settings.requiredMethod, locationMethod: location?.required_method });
  } else {
    if (open) throw new AttendanceError("لديك تسجيل حضور مفتوح بالفعل", 409, "CONFLICT");
    if (rowsOf(await executor.execute(sql`select id from attendance_records where staff_id = ${staffId} and status in ('paid_leave', 'unpaid_leave') and check_in_at >= (${baghdadMoment(date, "00:00").toISOString()}::timestamptz at time zone 'utc') and check_in_at < (${baghdadMoment(addDays(date, 1), "00:00").toISOString()}::timestamptz at time zone 'utc') limit 1`)).length)
      throw new AttendanceError("لديك إجازة معتمدة اليوم", 409, "CONFLICT");
    const rows = await shiftsBetween(executor, { staffIds: [staffId], from: addDays(date, -1), to: date });
    const live = rows.filter((row) => row.date === date || row.endMs > nowMs).map((row) => ({ ...row, graceMinutes: row.graceMinutes || schedule.graceMinutes }));
    const expected = expectedShiftsFor(date, schedule, live);
    const chosenId = positive(input.shiftId);
    if (chosenId && !expected.some((row) => row.shiftId === chosenId)) throw new AttendanceError("هذه الوردية ليست لك أو ليست اليوم", 403, "PERMISSION_DENIED");
    const usedShifts = new Set(rowsOf(await executor.execute(sql`select shift_id from attendance_records where staff_id = ${staffId} and shift_id is not null and check_in_at >= (${new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString()}::timestamptz at time zone 'utc')`)).map((row) => Number(row.shift_id)));
    const eligible = expected.filter((row) => (!chosenId || row.shiftId === chosenId) && !(row.shiftId && usedShifts.has(row.shiftId)) && nowMs >= row.startMs - EARLY_WINDOW_MS(policy) && nowMs <= row.endMs);
    const shift = eligible[0];
    if (!shift) {
      if (schedule.scheduleType !== "flexible" || live.length) {
        if (chosenId && usedShifts.has(chosenId)) throw new AttendanceError("سجلت حضور هذه الوردية مسبقاً", 409, "CONFLICT");
        const upcoming = expected.find((row) => row.startMs > nowMs);
        if (upcoming) throw new AttendanceError("لم يبدأ وقت تسجيل حضور ورديتك بعد", 409, "OUTSIDE_SHIFT");
        if (expected.length) throw new AttendanceError("انتهى وقت ورديتك. إذا حضرت فعلاً، قدّم طلب تصحيح", 409, "OUTSIDE_SHIFT");
        throw new AttendanceError("لا توجد لك وردية مجدولة اليوم", 409, "NO_SHIFT");
      }
    }
    shiftId = shift?.shiftId ?? null;
    isEvent = shift?.kind === "event";
    if (isEvent && !settings.eventAttendance) throw new AttendanceError("تسجيل حضور المناسبات غير مفعل لحسابك", 403, "PERMISSION_DENIED");
    locationId = shift?.locationId ?? settings.primaryLocationId;
    const location = locationId ? rowsOf(await executor.execute(sql`select required_method from attendance_locations where id = ${locationId}`))[0] : null;
    method = resolveMethod({ shiftMethod: shift?.requiredMethod, isEvent, eventMethod: settings.eventMethod, employeeMethod: settings.requiredMethod, locationMethod: location?.required_method });
    if (shift && nowMs > shift.startMs + shift.graceMinutes * 60000) status = "late";
  }

  if (method === "any") {
    // Alternatives: whichever allowed evidence the employee brought decides the steps.
    const allowed = settings.allowedMethods;
    const hasQr = Boolean(input.qrCode), hasGps = input.gps != null;
    method = hasQr && hasGps && allowed.includes("qr_gps") ? "qr_gps" : hasQr && allowed.includes("qr") ? "qr" : hasGps && allowed.includes("gps") ? "gps" : "";
    if (!method) throw new AttendanceError("استخدم إحدى طرق التسجيل المسموحة لك", 422, "METHOD_REQUIRED");
  }
  const steps = methodSteps(method);
  if (steps.manual) throw new AttendanceError("تسجيلك يتم يدوياً بموافقة المدير؛ قدّم طلب تصحيح", 409, "MANUAL_ONLY");
  const location = locationId ? rowsOf(await executor.execute(sql`select * from attendance_locations where id = ${locationId} and is_active = true`))[0] : null;
  if ((steps.qr || steps.gps) && !location) throw new AttendanceError("لا يوجد موقع عمل نشط لورديتك؛ راجع المدير", 409, "NO_LOCATION");

  let kioskId: number | null = null;
  let tokenHash: string | null = null;
  if (steps.qr) {
    const parsed = parseKioskCode(input.qrCode);
    if (!parsed) throw new AttendanceError("امسح رمز QR الظاهر على شاشة الحضور", 422, "QR_REQUIRED");
    const kiosk = rowsOf(await executor.execute(sql`select id, location_id, qr_secret, is_active from attendance_kiosks where id = ${parsed.kioskId}`))[0];
    if (!kiosk || kiosk.is_active !== true) throw new AttendanceError("رمز QR غير صالح", 422, "QR_INVALID");
    const verified = verifyKioskCode(parsed, String(kiosk.qr_secret), nowMs);
    if (!verified.ok) throw new AttendanceError(verified.reason, 422, "QR_INVALID");
    if (Number(kiosk.location_id) !== locationId) throw new AttendanceError("هذا الرمز لموقع عمل آخر غير موقع ورديتك", 422, "QR_WRONG_LOCATION");
    kioskId = Number(kiosk.id);
    tokenHash = verified.tokenHash;
  }
  let distance: number | null = null;
  if (steps.gps) {
    const result = checkGps(input.gps, {
      latitude: location.latitude == null ? null : Number(location.latitude),
      longitude: location.longitude == null ? null : Number(location.longitude),
      radiusMeters: Number(location.radius_meters),
      maxAccuracyMeters: Number(location.max_accuracy_meters),
    });
    if (!result.ok) throw new AttendanceError(result.reason, 422, "GPS_REJECTED");
    distance = result.distance;
  }
  if (tokenHash) {
    // The same employee cannot reuse a code, while a queue of staff can share the code on screen.
    const used = rowsOf(await executor.execute(sql`
      insert into attendance_qr_uses (kiosk_id, token_hash, staff_id, event) values (${kioskId}, ${tokenHash}, ${staffId}, ${input.action}) on conflict (token_hash, staff_id) do nothing returning id
    `))[0];
    if (!used) throw new AttendanceError("استُخدم هذا الرمز مسبقاً. امسح الرمز الجديد على الشاشة", 409, "QR_REPLAYED");
  }
  const at = new Date(nowMs).toISOString();
  let record: any;
  if (input.action === "check_out") {
    record = rowsOf(await executor.execute(sql`
      update attendance_records set check_out_at = (${at}::timestamptz at time zone 'utc'), status = 'out', updated_at = now() where id = ${open.id} and check_out_at is null returning *
    `))[0];
    if (!record) throw new AttendanceError("تغيّر الحضور؛ حدّث الصفحة", 409, "CONFLICT");
  } else {
    try {
      record = rowsOf(await executor.execute(sql`
        insert into attendance_records (staff_id, check_in_at, status, notes, shift_id, location_id, method)
        values (${staffId}, (${at}::timestamptz at time zone 'utc'), ${status}, ${`source:${method}`}, ${shiftId}, ${locationId}, ${method}) returning *
      `))[0];
    } catch (cause: any) {
      if (cause?.code === "23505" || cause?.cause?.code === "23505") throw new AttendanceError("لديك تسجيل حضور مفتوح بالفعل", 409, "CONFLICT");
      throw cause;
    }
  }
  const gps = steps.gps ? input.gps : null;
  await executor.execute(sql`
    insert into attendance_verifications (record_id, staff_id, event, method, location_id, kiosk_id, latitude, longitude, accuracy_meters, distance_meters)
    values (${record.id}, ${staffId}, ${input.action}, ${method}, ${locationId}, ${kioskId}, ${gps?.latitude ?? null}, ${gps?.longitude ?? null}, ${gps?.accuracy ?? null}, ${distance == null ? null : Math.round(distance * 100) / 100})
  `);
  return { recordId: Number(record.id), action: input.action, status: String(record.status), method, atMs: nowMs, locationName: location?.name ?? null };
}

// ─── Dashboard and records ──────────────────────────────────

export async function attendanceDashboard(executor: Executor, options: { date?: string | null; nowMs?: number; search?: string | null; department?: string | null; locationId?: number | null; status?: string | null; method?: string | null; staffId?: number | null } = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const today = baghdadDate(nowMs);
  const date = isDate(options.date) ? options.date : today;
  const staff = rowsOf(await executor.execute(sql`
    select id, full_name, username, department, job_title, photo_url from staff where is_active = true order by coalesce(nullif(full_name, ''), username) asc
  `));
  const ids = staff.map((row) => Number(row.id));
  const contexts = await scheduleContexts(executor, ids);
  const shifts = await shiftsBetween(executor, { staffIds: ids, from: addDays(date, -1), to: date });
  const { sessions, leave } = await sessionsFor(executor, ids, date);
  const locations = await listLocations(executor);
  const byLocation = new Map(locations.map((row) => [row.id, row]));
  const effectiveNow = date < today ? baghdadMoment(addDays(date, 1), "00:00").getTime() : date > today ? baghdadMoment(date, "00:00").getTime() : nowMs;
  const rows = staff.map((row) => {
    const id = Number(row.id);
    const context = contexts.get(id)!;
    const mine = sessions.get(id) ?? [];
    const rowsToday = resolveShiftRow(shifts, id, context.schedule, date);
    const overnight = shifts.filter((shift) => shift.staffId === id && shift.date < date && shift.endMs > effectiveNow).map((shift) => ({ ...shift, graceMinutes: shift.graceMinutes || context.schedule.graceMinutes }));
    const live = [...overnight, ...rowsToday];
    // Only employees on this system, or with a shift row, are expected. Nobody else counts as absent.
    const expected = context.settings.enabled || live.length ? expectedShiftsFor(date, context.schedule, live) : [];
    const isRestDay = context.settings.enabled && !live.length && hasWeeklyRest(context.schedule, date);
    const status = dayStatusFor({ nowMs: effectiveNow, expected, sessions: mine, onLeave: leave.has(id), isRestDay });
    const first = expected[0];
    const locationId = mine.at(-1)?.shiftId ? expected.find((shift) => shift.shiftId === mine.at(-1)?.shiftId)?.locationId ?? first?.locationId : first?.locationId ?? context.settings.primaryLocationId;
    const firstIn = mine.length ? Math.min(...mine.map((session) => session.startMs)) : null;
    const closed = mine.filter((session) => session.endMs != null);
    return {
      staffId: id,
      name: row.full_name || row.username,
      department: row.department ?? null,
      jobTitle: row.job_title ?? null,
      photoUrl: row.photo_url ?? null,
      enabled: context.settings.enabled,
      locationId: locationId ?? null,
      locationName: locationId ? byLocation.get(locationId)?.name ?? null : null,
      shiftStartMs: first?.startMs ?? null,
      shiftEndMs: expected.at(-1)?.endMs ?? null,
      checkInMs: firstIn,
      checkOutMs: closed.length === mine.length && closed.length ? Math.max(...closed.map((session) => session.endMs as number)) : null,
      workedMinutes: workedMinutes(mine),
      method: mine.at(-1)?.method ?? null,
      status,
      statusLabel: DAY_STATUS_LABELS[status],
      isLate: Boolean(first && firstIn && firstIn > first.startMs + first.graceMinutes * 60000),
      missingCheckOut: date < today && mine.some((session) => session.endMs == null),
      bookingSource: expected.find((shift) => shift.bookingId)?.bookingSource ?? null,
      bookingId: expected.find((shift) => shift.bookingId)?.bookingId ?? null,
    };
  });
  const search = String(options.search ?? "").trim().toLowerCase();
  const filtered = rows.filter((row) =>
    (!options.staffId || row.staffId === options.staffId) &&
    (!search || String(row.name).toLowerCase().includes(search)) &&
    (!options.department || row.department === options.department) &&
    (!options.locationId || row.locationId === options.locationId) &&
    (!options.status || row.status === options.status) &&
    (!options.method || row.method === options.method));
  const count = (...statuses: AttendanceDayStatus[]) => rows.filter((row) => statuses.includes(row.status)).length;
  return {
    date,
    serverTime: nowMs,
    summary: {
      total: rows.length,
      presentNow: count("present", "late", "mission"),
      late: rows.filter((row) => row.isLate).length,
      absent: count("absent"),
      out: count("out"),
      mission: count("mission"),
      onLeave: count("leave"),
      scheduled: rows.filter((row) => row.shiftStartMs != null).length,
    },
    rows: filtered,
    departments: [...new Set(rows.map((row) => row.department).filter(Boolean))],
    locations: locations.map((row) => ({ id: row.id, name: row.name })),
  };
}

export async function attendanceRecords(executor: Executor, options: { from?: string | null; to?: string | null; staffId?: number | null; locationId?: number | null; method?: string | null; page?: unknown; pageSize?: unknown; includeLocation?: boolean }) {
  const from = isDate(options.from) ? options.from : addDays(baghdadDate(), -6);
  const to = isDate(options.to) ? options.to : baghdadDate();
  const pageSize = Math.max(1, Math.min(2000, Math.floor(Number(options.pageSize) || 50)));
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const where = sql`
    r.check_in_at >= (${baghdadMoment(from, "00:00").toISOString()}::timestamptz at time zone 'utc') and r.check_in_at < (${baghdadMoment(addDays(to, 1), "00:00").toISOString()}::timestamptz at time zone 'utc')
    ${options.staffId ? sql`and r.staff_id = ${options.staffId}` : sql``}
    ${options.locationId ? sql`and r.location_id = ${options.locationId}` : sql``}
    ${options.method ? sql`and r.method = ${options.method}` : sql``}
  `;
  const [listed, counted] = [await executor.execute(sql`
    select r.id, r.staff_id, st.full_name, st.username, st.department, r.check_in_at, r.check_out_at, r.status, r.method, r.overtime_approved_minutes, r.shift_id, l.name as location_name,
      s.title as shift_title, s.booking_source, s.booking_id, s.kind as shift_kind, s.start_at as shift_start, s.end_at as shift_end
      ${options.includeLocation ? sql`, (select jsonb_agg(jsonb_build_object('event', v.event, 'method', v.method, 'latitude', v.latitude, 'longitude', v.longitude, 'accuracy', v.accuracy_meters, 'distance', v.distance_meters) order by v.id) from attendance_verifications v where v.record_id = r.id) as evidence` : sql``}
    from attendance_records r join staff st on st.id = r.staff_id left join attendance_locations l on l.id = r.location_id left join attendance_shifts s on s.id = r.shift_id
    where ${where} order by r.check_in_at desc, r.id desc limit ${pageSize} offset ${(page - 1) * pageSize}
  `), await executor.execute(sql`select count(*)::int as total from attendance_records r where ${where}`)];
  const data = rowsOf(listed).map((row) => {
    const inMs = toMs(row.check_in_at), outMs = toMs(row.check_out_at);
    return {
      id: Number(row.id), staffId: Number(row.staff_id), name: row.full_name || row.username, department: row.department ?? null, checkInMs: inMs, checkOutMs: outMs, status: String(row.status),
      method: row.method ?? null, workedMinutes: inMs != null && outMs != null ? Math.max(0, Math.round((outMs - inMs) / 60000)) : 0, overtimeApprovedMinutes: row.overtime_approved_minutes == null ? null : Number(row.overtime_approved_minutes),
      locationName: row.location_name ?? null, shiftTitle: row.shift_title ?? null, shiftKind: row.shift_kind ?? null, bookingSource: row.booking_source ?? null, bookingId: row.booking_id == null ? null : Number(row.booking_id),
      evidence: options.includeLocation ? row.evidence ?? [] : undefined,
    };
  });
  const total = Number(rowsOf(counted)[0]?.total ?? 0);
  return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), from, to };
}

// ─── Corrections ─────────────────────────────────────────────

export async function createCorrection(executor: Executor, staffId: number, input: any) {
  const workDate = input?.workDate;
  if (!isDate(workDate)) throw new AttendanceError("اختر التاريخ");
  if (workDate > baghdadDate()) throw new AttendanceError("لا يمكن طلب تصحيح ليوم قادم");
  const type = String(input?.requestType ?? "");
  if (!CORRECTION_TYPES[type]) throw new AttendanceError("اختر نوع الطلب");
  const reason = clean(input?.reason, 1000);
  if (!reason || reason.length < 3) throw new AttendanceError("اكتب سبب الطلب");
  const checkIn = input?.checkInTime ? (isTime(input.checkInTime) ? baghdadMoment(workDate, input.checkInTime) : null) : null;
  let checkOut = input?.checkOutTime ? (isTime(input.checkOutTime) ? baghdadMoment(workDate, input.checkOutTime) : null) : null;
  if (!checkIn && !checkOut) throw new AttendanceError("أدخل وقت الحضور أو الانصراف المطلوب");
  if (checkIn && checkOut && checkOut.getTime() <= checkIn.getTime()) checkOut = new Date(checkOut.getTime() + 24 * 60 * 60 * 1000); // Overnight.
  const attachment = input?.attachment == null || input.attachment === "" ? null : String(input.attachment);
  if (attachment && attachment.length > 4_000_000) throw new AttendanceError("المرفق كبير جداً");
  const duplicate = rowsOf(await executor.execute(sql`select id from attendance_corrections where staff_id = ${staffId} and work_date = ${workDate}::date and request_type = ${type} and status = 'pending' limit 1`))[0];
  if (duplicate) throw new AttendanceError("لديك طلب مماثل بانتظار الموافقة", 409, "CONFLICT");
  const row = rowsOf(await executor.execute(sql`
    insert into attendance_corrections (staff_id, work_date, request_type, requested_check_in, requested_check_out, reason, attachment)
    values (${staffId}, ${workDate}, ${type}, ${checkIn?.toISOString() ?? null}, ${checkOut?.toISOString() ?? null}, ${reason}, ${attachment}) returning id
  `))[0];
  return { id: Number(row.id) };
}

export async function listCorrections(executor: Executor, options: { staffId?: number | null; status?: string | null; includeAttachment?: boolean } = {}) {
  const rows = rowsOf(await executor.execute(sql`
    select c.id, c.staff_id, st.full_name, st.username, st.department, c.work_date, c.request_type, c.requested_check_in, c.requested_check_out, c.record_id, c.reason, c.status, c.reviewed_by_name, c.reviewed_at, c.review_note, c.created_at, (c.attachment is not null) as has_attachment
      ${options.includeAttachment ? sql`, c.attachment` : sql``}
    from attendance_corrections c join staff st on st.id = c.staff_id
    where true ${options.staffId ? sql`and c.staff_id = ${options.staffId}` : sql``} ${options.status ? sql`and c.status = ${options.status}` : sql``}
    order by (c.status = 'pending') desc, c.created_at desc limit 200
  `));
  return rows.map((row) => ({
    id: Number(row.id), staffId: Number(row.staff_id), name: row.full_name || row.username, department: row.department ?? null, workDate: String(row.work_date).slice(0, 10), requestType: String(row.request_type),
    checkInMs: toMs(row.requested_check_in), checkOutMs: toMs(row.requested_check_out), recordId: row.record_id == null ? null : Number(row.record_id), reason: String(row.reason), status: String(row.status),
    reviewedByName: row.reviewed_by_name ?? "", reviewedAt: row.reviewed_at ?? null, reviewNote: row.review_note ?? null, createdAt: row.created_at ?? null, hasAttachment: row.has_attachment === true, attachment: options.includeAttachment ? row.attachment ?? null : undefined,
  }));
}

/**
 * Approval edits the attendance record in the same transaction and leaves an append-only trail.
 * The caller recalculates draft payroll afterwards; a finalized run is reported, never rewritten.
 */
export async function reviewCorrection(executor: Executor, id: number, input: { approve: boolean; note?: unknown }, actor: AttendanceActor) {
  const row = rowsOf(await executor.execute(sql`select * from attendance_corrections where id = ${id} for update`))[0];
  if (!row) throw new AttendanceError("الطلب غير موجود", 404, "NOT_FOUND");
  if (row.status !== "pending") throw new AttendanceError("تمت مراجعة هذا الطلب مسبقاً", 409, "CONFLICT");
  if (actor.id != null && Number(row.staff_id) === actor.id) throw new AttendanceError("لا يمكنك مراجعة طلبك أنت", 403, "PERMISSION_DENIED");
  const note = clean(input.note, 1000);
  const staffId = Number(row.staff_id);
  const workDate = String(row.work_date).slice(0, 10);
  let recordId: number | null = null;
  if (input.approve) {
    await executor.execute(sql`select pg_advisory_xact_lock(${staffId})`);
    const checkIn = toMs(row.requested_check_in), checkOut = toMs(row.requested_check_out);
    const dayStart = baghdadMoment(workDate, "00:00").toISOString(), dayEnd = baghdadMoment(addDays(workDate, 1), "00:00").toISOString();
    const existing = rowsOf(await executor.execute(sql`
      select * from attendance_records where staff_id = ${staffId} and status in ('present', 'late', 'out')
        and check_in_at >= (${dayStart}::timestamptz at time zone 'utc') and check_in_at < (${dayEnd}::timestamptz at time zone 'utc')
      order by (check_out_at is null) desc, check_in_at desc limit 1 for update
    `))[0];
    if (existing) {
      const nextIn = checkIn ?? toMs(existing.check_in_at);
      const nextOut = checkOut ?? toMs(existing.check_out_at);
      if (nextIn != null && nextOut != null && nextOut <= nextIn) throw new AttendanceError("وقت الانصراف يجب أن يكون بعد وقت الحضور", 422);
      const saved = rowsOf(await executor.execute(sql`
        update attendance_records set check_in_at = (${new Date(nextIn as number).toISOString()}::timestamptz at time zone 'utc'),
          check_out_at = ${nextOut == null ? null : sql`(${new Date(nextOut).toISOString()}::timestamptz at time zone 'utc')`},
          status = ${nextOut == null ? existing.status : "out"}, edited_by = ${actor.id}, notes = concat_ws(E'\n', notes, ${`تصحيح معتمد #${id}`}::text), updated_at = now()
        where id = ${existing.id} returning id
      `))[0];
      recordId = Number(saved.id);
    } else {
      if (checkIn == null) throw new AttendanceError("لا يوجد حضور مسجل لهذا اليوم؛ الطلب يحتاج وقت حضور", 422);
      let saved: any;
      try {
        saved = rowsOf(await executor.execute(sql`
          insert into attendance_records (staff_id, check_in_at, check_out_at, status, notes, edited_by, method)
          values (${staffId}, (${new Date(checkIn).toISOString()}::timestamptz at time zone 'utc'), ${checkOut == null ? null : sql`(${new Date(checkOut).toISOString()}::timestamptz at time zone 'utc')`},
            ${checkOut == null ? "present" : "out"}, ${`تصحيح معتمد #${id}`}, ${actor.id}, 'manual') returning id
        `))[0];
      } catch (cause: any) {
        if (cause?.code === "23505" || cause?.cause?.code === "23505") throw new AttendanceError("لدى الموظف حضور مفتوح؛ يُغلق أولاً ثم يُعتمد هذا الطلب", 409, "CONFLICT");
        throw cause;
      }
      recordId = Number(saved.id);
    }
    await executor.execute(sql`
      insert into attendance_verifications (record_id, staff_id, event, method) values (${recordId}, ${staffId}, 'correction', 'manual')
    `);
  }
  await executor.execute(sql`
    update attendance_corrections set status = ${input.approve ? "approved" : "rejected"}, record_id = ${recordId}, reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(), review_note = ${note}, updated_at = now() where id = ${id}
  `);
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, body, actor_id, actor_name, metadata)
    values ('attendance_correction', ${id}, ${input.approve ? "attendance_correction_approved" : "attendance_correction_rejected"}, ${input.approve ? "اعتماد تصحيح حضور" : "رفض تصحيح حضور"}, ${note}, ${actor.id}, ${actor.name}, ${JSON.stringify({ staffId, workDate, recordId, before: { requestType: row.request_type } })}::jsonb)
  `);
  return { staffId, workDate, recordId };
}

export async function approveOvertime(executor: Executor, recordId: number, minutes: unknown, actor: AttendanceActor) {
  const value = Math.round(Number(minutes));
  if (!Number.isFinite(value) || value < 0 || value > 24 * 60) throw new AttendanceError("عدد دقائق الإضافي غير صحيح");
  const row = rowsOf(await executor.execute(sql`update attendance_records set overtime_approved_minutes = ${value}, edited_by = ${actor.id}, updated_at = now() where id = ${recordId} returning staff_id, check_in_at`))[0];
  if (!row) throw new AttendanceError("السجل غير موجود", 404, "NOT_FOUND");
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, actor_id, actor_name, metadata)
    values ('attendance_record', ${recordId}, 'attendance_overtime_approved', 'اعتماد ساعات إضافية', ${actor.id}, ${actor.name}, ${JSON.stringify({ minutes: value })}::jsonb)
  `);
  return { staffId: Number(row.staff_id), workDate: baghdadDate(toMs(row.check_in_at) as number) };
}

/**
 * Per-event pay becomes one approved bonus through the existing bonus workflow, so a manager still
 * selects it into a payroll line and the existing payment flow pays it. Attendance itself moves no money.
 */
export async function approveEventCompensation(executor: Executor, shiftId: number, actor: AttendanceActor) {
  const shift = rowsOf(await executor.execute(sql`select * from attendance_shifts where id = ${shiftId} for update`))[0];
  if (!shift) throw new AttendanceError("الوردية غير موجودة", 404, "NOT_FOUND");
  if (shift.status === "cancelled") throw new AttendanceError("الوردية ملغاة", 409, "CONFLICT");
  if (!shift.booking_id || !(Number(shift.pay_amount) > 0)) throw new AttendanceError("هذه الوردية بلا أجر مناسبة متفق عليه", 409, "CONFLICT");
  const verified = rowsOf(await executor.execute(sql`select id from attendance_records where shift_id = ${shiftId} and check_out_at is not null limit 1`))[0];
  if (!verified) throw new AttendanceError("لم يُتحقق من حضور وانصراف هذه الوردية بعد", 409, "NOT_VERIFIED");
  const paidAsDriver = rowsOf(await executor.execute(sql`
    select id from vehicle_expenses where expense_type = 'driver_wage' and driver_id = ${shift.staff_id} and status not in ('rejected', 'cancelled')
      and ${shift.booking_source === "kosha" ? sql`booking_id = ${shift.booking_id}` : sql`service_order_id = ${shift.booking_id}`} limit 1
  `))[0];
  if (paidAsDriver) throw new AttendanceError("سُجلت أجرة سائق لهذا الموظف على نفس الحجز؛ لا تُحتسب مرتين", 409, "CONFLICT");
  const amount = Number(shift.pay_amount);
  const period = String(shift.shift_date).slice(0, 7);
  const saved = rowsOf(await executor.execute(sql`
    insert into hr_incentive_events (staff_id, period, kind, amount, title, reason, status, created_by, created_by_name, bonus_type, bonus_source, source_type, source_id, calculation_method, quantity, rate_per_unit, base_amount, approved_by, approved_by_name, approval_date)
    values (${shift.staff_id}, ${period}, 'bonus', ${String(amount)}, ${`أجر مناسبة حجز #${shift.booking_id}`}, ${shift.title ?? null}, 'approved', ${actor.id}, ${actor.name}, 'event_compensation', 'attendance', 'attendance_shift', ${String(shiftId)}, 'fixed', '1', ${String(amount)}, ${String(amount)}, ${actor.id}, ${actor.name}, now())
    on conflict do nothing returning id
  `))[0];
  if (!saved) return { created: false, duplicate: true };
  return { created: true, duplicate: false, bonusId: Number(saved.id), amount };
}

/** Per-employee totals for a period, through the same calculation payroll uses. */
export async function attendanceReport(executor: Executor, options: { from: string; to: string; staffId?: number | null; department?: string | null; locationId?: number | null }) {
  if (!isDate(options.from) || !isDate(options.to) || options.from > options.to) throw new AttendanceError("الفترة غير صحيحة");
  if ((Date.parse(options.to) - Date.parse(options.from)) / 86400000 > 370) throw new AttendanceError("الفترة لا تزيد عن سنة");
  const staff = rowsOf(await executor.execute(sql`
    select s.id, s.full_name, s.username, s.department, s.salary_type, s.base_salary, s.daily_working_hours, s.working_days_per_week, s.overtime_rate, s.hourly_rate,
      ss.shift_start, ss.shift_end, ss.weekly_days_off, ss.enable_attendance_integration
    from staff s left join employee_salary_settings ss on ss.staff_id = s.id
    where s.is_active = true ${options.staffId ? sql`and s.id = ${options.staffId}` : sql``} ${options.department ? sql`and s.department = ${options.department}` : sql``}
    order by coalesce(nullif(s.full_name, ''), s.username) asc
  `));
  const ids = staff.map((row) => Number(row.id));
  if (!ids.length) return { from: options.from, to: options.to, data: [] };
  const [policy, schedules, records, eventRows] = [
    await readAttendancePolicy(executor),
    await payrollScheduleInputs(executor, ids, options.from, options.to),
    rowsOf(await executor.execute(sql`
      select id, staff_id, status, check_in_at, check_out_at, overtime_approved_minutes, location_id from attendance_records
      where staff_id in (${idList(ids)}) and check_in_at >= (${baghdadMoment(options.from, "00:00").toISOString()}::timestamptz at time zone 'utc') and check_in_at < (${baghdadMoment(addDays(options.to, 1), "00:00").toISOString()}::timestamptz at time zone 'utc')
      order by staff_id, check_in_at, id
    `)),
    rowsOf(await executor.execute(sql`
      select s.staff_id, count(*)::int as shifts, count(r.id)::int as attended from attendance_shifts s left join attendance_records r on r.shift_id = s.id
      where s.staff_id in (${idList(ids)}) and s.kind = 'event' and s.status <> 'cancelled' and s.shift_date between ${options.from}::date and ${options.to}::date group by s.staff_id
    `)),
  ];
  const byStaff = new Map<number, any[]>();
  for (const row of records) byStaff.set(Number(row.staff_id), [...(byStaff.get(Number(row.staff_id)) ?? []), row]);
  const events = new Map(eventRows.map((row) => [Number(row.staff_id), row]));
  const today = baghdadDate();
  const data = staff.flatMap((row) => {
    const id = Number(row.id);
    const mine = byStaff.get(id) ?? [];
    if (options.locationId && !mine.some((record) => Number(record.location_id) === options.locationId)) return [];
    const schedule = schedules.get(id);
    const onSystem = schedule?.enabled === true || (schedule?.shifts.length ?? 0) > 0;
    const metrics = calculateAttendancePayroll({
      periodStart: options.from,
      periodEnd: options.to,
      baseSalary: Number(row.base_salary ?? 0),
      dailyWorkingHours: Number(row.daily_working_hours ?? 8),
      workingDaysPerWeek: Number(row.working_days_per_week ?? 6),
      weeklyDaysOff: schedule?.weeklyDaysOff ?? (Array.isArray(row.weekly_days_off) ? row.weekly_days_off : undefined),
      shiftStart: schedule?.shiftStart ?? row.shift_start,
      shiftEnd: schedule?.shiftEnd ?? row.shift_end,
      scheduleMode: onSystem ? schedule?.scheduleMode : "shifts_only",
      shifts: schedule?.shifts,
      graceMinutes: schedule?.graceMinutes,
      asOfDate: today,
      overtimeRate: Number(row.overtime_rate ?? 0) || Number(row.hourly_rate ?? 0),
      policy,
      records: mine.map((record) => ({ id: Number(record.id), staffId: id, status: String(record.status), checkInAt: new Date(toMs(record.check_in_at) as number), checkOutAt: toMs(record.check_out_at) == null ? null : new Date(toMs(record.check_out_at) as number), overtimeApprovedMinutes: record.overtime_approved_minutes })),
    });
    return [{
      staffId: id, name: row.full_name || row.username, department: row.department ?? null, salaryType: row.salary_type ?? null,
      scheduledDays: metrics.scheduledWorkingDays, presentDays: metrics.presentDays, absentDays: metrics.absenceDays, paidLeaveDays: metrics.paidLeaveDays, unpaidLeaveDays: metrics.unpaidLeaveDays,
      workedHours: metrics.workedHours, lateArrivals: metrics.lateArrivals, lateMinutes: metrics.lateMinutes, earlyLeaveCount: metrics.earlyLeaveCount, earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      overtimeHours: metrics.overtimeHours, missingCheckOut: metrics.missingCheckOut, eventShifts: Number(events.get(id)?.shifts ?? 0), eventAttended: Number(events.get(id)?.attended ?? 0),
      proposedDeductions: Math.round((metrics.absenceDeduction + metrics.lateDeduction + metrics.earlyLeaveDeduction + metrics.unpaidLeaveDeduction) * 100) / 100,
    }];
  });
  return { from: options.from, to: options.to, data };
}

/** Daily cron: coordinates are kept only for the configured days; the rest of the audit trail stays. */
export async function sweepLocationEvidence(executor: Executor, days: number) {
  const result: any = await executor.execute(sql`update attendance_verifications set latitude = null, longitude = null where latitude is not null and created_at < now() - make_interval(days => ${Math.max(1, Math.round(days))})`);
  return { cleared: Number(result?.rowCount ?? 0) };
}

/** The inputs payroll needs beyond the attendance rows, so reports and payroll count the same way. */
export async function payrollScheduleInputs(executor: Executor, staffIds: number[], from: string, to: string) {
  const contexts = await scheduleContexts(executor, staffIds);
  const rows = await shiftsBetween(executor, { staffIds, from, to });
  const map = new Map<number, { enabled: boolean; scheduleMode: "fixed" | "shifts_only"; graceMinutes?: number; shifts: Array<{ date: string; startMs: number; endMs: number; graceMinutes: number }>; shiftStart: string | null; shiftEnd: string | null; weeklyDaysOff: string[] | null; overtimeEligible: boolean | null; payrollIntegration: boolean | null }>();
  for (const staffId of staffIds) {
    const context = contexts.get(staffId);
    if (!context) continue;
    const { settings, schedule } = context;
    map.set(staffId, {
      enabled: settings.enabled,
      scheduleMode: settings.enabled && ["rotating", "flexible", "event"].includes(settings.scheduleType) ? "shifts_only" : "fixed",
      graceMinutes: settings.enabled ? schedule.graceMinutes : undefined,
      shifts: rows.filter((row) => row.staffId === staffId).map((row) => ({ date: row.date, startMs: row.startMs, endMs: row.endMs, graceMinutes: row.graceMinutes || schedule.graceMinutes })),
      shiftStart: settings.enabled ? settings.shiftStart : null,
      shiftEnd: settings.enabled ? settings.shiftEnd : null,
      weeklyDaysOff: settings.enabled ? settings.weeklyDaysOff : null,
      overtimeEligible: settings.overtimeEligible,
      payrollIntegration: settings.payrollIntegration,
    });
  }
  return map;
}
