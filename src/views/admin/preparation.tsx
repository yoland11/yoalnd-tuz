import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList,
  Loader2, Package, PackageSearch, Search, ShoppingCart, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Rollup = { total: number; ready: number; preparing: number; shortage: number; needsPurchase: number; completed: number; progress: number };
type PrepCard = { source: "service" | "kosha"; id: number; number: string; customerName: string; eventDate: string | null; location: string | null; departments: string[]; rollup: Rollup };
type PrepList = { cards: PrepCard[]; summary: { bookings: number; totalItems: number; ready: number; preparing: number; shortage: number; needsPurchase: number; completed: number } };
type PrepItem = {
  key: string; kind: "product" | "asset"; productId: number | null; name: string; sku: string | null; department: string;
  required: number; totalStock: number; reservedByOthers: number; available: number; shortfall: number; status: string;
  assigneeName: string | null; priority: string; deadline: string | null; note: string | null; evidenceCount: number;
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

function PreparationDetail({ card }: { card: PrepCard }) {
  const detail = useQuery<PrepDetail>({
    queryKey: ["admin", "preparation-detail", card.source, card.id],
    queryFn: () => adminFetch(`/admin/booking-operations/${card.source}/${card.id}/preparation`),
    staleTime: 15_000,
  });
  if (detail.isLoading) return <div className="p-3"><Skeleton className="h-24 w-full" /></div>;
  if (detail.isError) return <p className="p-3 text-xs text-status-danger">تعذّر تحميل عناصر التجهيز.</p>;
  const items = detail.data?.items ?? [];
  if (!items.length) return <p className="p-3 text-xs text-muted-foreground">لا توجد عناصر تجهيز مرتبطة بهذا الحجز.</p>;
  // Separate by department (§3).
  const groups = new Map<string, PrepItem[]>();
  for (const item of items) { if (!groups.has(item.department)) groups.set(item.department, []); groups.get(item.department)!.push(item); }
  return (
    <div className="space-y-3 border-t border-border/30 bg-background/30 p-3">
      {[...groups.entries()].map(([dept, deptItems]) => (
        <div key={dept}>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold text-primary"><Package className="h-3.5 w-3.5" /> {deptLabel(dept)} <span className="text-muted-foreground">({deptItems.length})</span></div>
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full min-w-[640px] text-right text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>{["العنصر", "مطلوب", "متاح", "محجوز لآخرين", "الحالة", "المسؤول", "ملاحظات"].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {deptItems.map((item) => (
                  <tr key={item.key} className="border-t border-border/20">
                    <td className="p-2"><div className="font-medium text-foreground">{item.name}</div>{item.sku ? <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{item.sku}</div> : null}</td>
                    <td className="p-2 tabular-nums">{item.required}</td>
                    <td className="p-2 tabular-nums">{item.available}</td>
                    <td className="p-2 tabular-nums text-muted-foreground">{item.reservedByOthers}</td>
                    <td className="p-2"><StatusBadge status={item.status} />{item.shortfall > 0 ? <span className="mr-1 text-[11px] text-status-danger">({item.shortfall})</span> : null}</td>
                    <td className="p-2">{item.assigneeName || "—"}</td>
                    <td className="p-2 text-muted-foreground">{item.note || "—"}</td>
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
                  <Button size="sm" variant="ghost" className="text-muted-foreground" asChild><Link href={`/admin/bookings/${card.source}/${card.id}?tab=products`}><UserRound className="h-3.5 w-3.5" /> تعيين موظف</Link></Button>
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
