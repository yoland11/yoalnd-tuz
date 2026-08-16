import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Barcode,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  PackageOpen,
  PackageX,
  ScanLine,
  Search,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveScanner } from "../staff/live-scanner";
import { adminFetch, apiErrorMessage, formatCurrency, hasPerm, fetchAdminMe } from "./_lib";
import { normalizeScannedCode } from "./barcode-scan-dialog";

type LookupProduct = {
  id: number;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  category?: string | null;
  barcode?: string | null;
  sku?: string | null;
  code?: string | null;
  price: number | string;
  costPrice?: number | string | null;
  stock: number | string;
  minStock?: number | string | null;
  images?: string[] | null;
  locations?: Array<{ warehouse: string; quantity: number }>;
};

type LookupResponse = { data: LookupProduct[] };
type StockFilter = "all" | "available" | "low" | "out";

function quantity(product: LookupProduct) {
  return Number(product.stock ?? 0);
}

function stockState(product: LookupProduct): StockFilter {
  const value = quantity(product);
  const threshold = Number(product.minStock ?? 0) || 5;
  if (value <= 0) return "out";
  if (value < threshold) return "low";
  return "available";
}

function StockBadge({ product }: { product: LookupProduct }) {
  const state = stockState(product);
  const meta = state === "out"
    ? { label: "غير متوفر", className: "border-status-danger/30 bg-status-danger/10 text-status-danger", Icon: PackageX }
    : state === "low"
      ? { label: "مخزون منخفض", className: "border-status-warning/30 bg-status-warning/10 text-status-warning", Icon: PackageOpen }
      : { label: "متوفر", className: "border-status-success/30 bg-status-success/10 text-status-success", Icon: CheckCircle2 };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${meta.className}`}><meta.Icon className="h-3.5 w-3.5" />{meta.label}</span>;
}

function ProductImage({ product, className = "" }: { product: LookupProduct; className?: string }) {
  const source = product.images?.[0];
  if (source) return <img src={source} alt="" className={`object-cover ${className}`} />;
  return <div className={`grid place-items-center bg-muted text-muted-foreground ${className}`}><PackageOpen className="h-7 w-7" /></div>;
}

export default function ProductLookupPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [fastScan, setFastScan] = useState(false);
  const [scannedSearch, setScannedSearch] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const meQuery = useQuery({ queryKey: ["admin", "me"], queryFn: () => fetchAdminMe(), staleTime: 60_000 });
  const canViewCost = Boolean(meQuery.data && (meQuery.data.role === "admin" || meQuery.data.role === "manager" || hasPerm(meQuery.data, "accounting")));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const lookup = useQuery<LookupResponse>({
    queryKey: ["admin", "product-lookup", debouncedSearch],
    queryFn: () => adminFetch(`/admin/product-lookup?q=${encodeURIComponent(debouncedSearch)}`),
    enabled: debouncedSearch.length > 0,
    staleTime: 30_000,
  });
  const products = lookup.data?.data ?? [];
  const visibleProducts = useMemo(() => stockFilter === "all" ? products : products.filter((product) => stockState(product) === stockFilter), [products, stockFilter]);
  const selected = visibleProducts.find((product) => product.id === selectedId) ?? products.find((product) => product.id === selectedId) ?? null;

  useEffect(() => {
    if (scannedSearch && products.length === 1) {
      setSelectedId(products[0].id);
      setScannedSearch(false);
    }
  }, [products, scannedSearch]);

  function scan(code: string) {
    const normalized = normalizeScannedCode(code);
    if (!normalized) return;
    setSearch(normalized);
    setScannedSearch(true);
    setScannerOpen(false);
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-10 sm:p-6" dir="rtl">
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 text-primary"><ScanLine className="h-5 w-5" /><span className="text-sm font-semibold">دليل المخزون</span></div>
        <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">البحث عن منتج</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">ابحث باسم المنتج أو امسح الباركود للوصول إلى تفاصيله مباشرة.</p>
      </header>

      <section className="rounded-xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute right-3 h-5 w-5 text-muted-foreground" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(null); setScannedSearch(false); }} autoComplete="off" placeholder="ابحث باسم المنتج، الباركود، SKU أو الكود..." className="h-12 w-full rounded-lg border border-border/50 bg-background py-2 pl-3 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </label>
          <Button type="button" variant="outline" onClick={() => { setFastScan(false); setScannerOpen(true); }} className="h-12 gap-2 sm:min-w-36"><Barcode className="h-5 w-5" />مسح الباركود</Button>
          <Button type="button" onClick={() => { setFastScan(true); setScannerOpen(true); }} className="h-12 gap-2 sm:min-w-32"><ScanLine className="h-5 w-5" />مسح سريع</Button>
        </div>
        {debouncedSearch ? <div className="mt-3 flex flex-wrap gap-2"><span className="self-center text-xs text-muted-foreground">تصفية النتائج:</span>{([ ["all", "الكل"], ["available", "متوفر"], ["low", "منخفض"], ["out", "غير متوفر"] ] as Array<[StockFilter, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setStockFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${stockFilter === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div> : null}
      </section>

      {scannerOpen ? <section className="mx-auto max-w-xl rounded-xl border border-primary/30 bg-card p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-bold text-foreground">{fastScan ? "المسح السريع" : "مسح الباركود"}</h2><p className="mt-1 text-xs text-muted-foreground">وجّه الكاميرا نحو الرمز؛ يتوقف المسح عند قراءة المنتج.</p></div><Button type="button" size="sm" variant="ghost" onClick={() => setScannerOpen(false)}>إغلاق</Button></div><LiveScanner onDetect={scan} active stopOnDetect />{fastScan ? <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-center text-xs text-primary">بعد ظهور المنتج يمكنك اختيار «مسح منتج آخر» للمتابعة.</p> : null}</section> : null}

      {!debouncedSearch && !scannerOpen ? <section className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border/60 bg-muted/15 p-6 text-center"><div><Boxes className="mx-auto h-10 w-10 text-muted-foreground" /><h2 className="mt-3 font-semibold text-foreground">ابحث عن منتج أو امسح الباركود</h2><p className="mt-1 text-sm text-muted-foreground">البحث آمن للقراءة فقط ولا يغيّر المخزون.</p></div></section> : null}
      {lookup.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-48 rounded-xl" />)}</div> : null}
      {lookup.isError ? <section className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger">تعذر البحث عن المنتج. {apiErrorMessage(lookup.error)}</section> : null}
      {debouncedSearch && !lookup.isLoading && !lookup.isError && !products.length ? <section className="grid min-h-48 place-items-center rounded-xl border border-dashed border-border/60 p-6 text-center"><div><PackageX className="mx-auto h-9 w-9 text-muted-foreground" /><h2 className="mt-3 font-semibold">{scannedSearch ? "الباركود غير مسجل لأي منتج" : "لم يتم العثور على منتجات مطابقة"}</h2><div className="mt-4 flex justify-center gap-2"><Button type="button" variant="outline" onClick={() => setSearch("")}>بحث يدوي</Button><Button type="button" onClick={() => setScannerOpen(true)}>إعادة المسح</Button></div></div></section> : null}

      {visibleProducts.length ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"> <section className="grid gap-3 sm:grid-cols-2">{visibleProducts.map((product) => <article key={product.id} className={`flex min-w-0 gap-3 rounded-xl border p-3 transition-colors ${selectedId === product.id ? "border-primary bg-primary/5" : "border-border/50 bg-card hover:border-primary/50"}`}><ProductImage product={product} className="h-20 w-20 flex-none rounded-lg" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="line-clamp-2 font-bold text-foreground">{product.nameAr || product.name}</h2><StockBadge product={product} /></div><p className="mt-1 text-sm font-semibold text-primary" dir="ltr">{formatCurrency(product.price)}</p><p className="mt-1 truncate text-xs text-muted-foreground">{product.category || "غير مصنف"} · SKU: <span dir="ltr">{product.sku || product.code || "—"}</span></p><p className="mt-1 text-xs text-muted-foreground">متوفر: {quantity(product)}{product.locations?.[0] ? ` · ${product.locations[0].warehouse}` : ""}</p><Button type="button" size="sm" variant="ghost" onClick={() => setSelectedId(product.id)} className="mt-1 h-8 gap-1 px-1 text-primary">عرض التفاصيل <ChevronLeft className="h-4 w-4" /></Button></div></article>)}</section>
        <ProductDetails product={selected} canViewCost={canViewCost} onScanAnother={() => { setSelectedId(null); setFastScan(true); setScannerOpen(true); }} /></div> : null}
    </main>
  );
}

function ProductDetails({ product, canViewCost, onScanAnother }: { product: LookupProduct | null; canViewCost: boolean; onScanAnother: () => void }) {
  if (!product) return <aside className="hidden rounded-xl border border-dashed border-border/60 p-5 lg:block"><p className="text-sm text-muted-foreground">اختر منتجًا لعرض تفاصيله كاملة.</p></aside>;
  const locations = product.locations ?? [];
  return <aside className="h-fit rounded-xl border border-border/50 bg-card p-4 lg:sticky lg:top-4"><div className="flex gap-3"><ProductImage product={product} className="h-16 w-16 flex-none rounded-lg" /><div className="min-w-0"><h2 className="font-bold text-foreground">{product.nameAr || product.name}</h2><p className="mt-1 text-xs text-muted-foreground" dir="ltr">{product.barcode || "لا يوجد باركود"}</p><StockBadge product={product} /></div></div><dl className="mt-4 space-y-2 text-sm"><Detail label="التصنيف" value={product.category || "غير مصنف"} /><Detail label="سعر البيع" value={formatCurrency(product.price)} ltr /><Detail label="SKU / الكود" value={product.sku || product.code || "—"} ltr /><Detail label="الكمية الحالية" value={String(quantity(product))} ltr />{canViewCost ? <Detail label="سعر الشراء / الكلفة" value={formatCurrency(product.costPrice ?? 0)} ltr /> : null}</dl>{product.descriptionAr || product.description ? <p className="mt-4 border-t border-border/40 pt-3 text-sm leading-6 text-muted-foreground">{product.descriptionAr || product.description}</p> : null}<section className="mt-4 border-t border-border/40 pt-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Warehouse className="h-4 w-4 text-primary" />الموقع والمخزن</h3>{locations.length ? <div className="mt-2 space-y-2">{locations.map((location, index) => <div key={`${location.warehouse}-${index}`} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"><span>{location.warehouse}</span><span dir="ltr">{location.quantity}</span></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">لا يوجد موقع مخزن مسجّل لهذا المنتج.</p>}</section><Button type="button" variant="outline" onClick={onScanAnother} className="mt-4 w-full gap-2"><ScanLine className="h-4 w-4" />مسح منتج آخر</Button></aside>;
}

function Detail({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return <div className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 text-left font-semibold text-foreground" dir={ltr ? "ltr" : undefined}>{value}</dd></div>;
}
