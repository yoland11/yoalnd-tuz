import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, ScanLine, Package, Search, HeartPulse, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, apiErrorMessage } from "./_lib";
import { LiveScanner } from "../staff/live-scanner";

type LinkedAsset = {
  productId: number;
  name: string;
  assetCode: string;
  barcode?: string | null;
  imageUrl?: string | null;
  status: string;
  warehouse?: string | null;
  health: number;
  checkedOut: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  active: "متاح",
  available: "متاح",
  checked_out: "خارج المخزن",
  reserved: "محجوز",
  maintenance: "صيانة",
  lost: "مفقود",
  retired: "مستبعد",
  locked: "مقفول",
};

function healthColor(h: number) {
  return h >= 70 ? "text-status-success" : h >= 40 ? "text-status-warning" : "text-status-danger";
}

/**
 * Unified "📦 الأصول المرتبطة" section — drop into any booking/order detail
 * (kosha | order | rental | service | photography). Reuses /admin/asset-links.
 */
export function LinkedAssetsPanel({ entityType, entityId }: { entityType: string; entityId: number }) {
  const [assets, setAssets] = useState<LinkedAsset[]>([]);
  const [search, setSearch] = useState("");
  const [scanMode, setScanMode] = useState<null | "add" | "remove">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=2000"),
    staleTime: 60_000,
  });

  const load = useCallback(async () => {
    try {
      const r = await adminFetch<{ assets: LinkedAsset[] }>(`/admin/asset-links?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`);
      setAssets(r.assets ?? []);
    } catch { /* ignore */ }
  }, [entityType, entityId]);
  useEffect(() => { void load(); }, [load]);

  const linkedIds = useMemo(() => new Set(assets.map((a) => a.productId)), [assets]);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p: any) => !linkedIds.has(p.id) && [p.nameAr, p.name, p.barcode].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [products, search, linkedIds]);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    if (ok) window.setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 3000);
  }

  async function add(productId?: number, code?: string) {
    setBusy(true);
    try {
      const r: any = await adminFetch(`/admin/asset-links`, { method: "POST", body: JSON.stringify({ entityType, entityId, productId, code }) });
      flash(true, `تمت إضافة ${r?.name ?? "الأصل"}`);
      setSearch("");
      await load();
    } catch (e) { flash(false, apiErrorMessage(e, "تعذّرت الإضافة")); } finally { setBusy(false); }
  }

  async function removeByProduct(productId: number, name: string) {
    setBusy(true);
    try {
      await adminFetch(`/admin/asset-links?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}&productId=${productId}`, { method: "DELETE" });
      flash(true, `أُزيل ${name}`);
      await load();
    } catch (e) { flash(false, apiErrorMessage(e)); } finally { setBusy(false); }
  }

  async function onScan(code: string) {
    if (busy) return;
    if (scanMode === "add") { await add(undefined, code); }
    else if (scanMode === "remove") {
      setBusy(true);
      try {
        await adminFetch(`/admin/asset-links?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}&code=${encodeURIComponent(code)}`, { method: "DELETE" });
        flash(true, "تمت الإزالة بالمسح");
        await load();
      } catch (e) { flash(false, apiErrorMessage(e)); } finally { setBusy(false); }
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/40 bg-card p-4" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" /> الأصول المرتبطة
          <span className="text-xs text-muted-foreground">({assets.length})</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={scanMode === "add" ? "default" : "outline"} className="gap-1" onClick={() => setScanMode(scanMode === "add" ? null : "add")}>
            <ScanLine className="h-4 w-4" /> مسح لإضافة
          </Button>
          <Button size="sm" variant={scanMode === "remove" ? "default" : "outline"} className="gap-1" onClick={() => setScanMode(scanMode === "remove" ? null : "remove")}>
            <ScanLine className="h-4 w-4" /> مسح لإزالة
          </Button>
        </div>
      </div>

      {scanMode && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
          <p className="mb-1 text-xs font-medium text-primary">{scanMode === "add" ? "امسح الأصل لإضافته للحجز" : "امسح الأصل لإزالته من الحجز"}</p>
          <LiveScanner onDetect={onScan} active={Boolean(scanMode)} />
          <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => setScanMode(null)}>إغلاق الماسح</Button>
        </div>
      )}

      {/* Add by search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="إضافة أصل — بحث بالاسم أو الباركود..."
          className="w-full rounded-lg border border-border/40 bg-background pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        {results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-border/40 bg-card shadow-lg">
            {results.map((p: any) => (
              <button key={p.id} type="button" disabled={busy} onClick={() => add(p.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-primary/10">
                <span className="truncate text-foreground">{p.nameAr || p.name}</span>
                <Plus className="h-4 w-4 text-primary shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {msg && (
        <div className={`rounded-lg px-3 py-1.5 text-xs font-medium ${msg.ok ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger"}`}>{msg.text}</div>
      )}

      {assets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/40 py-4 text-center text-xs text-muted-foreground">لا توجد أصول مرتبطة — أضِفها بالبحث أو المسح.</p>
      ) : (
        <ul className="space-y-2">
          {assets.map((a) => (
            <li key={a.productId} className="flex items-center gap-3 rounded-lg border border-border/30 bg-background/40 p-2">
              {a.imageUrl ? <img src={a.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="grid h-12 w-12 place-items-center rounded-lg bg-muted text-lg">📦</div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">{a.assetCode}{a.barcode ? ` · ${a.barcode}` : ""}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className={a.checkedOut ? "text-status-warning" : "text-status-success"}>{STATUS_LABEL[a.status] ?? a.status}</span>
                  {a.warehouse && <span className="inline-flex items-center gap-0.5"><Warehouse className="h-3 w-3" />{a.warehouse}</span>}
                  <span className={`inline-flex items-center gap-0.5 ${healthColor(a.health)}`}><HeartPulse className="h-3 w-3" />{a.health}%</span>
                </div>
              </div>
              <button type="button" disabled={busy} onClick={() => removeByProduct(a.productId, a.name)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-status-danger/10 hover:text-status-danger" title="إزالة">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
