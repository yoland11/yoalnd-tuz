"use client";

import { useEffect, useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Lightbulb,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Printer,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { AddPaymentDialog, CancelBookingDialog } from "./booking-actions";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SERVICE_STATUS_LABELS,
  VOUCHER_STATUS_LABELS,
  badgeFor,
} from "./booking-shared";

type ServiceRow = {
  id: number;
  serviceKey: string;
  status: string;
  amount: string;
  notes: string | null;
  details: Record<string, unknown>;
};

type PaymentRow = {
  id: number;
  voucherNo: string;
  date: string;
  amount: string;
  method: string;
  approvalStatus: string;
  createdByName: string;
  financialTransactionId: number | null;
};

type TimelineRow = {
  id: number;
  eventKey: string;
  title: string;
  description: string | null;
  actorName: string;
  createdAt: string;
  meta: Record<string, unknown>;
};

type BookingDetail = {
  id: number;
  bookingNo: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  eventDate: string | null;
  eventTime: string | null;
  hallName: string | null;
  hallAddress: string | null;
  mapUrl: string | null;
  status: string;
  servicesTotal: string;
  productsTotal: string;
  additionalCharges: string;
  discount: string;
  grandTotal: string;
  paidAmount: string;
  pendingReceiptAmount: string;
  refundedAmount: string;
  remainingAmount: string;
  paymentStatus: string;
  notes: string | null;
  internalNotes: string | null;
  cancelReason: string | null;
  createdByName: string;
  createdAt: string;
  services: ServiceRow[];
  payments: PaymentRow[];
  timeline: TimelineRow[];
  progress: { percent: number; dimensions: { key: string; label: string; ratio: number }[] };
  recommendations: { level: "info" | "warn" | "danger"; message: string }[];
};

type Catalog = { services: { key: string; label: string; icon: string }[]; statuses: string[] };

const TABS = [
  { key: "summary", label: "الملخص" },
  { key: "services", label: "الخدمات" },
  { key: "payments", label: "الدفعات" },
  { key: "timeline", label: "الخط الزمني" },
  { key: "notes", label: "الملاحظات" },
  { key: "activity", label: "سجل النشاط" },
] as const;

/** Readiness ring. Pure SVG — no layout shift, no hydration mismatch. */
function ProgressRing({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          className="stroke-rose-100 dark:stroke-white/10"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="url(#bookingRing)"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
        <defs>
          <linearGradient id="bookingRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e9d5a1" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-foreground">{percent}%</span>
        <span className="text-[10px] text-muted-foreground">الجاهزية</span>
      </div>
    </div>
  );
}

function EditBookingForm({
  booking,
  onDone,
}: {
  booking: BookingDetail;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone ?? "",
    eventDate: booking.eventDate ?? "",
    eventTime: booking.eventTime ?? "",
    hallName: booking.hallName ?? "",
    hallAddress: booking.hallAddress ?? "",
    mapUrl: booking.mapUrl ?? "",
    status: booking.status,
    discount: booking.discount,
    additionalCharges: booking.additionalCharges,
    notes: booking.notes ?? "",
    internalNotes: booking.internalNotes ?? "",
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/booking-center/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("تم حفظ التعديلات");
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      onDone();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const field = "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm";
  const set = (key: keyof typeof form) => (event: any) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="space-y-2 rounded-2xl border border-rose-300 bg-card p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({
          ...form,
          eventDate: form.eventDate || null,
          eventTime: form.eventTime || null,
          mapUrl: form.mapUrl || null,
          discount: Number(form.discount) || 0,
          additionalCharges: Number(form.additionalCharges) || 0,
        });
      }}
    >
      <h2 className="text-sm font-semibold text-foreground">تعديل الحجز</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={form.customerName} onChange={set("customerName")} placeholder="اسم الزبون" aria-label="اسم الزبون" className={field} />
        <input value={form.customerPhone} onChange={set("customerPhone")} placeholder="الهاتف" dir="ltr" aria-label="الهاتف" className={field} />
        <input type="date" value={form.eventDate} onChange={set("eventDate")} aria-label="التاريخ" className={field} />
        <input type="time" value={form.eventTime} onChange={set("eventTime")} aria-label="الوقت" className={field} />
        <input value={form.hallName} onChange={set("hallName")} placeholder="القاعة" aria-label="القاعة" className={field} />
        <input value={form.hallAddress} onChange={set("hallAddress")} placeholder="العنوان" aria-label="العنوان" className={field} />
        <input value={form.mapUrl} onChange={set("mapUrl")} placeholder="رابط الخريطة" dir="ltr" aria-label="رابط الخريطة" className={field} />
        <select value={form.status} onChange={set("status")} aria-label="الحالة" className={field}>
          {Object.entries(BOOKING_STATUS_LABELS)
            .filter(([key]) => key !== "cancelled")
            .map(([key, badge]) => (
              <option key={key} value={key}>
                {badge.label}
              </option>
            ))}
        </select>
        <input value={form.additionalCharges} onChange={set("additionalCharges")} inputMode="decimal" placeholder="رسوم إضافية" aria-label="رسوم إضافية" className={field} />
        <input value={form.discount} onChange={set("discount")} inputMode="decimal" placeholder="الخصم" aria-label="الخصم" className={field} />
      </div>
      <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="ملاحظات" aria-label="ملاحظات" className={`${field} resize-none`} />
      <textarea value={form.internalNotes} onChange={set("internalNotes")} rows={2} placeholder="ملاحظات داخلية" aria-label="ملاحظات داخلية" className={`${field} resize-none`} />
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="flex-1 rounded-lg border border-border/40 px-4 py-2 text-sm text-muted-foreground">
          إلغاء
        </button>
        <button type="submit" disabled={mutation.isPending} className="flex-1 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {mutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
      </div>
    </form>
  );
}

function AddServiceRow({ bookingId, existing }: { bookingId: number; existing: string[] }) {
  const queryClient = useQueryClient();
  const [serviceKey, setServiceKey] = useState("");
  const [amount, setAmount] = useState("");

  const { data: catalog } = useQuery<Catalog>({
    queryKey: ["admin", "booking-center", "catalog"],
    queryFn: () => adminFetch("/admin/booking-center/services-catalog"),
    staleTime: 10 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/booking-center/bookings/${bookingId}/services`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("تمت إضافة الخدمة");
      setServiceKey("");
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const available = (catalog?.services ?? []).filter((s) => !existing.includes(s.key));
  const field = "rounded-lg border border-border/40 bg-background px-3 py-2 text-sm";

  return (
    <form
      className="flex flex-wrap gap-2 rounded-xl border border-dashed border-border/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!serviceKey) {
          toast.error("اختر الخدمة");
          return;
        }
        mutation.mutate({ serviceKey, amount: Number(amount) || 0 });
      }}
    >
      <select
        value={serviceKey}
        onChange={(event) => setServiceKey(event.target.value)}
        aria-label="الخدمة"
        className={`${field} flex-1`}
      >
        <option value="">إضافة خدمة…</option>
        {available.map((service) => (
          <option key={service.key} value={service.key}>
            {service.icon} {service.label}
          </option>
        ))}
      </select>
      <input
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        inputMode="decimal"
        placeholder="المبلغ"
        aria-label="المبلغ"
        className={`${field} w-28`}
      />
      <button
        type="submit"
        disabled={mutation.isPending || !available.length}
        className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        <Plus className="h-4 w-4" /> إضافة
      </button>
    </form>
  );
}

export default function BookingWorkspacePage() {
  const [, params] = useRoute("/admin/booking-center/bookings/:id");
  const searchString = useSearch();
  const bookingId = Number(params?.id);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("summary");
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<BookingDetail>({
    queryKey: ["admin", "booking-center", "booking", bookingId],
    queryFn: () => adminFetch(`/admin/booking-center/bookings/${bookingId}`),
    enabled: Number.isFinite(bookingId) && bookingId > 0,
  });

  const { data: catalog } = useQuery<Catalog>({
    queryKey: ["admin", "booking-center", "catalog"],
    queryFn: () => adminFetch("/admin/booking-center/services-catalog"),
    staleTime: 10 * 60_000,
  });

  // "Save & Print" and the list's edit action deep-link with ?print=1 / ?edit=1.
  const wantsPrint = new URLSearchParams(searchString).get("print") === "1";
  const wantsEdit = new URLSearchParams(searchString).get("edit") === "1";
  useEffect(() => {
    if (wantsEdit) setEditing(true);
  }, [wantsEdit]);
  useEffect(() => {
    if (!wantsPrint || !data) return undefined;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [wantsPrint, data]);

  const removeService = useMutation({
    mutationFn: (key: string) =>
      adminFetch(`/admin/booking-center/bookings/${bookingId}/services/${key}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("تم حذف الخدمة");
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
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
        <Link href="/admin/booking-center/bookings" className="mt-3 inline-block text-sm text-rose-500">
          العودة لكل الحجوزات
        </Link>
      </div>
    );
  }

  const phone = data.customerPhone?.replace(/[^\d+]/g, "");
  const statusBadge = badgeFor(BOOKING_STATUS_LABELS, data.status);
  const cancelled = data.status === "cancelled";
  const iconFor = (key: string) =>
    catalog?.services.find((service) => service.key === key)?.icon ?? "•";
  const labelFor = (key: string) =>
    catalog?.services.find((service) => service.key === key)?.label ?? key;

  return (
    <div className="space-y-4" dir="rtl">
      <Link
        href="/admin/booking-center/bookings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowRight className="h-4 w-4" /> كل الحجوزات
      </Link>

      {/* Header */}
      <header className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-xs text-muted-foreground">{data.bookingNo}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            </div>
            <h1 className="mt-0.5 text-xl font-bold text-foreground">{data.customerName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span>{data.eventDate ?? "بدون تاريخ"}</span>
              {data.eventTime ? <span>{data.eventTime}</span> : null}
              {data.hallName ? <span>{data.hallName}</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 print:hidden">
              {phone ? (
                <>
                  <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-[12px] font-medium text-foreground/80">
                    <Phone className="h-3.5 w-3.5" /> اتصال
                  </a>
                  <a href={`https://wa.me/${phone.replace(/^\+/, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <MessageCircle className="h-3.5 w-3.5" /> واتساب
                  </a>
                </>
              ) : null}
              {data.mapUrl ? (
                <a href={data.mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1 text-[12px] font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  <MapPin className="h-3.5 w-3.5" /> الخريطة
                </a>
              ) : null}
              {data.customerId ? (
                <Link href={`/admin/customers?id=${data.customerId}`} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-[12px] font-medium text-foreground/80">
                  كشف حساب الزبون
                </Link>
              ) : null}
            </div>
          </div>
          <ProgressRing percent={data.progress?.percent ?? 0} />
        </div>

        {/* Quick actions */}
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/30 pt-3 print:hidden">
          <button type="button" onClick={() => setEditing((v) => !v)} disabled={cancelled} className="inline-flex items-center gap-1 rounded-lg border border-border/40 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">
            <Pencil className="h-3.5 w-3.5" /> تعديل
          </button>
          <button type="button" onClick={() => setPaying(true)} disabled={cancelled} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 disabled:opacity-40 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Wallet className="h-3.5 w-3.5" /> إضافة دفعة
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border border-border/40 px-3 py-1.5 text-[12px] font-medium">
            <Printer className="h-3.5 w-3.5" /> طباعة
          </button>
          <button type="button" onClick={() => setCancelling(true)} disabled={cancelled} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700 disabled:opacity-40 dark:bg-red-500/10 dark:text-red-300">
            <XCircle className="h-3.5 w-3.5" /> إلغاء الحجز
          </button>
        </div>

        {cancelled && data.cancelReason ? (
          <p className="mt-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800 dark:bg-red-500/10 dark:text-red-300">
            سبب الإلغاء: {data.cancelReason}
          </p>
        ) : null}
      </header>

      {editing ? <EditBookingForm booking={data} onDone={() => setEditing(false)} /> : null}

      {/* Recommendations */}
      {data.recommendations?.length ? (
        <section className="rounded-2xl border border-amber-200/60 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/5 print:hidden">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <Lightbulb className="h-4 w-4" /> توصيات
          </h2>
          <ul className="space-y-1">
            {data.recommendations.map((item, index) => (
              <li key={index} className={`text-[12px] ${item.level === "danger" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-200"}`}>
                • {item.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border/40 bg-card p-1 print:hidden">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === item.key
                ? "bg-gradient-to-l from-rose-400 to-pink-400 text-white"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "summary" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">معلومات الزبون والحجز</h2>
            <dl className="space-y-1.5 text-[13px]">
              {[
                ["الزبون", data.customerName],
                ["الهاتف", data.customerPhone || "—"],
                ["تاريخ المناسبة", data.eventDate ?? "—"],
                ["الوقت", data.eventTime ?? "—"],
                ["القاعة", data.hallName ?? "—"],
                ["العنوان", data.hallAddress ?? "—"],
                ["أنشئ بواسطة", data.createdByName || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-left text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">الملخص المالي</h2>
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
                <dd className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(data.paidAmount)}</dd>
              </div>
              {Number(data.pendingReceiptAmount) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">بانتظار الاعتماد</dt>
                  <dd className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(data.pendingReceiptAmount)}</dd>
                </div>
              ) : null}
              {Number(data.refundedAmount) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">المسترجع</dt>
                  <dd className="font-semibold text-sky-600 dark:text-sky-400">{formatCurrency(data.refundedAmount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border/30 pt-1.5">
                <dt className="font-semibold text-foreground">المتبقي</dt>
                <dd className="font-bold text-red-600 dark:text-red-400">{formatCurrency(data.remainingAmount)}</dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}

      {tab === "services" ? (
        <section className="space-y-2">
          {data.services.map((service) => {
            const badge = badgeFor(SERVICE_STATUS_LABELS, service.status);
            const qty = Number(service.details?.quantity ?? 0);
            return (
              <div key={service.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/40 bg-card p-3">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">{iconFor(service.serviceKey)}</span>
                  <div>
                    <p className="font-semibold text-foreground">{labelFor(service.serviceKey)}</p>
                    {qty > 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        الكمية {qty} × {formatCurrency(String(service.details?.unitPrice ?? 0))}
                      </p>
                    ) : null}
                    {service.notes ? <p className="text-[12px] text-muted-foreground">{service.notes}</p> : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-foreground">{formatCurrency(service.amount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`حذف خدمة ${labelFor(service.serviceKey)} من الحجز؟`))
                        removeService.mutate(service.serviceKey);
                    }}
                    disabled={cancelled || removeService.isPending}
                    aria-label="حذف الخدمة"
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-500/10 print:hidden"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {!cancelled ? (
            <AddServiceRow bookingId={data.id} existing={data.services.map((s) => s.serviceKey)} />
          ) : null}
        </section>
      ) : null}

      {tab === "payments" ? (
        <section className="space-y-2">
          {!data.payments?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد دفعات بعد.</p>
          ) : (
            data.payments.map((payment) => {
              const status = badgeFor(VOUCHER_STATUS_LABELS, payment.approvalStatus);
              return (
                <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/40 bg-card p-3">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                      <BadgeCheck className="h-4 w-4 text-rose-400" />
                      <span className="font-mono text-xs">{payment.voucherNo}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {payment.date} · {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                      {payment.createdByName ? ` · ${payment.createdByName}` : ""}
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
        <section className="rounded-2xl border border-border/40 bg-card p-4">
          {!data.timeline?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد أحداث بعد.</p>
          ) : (
            <ol className="relative space-y-4 border-r border-rose-200 pr-4 dark:border-rose-500/20">
              {data.timeline.map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="absolute -right-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-gradient-to-l from-rose-400 to-pink-400" />
                  <p className="text-[13px] font-semibold text-foreground">{entry.title}</p>
                  {entry.description ? <p className="text-[12px] text-muted-foreground">{entry.description}</p> : null}
                  <p className="text-[11px] text-muted-foreground/70">
                    {new Date(entry.createdAt).toLocaleString("en-GB")}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {tab === "notes" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border/40 bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">ملاحظات</h2>
            <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
              {data.notes || "لا توجد ملاحظات."}
            </p>
          </section>
          <section className="rounded-2xl border border-border/40 bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">ملاحظات داخلية</h2>
            <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
              {data.internalNotes || "لا توجد ملاحظات داخلية."}
            </p>
          </section>
        </div>
      ) : null}

      {tab === "activity" ? (
        <section className="overflow-x-auto rounded-2xl border border-border/40 bg-card">
          <table className="w-full min-w-[520px] text-right text-sm">
            <thead className="border-b border-border/40 bg-muted/40">
              <tr className="text-[12px] text-muted-foreground">
                <th className="p-3 font-medium">الحدث</th>
                <th className="p-3 font-medium">التفاصيل</th>
                <th className="p-3 font-medium">المستخدم</th>
                <th className="p-3 font-medium">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {data.timeline.map((entry) => (
                <tr key={entry.id}>
                  <td className="p-3 font-mono text-[11px] text-muted-foreground">{entry.eventKey}</td>
                  <td className="p-3 text-foreground">{entry.title}</td>
                  <td className="p-3 text-muted-foreground">{entry.actorName || "—"}</td>
                  <td className="p-3 text-[12px] text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString("en-GB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {paying ? (
        <AddPaymentDialog
          bookingId={data.id}
          bookingNo={data.bookingNo}
          remaining={data.remainingAmount}
          onClose={() => setPaying(false)}
        />
      ) : null}
      {cancelling ? (
        <CancelBookingDialog
          bookingId={data.id}
          bookingNo={data.bookingNo}
          paid={data.paidAmount}
          onClose={() => setCancelling(false)}
        />
      ) : null}
    </div>
  );
}
