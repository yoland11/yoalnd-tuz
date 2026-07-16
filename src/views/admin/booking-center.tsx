"use client";

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Coins,
  Loader2,
  Plus,
  Wallet,
  XCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  VOUCHER_STATUS_LABELS,
  badgeFor,
  type ServiceCard,
} from "./booking-shared";

type LatestBooking = {
  id: number;
  bookingNo: string;
  customerName: string;
  eventDate: string | null;
  status: string;
  grandTotal: string;
  remainingAmount: string;
  paymentStatus: string;
};

type LatestPayment = {
  id: number;
  voucherNo: string;
  date: string;
  amount: string;
  method: string;
  approvalStatus: string;
  bookingId: number;
  bookingNo: string;
  customerName: string;
};

type Dashboard = {
  cards: {
    today_bookings?: number;
    upcoming_events?: number;
    in_progress?: number;
    completed?: number;
    cancelled?: number;
    total_amount?: string | number;
    paid_amount?: string | number;
    outstanding_amount?: string | number;
    monthly_revenue?: string | number;
    total_bookings?: number;
  };
  services: ServiceCard[];
  latestBookings: LatestBooking[];
  latestPayments: LatestPayment[];
};

/** Each card deep-links into the All Bookings list with the matching filter. */
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  href,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  tone: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl border border-border/40 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-md"
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-l ${tone}`} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-bold text-foreground">{value}</p>
        </div>
        <Icon className="h-7 w-7 shrink-0 text-rose-400/70 transition-transform group-hover:scale-110" />
      </div>
    </Link>
  );
}

export default function BookingOverviewPage() {
  const { data, isLoading } = useQuery<Dashboard>({
    queryKey: ["admin", "booking-center", "dashboard"],
    queryFn: () => adminFetch("/admin/booking-center/dashboard"),
  });

  const cards = data?.cards ?? {};
  const base = "/admin/booking-center/bookings";

  const stats = [
    {
      icon: CalendarDays,
      label: "حجوزات اليوم",
      value: String(cards.today_bookings ?? 0),
      tone: "from-rose-400 to-pink-300",
      href: `${base}?range=today`,
    },
    {
      icon: CalendarClock,
      label: "حجوزات قادمة",
      value: String(cards.upcoming_events ?? 0),
      tone: "from-pink-400 to-fuchsia-300",
      href: `${base}?range=upcoming`,
    },
    {
      icon: Loader2,
      label: "قيد التنفيذ",
      value: String(cards.in_progress ?? 0),
      tone: "from-amber-400 to-yellow-300",
      href: `${base}?status=in_progress`,
    },
    {
      icon: CheckCircle2,
      label: "مكتملة",
      value: String(cards.completed ?? 0),
      tone: "from-emerald-400 to-teal-300",
      href: `${base}?status=completed`,
    },
    {
      icon: XCircle,
      label: "ملغاة",
      value: String(cards.cancelled ?? 0),
      tone: "from-red-400 to-rose-300",
      href: `${base}?status=cancelled`,
    },
    {
      icon: Coins,
      label: "المبلغ الكلي",
      value: formatCurrency(cards.total_amount ?? 0),
      tone: "from-violet-400 to-purple-300",
      href: base,
    },
    {
      icon: Wallet,
      label: "المدفوع",
      value: formatCurrency(cards.paid_amount ?? 0),
      tone: "from-emerald-500 to-emerald-300",
      href: `${base}?paymentStatus=paid`,
    },
    {
      icon: Wallet,
      label: "المتبقي",
      value: formatCurrency(cards.outstanding_amount ?? 0),
      tone: "from-red-500 to-orange-300",
      href: `${base}?paymentStatus=unpaid`,
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">نظرة عامة — الحجوزات</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            حجز واحد · عميل واحد · فاتورة واحدة — وكل الخدمات تحته.
          </p>
        </div>
        <Link
          href="/admin/booking-center/bookings/new"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> حجز جديد
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[86px] rounded-2xl" />
            ))
          : stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Latest bookings */}
        <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">أحدث الحجوزات</h2>
            <Link href={base} className="text-[12px] text-rose-500 hover:underline">
              عرض الكل
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : !data?.latestBookings?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد حجوزات بعد.</p>
          ) : (
            <ul className="space-y-2">
              {data.latestBookings.map((booking) => {
                const badge = badgeFor(BOOKING_STATUS_LABELS, booking.status);
                return (
                  <li key={booking.id}>
                    <Link
                      href={`${base}/${booking.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/30 p-2.5 transition-colors hover:border-rose-300 hover:bg-rose-50/50 dark:hover:bg-rose-500/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {booking.bookingNo}
                          </span>{" "}
                          {booking.customerName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {booking.eventDate ?? "بدون تاريخ"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {formatCurrency(booking.grandTotal)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Latest payments */}
        <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">أحدث الدفعات</h2>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : !data?.latestPayments?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد دفعات بعد.</p>
          ) : (
            <ul className="space-y-2">
              {data.latestPayments.map((payment) => {
                const status = badgeFor(VOUCHER_STATUS_LABELS, payment.approvalStatus);
                return (
                  <li key={payment.id}>
                    <Link
                      href={`${base}/${payment.bookingId}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/30 p-2.5 transition-colors hover:border-rose-300 hover:bg-rose-50/50 dark:hover:bg-rose-500/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {payment.voucherNo}
                          </span>{" "}
                          {payment.customerName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{payment.date}</p>
                      </div>
                      <div className="shrink-0 text-left">
                        <p className="text-sm font-bold text-foreground">
                          {formatCurrency(payment.amount)}
                        </p>
                        <p className={`text-[10px] font-semibold ${status.className}`}>
                          {status.label}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Payment status mix */}
      {!isLoading && data?.latestBookings?.length ? (
        <section className="flex flex-wrap gap-2">
          {Object.entries(PAYMENT_STATUS_LABELS).map(([key, badge]) => (
            <Link
              key={key}
              href={`${base}?paymentStatus=${key}`}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-opacity hover:opacity-80 ${badge.className}`}
            >
              {badge.label}
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
