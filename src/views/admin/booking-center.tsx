"use client";

import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  Clock,
  Coins,
  Plus,
  Search,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";

type ServiceCard = {
  key: string;
  label: string;
  icon: string;
  total: number;
  today: number;
  pending: number;
  inProgress: number;
  completed: number;
  /** Value booked this month — not cash collected. See getBookingCenterDashboard. */
  monthlyBooked: number;
};

type Dashboard = {
  cards: {
    today_bookings?: number;
    upcoming_events?: number;
    pending_payments?: number;
    outstanding_amount?: string | number;
    monthly_revenue?: string | number;
    total_bookings?: number;
  };
  services: ServiceCard[];
};

type BookingRow = {
  id: number;
  booking_no: string;
  customer_name: string;
  customer_phone: string;
  event_date: string | null;
  status: string;
  grand_total: string;
  paid_amount: string;
  remaining_amount: string;
  payment_status: string;
  services: { serviceKey: string; status: string; amount: string }[];
};

/**
 * Luxury wedding palette. Kept as explicit gradient pairs rather than arbitrary
 * per-card colours so every card reads as one system in both themes.
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

const PAYMENT_BADGES: Record<string, { label: string; className: string }> = {
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

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغى",
};

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-l ${tone}`} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-bold text-foreground">{value}</p>
        </div>
        <Icon className="h-8 w-8 shrink-0 text-rose-400/70 dark:text-rose-300/60" />
      </div>
    </div>
  );
}

/**
 * Create a unified booking with its services selected up front — one customer,
 * one booking number, many services.
 */
function NewBookingDialog({
  services,
  presetService,
  onClose,
}: {
  services: ServiceCard[];
  presetService: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [hallName, setHallName] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>(
    presetService ? { [presetService]: "" } : {},
  );

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch("/admin/booking-center/bookings", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (row: { id: number; bookingNo: string }) => {
      toast.success(`تم إنشاء الحجز ${row.bookingNo}`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      onClose();
      navigate(`/admin/booking-center/${row.id}`);
    },
    onError: (error: any) => toast.error(error?.message || "تعذر إنشاء الحجز"),
  });

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (key in next) delete next[key];
      else next[key] = "";
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="حجز جديد"
      onClick={onClose}
    >
      <div
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/60 bg-white/95 p-5 shadow-2xl backdrop-blur-2xl sm:rounded-3xl dark:border-white/10 dark:bg-zinc-900/95"
      >
        <h2 className="text-lg font-bold text-foreground">حجز جديد</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          عميل واحد · رقم حجز واحد · كل الخدمات تحته.
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!customerName.trim()) {
              toast.error("اسم الزبون مطلوب");
              return;
            }
            mutation.mutate({
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              eventDate: eventDate || null,
              hallName: hallName.trim() || null,
              status: "draft",
              services: Object.entries(selected).map(([key, amount]) => ({
                serviceKey: key,
                amount: Number(amount) || 0,
              })),
            });
          }}
        >
          <input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="اسم الزبون *"
            aria-label="اسم الزبون"
            className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              placeholder="رقم الهاتف"
              inputMode="tel"
              aria-label="رقم الهاتف"
              className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
            />
            <input
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
              type="date"
              aria-label="تاريخ المناسبة"
              className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
            />
          </div>
          <input
            value={hallName}
            onChange={(event) => setHallName(event.target.value)}
            placeholder="القاعة"
            aria-label="القاعة"
            className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          />

          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-foreground">
              الخدمات المطلوبة
            </legend>
            <div className="space-y-1.5">
              {services.map((service) => {
                const active = service.key in selected;
                return (
                  <div key={service.key} className="flex items-center gap-2">
                    <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border/30 px-2.5 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggle(service.key)}
                        className="accent-rose-400"
                      />
                      <span aria-hidden="true">{service.icon}</span>
                      <span className="text-foreground">{service.label}</span>
                    </label>
                    {active ? (
                      <input
                        value={selected[service.key]}
                        onChange={(event) =>
                          setSelected((prev) => ({
                            ...prev,
                            [service.key]: event.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder="المبلغ"
                        aria-label={`مبلغ ${service.label}`}
                        className="w-28 rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {mutation.isPending ? "جارٍ الإنشاء…" : "إنشاء الحجز"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BookingCenterPage() {
  const [search, setSearch] = useState("");
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ preset: string | null } | null>(null);

  const { data: dashboard, isLoading } = useQuery<Dashboard>({
    queryKey: ["admin", "booking-center", "dashboard"],
    queryFn: () => adminFetch("/admin/booking-center/dashboard"),
  });

  const listQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (serviceKey) params.set("serviceKey", serviceKey);
    params.set("pageSize", "25");
    return params.toString();
  }, [search, serviceKey]);

  const { data: list, isLoading: listLoading } = useQuery<{
    rows: BookingRow[];
    total: number;
  }>({
    queryKey: ["admin", "booking-center", "bookings", listQuery],
    queryFn: () => adminFetch(`/admin/booking-center/bookings?${listQuery}`),
  });

  const cards = dashboard?.cards ?? {};

  return (
    <div
      dir="rtl"
      className="space-y-6 rounded-3xl bg-gradient-to-b from-rose-50/60 via-white to-white p-1 dark:from-rose-950/10 dark:via-transparent dark:to-transparent"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <span aria-hidden="true">💍</span> مركز الحجوزات
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            حجز واحد · عميل واحد · فاتورة واحدة — وكل الخدمات تحته.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating({ preset: null })}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> حجز جديد
        </button>
      </header>

      {/* Top cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[86px] rounded-2xl" />
            ))
          : (
              [
                {
                  icon: CalendarDays,
                  label: "حجوزات اليوم",
                  value: String(cards.today_bookings ?? 0),
                  tone: "from-rose-400 to-pink-300",
                },
                {
                  icon: CalendarClock,
                  label: "مناسبات قادمة",
                  value: String(cards.upcoming_events ?? 0),
                  tone: "from-pink-400 to-fuchsia-300",
                },
                {
                  icon: Clock,
                  label: "بانتظار الدفع",
                  value: String(cards.pending_payments ?? 0),
                  tone: "from-amber-400 to-yellow-300",
                },
                {
                  icon: Wallet,
                  label: "إجمالي المتبقي",
                  value: formatCurrency(cards.outstanding_amount ?? 0),
                  tone: "from-red-400 to-rose-300",
                },
                {
                  icon: Coins,
                  label: "المقبوض هذا الشهر",
                  value: formatCurrency(cards.monthly_revenue ?? 0),
                  tone: "from-amber-500 to-amber-300",
                },
                {
                  icon: CheckCircle2,
                  label: "إجمالي الحجوزات",
                  value: String(cards.total_bookings ?? 0),
                  tone: "from-emerald-400 to-teal-300",
                },
              ] as const
            ).map((card) => <StatCard key={card.label} {...card} />)}
      </section>

      {/* Service cards */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">الخدمات</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[168px] rounded-2xl" />
              ))
            : (dashboard?.services ?? []).map((service) => {
                const active = serviceKey === service.key;
                return (
                  <article
                    key={service.key}
                    className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-bl ${
                      SERVICE_GRADIENTS[service.key] ?? SERVICE_GRADIENTS.other
                    } p-4 shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
                      active
                        ? "border-rose-400 ring-2 ring-rose-300/60"
                        : "border-white/50 dark:border-white/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl" aria-hidden="true">
                          {service.icon}
                        </span>
                        <h3 className="font-bold text-foreground">{service.label}</h3>
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
                      <button
                        type="button"
                        onClick={() => setCreating({ preset: service.key })}
                        className="flex-1 rounded-lg bg-white/80 px-2 py-1.5 text-center text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
                      >
                        إدخال سريع
                      </button>
                      <button
                        type="button"
                        onClick={() => setServiceKey(active ? null : service.key)}
                        aria-pressed={active}
                        className="flex-1 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-2 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                      >
                        {active ? "إلغاء الفلتر" : "فتح"}
                      </button>
                    </div>
                  </article>
                );
              })}
        </div>
      </section>

      {/* Bookings list */}
      <section className="rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            الحجوزات {list?.total ? `(${list.total})` : ""}
          </h2>
          <div className="relative w-full max-w-xs">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث برقم الحجز / الاسم / الهاتف…"
              className="w-full rounded-lg border border-border/40 bg-background py-2 pr-9 pl-3 text-sm"
            />
          </div>
        </div>

        {listLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : !list?.rows?.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            لا توجد حجوزات مطابقة.
          </p>
        ) : (
          <div className="space-y-2">
            {list.rows.map((row) => {
              const badge = PAYMENT_BADGES[row.payment_status] ?? PAYMENT_BADGES.unpaid;
              return (
                <Link
                  key={row.id}
                  href={`/admin/booking-center/${row.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/30 bg-background/60 p-3 transition-colors hover:border-rose-300 hover:bg-rose-50/50 dark:hover:bg-rose-500/5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.booking_no}
                      </span>
                      {row.customer_name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                      <span>{row.event_date ?? "بدون تاريخ"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{STATUS_LABELS[row.status] ?? row.status}</span>
                      <span className="flex gap-0.5" aria-hidden="true">
                        {(row.services ?? []).map((service) => (
                          <span key={service.serviceKey} title={service.serviceKey}>
                            {
                              (dashboard?.services ?? []).find(
                                (item) => item.key === service.serviceKey,
                              )?.icon
                            }
                          </span>
                        ))}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <p className="text-sm font-bold text-foreground">
                        {formatCurrency(row.grand_total)}
                      </p>
                      {Number(row.remaining_amount) > 0 ? (
                        <p className="text-[11px] text-red-600 dark:text-red-400">
                          متبقي {formatCurrency(row.remaining_amount)}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-muted-foreground">
        <AlertTriangle className="h-3 w-3" />
        الوحدات القديمة (الكوش · التخرج · التصوير) تعمل كما هي — مركز الحجوزات إضافة غير هادمة.
      </p>

      {creating ? (
        <NewBookingDialog
          services={dashboard?.services ?? []}
          presetService={creating.preset}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </div>
  );
}
