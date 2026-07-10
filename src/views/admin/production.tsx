import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Factory,
  Plus,
  Trash2,
  Search,
  X,
  ShoppingCart,
  AlertTriangle,
  CheckCircle2,
  PlayCircle,
  PackageCheck,
  Truck,
  BarChart3,
  BadgeCheck,
  Wrench,
  Users,
  Printer,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, apiErrorMessage, apiErrorStatus, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { useToast } from "@/hooks/use-toast";
import { generateQrDataUrl } from "./label-helpers";
import { sheetReportCss, printWhenImagesReadyScript } from "./print-helpers";

type ProductRow = { id: number; name: string; nameAr: string; price: number; costPrice: number; stock: number; barcode?: string | null };
type BuildItem = { productId: number; name: string; quantity: number };
type LaborLine = { worker: string; hours: number; hourlyRate: number };
type EquipmentLine = { type: string; id: number | null; name: string; distanceKm: number; fuelPricePerKm: number; fuelCost: number; usageCost: number; depreciation: number; maintenance: number };
type ProductionResources = {
  vehicles: Array<{ id: number; name: string; plateNumber: string | null }>;
  assets: Array<{ productId: number; name: string; purchasePrice: number; currentValue: number; expectedLifeUses: number; depreciationPerUse: number; maintenancePerUse: number }>;
};

type Estimate = {
  items: Array<{ productId: number; name: string; quantity: number; unitPrice: number }>;
  materials: Array<{ productId: number; name: string; required: number; available: number; missing: number; unit: string; unitCost: number; lineCost: number }>;
  shoppingList: Array<{ productId: number; name: string; required: number; available: number; missing: number; unit: string }>;
  stockOk: boolean;
  wastagePercent: number;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  totalCost: number;
  expectedRevenue: number;
  expectedProfit: number;
  profitMargin: number;
};

type ProductionOrder = {
  id: number;
  orderNo: string;
  status: string;
  items: Array<{ productId: number; name: string; quantity: number; unitPrice?: number; produced: number; remaining: number }>;
  totalPlanned: number;
  totalProduced: number;
  materials: Array<{ productId: number; name: string; required: number; unit: string }>;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  wastagePercent: number;
  totalCost: number;
  expectedRevenue: number;
  expectedProfit: number;
  bookingType: string | null;
  bookingId: number | null;
  expenseId: number | null;
  notes: string | null;
  createdByName: string;
  approvedByName: string | null;
  createdAt: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد الانتظار", cls: "border-muted-foreground/30 bg-muted/40 text-muted-foreground" },
  preparing: { label: "التحضير", cls: "border-sky-500/30 bg-sky-500/10 text-sky-500" },
  in_production: { label: "قيد الإنتاج", cls: "border-status-warning/30 bg-status-warning/10 text-status-warning" },
  quality_check: { label: "فحص الجودة", cls: "border-purple-500/30 bg-purple-500/10 text-purple-500" },
  ready: { label: "جاهز", cls: "border-primary/30 bg-primary/10 text-primary" },
  delivered: { label: "تم التسليم", cls: "border-status-success/30 bg-status-success/10 text-status-success" },
  cancelled: { label: "ملغي", cls: "border-status-danger/30 bg-status-danger/10 text-status-danger" },
};
const STATUS_ORDER = ["pending", "preparing", "in_production", "quality_check", "ready", "delivered", "cancelled"];
const NEXT_STEP: Record<string, { to: string; label: string; icon: any } | undefined> = {
  pending: { to: "preparing", label: "تحضير", icon: PlayCircle },
  preparing: { to: "in_production", label: "بدء الإنتاج", icon: PlayCircle },
  in_production: { to: "quality_check", label: "فحص الجودة", icon: PackageCheck },
  quality_check: { to: "ready", label: "جاهز", icon: PackageCheck },
  ready: { to: "delivered", label: "تسليم", icon: Truck },
};
const BOOKING_TYPES = [
  { value: "", label: "بدون ربط" },
  { value: "kosha_booking", label: "حجز كوشة" },
  { value: "wedding", label: "زفاف" },
  { value: "engagement", label: "خطوبة" },
  { value: "graduation", label: "تخرج" },
  { value: "gift_order", label: "طلب هدايا" },
];

export default function ProductionPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<BuildItem[]>([]);
  const [labor, setLabor] = useState<LaborLine[]>([]);
  const [equipment, setEquipment] = useState<EquipmentLine[]>([]);
  const [wastagePercent, setWastagePercent] = useState(0);
  const [bookingType, setBookingType] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [producing, setProducing] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [postExpense, setPostExpense] = useState(false);
  const [notes, setNotes] = useState("");
  const [produceTarget, setProduceTarget] = useState<ProductionOrder | null>(null);

  const { data: products = [], isLoading: productsLoading } = useQuery<ProductRow[]>({
    queryKey: ["admin", "production-products"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 2 * 60 * 1000,
  });
  const { data: orders = [], isLoading: ordersLoading, refetch: refetchOrders } = useQuery<ProductionOrder[]>({
    queryKey: ["admin", "production-orders"],
    queryFn: () => adminFetch("/admin/production"),
  });
  const { data: resources } = useQuery<ProductionResources>({
    queryKey: ["admin", "production-resources"],
    queryFn: () => adminFetch("/admin/production/resources"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: bookingOptions = [] } = useQuery<Array<{ id: number; label: string; date: string | null }>>({
    queryKey: ["admin", "production-bookings", bookingType],
    queryFn: () => adminFetch(`/admin/production/bookings?type=${encodeURIComponent(bookingType)}`),
    enabled: Boolean(bookingType),
  });

  const selectedIds = new Set(items.map((i) => i.productId));
  const pickable = useMemo(
    () =>
      products
        .filter((p) => !selectedIds.has(p.id))
        .filter((p) => {
          const term = pickerSearch.trim().toLowerCase();
          if (!term) return true;
          return [p.nameAr, p.name, p.barcode].some((v) => String(v ?? "").toLowerCase().includes(term));
        })
        .slice(0, 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, pickerSearch, items],
  );

  const costBody = () => ({
    items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    labor: labor.filter((l) => l.worker || l.hours > 0 || l.hourlyRate > 0),
    equipment: equipment.filter((e) => e.name || e.fuelCost || e.usageCost || e.depreciation || e.maintenance),
    wastagePercent: Number(wastagePercent) || 0,
  });

  function invalidateEstimate() { setEstimate(null); }
  function addItem(p: ProductRow) {
    setItems((prev) => [...prev, { productId: p.id, name: p.nameAr || p.name, quantity: 1 }]);
    invalidateEstimate(); setPickerOpen(false); setPickerSearch("");
  }
  function setQty(i: number, quantity: number) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, quantity } : it))); invalidateEstimate();
  }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); invalidateEstimate(); }

  // ── Equipment lines ──
  function addEquip() {
    setEquipment((p) => [...p, { type: "vehicle", id: null, name: "", distanceKm: 0, fuelPricePerKm: 0, fuelCost: 0, usageCost: 0, depreciation: 0, maintenance: 0 }]);
    invalidateEstimate();
  }
  function setEquip(i: number, patch: Partial<EquipmentLine>) {
    setEquipment((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    invalidateEstimate();
  }
  function removeEquip(i: number) { setEquipment((p) => p.filter((_, idx) => idx !== i)); invalidateEstimate(); }
  // Selecting a rental asset auto-fills its per-use depreciation + maintenance allocation.
  function pickAsset(i: number, assetId: number) {
    const a = resources?.assets.find((x) => x.productId === assetId);
    if (!a) { setEquip(i, { id: null, name: "" }); return; }
    setEquip(i, { id: a.productId, name: a.name, depreciation: a.depreciationPerUse, maintenance: a.maintenancePerUse });
  }
  function pickVehicle(i: number, vehicleId: number) {
    const v = resources?.vehicles.find((x) => x.id === vehicleId);
    setEquip(i, { id: v?.id ?? null, name: v?.name ?? "" });
  }
  // Fuel auto-computed = distance × price/km whenever either changes.
  function setFuel(i: number, patch: { distanceKm?: number; fuelPricePerKm?: number }) {
    setEquipment((p) => p.map((x, idx) => {
      if (idx !== i) return x;
      const distanceKm = patch.distanceKm ?? x.distanceKm;
      const fuelPricePerKm = patch.fuelPricePerKm ?? x.fuelPricePerKm;
      return { ...x, distanceKm, fuelPricePerKm, fuelCost: Math.round(distanceKm * fuelPricePerKm * 100) / 100 };
    }));
    invalidateEstimate();
  }

  async function runEstimate() {
    if (!items.length) return;
    setEstimating(true);
    try {
      setEstimate(await adminFetch<Estimate>("/admin/production/estimate", { method: "POST", body: JSON.stringify(costBody()) }));
    } catch (e: any) {
      toast({ title: "تعذر حساب التكلفة", description: apiErrorMessage(e), variant: "destructive" });
    } finally { setEstimating(false); }
  }

  async function produce() {
    if (!items.length) return;
    setProducing(true);
    try {
      await adminFetch("/admin/production", {
        method: "POST",
        body: JSON.stringify({ ...costBody(), plan: planMode, postExpense: postExpense && !planMode, notes: notes.trim() || undefined, bookingType: bookingType || undefined, bookingId: bookingType && bookingId ? Number(bookingId) : undefined }),
      });
      toast({ title: planMode ? "تم حفظ خطة الإنتاج (بدون خصم) 📋" : "تم إنشاء أمر الإنتاج · خُصمت المواد وزاد مخزون المنتجات ✅" });
      setItems([]); setLabor([]); setEquipment([]); setWastagePercent(0); setEstimate(null); setNotes(""); setBookingType(""); setBookingId(""); setPlanMode(false); setPostExpense(false);
      await refetchOrders();
    } catch (e: any) {
      if (apiErrorStatus(e) === 409) {
        toast({ title: "المواد غير كافية", description: "راجع قائمة المواد الناقصة أدناه.", variant: "destructive" });
        await runEstimate();
      } else {
        toast({ title: "تعذر تنفيذ الإنتاج", description: apiErrorMessage(e), variant: "destructive" });
      }
    } finally { setProducing(false); }
  }

  // Printable work order (A5) with items, materials, labor, equipment, costs + a QR reference.
  async function printWorkOrder(order: ProductionOrder) {
    try {
      const qr = await generateQrDataUrl(`AJN-PROD:${order.orderNo}`, 220);
      const esc = (s: any) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
      const statusLabel = STATUS_META[order.status]?.label ?? order.status;
      const rows = (arr: string[][]) => arr.map((r) => `<tr>${r.map((c, i) => `<td style="${i === 0 ? "text-align:right" : "text-align:center"}">${c}</td>`).join("")}</tr>`).join("");
      const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>أمر شغل ${esc(order.orderNo)}</title>
        <style>${sheetReportCss("a5")}
          table{width:100%;border-collapse:collapse;margin:6px 0;font-size:12px}
          th,td{border:1px solid #ccc;padding:4px 6px}th{background:#f3f3f3}
          .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:8px}
          .muted{color:#666;font-size:11px}.sec{font-weight:700;margin:10px 0 2px}
        </style></head><body>
        <div class="hdr">
          <div><h2 style="margin:0">أمر شغل إنتاج</h2><div class="muted">${esc(order.orderNo)} · ${esc(statusLabel)}${order.bookingType ? ` · ${esc(order.bookingType)}#${esc(order.bookingId)}` : ""}</div></div>
          <img src="${qr}" width="90" height="90" alt="QR" />
        </div>
        <div class="sec">المنتجات المطلوبة</div>
        <table><thead><tr><th style="text-align:right">المنتج</th><th>الكمية</th><th>مُنتَج</th><th>متبقّي</th></tr></thead><tbody>
          ${rows(order.items.map((it) => [esc(it.name), String(it.quantity), String(it.produced), String(it.remaining)]))}
        </tbody></table>
        <div class="sec">المواد الخام</div>
        <table><thead><tr><th style="text-align:right">المادة</th><th>الكمية</th><th>الوحدة</th></tr></thead><tbody>
          ${rows(order.materials.map((m: any) => [esc(m.name), String(m.required), esc(m.unit)]))}
        </tbody></table>
        <div class="sec">التكاليف</div>
        <table><tbody>
          ${rows([["مواد", formatCurrency(order.materialCost)], ["عمالة", formatCurrency(order.laborCost)], ["معدات", formatCurrency(order.equipmentCost)], ["الإجمالي", formatCurrency(order.totalCost)], ["الربح المتوقع", formatCurrency(order.expectedProfit)]])}
        </tbody></table>
        ${order.notes ? `<div class="muted">ملاحظات: ${esc(order.notes)}</div>` : ""}
        <div class="muted" style="margin-top:8px">أُنشئ بواسطة ${esc(order.createdByName)} · ${esc(order.createdAt?.slice(0, 10) ?? "")}</div>
        ${printWhenImagesReadyScript()}
      </body></html>`;
      const w = window.open("", "_blank", "width=720,height=900");
      if (!w) { toast({ title: "تعذر فتح نافذة الطباعة", variant: "destructive" }); return; }
      w.document.write(html);
      w.document.close();
    } catch (e: any) {
      toast({ title: "تعذر توليد أمر الشغل", description: apiErrorMessage(e), variant: "destructive" });
    }
  }

  async function produceBatch(orderId: number, batch: Array<{ productId: number; quantity: number }>) {
    try {
      await adminFetch(`/admin/production/${orderId}/produce`, { method: "POST", body: JSON.stringify({ items: batch }) });
      toast({ title: "تم إنتاج الدفعة ✅" });
      setProduceTarget(null);
      await refetchOrders();
    } catch (e: any) {
      if (apiErrorStatus(e) === 409) toast({ title: "المواد غير كافية لهذه الدفعة", description: apiErrorMessage(e), variant: "destructive" });
      else toast({ title: "تعذر الإنتاج", description: apiErrorMessage(e), variant: "destructive" });
    }
  }

  async function changeStatus(order: ProductionOrder, to: string) {
    try {
      await adminFetch(`/admin/production/${order.id}`, { method: "PATCH", body: JSON.stringify({ status: to }) });
      await refetchOrders();
    } catch (e: any) { toast({ title: "تعذر تحديث الحالة", description: apiErrorMessage(e), variant: "destructive" }); }
  }
  async function approve(order: ProductionOrder) {
    try { await adminFetch(`/admin/production/${order.id}/approve`, { method: "POST" }); await refetchOrders(); toast({ title: "تم الاعتماد ✅" }); }
    catch (e: any) { toast({ title: "تعذر الاعتماد", description: apiErrorMessage(e), variant: "destructive" }); }
  }
  async function remove(order: ProductionOrder) {
    if (!confirm(`حذف أمر الإنتاج ${order.orderNo}؟ سيُعاد المخزون إن كان مطبقاً.`)) return;
    try { await adminFetch(`/admin/production/${order.id}`, { method: "DELETE" }); await refetchOrders(); toast({ title: "تم الحذف" }); }
    catch (e: any) { toast({ title: "تعذر الحذف", description: apiErrorMessage(e), variant: "destructive" }); }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Factory className="w-6 h-6 text-primary" /> أوامر الإنتاج
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            نظام تصنيع متكامل — خصم المواد الخام، زيادة مخزون المنتجات، احتساب العمالة والمعدات، وربط بالحجوزات.
          </p>
        </div>
        <Link href="/admin/production/reports">
          <Button variant="outline" className="gap-2"><BarChart3 className="w-4 h-4" /> تقارير الإنتاج</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Builder */}
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">🏭 دفعة إنتاج جديدة</h2>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              <Plus className="w-4 h-4 ml-1" /> إضافة منتج
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 bg-background/40 p-6 text-center text-xs text-muted-foreground">
              أضف منتجات نهائية لإنتاجها (مثال: ٢٠ بوكيه ورد، ١٠ علب هدايا).
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={it.productId} className="flex items-center gap-2 rounded-lg border border-border/25 bg-background/40 p-2">
                  <span className="flex-1 min-w-0 text-sm text-foreground truncate">{it.name}</span>
                  <input type="number" min={1} value={it.quantity}
                    onChange={(e) => setQty(i, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    className="w-20 bg-background border border-border/40 rounded-lg px-2 py-1 text-sm text-center" />
                  <button type="button" onClick={() => removeItem(i)} className="text-status-danger p-1 hover:bg-status-danger/10 rounded-md">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Labor */}
          <div className="rounded-lg border border-border/25 bg-background/40 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5" /> العمالة</span>
              <button type="button" onClick={() => { setLabor((p) => [...p, { worker: "", hours: 0, hourlyRate: 0 }]); invalidateEstimate(); }} className="text-[11px] text-primary">+ عامل</button>
            </div>
            {labor.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-1 items-center">
                <input value={l.worker} onChange={(e) => { setLabor((p) => p.map((x, idx) => idx === i ? { ...x, worker: e.target.value } : x)); invalidateEstimate(); }} placeholder="العامل" className="col-span-5 bg-background border border-border/40 rounded px-2 py-1 text-xs" />
                <input type="number" min={0} value={l.hours} onChange={(e) => { setLabor((p) => p.map((x, idx) => idx === i ? { ...x, hours: Number(e.target.value) } : x)); invalidateEstimate(); }} placeholder="ساعات" className="col-span-3 bg-background border border-border/40 rounded px-1 py-1 text-xs text-center" />
                <input type="number" min={0} value={l.hourlyRate} onChange={(e) => { setLabor((p) => p.map((x, idx) => idx === i ? { ...x, hourlyRate: Number(e.target.value) } : x)); invalidateEstimate(); }} placeholder="أجر/س" className="col-span-3 bg-background border border-border/40 rounded px-1 py-1 text-xs text-center" />
                <button type="button" onClick={() => { setLabor((p) => p.filter((_, idx) => idx !== i)); invalidateEstimate(); }} className="col-span-1 text-status-danger"><X className="w-3.5 h-3.5 mx-auto" /></button>
              </div>
            ))}
          </div>

          {/* Equipment */}
          <div className="rounded-lg border border-border/25 bg-background/40 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1"><Wrench className="w-3.5 h-3.5" /> المعدات والنقل</span>
              <button type="button" onClick={addEquip} className="text-[11px] text-primary">+ معدة</button>
            </div>
            {equipment.map((e, i) => (
              <div key={i} className="space-y-1 rounded border border-border/20 p-1.5">
                <div className="flex items-center gap-1">
                  <select value={e.type} onChange={(ev) => setEquip(i, { type: ev.target.value, id: null })} className="bg-background border border-border/40 rounded px-1 py-1 text-xs">
                    <option value="vehicle">مركبة</option>
                    <option value="equipment">معدة</option>
                    <option value="asset">أصل إيجار</option>
                  </select>
                  {e.type === "asset" ? (
                    <select value={e.id ?? ""} onChange={(ev) => pickAsset(i, Number(ev.target.value))} className="flex-1 bg-background border border-border/40 rounded px-1 py-1 text-xs">
                      <option value="">— اختر أصلاً —</option>
                      {(resources?.assets ?? []).map((a) => <option key={a.productId} value={a.productId}>{a.name}</option>)}
                    </select>
                  ) : e.type === "vehicle" ? (
                    <select value={e.id ?? ""} onChange={(ev) => pickVehicle(i, Number(ev.target.value))} className="flex-1 bg-background border border-border/40 rounded px-1 py-1 text-xs">
                      <option value="">— اختر مركبة —</option>
                      {(resources?.vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}{v.plateNumber ? ` (${v.plateNumber})` : ""}</option>)}
                    </select>
                  ) : (
                    <input value={e.name} onChange={(ev) => setEquip(i, { name: ev.target.value })} placeholder="الاسم" className="flex-1 bg-background border border-border/40 rounded px-2 py-1 text-xs" />
                  )}
                  <button type="button" onClick={() => removeEquip(i)} className="text-status-danger"><X className="w-3.5 h-3.5" /></button>
                </div>
                {e.type === "vehicle" && (
                  <div className="grid grid-cols-2 gap-1">
                    <input type="number" min={0} value={e.distanceKm} onChange={(ev) => setFuel(i, { distanceKm: Number(ev.target.value) })} placeholder="مسافة (كم)" title="المسافة بالكيلومتر" className="bg-background border border-border/40 rounded px-1 py-1 text-[11px] text-center" />
                    <input type="number" min={0} value={e.fuelPricePerKm} onChange={(ev) => setFuel(i, { fuelPricePerKm: Number(ev.target.value) })} placeholder="سعر/كم" title="تكلفة الوقود لكل كيلومتر" className="bg-background border border-border/40 rounded px-1 py-1 text-[11px] text-center" />
                  </div>
                )}
                <div className="grid grid-cols-4 gap-1">
                  {([["fuelCost", "وقود"], ["usageCost", "تشغيل"], ["depreciation", "إهلاك"], ["maintenance", "صيانة"]] as const).map(([field, lbl]) => (
                    <input key={field} type="number" min={0} value={(e as any)[field]} title={lbl}
                      onChange={(ev) => setEquip(i, { [field]: Number(ev.target.value) } as any)}
                      placeholder={lbl} className="bg-background border border-border/40 rounded px-1 py-1 text-[11px] text-center" />
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground text-center">إجمالي: {formatCurrency((Number(e.fuelCost)||0)+(Number(e.usageCost)||0)+(Number(e.depreciation)||0)+(Number(e.maintenance)||0))}</p>
              </div>
            ))}
          </div>

          {/* Wastage + booking + notes */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              نسبة الهدر %
              <input type="number" min={0} max={100} value={wastagePercent} onChange={(e) => { setWastagePercent(Number(e.target.value)); invalidateEstimate(); }}
                className="w-16 bg-background border border-border/40 rounded-lg px-2 py-1 text-sm text-center" />
            </label>
            <select value={bookingType} onChange={(e) => { setBookingType(e.target.value); setBookingId(""); }} className="bg-background border border-border/40 rounded-lg px-2 py-1.5 text-xs">
              {BOOKING_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
          {bookingType && (
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
              <option value="">— اختر الحجز / الطلب —</option>
              {bookingOptions.map((b) => (
                <option key={b.id} value={b.id}>{b.label}{b.date ? ` · ${b.date}` : ""}</option>
              ))}
            </select>
          )}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات الإنتاج (اختياري)"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm resize-none" rows={2} />

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={planMode} onChange={(e) => setPlanMode(e.target.checked)} />
            حفظ كخطة فقط (بدون خصم المواد الآن — يمكن الإنتاج جزئياً لاحقاً)
          </label>
          {!planMode && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={postExpense} onChange={(e) => setPostExpense(e.target.checked)} />
              تسجيل قيد محاسبي (العمالة + المعدات كمصروف قيد الاعتماد)
            </label>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runEstimate} disabled={!items.length || estimating} className="flex-1">
              {estimating ? "جارٍ الحساب…" : "احسب التكلفة والربح"}
            </Button>
            <Button onClick={produce} disabled={!items.length || producing || (!planMode && estimate ? !estimate.stockOk : false)} className="flex-1">
              {producing ? "جارٍ الحفظ…" : planMode ? "حفظ الخطة" : "تنفيذ الإنتاج"}
            </Button>
          </div>
        </div>

        {/* Estimate preview */}
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">📊 التكلفة والربح المتوقع</h2>
          {!estimate ? (
            <div className="rounded-lg border border-dashed border-border/40 bg-background/40 p-6 text-center text-xs text-muted-foreground">
              اضغط «احسب التكلفة والربح» لعرض المواد المطلوبة والتكلفة الكاملة والربح قبل الإنتاج.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="مواد" value={formatCurrency(estimate.materialCost)} />
                <Stat label="عمالة" value={formatCurrency(estimate.laborCost)} />
                <Stat label="معدات" value={formatCurrency(estimate.equipmentCost)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="التكلفة الكلية" value={formatCurrency(estimate.totalCost)} />
                <Stat label="الإيراد" value={formatCurrency(estimate.expectedRevenue)} />
                <Stat label="الربح" value={formatCurrency(estimate.expectedProfit)} tone={estimate.expectedProfit >= 0 ? "ok" : "bad"} />
                <Stat label="الهامش" value={`${estimate.profitMargin.toFixed(1)}%`} tone={estimate.profitMargin >= 0 ? "ok" : "bad"} />
              </div>

              {estimate.stockOk ? (
                <div className="flex items-center gap-2 rounded-lg border border-status-success/30 bg-status-success/10 px-3 py-2 text-xs text-status-success">
                  <CheckCircle2 className="w-4 h-4" /> جميع المواد متوفرة — سيزيد مخزون المنتجات المصنّعة عند التنفيذ.
                </div>
              ) : (
                <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-status-danger">
                    <ShoppingCart className="w-4 h-4" /> قائمة الشراء — مواد ناقصة
                  </div>
                  <ul className="mt-2 space-y-1">
                    {estimate.shoppingList.map((s) => (
                      <li key={s.productId} className="flex items-center justify-between text-xs text-foreground">
                        <span>{s.name}</span>
                        <span className="text-status-danger font-medium">ناقص {s.missing} {s.unit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="max-h-56 overflow-y-auto rounded-lg border border-border/25 divide-y divide-border/20">
                {estimate.materials.map((m) => (
                  <div key={m.productId} className="flex items-center justify-between gap-2 p-2 text-xs">
                    <span className="text-foreground truncate flex items-center gap-1">
                      {m.missing > 0 && <AlertTriangle className="w-3 h-3 text-status-danger shrink-0" />}
                      {m.name}
                    </span>
                    <span className="text-muted-foreground shrink-0">يحتاج {m.required} {m.unit} · متوفر {m.available}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Orders history */}
      <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">📦 سجل أوامر الإنتاج</h2>
        {ordersLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : orders.length === 0 ? (
          <EmptyState message="لا توجد أوامر إنتاج بعد — ابدأ أول دفعة إنتاج من الأعلى." />
        ) : (
          <div className="space-y-2">
            {orders.map((order) => {
              const meta = STATUS_META[order.status] ?? STATUS_META.pending;
              const next = NEXT_STEP[order.status];
              const remaining = order.totalPlanned - order.totalProduced;
              const canProduce = remaining > 0 && order.status !== "cancelled";
              const pct = order.totalPlanned > 0 ? Math.round((order.totalProduced / order.totalPlanned) * 100) : 0;
              return (
                <div key={order.id} className="rounded-lg border border-border/25 bg-background/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-foreground">{order.orderNo}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.cls}`}>{meta.label}</span>
                        {order.approvedByName && <span className="inline-flex items-center gap-1 text-[10px] text-status-success"><BadgeCheck className="w-3 h-3" /> معتمد</span>}
                        {order.expenseId && <span className="text-[10px] text-muted-foreground">🧾 قيد #{order.expenseId}</span>}
                        {order.bookingType && <span className="text-[10px] text-muted-foreground">🔗 {order.bookingType}#{order.bookingId}</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{order.items.map((it) => `${it.name} ×${it.quantity}${it.produced > 0 && it.produced < it.quantity ? ` (مُنتَج ${it.produced})` : ""}`).join(" · ")}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        مواد {formatCurrency(order.materialCost)} · عمالة {formatCurrency(order.laborCost)} · معدات {formatCurrency(order.equipmentCost)} · التكلفة {formatCurrency(order.totalCost)} · الربح {formatCurrency(order.expectedProfit)}
                      </p>
                      {order.totalProduced < order.totalPlanned && order.totalProduced > 0 && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 max-w-[160px] rounded-full bg-muted/40 overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground">مُنتَج {order.totalProduced}/{order.totalPlanned}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {canProduce && (
                        <Button size="sm" onClick={() => setProduceTarget(order)}><Factory className="w-4 h-4 ml-1" /> إنتاج</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => printWorkOrder(order)} title="طباعة أمر شغل"><Printer className="w-4 h-4" /></Button>
                      {!order.approvedByName && order.status !== "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => approve(order)}><BadgeCheck className="w-4 h-4 ml-1" /> اعتماد</Button>
                      )}
                      {next && (
                        <Button size="sm" variant="outline" onClick={() => changeStatus(order, next.to)}><next.icon className="w-4 h-4 ml-1" /> {next.label}</Button>
                      )}
                      {order.status !== "cancelled" && order.status !== "delivered" && (
                        <Button size="sm" variant="ghost" className="text-status-danger" onClick={() => changeStatus(order, "cancelled")}>إلغاء</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-status-danger" onClick={() => remove(order)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Partial-produce modal */}
      {produceTarget && (
        <ProduceModal order={produceTarget} onClose={() => setProduceTarget(null)} onSubmit={(batch) => produceBatch(produceTarget.id, batch)} />
      )}

      {/* Product picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setPickerOpen(false)}>
          <div className="bg-card border border-border/40 rounded-2xl max-w-md w-full max-h-[80dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border/30">
              <h4 className="text-sm font-semibold text-foreground">اختر منتجاً للإنتاج</h4>
              <button type="button" onClick={() => setPickerOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 border-b border-border/30">
              <div className="relative">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input autoFocus value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="بحث…"
                  className="w-full bg-background border border-border/40 rounded-lg pr-9 pl-3 py-2 text-sm" />
              </div>
            </div>
            <div className="overflow-y-auto divide-y divide-border/20">
              {productsLoading ? (
                <div className="p-4 text-center text-xs text-muted-foreground">جارٍ التحميل…</div>
              ) : pickable.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">لا توجد منتجات مطابقة.</div>
              ) : pickable.map((p) => (
                <button key={p.id} type="button" onClick={() => addItem(p)}
                  className="w-full text-right p-3 hover:bg-primary/5 flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground truncate">{p.nameAr || p.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{formatCurrency(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProduceModal({ order, onClose, onSubmit }: { order: ProductionOrder; onClose: () => void; onSubmit: (batch: Array<{ productId: number; quantity: number }>) => void }) {
  const remainingItems = order.items.filter((it) => it.remaining > 0);
  const [qty, setQty] = useState<Record<number, number>>(() => Object.fromEntries(remainingItems.map((it) => [it.productId, it.remaining])));
  const total = Object.values(qty).reduce((s, q) => s + (Number(q) || 0), 0);
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-2xl max-w-md w-full max-h-[80dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-border/30">
          <h4 className="text-sm font-semibold text-foreground">إنتاج دفعة · {order.orderNo}</h4>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-2 overflow-y-auto">
          <p className="text-[11px] text-muted-foreground">حدّد الكمية المراد إنتاجها الآن (بحد أقصى المتبقّي). ستُخصم موادها ويزيد مخزون المنتج.</p>
          {remainingItems.map((it) => (
            <div key={it.productId} className="flex items-center gap-2 rounded-lg border border-border/25 bg-background/40 p-2">
              <span className="flex-1 min-w-0 truncate text-sm text-foreground">{it.name}</span>
              <span className="text-[10px] text-muted-foreground">متبقّي {it.remaining}</span>
              <input type="number" min={0} max={it.remaining} value={qty[it.productId] ?? 0}
                onChange={(e) => setQty((p) => ({ ...p, [it.productId]: Math.max(0, Math.min(it.remaining, Math.floor(Number(e.target.value) || 0))) }))}
                className="w-20 bg-background border border-border/40 rounded-lg px-2 py-1 text-sm text-center" />
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-border/30 flex items-center gap-2">
          <Button className="flex-1" disabled={total <= 0}
            onClick={() => onSubmit(remainingItems.map((it) => ({ productId: it.productId, quantity: qty[it.productId] ?? 0 })).filter((x) => x.quantity > 0))}>
            إنتاج {total > 0 ? `(${total})` : ""}
          </Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  const color = tone === "ok" ? "text-status-success" : tone === "bad" ? "text-status-danger" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/30 bg-background/40 p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}
