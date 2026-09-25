import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  AlertTriangle, Boxes, CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList,
  Loader2, Package, PackageSearch, Plus, Printer, Search, ShoppingCart, Trash2, UserRound, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Rollup = { total: number; ready: number; preparing: number; shortage: number; needsPurchase: number; completed: number; progress: number };
type PrepCard = { source: "service" | "kosha"; id: number; number: string; customerName: string; eventDate: string | null; location: string | null; departments: string[]; rollup: Rollup };
type PrepList = { cards: PrepCard[]; summary: { bookings: number; totalItems: number; ready: number; preparing: number; shortage: number; needsPurchase: number; completed: number } };
type PrepItem = {
  key: string; kind: "product" | "asset" | "manual"; productId: number | null; name: string; sku: string | null; department: string;
  required: number; totalStock: number; reservedByOthers: number; available: number; shortfall: number; status: string;
  assigneeName: string | null; priority: string; deadline: string | null; note: string | null; purchaseRequested: boolean; evidenceCount: number;
  manual?: boolean; infoOnly?: boolean;
};
type PrepDetail = { source: string; id: number; items: PrepItem[]; rollup: Rollup };

const DEPT: Record<string, string> = {
  kosha: "الكوشات", lighting: "الإضاءة", sound: "الصوتيات", photography: "التصوير", flowers: "الزهور",
  gifts: "الهدايا والتوزيعات", graduation: "تجهيزات التخرج", invitations: "الدعوات", transport: "النقل", equipment: "المعدات", other: "أخرى",
};
const deptLabel = (value: string) => DEPT[value] ?? value;

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ready: { label: "جاهز", color: "#065f46", bg: "#d1fae5" },
  preparing: { label: "قيد التجهيز", color: "#92400e", bg: "#fef3c7" },
  shortage: { label: "ناقص", color: "#991b1b", bg: "#fee2e2" },
  needs_purchase: { label: "يحتاج شراء", color: "#9a3412", bg: "#ffedd5" },
  reserved_elsewhere: { label: "محجوز لحجز آخر", color: "#92400e", bg: "#fef3c7" },
  damaged: { label: "تالف", color: "#991b1b", bg: "#fee2e2" },
  lost: { label: "مفقود", color: "#991b1b", bg: "#fee2e2" },
  unavailable: { label: "غير متوفر", color: "#6b7280", bg: "#f3f4f6" },
  note: { label: "للعلم", color: "#3730a3", bg: "#e0e7ff" },
  completed: { label: "مكتمل", color: "#065f46", bg: "#d1fae5" },
};
function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.unavailable;
  return <span style={{ display: "inline-block", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700, color: meta.color, background: meta.bg }}>{meta.label}</span>;
}

function cardStatus(r: Rollup): { label: string; tone: "green" | "amber" | "red" | "muted" } {
  if (r.total === 0) return { label: "لا عناصر", tone: "muted" };
  if (r.needsPurchase > 0) return { label: "يحتاج شراء", tone: "red" };
  if (r.shortage > 0) return { label: "ناقص", tone: "red" };
  if (r.completed === r.total) return { label: "مكتمل", tone: "green" };
  if (r.ready + r.completed === r.total) return { label: "جاهز", tone: "green" };
  return { label: "قيد التجهيز", tone: "amber" };
}
const toneColor: Record<string, string> = { green: "#059669", amber: "#d97706", red: "#dc2626", muted: "#6b7280" };

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const MANUAL_STATUS_OPTIONS: Array<[string, string]> = [
  ["preparing", "قيد التجهيز"],
  ["ready", "جاهز"],
  ["completed", "مكتمل"],
];

function PreparationDetail({ card }: { card: PrepCard }) {
  const queryClient = useQueryClient();
  const base = `/admin/booking-operations/${card.source}/${card.id}`;
  const detail = useQuery<PrepDetail>({
    queryKey: ["admin", "preparation-detail", card.source, card.id],
    queryFn: () => adminFetch(`${base}/preparation`),
    staleTime: 10_000,
  });
  const staff = useQuery<{ eligibleStaff: Array<{ id: number; name: string }> }>({
    queryKey: ["admin", "preparation-staff", card.source, card.id],
    queryFn: () => adminFetch(`${base}/staff-assignment`).catch(() => ({ eligibleStaff: [] })),
    staleTime: 60_000,
  });
  const staffList = staff.data?.eligibleStaff ?? [];
  const staffName = (id: number) => staffList.find((s) => s.id === id)?.name ?? "";
  const [selected, setSelected] = useState<string[]>([]);

  const refresh = () => { void detail.refetch(); queryClient.invalidateQueries({ queryKey: ["admin", "preparation"] }); };
  const update = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminFetch(`${base}/preparation`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: refresh,
    onError: () => toast.error("تعذّر تحديث العنصر"),
  });
  const bulk = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminFetch(`${base}/preparation`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { setSelected([]); refresh(); toast.success("تم التحديث الجماعي"); },
    onError: () => toast.error("تعذّر التحديث الجماعي"),
  });
  const addItem = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminFetch(`${base}/preparation`, { method: "POST", body: JSON.stringify({ action: "add-manual", ...payload }) }),
    onSuccess: () => { setShowAdd(false); refresh(); toast.success("تمت إضافة العنصر"); },
    onError: () => toast.error("تعذّرت إضافة العنصر"),
  });
  const removeItem = useMutation({
    mutationFn: (key: string) => adminFetch(`${base}/preparation`, { method: "DELETE", body: JSON.stringify({ key }) }),
    onSuccess: () => { refresh(); toast.success("تم حذف العنصر"); },
    onError: () => toast.error("تعذّر حذف العنصر"),
  });
  const [showAdd, setShowAdd] = useState(false);

  if (detail.isLoading) return <div className="p-3"><Skeleton className="h-24 w-full" /></div>;
  if (detail.isError) return <p className="p-3 text-xs text-status-danger">تعذّر تحميل عناصر التجهيز.</p>;
  const items = detail.data?.items ?? [];
  const groups = new Map<string, PrepItem[]>();
  for (const item of items) { if (!groups.has(item.department)) groups.set(item.department, []); groups.get(item.department)!.push(item); }
  const toggle = (key: string) => setSelected((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  const cell = "rounded-md border border-border/40 bg-background px-2 py-1 text-xs";

  return (
    <div className="space-y-3 border-t border-border/30 bg-background/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary"><ClipboardList className="h-3.5 w-3.5" /> عناصر التجهيز <span className="text-muted-foreground">({items.length})</span></div>
        <Button size="sm" variant={showAdd ? "secondary" : "outline"} onClick={() => setShowAdd((v) => !v)}>{showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? "إغلاق" : "إضافة عنصر"}</Button>
      </div>
      {showAdd ? <AddPrepItemForm busy={addItem.isPending} onSubmit={(payload) => addItem.mutate(payload)} /> : null}
      {items.length === 0 ? <p className="rounded-lg border border-dashed border-border/40 p-4 text-center text-xs text-muted-foreground">لا توجد عناصر تجهيز بعد. أضِف عنصرًا من زر «إضافة عنصر» — من منتج، أصل، أو مجرد ملاحظة للعلم.</p> : null}
      {selected.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <strong>تم تحديد {selected.length}</strong>
          <select defaultValue="" className={cell} disabled={bulk.isPending} onChange={(e) => { if (e.target.value) bulk.mutate({ keys: selected, status: e.target.value }); e.target.value = ""; }}>
            <option value="">تغيير الحالة…</option>{MANUAL_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select defaultValue="" className={cell} disabled={bulk.isPending || !staffList.length} onChange={(e) => { const id = Number(e.target.value); if (id) bulk.mutate({ keys: selected, assigneeId: id, assigneeName: staffName(id) }); e.target.value = ""; }}>
            <option value="">تعيين موظف…</option>{staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>إلغاء التحديد</Button>
        </div>
      ) : null}
      {[...groups.entries()].map(([dept, deptItems]) => (
        <div key={dept}>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold text-primary"><Package className="h-3.5 w-3.5" /> {deptLabel(dept)} <span className="text-muted-foreground">({deptItems.length})</span></div>
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full min-w-[760px] text-right text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr><th className="w-8 p-2"></th>{["العنصر", "مطلوب", "متاح", "الحالة", "الحالة يدويًا", "المسؤول"].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {deptItems.map((item) => (
                  <tr key={item.key} className="border-t border-border/20">
                    <td className="p-2">{item.infoOnly ? null : <input type="checkbox" checked={selected.includes(item.key)} onChange={() => toggle(item.key)} aria-label={`تحديد ${item.name}`} />}</td>
                    <td className="p-2"><div className="flex items-center gap-1.5"><span className="font-medium text-foreground">{item.name}</span>{item.manual ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0 text-[9px] font-bold text-primary">{item.infoOnly ? "للعلم" : "يدوي"}</span> : null}</div>{item.sku ? <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{item.sku}</div> : null}{item.note ? <div className="mt-0.5 text-[10px] text-muted-foreground">{item.note}</div> : null}</td>
                    <td className="p-2 tabular-nums">{item.required}</td>
                    <td className="p-2 tabular-nums">{item.manual ? <span className="text-muted-foreground">—</span> : <>{item.available}<span className="text-muted-foreground"> / {item.totalStock}</span></>}</td>
                    <td className="p-2">
                      <StatusBadge status={item.status} />{item.shortfall > 0 ? <span className="mr-1 text-[11px] text-status-danger">({item.shortfall})</span> : null}
                      {(item.status === "needs_purchase" || item.status === "shortage") ? (
                        item.purchaseRequested ? (
                          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"><ShoppingCart className="h-2.5 w-2.5" /> طلب شراء قيد المعالجة</div>
                        ) : (
                          <button type="button" disabled={update.isPending} onClick={() => { update.mutate({ key: item.key, itemName: item.name, purchaseRequested: true }); window.open("/admin/inventory-alerts", "_blank", "noopener"); }} className="mt-1 flex items-center gap-1 rounded-md border border-orange-400 px-2 py-0.5 text-[11px] font-semibold text-orange-700"><ShoppingCart className="h-3 w-3" /> طلب شراء</button>
                        )
                      ) : null}
                    </td>
                    <td className="p-2">
                      <select value={MANUAL_STATUS_OPTIONS.some(([v]) => v === item.status) ? item.status : ""} className={cell} disabled={update.isPending} onChange={(e) => e.target.value && update.mutate({ key: item.key, itemName: item.name, department: item.department, status: e.target.value })}>
                        <option value="">تلقائي</option>{MANUAL_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        <select value={item.assigneeName && staffList.find((s) => s.name === item.assigneeName)?.id ? String(staffList.find((s) => s.name === item.assigneeName)!.id) : ""} className={`${cell} min-w-0 flex-1`} disabled={update.isPending || !staffList.length} onChange={(e) => { const id = Number(e.target.value); update.mutate({ key: item.key, itemName: item.name, department: item.department, assigneeId: id || null, assigneeName: id ? staffName(id) : null }); }}>
                          <option value="">{item.assigneeName || "بدون"}</option>{staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {item.manual ? <button type="button" title="حذف العنصر" aria-label="حذف العنصر" disabled={removeItem.isPending} onClick={() => removeItem.mutate(item.key)} className="shrink-0 rounded-md border border-border/40 p-1 text-status-danger hover:bg-status-danger/10"><Trash2 className="h-3.5 w-3.5" /></button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

const DEPT_OPTIONS = Object.entries(DEPT);

function AddPrepItemForm({ busy, onSubmit }: { busy: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [source, setSource] = useState<"custom" | "product" | "asset">("custom");
  const [name, setName] = useState("");
  const [sku, setSku] = useState<string | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [department, setDepartment] = useState("other");
  const [quantity, setQuantity] = useState("1");
  const [infoOnly, setInfoOnly] = useState(false);
  const [search, setSearch] = useState("");
  const inputCls = "w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs";

  const products = useQuery<any[]>({
    queryKey: ["admin", "products", "prep-picker"],
    queryFn: () => adminFetch("/admin/products?limit=2000"),
    enabled: source !== "custom",
    staleTime: 60_000,
  });
  const candidates = useMemo(() => {
    if (source === "custom") return [] as any[];
    const q = search.trim().toLowerCase();
    return (products.data ?? [])
      .filter((p) => p?.isActive !== false && !p?.archivedAt)
      .filter((p) => Boolean(p?.isAsset) === (source === "asset"))
      .filter((p) => !q || [p.nameAr, p.name, p.barcode].some((v: unknown) => String(v ?? "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [products.data, search, source]);

  const pick = (p: any) => { setProductId(Number(p.id)); setName(p.nameAr || p.name || `#${p.id}`); setSku(p.barcode ?? null); };
  const chooseSource = (next: "custom" | "product" | "asset") => { setSource(next); setProductId(null); setSku(null); if (next === "custom") setName(""); };
  const submit = () => {
    if (!name.trim()) { toast.error("أدخل اسم العنصر"); return; }
    onSubmit({ name: name.trim(), department, quantity: Math.max(1, Number(quantity) || 1), source, productId: source === "custom" ? null : productId, sku, infoOnly });
  };

  const sources: Array<[typeof source, string, typeof Package]> = [["custom", "من عندي", Plus], ["product", "من المنتجات", Package], ["asset", "من الأصول", Boxes]];
  return (
    <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="مصدر العنصر">
        {sources.map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => chooseSource(value)} className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-semibold transition ${source === value ? "border-primary bg-primary text-primary-foreground" : "border-border/50 bg-background text-muted-foreground hover:border-primary/50"}`}><Icon className="h-3.5 w-3.5" />{label}</button>
        ))}
      </div>
      {source !== "custom" ? (
        <div className="space-y-1.5">
          <label className="relative block"><Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={source === "asset" ? "ابحث في الأصول…" : "ابحث في المنتجات…"} className={`${inputCls} pr-8`} /></label>
          {products.isLoading ? <p className="px-1 text-[11px] text-muted-foreground">جارٍ التحميل…</p> : candidates.length ? (
            <div className="max-h-36 overflow-y-auto rounded-md border border-border/40 bg-background">
              {candidates.map((p) => (
                <button key={p.id} type="button" onClick={() => pick(p)} className={`flex w-full items-center justify-between gap-2 border-b border-border/20 px-2.5 py-1.5 text-right text-xs last:border-b-0 hover:bg-primary/5 ${productId === Number(p.id) ? "bg-primary/10" : ""}`}>
                  <span className="min-w-0 truncate font-medium">{p.nameAr || p.name}</span>{p.barcode ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground" dir="ltr">{p.barcode}</span> : null}
                </button>
              ))}
            </div>
          ) : <p className="px-1 text-[11px] text-muted-foreground">{search ? "لا نتائج مطابقة." : `اكتب للبحث في ${source === "asset" ? "الأصول" : "المنتجات"}.`}</p>}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-[11px] text-muted-foreground">اسم العنصر</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: طاولة استقبال" className={inputCls} /></label>
        <label className="space-y-1"><span className="text-[11px] text-muted-foreground">القسم</span><select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls}>{DEPT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="space-y-1"><span className="text-[11px] text-muted-foreground">الكمية</span><input type="number" min="1" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} /></label>
        <label className="flex cursor-pointer items-center gap-2 self-end rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs"><input type="checkbox" checked={infoOnly} onChange={(e) => setInfoOnly(e.target.checked)} className="h-3.5 w-3.5 accent-primary" /><span>بس للعلم <span className="text-muted-foreground">(لا يُحتسب بالتقدم)</span></span></label>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={busy} onClick={submit}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} إضافة للقائمة</Button>
      </div>
    </div>
  );
}

export default function PreparationPage() {
  const query = useQuery<PrepList>({ queryKey: ["admin", "preparation"], queryFn: () => adminFetch("/admin/preparation"), staleTime: 15_000 });
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [quick, setQuick] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const cards = query.data?.cards ?? [];
  const summary = query.data?.summary;
  const departments = useMemo(() => [...new Set(cards.flatMap((c) => c.departments))], [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayStr();
    const tomorrow = addDays(1);
    const weekEnd = addDays(7);
    return cards.filter((card) => {
      if (q && ![card.number, card.customerName, card.location ?? ""].join(" ").toLowerCase().includes(q)) return false;
      if (department && !card.departments.includes(department)) return false;
      if (quick === "today" && card.eventDate?.slice(0, 10) !== today) return false;
      if (quick === "tomorrow" && card.eventDate?.slice(0, 10) !== tomorrow) return false;
      if (quick === "week" && !(card.eventDate && card.eventDate.slice(0, 10) >= today && card.eventDate.slice(0, 10) <= weekEnd)) return false;
      if (quick === "overdue" && !(card.eventDate && card.eventDate.slice(0, 10) < today && card.rollup.progress < 100)) return false;
      if (quick === "shortage" && !(card.rollup.shortage > 0 || card.rollup.needsPurchase > 0)) return false;
      if (quick === "ready" && card.rollup.progress !== 100) return false;
      return true;
    });
  }, [cards, search, department, quick]);

  const [printingId, setPrintingId] = useState<string | null>(null);
  async function printCard(card: PrepCard) {
    const cardKey = `${card.source}-${card.id}`;
    setPrintingId(cardKey);
    try {
      const detail = await adminFetch<PrepDetail>(`/admin/booking-operations/${card.source}/${card.id}/preparation`);
      const items = detail.items ?? [];
      const columns: ReportColumn<PrepItem>[] = [
        { key: "department", header: "القسم", width: 12, priority: "high", value: (r) => deptLabel(r.department) },
        { key: "name", header: "العنصر", width: 20, priority: "high" },
        { key: "required", header: "الكمية", width: 8, kind: "number", align: "center", priority: "high" },
        { key: "available", header: "المتاح", width: 8, kind: "number", align: "center", priority: "medium" },
        { key: "status", header: "الحالة", width: 12, align: "center", priority: "high", value: (r) => STATUS_META[r.status]?.label ?? r.status },
        { key: "assigneeName", header: "المسؤول", width: 12, priority: "medium", value: (r) => r.assigneeName || "—" },
        { key: "note", header: "ملاحظات", width: 16, priority: "low", value: (r) => r.note || "" },
      ];
      const rollup = detail.rollup;
      await exportReport<PrepItem>({
        options: {
          title: "قائمة تجهيز الحجز",
          subtitle: `${card.number} · ${card.customerName}${card.location ? ` · ${card.location}` : ""}`,
          orientation: "landscape",
          meta: [{ label: "تاريخ المناسبة", value: card.eventDate?.slice(0, 10) || "—" }],
          footerNote: `العناصر: ${rollup.total} · جاهز: ${rollup.ready + rollup.completed} · ناقص: ${rollup.shortage} · يحتاج شراء: ${rollup.needsPurchase} · قائمة تجهيز · نظام AJN`,
          emptyText: "لا توجد عناصر تجهيز مرتبطة بهذا الحجز",
        },
        columns,
        rows: items,
        filename: `قائمة-تجهيز-${card.number}.pdf`,
        mode: "print",
      });
    } catch {
      toast.error("تعذّرت الطباعة");
    } finally {
      setPrintingId(null);
    }
  }

  const cardsList: Array<[string, string | number, string, typeof Package]> = [
    ["إجمالي التجهيزات", summary?.totalItems ?? 0, "#111827", ClipboardList],
    ["جاهز", summary?.ready ?? 0, "#059669", CheckCircle2],
    ["قيد التجهيز", summary?.preparing ?? 0, "#d97706", Loader2],
    ["ناقص", summary?.shortage ?? 0, "#dc2626", AlertTriangle],
    ["يحتاج شراء", summary?.needsPurchase ?? 0, "#ea580c", ShoppingCart],
    ["مكتمل", summary?.completed ?? 0, "#059669", ClipboardCheck],
  ];
  const quickFilters: Array<[string, string]> = [
    ["today", "اليوم"], ["tomorrow", "غداً"], ["week", "هذا الأسبوع"], ["overdue", "متأخر"], ["shortage", "ناقص"], ["ready", "جاهز"],
  ];

  return (
    <div dir="rtl" className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><PackageSearch className="h-6 w-6 text-primary" /> قائمة التجهيز</h1>
        <p className="mt-1 text-sm text-muted-foreground">متابعة وتجهيز جميع متطلبات الحجوزات قبل التنفيذ</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cardsList.map(([label, value, color, Icon]) => (
          <div key={label} className="rounded-2xl border border-border/40 bg-card p-3">
            <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{label}</p><Icon className="h-4 w-4" style={{ color }} /></div>
            <p className="mt-1 text-2xl font-bold" style={{ color }}>{query.isLoading ? "…" : value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="relative block"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="البحث عن حجز أو زبون…" className="w-full rounded-lg border border-border/40 bg-background py-2 pr-10 pl-3 text-sm" /></label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">كل الأقسام</option>{departments.map((d) => <option key={d} value={d}>{deptLabel(d)}</option>)}</select>
          <div className="flex items-center text-xs text-muted-foreground">{filtered.length} من {cards.length} حجز</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {quickFilters.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setQuick(quick === value ? "" : value)} className={`rounded-full border px-3 py-1.5 text-xs transition ${quick === value ? "border-primary bg-primary text-primary-foreground" : "border-border/50 bg-background text-muted-foreground hover:border-primary/50"}`}>{label}</button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}</div>
      ) : !filtered.length ? (
        <EmptyState message="لا توجد حجوزات مطابقة للتجهيز" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((card) => {
            const cardKey = `${card.source}-${card.id}`;
            const status = cardStatus(card.rollup);
            const done = card.rollup.ready + card.rollup.completed;
            return (
              <article key={cardKey} className="flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-card">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">{card.number}</div>
                      <h3 className="mt-0.5 text-base font-bold text-foreground">{card.customerName}</h3>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" /> {card.eventDate?.slice(0, 10) || "الموعد غير محدد"}{card.location ? ` · ${card.location}` : ""}</p>
                    </div>
                    <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700, color: "#fff", background: toneColor[status.tone] }}>{status.label}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">{card.departments.map((d) => <span key={d} className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">{deptLabel(d)}</span>)}</div>
                  <div className="mt-3">
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full transition-[width]" style={{ width: `${card.rollup.progress}%`, background: toneColor[status.tone] }} /></div>
                    <p className="mt-1 text-xs text-muted-foreground">{done} من {card.rollup.total} عنصر جاهز · {card.rollup.progress}%</p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/30 p-3">
                  <Button size="sm" variant="outline" onClick={() => setExpanded(expanded === cardKey ? null : cardKey)}><ChevronDown className={`h-3.5 w-3.5 transition ${expanded === cardKey ? "rotate-180" : ""}`} /> عرض التجهيز</Button>
                  <Button size="sm" variant="ghost" asChild><Link href={`/admin/bookings/${card.source}/${card.id}`}>فتح الحجز</Link></Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setExpanded(expanded === cardKey ? null : cardKey)}><UserRound className="h-3.5 w-3.5" /> تعيين موظف</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={printingId === cardKey} onClick={() => printCard(card)}><Printer className="h-3.5 w-3.5" /> طباعة</Button>
                </div>
                {expanded === cardKey ? <PreparationDetail card={card} /> : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
