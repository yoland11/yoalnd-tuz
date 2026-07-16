"use client";

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { SERVICE_STATUS_LABELS, type ServiceCard } from "./booking-shared";

type Dashboard = { services: ServiceCard[] };

/**
 * Luxury wedding palette, one gradient per service so the grid reads as a
 * single system in both light and dark themes.
 */
const SERVICE_GRADIENTS: Record<string, string> = {
  kosha: "from-rose-200/70 to-pink-100/40 dark:from-rose-500/20 dark:to-pink-500/5",
  photography: "from-pink-200/70 to-rose-100/40 dark:from-pink-500/20 dark:to-rose-500/5",
  sound: "from-amber-200/70 to-yellow-100/40 dark:from-amber-500/20 dark:to-yellow-500/5",
  flowers: "from-rose-200/70 to-red-100/40 dark:from-rose-500/20 dark:to-red-500/5",
  gifts: "from-fuchsia-200/70 to-pink-100/40 dark:from-fuchsia-500/20 dark:to-pink-500/5",
  graduation: "from-amber-200/70 to-orange-100/40 dark:from-amber-500/20 dark:to-orange-500/5",
  led: "from-sky-200/70 to-cyan-100/40 dark:from-sky-500/20 dark:to-cyan-500/5",
  transport: "from-slate-200/70 to-zinc-100/40 dark:from-slate-500/20 dark:to-zinc-500/5",
  decor: "from-violet-200/70 to-purple-100/40 dark:from-violet-500/20 dark:to-purple-500/5",
  other: "from-stone-200/70 to-neutral-100/40 dark:from-stone-500/20 dark:to-neutral-500/5",
};

export default function BookingServicesCatalogPage() {
  // The catalog endpoint lists the services; the dashboard endpoint carries the
  // per-service counters. Both already exist, so neither needed a new API.
  const { data, isLoading } = useQuery<Dashboard>({
    queryKey: ["admin", "booking-center", "dashboard"],
    queryFn: () => adminFetch("/admin/booking-center/dashboard"),
  });

  return (
    <div className="space-y-4" dir="rtl">
      <header>
        <h1 className="text-2xl font-bold text-foreground">كتالوج الخدمات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          كل الخدمات المتاحة داخل مركز الحجوزات، مع حالة كل خدمة وإحصائياتها.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-[168px] rounded-2xl" />
            ))
          : (data?.services ?? []).map((service) => (
              <article
                key={service.key}
                className={`group relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-bl ${
                  SERVICE_GRADIENTS[service.key] ?? SERVICE_GRADIENTS.other
                } p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl" aria-hidden="true">
                      {service.icon}
                    </span>
                    <h2 className="font-bold text-foreground">{service.label}</h2>
                  </div>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-foreground/70 dark:bg-white/10">
                    {service.total}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">اليوم</dt>
                    <dd className="font-semibold text-foreground">{service.today}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">بالانتظار</dt>
                    <dd className="font-semibold text-amber-700 dark:text-amber-300">
                      {service.pending}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">قيد التنفيذ</dt>
                    <dd className="font-semibold text-sky-700 dark:text-sky-300">
                      {service.inProgress}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">مكتمل</dt>
                    <dd className="font-semibold text-emerald-700 dark:text-emerald-300">
                      {service.completed}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 border-t border-white/60 pt-2 text-[12px] text-muted-foreground dark:border-white/10">
                  قيمة حجوزات الشهر{" "}
                  <span className="font-bold text-foreground">
                    {formatCurrency(service.monthlyBooked)}
                  </span>
                </p>

                <div className="mt-3 flex gap-2">
                  <Link
                    href="/admin/booking-center/bookings/new"
                    className="flex-1 rounded-lg bg-white/80 px-2 py-1.5 text-center text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
                  >
                    إدخال سريع
                  </Link>
                  <Link
                    href={`/admin/booking-center/bookings?serviceKey=${service.key}`}
                    className="flex-1 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-2 py-1.5 text-center text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    عرض الحجوزات
                  </Link>
                </div>
              </article>
            ))}
      </div>

      {/* Service lifecycle legend */}
      <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-foreground">حالات الخدمة</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SERVICE_STATUS_LABELS).map(([key, badge]) => (
            <span
              key={key}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
