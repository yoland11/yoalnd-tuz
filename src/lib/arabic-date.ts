/**
 * Display rules of the AJN date picker: Gregorian only, Arabic weekday names,
 * numeric months. Stored values and API formats are never touched here: dates
 * stay "YYYY-MM-DD", months "YYYY-MM" and date-times "YYYY-MM-DDTHH:mm".
 */

/** Indexed by JavaScript's day of week, so a name always comes from the actual date. */
export const ARABIC_WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
/** Saturday in JavaScript's day-of-week numbering. */
export const CALENDAR_WEEK_STARTS_ON = 6;

const pad = (value: number) => String(value).padStart(2, "0");
const dayParts = (day: string) => day.split("-").map(Number) as [number, number, number];
const utcOf = (day: string) => {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date));
};

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return utcOf(value).toISOString().slice(0, 10) === value;
}

export const isCalendarMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** Today's calendar day in Iraq, whatever the device or server timezone is. */
export function baghdadDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const arabicWeekday = (day: string) => ARABIC_WEEKDAYS[utcOf(day).getUTCDay()];

/** 2026/10/30 */
export const formatNumericDate = (day: string) => day.replace(/-/g, "/");
/** الجمعة، 2026/10/30 */
export const formatArabicDate = (day: string) => `${arabicWeekday(day)}، ${formatNumericDate(day)}`;
/** 2026 / 10 */
export const formatNumericMonth = (month: string) => month.replace("-", " / ");

const DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};
const westernDigits = (text: string) => text.replace(/[٠-٩۰-۹]/g, (digit) => DIGITS[digit]).trim();
const SEPARATOR = "[/\\-.\\s]+";

/**
 * What someone typed, as a stored date: 2026/10/30, 2026-10-30, 20261030, or
 * day first as 30/10/2026. Anything that is not a real calendar day is null.
 */
export function parseTypedDate(text: string): string | null {
  const value = westernDigits(text);
  const yearFirst = new RegExp(`^(\\d{4})${SEPARATOR}(\\d{1,2})${SEPARATOR}(\\d{1,2})$`).exec(value) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (yearFirst) {
    const day = `${yearFirst[1]}-${yearFirst[2].padStart(2, "0")}-${yearFirst[3].padStart(2, "0")}`;
    return isCalendarDay(day) ? day : null;
  }
  const dayFirst = new RegExp(`^(\\d{1,2})${SEPARATOR}(\\d{1,2})${SEPARATOR}(\\d{4})$`).exec(value);
  if (dayFirst) {
    const day = `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
    return isCalendarDay(day) ? day : null;
  }
  return null;
}

/** 2026/10, 2026-10 or 10/2026 as a stored month. */
export function parseTypedMonth(text: string): string | null {
  const value = westernDigits(text);
  const yearFirst = new RegExp(`^(\\d{4})${SEPARATOR}(\\d{1,2})$`).exec(value);
  const monthFirst = new RegExp(`^(\\d{1,2})${SEPARATOR}(\\d{4})$`).exec(value);
  const month = yearFirst ? `${yearFirst[1]}-${yearFirst[2].padStart(2, "0")}` : monthFirst ? `${monthFirst[2]}-${monthFirst[1].padStart(2, "0")}` : null;
  return isCalendarMonth(month) ? month : null;
}

/** A date-time value's parts, without shifting them through any timezone. */
export function splitDateTime(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");
  return { date: isCalendarDay(date) ? date : "", time };
}

/** Like the browser's control, an incomplete date-time has no value. */
export const joinDateTime = (date: string, time: string) => (date && time ? `${date}T${time}` : "");

/** Calendar day as a local Date for the day grid; `dayFromLocalDate` is its exact inverse. */
export function localDateFromDay(day: string): Date {
  const [year, month, date] = dayParts(day);
  return new Date(year, month - 1, date);
}
export const dayFromLocalDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export type DateInputKind = "date" | "datetime-local" | "month";
export const isDateInputKind = (type: unknown): type is DateInputKind => type === "date" || type === "datetime-local" || type === "month";

/** The stored date part of a min/max bound, for any of the three kinds. */
export function dayBound(value: unknown): string {
  const text = String(value ?? "");
  const day = text.slice(0, 10);
  return isCalendarDay(day) ? day : "";
}
