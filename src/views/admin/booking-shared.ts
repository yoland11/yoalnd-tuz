/**
 * Shared Booking Center presentation constants.
 *
 * Kept in one place so the Overview, list, new-booking, catalog and details
 * pages label the same status identically. Server-side sources of truth live in
 * src/server/booking-center.ts — these are display concerns only.
 */

export type ServiceCard = {
  key: string;
  label: string;
  icon: string;
  total: number;
  today: number;
  pending: number;
  inProgress: number;
  completed: number;
  /** Value booked this month — not cash collected. */
  monthlyBooked: number;
};

export type BookingRow = {
  id: number;
  booking_no: string;
  customer_name: string;
  customer_phone: string;
  event_date: string | null;
  event_time: string | null;
  status: string;
  grand_total: string;
  paid_amount: string;
  remaining_amount: string;
  payment_status: string;
  services: { serviceKey: string; status: string; amount: string }[];
};

export const BOOKING_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: {
    label: "مسودة",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300",
  },
  confirmed: {
    label: "مؤكد",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  in_progress: {
    label: "قيد التنفيذ",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  completed: {
    label: "مكتمل",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  cancelled: {
    label: "ملغى",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

export const PAYMENT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  unpaid: {
    label: "غير مدفوع",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  partial: {
    label: "مدفوع جزئياً",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  paid: {
    label: "مدفوع بالكامل",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  refunded_partial: {
    label: "مسترجع جزئياً",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
};

export const SERVICE_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  waiting: {
    label: "بالانتظار",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300",
  },
  preparing: {
    label: "قيد التحضير",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  ready: {
    label: "جاهز",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  dispatched: {
    label: "تم الإرسال",
    className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  installed: {
    label: "تم التركيب",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
  running: {
    label: "قيد التشغيل",
    className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  },
  finished: {
    label: "منتهي",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  returned: {
    label: "تم الإرجاع",
    className: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  },
  cancelled: {
    label: "ملغى",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

export const VOUCHER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "مسودة", className: "text-zinc-500" },
  pending: { label: "بانتظار الاعتماد", className: "text-amber-600 dark:text-amber-400" },
  executed: { label: "معتمد ومنفّذ", className: "text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "مرفوض", className: "text-red-600 dark:text-red-400" },
  reversed: { label: "معكوس", className: "text-sky-600 dark:text-sky-400" },
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "نقداً",
  transfer: "تحويل",
  pos: "بطاقة",
  card: "بطاقة",
  other: "أخرى",
};

export function badgeFor(
  map: Record<string, { label: string; className: string }>,
  key: string,
  fallback = "—",
) {
  return map[key] ?? { label: key || fallback, className: "bg-muted text-muted-foreground" };
}
