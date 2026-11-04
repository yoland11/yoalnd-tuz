import { normalizeIraqiPhone } from "./phone";

export const FOLLOWUP_SERVICES = [
  { key: "photography", label: "التصوير" },
  { key: "kosha", label: "الكوشة" },
  { key: "sound", label: "الصوتيات" },
  { key: "wedding", label: "الزفاف" },
  { key: "henna", label: "الحنة" },
  { key: "engagement", label: "الخطوبة" },
  { key: "graduation", label: "التخرج" },
  { key: "album", label: "الألبوم" },
  { key: "printing", label: "الطباعة" },
  { key: "booking_confirmation", label: "تأكيد الحجز" },
  { key: "other", label: "أخرى" },
] as const;
export type FollowupServiceKey = (typeof FOLLOWUP_SERVICES)[number]["key"];
export type FollowupStatus =
  "interested" | "waiting" | "converted" | "uninterested";
export const FOLLOWUP_STATUS_LABELS: Record<FollowupStatus, string> = {
  interested: "مهتم",
  waiting: "بانتظار الرد",
  converted: "تم الحجز",
  uninterested: "غير مهتم",
};
export const FOLLOWUP_STATUS_OPTIONS = Object.entries(
  FOLLOWUP_STATUS_LABELS,
).map(([key, label]) => ({ key: key as FollowupStatus, label }));
export interface FollowupCustomer {
  id: number;
  name: string;
  phone: string;
  avatarUrl?: string | null;
}
export interface FollowupEmployee {
  id: number;
  fullName: string;
  department?: string | null;
  avatarUrl?: string | null;
}
export interface FollowupBooking {
  source: "service" | "kosha";
  id: number;
  number: string;
  href: string;
}
export interface FollowupRow {
  id: number;
  customer: FollowupCustomer;
  serviceKey: FollowupServiceKey;
  followupAt: string;
  status: FollowupStatus;
  employee: FollowupEmployee;
  note: string;
  completedAt: string | null;
  version: number;
  contactBlocked: boolean;
  booking: FollowupBooking | null;
  createdAt: string;
}
export interface FollowupSuggestion {
  key: string;
  customer: FollowupCustomer;
  serviceKey: FollowupServiceKey;
  reason: string;
  sourceBooking: FollowupBooking | null;
}
export interface FollowupSummary {
  today: number;
  overdue: number;
  upcoming: number;
  converted: number;
  total: number;
  completed: number;
}
export interface FollowupList {
  rows: FollowupRow[];
  summary: FollowupSummary;
  suggestions: FollowupSuggestion[];
  page: number;
  pageSize: number;
  total: number;
  capabilities: {
    canManage: boolean;
    canCreate: boolean;
    canBook: boolean;
    canCreateCustomer: boolean;
    canOpenCustomer: boolean;
  };
}
export interface FollowupActor {
  id: number;
  role: string;
  permissions: string[];
  canBook: boolean;
  canCreateCustomer: boolean;
}

const iraqDay = (value: string | Date) =>
  new Date(new Date(value).getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
export function followupDateBucket(
  value: string,
  now = new Date(),
): "today" | "overdue" | "upcoming" {
  const day = iraqDay(value),
    today = iraqDay(now);
  return day < today ? "overdue" : day > today ? "upcoming" : "today";
}
export function formatFollowupDate(value: string): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: "Asia/Baghdad",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function toFollowupDateTimeInput(value: string): string {
  return new Date(new Date(value).getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}
export function followupDateTimeToIso(value: string): string {
  return new Date(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+03:00` : value,
  ).toISOString();
}
export function followupWhatsAppHref(
  phone: string,
  message?: string,
): string | null {
  const digits = normalizeIraqiPhone(phone);
  return digits
    ? `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`
    : null;
}
export function followupPhoneHref(phone: string): string | null {
  const digits = normalizeIraqiPhone(phone);
  return digits ? `tel:+${digits}` : null;
}
