import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  History,
  Info,
  Loader2,
  MinusCircle,
  PackageCheck,
  PackageX,
  PlusCircle,
  QrCode,
  Scale,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskPhotoPicker, type TaskPhoto } from "@/components/task-photo-gallery";
import { useToast } from "@/hooks/use-toast";
import { TOTAL_CHANGING_ADJUSTMENTS, quantityMovementLabel, type QuantityAdjustmentKind } from "@/lib/quantity-assets";
import { adminFetch, apiErrorMessage, fetchAdminMe, formatCurrency, hasPerm } from "./_lib";
import type { QuantitySummary } from "./quantity-asset-panel";
import { DateField } from "@/components/ui/date-field";

type StaffOption = { id: number; fullName?: string | null; username?: string | null };
type Movement = {
  id: number;
  quantityChange: number;
  reason: string;
  relatedType: string | null;
  relatedId: number | null;
  warehouseName: string | null;
  metadata: Record<string, any>;
  actorName: string;
  createdAt: string;
};
type MovementPage = { data: Movement[]; total: number; page: number; totalPages: number };

const ACTIONS: Record<QuantityAdjustmentKind, { label: string; title: string; icon: typeof PlusCircle; tone: string; hint: string }> = {
  add: { label: "إضافة كمية", title: "إضافة كمية إلى الأصل", icon: PlusCircle, tone: "text-emerald-600 dark:text-emerald-400", hint: "تسجيل حركة إضافة كمية جديدة إلى الأصل." },
  reduce: { label: "تخفيض كمية", title: "تخفيض كمية الأصل", icon: MinusCircle, tone: "text-red-600 dark:text-red-400", hint: "إخراج قطع من الإجمالي نهائياً، مع سبب مسجل." },
  count: { label: "تسوية جرد", title: "تسوية جرد", icon: Scale, tone: "text-sky-600 dark:text-sky-400", hint: "مطابقة الرصيد المسجل مع العدد الفعلي في المستودع." },
  damage: { label: "تسجيل تلف", title: "تسجيل تلف", icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", hint: "نقل قطع من المستودع إلى التالف؛ لا تُحجز بعد ذلك." },
  loss: { label: "تسجيل فقدان", title: "تسجيل فقدان", icon: PackageX, tone: "text-red-600 dark:text-red-400", hint: "نقل قطع من المستودع إلى المفقود؛ لا تُحجز بعد ذلك." },
  send_maintenance: { label: "إرسال التالف للصيانة", title: "إرسال التالف للصيانة", icon: Wrench, tone: "text-muted-foreground", hint: "نقل قطع من التالف إلى الصيانة." },
  repaired: { label: "إكمال الصيانة", title: "إكمال الصيانة وإرجاعها للمستودع", icon: PackageCheck, tone: "text-muted-foreground", hint: "إرجاع قطع مُصلحة إلى المستودع." },
  found: { label: "العثور على مفقود", title: "العثور على قطع مفقودة", icon: PackageCheck, tone: "text-muted-foreground", hint: "إرجاع قطع وُجدت إلى المستودع." },
  write_off: { label: "شطب نهائي", title: "شطب نهائي", icon: MinusCircle, tone: "text-muted-foreground", hint: "إخراج قطع تالفة أو مفقودة من الإجمالي نهائياً." },
};
const MAIN: QuantityAdjustmentKind[] = ["add", "reduce", "count", "damage", "loss"];
const MORE: QuantityAdjustmentKind[] = ["send_maintenance", "repaired", "found", "write_off"];

const ADD_SOURCES = ["شراء جديد", "رصيد افتتاحي", "هدية أو تبرع", "إرجاع من موقع خارجي", "أخرى"];
const REDUCE_REASONS = ["بيع القطع", "إهداء أو تبرع", "تصحيح خطأ إدخال سابق", "أخرى"];

const controlCls =
  "min-h-11 rounded-lg border border-border/50 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60";
const fieldCls = `mt-1 block w-full ${controlCls}`;
const numberText = (value: number) => Number(value ?? 0).toLocaleString("ar-IQ-u-nu-latn");
// The Arabic locale puts a right-to-left mark before "-", which flips "-4" to "4-";
// format the size and write the sign ourselves.
const signedText = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${numberText(Math.abs(value))}`;
const dateText = (value: string | null) =>
  value ? new Date(value).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }) : "—";
const newRequestId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const staffName = (member: StaffOption) => member.fullName?.trim() || member.username || `#${member.id}`;
/** The asset code printed on the QR label (same format as the server). */
export const quantityAssetCode = (productId: number) => `AJN-A${String(productId).padStart(6, "0")}`;

export function QuantityCard({ label, value, unit, tone = "default", hint }: { label: string; value: number; unit: string; tone?: "default" | "good" | "warn" | "bad" | "info"; hint?: string }) {
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

const DOCUMENT_LABELS: Record<string, string> = {
  purchase_invoice: "فاتورة شراء",
  kosha_booking: "حجز كوشة",
  service_order: "طلب خدمة",
  booking_penalty: "غرامة / تلف",
};
const OTHER_MOVEMENTS: Record<string, string> = {
  product_initial_stock: "رصيد افتتاحي",
  purchase_invoice_stock_increased: "استلام من فاتورة شراء",
  purchase_invoice_edit_reversal: "عكس فاتورة شراء",
  warehouse_transfer_executed: "تحويل بين المستودعات",
  manual_stock_adjustment: "تعديل يدوي سابق",
};
const movementLabel = (reason: string) => quantityMovementLabel(reason) ?? OTHER_MOVEMENTS[reason] ?? reason;

/** One history line: signed change to the total, or pieces moved between states. */
function movementRow(movement: Movement) {
  const meta = movement.metadata ?? {};
  const signed = Number(meta.change ?? movement.quantityChange ?? 0);
  const moved = Number(meta.quantity ?? 0);
  const booking = meta.bookingType && meta.bookingId ? `${DOCUMENT_LABELS[meta.bookingType] ?? meta.bookingType} #${meta.bookingId}` : null;
  const document = meta.document
    ? `${DOCUMENT_LABELS[meta.document.type] ?? meta.document.type} #${meta.document.id}`
    : movement.relatedType && movement.relatedType !== "asset"
      ? `${DOCUMENT_LABELS[movement.relatedType] ?? movement.relatedType} #${movement.relatedId}`
      : null;
  const before = meta.before?.inWarehouse;
  const after = meta.after?.inWarehouse;
  return {
    // Manual damage/loss share their reason with damage/loss found at a return; the metadata tells them apart.
    label: meta.action === "adjustment" && ACTIONS[meta.kind as QuantityAdjustmentKind] ? ACTIONS[meta.kind as QuantityAdjustmentKind].label : movementLabel(movement.reason),
    signed,
    moved,
    totals: meta.totalBefore != null ? `${numberText(meta.totalBefore)} ← ${numberText(meta.totalAfter)}` : null,
    warehouseMove: before != null && after != null && before !== after ? `في المستودع ${numberText(before)} ← ${numberText(after)}` : null,
    actor: movement.actorName || "النظام",
    responsible: meta.responsible?.name ? String(meta.responsible.name) : null,
    warehouse: movement.warehouseName,
    reference: booking ?? document,
    notes: [
      meta.reason,
      meta.notes,
      meta.description,
      meta.additionalToReturn ? "إضافي بعد الإرجاع" : null,
      Array.isArray(meta.photos) && meta.photos.length ? `${meta.photos.length} صورة` : null,
      meta.good != null ? `سليم ${meta.good} · تالف ${meta.damaged ?? 0} · مفقود ${meta.missing ?? 0}` : null,
    ].filter(Boolean).join(" · "),
  };
}

function MovementQuantity({ row }: { row: ReturnType<typeof movementRow> }) {
  if (row.signed !== 0)
    return (
      <span className={`font-bold tabular-nums ${row.signed > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} dir="ltr">
        {signedText(row.signed)}
      </span>
    );
  return row.moved > 0 ? (
    <span className="font-bold tabular-nums text-foreground" title="نقل بين حالات القطع؛ الإجمالي لم يتغير">{numberText(row.moved)}</span>
  ) : (
    <span className="tabular-nums text-muted-foreground">0</span>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-foreground">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

type Form = {
  quantity: string;
  countedQuantity: string;
  unitCost: string;
  source: string;
  invoiceId: string;
  reason: string;
  notes: string;
  responsibleStaffId: string;
  bookingType: string;
  bookingId: string;
  additional: boolean;
  confirm: boolean;
  writeOffFrom: "damaged" | "missing" | "maintenance";
  photos: TaskPhoto[];
};
const blankForm = (): Form => ({
  quantity: "",
  countedQuantity: "",
  unitCost: "",
  source: ADD_SOURCES[0],
  invoiceId: "",
  reason: "",
  notes: "",
  responsibleStaffId: "",
  bookingType: "",
  bookingId: "",
  additional: false,
  confirm: false,
  writeOffFrom: "damaged",
  photos: [],
});

/**
 * «إدارة الكميات» for a quantity-tracked asset: the totals, one menu for every
 * quantity action and the movement history. Every action is a stock movement
 * through the existing quantity endpoint; the total is never edited directly.
 */
export function QuantityManager({
  productId,
  assetName,
  onChanged,
}: {
  productId: number;
  assetName: string;
  /** Called after a movement is recorded, so a parent form can refresh values it shows. */
  onChanged?: () => void;
}) {
  const assetCode = quantityAssetCode(productId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | { kind: QuantityAdjustmentKind; requestId: string }>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [touched, setTouched] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState({ from: "", to: "", page: 1 });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ fromWarehouseId: "", toWarehouseId: "", quantity: "", notes: "" });

  const summary = useQuery<QuantitySummary>({
    queryKey: ["admin", "asset-quantity", productId, ""],
    queryFn: () => adminFetch(`/admin/assets/quantity/${productId}`),
  });
  const movements = useQuery<MovementPage>({
    queryKey: ["admin", "asset-quantity-movements", productId, history],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(history.page), pageSize: "25" });
      if (history.from) params.set("from", history.from);
      if (history.to) params.set("to", history.to);
      return adminFetch(`/admin/assets/quantity/${productId}/movements?${params}`);
    },
    enabled: historyOpen,
    placeholderData: (previous) => previous,
  });
  const warehouses = useQuery<{ warehouses: Array<{ id: number; name: string }> }>({
    queryKey: ["admin", "warehouses-list"],
    queryFn: () => adminFetch("/admin/warehouse-transfers"),
    enabled: transferOpen,
    staleTime: 5 * 60 * 1000,
  });
  const staffQuery = useQuery<StaffOption[]>({
    queryKey: ["admin", "staff"],
    queryFn: () => adminFetch("/admin/staff"),
    enabled: dialog?.kind === "count" || dialog?.kind === "damage" || dialog?.kind === "loss",
    staleTime: 5 * 60 * 1000,
  });
  const staff = Array.isArray(staffQuery.data) ? staffQuery.data : [];
  const me = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchAdminMe(), staleTime: 60_000 });
  const manager = ["admin", "manager", "main_admin", "super_admin", "main_manager"].includes(String(me.data?.role ?? "").toLowerCase());
  // Mirrors the server: total-changing actions are for managers; damage/maintenance
  // and loss/found follow the existing asset damage permissions.
  const allowed = (kind: QuantityAdjustmentKind) => {
    if (TOTAL_CHANGING_ADJUSTMENTS.includes(kind)) return manager;
    if (kind === "loss" || kind === "found") return manager || hasPerm(me.data ?? null, "asset_damage_approve");
    return manager || hasPerm(me.data ?? null, "asset_damage_record");
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-quantity", productId] });
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-quantity-movements", productId] });
    queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-edit", productId] });
    onChanged?.();
  };

  const adjust = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      adminFetch<{ ok: boolean; replayed?: boolean; label?: string; totalBefore?: number; totalAfter?: number; change?: number; warning?: string | null }>(
        `/admin/assets/quantity/${productId}/adjust`,
        { method: "POST", body: JSON.stringify(payload) },
      ),
    onSuccess: (result, payload) => {
      const kind = payload.kind as QuantityAdjustmentKind;
      setDialog(null);
      refresh();
      const unit = summary.data?.unit ?? "قطعة";
      if (result.replayed) {
        toast({ title: "سُجّلت هذه الحركة مسبقاً", description: "لم تُسجّل حركة مكررة." });
        return;
      }
      toast({
        title: kind === "add" ? "تمت إضافة الكمية بنجاح" : `تم: ${ACTIONS[kind].label}`,
        description:
          kind === "add"
            ? `تمت إضافة ${numberText(Number(payload.quantity))} ${unit}. الكمية الإجمالية الآن ${numberText(result.totalAfter ?? 0)}.`
            : `الإجمالي ${numberText(result.totalBefore ?? 0)} ← ${numberText(result.totalAfter ?? 0)} ${unit}${result.warning ? ` · ${result.warning}` : ""}`,
        variant: result.warning ? "destructive" : undefined,
      });
    },
    onError: (error) => toast({ title: "تعذّر تسجيل الحركة", description: apiErrorMessage(error), variant: "destructive" }),
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
      toast({ title: "تم إرسال طلب التحويل للاعتماد", description: "يُنفّذ بعد اعتماد المدير من صفحة التحويلات المخزنية." });
    },
    onError: (error) => toast({ title: "تعذّر إنشاء طلب التحويل", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const data = summary.data;
  const unit = data?.unit ?? "قطعة";
  const set = (patch: Partial<Form>) => {
    setTouched(true);
    setForm((current) => ({ ...current, ...patch }));
  };

  function open(kind: QuantityAdjustmentKind) {
    setForm({
      ...blankForm(),
      countedQuantity: kind === "count" ? String(data?.inWarehouse ?? "") : "",
      unitCost: kind === "add" ? String(data?.unitCost ?? "") : "",
      reason: kind === "count" ? "جرد دوري" : "",
    });
    setTouched(false);
    setDialog({ kind, requestId: newRequestId() });
  }

  const kind = dialog?.kind ?? null;
  const quantity = Number(form.quantity) || 0;
  const counted = Number(form.countedQuantity);
  const difference = data && kind === "count" && Number.isFinite(counted) ? counted - data.inWarehouse : 0;
  const reasonText = kind === "add" ? form.source : kind === "reduce" ? (form.reason || REDUCE_REASONS[0]) : form.reason.trim();
  const problem = (() => {
    if (!kind || !data) return null;
    if (kind === "count") {
      if (form.countedQuantity === "" || !Number.isInteger(counted) || counted < 0) return "أدخل العدد الفعلي في المستودع (عدد صحيح)";
      if (difference === 0) return "العدد مطابق للرصيد المسجل؛ لا يوجد فرق لتسويته";
    } else if (!Number.isInteger(quantity) || quantity <= 0) return "أدخل كمية بعدد صحيح أكبر من صفر";
    const source = { reduce: data.inWarehouse, damage: data.inWarehouse, loss: data.inWarehouse, send_maintenance: data.damaged, repaired: data.maintenance, found: data.missing } as Partial<Record<QuantityAdjustmentKind, number>>;
    if (kind === "write_off" && quantity > data[form.writeOffFrom]) return `المتاح للشطب ${numberText(data[form.writeOffFrom])} ${unit}`;
    if (source[kind] !== undefined && quantity > source[kind]!) return `الكمية أكبر من المتاح (${numberText(source[kind]!)} ${unit})`;
    if (reasonText.length < 3) return "اكتب السبب";
    if (reasonText === "أخرى" && form.notes.trim().length < 3) return "اكتب التفاصيل في الملاحظات";
    if (kind === "reduce" && !form.confirm) return "أكّد التخفيض";
    if ((kind === "damage" || kind === "loss") && form.bookingType && !(Number(form.bookingId) > 0)) return "أدخل رقم الحجز المرتبط";
    if (kind === "add" && form.source === "شراء جديد" && form.invoiceId && !(Number(form.invoiceId) > 0)) return "رقم فاتورة الشراء غير صحيح";
    return null;
  })();
  const totalAfter = data && kind
    ? kind === "add" ? data.total + quantity
      : kind === "reduce" || kind === "write_off" ? data.total - quantity
        : kind === "count" ? data.total + difference
          : data.total
    : 0;

  function submit() {
    if (!dialog || problem) return;
    const booking = (dialog.kind === "damage" || dialog.kind === "loss") && form.bookingType ? { relatedType: form.bookingType, relatedId: Number(form.bookingId) } : null;
    const invoice = dialog.kind === "add" && form.source === "شراء جديد" && Number(form.invoiceId) > 0 ? { relatedType: "purchase_invoice", relatedId: Number(form.invoiceId) } : null;
    adjust.mutate({
      kind: dialog.kind,
      quantity: dialog.kind === "count" ? 0 : quantity,
      countedQuantity: dialog.kind === "count" ? counted : null,
      unitCost: dialog.kind === "add" && form.unitCost !== "" ? Number(form.unitCost) : null,
      writeOffFrom: dialog.kind === "write_off" ? form.writeOffFrom : undefined,
      reason: reasonText,
      notes: form.notes.trim() || null,
      responsibleStaffId: Number(form.responsibleStaffId) || null,
      photos: form.photos.map((photo) => photo.url),
      additionalToReturn: form.additional,
      relatedType: booking?.relatedType ?? invoice?.relatedType ?? null,
      relatedId: booking?.relatedId ?? invoice?.relatedId ?? null,
      requestId: dialog.requestId,
    });
  }

  if (summary.isLoading)
    return <div className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الكميات…</div>;
  if (summary.isError || !data)
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600" role="alert">
        تعذّر تحميل الكميات: {apiErrorMessage(summary.error, "حاول مرة أخرى")}
        <Button type="button" size="sm" variant="outline" className="ms-2" onClick={() => void summary.refetch()}>إعادة المحاولة</Button>
      </div>
    );

  const Action = kind ? ACTIONS[kind] : null;
  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-7">
        <QuantityCard label="الكمية الإجمالية" value={data.total} unit={unit} tone="info" />
        <QuantityCard label="المتوفر" value={data.available} unit={unit} tone={data.lowAvailability ? "warn" : "good"} hint={`ليوم ${data.availabilityDay}`} />
        <QuantityCard label="المحجوز" value={data.reserved} unit={unit} hint="لم يخرج بعد" />
        <QuantityCard label="الخارج" value={data.checkedOut} unit={unit} tone={data.checkedOut ? "warn" : "default"} />
        <QuantityCard label="التالف" value={data.damaged} unit={unit} tone={data.damaged ? "bad" : "default"} />
        <QuantityCard label="المفقود" value={data.missing} unit={unit} tone={data.missing ? "bad" : "default"} />
        <QuantityCard label="الصيانة" value={data.maintenance} unit={unit} tone={data.maintenance ? "warn" : "default"} />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <b>لا يمكن تعديل الكمية الإجمالية مباشرة.</b> تُعدّل الكميات من «إدارة الكميات» حتى تُسجّل كل حركة مع السبب والموظف والوقت،
          وتبقى الحجوزات والمستودع صحيحة. القيمة: {numberText(data.total)} × {formatCurrency(data.unitCost)} = {formatCurrency(data.totalValue)}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <Button type="button" className="min-h-11 gap-2 px-5"><Boxes className="h-4 w-4" />إدارة الكميات<ChevronDown className="h-4 w-4 opacity-80" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {MAIN.map((item) => {
              const Icon = ACTIONS[item].icon;
              return (
                <DropdownMenuItem key={item} disabled={!allowed(item)} onSelect={() => open(item)} className="min-h-11 gap-2.5 font-semibold">
                  <Icon className={`h-4 w-4 ${ACTIONS[item].tone}`} />
                  <span className="flex-1">{ACTIONS[item].label}</span>
                  {!allowed(item) ? <span className="text-[10px] font-normal text-muted-foreground">للمدير</span> : null}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem onSelect={() => { setHistory({ from: "", to: "", page: 1 }); setHistoryOpen(true); }} className="min-h-11 gap-2.5 font-semibold">
              <History className="h-4 w-4 text-muted-foreground" />عرض سجل الحركات
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">الصيانة والشطب والتحويل</DropdownMenuLabel>
            {MORE.map((item) => {
              const Icon = ACTIONS[item].icon;
              return (
                <DropdownMenuItem key={item} disabled={!allowed(item)} onSelect={() => open(item)} className="min-h-10 gap-2.5 text-sm">
                  <Icon className={`h-4 w-4 ${ACTIONS[item].tone}`} />{ACTIONS[item].label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem onSelect={() => { setTransfer({ fromWarehouseId: "", toWarehouseId: "", quantity: "", notes: "" }); setTransferOpen(true); }} className="min-h-10 gap-2.5 text-sm">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />تحويل بين المستودعات
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={() => { setHistory({ from: "", to: "", page: 1 }); setHistoryOpen(true); }}>
          <History className="h-4 w-4" />سجل الحركات
        </Button>
        <Button type="button" variant="outline" className="min-h-11 gap-2" asChild>
          <Link href={`/admin/print-labels?productId=${productId}&kind=asset`}><QrCode className="h-4 w-4" />طباعة QR</Link>
        </Button>
      </div>

      {/* One dialog per action, laid out for what that action needs. */}
      <Dialog open={Boolean(dialog)} onOpenChange={(next) => !next && !adjust.isPending && setDialog(null)}>
        <DialogContent dir="rtl" className="w-[min(calc(100%-2rem),40rem)]">
          {kind && Action ? (
            <>
              <DialogHeader className="text-start">
                <DialogTitle className="flex items-center gap-2 text-lg font-extrabold"><Action.icon className={`h-5 w-5 ${Action.tone}`} />{Action.title}</DialogTitle>
                <DialogDescription>{Action.hint} تُسجّل حركة واحدة مع الكمية قبل وبعد والسبب والموظف، ولا يُحذف أي سجل سابق.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                <Boxes className="h-8 w-8 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-extrabold">{assetName || "أصل"}</p>
                  <p className="text-xs text-muted-foreground">رمز الأصل: <span dir="ltr" className="font-mono">{assetCode}</span>{data.warehouse ? ` · المستودع: ${data.warehouse.name}` : ""}</p>
                </div>
                <div className="text-end">
                  <p className="text-[11px] text-muted-foreground">الكمية الحالية</p>
                  <p className="text-lg font-extrabold tabular-nums">{numberText(data.total)} <span className="text-xs font-medium text-muted-foreground">{unit}</span></p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {kind === "count" ? (
                  <>
                    <Field label="الرصيد المسجل في المستودع"><input className={fieldCls} readOnly value={`${numberText(data.inWarehouse)} ${unit}`} /></Field>
                    <Field label="العدد الفعلي *"><input type="number" min={0} inputMode="numeric" className={fieldCls} value={form.countedQuantity} onChange={(event) => set({ countedQuantity: event.target.value })} /></Field>
                    <div className="sm:col-span-2">
                      <p className={`rounded-lg px-3 py-2 text-sm font-bold ${difference === 0 ? "bg-muted text-muted-foreground" : difference > 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
                        الفرق: <span dir="ltr" className="tabular-nums">{signedText(difference)}</span> {unit}
                        {difference !== 0 ? ` · الإجمالي بعد التسوية ${numberText(totalAfter)} ${unit}` : ""}
                      </p>
                    </div>
                  </>
                ) : (
                  <Field
                    label={kind === "add" ? "الكمية المراد إضافتها *" : "الكمية *"}
                    hint={kind === "reduce" ? `في المستودع ${numberText(data.inWarehouse)} ${unit} · محجوز أو خارج للحجوزات القادمة ${numberText(data.peakCommitment)} ${unit}` : kind === "damage" || kind === "loss" ? `في المستودع ${numberText(data.inWarehouse)} ${unit}` : undefined}
                  >
                    <input type="number" min={1} inputMode="numeric" className={fieldCls} value={form.quantity} onChange={(event) => set({ quantity: event.target.value })} autoFocus />
                  </Field>
                )}
                {kind !== "count" ? <Field label="وحدة القياس"><input className={fieldCls} readOnly value={unit} /></Field> : null}

                {kind === "add" ? (
                  <>
                    <Field label="تكلفة القطعة (اختياري)" hint={quantity > 0 && Number(form.unitCost) > 0 ? `قيمة الإضافة ${formatCurrency(quantity * Number(form.unitCost))}` : "تُضاف إلى تكلفة الاقتناء والقيمة الدفترية؛ لا تُنشئ قيداً أو مصروفاً."}>
                      <input type="number" min={0} className={fieldCls} value={form.unitCost} onChange={(event) => set({ unitCost: event.target.value })} />
                    </Field>
                    <Field label="مصدر الكمية *">
                      <select className={fieldCls} value={form.source} onChange={(event) => set({ source: event.target.value })}>
                        {ADD_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </Field>
                    {form.source === "شراء جديد" ? (
                      <Field label="رقم فاتورة الشراء (اختياري)" hint="بنود الفاتورة تُستلم تلقائياً عند حفظها؛ النظام يرفض استلام الفاتورة نفسها مرة ثانية.">
                        <input type="number" min={1} inputMode="numeric" className={fieldCls} value={form.invoiceId} onChange={(event) => set({ invoiceId: event.target.value })} />
                      </Field>
                    ) : null}
                  </>
                ) : null}

                {kind === "reduce" ? (
                  <Field label="السبب *">
                    <select className={fieldCls} value={form.reason || REDUCE_REASONS[0]} onChange={(event) => set({ reason: event.target.value })}>
                      {REDUCE_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </Field>
                ) : null}

                {kind === "write_off" ? (
                  <Field label="الشطب من">
                    <select className={fieldCls} value={form.writeOffFrom} onChange={(event) => set({ writeOffFrom: event.target.value as Form["writeOffFrom"] })}>
                      <option value="damaged">التالف ({numberText(data.damaged)})</option>
                      <option value="missing">المفقود ({numberText(data.missing)})</option>
                      <option value="maintenance">الصيانة ({numberText(data.maintenance)})</option>
                    </select>
                  </Field>
                ) : null}

                {kind === "count" || kind === "damage" || kind === "loss" ? (
                  <Field label={kind === "count" ? "الموظف المسؤول عن الجرد" : "الموظف المسؤول (اختياري)"}>
                    <select className={fieldCls} value={form.responsibleStaffId} onChange={(event) => set({ responsibleStaffId: event.target.value })}>
                      <option value="">{kind === "count" ? "أنا (المسجّل)" : "غير محدد"}</option>
                      {staff.map((member) => <option key={member.id} value={member.id}>{staffName(member)}</option>)}
                    </select>
                    {staffQuery.isError ? <span className="mt-1 block text-xs font-normal text-destructive">تعذّر تحميل قائمة الموظفين: {apiErrorMessage(staffQuery.error)}</span> : null}
                  </Field>
                ) : null}

                {kind === "damage" || kind === "loss" ? (
                  <Field label="الحجز المرتبط (اختياري)">
                    <div className="mt-1 flex gap-2">
                      <select className={`${controlCls} w-32 shrink-0`} value={form.bookingType} onChange={(event) => set({ bookingType: event.target.value, additional: false })} aria-label="نوع الحجز">
                        <option value="">بدون</option>
                        <option value="kosha_booking">حجز كوشة</option>
                        <option value="service_order">طلب خدمة</option>
                      </select>
                      <input type="number" min={1} inputMode="numeric" disabled={!form.bookingType} className={`${controlCls} min-w-0 flex-1`} value={form.bookingId} onChange={(event) => set({ bookingId: event.target.value })} placeholder="رقم الحجز" aria-label="رقم الحجز" />
                    </div>
                  </Field>
                ) : null}

                {kind !== "add" && kind !== "reduce" ? (
                  <div className="sm:col-span-2">
                    <Field label="السبب *">
                      <input className={fieldCls} value={form.reason} onChange={(event) => set({ reason: event.target.value })} placeholder={kind === "count" ? "مثال: جرد نهاية الشهر" : kind === "damage" ? "مثال: كسر أثناء التحميل" : kind === "loss" ? "مثال: لم تُرجع بعد الحفل" : "اكتب السبب"} />
                    </Field>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <Field label="ملاحظات">
                    <textarea rows={2} className={`${fieldCls} py-2`} value={form.notes} onChange={(event) => set({ notes: event.target.value })} placeholder={kind === "add" ? "مثال: إضافة كمية أولية من المشتريات" : ""} />
                  </Field>
                </div>
              </div>

              {(kind === "damage" || kind === "loss") && form.bookingType ? (
                <label className="flex items-start gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={form.additional} onChange={(event) => set({ additional: event.target.checked })} />
                  <span>هذا {kind === "damage" ? "تلف" : "فقدان"} <b>إضافي</b> اكتُشف بعد تسجيل إرجاع هذا الحجز. اتركه فارغاً إذا لم يُسجّل شيء عند الإرجاع؛ النظام يرفض تسجيل المسجّل مرتين.</span>
                </label>
              ) : null}
              {kind === "damage" || kind === "loss" ? (
                <TaskPhotoPicker photos={form.photos} onChange={(photos) => set({ photos })} label="صور الإثبات (اختياري)" description="صور القطع أو مكان الحادث." />
              ) : null}
              {kind === "reduce" ? (
                <label className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--destructive))]" checked={form.confirm} onChange={(event) => set({ confirm: event.target.checked })} />
                  <span>أؤكد أن {quantity > 0 ? numberText(quantity) : "هذه"} {unit} تخرج من الإجمالي نهائياً. لا يُسمح بالتخفيض دون الكمية المحجوزة أو الخارجة.</span>
                </label>
              ) : null}

              {kind !== "count" && (kind === "add" || kind === "reduce" || kind === "write_off") && quantity > 0 ? (
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">الإجمالي بعد الحركة: <b className="tabular-nums">{numberText(totalAfter)} {unit}</b></p>
              ) : null}
              {problem && touched ? <p className="text-sm font-bold text-destructive" role="alert">{problem}</p> : null}

              <DialogFooter className="gap-2 sm:justify-start">
                <Button type="button" className="min-h-11 gap-2 px-6" disabled={Boolean(problem) || adjust.isPending} onClick={submit}>
                  {adjust.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Action.icon className="h-4 w-4" />}
                  {kind === "add" ? "إضافة الكمية" : kind === "count" ? "تسجيل التسوية" : `تأكيد ${Action.label}`}
                </Button>
                <Button type="button" variant="outline" className="min-h-11" disabled={adjust.isPending} onClick={() => setDialog(null)}>إلغاء</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent dir="rtl" className="w-[min(calc(100%-2rem),60rem)]">
          <DialogHeader className="text-start">
            <DialogTitle className="flex items-center gap-2 text-lg font-extrabold"><ClipboardCheck className="h-5 w-5 text-primary" />سجل حركات الكميات</DialogTitle>
            <DialogDescription>{assetName} · <span dir="ltr" className="font-mono">{assetCode}</span> — كل حركة إضافة وتخفيض وجرد وتلف وفقدان وإخراج وإرجاع لهذا الأصل.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-muted-foreground">من<DateField type="date" dir="ltr" className={`mt-1 block w-40 ${controlCls}`} value={history.from} onChange={(event) => setHistory({ ...history, from: event.target.value, page: 1 })} /></label>
            <label className="text-xs font-semibold text-muted-foreground">إلى<DateField type="date" dir="ltr" className={`mt-1 block w-40 ${controlCls}`} value={history.to} onChange={(event) => setHistory({ ...history, to: event.target.value, page: 1 })} /></label>
            {movements.isFetching ? <Loader2 className="mb-3 h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          {movements.isError ? (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600" role="alert">تعذّر تحميل الحركات: {apiErrorMessage(movements.error)}</p>
          ) : movements.isLoading ? (
            <div className="h-32 animate-pulse rounded-xl bg-muted" />
          ) : !movements.data?.data.length ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">لا توجد حركات {history.from || history.to ? "في هذه الفترة" : "بعد"}.</p>
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-xl border border-border/50">
              {/* Phones: one card per movement. */}
              <ul className="divide-y divide-border/40 sm:hidden">
                {movements.data.data.map((movement) => {
                  const row = movementRow(movement);
                  return (
                    <li key={movement.id} className="space-y-1 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold">{row.label}</p>
                        <MovementQuantity row={row} />
                      </div>
                      <p className="text-xs text-muted-foreground">{dateText(movement.createdAt)} · {row.actor}{row.responsible ? ` · المسؤول: ${row.responsible}` : ""}</p>
                      {row.totals ? <p className="text-xs tabular-nums text-muted-foreground">الإجمالي {row.totals}{row.warehouseMove ? ` · ${row.warehouseMove}` : ""}</p> : null}
                      {row.reference || row.warehouse ? <p className="text-xs text-muted-foreground">{[row.reference, row.warehouse].filter(Boolean).join(" · ")}</p> : null}
                      {row.notes ? <p className="text-xs leading-5 text-muted-foreground">{row.notes}</p> : null}
                    </li>
                  );
                })}
              </ul>
              <table className="hidden w-full min-w-[760px] text-sm sm:table">
                <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                  <tr>{["التاريخ", "الحركة", "الكمية", "الإجمالي قبل ← بعد", "الموظف", "المستودع", "المرجع", "ملاحظات"].map((label) => <th key={label} className="p-2 text-start font-bold">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {movements.data.data.map((movement) => {
                    const row = movementRow(movement);
                    return (
                      <tr key={movement.id} className="align-top">
                        <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">{dateText(movement.createdAt)}</td>
                        <td className="p-2 font-semibold">{row.label}</td>
                        <td className="p-2"><MovementQuantity row={row} /></td>
                        <td className="whitespace-nowrap p-2 tabular-nums text-muted-foreground">{row.totals ?? "—"}{row.warehouseMove ? <span className="block text-xs">{row.warehouseMove}</span> : null}</td>
                        <td className="p-2">{row.actor}{row.responsible ? <span className="block text-xs text-muted-foreground">المسؤول: {row.responsible}</span> : null}</td>
                        <td className="p-2 text-muted-foreground">{row.warehouse ?? "—"}</td>
                        <td className="p-2 text-muted-foreground">{row.reference ?? "—"}</td>
                        <td className="max-w-[16rem] p-2 text-xs leading-5 text-muted-foreground">{row.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {movements.data && movements.data.totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={history.page <= 1} onClick={() => setHistory({ ...history, page: history.page - 1 })}>السابق</Button>
              <span className="text-xs font-bold tabular-nums text-muted-foreground">{history.page} / {movements.data.totalPages} · {numberText(movements.data.total)} حركة</span>
              <Button type="button" size="sm" variant="outline" disabled={history.page >= movements.data.totalPages} onClick={() => setHistory({ ...history, page: history.page + 1 })}>التالي</Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>تحويل بين المستودعات</DialogTitle>
            <DialogDescription>يستخدم نظام التحويلات المخزنية الحالي؛ يُنفّذ بعد اعتماد المدير ولا يغيّر الإجمالي.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="من مستودع">
              <select className={fieldCls} value={transfer.fromWarehouseId} onChange={(event) => setTransfer({ ...transfer, fromWarehouseId: event.target.value })}>
                <option value="">اختر</option>
                {(warehouses.data?.warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </Field>
            <Field label="إلى مستودع">
              <select className={fieldCls} value={transfer.toWarehouseId} onChange={(event) => setTransfer({ ...transfer, toWarehouseId: event.target.value })}>
                <option value="">اختر</option>
                {(warehouses.data?.warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </Field>
            <Field label={`الكمية (${unit})`}><input type="number" min={1} max={data.inWarehouse} className={fieldCls} value={transfer.quantity} onChange={(event) => setTransfer({ ...transfer, quantity: event.target.value })} /></Field>
            <Field label="ملاحظات"><input className={fieldCls} value={transfer.notes} onChange={(event) => setTransfer({ ...transfer, notes: event.target.value })} /></Field>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              type="button"
              disabled={requestTransfer.isPending || !transfer.fromWarehouseId || !transfer.toWarehouseId || transfer.fromWarehouseId === transfer.toWarehouseId || !(Number(transfer.quantity) > 0) || Number(transfer.quantity) > data.inWarehouse}
              onClick={() => requestTransfer.mutate()}
            >
              إرسال للاعتماد
            </Button>
            <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
