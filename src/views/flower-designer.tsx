"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Copy, Flower2, GripVertical, ImageOff, Minus, Package, Plus, RefreshCw, Search, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Variant = { id: number; color: string | null; colorHex: string | null; sku: string | null; image: string | null; price: number | null; cost?: number | null; stock: number; available: number; isActive: boolean };
type RecipeLine = { productId: number; quantity: number; unit: string; unitCost: number; notes: string | null };
type DesignerSection = "flowers" | "bridal_bouquets" | "ready_bouquets" | "wrapping" | "ribbons" | "extras";
type CatalogProduct = { id: number; name: string; nameAr: string; price: number; costPrice?: number; originalPrice: number | null; stock: number; category: string | null; categoryName: string | null; subcategory: string | null; subcategoryName: string | null; categoryId: number | null; subcategoryId: number | null; subcategoryIds: number[]; designerCategoryIds: number[]; designerSection: DesignerSection; availableInBouquetDesigner: boolean; images: string[]; imageMetadata?: Array<{ objectFit?: string }>; variants: Variant[]; recipe: RecipeLine[]; isBouquetTemplate: boolean };
type CatalogResponse = { version: string; catalogScope: "flower-only-v2"; allowedCategoryIds: number[]; products: CatalogProduct[] };
type Selection = { key: string; product: CatalogProduct; variant: Variant | null; quantity: number };
type PreviewRole = "flower" | "filler" | "foliage" | "wrapping" | "ribbon" | "gift-card" | "accessory";
type PreviewLayer = { id: string; line: Selection; sourceIndex: number; x: number; y: number; scale: number; rotate: number; z: number; role: PreviewRole };

const catalogKey = ["/api/products/designer-catalog", "flower-only-v2"] as const;
const DESIGNER_SECTION_LABELS: Record<DesignerSection, string> = {
  flowers: "الورود",
  bridal_bouquets: "المسكات",
  ready_bouquets: "الباقات الجاهزة",
  wrapping: "التغليف",
  ribbons: "الأشرطة",
  extras: "إضافات الباقة",
};
const MAIN_DESIGNER_SECTIONS: DesignerSection[] = ["flowers", "bridal_bouquets", "ready_bouquets"];
const FLOWER_POSITIONS = [[50, 39, 1.15, 0], [35, 44, .92, -15], [65, 44, .94, 14], [43, 29, .84, -8], [57, 28, .84, 9], [25, 54, .73, -23], [75, 54, .74, 21], [48, 56, .9, 2], [34, 64, .7, -12], [66, 64, .7, 12], [20, 38, .65, -27], [80, 38, .65, 27]] as const;
const FILLER_POSITIONS = [[18, 29, .53, -17], [82, 30, .52, 17], [29, 20, .45, -8], [70, 20, .45, 8], [15, 55, .48, -22], [85, 55, .48, 22]] as const;
const FOLIAGE_POSITIONS = [[24, 50, .95, -28], [76, 50, .95, 28], [35, 23, .74, -16], [65, 23, .74, 16], [50, 69, .9, 0]] as const;

async function fetchDesignerCatalog(): Promise<CatalogResponse> {
  const response = await fetch("/api/products/designer-catalog", { credentials: "include" });
  if (!response.ok) throw new Error("تعذّر تحميل كتالوج المتجر");
  return response.json();
}
function categoryOf(product: CatalogProduct) { return { key: product.designerSection, label: DESIGNER_SECTION_LABELS[product.designerSection] }; }
function productName(product: CatalogProduct) { return product.nameAr || product.name; }
function selectionKey(productId: number, variantId?: number | null) { return variantId ? `v:${variantId}` : `p:${productId}`; }
function uniqueMedia(values: Array<string | null | undefined>) { return [...new Set(values.filter((value): value is string => Boolean(value)))]; }
function selectedMedia(line: Selection, imageOffset = 0) { const media = line.product.images ?? []; return uniqueMedia([line.variant?.image, ...media.slice(imageOffset), ...media.slice(0, imageOffset)]); }
function previewRole(line: Selection): PreviewRole {
  switch (line.product.designerSection) {
    case "wrapping": return "wrapping";
    case "ribbons": return "ribbon";
    case "extras": return "accessory";
    default: return "flower";
  }
}
function compositionLayers(selected: Selection[]) {
  const layers: PreviewLayer[] = [];
  const roles = selected.map((line) => ({ line, role: previewRole(line) }));
  const add = (role: PreviewRole, positions: readonly (readonly number[])[], maxPerLine: number, zBase: number) => {
    let cursor = 0;
    roles.filter((entry) => entry.role === role).forEach(({ line }) => {
      const count = Math.min(Math.max(1, line.quantity), maxPerLine);
      for (let copy = 0; copy < count; copy += 1) {
        const [x, y, scale, rotate] = positions[cursor % positions.length];
        layers.push({ id: `${line.key}-${role}-${copy}`, line, sourceIndex: cursor, x, y, scale, rotate, z: zBase + cursor, role });
        cursor += 1;
      }
    });
  };
  add("foliage", FOLIAGE_POSITIONS, 5, 10); add("filler", FILLER_POSITIONS, 6, 18); add("flower", FLOWER_POSITIONS, 12, 30); add("accessory", [[50, 61, .5, 0]], 2, 60);
  return layers;
}

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
  const products = useMemo(() => {
    const response = catalog.data;
    if (!response || response.catalogScope !== "flower-only-v2") return [];
    const allowed = new Set(response.allowedCategoryIds.map(Number));
    return response.products.filter((product) => (
      Boolean(product.designerSection) &&
      (product.designerCategoryIds.some((id) => allowed.has(Number(id))) ||
        (product.availableInBouquetDesigner === true && product.designerCategoryIds.length > 0))
    ));
  }, [catalog.data]);

  useEffect(() => { if (typeof EventSource === "undefined") return; const stream = new EventSource("/api/products/designer-stream"); stream.addEventListener("products", () => { void client.invalidateQueries({ queryKey: catalogKey }); }); return () => stream.close(); }, [client]);
  useEffect(() => { products.slice(0, 18).forEach((product) => { const src = product.images?.[0]; if (src) { const image = new Image(); image.src = src; } }); }, [products]);
  useEffect(() => { setQuantities((current) => { let changed = false; const next = { ...current }; for (const product of products) { const baseKey = selectionKey(product.id); const baseMax = product.variants.length ? 0 : product.stock; if ((next[baseKey] ?? 0) > baseMax) { next[baseKey] = baseMax; changed = true; } for (const variant of product.variants) { const key = selectionKey(product.id, variant.id); const max = Math.max(0, variant.available ?? variant.stock); if ((next[key] ?? 0) > max) { next[key] = max; changed = true; } } } return changed ? next : current; }); }, [products]);

  const categories = useMemo(() => MAIN_DESIGNER_SECTIONS.filter((section) => products.some((product) => product.designerSection === section)).map((key) => ({ key, label: DESIGNER_SECTION_LABELS[key] })), [products]);
  const filtered = useMemo(() => { const needle = search.trim().toLocaleLowerCase(); return products.filter((product) => { const matchesCategory = activeCategory === "all" || product.designerSection === activeCategory; const searchable = [productName(product), product.name, product.nameAr, ...product.variants.map((variant) => `${variant.color ?? ""} ${variant.sku ?? ""}`)].join(" ").toLocaleLowerCase(); return matchesCategory && (!needle || searchable.includes(needle)); }); }, [activeCategory, products, search]);
  useEffect(() => setVisibleLimit(36), [activeCategory, search]);
  const floralFiltered = useMemo(() => filtered.filter((product) => MAIN_DESIGNER_SECTIONS.includes(product.designerSection)), [filtered]);
  const flowerList = useMemo(() => floralFiltered.slice(0, visibleLimit), [floralFiltered, visibleLimit]);
  const wrappingOptions = useMemo(() => products.filter((product) => product.designerSection === "wrapping"), [products]);
  const ribbonOptions = useMemo(() => products.filter((product) => product.designerSection === "ribbons"), [products]);
  const accessoryOptions = useMemo(() => products.filter((product) => product.designerSection === "extras"), [products]);
  const selected = useMemo<Selection[]>(() => { const rows: Selection[] = []; products.forEach((product) => { if (!product.variants.length) { const key = selectionKey(product.id); if (quantities[key] > 0) rows.push({ key, product, variant: null, quantity: quantities[key] }); } product.variants.forEach((variant) => { const key = selectionKey(product.id, variant.id); if (quantities[key] > 0) rows.push({ key, product, variant, quantity: quantities[key] }); }); }); const rank = new Map(order.map((key, index) => [key, index])); return rows.sort((a, b) => (rank.get(a.key) ?? 9999) - (rank.get(b.key) ?? 9999)); }, [order, products, quantities]);
  useEffect(() => { selected.forEach((line) => selectedMedia(line).slice(0, 3).forEach((src) => { const image = new Image(); image.decoding = "async"; image.src = src; })); }, [selected]);
  const subtotal = selected.reduce((sum, line) => sum + unitPrice(line) * line.quantity, 0);
  const discount = selected.reduce((sum, line) => sum + Math.max(0, (line.product.originalPrice ?? unitPrice(line)) - unitPrice(line)) * line.quantity, 0);
  const templates = products.filter((product) => product.isBouquetTemplate);
  const unavailable = selected.filter((line) => available(line) <= 0);
  const replacements = useMemo(() => unavailable.flatMap((line) => products.filter((candidate) => candidate.id !== line.product.id && categoryOf(candidate).key === categoryOf(line.product).key && candidate.stock > 0).slice(0, 3).map((candidate) => ({ line, candidate }))), [products, unavailable]);
  const suggestions = useMemo(() => products.filter((product) => product.stock > 0 && !selected.some((line) => line.product.id === product.id)).slice(0, 4), [products, selected]);

  function changeQuantity(product: CatalogProduct, variant: Variant | null, delta: number) { const key = selectionKey(product.id, variant?.id); const max = variant ? Math.max(0, variant.available ?? variant.stock) : product.variants.length ? 0 : product.stock; setQuantities((current) => ({ ...current, [key]: Math.max(0, Math.min(max, (current[key] ?? 0) + delta)) })); if (delta > 0) setOrder((current) => current.includes(key) ? current : [...current, key]); }
  function removeLine(line: Selection) { setQuantities((current) => ({ ...current, [line.key]: 0 })); }
  function duplicateLine(line: Selection) { changeQuantity(line.product, line.variant, line.quantity); }
  function reorder(dragged: string, target: string) { setOrder((current) => { const rows = selected.map((line) => line.key); const source = rows.indexOf(dragged), destination = rows.indexOf(target); if (source < 0 || destination < 0 || source === destination) return current; rows.splice(source, 1); rows.splice(destination, 0, dragged); return rows; }); }
  function applyTemplate(template: CatalogProduct) { const components = template.recipe.map((recipe) => ({ product: products.find((product) => product.id === recipe.productId), quantity: recipe.quantity })).filter((entry): entry is { product: CatalogProduct; quantity: number } => Boolean(entry.product)); if (!components.length) { toast({ title: "هذا النموذج لا يحتوي مكونات صالحة", variant: "destructive" }); return; } setQuantities((current) => { const next = { ...current }; components.forEach(({ product, quantity }) => { if (!product.variants.length) next[selectionKey(product.id)] = Math.min(product.stock, Math.max(0, quantity)); }); return next; }); setOrder(components.map(({ product }) => selectionKey(product.id))); setTemplateName(productName(template)); toast({ title: `تم تطبيق نموذج ${productName(template)}` }); }
  async function addDesignToCart() {
    if (!selected.length) { toast({ title: "اختر منتجاً واحداً على الأقل", variant: "destructive" }); return; }
    setIsAdding(true);
    try {
      const validation = await fetch("/api/products/designer-inventory/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: selected.map((line) => ({ productId: line.product.id, variantId: line.variant?.id ?? null, quantity: line.quantity })) }) });
      const availability = await validation.json().catch(() => ({}));
      if (!validation.ok || !availability.ok) { await catalog.refetch(); throw new Error(availability?.shortages?.map((row: any) => `${row.name}: المتاح ${row.available}`).join("، ") || "تغيّر المخزون، راجع اختياراتك."); }
      const snapshot = { source: "bouquet_designer", templateName: templateName || undefined, giftCard: note.trim() || undefined, createdAt: new Date().toISOString(), items: selected.map((line) => ({ productId: line.product.id, variantId: line.variant?.id ?? null, sku: line.variant?.sku ?? line.product.id, image: line.variant?.image || line.product.images?.[0] || null, name: productName(line.product), price: unitPrice(line), cost: Number(line.variant?.cost ?? line.product.costPrice ?? 0), quantity: line.quantity, flowerColor: line.variant?.color ?? null, category: categoryOf(line.product).label })) };
      for (const line of selected) { const response = await fetch("/api/cart", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: line.product.id, variantId: line.variant?.id, quantity: line.quantity, selectedColor: line.variant?.color || undefined, selectedColorData: line.variant?.color ? { name: line.variant.color, hex: line.variant.colorHex || "", image: line.variant.image } : undefined, customization: JSON.stringify(snapshot) }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.error || "تعذّر إضافة المنتج إلى السلة"); }
      await client.invalidateQueries({ queryKey: ["/api/cart"] }); toast({ title: "أضيف تصميم الباقة إلى السلة", description: "سيُعاد التحقق من المخزون ويُخصم عند تأكيد الدفع." }); navigate("/checkout");
    } catch (error: any) { toast({ title: "لا يمكن متابعة الطلب", description: error?.message || "حاول مرة أخرى.", variant: "destructive" }); } finally { setIsAdding(false); }
  }

  return <main dir="rtl" className="flower-design-studio"><div className="flower-design-studio__shell">
    <header className="flower-design-studio__header"><div className="flower-design-studio__title"><span><Flower2 /></span><div><h1>تصميم باقة حسب الطلب</h1><p>اختَر عناصر الباقة وشاهد المعاينة الحية</p></div></div><div className="flower-design-studio__header-actions"><Button variant="ghost" size="icon" title="تحديث الكتالوج" onClick={() => void catalog.refetch()}><RefreshCw className={cn("h-4 w-4", catalog.isFetching && "animate-spin")} /></Button><Button variant="ghost" asChild><Link href="/store">المتجر</Link></Button></div></header>
    {templates.length ? <section className="flower-design-studio__templates"><span><Sparkles className="h-4 w-4" /> نماذج جاهزة</span><div>{templates.map((template) => <button key={template.id} type="button" onClick={() => applyTemplate(template)}><ProductImage product={template} className="h-8 w-8" objectFit="contain" /><b>{productName(template)}</b><small>{formatCurrency(template.price)}</small></button>)}</div></section> : null}
    <div className="flower-design-studio__grid">
      <section className="flower-design-studio__flowers" dir="rtl"><StudioSectionTitle index="1" title="اختر الورود" /><div className="flower-design-studio__search"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن وردة..." aria-label="البحث في ورود مصمم الباقات" /></div><div className="flower-design-studio__categories"><CategoryButton active={activeCategory === "all"} onClick={() => setActiveCategory("all")}>الكل</CategoryButton>{categories.map((category) => <CategoryButton key={category.key} active={activeCategory === category.key} onClick={() => setActiveCategory(category.key)}>{category.label}</CategoryButton>)}</div>{catalog.isLoading ? <StudioSkeleton /> : catalog.isError ? <StudioEmpty text="تعذر تحميل الكتالوج" action={() => void catalog.refetch()} /> : flowerList.length ? <div className="flower-design-studio__flower-list">{MAIN_DESIGNER_SECTIONS.map((section) => { const rows = flowerList.filter((product) => product.designerSection === section); return rows.length ? <div key={section} className="space-y-2"><h3 className="px-1 pt-2 text-sm font-semibold text-muted-foreground">{DESIGNER_SECTION_LABELS[section]}</h3>{rows.map((product) => <StudioFlowerRow key={product.id} product={product} quantities={quantities} onChange={changeQuantity} />)}</div> : null; })}</div> : <StudioEmpty text="لا توجد منتجات متاحة في هذا القسم حالياً" />}{floralFiltered.length > visibleLimit ? <Button variant="ghost" className="mt-3 w-full" onClick={() => setVisibleLimit((value) => value + 36)}>عرض المزيد</Button> : null}</section>
      <section className="flower-design-studio__preview" dir="rtl"><BouquetPreview selected={selected} note={note} onDropLine={reorder} /></section>
      <aside className="flower-design-studio__options" dir="rtl"><StudioOptionShelf index="2" title="اختر التغليف" products={wrappingOptions} quantities={quantities} onChange={changeQuantity} empty="أضف منتجات التغليف من الإدارة" /><StudioOptionShelf index="3" title="اختر الشريط" products={ribbonOptions} quantities={quantities} onChange={changeQuantity} empty="أضف منتجات الشريط من الإدارة" /><StudioOptionShelf index="4" title="الإكسسوارات" products={accessoryOptions} quantities={quantities} onChange={changeQuantity} empty="أضف إكسسوارات من الإدارة" /><StudioSummary selected={selected} subtotal={subtotal} discount={discount} note={note} setNote={setNote} isAdding={isAdding} unavailable={unavailable.length > 0} onAdd={() => void addDesignToCart()} onRemove={removeLine} onDuplicate={duplicateLine} onChange={(line, delta) => changeQuantity(line.product, line.variant, delta)} />{unavailable.length ? <ReplacementPanel lines={unavailable} replacements={replacements} onReplace={(line, product) => { removeLine(line); changeQuantity(product, null, 1); }} /> : null}{suggestions.length ? <div className="flower-design-studio__suggestions"><span><Sparkles className="h-4 w-4" /> اقتراحات متناسقة</span>{suggestions.map((product) => <button key={product.id} type="button" onClick={() => changeQuantity(product, null, 1)}><ProductImage product={product} className="h-8 w-8" objectFit="contain" />{productName(product)}<Plus /></button>)}</div> : null}</aside>
    </div>
  </div></main>;
}

function StudioSectionTitle({ index, title }: { index: string; title: string }) { return <div className="flower-design-studio__section-title"><span>{index}</span><h2>{title}</h2></div>; }
function StudioFlowerRow({ product, quantities, onChange }: { product: CatalogProduct; quantities: Record<string, number>; onChange: (product: CatalogProduct, variant: Variant | null, delta: number) => void }) { const unavailable = product.stock <= 0; return <article className={cn("flower-design-studio__flower-row", unavailable && "is-unavailable")}><ProductImage product={product} className="flower-design-studio__flower-image" objectFit="contain" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h3>{productName(product)}</h3><p>{categoryOf(product).label}</p></div><b>{formatCurrency(product.price)}</b></div>{product.variants.length ? <div className="flower-design-studio__variant-list">{product.variants.map((variant) => <div key={variant.id}><span style={{ backgroundColor: variant.colorHex || "transparent" }} /><label>{variant.color || variant.sku || "خيار"}</label><MiniQuantity quantity={quantities[selectionKey(product.id, variant.id)] ?? 0} max={Math.max(0, variant.available ?? variant.stock)} onChange={(delta) => onChange(product, variant, delta)} /></div>)}</div> : <div className="mt-2 flex items-center justify-between"><small>المتاح {product.stock}</small><MiniQuantity quantity={quantities[selectionKey(product.id)] ?? 0} max={product.stock} onChange={(delta) => onChange(product, null, delta)} /></div>}</div></article>; }
function StudioOptionShelf({ index, title, products, quantities, onChange, empty }: { index: string; title: string; products: CatalogProduct[]; quantities: Record<string, number>; onChange: (product: CatalogProduct, variant: Variant | null, delta: number) => void; empty: string }) { return <section className="flower-design-studio__option-shelf"><StudioSectionTitle index={index} title={title} />{products.length ? <div>{products.slice(0, 6).map((product) => <StudioOptionCard key={product.id} product={product} quantities={quantities} onChange={onChange} />)}</div> : <p>{empty}</p>}</section>; }
function StudioOptionCard({ product, quantities, onChange }: { product: CatalogProduct; quantities: Record<string, number>; onChange: (product: CatalogProduct, variant: Variant | null, delta: number) => void }) { const options = product.variants.length ? product.variants : [null]; return <article className="flower-design-studio__option-card"><ProductImage product={product} variant={options[0]} className="h-16 w-full" objectFit="contain" /><h3>{productName(product)}</h3>{options.slice(0, 4).map((variant) => { const max = variant ? Math.max(0, variant.available ?? variant.stock) : product.stock; const quantity = quantities[selectionKey(product.id, variant?.id)] ?? 0; return <div key={variant?.id ?? "base"} className={cn("flower-design-studio__option-variant", quantity > 0 && "is-selected", max <= 0 && "is-unavailable")}><span style={{ backgroundColor: variant?.colorHex || "transparent" }} title={variant?.color || undefined} /><b>{formatCurrency(variant?.price ?? product.price)}</b><MiniQuantity quantity={quantity} max={max} onChange={(delta) => onChange(product, variant, delta)} /></div>; })}</article>; }
function StudioSummary({ selected, subtotal, discount, note, setNote, isAdding, unavailable, onAdd, onRemove, onDuplicate, onChange }: { selected: Selection[]; subtotal: number; discount: number; note: string; setNote: (value: string) => void; isAdding: boolean; unavailable: boolean; onAdd: () => void; onRemove: (line: Selection) => void; onDuplicate: (line: Selection) => void; onChange: (line: Selection, delta: number) => void }) { return <section className="flower-design-studio__summary"><h2>ملخص الطلب</h2><div className="flower-design-studio__summary-lines">{selected.length ? selected.map((line) => <SelectionRow key={line.key} line={line} onRemove={onRemove} onDuplicate={onDuplicate} onChange={onChange} onDragStart={() => {}} />) : <p>لم تختر أي عناصر بعد.</p>}</div><label>بطاقة الإهداء <small>(اختياري)</small><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="رسالة البطاقة" /></label><div className="flower-design-studio__totals"><SummaryRow label="العناصر" value={subtotal} />{discount > 0 ? <SummaryRow label="الخصم" value={-discount} className="text-status-success" /> : null}<div><span>الإجمالي</span><b>{formatCurrency(subtotal)}</b></div></div><Button disabled={!selected.length || isAdding || unavailable} onClick={onAdd}><ShoppingBag />{isAdding ? "جارٍ التحقق..." : "إضافة إلى السلة"}</Button></section>; }
function BouquetPreview({ selected, note, onDropLine }: { selected: Selection[]; note: string; onDropLine: (dragged: string, target: string) => void }) { const [dragging, setDragging] = useState(""); const roles = useMemo(() => selected.map((line) => ({ line, role: previewRole(line) })), [selected]); const layers = useMemo(() => compositionLayers(selected), [selected]); const wrapping = roles.filter((entry) => entry.role === "wrapping").at(-1)?.line; const ribbon = roles.filter((entry) => entry.role === "ribbon").at(-1)?.line; const card = roles.filter((entry) => entry.role === "gift-card").at(-1)?.line; return <div className="flower-design-studio__preview-frame"><div className="flower-design-studio__preview-tools"><span>معاينة واقعية</span><span>تحديث مباشر</span></div><div className="bouquet-studio" aria-live="polite" aria-label="معاينة الباقة الحية">{selected.length ? <>{wrapping ? <RealProductLayer line={wrapping} className="bouquet-studio__wrapping" priority /> : null}<div className="bouquet-studio__stem-shadow" aria-hidden="true" />{layers.map((layer) => <button key={layer.id} type="button" draggable onDragStart={(event) => { setDragging(layer.line.key); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging) onDropLine(dragging, layer.line.key); setDragging(""); }} className="bouquet-studio__layer" style={{ left: `${layer.x}%`, top: `${layer.y}%`, zIndex: layer.z, transform: `translate(-50%, -50%) rotate(${layer.rotate}deg) scale(${layer.scale})` }} aria-label={`إعادة ترتيب ${productName(layer.line.product)}`}><RealProductLayer line={layer.line} sourceIndex={layer.sourceIndex} /></button>)}{card ? <div className="bouquet-studio__card"><RealProductLayer line={card} sourceIndex={1} /></div> : null}{ribbon ? <RealProductLayer line={ribbon} className="bouquet-studio__ribbon" sourceIndex={1} priority /> : null}<div className="bouquet-studio__selection-bar">{selected.map((line) => <button key={line.key} type="button" draggable onDragStart={(event) => { setDragging(line.key); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging) onDropLine(dragging, line.key); setDragging(""); }} className="bouquet-studio__selection"><ProductImage product={line.product} variant={line.variant} className="h-full w-full" objectFit="contain" /><span>×{line.quantity}</span><GripVertical /></button>)}</div></> : <div className="flower-design-studio__preview-empty"><Flower2 /><p>ابدأ باختيار الورود لتظهر الباقة هنا</p></div>}</div>{note ? <p className="flower-design-studio__preview-note">بطاقة الإهداء: {note}</p> : null}</div>; }
function RealProductLayer({ line, sourceIndex = 0, className, priority = false }: { line: Selection; sourceIndex?: number; className?: string; priority?: boolean }) { const sources = selectedMedia(line, sourceIndex); const [attempt, setAttempt] = useState(0); const src = sources[attempt]; useEffect(() => setAttempt(0), [line.key, sourceIndex, sources.join("|")]); if (!src) return null; return <img src={src} alt={productName(line.product)} className={cn("bouquet-studio__photo", className)} loading="eager" decoding="async" fetchPriority={priority ? "high" : "auto"} onError={() => setAttempt((current) => current + 1 < sources.length ? current + 1 : current)} />; }
function SelectionRow({ line, onRemove, onDuplicate, onChange }: { line: Selection; onRemove: (line: Selection) => void; onDuplicate: (line: Selection) => void; onChange: (line: Selection, delta: number) => void; onDragStart: () => void }) { return <div className="flower-design-studio__summary-row"><ProductImage product={line.product} variant={line.variant} className="h-9 w-9 shrink-0" objectFit="contain" /><span>{productName(line.product)}{line.variant?.color ? ` · ${line.variant.color}` : ""}</span><MiniQuantity quantity={line.quantity} max={available(line)} onChange={(delta) => onChange(line, delta)} /><Button variant="ghost" size="icon" title="تكرار" onClick={() => onDuplicate(line)}><Copy /></Button><Button variant="ghost" size="icon" title="حذف" onClick={() => onRemove(line)}><Trash2 /></Button></div>; }
function ReplacementPanel({ lines, replacements, onReplace }: { lines: Selection[]; replacements: Array<{ line: Selection; candidate: CatalogProduct }>; onReplace: (line: Selection, candidate: CatalogProduct) => void }) { return <section className="flower-design-studio__warning"><h2>نفذت كمية بعض الاختيارات</h2>{lines.map((line) => <div key={line.key}><span>{productName(line.product)}</span>{replacements.filter((item) => item.line.key === line.key).map(({ candidate }) => <Button key={candidate.id} variant="ghost" size="sm" onClick={() => onReplace(line, candidate)}>استبدال بـ {productName(candidate)}</Button>)}</div>)}</section>; }
function ProductImage({ product, variant, className, objectFit = "cover" }: { product: CatalogProduct; variant?: Variant | null; className: string; objectFit?: string }) { const [failed, setFailed] = useState(false); const src = variant?.image || product.images?.[0]; useEffect(() => setFailed(false), [src]); if (!src || failed) return <span className={cn("grid place-items-center bg-muted text-muted-foreground", className)}><ImageOff className="h-5 w-5" /></span>; return <img src={src} alt={productName(product)} className={cn("object-cover", className)} style={{ objectFit: objectFit as any }} loading="lazy" decoding="async" onError={() => setFailed(true)} />; }
function CategoryButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={cn("flower-design-studio__category", active && "is-active")}>{children}</button>; }
function MiniQuantity({ quantity, max, onChange }: { quantity: number; max: number; onChange: (delta: number) => void }) { return <div className="flower-design-studio__quantity"><button type="button" disabled={!quantity} onClick={() => onChange(-1)}><Minus /></button><span>{quantity}</span><button type="button" disabled={max <= quantity} onClick={() => onChange(1)}><Plus /></button></div>; }
function SummaryRow({ label, value, className }: { label: string; value: number; className?: string }) { return <p className={className}><span>{label}</span><b>{value < 0 ? "−" : ""}{formatCurrency(Math.abs(value))}</b></p>; }
function StudioEmpty({ text, action }: { text: string; action?: () => void }) { return <div className="flower-design-studio__empty"><Package /><p>{text}</p>{action ? <Button variant="ghost" onClick={action}>إعادة المحاولة</Button> : null}</div>; }
function StudioSkeleton() { return <div className="flower-design-studio__flower-list">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flower-design-studio__flower-row"><Skeleton className="h-20 w-20" /><div className="flex-1 space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-7 w-full" /></div></div>)}</div>; }
function unitPrice(line: Selection) { return Number(line.variant?.price ?? line.product.price ?? 0); }
function available(line: Selection) { return Math.max(0, Number(line.variant?.available ?? line.variant?.stock ?? (line.product.variants.length ? 0 : line.product.stock) ?? 0)); }
