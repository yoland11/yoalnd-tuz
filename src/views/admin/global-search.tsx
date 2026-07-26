import { useEffect, useRef, useState, useDeferredValue } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Search, X, Loader2, User, ShoppingBag, Package, Receipt, FileText,
  GraduationCap, Truck, CalendarDays, Boxes,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { adminFetch } from "./_lib";

/**
 * Always-accessible global search for the admin dashboard. Reuses the existing
 * unified /admin/smart-search endpoint (customers, orders, products, invoices,
 * documents, bookings, suppliers, assets…). Opens from the header button or the
 * Ctrl/⌘+K shortcut; debounced, keyboard-navigable, RTL and theme-aware.
 */

type Result = { type: string; id: number | string; title: string; subtitle?: string; href: string };

const TYPE_META: Record<string, { label: string; Icon: typeof User }> = {
  customer: { label: "عميل", Icon: User },
  order: { label: "طلب", Icon: ShoppingBag },
  product: { label: "منتج", Icon: Package },
  asset: { label: "أصل", Icon: Boxes },
  invoice: { label: "فاتورة", Icon: Receipt },
  document: { label: "مستند", Icon: FileText },
  graduation_order: { label: "تخرج", Icon: GraduationCap },
  supplier: { label: "مورد", Icon: Truck },
  booking: { label: "حجز", Icon: CalendarDays },
};

export function AdminGlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const [active, setActive] = useState(0);
  const [, setLocation] = useLocation();
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<{ data: Result[] }>({
    queryKey: ["admin", "global-search", deferred],
    queryFn: () => adminFetch(`/admin/smart-search?q=${encodeURIComponent(deferred)}`),
    enabled: open && deferred.length >= 2,
    staleTime: 15_000,
  });
  const results = data?.data ?? [];

  // Ctrl/⌘+K opens the palette from anywhere in the dashboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setActive(0), [deferred]);

  function go(result: Result) {
    setOpen(false);
    setQ("");
    if (/^https?:\/\//.test(result.href) || result.href.startsWith("/api/")) {
      window.open(result.href, "_blank", "noopener");
    } else {
      setLocation(result.href);
    }
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active]);
    }
  }

  const showHint =
    deferred.length < 2
      ? "اكتب حرفين على الأقل للبحث"
      : isFetching && !results.length
        ? "جارٍ البحث…"
        : !results.length
          ? "لا توجد نتائج مطابقة"
          : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="بحث عام"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/40 bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="hidden lg:inline">بحث…</span>
        <kbd className="hidden lg:inline rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">Ctrl K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" dir="rtl">
          <DialogHeader className="sr-only">
            <DialogTitle>البحث العام</DialogTitle>
            <DialogDescription>ابحث عبر كل النظام: عملاء، طلبات، منتجات، فواتير، حجوزات…</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={onInputKey}
              placeholder="ابحث عن عميل، طلب، منتج، فاتورة، مورد…"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {isFetching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : q ? (
              <button type="button" onClick={() => setQ("")} aria-label="مسح" className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
            {showHint ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{showHint}</p>
            ) : (
              results.map((result, index) => {
                const meta = TYPE_META[result.type] ?? { label: result.type, Icon: Search };
                const Icon = meta.Icon;
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(result)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-right transition-colors ${
                      active === index ? "bg-primary/10" : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/50 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{result.title || "—"}</span>
                      {result.subtitle ? (
                        <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{meta.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
