import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Check, GripVertical, Maximize2, Pin, Plus, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, type AdminMe } from "./_lib";
import { NAV, canSeeItem } from "./_layout";

type CardSize = "sm" | "md" | "lg";
type WorkspaceItem = { key: string; size: CardSize };

const SIZE_LABEL: Record<CardSize, string> = { sm: "صغير", md: "متوسط", lg: "كبير" };
const SIZE_SPAN: Record<CardSize, string> = {
  sm: "col-span-1",
  md: "col-span-2",
  lg: "col-span-2 md:col-span-3 lg:col-span-4",
};
const nextSize = (s: CardSize): CardSize => (s === "sm" ? "md" : s === "md" ? "lg" : "sm");

// Sensible starter layout for brand-new users with no saved/default workspace.
const SEED_HREFS = [
  "/admin/dashboard", "/admin/command-center", "/admin/notifications", "/admin/kosha-bookings",
  "/admin/orders", "/admin/finance/master-cash", "/admin/products", "/admin/reports",
];

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
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Sparkles className="h-6 w-6 text-amber-500" /> مساحة العمل</h1>
          <p className="mt-1 text-sm text-muted-foreground">اختر الأقسام التي تريدها في صفحتك الرئيسية. تُحفظ تلقائياً لك وحدك.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager && <Button size="sm" variant="outline" onClick={saveAsDefault} className="gap-1.5"><Pin className="h-4 w-4" /> حفظ كافتراضي</Button>}
          <Button size="sm" onClick={() => setCustomizing((c) => !c)} className="gap-1.5"><Settings2 className="h-4 w-4" /> تخصيص الواجهة</Button>
        </div>
      </div>

      <div className={`grid gap-4 ${customizing ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1"}`}>
        {/* Pinned modules grid */}
        <div>
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 p-10 text-center text-sm text-muted-foreground">
              لا توجد أقسام مثبّتة بعد. اضغط «تخصيص الواجهة» لإضافة أقسامك المفضّلة.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {items.map((it) => {
                const mod = byHref.get(it.key);
                if (!mod) return null;
                const Icon = mod.icon;
                const big = it.size === "lg";
                return (
                  <div
                    key={it.key}
                    draggable
                    onDragStart={() => setDragKey(it.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragKey) reorder(dragKey, it.key); setDragKey(null); }}
                    className={`group relative rounded-xl border border-border/30 bg-card p-4 transition-colors hover:border-primary/40 ${SIZE_SPAN[it.size]} ${dragKey === it.key ? "opacity-50" : ""}`}
                  >
                    <div className="absolute left-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button type="button" onClick={() => cycleSize(it.key)} title={`الحجم: ${SIZE_LABEL[it.size]}`} className="grid h-6 w-6 place-items-center rounded border border-border/40 text-muted-foreground hover:text-foreground"><Maximize2 className="h-3 w-3" /></button>
                      <button type="button" onClick={() => unpin(it.key)} title="إلغاء التثبيت" className="grid h-6 w-6 place-items-center rounded border border-destructive/30 text-destructive"><X className="h-3 w-3" /></button>
                      <span className="grid h-6 w-6 cursor-grab place-items-center rounded border border-border/40 text-muted-foreground" title="اسحب لإعادة الترتيب"><GripVertical className="h-3 w-3" /></span>
                    </div>
                    <Link href={mod.href} className="flex flex-col items-center gap-2 text-center">
                      <span className={`grid place-items-center rounded-xl bg-primary/10 text-primary ${big ? "h-16 w-16" : "h-12 w-12"}`}>
                        <Icon className={big ? "h-8 w-8" : "h-6 w-6"} />
                      </span>
                      <span className={`font-semibold text-foreground ${big ? "text-base" : "text-sm"}`}>{mod.label}</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Customize panel */}
        {customizing && (
          <div className="rounded-xl border border-border/30 bg-card p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
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
                    className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-right transition-colors ${pinned ? "border-primary/40 bg-primary/5" : "border-border/30 hover:border-primary/30"}`}
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
          </div>
        )}
      </div>
    </div>
  );
}
