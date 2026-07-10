import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Lock, CheckCircle2, AlertTriangle, PackageX, Flame, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Summary = {
  totals: { totalStock: number; reserved: number; available: number };
  alerts: {
    lowStock: Array<{ variantId: number; name: string; stock: number; reserved: number; available: number; minStock: number }>;
    outOfStock: Array<{ variantId: number; name: string; stock: number; reserved: number; available: number }>;
    highReserved: Array<{ productId: number; name: string; total: number; reserved: number; available: number; ratio: number }>;
    lowStockCount: number; outOfStockCount: number; highReservedCount: number;
  };
};

export default function ReservedStockPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["admin", "reserved-summary"],
    queryFn: () => adminFetch("/admin/inventory/reserved-summary"),
  });
  const { data: search } = useQuery<any>({
    queryKey: ["admin", "variant-search", q],
    queryFn: () => adminFetch(`/products/variant-search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Lock className="w-6 h-6 text-primary" /> المخزون المحجوز
        </h1>
        <p className="text-sm text-muted-foreground mt-1">إجمالي المخزون · المحجوز · المتاح — مع تنبيهات النقص والنفاد والحجز المرتفع.</p>
      </div>

      {/* Unified search: name / variant / SKU / barcode / QR */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم / اللون / SKU / باركود / QR…"
          className="w-full bg-background border border-border/40 rounded-lg pr-9 pl-3 py-2 text-sm" />
        {q.trim().length >= 2 && (search?.variants?.length || search?.products?.length) ? (
          <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-border/40 bg-card shadow-lg divide-y divide-border/20">
            {(search?.variants ?? []).map((v: any) => (
              <div key={`v${v.id}`} className="flex items-center justify-between p-2.5 text-sm">
                <span className="text-foreground">{v.productName} · {[v.color, v.size].filter(Boolean).join(" / ")}</span>
                <span className="text-[11px] text-muted-foreground">📦{v.stock} · ✅{v.available} · {v.barcode}</span>
              </div>
            ))}
            {(search?.products ?? []).map((p: any) => (
              <div key={`p${p.id}`} className="flex items-center justify-between p-2.5 text-sm">
                <span className="text-foreground">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">📦{p.stock} · {p.barcode}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : !data ? (
        <EmptyState message="تعذر تحميل البيانات." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card icon={Boxes} label="📦 إجمالي المخزون" value={data.totals.totalStock} tone="fg" />
            <Card icon={Lock} label="🔒 المحجوز" value={data.totals.reserved} tone="warn" />
            <Card icon={CheckCircle2} label="✅ المتاح" value={data.totals.available} tone="ok" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="⚠️ مخزون منخفض" count={data.alerts.lowStockCount} tone="warn">
              {data.alerts.lowStock.length === 0 ? <Empty ok /> : data.alerts.lowStock.map((v) => (
                <Row key={v.variantId} name={v.name} right={`متاح ${v.available} / حد ${v.minStock}`} tone="warn" icon={AlertTriangle} />
              ))}
            </Panel>
            <Panel title="⛔ نفد المخزون" count={data.alerts.outOfStockCount} tone="danger">
              {data.alerts.outOfStock.length === 0 ? <Empty ok /> : data.alerts.outOfStock.map((v) => (
                <Row key={v.variantId} name={v.name} right={`محجوز ${v.reserved}`} tone="danger" icon={PackageX} />
              ))}
            </Panel>
            <Panel title="🔥 حجز مرتفع" count={data.alerts.highReservedCount} tone="warn">
              {data.alerts.highReserved.length === 0 ? <Empty ok /> : data.alerts.highReserved.map((p) => (
                <Row key={p.productId} name={p.name} right={`${p.ratio}% (${p.reserved}/${p.total})`} tone="warn" icon={Flame} />
              ))}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "fg" | "warn" | "ok" }) {
  const cls = tone === "warn" ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
    : tone === "ok" ? "border-status-success/30 bg-status-success/10 text-status-success"
    : "border-border/30 bg-card text-foreground";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center gap-2 text-xs opacity-80"><Icon className="w-4 h-4" /> {label}</div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; tone: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">{children}</div>
    </div>
  );
}

function Row({ name, right, tone, icon: Icon }: { name: string; right: string; tone: "warn" | "danger"; icon: any }) {
  const color = tone === "danger" ? "text-status-danger" : "text-status-warning";
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-foreground truncate flex items-center gap-1"><Icon className={`w-3 h-3 ${color} shrink-0`} /> {name}</span>
      <span className={`shrink-0 ${color}`}>{right}</span>
    </div>
  );
}

function Empty({ ok }: { ok?: boolean }) {
  return <p className={`text-xs py-3 text-center ${ok ? "text-status-success" : "text-muted-foreground"}`}>{ok ? "✅ لا تنبيهات" : "لا بيانات"}</p>;
}
