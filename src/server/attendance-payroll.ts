export const ATTENDANCE_STATUSES = [
  "present",
  "out",
  "late",
  "absent",
  "paid_leave",
  "unpaid_leave",
] as const;

export type AttendancePolicy = {
  workStart: string;
  workEnd: string;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  lateDeductionRule: "none" | "per_minute" | "per_occurrence";
  absenceDeductionRule: "none" | "daily_rate" | "fixed_per_day";
  earlyLeaveDeductionRule: "none" | "per_minute" | "per_occurrence";
  unpaidLeaveDeductionRule: "none" | "daily_rate" | "fixed_per_day";
  earlyLeaveDeductionRate: number;
  unpaidLeaveDeductionRate: number;
  weekendOvertimeMultiplier: number;
  holidayOvertimeMultiplier: number;
  paidLeaveCountsAsPresent: boolean;
  holidays: string[];
};

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  workStart: "09:00",
  workEnd: "17:00",
  lateGraceMinutes: 10,
  earlyLeaveGraceMinutes: 0,
  lateDeductionRule: "per_occurrence",
  absenceDeductionRule: "daily_rate",
  earlyLeaveDeductionRule: "per_minute",
  unpaidLeaveDeductionRule: "daily_rate",
  earlyLeaveDeductionRate: 0,
  unpaidLeaveDeductionRate: 0,
  weekendOvertimeMultiplier: 1.5,
  holidayOvertimeMultiplier: 2,
  paidLeaveCountsAsPresent: true,
  holidays: [],
};

export type AttendancePayrollRecord = {
  id?: number;
  staffId?: number;
  status: string;
  checkInAt: string | Date | null;
  checkOutAt: string | Date | null;
};

export type AttendancePayrollInput = {
  periodStart: string;
  periodEnd: string;
  baseSalary: number;
  dailyWorkingHours: number;
  workingDaysPerWeek: number;
  weeklyDaysOff?: string[];
  shiftStart?: string | null;
  shiftEnd?: string | null;
  overtimeRate: number;
  weekendHourRate?: number;
  holidayHourRate?: number;
  lateDeductionRate?: number;
  absenceDeductionRate?: number;
  policy?: Partial<AttendancePolicy>;
  records: AttendancePayrollRecord[];
};

export type AttendancePayrollResult = {
  scheduledWorkingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absenceDays: number;
  workedHours: number;
  lateArrivals: number;
  lateMinutes: number;
  earlyLeaveCount: number;
  earlyLeaveMinutes: number;
  overtimeHours: number;
  regularOvertimeHours: number;
  weekendOvertimeHours: number;
  holidayOvertimeHours: number;
  missingCheckIn: number;
  missingCheckOut: number;
  invalidTimeOrder: number;
  overtimeAmount: number;
  absenceDeduction: number;
  lateDeduction: number;
  earlyLeaveDeduction: number;
  unpaidLeaveDeduction: number;
  formulas: Record<string, string>;
  daily: Array<{
    date: string;
    kind: "workday" | "weekend" | "holiday";
    status: string;
    workedHours: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeHours: number;
    missingCheckIn: boolean;
    missingCheckOut: boolean;
  }>;
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function dateRange(start: string, end: string) {
  const rows: string[] = [];
  const day = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (day <= last) {
    rows.push(isoDate(day));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return rows;
}

function dateKey(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function minutesSinceMidnight(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function policyTime(value: string | null | undefined, fallback: string) {
  const candidate = /^\d{2}:\d{2}/.test(String(value ?? "")) ? String(value).slice(0, 5) : fallback;
  const [hours, minutes] = candidate.split(":").map(Number);
  return Math.min(24 * 60, Math.max(0, hours * 60 + minutes));
}

function defaultDaysOff(workingDaysPerWeek: number) {
  const count = Math.max(0, 7 - Math.min(7, Math.max(1, Math.round(workingDaysPerWeek))));
  return ["fri", "sat", "thu", "wed", "tue", "mon", "sun"].slice(0, count);
}

function deductionAmount(rule: string, quantity: number, dailyRate: number, configuredRate: number) {
  if (rule === "none") return { rate: 0, amount: 0 };
  const rate = rule === "daily_rate" ? dailyRate : configuredRate;
  return { rate, amount: round(Math.max(0, quantity) * Math.max(0, rate)) };
}

export function normalizeAttendancePolicy(value: unknown): AttendancePolicy {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pickRule = <T extends string>(key: string, allowed: readonly T[], fallback: T) => allowed.includes(String(input[key]) as T) ? String(input[key]) as T : fallback;
  const time = (key: string, fallback: string) => /^\d{2}:\d{2}$/.test(String(input[key] ?? "")) ? String(input[key]) : fallback;
  return {
    workStart: time("workStart", DEFAULT_ATTENDANCE_POLICY.workStart),
    workEnd: time("workEnd", DEFAULT_ATTENDANCE_POLICY.workEnd),
    lateGraceMinutes: Math.min(240, Math.max(0, Math.round(finite(input.lateGraceMinutes, DEFAULT_ATTENDANCE_POLICY.lateGraceMinutes)))),
    earlyLeaveGraceMinutes: Math.min(240, Math.max(0, Math.round(finite(input.earlyLeaveGraceMinutes, DEFAULT_ATTENDANCE_POLICY.earlyLeaveGraceMinutes)))),
    lateDeductionRule: pickRule("lateDeductionRule", ["none", "per_minute", "per_occurrence"] as const, DEFAULT_ATTENDANCE_POLICY.lateDeductionRule),
    absenceDeductionRule: pickRule("absenceDeductionRule", ["none", "daily_rate", "fixed_per_day"] as const, DEFAULT_ATTENDANCE_POLICY.absenceDeductionRule),
    earlyLeaveDeductionRule: pickRule("earlyLeaveDeductionRule", ["none", "per_minute", "per_occurrence"] as const, DEFAULT_ATTENDANCE_POLICY.earlyLeaveDeductionRule),
    unpaidLeaveDeductionRule: pickRule("unpaidLeaveDeductionRule", ["none", "daily_rate", "fixed_per_day"] as const, DEFAULT_ATTENDANCE_POLICY.unpaidLeaveDeductionRule),
    earlyLeaveDeductionRate: Math.max(0, finite(input.earlyLeaveDeductionRate)),
    unpaidLeaveDeductionRate: Math.max(0, finite(input.unpaidLeaveDeductionRate)),
    weekendOvertimeMultiplier: Math.min(10, Math.max(0, finite(input.weekendOvertimeMultiplier, DEFAULT_ATTENDANCE_POLICY.weekendOvertimeMultiplier))),
    holidayOvertimeMultiplier: Math.min(10, Math.max(0, finite(input.holidayOvertimeMultiplier, DEFAULT_ATTENDANCE_POLICY.holidayOvertimeMultiplier))),
    paidLeaveCountsAsPresent: input.paidLeaveCountsAsPresent !== false,
    holidays: Array.isArray(input.holidays) ? [...new Set(input.holidays.map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].slice(0, 366) : [],
  };
}

export function calculateAttendancePayroll(input: AttendancePayrollInput): AttendancePayrollResult {
  const policy = normalizeAttendancePolicy({ ...DEFAULT_ATTENDANCE_POLICY, ...(input.policy ?? {}) });
  const daysOff = new Set(input.weeklyDaysOff?.length ? input.weeklyDaysOff : defaultDaysOff(input.workingDaysPerWeek));
  const holidays = new Set(policy.holidays);
  const grouped = new Map<string, AttendancePayrollRecord[]>();
  for (const record of input.records) {
    const key = dateKey(record.checkInAt ?? record.checkOutAt);
    if (!key || key < input.periodStart || key > input.periodEnd) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  const startMinute = policyTime(input.shiftStart, policy.workStart);
  const endMinute = policyTime(input.shiftEnd, policy.workEnd);
  const expectedDailyHours = Math.max(0.01, finite(input.dailyWorkingHours, Math.max(1, (endMinute - startMinute) / 60)));
  const scheduledDates = dateRange(input.periodStart, input.periodEnd).filter((date) => {
    const day = new Date(`${date}T00:00:00Z`);
    return !daysOff.has(DAY_KEYS[day.getUTCDay()]) && !holidays.has(date);
  });
  const scheduledSet = new Set(scheduledDates);
  const daily: AttendancePayrollResult["daily"] = [];

  for (const date of dateRange(input.periodStart, input.periodEnd)) {
    const records = grouped.get(date) ?? [];
    const isHoliday = holidays.has(date);
    const isWeekend = !isHoliday && !scheduledSet.has(date);
    const kind = isHoliday ? "holiday" : isWeekend ? "weekend" : "workday";
    const paidLeave = records.some((record) => record.status === "paid_leave");
    const unpaidLeave = records.some((record) => record.status === "unpaid_leave");
    const explicitAbsent = records.some((record) => ["absent", "no_show"].includes(record.status));
    const sessions = records.filter((record) => ["present", "out", "late"].includes(record.status));
    const validSessions = sessions.filter((record) => record.checkInAt && record.checkOutAt && new Date(record.checkOutAt).getTime() >= new Date(record.checkInAt).getTime());
    const invalidTimeOrder = sessions.filter((record) => record.checkInAt && record.checkOutAt && new Date(record.checkOutAt).getTime() < new Date(record.checkInAt).getTime()).length;
    const workedHours = round(validSessions.reduce((sum, record) => sum + (new Date(record.checkOutAt!).getTime() - new Date(record.checkInAt!).getTime()) / 3_600_000, 0));
    const firstCheckIn = sessions.map((record) => minutesSinceMidnight(record.checkInAt)).filter((value): value is number => value != null).sort((a, b) => a - b)[0];
    const lastCheckOut = sessions.map((record) => minutesSinceMidnight(record.checkOutAt)).filter((value): value is number => value != null).sort((a, b) => b - a)[0];
    const lateMinutes = kind === "workday" && firstCheckIn != null ? Math.max(0, firstCheckIn - startMinute - policy.lateGraceMinutes) : 0;
    const earlyLeaveMinutes = kind === "workday" && lastCheckOut != null ? Math.max(0, endMinute - lastCheckOut - policy.earlyLeaveGraceMinutes) : 0;
    const overtimeHours = round(kind === "workday" ? Math.max(0, workedHours - expectedDailyHours) : workedHours);
    const missingCheckIn = kind === "workday" && !paidLeave && !unpaidLeave && (explicitAbsent || sessions.length === 0);
    const missingCheckOut = sessions.some((record) => !!record.checkInAt && !record.checkOutAt);
    daily.push({
      date,
      kind,
      status: paidLeave ? "paid_leave" : unpaidLeave ? "unpaid_leave" : sessions.length ? "present" : explicitAbsent ? "absent" : "none",
      workedHours,
      lateMinutes,
      earlyLeaveMinutes,
      overtimeHours,
      missingCheckIn,
      missingCheckOut,
      ...(invalidTimeOrder ? { invalidTimeOrder } : {}),
    } as AttendancePayrollResult["daily"][number]);
  }

  const scheduled = daily.filter((day) => day.kind === "workday");
  const presentDays = scheduled.filter((day) => day.status === "present").length;
  const paidLeaveDays = scheduled.filter((day) => day.status === "paid_leave").length;
  const unpaidLeaveDays = scheduled.filter((day) => day.status === "unpaid_leave").length;
  const absenceDays = scheduled.filter((day) => day.status === "absent" || day.status === "none").length;
  const workedHours = round(daily.reduce((sum, day) => sum + day.workedHours, 0));
  const lateMinutes = scheduled.reduce((sum, day) => sum + day.lateMinutes, 0);
  const earlyLeaveMinutes = scheduled.reduce((sum, day) => sum + day.earlyLeaveMinutes, 0);
  const lateArrivals = scheduled.filter((day) => day.lateMinutes > 0).length;
  const earlyLeaveCount = scheduled.filter((day) => day.earlyLeaveMinutes > 0).length;
  const regularOvertimeHours = round(daily.filter((day) => day.kind === "workday").reduce((sum, day) => sum + day.overtimeHours, 0));
  const weekendOvertimeHours = round(daily.filter((day) => day.kind === "weekend").reduce((sum, day) => sum + day.overtimeHours, 0));
  const holidayOvertimeHours = round(daily.filter((day) => day.kind === "holiday").reduce((sum, day) => sum + day.overtimeHours, 0));
  const regularRate = Math.max(0, finite(input.overtimeRate));
  const weekendRate = Math.max(0, finite(input.weekendHourRate, regularRate * policy.weekendOvertimeMultiplier));
  const holidayRate = Math.max(0, finite(input.holidayHourRate, regularRate * policy.holidayOvertimeMultiplier));
  const overtimeAmount = round(regularOvertimeHours * regularRate + weekendOvertimeHours * weekendRate + holidayOvertimeHours * holidayRate);
  const dailyRate = input.baseSalary / Math.max(1, scheduled.length);
  const absence = deductionAmount(policy.absenceDeductionRule, absenceDays, dailyRate, finite(input.absenceDeductionRate));
  const lateQuantity = policy.lateDeductionRule === "per_minute" ? lateMinutes : lateArrivals;
  const late = deductionAmount(policy.lateDeductionRule, lateQuantity, 0, finite(input.lateDeductionRate));
  const earlyQuantity = policy.earlyLeaveDeductionRule === "per_minute" ? earlyLeaveMinutes : earlyLeaveCount;
  const early = deductionAmount(policy.earlyLeaveDeductionRule, earlyQuantity, 0, policy.earlyLeaveDeductionRate);
  const unpaid = deductionAmount(policy.unpaidLeaveDeductionRule, unpaidLeaveDays, dailyRate, policy.unpaidLeaveDeductionRate);
  const invalidTimeOrder = input.records.filter((record) => record.checkInAt && record.checkOutAt && new Date(record.checkOutAt).getTime() < new Date(record.checkInAt).getTime()).length;
  const formula = (label: string, quantity: number, unit: string, rate: number, amount: number, suffix: string) => `${label} ${quantity} ${unit} × ${round(rate).toLocaleString("en-US")} د.ع = ${round(amount).toLocaleString("en-US")} د.ع ${suffix}`;

  return {
    scheduledWorkingDays: scheduled.length,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absenceDays,
    workedHours,
    lateArrivals,
    lateMinutes,
    earlyLeaveCount,
    earlyLeaveMinutes,
    overtimeHours: round(regularOvertimeHours + weekendOvertimeHours + holidayOvertimeHours),
    regularOvertimeHours,
    weekendOvertimeHours,
    holidayOvertimeHours,
    missingCheckIn: daily.filter((day) => day.missingCheckIn).length,
    missingCheckOut: daily.filter((day) => day.missingCheckOut).length,
    invalidTimeOrder,
    overtimeAmount,
    absenceDeduction: absence.amount,
    lateDeduction: late.amount,
    earlyLeaveDeduction: early.amount,
    unpaidLeaveDeduction: unpaid.amount,
    formulas: {
      absence: formula("غياب", absenceDays, "يوم", absence.rate, absence.amount, "خصم"),
      late: formula("تأخير", lateQuantity, policy.lateDeductionRule === "per_minute" ? "دقيقة" : "مرة", late.rate, late.amount, "خصم"),
      earlyLeave: formula("انصراف مبكر", earlyQuantity, policy.earlyLeaveDeductionRule === "per_minute" ? "دقيقة" : "مرة", early.rate, early.amount, "خصم"),
      unpaidLeave: formula("إجازة غير مدفوعة", unpaidLeaveDays, "يوم", unpaid.rate, unpaid.amount, "خصم"),
      overtime: `إضافي ${round(regularOvertimeHours)} ساعة × ${round(regularRate).toLocaleString("en-US")} + عطلة ${round(weekendOvertimeHours)} × ${round(weekendRate).toLocaleString("en-US")} + رسمية ${round(holidayOvertimeHours)} × ${round(holidayRate).toLocaleString("en-US")} = ${overtimeAmount.toLocaleString("en-US")} د.ع إضافة`,
    },
    daily,
  };
}
