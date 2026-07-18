import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Banknote, ChevronDown, ExternalLink, FileText, Loader2,
  MapPin, Printer, RefreshCw, RotateCcw, Search, Truck, User, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fetchAdminMe, formatCurrency, hasPerm, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";
import { useProvinces } from "./delivery-provinces";
import { printDeliveryLabel } from "./delivery-label";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

type OrderRow = {
  id: number;
  deliveryNo: string;
  salesInvoiceId: number | null;
  customerId: number | null;
  status: string;
  statusLabel: string;
  provinceName: string;
  city: string;
  receiverName: string;
  receiverPhone: string;
  deliveryCompany: string;
  deliveryType: string;
  deliveryTypeLabel: string;
  deliveryFee: number;
  codEnabled: boolean;
  codAmount: number;
  expectedArrivalDate: string | null;
  createdAt: string;
};

type StatusOption = { value: string; label: string };

/** Statuses a user can move an order to from the board (return/cancel are separate). */
const FLOW_STATUSES = [
  "pending_prep", "ready_to_ship", "handed_to_company",
  "in_transit", "arrived_province", "out_for_delivery", "delivered", "failed",
];

const ordersKey = ["admin", "delivery", "orders"] as const;

export default function DeliveryOrdersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();
  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: provinces } = useProvinces(false);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [provinceId, setProvinceId] = useState("");
  const [company, setCompany] = useState("");
  const [codOnly, setCodOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const user = me ?? null;
  const canStatus = hasPerm(user, "delivery") || hasPerm(user, "delivery_status_update");
  const canSettle = hasPerm(user, "delivery_cod_settle");
  const canReturn = hasPerm(user, "delivery") || hasPerm(user, "delivery_return");
  const canCancel = hasPerm(user, "delivery") || hasPerm(user, "delivery_cancel");
  const canPrint = hasPerm(user, "delivery") || hasPerm(user, "delivery_label_print");

  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (provinceId) query.set("provinceId", provinceId);
  if (q.trim()) query.set("q", q.trim());
  query.set("limit", "300");

  const { data, isLoading, isError, isFetching, refetch } = useQuery<{ data: OrderRow[]; statuses: StatusOption[] }>({
    queryKey: [...ordersKey, status, provinceId, q],
    queryFn: () => adminFetch(`/admin/delivery/orders?${query.toString()}`),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ordersKey });
  }

  const updateStatus = useMutation({
    mutationFn: ({ id, next }: { id: number; next: string }) =>
      adminFetch(`/admin/delivery/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status: next }) }),
    onSuccess: () => { invalidate(); toast({ title: "تم تحديث حالة التوصيل" }); },
    onError: (e: any) => toast({ title: "تعذر التحديث", description: e?.message, variant: "destructive" }),
  });

  // Client-side filters that the API doesn't cover (company / COD / date range).
  const rows = useMemo(() => {
    let list = data?.data ?? [];
    if (company.trim()) {
      const c = company.trim().toLowerCase();
      list = list.filter((r) => (r.deliveryCompany ?? "").toLowerCase().includes(c));
    }
    if (codOnly) list = list.filter((r) => r.codEnabled);
    if (from) list = list.filter((r) => String(r.createdAt).slice(0, 10) >= from);
    if (to) list = list.filter((r) => String(r.createdAt).slice(0, 10) <= to);
    return list;
  }, [data?.data, company, codOnly, from, to]);

  const totals = useMemo(
    () => ({
      count: rows.length,
      fees: rows.reduce((s, r) => s + (r.deliveryFee || 0), 0),
      cod: rows.reduce((s, r) => s + (r.codEnabled ? r.codAmount || 0 : 0), 0),
      delivered: rows.filter((r) => r.status === "delivered").length,
      returned: rows.filter((r) => r.status === "returned").length,
    }),
    [rows],
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" /> طلبات التوصيل
        </h1>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      {/* ── Filters ── */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث: رقم التوصيل، المستلم، الهاتف، المحافظة، المدينة..."
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={FILTER_CLS}>
            <option value="">كل الحالات</option>
            {(data?.statuses ?? []).map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select value={provinceId} onChange={(e) => setProvinceId(e.target.value)} className={FILTER_CLS}>
            <option value="">كل المحافظات</option>
            {(provinces ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>{p.governorateAr}</option>
            ))}
          </select>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="شركة التوصيل"
            className={FILTER_CLS}
          />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={FILTER_CLS} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={FILTER_CLS} />
          <label className="flex items-center gap-1.5 text-xs cursor-pointer px-2">
            <input type="checkbox" checked={codOnly} onChange={(e) => setCodOnly(e.target.checked)} className="accent-primary" />
            <span className="text-foreground">الدفع عند الاستلام فقط</span>
          </label>
        </div>
      </section>

      {/* ── Totals ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="عدد الطلبات" value={String(totals.count)} />
        <Stat label="مجموع أجور التوصيل" value={formatCurrency(totals.fees)} />
        <Stat label="مجموع التحصيل" value={formatCurrency(totals.cod)} />
        <Stat label="تم التسليم" value={String(totals.delivered)} />
        <Stat label="مرتجع" value={String(totals.returned)} />
      </div>

      {/* ── List ── */}
      {isError ? (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger flex items-center gap-2">
          <XCircle className="w-4 h-4" /> تعذّر تحميل طلبات التوصيل.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState message="لا توجد طلبات توصيل" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="bg-card rounded-xl border border-border/30 overflow-hidden">
              <div className="p-3 sm:p-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex-1 min-w-[200px] text-right"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-foreground">{r.deliveryNo}</span>
                    <StatusPill status={r.status} label={r.statusLabel} />
                    {r.codEnabled && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-warning/10 text-status-warning border border-status-warning/30">
                        تحصيل {formatCurrency(r.codAmount)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground mt-1">
                    {r.receiverName || "—"}
                    {r.receiverPhone ? ` — ${formatIraqiPhone(r.receiverPhone)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3 inline-block ml-1" />
                    {[r.provinceName, r.city].filter(Boolean).join(" • ") || "—"}
                    {r.deliveryCompany ? ` • ${r.deliveryCompany}` : ""}
                    {r.deliveryTypeLabel ? ` • ${r.deliveryTypeLabel}` : ""}
                  </p>
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-primary font-bold text-sm">{formatCurrency(r.deliveryFee)}</span>
                  {canStatus && !TERMINAL.includes(r.status) && (
                    <select
                      value=""
                      onChange={(e) => e.target.value && updateStatus.mutate({ id: r.id, next: e.target.value })}
                      className="bg-background border border-border/40 rounded-lg px-2 py-1.5 text-xs"
                      aria-label="تغيير الحالة"
                    >
                      <option value="">تغيير الحالة…</option>
                      {(data?.statuses ?? [])
                        .filter((s) => FLOW_STATUSES.includes(s.value) && s.value !== r.status)
                        .map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="text-muted-foreground hover:text-primary"
                    aria-label="تفاصيل"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded === r.id ? "rotate-180" : ""}`} />
                  </button>
                </div>
              </div>

              {expanded === r.id && (
                <DeliveryOrderDetails
                  id={r.id}
                  row={r}
                  me={me ?? null}
                  canSettle={canSettle}
                  canReturn={canReturn}
                  canCancel={canCancel}
                  canPrint={canPrint}
                  company={settings?.site_name ?? "AJN"}
                  logo={logoSrc(settings)}
                  onChanged={invalidate}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const FILTER_CLS =
  "bg-background border border-border/40 rounded-lg px-2.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const TERMINAL = ["delivered", "returned", "cancelled"];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg border border-border/30 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === "delivered" ? "bg-status-success/10 text-status-success border-status-success/30"
    : status === "returned" || status === "failed" || status === "cancelled"
      ? "bg-status-danger/10 text-status-danger border-status-danger/30"
      : "bg-primary/10 text-primary border-primary/30";
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${tone}`}>{label}</span>;
}

// ─── Details panel (invoice, address, tracking, audit, actions) ──────────────

type DetailsResponse = {
  id: number;
  deliveryNo: string;
  status: string;
  statusLabel: string;
  salesInvoiceId: number | null;
  invoiceNo: string | null;
  customerId: number | null;
  invoice: {
    invoiceNo: string; total: number; paidAmount: number; remainingAmount: number;
    paymentStatus: string; customerName: string; customerPhone: string | null;
  } | null;
  detail: any;
  returnReason: string | null;
  cancelReason: string | null;
  settlement: {
    receivedAmount: number; expectedAmount: number; settlementDate: string;
    referenceNo: string | null; account: string; accountingMode: string;
    deliveryCompany: string | null; createdByName: string; createdAt: string;
    status?: string;
  } | null;
  history: Array<{ status: string; statusLabel: string; reason: string | null; createdByName: string; createdAt: string }>;
  timeline: Array<{ id: number; type: string; title: string; body: string | null; createdAt: string }>;
  auditLog: Array<{ id: number; action: string; userName: string; createdAt: string }>;
};

function DeliveryOrderDetails({
  id, row, canSettle, canReturn, canCancel, canPrint, company, onChanged,
}: {
  id: number;
  row: OrderRow;
  me: AdminMe | null;
  canSettle: boolean;
  canReturn: boolean;
  canCancel: boolean;
  canPrint: boolean;
  company: string;
  logo: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"none" | "cod" | "return" | "cancel">("none");

  const { data, isLoading } = useQuery<DetailsResponse>({
    queryKey: ["admin", "delivery", "order", id],
    queryFn: () => adminFetch(`/admin/delivery/orders/${id}`),
  });

  function done(msg: string) {
    toast({ title: msg });
    setMode("none");
    qc.invalidateQueries({ queryKey: ["admin", "delivery", "order", id] });
    onChanged();
  }

  const settleCod = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/delivery/orders/${id}/settle-cod`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => done("تم تأكيد التحصيل وترحيله للصندوق"),
    onError: (e: any) => toast({ title: "تعذر تأكيد التحصيل", description: e?.message, variant: "destructive" }),
  });

  const returnOrder = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/delivery/orders/${id}/return`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => done("تم تحديد الطلب كمرتجع"),
    onError: (e: any) => toast({ title: "تعذر الإرجاع", description: e?.message, variant: "destructive" }),
  });

  const confirmCod = useMutation({
    mutationFn: () =>
      adminFetch(`/admin/delivery/orders/${id}/confirm-cod`, { method: "POST", body: "{}" }),
    onSuccess: () => done("تم اعتماد التحصيل وتحديث الفاتورة"),
    onError: (e: any) => toast({ title: "تعذر اعتماد التحصيل", description: e?.message, variant: "destructive" }),
  });

  const cancelOrder = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch(`/admin/delivery/orders/${id}/cancel`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => done("تم إلغاء طلب التوصيل"),
    onError: (e: any) => toast({ title: "تعذر الإلغاء", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="border-t border-border/20 p-4"><Skeleton className="h-32 rounded-lg" /></div>;

  const d = data.detail ?? {};
  const settled = Boolean(data.settlement);
  // A settlement recorded by a non-approver waits for a manager; the invoice is
  // untouched until then.
  const awaitingApproval = settled && data.settlement?.status === "pending_approval";
  const mapsHref =
    d.mapsUrl ||
    (d.fullAddress
      ? `https://www.google.com/maps/search/${encodeURIComponent([d.provinceName, d.city, d.fullAddress].filter(Boolean).join(" "))}`
      : null);

  return (
    <div className="border-t border-border/20 p-3 sm:p-4 space-y-4">
      {/* Summary grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5 text-sm">
          <h3 className="font-semibold text-foreground text-xs mb-1">العنوان والمستلم</h3>
          <KV label="المستلم" value={d.receiverName || "—"} />
          <KV label="الهاتف" value={d.receiverPhone ? formatIraqiPhone(d.receiverPhone) : "—"} />
          {d.receiverAltPhone && <KV label="هاتف بديل" value={formatIraqiPhone(d.receiverAltPhone)} />}
          <KV label="المحافظة" value={d.provinceName || "—"} />
          <KV label="القضاء / الناحية" value={[d.city, d.district, d.area].filter(Boolean).join(" — ") || "—"} />
          <KV label="العنوان" value={d.fullAddress || "—"} />
          {d.landmark && <KV label="نقطة دالة" value={d.landmark} />}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 mt-1">
              <MapPin className="w-3.5 h-3.5" /> فتح الخارطة <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <div className="space-y-1.5 text-sm">
          <h3 className="font-semibold text-foreground text-xs mb-1">الفاتورة والمبالغ</h3>
          <KV label="الفاتورة" value={data.invoiceNo ?? "—"} />
          <KV label="العميل" value={data.invoice?.customerName || "—"} />
          <KV label="إجمالي الفاتورة" value={formatCurrency(data.invoice?.total ?? 0)} />
          <KV label="المدفوع" value={formatCurrency(data.invoice?.paidAmount ?? 0)} />
          <KV label="المتبقي" value={formatCurrency(data.invoice?.remainingAmount ?? 0)} />
          <KV label="حالة الدفع" value={PAY_LABELS[data.invoice?.paymentStatus ?? ""] ?? data.invoice?.paymentStatus ?? "—"} />
          <KV label="أجور التوصيل" value={formatCurrency(d.deliveryFee ?? 0)} />
          <KV label="شركة التوصيل" value={d.deliveryCompany || "—"} />
          <KV label="نوع التوصيل" value={d.deliveryTypeLabel || "—"} />
          {d.expectedArrivalDate && <KV label="الوصول المتوقع" value={d.expectedArrivalDate} />}
          {d.codEnabled && (
            <KV label="مبلغ التحصيل المتوقع" value={formatCurrency(d.codAmount ?? 0)} />
          )}
        </div>
      </div>

      {/* Settlement state */}
      {settled && !awaitingApproval && (
        <div className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-xs text-status-success">
          تم التحصيل: {formatCurrency(data.settlement!.receivedAmount)} بتاريخ {data.settlement!.settlementDate}
          {data.settlement!.referenceNo ? ` · مرجع ${data.settlement!.referenceNo}` : ""} · بواسطة {data.settlement!.createdByName}
        </div>
      )}
      {awaitingApproval && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning space-y-2">
          <p className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            سُجّل تحصيل {formatCurrency(data.settlement!.receivedAmount)} بواسطة {data.settlement!.createdByName} —
            بانتظار اعتماد المدير. لم تتغير الفاتورة بعد.
          </p>
          {canSettle && (
            <Button size="sm" className="gap-1.5" disabled={confirmCod.isPending} onClick={() => {
              if (!window.confirm("سيتم اعتماد التحصيل وترحيله إلى الصندوق وتحديث الفاتورة. متابعة؟")) return;
              confirmCod.mutate();
            }}>
              {confirmCod.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
              اعتماد التحصيل
            </Button>
          )}
        </div>
      )}
      {data.returnReason && (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger">
          سبب الإرجاع: {data.returnReason}
        </div>
      )}
      {data.cancelReason && (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger">
          سبب الإلغاء: {data.cancelReason}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canPrint && (
          <Button size="sm" variant="outline" className="gap-1.5"
            onClick={() => {
              printDeliveryLabel({ delivery: { ...d, order: { deliveryNo: data.deliveryNo } }, invoiceNo: data.invoiceNo ?? "", company });
              adminFetch(`/admin/delivery/orders/${id}/label-printed`, { method: "POST", body: "{}" }).catch(() => {});
            }}>
            <Printer className="w-3.5 h-3.5" /> طباعة ملصق A6
          </Button>
        )}
        {data.salesInvoiceId && (
          <a href={`/admin/sales?invoice=${data.salesInvoiceId}`}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted">
            <FileText className="w-3.5 h-3.5" /> فتح الفاتورة
          </a>
        )}
        {data.customerId && (
          <a href={`/admin/customers?id=${data.customerId}`}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted">
            <User className="w-3.5 h-3.5" /> فتح العميل
          </a>
        )}
        {canSettle && d.codEnabled && !settled && (
          <Button size="sm" className="gap-1.5" onClick={() => setMode(mode === "cod" ? "none" : "cod")}>
            <Banknote className="w-3.5 h-3.5" /> تأكيد استلام مبلغ التحصيل
          </Button>
        )}
        {canReturn && !TERMINAL.includes(data.status) && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMode(mode === "return" ? "none" : "return")}>
            <RotateCcw className="w-3.5 h-3.5" /> تحديد كمرتجع
          </Button>
        )}
        {canCancel && !TERMINAL.includes(data.status) && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}>
            <XCircle className="w-3.5 h-3.5" /> إلغاء التوصيل
          </Button>
        )}
      </div>

      {mode === "cod" && (
        <CodSettlementForm
          expected={d.codAmount ?? row.codAmount ?? 0}
          remaining={data.invoice?.remainingAmount ?? 0}
          defaultCompany={d.deliveryCompany ?? ""}
          pending={settleCod.isPending}
          onSubmit={(payload) => settleCod.mutate(payload)}
          onCancel={() => setMode("none")}
        />
      )}
      {mode === "return" && (
        <ReasonForm
          title="سبب الإرجاع"
          confirmLabel="تأكيد الإرجاع"
          warning="سيتم إرجاع المخزون إلى المستودع ولن يُحتسب التحصيل."
          pending={returnOrder.isPending}
          withStock
          onSubmit={(reason, restoreStock) => returnOrder.mutate({ reason, restoreStock })}
          onCancel={() => setMode("none")}
        />
      )}
      {mode === "cancel" && (
        <ReasonForm
          title="سبب الإلغاء"
          confirmLabel="تأكيد الإلغاء"
          pending={cancelOrder.isPending}
          onSubmit={(reason) => cancelOrder.mutate({ reason })}
          onCancel={() => setMode("none")}
        />
      )}

      {/* Tracking history */}
      <div>
        <h3 className="font-semibold text-foreground text-xs mb-2">سجل التتبع</h3>
        {data.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا يوجد سجل</p>
        ) : (
          <ol className="space-y-1.5">
            {data.history.map((h, i) => (
              <li key={i} className="text-xs flex flex-wrap items-center gap-2">
                <StatusPill status={h.status} label={h.statusLabel} />
                <span className="text-muted-foreground">
                  {new Date(h.createdAt).toLocaleString("ar-IQ")} — {h.createdByName || "النظام"}
                </span>
                {h.reason && <span className="text-status-danger">({h.reason})</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Audit log */}
      {data.auditLog?.length > 0 && (
        <div>
          <h3 className="font-semibold text-foreground text-xs mb-2">سجل التدقيق</h3>
          <ul className="space-y-1">
            {data.auditLog.slice(0, 8).map((a) => (
              <li key={a.id} className="text-[11px] text-muted-foreground">
                {a.action} — {a.userName} — {new Date(a.createdAt).toLocaleString("ar-IQ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const PAY_LABELS: Record<string, string> = {
  paid: "مدفوعة", partial: "مدفوعة جزئياً", unpaid: "غير مدفوعة",
};

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground text-xs font-medium text-left">{value}</span>
    </div>
  );
}

function CodSettlementForm({
  expected, remaining, defaultCompany, pending, onSubmit, onCancel,
}: {
  expected: number;
  remaining: number;
  defaultCompany: string;
  pending: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(expected || remaining || 0));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const [account, setAccount] = useState("cash");
  const [companyName, setCompanyName] = useState(defaultCompany);
  const [notes, setNotes] = useState("");

  const value = Number(amount) || 0;
  const tooMuch = value > remaining + 0.01;

  function submit() {
    if (value <= 0 || tooMuch) return;
    if (!window.confirm(`سيتم ترحيل ${value.toLocaleString()} إلى الصندوق الرئيسي وتحديث الفاتورة. متابعة؟`)) return;
    onSubmit({
      receivedAmount: value,
      settlementDate: date,
      referenceNo: ref || null,
      account,
      deliveryCompany: companyName || null,
      notes: notes || null,
    });
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 sm:p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Banknote className="w-4 h-4 text-primary" /> تأكيد استلام مبلغ التحصيل
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FormField label="المبلغ المتوقع">
          <input value={formatCurrency(expected)} disabled className={FIELD} />
        </FormField>
        <FormField label="المبلغ المستلم فعلياً *" error={tooMuch ? `أكبر من المتبقي (${formatCurrency(remaining)})` : undefined}>
          <input type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`${FIELD} ${tooMuch ? "border-status-danger" : ""}`} dir="ltr" />
        </FormField>
        <FormField label="تاريخ التسوية">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </FormField>
        <FormField label="رقم المرجع">
          <input value={ref} onChange={(e) => setRef(e.target.value)} className={FIELD} dir="ltr" />
        </FormField>
        <FormField label="الصندوق / الحساب">
          <select value={account} onChange={(e) => setAccount(e.target.value)} className={FIELD}>
            <option value="cash">الصندوق النقدي</option>
            <option value="bank">حساب بنكي</option>
            <option value="transfer">تحويل</option>
            <option value="pos">بطاقة / POS</option>
          </select>
        </FormField>
        <FormField label="شركة التوصيل">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={FIELD} />
        </FormField>
      </div>
      <FormField label="ملاحظات">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD} />
      </FormField>
      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5" disabled={pending || value <= 0 || tooMuch} onClick={submit}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />} تأكيد التحصيل
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>إلغاء</Button>
      </div>
    </div>
  );
}

function ReasonForm({
  title, confirmLabel, warning, pending, withStock, onSubmit, onCancel,
}: {
  title: string;
  confirmLabel: string;
  warning?: string;
  pending: boolean;
  withStock?: boolean;
  onSubmit: (reason: string, restoreStock: boolean) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [restoreStock, setRestoreStock] = useState(true);
  return (
    <div className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 sm:p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-status-danger" /> {title}
      </p>
      {warning && <p className="text-xs text-muted-foreground">{warning}</p>}
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="اكتب السبب (٣ أحرف على الأقل)"
        className={FIELD}
      />
      {withStock && (
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={restoreStock} onChange={(e) => setRestoreStock(e.target.checked)} className="accent-primary" />
          <span className="text-foreground">إرجاع المخزون</span>
        </label>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending || reason.trim().length < 3}
          onClick={() => {
            if (!window.confirm("هل أنت متأكد؟ سيُسجَّل هذا الإجراء في سجل التدقيق.")) return;
            onSubmit(reason.trim(), restoreStock);
          }}
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {confirmLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>إلغاء</Button>
      </div>
    </div>
  );
}

const FIELD =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
      {error && <span className="block text-[11px] text-status-danger mt-1">{error}</span>}
    </label>
  );
}
