"use client";

import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Lightbulb,
  MapPin,
  MessageCircle,
  Phone,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";

type ServiceRow = {
  id: number;
  serviceKey: string;
  status: string;
  amount: string;
  notes: string | null;
};

type PaymentRow = {
  id: number;
  voucherNo: string;
  date: string;
  amount: string;
  method: string;
  approvalStatus: string;
  createdByName: string;
};

type TimelineRow = {
  id: number;
  eventKey: string;
  title: string;
  description: string | null;
  actorName: string;
  createdAt: string;
};

type BookingDetail = {
  id: number;
  bookingNo: string;
  customerName: string;
  customerPhone: string;
  eventDate: string | null;
  eventTime: string | null;
  hallName: string | null;
  mapUrl: string | null;
  status: string;
  grandTotal: string;
  servicesTotal: string;
  productsTotal: string;
  additionalCharges: string;
  discount: string;
  paidAmount: string;
  pendingReceiptAmount: string;
  refundedAmount: string;
  remainingAmount: string;
  paymentStatus: string;
  services: ServiceRow[];
  payments: PaymentRow[];
  timeline: TimelineRow[];
  progress: { percent: number; dimensions: { key: string; label: string; ratio: number }[] };
  recommendations: { level: "info" | "warn" | "danger"; message: string }[];
};

const SERVICE_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  waiting: { label: "بالانتظار", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300" },
  preparing: { label: "قيد التحضير", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ready: { label: "جاهز", className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  dispatched: { label: "تم الإرسال", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  installed: { label: "تم التركيب", className: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  running: { label: "قيد التشغيل", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300" },
  finished: { label: "منتهي", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  returned: { label: "تم الإرجاع", className: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300" },
  cancelled: { label: "ملغى", className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
};

const VOUCHER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "مسودة", className: "text-zinc-500" },
  pending: { label: "بانتظار الاعتماد", className: "text-amber-600 dark:text-amber-400" },
  executed: { label: "معتمد ومنفّذ", className: "text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "مرفوض", className: "text-red-600 dark:text-red-400" },
  reversed: { label: "معكوس", className: "text-sky-600 dark:text-sky-400" },
};

const TABS = [
  { key: "summary", label: "الملخص" },
  { key: "services", label: "الخدمات" },
  { key: "payments", label: "الدفعات" },
  { key: "timeline", label: "الخط الزمني" },
] as const;

/** Readiness ring. Pure SVG so it renders identically on server and client. */
function ProgressRing({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-rose-100 dark:stroke-white/10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="url(#ringGradient)"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
        <defs>
          <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e9d5a1" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{percent}%</span>
        <span className="text-[10px] text-muted-foreground">جاهزية الحجز</span>
      </div>
    </div>
  );
}

function ReceivePaymentForm({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/booking-center/bookings/${bookingId}/payments`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("تم إنشاء سند القبض — بانتظار اعتماد المدير", {
        description: "لن يتغير رصيد الحجز أو الصندوق قبل الاعتماد.",
      });
      setAmount("");
      setReference("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
    },
    onError: (error: any) => toast.error(error?.message || "تعذر إنشاء سند القبض"),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) {
          toast.error("أدخل مبلغاً صحيحاً");
          return;
        }
        mutation.mutate({ amount: value, method, reference: reference || null });
      }}
      className="space-y-3 rounded-2xl border border-white/50 bg-white/60 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Wallet className="h-4 w-4 text-rose-400" /> استلام دفعة
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="المبلغ"
          aria-label="المبلغ"
          className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        />
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          aria-label="طريقة الدفع"
          className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        >
          <option value="cash">نقداً</option>
          <option value="transfer">تحويل</option>
          <option value="pos">بطاقة</option>
          <option value="other">أخرى</option>
        </select>
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="رقم المرجع (اختياري)"
          aria-label="رقم المرجع"
          className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {mutation.isPending ? "جارٍ الإرسال…" : "إرسال للاعتماد"}
      </button>
      <p className="text-[11px] text-muted-foreground">
        يتم إنشاء سند قبض ويُرسل إلى الصندوق الرئيسي. لا يتأثر رصيد الحجز أو الصندوق إلا بعد اعتماد المدير.
      </p>
    </form>
  );
}

export default function BookingWorkspacePage() {
  const [, params] = useRoute("/admin/booking-center/:id");
  const bookingId = Number(params?.id);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("summary");

  const { data, isLoading } = useQuery<BookingDetail>({
    queryKey: ["admin", "booking-center", "booking", bookingId],
    queryFn: () => adminFetch(`/admin/booking-center/bookings/${bookingId}`),
    enabled: Number.isFinite(bookingId) && bookingId > 0,
  });

  if (isLoading) {
    return (
      <div dir="rtl" className="space-y-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div dir="rtl" className="py-16 text-center">
        <p className="text-sm text-muted-foreground">الحجز غير موجود.</p>
        <Link href="/admin/booking-center" className="mt-3 inline-block text-sm text-rose-500">
          العودة لمركز الحجوزات
        </Link>
      </div>
    );
  }

  const phone = data.customerPhone?.replace(/[^\d+]/g, "");

  return (
    <div
      dir="rtl"
      className="space-y-4 rounded-3xl bg-gradient-to-b from-rose-50/60 via-white to-white p-1 dark:from-rose-950/10 dark:via-transparent dark:to-transparent"
    >
      <Link
        href="/admin/booking-center"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4" /> مركز الحجوزات
      </Link>

      {/* Header */}
      <header className="rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{data.bookingNo}</p>
            <h1 className="mt-0.5 text-xl font-bold text-foreground">{data.customerName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span>{data.eventDate ?? "بدون تاريخ"}</span>
              {data.eventTime ? <span>{data.eventTime}</span> : null}
              {data.hallName ? <span>{data.hallName}</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {phone ? (
                <>
                  <a
                    href={`tel:${phone}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/70 px-2.5 py-1 text-[12px] font-medium text-foreground/80 dark:bg-white/10"
                  >
                    <Phone className="h-3.5 w-3.5" /> اتصال
                  </a>
                  <a
                    href={`https://wa.me/${phone.replace(/^\+/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> واتساب
                  </a>
                </>
              ) : null}
              {data.mapUrl ? (
                <a
                  href={data.mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1 text-[12px] font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                >
                  <MapPin className="h-3.5 w-3.5" /> الخريطة
                </a>
              ) : null}
            </div>
          </div>
          <ProgressRing percent={data.progress?.percent ?? 0} />
        </div>
      </header>

      {/* Recommendations */}
      {data.recommendations?.length ? (
        <section className="rounded-2xl border border-amber-200/60 bg-amber-50/60 p-3 backdrop-blur-xl dark:border-amber-500/20 dark:bg-amber-500/5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <Lightbulb className="h-4 w-4" /> توصيات
          </h2>
          <ul className="space-y-1">
            {data.recommendations.map((item, index) => (
              <li
                key={index}
                className={`text-[12px] ${
                  item.level === "danger"
                    ? "text-red-700 dark:text-red-300"
                    : "text-amber-800 dark:text-amber-200"
                }`}
              >
                • {item.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/50 bg-white/60 p-1 backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === item.key
                ? "bg-gradient-to-l from-rose-400 to-pink-400 text-white"
                : "text-muted-foreground hover:bg-white/60 dark:hover:bg-white/10"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "summary" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Financial panel */}
          <section className="rounded-2xl border border-white/50 bg-white/60 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">اللوحة المالية</h2>
            <dl className="space-y-1.5 text-[13px]">
              {[
                ["إجمالي الخدمات", data.servicesTotal],
                ["إجمالي المنتجات", data.productsTotal],
                ["رسوم إضافية", data.additionalCharges],
                ["الخصم", data.discount],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-foreground">{formatCurrency(value)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border/30 pt-1.5">
                <dt className="font-semibold text-foreground">الإجمالي الكلي</dt>
                <dd className="font-bold text-foreground">{formatCurrency(data.grandTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">المدفوع (معتمد)</dt>
                <dd className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(data.paidAmount)}
                </dd>
              </div>
              {Number(data.pendingReceiptAmount) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">بانتظار الاعتماد</dt>
                  <dd className="font-semibold text-amber-600 dark:text-amber-400">
                    {formatCurrency(data.pendingReceiptAmount)}
                  </dd>
                </div>
              ) : null}
              {Number(data.refundedAmount) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">المسترجع</dt>
                  <dd className="font-semibold text-sky-600 dark:text-sky-400">
                    {formatCurrency(data.refundedAmount)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border/30 pt-1.5">
                <dt className="font-semibold text-foreground">المتبقي</dt>
                <dd className="font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(data.remainingAmount)}
                </dd>
              </div>
            </dl>
          </section>

          <ReceivePaymentForm bookingId={data.id} />
        </div>
      ) : null}

      {tab === "services" ? (
        <section className="space-y-2">
          {!data.services?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              لم يتم تفعيل أي خدمة لهذا الحجز.
            </p>
          ) : (
            data.services.map((service) => {
              const badge = SERVICE_STATUS_LABELS[service.status] ?? SERVICE_STATUS_LABELS.waiting;
              return (
                <div
                  key={service.id}
                  className="flex items-center justify-between rounded-xl border border-white/50 bg-white/60 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
                >
                  <div>
                    <p className="font-semibold text-foreground">{service.serviceKey}</p>
                    {service.notes ? (
                      <p className="text-[12px] text-muted-foreground">{service.notes}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-foreground">
                      {formatCurrency(service.amount)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </section>
      ) : null}

      {tab === "payments" ? (
        <section className="space-y-2">
          {!data.payments?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد دفعات بعد.</p>
          ) : (
            data.payments.map((payment) => {
              const status = VOUCHER_STATUS_LABELS[payment.approvalStatus] ?? {
                label: payment.approvalStatus,
                className: "text-muted-foreground",
              };
              return (
                <div
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/50 bg-white/60 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
                >
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                      <BadgeCheck className="h-4 w-4 text-rose-400" />
                      <span className="font-mono text-xs">{payment.voucherNo}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {payment.date} · {payment.method} · {payment.createdByName}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-foreground">{formatCurrency(payment.amount)}</p>
                    <p className={`text-[11px] font-semibold ${status.className}`}>{status.label}</p>
                  </div>
                </div>
              );
            })
          )}
        </section>
      ) : null}

      {tab === "timeline" ? (
        <section className="rounded-2xl border border-white/50 bg-white/60 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          {!data.timeline?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد أحداث بعد.</p>
          ) : (
            <ol className="relative space-y-4 border-r border-rose-200 pr-4 dark:border-rose-500/20">
              {data.timeline.map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="absolute -right-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-gradient-to-l from-rose-400 to-pink-400" />
                  <p className="text-[13px] font-semibold text-foreground">{entry.title}</p>
                  {entry.description ? (
                    <p className="text-[12px] text-muted-foreground">{entry.description}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground/70">
                    {new Date(entry.createdAt).toLocaleString("en-GB")}
                    {entry.actorName ? ` · ${entry.actorName}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}
