import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, Edit3, PackagePlus, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ImageUploadEditor } from "@/components/image-upload-editor";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type ComponentRow = { productId: number; quantity: string };
type BundleForm = {
  id?: number; name: string; image: string; description: string; barcode: string;
  normalPrice: string; offerPrice: string; deliveryFee: string; startsAt: string; endsAt: string;
  isActive: boolean; showInStore: boolean; showInSalesInvoices: boolean; items: ComponentRow[];
};
const blank = (): BundleForm => ({ name: "", image: "", description: "", barcode: "", normalPrice: "0", offerPrice: "0", deliveryFee: "0", startsAt: "", endsAt: "", isActive: true, showInStore: false, showInSalesInvoices: true, items: [] });
const inputDateTime = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";
const isoOrNull = (value: string) => value ? new Date(value).toISOString() : null;

function productName(product: any) { return product?.nameAr || product?.name || "منتج"; }

export default function ProductBundlesPage() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<BundleForm>(blank);
  const [saving, setSaving] = useState(false);
  const [componentSearch, setComponentSearch] = useState("");
  const [offerSearch, setOfferSearch] = useState("");
  const [confirming, setConfirming] = useState<any | null>(null);
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["admin", "products-all"], queryFn: () => adminFetch("/admin/products?limit=2000"), staleTime: 60_000 });
  const { data: bundles = [], isLoading } = useQuery<any[]>({ queryKey: ["admin", "product-bundles"], queryFn: async () => (await adminFetch<{ bundles: any[] }>("/admin/product-bundles")).bundles ?? [] });
  const selectedIds = useMemo(() => new Set(form.items.map((item) => item.productId)), [form.items]);
  const normalizedComponentSearch = componentSearch.trim().toLowerCase();
  const componentResults = useMemo(() => !normalizedComponentSearch ? [] : products.filter((product) => {
    const source = [product.name, product.nameAr, product.barcode, product.category, product.subcategory].filter(Boolean).join(" ").toLowerCase();
    return product.isActive && !selectedIds.has(product.id) && source.includes(normalizedComponentSearch);
  }).slice(0, 12), [products, normalizedComponentSearch, selectedIds]);
  const visibleBundles = useMemo(() => {
    const query = offerSearch.trim().toLowerCase();
    if (!query) return bundles;
    return bundles.filter((bundle) => [bundle.name, bundle.barcode, bundle.description].filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [bundles, offerSearch]);

  function refresh() { return client.invalidateQueries({ queryKey: ["admin", "product-bundles"] }); }
  function edit(bundle: any) {
    setForm({
      id: bundle.id, name: bundle.name ?? "", image: bundle.image ?? "", description: bundle.description ?? "", barcode: bundle.barcode ?? "",
      normalPrice: String(bundle.normalPrice ?? 0), offerPrice: String(bundle.offerPrice ?? 0), deliveryFee: String(bundle.deliveryFee ?? 0),
      startsAt: inputDateTime(bundle.startsAt), endsAt: inputDateTime(bundle.endsAt),
      isActive: bundle.isActive !== false, showInStore: Boolean(bundle.showInStore), showInSalesInvoices: bundle.showInSalesInvoices !== false,
      items: (bundle.items ?? []).map((item: any) => ({ productId: Number(item.productId), quantity: String(item.quantity) })),
    });
    setComponentSearch(""); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function addComponent(product: any) {
    if (selectedIds.has(product.id)) return;
    setForm((current) => ({ ...current, items: [...current.items, { productId: product.id, quantity: "1" }] }));
    setComponentSearch("");
  }
  async function save() {
    if (!form.name.trim() || !form.items.length) { toast({ title: "أدخل اسم العرض ومكوناً واحداً على الأقل", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const endpoint = form.id ? `/admin/product-bundles/${form.id}` : "/admin/product-bundles";
      await adminFetch(endpoint, { method: form.id ? "PUT" : "POST", body: JSON.stringify({ ...form, id: undefined, startsAt: isoOrNull(form.startsAt), endsAt: isoOrNull(form.endsAt), normalPrice: Number(form.normalPrice), offerPrice: Number(form.offerPrice), deliveryFee: Number(form.deliveryFee), items: form.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })) }) });
      toast({ title: form.id ? "تم تحديث العرض" : "تم حفظ العرض والبكج بنجاح", description: "الفواتير السابقة تستخدم لقطات المكونات المحفوظة عند البيع." });
      setForm(blank()); await refresh();
    } catch (error) { toast({ title: "تعذر حفظ العرض", description: apiErrorMessage(error), variant: "destructive" }); } finally { setSaving(false); }
  }
  async function toggle(bundle: any) {
    try { await adminFetch(`/admin/product-bundles/${bundle.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !bundle.isActive }) }); toast({ title: bundle.isActive ? "تم إيقاف العرض" : "تم تفعيل العرض" }); await refresh(); }
    catch (error) { toast({ title: "تعذر تغيير حالة العرض", description: apiErrorMessage(error), variant: "destructive" }); }
  }
  async function remove() {
    if (!confirming) return;
    try { const result = await adminFetch<{ operation: "deleted" | "archived" }>(`/admin/product-bundles/${confirming.id}`, { method: "DELETE" }); toast({ title: result.operation === "archived" ? "تمت أرشفة العرض لحماية تاريخ الفواتير" : "تم حذف العرض" }); if (form.id === confirming.id) setForm(blank()); setConfirming(null); await refresh(); }
    catch (error) { toast({ title: "تعذر حذف العرض", description: apiErrorMessage(error), variant: "destructive" }); }
  }

  return <div className="mx-auto max-w-7xl space-y-5 p-4" dir="rtl">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-foreground">العروض والبكجات</h1><p className="mt-1 text-sm text-muted-foreground">عرض واحد في الفاتورة، وخصم تلقائي ودقيق من مكونات المخزون.</p></div><Button variant="outline" asChild><Link href="/admin/products"><ArrowRight className="ml-2 h-4 w-4" />المنتجات والمخزون</Link></Button></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
      <section className="rounded-xl border border-border/40 bg-card p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><PackagePlus className="h-5 w-5 text-primary" />{form.id ? "تعديل العرض" : "إضافة عرض"}</h2>{form.id ? <Button size="sm" variant="ghost" onClick={() => setForm(blank())}><X className="ml-1 h-4 w-4" />إلغاء التعديل</Button> : null}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="اسم العرض"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="عرض الحنة" /></Field><Field label="الباركود"><input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} placeholder="اختياري" dir="ltr" /></Field></div>
        <Field label="الوصف"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="وصف مختصر للعرض" rows={2} /></Field>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="السعر الطبيعي"><input type="number" min="0" value={form.normalPrice} onChange={(event) => setForm({ ...form, normalPrice: event.target.value })} dir="ltr" /></Field><Field label="سعر العرض"><input type="number" min="0" value={form.offerPrice} onChange={(event) => setForm({ ...form, offerPrice: event.target.value })} dir="ltr" /></Field><Field label="أجور التوصيل (اختياري)"><input type="number" min="0" value={form.deliveryFee} onChange={(event) => setForm({ ...form, deliveryFee: event.target.value })} dir="ltr" /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="يبدأ في"><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></Field><Field label="ينتهي في"><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></Field></div>
        <div className="rounded-lg border border-border/40 bg-background/40 p-3"><p className="mb-2 text-sm font-medium">صورة العرض</p><ImageUploadEditor kind="product" currentImage={form.image || null} label="اختيار أو تغيير الصورة" onComplete={(results) => { const result = results[0]; const stored = result?.metadata.largeUrl || result?.metadata.originalUrl || result?.dataUrl; if (stored) setForm((current) => ({ ...current, image: stored })); }} onRemove={() => setForm((current) => ({ ...current, image: "" }))} /></div>
        <div className="space-y-2 rounded-lg border border-border/40 p-3"><div className="flex items-center justify-between"><p className="text-sm font-semibold">مكوّنات العرض</p><span className="text-xs text-muted-foreground">لا يمكن تكرار المنتج</span></div><div className="relative"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={componentSearch} onChange={(event) => setComponentSearch(event.target.value)} placeholder="ابحث بالاسم أو الباركود أو التصنيف…" className="pr-9" />{componentSearch && <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-popover shadow-lg">{componentResults.map((product) => <button key={product.id} type="button" onClick={() => addComponent(product)} className="flex w-full items-center justify-between gap-3 border-b border-border/30 px-3 py-2.5 text-right text-sm last:border-0 hover:bg-muted/60"><span className="min-w-0"><strong className="block truncate">{productName(product)}</strong><span className="block truncate text-xs text-muted-foreground">{product.category || product.subcategory || "بدون تصنيف"}{product.barcode ? ` · ${product.barcode}` : ""}</span></span><span className="shrink-0 text-left text-xs"><b className="block">مخزون: {product.stock}</b><span className="text-muted-foreground">{formatCurrency(product.price)}</span></span></button>)}{!componentResults.length ? <p className="p-3 text-sm text-muted-foreground">لا توجد منتجات مطابقة أو أنها مضافة بالفعل.</p> : null}</div>}</div>
          <div className="space-y-2">{form.items.map((item, index) => { const product = products.find((row) => row.id === item.productId); return <div key={item.productId} className="flex items-center gap-2 rounded-lg bg-muted/50 p-2"><span className="min-w-0 flex-1"><b className="block truncate text-sm">{productName(product)}</b><small className="text-muted-foreground">المخزون: {product?.stock ?? "—"} · {formatCurrency(product?.price ?? 0)}</small></span><input aria-label="كمية المكون" type="number" step="0.001" min="0.001" value={item.quantity} onChange={(event) => setForm({ ...form, items: form.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row) })} className="w-24" dir="ltr" /><Button size="icon" variant="ghost" aria-label="حذف المكون" onClick={() => setForm({ ...form, items: form.items.filter((_, rowIndex) => rowIndex !== index) })}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>; })}{!form.items.length ? <p className="py-4 text-center text-sm text-muted-foreground">ابحث عن منتج لإضافته كمكوّن.</p> : null}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3"><Toggle label="نشط" checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} /><Toggle label="إظهار بالمتجر" checked={form.showInStore} onChange={(showInStore) => setForm({ ...form, showInStore })} /><Toggle label="إظهار بالفواتير" checked={form.showInSalesInvoices} onChange={(showInSalesInvoices) => setForm({ ...form, showInSalesInvoices })} /></div>
        <Button className="w-full" disabled={saving} onClick={() => void save()}><Save className="ml-2 h-4 w-4" />{saving ? "جاري الحفظ…" : form.id ? "حفظ التعديلات" : "حفظ العرض"}</Button>
      </section>
      <section className="rounded-xl border border-border/40 bg-card p-4 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">إدارة العروض</h2><p className="text-xs text-muted-foreground">التعديل لا يغير فواتير أو لقطات عروض سابقة.</p></div><div className="relative w-full sm:w-64"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={offerSearch} onChange={(event) => setOfferSearch(event.target.value)} placeholder="بحث في العروض…" className="pr-9" /></div></div><div className="space-y-2">{isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">جاري التحميل…</p> : visibleBundles.map((bundle) => <article key={bundle.id} className={`rounded-lg border p-3 ${bundle.archivedAt ? "border-dashed opacity-65" : "border-border/40"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{bundle.name}</strong>{bundle.archivedAt ? <Status label="مؤرشف" muted /> : <Status label={bundle.isActive ? "نشط" : "متوقف"} success={bundle.isActive} />}{bundle.showInSalesInvoices ? <Status label="فواتير" /> : null}</div><p className="mt-1 text-xs text-muted-foreground">متاح للبيع: {bundle.availableQuantity} · {(bundle.items ?? []).map((item: any) => `${item.productNameAr || item.productName} × ${item.quantity}`).join("، ")}</p></div><span className="shrink-0 font-semibold text-primary">{formatCurrency(bundle.offerPrice)}</span></div><div className="mt-3 flex flex-wrap gap-2">{!bundle.archivedAt ? <><Button size="sm" variant="outline" onClick={() => edit(bundle)}><Edit3 className="ml-1 h-4 w-4" />تعديل</Button><Button size="sm" variant="outline" onClick={() => void toggle(bundle)}>{bundle.isActive ? "إيقاف" : "تفعيل"}</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(bundle)}><Trash2 className="ml-1 h-4 w-4" />حذف</Button></> : <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Archive className="h-4 w-4" />محفوظ لحماية تاريخ الفواتير</span>}</div></article>)}{!isLoading && !visibleBundles.length ? <p className="py-12 text-center text-sm text-muted-foreground">لا توجد عروض مطابقة.</p> : null}</div></section>
    </div>
    {confirming ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="presentation"><section className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="bundle-delete-title"><h2 id="bundle-delete-title" className="text-lg font-bold">حذف العرض؟</h2><p className="mt-2 text-sm text-muted-foreground">إذا استُخدم «{confirming.name}» في فاتورة سابقة، سيُؤرشف فقط ولن يُحذف تاريخ الفواتير أو المخزون.</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(null)}>إلغاء</Button><Button variant="destructive" onClick={() => void remove()}>تأكيد</Button></div></section></div> : null}
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
function Status({ label, success, muted }: { label: string; success?: boolean; muted?: boolean }) { return <span className={`rounded-full px-2 py-0.5 text-[11px] ${success ? "bg-status-success/15 text-status-success" : muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{label}</span>; }
