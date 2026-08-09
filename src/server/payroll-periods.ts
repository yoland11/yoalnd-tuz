export const PAYROLL_PERIOD_TYPES = ["monthly", "weekly", "biweekly", "daily", "custom"] as const;
export type PayrollPeriodType = (typeof PAYROLL_PERIOD_TYPES)[number];

export type PayrollPeriodInput = {
  period?: string | null;
  periodType?: PayrollPeriodType | null;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  paymentDate?: string | null;
};

export type ResolvedPayrollPeriod = {
  period: string;
  periodType: PayrollPeriodType;
  periodKey: string;
  start: string;
  end: string;
  paymentDate: string;
  calendarDays: number;
};

const periodPattern = /^\d{4}-\d{2}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string) {
  if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} غير صالح`);
  }
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function monthBounds(period: string) {
  if (!periodPattern.test(period)) throw new Error("صيغة فترة الرواتب يجب أن تكون YYYY-MM");
  const start = `${period}-01`;
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1, 0);
  return { start, end: toIsoDate(endDate) };
}

function daysBetween(start: string, end: string) {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

/**
 * Resolves one payroll window to a stable, unique business key.  The database
 * keeps the legacy `period` month for compatibility with reports and bonuses,
 * while `periodKey` distinguishes weekly, daily and custom runs in that month.
 */
export function resolvePayrollPeriod(input: PayrollPeriodInput): ResolvedPayrollPeriod {
  const requestedType = input.periodType ?? "monthly";
  if (!PAYROLL_PERIOD_TYPES.includes(requestedType)) throw new Error("نوع فترة الرواتب غير صالح");

  const suppliedPeriod = String(input.period ?? "").trim();
  const suppliedStart = input.periodStartDate ? String(input.periodStartDate) : "";
  const suppliedEnd = input.periodEndDate ? String(input.periodEndDate) : "";
  if (suppliedStart) assertIsoDate(suppliedStart, "تاريخ بداية الفترة");
  if (suppliedEnd) assertIsoDate(suppliedEnd, "تاريخ نهاية الفترة");

  const derivedPeriod = suppliedPeriod || (suppliedStart ? suppliedStart.slice(0, 7) : "");
  if (!periodPattern.test(derivedPeriod)) throw new Error("صيغة فترة الرواتب يجب أن تكون YYYY-MM");
  const monthly = monthBounds(derivedPeriod);
  const start = suppliedStart || monthly.start;
  let end = suppliedEnd || monthly.end;

  if (requestedType === "weekly" && !suppliedEnd) end = addDays(start, 6);
  if (requestedType === "biweekly" && !suppliedEnd) end = addDays(start, 13);
  if (requestedType === "daily" && !suppliedEnd) end = start;
  if (requestedType === "custom" && (!suppliedStart || !suppliedEnd)) {
    throw new Error("يتطلب الراتب المخصص تاريخ بداية ونهاية");
  }
  if (start > end) throw new Error("تاريخ بداية فترة الرواتب يجب أن يسبق تاريخ النهاية");

  const paymentDate = input.paymentDate ? String(input.paymentDate) : end;
  assertIsoDate(paymentDate, "تاريخ الدفع");
  return {
    period: start.slice(0, 7),
    periodType: requestedType,
    periodKey: `${requestedType}:${start}:${end}`,
    start,
    end,
    paymentDate,
    calendarDays: daysBetween(start, end),
  };
}

export function payrollPeriodLabel(type: PayrollPeriodType) {
  return ({ monthly: "شهري", weekly: "أسبوعي", biweekly: "كل أسبوعين", daily: "يومي", custom: "مخصص" } as const)[type];
}
