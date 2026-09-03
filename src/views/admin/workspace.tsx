import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, GripVertical, Maximize2, Pin, Plus, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, type AdminMe } from "./_lib";
import { NAV, canSeeItem } from "./_layout";

type CardSize = "sm" | "md" | "lg";
type WorkspaceItem = { key: string; size: CardSize };

const SIZE_LABEL: Record<CardSize, string> = { sm: "صغير", md: "متوسط", lg: "كبير" };
const SIZE_SPAN: Record<CardSize, string> = {
  sm: "col-span-1",
  md: "col-span-1",
  lg: "col-span-2 md:col-span-3 lg:col-span-4",
};
const nextSize = (s: CardSize): CardSize => (s === "sm" ? "md" : s === "md" ? "lg" : "sm");

// Sensible starter layout for brand-new users with no saved/default workspace.
const SEED_HREFS = [
  "/admin/dashboard", "/admin/command-center", "/admin/notifications", "/admin/kosha-bookings",
  "/admin/orders", "/admin/finance/master-cash", "/admin/products", "/admin/reports",
];

const WORKSPACE_TONES: Record<string, { halo: string; icon: string; arrow: string }> = {
  "/admin/kosha-bookings": { halo: "bg-orange-50", icon: "bg-orange-100 text-orange-600", arrow: "border-orange-100 bg-orange-50 text-orange-600" },
  "/admin/finance/master-cash": { halo: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-700", arrow: "border-emerald-100 bg-emerald-50 text-emerald-700" },
  "/admin/sales": { halo: "bg-violet-50", icon: "bg-violet-100 text-violet-700", arrow: "border-violet-100 bg-violet-50 text-violet-700" },
  "/admin/expenses": { halo: "bg-rose-50", icon: "bg-rose-100 text-rose-600", arrow: "border-rose-100 bg-rose-50 text-rose-600" },
  "/admin/products": { halo: "bg-blue-50", icon: "bg-blue-100 text-blue-700", arrow: "border-blue-100 bg-blue-50 text-blue-700" },
  "/admin/tasks": { halo: "bg-cyan-50", icon: "bg-cyan-100 text-cyan-700", arrow: "border-cyan-100 bg-cyan-50 text-cyan-700" },
};

const workspaceTone = (href: string) => WORKSPACE_TONES[href] ?? { halo: "bg-slate-50", icon: "bg-slate-100 text-slate-700", arrow: "border-slate-100 bg-slate-50 text-slate-700" };

export default function WorkspacePage({ me }: { me: AdminMe }) {
  const { toast } = useToast();
  const isManager = me.role === "admin" || me.role === "manager";

  // Module registry — reuse the sidebar NAV (routes + icons + permissions). Only
  // internal pages the current user is allowed to see.
  const modules = useMemo(
    () => NAV.filter((item) => !item.external && canSeeItem(me, item)).map((item) => ({ href: item.href, label: item.label, icon: item.icon })),
    [me],
  );
  const byHref = useMemo(() => new Map(modules.map((m) => [m.href, m])), [modules]);

  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [customizing, setCustomizing] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useQuery<{ items: WorkspaceItem[]; source: string }>({
    queryKey: ["admin", "workspace"],
    queryFn: () => adminFetch("/admin/workspace"),
  });

  // Initialise once from the server (user layout → manager default → seed).
  useEffect(() => {
    if (!data || loadedRef.current) return;
    loadedRef.current = true;
    const valid = (data.items ?? []).filter((it) => byHref.has(it.key));
    if (valid.length) setItems(valid);
    else setItems(SEED_HREFS.filter((h) => byHref.has(h)).map((h) => ({ key: h, size: "md" as CardSize })));
  }, [data, byHref]);

  // Auto-save (debounced) after the initial load.
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void adminFetch("/admin/workspace", { method: "PUT", body: JSON.stringify({ items }) }).catch(() => {});
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [items]);

  const pinnedKeys = new Set(items.map((i) => i.key));
  const pin = (href: string) => setItems((prev) => (prev.some((i) => i.key === href) ? prev : [...prev, { key: href, size: "md" }]));
  const unpin = (href: string) => setItems((prev) => prev.filter((i) => i.key !== href));
  const cycleSize = (href: string) => setItems((prev) => prev.map((i) => (i.key === href ? { ...i, size: nextSize(i.size) } : i)));
  const reorder = (from: string, to: string) => {
    if (from === to) return;
    setItems((prev) => {
      const arr = [...prev];
      const fi = arr.findIndex((i) => i.key === from);
      const ti = arr.findIndex((i) => i.key === to);
      if (fi < 0 || ti < 0) return prev;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
  };

  async function saveAsDefault() {
    try {
      await adminFetch("/admin/workspace/default", { method: "PUT", body: JSON.stringify({ items }) });
      toast({ title: "تم حفظ الواجهة الافتراضية للموظفين الجدد" });
    } catch {
      toast({ title: "تعذّر الحفظ", variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-7 pb-8" dir="rtl">
      <header className="flex flex-col gap-5 border-b border-border/55 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="order-2 text-right sm:order-1">
          <h1 className="flex items-center justify-end gap-2 text-3xl font-bold tracking-tight text-foreground"><Sparkles className="h-7 w-7 text-amber-500" /> مساحة العمل</h1>
          <p className="mt-2 text-sm text-muted-foreground">اختر الأقسام التي ترتبط بعملك اليومي. تُحفظ اختياراتك تلقائياً لك وحدك.</p>
        </div>
        <div className="order-1 flex flex-wrap gap-2 sm:order-2">
          {isManager && <Button size="sm" variant="outline" onClick={saveAsDefault} className="h-11 rounded-xl border-border/60 bg-background px-4 shadow-sm"><Pin className="h-4 w-4" /> حفظ كافتراضي</Button>}
          <Button size="sm" onClick={() => setCustomizing((current) => !current)} className="h-11 rounded-xl px-4 shadow-sm"><Settings2 className="h-4 w-4" /> {customizing ? "إنهاء التخصيص" : "تخصيص الواجهة"}</Button>
        </div>
      </header>

      <div className={`grid gap-5 ${customizing ? "xl:grid-cols-[minmax(0,1fr)_300px]" : "grid-cols-1"}`}>
        {/* Pinned modules grid */}
        <div>
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 p-10 text-center text-sm text-muted-foreground">
              لا توجد أقسام مثبّتة بعد. اضغط «تخصيص الواجهة» لإضافة أقسامك المفضّلة.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((it) => {
                const mod = byHref.get(it.key);
                if (!mod) return null;
                const Icon = mod.icon;
                const big = it.size === "lg";
                const tone = workspaceTone(it.key);
                return (
                  <div
                    key={it.key}
                    draggable={customizing}
                    onDragStart={() => setDragKey(it.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragKey) reorder(dragKey, it.key); setDragKey(null); }}
                    className={`group relative min-h-[290px] overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-[0_4px_14px_rgba(16,24,40,0.04)] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/35 ${SIZE_SPAN[it.size]} ${dragKey === it.key ? "opacity-50" : ""} ${big ? "sm:min-h-[330px]" : ""}`}
                  >
                    {customizing ? <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border/50 bg-background/95 p-1 shadow-sm">
                      <button type="button" onClick={() => cycleSize(it.key)} title={`الحجم: ${SIZE_LABEL[it.size]}`} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Maximize2 className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => unpin(it.key)} title="إلغاء التثبيت" className="grid h-7 w-7 place-items-center rounded-md text-destructive hover:bg-destructive/10"><X className="h-3.5 w-3.5" /></button>
                      <span className="grid h-7 w-7 cursor-grab place-items-center rounded-md text-muted-foreground" title="اسحب لإعادة الترتيب"><GripVertical className="h-3.5 w-3.5" /></span>
                    </div> : null}
                    <Link href={mod.href} className="flex h-full flex-col items-center text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      <span className={`grid place-items-center rounded-full ${tone.halo} ${big ? "h-40 w-40" : "h-32 w-32"}`}>
                        <span className={`grid place-items-center rounded-[1.35rem] shadow-sm ${tone.icon} ${big ? "h-20 w-20" : "h-16 w-16"}`}><Icon className={big ? "h-10 w-10" : "h-8 w-8"} /></span>
                      </span>
                      <span className={`mt-5 font-bold text-foreground ${big ? "text-xl" : "text-lg"}`}>{mod.label}</span>
                      <span className="mt-2 max-w-[22ch] text-sm leading-6 text-muted-foreground">افتح إدارة {mod.label} وتابع العمليات المرتبطة بها.</span>
                      <span className={`mt-auto grid h-10 w-10 place-items-center rounded-full border ${tone.arrow}`}><ArrowLeft className="h-4 w-4" /></span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Customize panel */}
        {customizing && (
          <aside className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_4px_14px_rgba(16,24,40,0.04)] xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">الأقسام المتاحة</h2>
              <button type="button" onClick={() => setCustomizing(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">اختر الأقسام التي تريد ظهورها في واجهتك.</p>
            <div className="space-y-1.5">
              {modules.map((m) => {
                const Icon = m.icon;
                const pinned = pinnedKeys.has(m.href);
                return (
                  <button
                    key={m.href}
                    type="button"
                    onClick={() => (pinned ? unpin(m.href) : pin(m.href))}
                    className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-right transition-colors ${pinned ? "border-primary/40 bg-primary/5" : "border-border/40 hover:border-primary/30"}`}
                  >
                    <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{m.label}</span>
                    <span className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-full ${pinned ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {pinned ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
