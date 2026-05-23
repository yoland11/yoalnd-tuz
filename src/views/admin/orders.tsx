import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { MessageCircle, Printer, Trash2, Plus, Search, X, History, Check, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ServiceDetailFields } from "@/components/service-detail-fields";
import { buildWhatsAppLink, getStagesFor, getStageLabel } from "@/lib/order-stages";
import {
  type CrewOption,
  defaultServiceDetails,
  primaryLocationFromDetails,
  serviceDetailsToRows,
  validateServiceDetails,
  withDerivedServiceDetails,
} from "@/lib/service-details";
import { formatIraqiPhone, formatIraqiPhoneInput, normalizeIraqiPhone } from "@/lib/phone";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type ServiceOrder = {
  id: number; trackingCode: string | null; serviceId: number; serviceName: string;
  serviceType: string | null; customerName: string; phone: string;
  eventDate: string | null; eventLocation: string | null; notes: string | null;
  customFields?: Record<string, any>;
  status: string; createdAt: string;
  customerConfirmation?: string | null;
  requestedDate?: string | null;
  confirmationNote?: string | null;
  confirmationAt?: string | null;
  preRescheduleStatus?: string | null;
};

type AdminService = {
  id: number;
  name: string;
  nameAr: string;
  type: string;
  isActive: boolean;
};

const PAYMENT_LABELS: Record<string, string> = {
  cod: "عند الاستلام",
  transfer: "حوالة",
  paid: "مدفوع",
};
const PAYMENT_COLORS: Record<string, string> = {
  cod: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  transfer: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  paid: "bg-green-500/10 text-green-400 border-green-500/30",
};

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "pending", label: "قيد الانتظار" },
  { value: "reschedule_pending", label: "طلب تغيير موعد" },
  { value: "confirmed", label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped", label: "في الطريق" },
  { value: "delivered", label: "تم التوصيل" },
  { value: "cancelled", label: "ملغي" },
];

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"products" | "services">("products");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingServiceOrder, setEditingServiceOrder] = useState<ServiceOrder | null>(null);

  const { data: productOrders, isLoading: loadingP } = useListOrders({});
  const { data: serviceOrders, isLoading: loadingS } = useQuery({
    queryKey: ["admin", "service-orders"],
    queryFn: () => adminFetch<ServiceOrder[]>("/admin/service-orders"),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["admin", "service-orders"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  }
  const updateProductStatus = useMutation({
    mutationFn: (vars: { id: number; status: string }) =>
      adminFetch(`/orders/${vars.id}`, { method: "PATCH", body: JSON.stringify({ status: vars.status }) }),
    onSuccess: invalidateAll,
  });
  const updatePayment = useMutation({
    mutationFn: (vars: { id: number; paymentMethod: string }) =>
      adminFetch(`/admin/orders/${vars.id}`, { method: "PATCH", body: JSON.stringify({ paymentMethod: vars.paymentMethod }) }),
    onSuccess: invalidateAll,
  });
  const updateServiceStatus = useMutation({
    mutationFn: (vars: { id: number; status: string }) =>
      adminFetch(`/admin/service-orders/${vars.id}`, { method: "PATCH", body: JSON.stringify({ status: vars.status }) }),
    onSuccess: invalidateAll,
  });
  const deleteProduct = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/orders/${id}`, { method: "DELETE" }),
    onSuccess: invalidateAll,
  });
  const deleteService = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/service-orders/${id}`, { method: "DELETE" }),
    onSuccess: invalidateAll,
  });
  const rescheduleAction = useMutation({
    mutationFn: (vars: { id: number; action: "accept" | "reject" }) =>
      adminFetch(`/admin/service-orders/${vars.id}/reschedule-action`, {
        method: "POST",
        body: JSON.stringify({ action: vars.action }),
      }),
    onSuccess: invalidateAll,
  });

  const filteredProducts = useMemo(() => {
    let rows = productOrders ?? [];
    if (statusFilter) rows = rows.filter(o => o.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(o =>
        o.trackingCode?.toLowerCase().includes(s) ||
        (o.customerName ?? "").toLowerCase().includes(s) ||
        (o.customerPhone ?? "").includes(s) ||
        formatIraqiPhone(o.customerPhone ?? "").includes(s)
      );
    }
    return rows;
  }, [productOrders, statusFilter, search]);

  const filteredServices = useMemo(() => {
    let rows = serviceOrders ?? [];
    if (statusFilter) rows = rows.filter(o => o.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(o =>
        o.trackingCode?.toLowerCase().includes(s) ||
        o.customerName.toLowerCase().includes(s) ||
        o.phone.includes(s) ||
        formatIraqiPhone(o.phone).includes(s)
      );
    }
    // Pin pending reschedule requests to the top so they don't get missed.
    return [...rows].sort((a, b) => {
      const ar = a.status === "reschedule_pending" ? 0 : 1;
      const br = b.status === "reschedule_pending" ? 0 : 1;
      return ar - br;
    });
  }, [serviceOrders, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">الطلبات والحجوزات</h1>
        <Button onClick={() => setShowCreate(true)} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> إضافة طلب
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setTab("products")}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === "products" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        >طلبات المتجر ({productOrders?.length ?? 0})</button>
        <button
          onClick={() => setTab("services")}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === "services" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        >حجوزات الخدمات ({serviceOrders?.length ?? 0})</button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث برقم تتبع، اسم، أو رقم..."
            className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
        >
          {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {tab === "products" ? (
        loadingP ? <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        : filteredProducts.length === 0 ? <EmptyState message="لا توجد طلبات" /> : (
          <div className="space-y-3">
            {filteredProducts.map(order => {
              const stages = getStagesFor(order.serviceType, "product");
              const phone = order.customerPhone ?? "";
              const trackUrl = `${window.location.origin}/track?code=${order.trackingCode}`;
              const waMsg = `مرحبا ${order.customerName}، رمز تتبع طلبك: ${order.trackingCode}\n${trackUrl}`;
              return (
                <div key={order.id} className="bg-card rounded-xl border border-border/30 p-4">
                  <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">{order.trackingCode}</p>
                      <p className="text-sm text-muted-foreground">{order.customerName} — {formatIraqiPhone(phone)}</p>
                      {order.governorate && <p className="text-xs text-muted-foreground">{order.governorate}{order.area ? ` • ${order.area}` : ""} {order.address ? `• ${order.address}` : ""}</p>}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`text-xs px-2 py-1 rounded-full border ${PAYMENT_COLORS[order.paymentMethod ?? "cod"] ?? PAYMENT_COLORS.cod}`}>
                        {PAYMENT_LABELS[order.paymentMethod ?? "cod"] ?? "عند الاستلام"}
                      </span>
                      <span className="text-primary font-bold">{formatCurrency(order.total)}</span>
                      <select
                        value={order.paymentMethod ?? "cod"}
                        onChange={e => updatePayment.mutate({ id: order.id, paymentMethod: e.target.value })}
                        className="bg-background border border-border/40 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary/50"
                        title="طريقة الدفع"
                      >
                        <option value="cod">عند الاستلام</option>
                        <option value="transfer">حوالة</option>
                        <option value="paid">مدفوع</option>
                      </select>
                      <select
                        value={order.status}
                        onChange={e => updateProductStatus.mutate({ id: order.id, status: e.target.value })}
                        className="bg-background border border-border/40 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary/50"
                      >
                        {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        <option value="cancelled">ملغي</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={buildWhatsAppLink(phone, waMsg)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600/10 text-green-400 border border-green-600/30 hover:bg-green-600/20">
                      <MessageCircle className="w-3.5 h-3.5" /> واتساب
                    </a>
                    <a href={`/admin/invoice/${order.id}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20">
                      <Printer className="w-3.5 h-3.5" /> فاتورة
                    </a>
                    <button
                      onClick={() => confirm("حذف الطلب نهائياً؟") && deleteProduct.mutate(order.id)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20">
                      <Trash2 className="w-3.5 h-3.5" /> حذف
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        loadingS ? <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        : filteredServices.length === 0 ? <EmptyState message="لا توجد حجوزات" /> : (
          <div className="space-y-3">
            {filteredServices.map(o => {
              const stages = getStagesFor(o.serviceType, "service");
              const trackUrl = `${window.location.origin}/track?code=${o.trackingCode}`;
              const waMsg = `مرحبا ${o.customerName}، رمز تتبع حجزك: ${o.trackingCode}\n${trackUrl}`;
              const isReschedulePending = o.status === "reschedule_pending";
              const detailRows = serviceDetailsToRows(o.serviceType, o.customFields);
              return (
                <div key={o.id} className={`bg-card rounded-xl border p-4 ${isReschedulePending ? "border-amber-500/50 ring-1 ring-amber-500/30" : "border-border/30"}`}>
                  {isReschedulePending && (
                    <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                      <p className="text-sm text-amber-200 font-semibold mb-1">
                        📅 الزبون طلب تغيير الموعد
                      </p>
                      <p className="text-xs text-amber-100/90">
                        من <span dir="ltr">{o.eventDate ?? "—"}</span> إلى <span dir="ltr">{o.requestedDate ?? "—"}</span>
                      </p>
                      {o.confirmationNote && (
                        <p className="text-xs text-amber-100/80 mt-1">ملاحظة الزبون: {o.confirmationNote}</p>
                      )}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button
                          onClick={() => rescheduleAction.mutate({ id: o.id, action: "accept" })}
                          disabled={rescheduleAction.isPending}
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600/20 text-green-300 border border-green-600/40 hover:bg-green-600/30 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> قبول الموعد الجديد
                        </button>
                        <button
                          onClick={() => rescheduleAction.mutate({ id: o.id, action: "reject" })}
                          disabled={rescheduleAction.isPending}
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> رفض الطلب
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">{o.trackingCode ?? "—"}</p>
                      <p className="text-sm text-muted-foreground">{o.customerName} — {formatIraqiPhone(o.phone)}</p>
                      <p className="text-xs text-primary">{o.serviceName}</p>
                      {o.eventDate && <p className="text-xs text-muted-foreground">📅 {o.eventDate} {o.eventLocation ? `• ${o.eventLocation}` : ""}</p>}
                      {!isReschedulePending && o.customerConfirmation === "confirmed" && (
                        <span className="inline-flex items-center gap-1 text-[11px] mt-1.5 px-2 py-0.5 rounded-full bg-green-600/10 text-green-300 border border-green-600/30">
                          ✓ الزبون أكد الموعد
                        </span>
                      )}
                    </div>
                    {isReschedulePending ? (
                      <span className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/40">
                        طلب تغيير موعد
                      </span>
                    ) : (
                      <select
                        value={o.status}
                        onChange={e => updateServiceStatus.mutate({ id: o.id, status: e.target.value })}
                        className="bg-background border border-border/40 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary/50"
                      >
                        {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        <option value="cancelled">ملغي</option>
                      </select>
                    )}
                  </div>
                  {detailRows.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 rounded-lg bg-background/40 border border-border/20 p-3">
                      {detailRows.map((row) => (
                        <div key={row.key}>
                          <p className="text-[11px] text-muted-foreground">{row.label}</p>
                          <p className="text-xs text-foreground break-words">{row.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={buildWhatsAppLink(o.phone, waMsg)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600/10 text-green-400 border border-green-600/30 hover:bg-green-600/20">
                      <MessageCircle className="w-3.5 h-3.5" /> واتساب
                    </a>
                    <a href={`/admin/invoice/${o.id}?type=booking`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20">
                      <Printer className="w-3.5 h-3.5" /> فاتورة الحجز
                    </a>
                    <button
                      onClick={() => setEditingServiceOrder(o)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20">
                      <Edit2 className="w-3.5 h-3.5" /> تعديل التفاصيل
                    </button>
                    <button
                      onClick={() => confirm("حذف الحجز؟") && deleteService.mutate(o.id)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20">
                      <Trash2 className="w-3.5 h-3.5" /> حذف
                    </button>
                  </div>
                  <BookingHistory bookingId={o.id} serviceType={o.serviceType} />
                </div>
              );
            })}
          </div>
        )
      )}

      {showCreate && <CreateOrderModal onClose={() => setShowCreate(false)} />}
      {editingServiceOrder && (
        <EditServiceOrderModal
          order={editingServiceOrder}
          onClose={() => setEditingServiceOrder(null)}
        />
      )}
    </div>
  );
}

type BookingHistoryEntry = { status: string; notes: string | null; createdAt: string };

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ar-IQ", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function BookingHistory({ bookingId, serviceType }: { bookingId: number; serviceType: string | null }) {
  const [open, setOpen] = useState(false);
  const stages = getStagesFor(serviceType, "service");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "service-orders", bookingId, "history"],
    queryFn: () => adminFetch<BookingHistoryEntry[]>(`/admin/service-orders/${bookingId}/history`),
    enabled: open,
  });

  return (
    <div className="mt-3 border-t border-border/30 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="w-3.5 h-3.5" />
        {open ? "إخفاء سجل الحالات" : "عرض سجل الحالات"}
      </button>
      {open && (
        <div className="mt-3">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">جاري التحميل...</p>
          ) : !data || data.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا يوجد سجل بعد</p>
          ) : (
            <ol className="space-y-2 border-r-2 border-border/40 pr-4">
              {data.map((h, idx) => (
                <li key={idx} className="relative">
                  <span className="absolute -right-[1.4rem] top-1 w-2.5 h-2.5 rounded-full bg-primary" />
                  <p className="text-sm text-foreground">
                    {h.status === "cancelled" ? "ملغي" : getStageLabel(stages, h.status)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatHistoryDate(h.createdAt)}</p>
                  {h.notes && <p className="text-xs text-muted-foreground/80 mt-0.5">{h.notes}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function CreateOrderModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"product" | "service">("product");
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", governorate: "", area: "", address: "", notes: "",
    mapsUrl: "", deliveryFee: "0", paymentMethod: "cod",
    items: [{ productName: "", productNameAr: "", quantity: 1, price: 0 }],
  });
  const [serviceForm, setServiceForm] = useState({
    serviceId: "",
    customerName: "",
    phone: "",
    eventDate: "",
    notes: "",
    customFields: {} as Record<string, any>,
  });
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});

  const { data: services = [] } = useQuery({
    queryKey: ["admin", "services"],
    queryFn: () => adminFetch<AdminService[]>("/admin/services"),
  });
  const { data: crews = [] } = useQuery({
    queryKey: ["crews"],
    queryFn: async () => {
      const res = await fetch("/api/crews");
      if (!res.ok) throw new Error("Failed to load crews");
      return res.json() as Promise<CrewOption[]>;
    },
  });
  const selectedService = services.find((svc) => svc.id === Number(serviceForm.serviceId));

  useEffect(() => {
    if (!serviceForm.serviceId && services.length > 0) {
      const first = services[0];
      setServiceForm((current) => ({
        ...current,
        serviceId: String(first.id),
        customFields: defaultServiceDetails(first.type),
      }));
    }
  }, [serviceForm.serviceId, services]);

  const createProductOrder = useMutation({
    mutationFn: (body: any) => adminFetch("/admin/orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      onClose();
    },
  });
  const createServiceOrder = useMutation({
    mutationFn: (body: any) => adminFetch("/admin/service-orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "service-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      onClose();
    },
  });

  function updateItem(i: number, key: string, value: any) {
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it) }));
  }

  function submitProduct() {
    const customerPhone = normalizeIraqiPhone(form.customerPhone);
    if (!customerPhone) {
      alert("أدخل رقم عراقي صحيح مثل 07700000000");
      return;
    }
    createProductOrder.mutate({
      ...form,
      customerPhone,
      deliveryFee: parseFloat(form.deliveryFee) || 0,
      items: form.items.filter(it => it.productName && it.quantity > 0),
    });
  }

  function submitService() {
    const phone = normalizeIraqiPhone(serviceForm.phone);
    if (!phone) {
      alert("أدخل رقم عراقي صحيح مثل 07700000000");
      return;
    }
    const details = withDerivedServiceDetails(selectedService?.type, serviceForm.customFields);
    const errors = validateServiceDetails(selectedService?.type, details);
    setServiceErrors(errors);
    if (Object.keys(errors).length > 0) return;
    createServiceOrder.mutate({
      serviceId: Number(serviceForm.serviceId),
      customerName: serviceForm.customerName,
      phone,
      eventDate: serviceForm.eventDate,
      eventLocation: primaryLocationFromDetails(selectedService?.type, details),
      notes: serviceForm.notes,
      customFields: details,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border/30">
          <h3 className="font-bold text-foreground">طلب جديد</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          mode === "product" ? submitProduct() : submitService();
        }} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 bg-background/60 border border-border/30 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setMode("product")}
              className={`py-2 rounded-lg text-sm transition-colors ${mode === "product" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              طلب متجر
            </button>
            <button
              type="button"
              onClick={() => setMode("service")}
              className={`py-2 rounded-lg text-sm transition-colors ${mode === "service" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              حجز خدمة
            </button>
          </div>

          {mode === "product" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="اسم الزبون *" value={form.customerName} onChange={v => setForm(f => ({ ...f, customerName: v }))} required />
                <Input label="رقم الهاتف *" value={form.customerPhone} onChange={v => setForm(f => ({ ...f, customerPhone: formatIraqiPhoneInput(v) }))} required />
                <Input label="المحافظة" value={form.governorate} onChange={v => setForm(f => ({ ...f, governorate: v }))} />
                <Input label="المنطقة" value={form.area} onChange={v => setForm(f => ({ ...f, area: v }))} />
                <Input label="العنوان" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} />
                <Input label="رابط الخارطة" value={form.mapsUrl} onChange={v => setForm(f => ({ ...f, mapsUrl: v }))} />
                <Input label="رسوم التوصيل" type="number" value={form.deliveryFee} onChange={v => setForm(f => ({ ...f, deliveryFee: v }))} />
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">طريقة الدفع</label>
                  <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
                    className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
                    <option value="cod">عند الاستلام</option>
                    <option value="transfer">حوالة</option>
                    <option value="paid">مدفوع</option>
                  </select>
                </div>
              </div>
              <Input label="ملاحظات" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-foreground">المنتجات</label>
                  <button type="button" onClick={() => setForm(f => ({ ...f, items: [...f.items, { productName: "", productNameAr: "", quantity: 1, price: 0 }] }))}
                    className="text-xs text-primary hover:underline">+ إضافة</button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <input placeholder="اسم المنتج" value={it.productNameAr} onChange={e => { updateItem(i, "productNameAr", e.target.value); updateItem(i, "productName", e.target.value); }}
                        className="col-span-6 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
                      <input type="number" placeholder="الكمية" value={it.quantity} min={1} onChange={e => updateItem(i, "quantity", parseInt(e.target.value) || 1)}
                        className="col-span-2 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
                      <input type="number" placeholder="السعر" value={it.price} onChange={e => updateItem(i, "price", parseFloat(e.target.value) || 0)}
                        className="col-span-3 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
                      <button type="button" onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }))}
                        className="col-span-1 text-red-400 hover:bg-red-500/10 rounded-lg"><X className="w-4 h-4 mx-auto" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">نوع الخدمة *</label>
                  <select
                    value={serviceForm.serviceId}
                    onChange={(e) => {
                      const serviceId = e.target.value;
                      const svc = services.find((item) => item.id === Number(serviceId));
                      setServiceForm((current) => ({
                        ...current,
                        serviceId,
                        customFields: defaultServiceDetails(svc?.type),
                      }));
                      setServiceErrors({});
                    }}
                    className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    required
                  >
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>{svc.nameAr || svc.name}</option>
                    ))}
                  </select>
                </div>
                <Input label="اسم الزبون *" value={serviceForm.customerName} onChange={v => setServiceForm(f => ({ ...f, customerName: v }))} required />
                <Input label="رقم الهاتف *" value={serviceForm.phone} onChange={v => setServiceForm(f => ({ ...f, phone: formatIraqiPhoneInput(v) }))} required />
                <Input label="تاريخ الحجز *" type="date" value={serviceForm.eventDate} onChange={v => setServiceForm(f => ({ ...f, eventDate: v }))} required />
              </div>
              <ServiceDetailFields
                serviceType={selectedService?.type}
                value={serviceForm.customFields}
                onChange={(customFields) => {
                  setServiceForm((current) => ({ ...current, customFields }));
                  setServiceErrors({});
                }}
                crews={crews}
                errors={serviceErrors}
              />
              <Input label="ملاحظات" value={serviceForm.notes} onChange={v => setServiceForm(f => ({ ...f, notes: v }))} />
            </>
          )}

          <Button type="submit" disabled={createProductOrder.isPending || createServiceOrder.isPending || (mode === "service" && !selectedService)} className="w-full">
            {createProductOrder.isPending || createServiceOrder.isPending ? "جاري الحفظ..." : "حفظ الطلب"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function EditServiceOrderModal({ order, onClose }: { order: ServiceOrder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    customerName: order.customerName,
    phone: formatIraqiPhone(order.phone),
    eventDate: order.eventDate ?? "",
    notes: order.notes ?? "",
    customFields: {
      ...defaultServiceDetails(order.serviceType),
      ...(order.customFields ?? {}),
    } as Record<string, any>,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: crews = [] } = useQuery({
    queryKey: ["crews"],
    queryFn: async () => {
      const res = await fetch("/api/crews");
      if (!res.ok) throw new Error("Failed to load crews");
      return res.json() as Promise<CrewOption[]>;
    },
  });

  const save = useMutation({
    mutationFn: (body: any) =>
      adminFetch(`/admin/service-orders/${order.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "service-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      onClose();
    },
  });

  function submit() {
    const phone = normalizeIraqiPhone(form.phone);
    if (!phone) {
      alert("أدخل رقم عراقي صحيح مثل 07700000000");
      return;
    }
    const details = withDerivedServiceDetails(order.serviceType, form.customFields);
    const nextErrors = validateServiceDetails(order.serviceType, details);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    save.mutate({
      customerName: form.customerName,
      phone,
      eventDate: form.eventDate,
      eventLocation: primaryLocationFromDetails(order.serviceType, details),
      notes: form.notes,
      customFields: details,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border/30">
          <div>
            <h3 className="font-bold text-foreground">تعديل الحجز</h3>
            <p className="text-xs text-muted-foreground mt-1">{order.serviceName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="اسم الزبون *" value={form.customerName} onChange={v => setForm(f => ({ ...f, customerName: v }))} required />
            <Input label="رقم الهاتف *" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: formatIraqiPhoneInput(v) }))} required />
            <Input label="تاريخ الحجز *" type="date" value={form.eventDate} onChange={v => setForm(f => ({ ...f, eventDate: v }))} required />
          </div>
          <ServiceDetailFields
            serviceType={order.serviceType}
            value={form.customFields}
            onChange={(customFields) => {
              setForm((current) => ({ ...current, customFields }));
              setErrors({});
            }}
            crews={crews}
            errors={errors}
          />
          <Input label="ملاحظات" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />
          <Button type="submit" disabled={save.isPending} className="w-full">
            {save.isPending ? "جاري الحفظ..." : "حفظ التعديل"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
    </div>
  );
}
