/**
 * Attendance rules shared by the server, the admin UI, the staff portal and the tests.
 * GPS and QR are evidence, not proof: coordinates can be spoofed and a live code can be shared.
 */
export const ATTENDANCE_METHODS = ["qr", "gps", "qr_gps", "any", "manual"] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];
export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethod, string> = {
  qr: "QR",
  gps: "GPS",
  qr_gps: "QR + GPS",
  any: "أي طريقة مسموحة",
  manual: "يدوي بموافقة المدير",
};
export const SCHEDULE_TYPES = ["fixed", "rotating", "flexible", "event", "part_time"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  fixed: "دوام ثابت",
  rotating: "ورديات متغيرة",
  flexible: "دوام مرن",
  event: "حسب المناسبات",
  part_time: "دوام جزئي",
};
export const SHIFT_KIND_LABELS: Record<string, string> = { fixed: "ثابتة", rotating: "متغيرة", flexible: "مرنة", event: "مناسبة", part_time: "جزئية", overnight: "ليلية" };
export const LOCATION_KIND_LABELS: Record<string, string> = { office: "محل / مكتب", warehouse: "مخزن", event: "موقع مناسبة", photography: "موقع تصوير", transport: "موقع نقل", other: "أخرى" };
export const CORRECTION_TYPES: Record<string, string> = {
  forgot_check_in: "نسيت تسجيل الحضور",
  forgot_check_out: "نسيت تسجيل الانصراف",
  gps_unavailable: "GPS غير متوفر",
  qr_unavailable: "QR غير متوفر",
  wrong_time: "وقت غير صحيح",
  emergency: "مهمة طارئة",
};
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const DAY_LABELS: Record<string, string> = { sat: "السبت", sun: "الأحد", mon: "الإثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة" };

export const QR_ROTATION_SECONDS = 30;
/** A code stays valid this long after the kiosk moves on, so a scan in progress is not refused. */
export const QR_GRACE_SECONDS = 15;

const pad = (value: number) => String(value).padStart(2, "0");
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Asia/Baghdad has no daylight saving, so one fixed offset is correct all year. */
export function baghdadDate(at: Date | number = Date.now()) {
  return new Date(new Date(at).getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}
export function baghdadMinutes(at: Date | number) {
  const shifted = new Date(new Date(at).getTime() + BAGHDAD_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
export function baghdadTime(at: Date | number | string | null | undefined) {
  if (at == null || at === "") return "—";
  const ms = toMs(at);
  if (ms == null) return "—";
  const minutes = baghdadMinutes(ms);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
/** A Baghdad wall-clock moment as an absolute timestamp. */
export function baghdadMoment(date: string, time: string) {
  return new Date(`${date}T${time.slice(0, 5)}:00+03:00`);
}
export function dayKey(date: string) {
  return DAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Database timestamps without a zone are stored in UTC. */
export function toMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value);
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text.trim());
  const ms = new Date(hasZone ? text : `${text.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export type GpsEvidence = { latitude: number; longitude: number; accuracy: number };
export type GpsLocation = { latitude: number | null; longitude: number | null; radiusMeters: number; maxAccuracyMeters: number };
export type GpsCheck = { ok: true; distance: number } | { ok: false; reason: string; distance?: number };

export function checkGps(evidence: Partial<GpsEvidence> | null | undefined, location: GpsLocation): GpsCheck {
  if (location.latitude == null || location.longitude == null) return { ok: false, reason: "موقع العمل بلا إحداثيات؛ راجع المدير" };
  const latitude = Number(evidence?.latitude), longitude = Number(evidence?.longitude), accuracy = Number(evidence?.accuracy);
  if (evidence?.latitude == null || evidence?.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    return { ok: false, reason: "لم يصل موقعك. فعّل تحديد الموقع وأعد المحاولة" };
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > location.maxAccuracyMeters)
    return { ok: false, reason: `دقة تحديد الموقع ضعيفة${Number.isFinite(accuracy) ? ` (${Math.round(accuracy)} متر)` : ""}. اقترب من مكان مفتوح وأعد المحاولة` };
  const distance = haversineMeters({ latitude, longitude }, { latitude: location.latitude, longitude: location.longitude });
  if (distance > location.radiusMeters) return { ok: false, reason: "أنت خارج نطاق موقع العمل المسموح.", distance };
  return { ok: true, distance };
}

export function methodSteps(method: string) {
  return { qr: method === "qr" || method === "qr_gps", gps: method === "gps" || method === "qr_gps", manual: method === "manual" };
}

/** The most specific rule wins: this shift, the employee's event or normal rule, then the location. */
export function resolveMethod(input: { shiftMethod?: string | null; isEvent?: boolean; eventMethod?: string | null; employeeMethod?: string | null; locationMethod?: string | null }): AttendanceMethod {
  const candidate = input.shiftMethod || (input.isEvent ? input.eventMethod : null) || input.employeeMethod || input.locationMethod || "qr_gps";
  return (ATTENDANCE_METHODS as readonly string[]).includes(candidate) ? (candidate as AttendanceMethod) : "qr_gps";
}

export type ExpectedShift = { shiftId: number | null; startMs: number; endMs: number; graceMinutes: number; kind: string; locationId: number | null; requiredMethod: string | null; title: string | null; bookingSource: string | null; bookingId: number | null };
export type ScheduleInput = {
  enabled?: boolean;
  scheduleType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  weeklyDaysOff: string[];
  graceMinutes: number;
  holidays?: string[];
  primaryLocationId?: number | null;
};

export function fixedShiftFor(date: string, schedule: ScheduleInput): ExpectedShift | null {
  if (schedule.scheduleType !== "fixed" && schedule.scheduleType !== "part_time") return null;
  if (!schedule.shiftStart || !schedule.shiftEnd) return null;
  if (schedule.weeklyDaysOff.includes(dayKey(date)) || (schedule.holidays ?? []).includes(date)) return null;
  const startMs = baghdadMoment(date, schedule.shiftStart).getTime();
  let endMs = baghdadMoment(date, schedule.shiftEnd).getTime();
  if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000; // Crosses midnight.
  return { shiftId: null, startMs, endMs, graceMinutes: schedule.graceMinutes, kind: "fixed", locationId: schedule.primaryLocationId ?? null, requiredMethod: null, title: null, bookingSource: null, bookingId: null };
}

/** Shift rows for the day replace the weekly pattern; a rest day with no row expects nobody. */
export function expectedShiftsFor(date: string, schedule: ScheduleInput, rows: ExpectedShift[]): ExpectedShift[] {
  if (rows.length) return [...rows].sort((a, b) => a.startMs - b.startMs);
  const fixed = fixedShiftFor(date, schedule);
  return fixed ? [fixed] : [];
}

/** Sessions that overlap are clipped so one worked minute is never counted twice. */
export function nonOverlappingSessions<T extends { startMs: number; endMs: number | null }>(sessions: T[]): Array<T & { effectiveStartMs: number; effectiveEndMs: number | null }> {
  let reached = -Infinity;
  return [...sessions].sort((a, b) => a.startMs - b.startMs).map((session) => {
    const effectiveStartMs = Math.max(session.startMs, reached);
    if (session.endMs == null) return { ...session, effectiveStartMs, effectiveEndMs: null };
    const effectiveEndMs = Math.max(effectiveStartMs, session.endMs);
    reached = Math.max(reached, effectiveEndMs);
    return { ...session, effectiveStartMs, effectiveEndMs };
  });
}

export function workedMinutes(sessions: Array<{ startMs: number; endMs: number | null }>) {
  return Math.round(nonOverlappingSessions(sessions).reduce((sum, row) => sum + (row.effectiveEndMs == null ? 0 : row.effectiveEndMs - row.effectiveStartMs), 0) / 60000);
}

export type AttendanceDayStatus = "present" | "late" | "out" | "absent" | "mission" | "not_started" | "not_scheduled" | "rest" | "leave" | "on_break";
export const DAY_STATUS_LABELS: Record<AttendanceDayStatus, string> = {
  present: "حاضر الآن",
  late: "متأخر",
  out: "منصرف",
  absent: "غائب",
  mission: "في مهمة خارجية",
  not_started: "لم يبدأ الدوام",
  not_scheduled: "غير مجدول",
  rest: "يوم راحة",
  leave: "إجازة",
  on_break: "في استراحة",
};

/** One employee's state for a day. Nobody is absent unless a shift expected them and has started. */
export function dayStatusFor(input: { nowMs: number; expected: ExpectedShift[]; sessions: Array<{ startMs: number; endMs: number | null; isEvent?: boolean }>; onLeave: boolean; isRestDay: boolean }): AttendanceDayStatus {
  const { nowMs, expected, sessions } = input;
  if (input.onLeave) return "leave";
  const open = sessions.find((row) => row.endMs == null);
  if (open) {
    if (open.isEvent) return "mission";
    const first = expected[0];
    const firstIn = Math.min(...sessions.map((row) => row.startMs));
    return first && firstIn > first.startMs + first.graceMinutes * 60000 ? "late" : "present";
  }
  if (sessions.length) {
    const lastEnd = Math.max(...sessions.map((row) => row.endMs ?? 0));
    const remaining = expected.some((shift) => shift.endMs > nowMs && shift.startMs <= nowMs) && lastEnd < nowMs;
    return remaining ? "on_break" : "out";
  }
  if (!expected.length) return input.isRestDay ? "rest" : "not_scheduled";
  const started = expected.some((shift) => nowMs > shift.startMs + shift.graceMinutes * 60000);
  return started ? "absent" : "not_started";
}

export type ShiftAdherence = { lateMinutes: number; earlyMinutes: number };
/** Lateness and early leaving measured against absolute times, so overnight shifts stay correct. */
export function shiftAdherence(shift: Pick<ExpectedShift, "startMs" | "endMs" | "graceMinutes">, sessions: Array<{ startMs: number; endMs: number | null }>, earlyGraceMinutes = 0): ShiftAdherence {
  const inside = sessions.filter((row) => row.startMs < shift.endMs && (row.endMs ?? Infinity) > shift.startMs);
  if (!inside.length) return { lateMinutes: 0, earlyMinutes: 0 };
  const firstIn = Math.min(...inside.map((row) => row.startMs));
  const closed = inside.filter((row) => row.endMs != null);
  const lastOut = closed.length && closed.length === inside.length ? Math.max(...closed.map((row) => row.endMs as number)) : null;
  return {
    lateMinutes: Math.max(0, Math.round((firstIn - shift.startMs) / 60000) - shift.graceMinutes),
    earlyMinutes: lastOut == null ? 0 : Math.max(0, Math.round((shift.endMs - lastOut) / 60000) - earlyGraceMinutes),
  };
}
