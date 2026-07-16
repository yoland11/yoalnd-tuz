"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Search, Wallet, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  badgeFor,
  type BookingRow,
} from "./booking-shared";
import { AddPaymentDialog, CancelBookingDialog } from "./booking-actions";

type Catalog = { services: { key: string; label: string; icon: string }[] };

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type Filters = {
  search: string;
  status: string;
  paymentStatus: string;
  serviceKey: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "",
  paymentStatus: "",
  serviceKey: "",
  from: "",
  to: "",
};

/**
 * Overview stat cards deep-link with range=today|upcoming. Translate that into
 * the from/to the existing list endpoint already understands, so no new API
 * parameter is needed. Resolved once into state — deriving it on every render
 * would make the date inputs impossible to clear.
 */
function parseFilters(params: URLSearchParams): Filters {
  const range = params.get("range");
  const today = todayISO();
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    paymentStatus: params.get("paymentStatus") ?? "",
    serviceKey: params.get("serviceKey") ?? "",
    from: params.get("from") ?? (range === "today" || range === "upcoming" ? today : ""),
    to: params.get("to") ?? (range === "today" ? today : ""),
  };
}

export default function BookingsListPage() {
  const searchString = useSearch();
  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(new URLSearchParams(searchString)),
  );
  const [page, setPage] = useState(1);
  const [payFor, setPayFor] = useState<BookingRow | null>(null);
  const [cancelFor, setCancelFor] = useState<BookingRow | null>(null);

  // Re-sync when the query string changes, so moving between two filtered
  // links (e.g. Overview → "قيد التنفيذ" → "مكتملة") actually re-filters.
  useEffect(() => {
    setFilters(parseFilters(new URLSearchParams(searchString)));
    setPage(1);
  }, [searchString]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const { data: catalog } = useQuery<Catalog>({
    queryKey: ["admin", "booking-center", "catalog"],
    queryFn: () => adminFetch("/admin/booking-center/services-catalog"),
    staleTime: 10 * 60_000,
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
    if (filters.serviceKey) params.set("serviceKey", filters.serviceKey);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    params.set("page", String(page));
    params.set("pageSize", "25");
    return params.toString();
  }, [filters, page]);

  const { data, isLoading } = useQuery<{
    rows: BookingRow[];
    total: number;
    page: number;
    pageSize: number;
  }>({
    queryKey: ["admin", "booking-center", "bookings", query],
    queryFn: () => adminFetch(`/admin/booking-center/bookings?${query}`),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const iconFor = (key: string) =>
    catalog?.services.find((service) => service.key === key)?.icon ?? "•";

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">كل الحجوزات</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.total ? `${data.total} حجز` : "بحث وفلترة الحجوزات"}
          </p>
        </div>
        <Link
          href="/admin/booking-center/bookings/new"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Plus className="h-4 w-4" /> حجز جديد
        </Link>
      </header>

      {/* Filters */}
      <section className="rounded-2xl border border-border/40 bg-card p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filters.search}
              onChange={(event) => set("search", event.target.value)}
              placeholder="رقم الحجز / الاسم / الهاتف…"
              aria-label="بحث"
              className="w-full rounded-lg border border-border/40 bg-background py-2 pr-9 pl-3 text-sm"
            />
          </div>
          <select
            value={filters.status}
            onChange={(event) => set("status", event.target.value)}
            aria-label="الحالة"
            className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          >
            <option value="">كل الحالات</option>
            {Object.entries(BOOKING_STATUS_LABELS).map(([key, badge]) => (
              <option key={key} value={key}>
                {badge.label}
              </option>
            ))}
          </select>
          <select
            value={filters.paymentStatus}
            onChange={(event) => set("paymentStatus", event.target.value)}
            aria-label="حالة الدفع"
            className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          >
            <option value="">كل حالات الدفع</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([key, badge]) => (
              <option key={key} value={key}>
                {badge.label}
              </option>
            ))}
          </select>
          <select
            value={filters.serviceKey}
            onChange={(event) => set("serviceKey", event.target.value)}
            aria-label="نوع الخدمة"
            className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          >
            <option value="">كل الخدمات</option>
            {(catalog?.services ?? []).map((service) => (
              <option key={service.key} value={service.key}>
                {service.icon} {service.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={(event) => set("from", event.target.value)}
            aria-label="من تاريخ"
            className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => set("to", event.target.value)}
            aria-label="إلى تاريخ"
            className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
          />
        </div>
        {hasFilters ? (
          <button
            type="button"
            onClick={resetFilters}
            className="mt-2 text-[12px] text-rose-500 hover:underline"
          >
            مسح الفلاتر
          </button>
        ) : null}
      </section>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !data?.rows?.length ? (
        <p className="rounded-2xl border border-border/40 bg-card py-16 text-center text-sm text-muted-foreground">
          لا توجد حجوزات مطابقة.
        </p>
      ) : (
        <>
          {/* Desktop table — scrolls inside its own container so the page never
              scrolls horizontally. */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border/40 bg-card shadow-sm lg:block">
            <table className="w-full min-w-[900px] text-right text-sm">
              <thead className="border-b border-border/40 bg-muted/40">
                <tr className="text-[12px] text-muted-foreground">
                  <th className="p-3 font-medium">رقم الحجز</th>
                  <th className="p-3 font-medium">الزبون</th>
                  <th className="p-3 font-medium">الهاتف</th>
                  <th className="p-3 font-medium">الخدمات</th>
                  <th className="p-3 font-medium">التاريخ</th>
                  <th className="p-3 font-medium">الوقت</th>
                  <th className="p-3 font-medium">الإجمالي</th>
                  <th className="p-3 font-medium">المدفوع</th>
                  <th className="p-3 font-medium">المتبقي</th>
                  <th className="p-3 font-medium">الحالة</th>
                  <th className="p-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {data.rows.map((row) => {
                  const badge = badgeFor(BOOKING_STATUS_LABELS, row.status);
                  const pay = badgeFor(PAYMENT_STATUS_LABELS, row.payment_status);
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-muted/30">
                      <td className="p-3 font-mono text-[12px]">{row.booking_no}</td>
                      <td className="p-3 font-medium text-foreground">{row.customer_name}</td>
                      <td className="p-3 text-muted-foreground" dir="ltr">
                        {row.customer_phone || "—"}
                      </td>
                      <td className="p-3">
                        <span className="flex gap-0.5">
                          {(row.services ?? []).map((service) => (
                            <span key={service.serviceKey} title={service.serviceKey}>
                              {iconFor(service.serviceKey)}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">{row.event_date ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{row.event_time ?? "—"}</td>
                      <td className="p-3 font-semibold">{formatCurrency(row.grand_total)}</td>
                      <td className="p-3 text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(row.paid_amount)}
                      </td>
                      <td className="p-3 text-red-600 dark:text-red-400">
                        {formatCurrency(row.remaining_amount)}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <span
                            className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${pay.className}`}
                          >
                            {pay.label}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/admin/booking-center/bookings/${row.id}`}
                            title="عرض التفاصيل"
                            aria-label="عرض التفاصيل"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            href={`/admin/booking-center/bookings/${row.id}?edit=1`}
                            title="تعديل"
                            aria-label="تعديل"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setPayFor(row)}
                            disabled={row.status === "cancelled"}
                            title="إضافة دفعة"
                            aria-label="إضافة دفعة"
                            className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 dark:hover:bg-emerald-500/10"
                          >
                            <Wallet className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelFor(row)}
                            disabled={row.status === "cancelled"}
                            title="إلغاء الحجز"
                            aria-label="إلغاء الحجز"
                            className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-500/10"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {data.rows.map((row) => {
              const badge = badgeFor(BOOKING_STATUS_LABELS, row.status);
              const pay = badgeFor(PAYMENT_STATUS_LABELS, row.payment_status);
              return (
                <article
                  key={row.id}
                  className="rounded-xl border border-border/40 bg-card p-3 shadow-sm"
                >
                  <Link
                    href={`/admin/booking-center/bookings/${row.id}`}
                    className="block"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {row.booking_no}
                        </p>
                        <p className="truncate font-semibold text-foreground">
                          {row.customer_name}
                        </p>
                        <p className="text-[12px] text-muted-foreground" dir="ltr">
                          {row.customer_phone || "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pay.className}`}
                        >
                          {pay.label}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                      <span>{row.event_date ?? "بدون تاريخ"}</span>
                      {row.event_time ? <span>{row.event_time}</span> : null}
                      <span className="flex gap-0.5">
                        {(row.services ?? []).map((service) => (
                          <span key={service.serviceKey}>{iconFor(service.serviceKey)}</span>
                        ))}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border/30 pt-2 text-[12px]">
                      <div>
                        <p className="text-muted-foreground">الإجمالي</p>
                        <p className="font-semibold text-foreground">
                          {formatCurrency(row.grand_total)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">المدفوع</p>
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(row.paid_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">المتبقي</p>
                        <p className="font-semibold text-red-600 dark:text-red-400">
                          {formatCurrency(row.remaining_amount)}
                        </p>
                      </div>
                    </div>
                  </Link>
                  <div className="mt-2 flex gap-2 border-t border-border/30 pt-2">
                    <button
                      type="button"
                      onClick={() => setPayFor(row)}
                      disabled={row.status === "cancelled"}
                      className="flex-1 rounded-lg bg-emerald-50 py-1.5 text-[12px] font-semibold text-emerald-700 disabled:opacity-40 dark:bg-emerald-500/10 dark:text-emerald-300"
                    >
                      إضافة دفعة
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelFor(row)}
                      disabled={row.status === "cancelled"}
                      className="flex-1 rounded-lg bg-red-50 py-1.5 text-[12px] font-semibold text-red-700 disabled:opacity-40 dark:bg-red-500/10 dark:text-red-300"
                    >
                      إلغاء
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-center gap-2" aria-label="ترقيم الصفحات">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border/40 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                السابق
              </button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border/40 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                التالي
              </button>
            </nav>
          ) : null}
        </>
      )}

      {payFor ? (
        <AddPaymentDialog
          bookingId={payFor.id}
          bookingNo={payFor.booking_no}
          remaining={payFor.remaining_amount}
          onClose={() => setPayFor(null)}
        />
      ) : null}
      {cancelFor ? (
        <CancelBookingDialog
          bookingId={cancelFor.id}
          bookingNo={cancelFor.booking_no}
          paid={cancelFor.paid_amount}
          onClose={() => setCancelFor(null)}
        />
      ) : null}
    </div>
  );
}
