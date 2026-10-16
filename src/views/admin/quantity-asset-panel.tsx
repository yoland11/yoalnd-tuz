import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CalendarDays,
  ClipboardCheck,
  History,
  Loader2,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  QrCode,
  SearchX,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  QUANTITY_ADJUSTMENT_LABELS,
  TOTAL_CHANGING_ADJUSTMENTS,
  quantityMovementLabel,
  type QuantityAdjustmentKind,
} from "@/lib/quantity-assets";
import { adminFetch, apiErrorMessage, fetchAdminMe, formatCurrency, hasPerm } from "./_lib";

export type QuantityBookingLine = {
  source: string;
  bookingId: number;
  day: string | null;
  status: string;
  customerName: string | null;
  required: number;
  reserved: number;
  prepared: number;
  checkedOut: number;
  outstanding: number;
  returnedGood: number;
  damaged: number;
  missing: number;
  returned: number;
  stage: string;
};

export type QuantitySummary = {
  productId: number;
  trackingMode: "quantity";
  unit: string;
  total: number;
  inWarehouse: number;
  checkedOut: number;
  damaged: number;
  maintenance: number;
  missing: number;
  reserved: number;
  available: number;
  availabilityDay: string;
  committedOnDay: number;
  peakCommitment: number;
  unitCost: number;
  totalValue: number;
  lowAvailability: boolean;
  reconciliation: { outstandingInBookings: number; matches: boolean };
  bookings: QuantityBookingLine[];
};

type Movement = {
  id: number;
  quantityChange: number;
  reason: string;
  relatedType: string | null;
  relatedId: number | null;
  metadata: Record<string, any>;
  actorName: string;
  createdAt: string;
};

const STAGE_LABELS: Record<string, string> = {
  linked: "مرتبط",
  reserved: "محجوز",
  picked: "مُجهّز",
  out: "خارج",
  returned: "مُرتجع",
  completed: "مكتمل",
};

const MOVEMENT_LABELS: Record<string, string> = {
  product_initial_stock: "رصيد افتتاحي",
  purchase_invoice_stock_increased: "استلام من فاتورة شراء",
  purchase_invoice_edit_reversal: "عكس فاتورة شراء",
  warehouse_transfer_executed: "تحويل بين المستودعات",
  manual_stock_adjustment: "تعديل يدوي سابق",
};
const movementLabel = (reason: string) => quantityMovementLabel(reason) ?? MOVEMENT_LABELS[reason] ?? reason;

const numberText = (value: number) => Number(value ?? 0).toLocaleString("ar-IQ-u-nu-latn");
const dateText = (value: string | null) =>
  value ? new Date(value).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }) : "—";

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function bookingHref(line: Pick<QuantityBookingLine, "source" | "bookingId">) {
  return `/admin/bookings/${line.source === "service_order" ? "service" : "kosha"}/${line.bookingId}`;
}

function QuantityCard({ label, value, unit, tone = "default", hint }: { label: string; value: number; unit: string; tone?: "default" | "good" | "warn" | "bad" | "info"; hint?: string }) {
  const toneClass = {
    default: "border-border/40 bg-background/60 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    warn: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    bad: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
    info: "border-primary/30 bg-primary/5 text-primary",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">
        {numberText(value)} <span className="text-xs font-medium text-muted-foreground">{unit}</span>
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const ADJUSTMENT_ICONS: Partial<Record<QuantityAdjustmentKind, any>> = {
  add: PackagePlus,
  reduce: PackageMinus,
  count: ClipboardCheck,
  damage: AlertTriangle,
  loss: SearchX,
  send_maintenance: Wrench,
  repaired: PackageCheck,
  found: PackageCheck,
  write_off: PackageMinus,
};

export function QuantityAssetPanel({ productId }: { productId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [day, setDay] = useState("");
  const [showMovements, setShowMovements] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: QuantityAdjustmentKind; requestId: string }>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [form, setForm] = useState({ quantity: "", countedQuantity: "", unitCost: "", writeOffFrom: "damaged", reason: "", relatedType: "", relatedId: "" });
  const [transfer, setTransfer] = useState({ fromWarehouseId: "", toWarehouseId: "", quantity: "", notes: "" });

  const summaryKey = ["admin", "asset-quantity", productId, day] as const;
  const summary = useQuery<QuantitySummary>({
    queryKey: summaryKey,
    queryFn: () => adminFetch(`/admin/assets/quantity/${productId}${day ? `?day=${encodeURIComponent(day)}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const movements = useQuery<{ data: Movement[] }>({
    queryKey: ["admin", "asset-quantity-movements", productId],
    queryFn: () => adminFetch(`/admin/assets/quantity/${productId}/movements`),
    enabled: showMovements,
  });
  const warehouses = useQuery<{ warehouses: Array<{ id: number; name: string }> }>({
    queryKey: ["admin", "warehouses-list"],
    queryFn: () => adminFetch("/admin/warehouse-transfers"),
    enabled: transferOpen,
    staleTime: 5 * 60 * 1000,
  });
  const me = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchAdminMe(), staleTime: 60_000 });
  const manager = ["admin", "manager", "main_admin", "super_admin", "main_manager"].includes(String(me.data?.role ?? "").toLowerCase());
  const allowed = (kind: QuantityAdjustmentKind) => {
    if (TOTAL_CHANGING_ADJUSTMENTS.includes(kind)) return manager;
    if (["loss", "found"].includes(kind)) return manager || hasPerm(me.data ?? null, "asset_damage_approve");
    return manager || hasPerm(me.data ?? null, "asset_damage_record");
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-quantity", productId] });
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-quantity-movements", productId] });
    queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-edit", productId] });
  };

  const adjust = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch<{ ok: boolean; replayed?: boolean; label?: string; totalBefore?: number; totalAfter?: number; warning?: string | null }>(
        `/admin/assets/quantity/${productId}/adjust`,
        { method: "POST", body: JSON.stringify(payload) },
      ),
    onSuccess: (result) => {
      setDialog(null);
      refresh();
      toast({
        title: result.replayed ? "تم تنفيذ هذا التعديل مسبقاً" : `${result.label ?? "تم التعديل"}`,
        description: result.replayed
          ? "لم تُسجّل حركة مكررة."
          : `قبل ${numberText(result.totalBefore ?? 0)} ← بعد ${numberText(result.totalAfter ?? 0)}${result.warning ? ` · ${result.warning}` : ""}`,
        variant: result.warning ? "destructive" : undefined,
      });
    },
    onError: (error) => toast({ title: "تعذّر تعديل الكمية", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const requestTransfer = useMutation({
    mutationFn: () =>
      adminFetch("/admin/warehouse-transfers", {
        method: "POST",
        body: JSON.stringify({
          productId,
          fromWarehouseId: Number(transfer.fromWarehouseId) || null,
          toWarehouseId: Number(transfer.toWarehouseId) || null,
          quantity: Number(transfer.quantity) || 1,
          notes: transfer.notes.trim() || null,
        }),
      }),
    onSuccess: () => {
      setTransferOpen(false);
      toast({ title: "تم إرسال طلب التحويل للاعتماد", description: "يُنفّذ التحويل بعد اعتماد المدير من صفحة التحويلات المخزنية." });
    },
    onError: (error) => toast({ title: "تعذّر إنشاء طلب التحويل", description: apiErrorMessage(error), variant: "destructive" }),
  });

  function openAdjustment(kind: QuantityAdjustmentKind) {
    setForm({
      quantity: "",
      countedQuantity: kind === "count" ? String(summary.data?.inWarehouse ?? "") : "",
      unitCost: kind === "add" ? String(summary.data?.unitCost ?? "") : "",
      writeOffFrom: "damaged",
      reason: "",
      relatedType: "",
      relatedId: "",
    });
    setDialog({ kind, requestId: newRequestId() });
  }

  function submitAdjustment() {
    if (!dialog) return;
    if (form.reason.trim().length < 3) {
      toast({ title: "اكتب سبب التعديل", variant: "destructive" });
      return;
    }
    adjust.mutate({
      kind: dialog.kind,
      quantity: dialog.kind === "count" ? 0 : Number(form.quantity) || 0,
      countedQuantity: dialog.kind === "count" ? Number(form.countedQuantity) : null,
      unitCost: dialog.kind === "add" && form.unitCost !== "" ? Number(form.unitCost) : null,
      writeOffFrom: dialog.kind === "write_off" ? form.writeOffFrom : undefined,
      reason: form.reason.trim(),
      relatedType: form.relatedType || null,
      relatedId: form.relatedType && Number(form.relatedId) > 0 ? Number(form.relatedId) : null,
      requestId: dialog.requestId,
    });
  }

  const data = summary.data;
  const unit = data?.unit ?? "قطعة";
  const activeBookings = useMemo(
    () => (data?.bookings ?? []).filter((line) => line.outstanding > 0 || !["returned", "completed"].includes(line.stage)),
    [data?.bookings],
  );

  if (summary.isLoading) {
    return (
      <section className="rounded-xl border border-border/30 bg-card p-4" id="quantities">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الكميات…</div>
      </section>
    );
  }
  if (summary.isError || !data) {
    return (
      <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600" id="quantities" role="alert">
        تعذّر تحميل إدارة الكميات: {apiErrorMessage(summary.error, "حاول مرة أخرى")}
      </section>
    );
  }

  const preview = (() => {
    if (!dialog) return null;
    const amount = Number(form.quantity) || 0;
    switch (dialog.kind) {
      case "add": return data.total + amount;
      case "reduce": return data.total - amount;
      case "count": return data.total - data.inWarehouse + (Number(form.countedQuantity) || 0);
      case "write_off": return data.total - amount;
      default: return data.total;
    }
  })();

  return (
    <section className="space-y-4 rounded-xl border border-primary/25 bg-card p-4" id="quantities" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground"><Boxes className="h-5 w-5 text-primary" /> إدارة الكميات</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            أصل واحد متعدد الكمية · الوحدة: {unit} · تكلفة القطعة {formatCurrency(data.unitCost)} · القيمة الإجمالية {formatCurrency(data.totalValue)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-1" disabled={!allowed("add")} title={allowed("add") ? undefined : "متاح للمدير فقط"} onClick={() => openAdjustment("add")}><PackagePlus className="h-4 w-4" /> إضافة كمية</Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={!allowed("count")} title={allowed("count") ? undefined : "متاح للمدير فقط"} onClick={() => openAdjustment("count")}><ClipboardCheck className="h-4 w-4" /> تعديل جرد</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowMovements((open) => !open)}><History className="h-4 w-4" /> {showMovements ? "إخفاء الحركات" : "عرض حركات الكمية"}</Button>
          <Button size="sm" variant="outline" className="gap-1" asChild><Link href={`/admin/print-labels?productId=${productId}&kind=asset`}><QrCode className="h-4 w-4" /> طباعة QR</Link></Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => document.getElementById("quantity-bookings")?.scrollIntoView({ behavior: "smooth", block: "start" })}><CalendarDays className="h-4 w-4" /> الحجوزات المرتبطة</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        <QuantityCard label="إجمالي الكمية" value={data.total} unit={unit} tone="info" />
        <QuantityCard label="المتوفر" value={data.available} unit={unit} tone={data.lowAvailability ? "warn" : "good"} hint={`للحجز بتاريخ ${data.availabilityDay}`} />
        <QuantityCard label="المحجوز" value={data.reserved} unit={unit} hint="حجوزات قادمة لم تخرج" />
        <QuantityCard label="الخارج" value={data.checkedOut} unit={unit} tone={data.checkedOut ? "warn" : "default"} />
        <QuantityCard label="التالف" value={data.damaged} unit={unit} tone={data.damaged ? "bad" : "default"} />
        <QuantityCard label="الصيانة" value={data.maintenance} unit={unit} tone={data.maintenance ? "warn" : "default"} />
        <QuantityCard label="المفقود" value={data.missing} unit={unit} tone={data.missing ? "bad" : "default"} />
      </div>
      <p className="text-xs text-muted-foreground">
        الحالات الفعلية متنافية وتساوي الإجمالي: في المستودع {numberText(data.inWarehouse)} + خارج {numberText(data.checkedOut)} + تالف {numberText(data.damaged)} + صيانة {numberText(data.maintenance)} + مفقود {numberText(data.missing)} = {numberText(data.total)} {unit}.
        الحجز التزام بالموعد ولا يُضاف للإجمالي.
      </p>
      {!data.reconciliation.matches ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          الكمية الخارجة المسجلة ({numberText(data.checkedOut)}) لا تطابق مجموع الحجوزات ({numberText(data.reconciliation.outstandingInBookings)}). راجع حركات الأصل قبل أي تعديل.
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/30 bg-background/50 p-3">
        <label className="text-xs text-muted-foreground">
          فحص التوفر بتاريخ
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className="mt-1 block rounded-lg border border-border/40 bg-background px-3 py-1.5 text-sm text-foreground" />
        </label>
        <p className="text-sm">
          المتاح {day ? `يوم ${day}` : "اليوم"}: <b className="text-primary">{numberText(data.available)} {unit}</b>
          <span className="mr-2 text-xs text-muted-foreground">(المحجوز والخارج في هذا اليوم: {numberText(data.committedOnDay)})</span>
        </p>
        {summary.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border/30 pt-3">
        {(["damage", "loss", "send_maintenance", "repaired", "found", "reduce", "write_off"] as QuantityAdjustmentKind[]).map((kind) => {
          const Icon = ADJUSTMENT_ICONS[kind] ?? Boxes;
          return (
            <Button key={kind} size="sm" variant="ghost" className="gap-1 border border-border/40" disabled={!allowed(kind)} title={allowed(kind) ? undefined : "ليس لديك صلاحية هذا الإجراء"} onClick={() => openAdjustment(kind)}>
              <Icon className="h-3.5 w-3.5" /> {QUANTITY_ADJUSTMENT_LABELS[kind]}
            </Button>
          );
        })}
        <Button size="sm" variant="ghost" className="gap-1 border border-border/40" onClick={() => { setTransfer({ fromWarehouseId: "", toWarehouseId: "", quantity: "", notes: "" }); setTransferOpen(true); }}>
          <ArrowLeftRight className="h-3.5 w-3.5" /> تحويل بين المستودعات
        </Button>
      </div>

      <div id="quantity-bookings" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">الحجوزات المرتبطة <span className="text-xs font-normal text-muted-foreground">({numberText(activeBookings.length)} نشط من {numberText(data.bookings.length)})</span></h3>
        {data.bookings.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد حجوزات مرتبطة بهذا الأصل.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-background/60 text-muted-foreground">
                <tr>
                  {["الحجز", "التاريخ", "المطلوب", "المحجوز", "المجهّز", "الخارج", "المرتجع السليم", "التالف", "المفقود", "الحالة"].map((label) => <th key={label} className="p-2 text-right font-medium">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.bookings.map((line) => (
                  <tr key={`${line.source}-${line.bookingId}`}>
                    <td className="p-2"><Link href={bookingHref(line)} className="font-medium text-primary hover:underline">#{line.bookingId}</Link><div className="text-muted-foreground">{line.customerName ?? "—"}</div></td>
                    <td className="p-2 whitespace-nowrap">{line.day ?? "—"}</td>
                    <td className="p-2 tabular-nums">{numberText(line.required)}</td>
                    <td className="p-2 tabular-nums">{numberText(line.reserved)}</td>
                    <td className="p-2 tabular-nums">{numberText(line.prepared)}</td>
                    <td className="p-2 tabular-nums">{numberText(line.outstanding)} <span className="text-muted-foreground">من {numberText(line.checkedOut)}</span></td>
                    <td className="p-2 tabular-nums">{numberText(line.returnedGood)}</td>
                    <td className="p-2 tabular-nums text-red-600">{line.damaged ? numberText(line.damaged) : "—"}</td>
                    <td className="p-2 tabular-nums text-red-600">{line.missing ? numberText(line.missing) : "—"}</td>
                    <td className="p-2">{STAGE_LABELS[line.stage] ?? line.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showMovements ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">حركات الكمية</h3>
          {movements.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : movements.isError ? (
            <p className="text-xs text-red-600" role="alert">تعذّر تحميل الحركات: {apiErrorMessage(movements.error)}</p>
          ) : !movements.data?.data.length ? <p className="text-xs text-muted-foreground">لا توجد حركات.</p> : (
            <ul className="divide-y divide-border/20 rounded-lg border border-border/30">
              {movements.data.data.map((movement) => {
                const meta = movement.metadata ?? {};
                const totals = meta.totalBefore != null ? `${numberText(meta.totalBefore)} ← ${numberText(meta.totalAfter)}` : null;
                return (
                  <li key={movement.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{movementLabel(movement.reason)}{movement.relatedType && movement.relatedType !== "asset" ? <span className="mr-1 text-muted-foreground">· {movement.relatedType} #{movement.relatedId}</span> : null}</p>
                      <p className="text-muted-foreground">{[meta.reason, meta.note, meta.description, meta.vehicle ? `مركبة: ${meta.vehicle}` : null, meta.good != null ? `سليم ${meta.good} · تالف ${meta.damaged ?? 0} · مفقود ${meta.missing ?? 0}` : null].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <div className="text-left">
                      <p className={`font-bold tabular-nums ${movement.quantityChange > 0 ? "text-emerald-600" : movement.quantityChange < 0 ? "text-red-600" : "text-muted-foreground"}`} dir="ltr">{movement.quantityChange > 0 ? "+" : ""}{numberText(movement.quantityChange)}</p>
                      {totals ? <p className="text-muted-foreground">الإجمالي {totals}</p> : null}
                      <p className="text-muted-foreground">{movement.actorName || "النظام"} · {dateText(movement.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog ? QUANTITY_ADJUSTMENT_LABELS[dialog.kind] : ""}</DialogTitle>
            <DialogDescription>
              تُسجّل الكمية قبل التعديل والتغيير وبعده مع السبب والموظف والوقت، ولا يُحذف أي سجل سابق.
            </DialogDescription>
          </DialogHeader>
          {dialog ? (
            <div className="space-y-3 text-sm">
              {dialog.kind === "count" ? (
                <label className="block">الكمية المعدودة فعلياً في المستودع ({unit})
                  <input type="number" min={0} inputMode="numeric" value={form.countedQuantity} onChange={(event) => setForm({ ...form, countedQuantity: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2" />
                  <span className="text-xs text-muted-foreground">الرصيد المسجل حالياً: {numberText(data.inWarehouse)} {unit}</span>
                </label>
              ) : (
                <label className="block">الكمية ({unit})
                  <input type="number" min={1} inputMode="numeric" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2" />
                </label>
              )}
              {dialog.kind === "add" ? (
                <label className="block">تكلفة القطعة
                  <input type="number" min={0} value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2" />
                  <span className="text-xs text-muted-foreground">تُضاف قيمة القطع الجديدة إلى تكلفة الاقتناء والقيمة الدفترية. الكميات المستلمة من فاتورة شراء معتمدة تُضاف تلقائياً ولا تُسجّل هنا مرة ثانية.</span>
                </label>
              ) : null}
              {dialog.kind === "write_off" ? (
                <label className="block">الشطب من
                  <select value={form.writeOffFrom} onChange={(event) => setForm({ ...form, writeOffFrom: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2">
                    <option value="damaged">التالف ({numberText(data.damaged)})</option>
                    <option value="missing">المفقود ({numberText(data.missing)})</option>
                    <option value="maintenance">الصيانة ({numberText(data.maintenance)})</option>
                  </select>
                </label>
              ) : null}
              <label className="block">السبب *
                <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2" placeholder="مثال: جرد نهاية الشهر" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs">مستند مرتبط
                  <select value={form.relatedType} onChange={(event) => setForm({ ...form, relatedType: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-2 py-2 text-sm">
                    <option value="">بدون</option>
                    <option value="purchase_invoice">فاتورة شراء</option>
                    <option value="kosha_booking">حجز كوشة</option>
                    <option value="service_order">طلب خدمة</option>
                    <option value="booking_penalty">غرامة / تلف</option>
                  </select>
                </label>
                <label className="block text-xs">رقم المستند
                  <input type="number" min={1} disabled={!form.relatedType} value={form.relatedId} onChange={(event) => setForm({ ...form, relatedId: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-2 py-2 text-sm" />
                </label>
              </div>
              <p className="rounded-lg bg-background/60 p-2 text-xs text-muted-foreground">
                الإجمالي الحالي {numberText(data.total)} {unit}{preview !== null && preview !== data.total ? ` ← بعد التعديل ${numberText(preview)} ${unit}` : ""}. الالتزامات القادمة: {numberText(data.peakCommitment)} {unit}.
              </p>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
            <Button onClick={submitAdjustment} disabled={adjust.isPending} className="gap-1">
              {adjust.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تحويل بين المستودعات</DialogTitle>
            <DialogDescription>يستخدم نظام التحويلات المخزنية الحالي؛ يُنفّذ بعد اعتماد المدير ولا يغيّر الإجمالي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">من مستودع
                <select value={transfer.fromWarehouseId} onChange={(event) => setTransfer({ ...transfer, fromWarehouseId: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-2 py-2">
                  <option value="">اختر</option>
                  {(warehouses.data?.warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
              <label className="block">إلى مستودع
                <select value={transfer.toWarehouseId} onChange={(event) => setTransfer({ ...transfer, toWarehouseId: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-2 py-2">
                  <option value="">اختر</option>
                  {(warehouses.data?.warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
            </div>
            <label className="block">الكمية ({unit})
              <input type="number" min={1} max={data.inWarehouse} value={transfer.quantity} onChange={(event) => setTransfer({ ...transfer, quantity: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2" />
            </label>
            <label className="block">ملاحظات
              <input value={transfer.notes} onChange={(event) => setTransfer({ ...transfer, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2" />
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>إلغاء</Button>
            <Button
              disabled={requestTransfer.isPending || !transfer.fromWarehouseId || !transfer.toWarehouseId || transfer.fromWarehouseId === transfer.toWarehouseId || !(Number(transfer.quantity) > 0) || Number(transfer.quantity) > data.inWarehouse}
              onClick={() => requestTransfer.mutate()}
            >
              إرسال للاعتماد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
