"use client";

import { DragEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Copy, Flower2, GripVertical, ImageOff, Minus, Package, Plus, RefreshCw, Search, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Variant = { id: number; color: string | null; colorHex: string | null; sku: string | null; image: string | null; price: number | null; cost?: number | null; stock: number; available: number; isActive: boolean };
type RecipeLine = { productId: number; quantity: number; unit: string; unitCost: number; notes: string | null };
type CatalogProduct = { id: number; name: string; nameAr: string; price: number; costPrice?: number; originalPrice: number | null; stock: number; category: string | null; categoryName: string | null; subcategory: string | null; subcategoryName: string | null; images: string[]; imageMetadata?: Array<{ objectFit?: string }>; variants: Variant[]; recipe: RecipeLine[]; isBouquetTemplate: boolean };
type CatalogResponse = { version: string; products: CatalogProduct[] };
type Selection = { key: string; product: CatalogProduct; variant: Variant | null; quantity: number };

const catalogKey = ["/api/products/designer-catalog"] as const;

async function fetchDesignerCatalog(): Promise<CatalogResponse> {
  const response = await fetch("/api/products/designer-catalog", { credentials: "include" });
  if (!response.ok) throw new Error("تعذّر تحميل كتالوج المتجر");
  return response.json();
}
function categoryOf(product: CatalogProduct) { return { key: String(product.subcategory || product.subcategoryName || product.category || product.categoryName || "other").toLowerCase(), label: product.subcategoryName || product.categoryName || product.subcategory || product.category || "منتجات أخرى" }; }
function productName(product: CatalogProduct) { return product.nameAr || product.name; }
function selectionKey(productId: number, variantId?: number | null) { return variantId ? `v:${variantId}` : `p:${productId}`; }

export default function FlowerDesigner() {
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState("all");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(36);
  const catalog = useQuery({ queryKey: catalogKey, queryFn: fetchDesignerCatalog, staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true });
  const products = catalog.data?.products ?? [];

  // The stream is database-backed, therefore updates made by any Admin session
  // invalidate this cached catalog without a navigation or page refresh.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/products/designer-stream");
    stream.addEventListener("products", () => { void client.invalidateQueries({ queryKey: catalogKey }); });
    return () => stream.close();
  }, [client]);
  useEffect(() => {
    products.slice(0, 18).forEach((product) => { const src = product.images?.[0]; if (src) { const image = new Image(); image.src = src; } });
  }, [products]);
  useEffect(() => {
    setQuantities((current) => {
      let changed = false; const next = { ...current };
      for (const product of products) {
        const baseKey = selectionKey(product.id); const baseMax = product.variants.length ? 0 : product.stock;
        if ((next[baseKey] ?? 0) > baseMax) { next[baseKey] = baseMax; changed = true; }
        for (const variant of product.variants) { const key = selectionKey(product.id, variant.id); const max = Math.max(0, variant.available ?? variant.stock); if ((next[key] ?? 0) > max) { next[key] = max; changed = true; } }
      }
      return changed ? next : current;
    });
  }, [products]);

  const categories = useMemo(() => Array.from(new Map(products.map((product) => { const category = categoryOf(product); return [category.key, category]; })).values()), [products]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesCategory = activeCategory === "all" || categoryOf(product).key === activeCategory;
      const searchable = [productName(product), product.name, product.nameAr, product.categoryName, product.subcategoryName, ...product.variants.map((variant) => `${variant.color ?? ""} ${variant.sku ?? ""}`)].join(" ").toLocaleLowerCase();
      return matchesCategory && (!needle || searchable.includes(needle));
    });
  }, [activeCategory, products, search]);
  useEffect(() => setVisibleLimit(36), [activeCategory, search]);
  const displayProducts = filtered.slice(0, visibleLimit);
  const selected = useMemo<Selection[]>(() => {
    const rows: Selection[] = [];
    products.forEach((product) => {
      if (!product.variants.length) { const key = selectionKey(product.id); if (quantities[key] > 0) rows.push({ key, product, variant: null, quantity: quantities[key] }); }
      product.variants.forEach((variant) => { const key = selectionKey(product.id, variant.id); if (quantities[key] > 0) rows.push({ key, product, variant, quantity: quantities[key] }); });
    });
    const rank = new Map(order.map((key, index) => [key, index]));
    return rows.sort((a, b) => (rank.get(a.key) ?? 9999) - (rank.get(b.key) ?? 9999));
  }, [order, products, quantities]);
  const subtotal = selected.reduce((sum, line) => sum + unitPrice(line) * line.quantity, 0);
  const discount = selected.reduce((sum, line) => sum + Math.max(0, (line.product.originalPrice ?? unitPrice(line)) - unitPrice(line)) * line.quantity, 0);
  const templates = products.filter((product) => product.isBouquetTemplate);
  const unavailable = selected.filter((line) => available(line) <= 0);
  const replacements = useMemo(() => unavailable.flatMap((line) => products.filter((candidate) => candidate.id !== line.product.id && categoryOf(candidate).key === categoryOf(line.product).key && candidate.stock > 0).slice(0, 3).map((candidate) => ({ line, candidate }))), [products, unavailable]);
  const suggestions = useMemo(() => products.filter((product) => product.stock > 0 && !selected.some((line) => line.product.id === product.id)).slice(0, 4), [products, selected]);

  function setLineQuantity(line: Selection, delta: number) { changeQuantity(line.product, line.variant, delta); }
  function changeQuantity(product: CatalogProduct, variant: Variant | null, delta: number) {
    const key = selectionKey(product.id, variant?.id); const max = variant ? Math.max(0, variant.available ?? variant.stock) : product.variants.length ? 0 : product.stock;
    setQuantities((current) => { const next = Math.max(0, Math.min(max, (current[key] ?? 0) + delta)); return { ...current, [key]: next }; });
    if (delta > 0) setOrder((current) => current.includes(key) ? current : [...current, key]);
  }
  function removeLine(line: Selection) { setQuantities((current) => ({ ...current, [line.key]: 0 })); }
  function duplicateLine(line: Selection) { changeQuantity(line.product, line.variant, line.quantity); }
  function reorder(dragged: string, target: string) { setOrder((current) => { const rows = selected.map((line) => line.key); const source = rows.indexOf(dragged), destination = rows.indexOf(target); if (source < 0 || destination < 0 || source === destination) return current; rows.splice(source, 1); rows.splice(destination, 0, dragged); return rows; }); }
  function applyTemplate(template: CatalogProduct) {
    const components = template.recipe.map((recipe) => ({ product: products.find((product) => product.id === recipe.productId), quantity: recipe.quantity })).filter((entry): entry is { product: CatalogProduct; quantity: number } => Boolean(entry.product));
    if (!components.length) { toast({ title: "هذا النموذج لا يحتوي مكونات صالحة", variant: "destructive" }); return; }
    setQuantities((current) => { const next = { ...current }; components.forEach(({ product, quantity }) => { if (!product.variants.length) next[selectionKey(product.id)] = Math.min(product.stock, Math.max(0, quantity)); }); return next; });
    setOrder(components.map(({ product }) => selectionKey(product.id))); setTemplateName(productName(template));
    toast({ title: `تم تطبيق نموذج ${productName(template)}` });
  }
  async function addDesignToCart() {
    if (!selected.length) { toast({ title: "اختر منتجاً واحداً على الأقل", variant: "destructive" }); return; }
    setIsAdding(true);
    try {
      const validation = await fetch("/api/products/designer-inventory/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: selected.map((line) => ({ productId: line.product.id, variantId: line.variant?.id ?? null, quantity: line.quantity })) }) });
      const availability = await validation.json().catch(() => ({}));
      if (!validation.ok || !availability.ok) { await catalog.refetch(); throw new Error(availability?.shortages?.map((row: any) => `${row.name}: المتاح ${row.available}`).join("، ") || "تغيّر المخزون، راجع اختياراتك."); }
      const snapshot = { source: "bouquet_designer", templateName: templateName || undefined, giftCard: note.trim() || undefined, createdAt: new Date().toISOString(), items: selected.map((line) => ({ productId: line.product.id, variantId: line.variant?.id ?? null, sku: line.variant?.sku ?? line.product.id, image: line.variant?.image || line.product.images?.[0] || null, name: productName(line.product), price: unitPrice(line), cost: Number(line.variant?.cost ?? line.product.costPrice ?? 0), quantity: line.quantity, flowerColor: line.variant?.color ?? null, category: categoryOf(line.product).label })) };
      for (const line of selected) {
        const response = await fetch("/api/cart", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: line.product.id, variantId: line.variant?.id, quantity: line.quantity, selectedColor: line.variant?.color || undefined, selectedColorData: line.variant?.color ? { name: line.variant.color, hex: line.variant.colorHex || "", image: line.variant.image } : undefined, customization: JSON.stringify(snapshot) }) });
        const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.error || "تعذّر إضافة المنتج إلى السلة");
      }
      await client.invalidateQueries({ queryKey: ["/api/cart"] }); toast({ title: "أضيف تصميم الباقة إلى السلة", description: "سيعاد التحقق من المخزون ويُخصم عند تأكيد الدفع." }); navigate("/checkout");
    } catch (error: any) { toast({ title: "لا يمكن متابعة الطلب", description: error?.message || "حاول مرة أخرى.", variant: "destructive" }); } finally { setIsAdding(false); }
  }

  return <main dir="rtl" className="min-h-dvh bg-background py-6 text-foreground sm:py-10"><div className="container mx-auto px-4">
    <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><Flower2 className="h-6 w-6" /></span><div><h1 className="text-2xl font-bold">مصمم الباقات</h1><p className="mt-1 text-sm text-muted-foreground">كتالوج مباشر من إدارة المنتجات والمخزون.</p></div></div><div className="flex gap-2"><Button variant="outline" size="icon" title="تحديث الكتالوج" onClick={() => void catalog.refetch()}><RefreshCw className={cn("h-4 w-4", catalog.isFetching && "animate-spin")} /></Button><Button variant="outline" asChild><Link href="/store">فتح المتجر</Link></Button></div></header>
    {templates.length ? <section className="mb-5 rounded-xl border border-border/40 bg-card p-4"><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">نماذج الباقات الجاهزة</h2></div><div className="flex gap-2 overflow-x-auto pb-1">{templates.map((template) => <button key={template.id} type="button" onClick={() => applyTemplate(template)} className="flex shrink-0 items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-right text-sm hover:border-primary/50"><ProductImage product={template} className="h-9 w-9 rounded-md" /><span><b className="block">{productName(template)}</b><small className="text-muted-foreground">{formatCurrency(template.price)}</small></span></button>)}</div></section> : null}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="min-w-0"><div className="relative mb-3"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="ابحث باسم المنتج أو اللون أو SKU" aria-label="البحث في منتجات مصمم الباقات" /></div><div className="mb-4 flex gap-2 overflow-x-auto pb-1"><CategoryButton active={activeCategory === "all"} onClick={() => setActiveCategory("all")}>كل منتجات المتجر</CategoryButton>{categories.map((category) => <CategoryButton key={category.key} active={activeCategory === category.key} onClick={() => setActiveCategory(category.key)}>{category.label}</CategoryButton>)}</div>
      {catalog.isLoading ? <CatalogSkeleton /> : catalog.isError ? <Card><CardContent className="p-8 text-center"><p className="font-medium">تعذّر تحميل الكتالوج.</p><Button className="mt-4" onClick={() => void catalog.refetch()}>إعادة المحاولة</Button></CardContent></Card> : displayProducts.length ? <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{displayProducts.map((product) => <DesignerProductCard key={product.id} product={product} quantities={quantities} onChange={changeQuantity} />)}</div>{filtered.length > visibleLimit ? <Button variant="outline" className="mx-auto mt-5 flex" onClick={() => setVisibleLimit((value) => value + 36)}>عرض المزيد</Button> : null}</> : <EmptyCatalog />}
    </section><aside className="space-y-4 xl:sticky xl:top-4 xl:self-start"><BouquetPreview selected={selected} note={note} onDropLine={reorder} /><Card className="border-primary/20"><CardContent className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">ملخص الباقة</h2><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{selected.reduce((sum, line) => sum + line.quantity, 0)} قطعة</span></div><div className="mt-4 max-h-56 space-y-2 overflow-y-auto">{selected.length ? selected.map((line) => <SelectionRow key={line.key} line={line} onRemove={removeLine} onDuplicate={duplicateLine} onChange={setLineQuantity} onDragStart={() => {}} />) : <p className="py-4 text-center text-sm text-muted-foreground">لم تختر أي منتجات بعد.</p>}</div><label className="mt-4 block text-sm font-medium">بطاقة الإهداء <span className="font-normal text-muted-foreground">(اختياري)</span><Input value={note} onChange={(event) => setNote(event.target.value)} className="mt-2" placeholder="رسالة البطاقة أو ملاحظات التجهيز" /></label><div className="mt-5 space-y-2 border-t border-border/40 pt-4 text-sm"><SummaryRow label="المنتجات" value={subtotal} />{discount > 0 ? <SummaryRow label="خصم المنتجات" value={-discount} className="text-status-success" /> : null}<div className="flex items-center justify-between pt-2 text-base font-bold"><span>الإجمالي</span><span className="text-primary">{formatCurrency(subtotal)}</span></div></div><Button className="mt-5 w-full gap-2" disabled={!selected.length || isAdding || unavailable.length > 0} onClick={() => void addDesignToCart()}><ShoppingBag className="h-4 w-4" />{isAdding ? "جارٍ التحقق…" : "متابعة إلى الدفع"}</Button></CardContent></Card>
      {unavailable.length ? <ReplacementPanel lines={unavailable} replacements={replacements} onReplace={(line, product) => { removeLine(line); changeQuantity(product, null, 1); }} /> : null}{suggestions.length ? <section className="rounded-xl border border-border/40 bg-card p-4"><div className="mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">اقتراحات متناسقة</h2></div><div className="space-y-2">{suggestions.map((product) => <button key={product.id} type="button" className="flex w-full items-center gap-2 rounded-lg p-1.5 text-right hover:bg-muted" onClick={() => changeQuantity(product, null, 1)}><ProductImage product={product} className="h-9 w-9 rounded" /><span className="min-w-0 flex-1 truncate text-sm">{productName(product)}</span><Plus className="h-4 w-4 text-primary" /></button>)}</div></section> : null}</aside></div>
  </div></main>;
}

function DesignerProductCard({ product, quantities, onChange }: { product: CatalogProduct; quantities: Record<string, number>; onChange: (product: CatalogProduct, variant: Variant | null, delta: number) => void }) { const unavailable = product.stock <= 0; return <Card className={cn("overflow-hidden [content-visibility:auto]", unavailable && "bg-muted/70 grayscale") }><div className="relative aspect-[4/3] bg-muted"><ProductImage product={product} className="h-full w-full" objectFit={product.imageMetadata?.[0]?.objectFit} />{unavailable ? <span className="absolute right-2 top-2 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">نفذت الكمية</span> : null}</div><CardContent className="p-3"><p className="truncate text-xs text-muted-foreground">{categoryOf(product).label}</p><h3 className="mt-1 font-semibold">{productName(product)}</h3>{product.variants.length ? <div className="mt-3 space-y-2">{product.variants.map((variant) => <OptionRow key={variant.id} variant={variant} quantity={quantities[selectionKey(product.id, variant.id)] ?? 0} onChange={(delta) => onChange(product, variant, delta)} />)}</div> : <QuantityControl quantity={quantities[selectionKey(product.id)] ?? 0} max={product.stock} price={product.price} onChange={(delta) => onChange(product, null, delta)} />}</CardContent></Card>; }
function OptionRow({ variant, quantity, onChange }: { variant: Variant; quantity: number; onChange: (delta: number) => void }) { const max = Math.max(0, variant.available ?? variant.stock); return <div className={cn("flex items-center gap-2 rounded-lg border p-2", !max && "bg-muted text-muted-foreground")}><span className="h-4 w-4 rounded-full border" style={{ backgroundColor: variant.colorHex || "transparent" }} /><span className="min-w-0 flex-1 truncate text-xs">{variant.color || variant.sku || "خيار"}<small className="mr-1 text-muted-foreground">({max})</small></span><span className="text-xs font-medium text-primary">{formatCurrency(variant.price ?? 0)}</span><MiniQuantity quantity={quantity} max={max} onChange={onChange} /></div>; }
function QuantityControl({ quantity, max, price, onChange }: { quantity: number; max: number; price: number; onChange: (delta: number) => void }) { return <div className="mt-3 flex items-center justify-between"><span className="font-bold text-primary">{formatCurrency(price)}<small className="mr-1 font-normal text-muted-foreground">المتاح {max}</small></span><MiniQuantity quantity={quantity} max={max} onChange={onChange} /></div>; }
function MiniQuantity({ quantity, max, onChange }: { quantity: number; max: number; onChange: (delta: number) => void }) { return <div className="flex items-center gap-1"><Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={!quantity} onClick={() => onChange(-1)}><Minus className="h-3.5 w-3.5" /></Button><span className="w-6 text-center text-sm font-bold tabular-nums">{quantity}</span><Button type="button" size="icon" className="h-7 w-7" disabled={max <= quantity} onClick={() => onChange(1)}><Plus className="h-3.5 w-3.5" /></Button></div>; }
function BouquetPreview({ selected, note, onDropLine }: { selected: Selection[]; note: string; onDropLine: (dragged: string, target: string) => void }) { const [dragging, setDragging] = useState(""); return <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Flower2 className="h-4 w-4 text-primary" /><h2 className="font-semibold">معاينة الباقة</h2><span className="text-xs text-muted-foreground">اسحب لإعادة الترتيب</span></div><div className="mt-3 min-h-36 rounded-lg bg-muted/50 p-3">{selected.length ? <div className="flex flex-wrap items-center gap-2">{selected.map((line) => <button key={line.key} draggable onDragStart={(event) => { setDragging(line.key); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging) onDropLine(dragging, line.key); setDragging(""); }} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-card"><ProductImage product={line.product} className="h-full w-full" /><span className="absolute bottom-0 right-0 rounded-tl bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">×{line.quantity}</span><GripVertical className="absolute left-0 top-0 h-4 w-4 bg-background/75 text-muted-foreground opacity-0 group-hover:opacity-100" /></button>)}</div> : <div className="grid min-h-28 place-items-center text-center text-sm text-muted-foreground">أضف الورود والتغليف والإكسسوارات لرؤية الباقة.</div>}</div>{note ? <p className="mt-3 rounded-md border border-border/50 bg-card px-3 py-2 text-sm">بطاقة الإهداء: {note}</p> : null}</CardContent></Card>; }
function SelectionRow({ line, onRemove, onDuplicate, onChange }: { line: Selection; onRemove: (line: Selection) => void; onDuplicate: (line: Selection) => void; onChange: (line: Selection, delta: number) => void; onDragStart: () => void }) { return <div className="flex items-center gap-2 rounded-lg border border-border/40 p-2"><ProductImage product={line.product} className="h-9 w-9 shrink-0 rounded" /><span className="min-w-0 flex-1 truncate text-sm">{productName(line.product)}{line.variant?.color ? ` · ${line.variant.color}` : ""}</span><MiniQuantity quantity={line.quantity} max={available(line)} onChange={(delta) => onChange(line, delta)} /><Button variant="ghost" size="icon" className="h-7 w-7" title="تكرار" onClick={() => onDuplicate(line)}><Copy className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="حذف" onClick={() => onRemove(line)}><Trash2 className="h-3.5 w-3.5" /></Button></div>; }
function ReplacementPanel({ lines, replacements, onReplace }: { lines: Selection[]; replacements: Array<{ line: Selection; candidate: CatalogProduct }>; onReplace: (line: Selection, candidate: CatalogProduct) => void }) { return <section className="rounded-xl border border-status-warning/40 bg-status-warning/10 p-4"><h2 className="font-semibold text-status-warning">نفذت كمية بعض الاختيارات</h2><p className="mt-1 text-xs text-muted-foreground">لا يمكن متابعة الدفع قبل استبدالها أو حذفها.</p><div className="mt-3 space-y-2">{lines.map((line) => <div key={line.key}><p className="text-sm">{productName(line.product)}{line.variant?.color ? ` · ${line.variant.color}` : ""}</p><div className="mt-1 flex flex-wrap gap-1">{replacements.filter((item) => item.line.key === line.key).map(({ candidate }) => <Button key={candidate.id} variant="outline" size="sm" onClick={() => onReplace(line, candidate)}>استبدال بـ {productName(candidate)}</Button>)}</div></div>)}</div></section>; }
function ProductImage({ product, className, objectFit = "cover" }: { product: CatalogProduct; className: string; objectFit?: string }) { const [failed, setFailed] = useState(false); const src = product.images?.[0]; if (!src || failed) return <span className={cn("grid place-items-center bg-muted text-muted-foreground", className)}><ImageOff className="h-5 w-5" /></span>; return <img src={src} alt={productName(product)} className={cn("object-cover", className)} style={{ objectFit: objectFit as any }} loading="lazy" decoding="async" onError={() => setFailed(true)} />; }
function CategoryButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={cn("shrink-0 rounded-full border px-3 py-2 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border/50 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground")}>{children}</button>; }
function SummaryRow({ label, value, className }: { label: string; value: number; className?: string }) { return <div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className={cn("font-medium", className)}>{value < 0 ? "−" : ""}{formatCurrency(Math.abs(value))}</span></div>; }
function EmptyCatalog() { return <Card><CardContent className="p-10 text-center"><Package className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">لا توجد منتجات نشطة في هذا القسم.</p></CardContent></Card>; }
function CatalogSkeleton() { return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <Card key={index} className="overflow-hidden"><Skeleton className="aspect-[4/3] w-full rounded-none" /><CardContent className="space-y-3 p-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-8 w-full" /></CardContent></Card>)}</div>; }
function unitPrice(line: Selection) { return Number(line.variant?.price ?? line.product.price ?? 0); }
function available(line: Selection) { return Math.max(0, Number(line.variant?.available ?? line.variant?.stock ?? (line.product.variants.length ? 0 : line.product.stock) ?? 0)); }
