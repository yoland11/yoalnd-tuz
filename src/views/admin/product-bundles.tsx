import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, PackagePlus, Plus, Save, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type ComponentRow = { productId: number; quantity: string };
const blank = () => ({ name: "", description: "", barcode: "", normalPrice: "0", offerPrice: "0", isActive: true, showInStore: false, showInSalesInvoices: true, items: [] as ComponentRow[] });

export default function ProductBundlesPage() {
  const { toast } = useToast(); const client = useQueryClient();
  const [form, setForm] = useState(blank); const [saving, setSaving] = useState(false);
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["admin", "products-all"], queryFn: () => adminFetch("/admin/products?limit=2000"), staleTime: 60_000 });
  const { data: bundles = [] } = useQuery<any[]>({ queryKey: ["admin", "product-bundles"], queryFn: async () => (await adminFetch<{ bundles: any[] }>("/admin/product-bundles")).bundles ?? [] });
  const chosen = useMemo(() => new Set(form.items.map((item) => item.productId)), [form.items]);
  async function save() {
    if (!form.name.trim() || !form.items.length) { toast({ title: "أدخل اسم العرض ومكوناً واحداً على الأقل", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/admin/product-bundles", { method: "POST", body: JSON.stringify({ ...form, normalPrice: Number(form.normalPrice), offerPrice: Number(form.offerPrice), items: form.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })) }) });
      toast({ title: "تم حفظ العرض والبكج بنجاح" }); setForm(blank()); client.invalidateQueries({ queryKey: ["admin", "product-bundles"] });
    } catch (error) { toast({ title: "تعذر حفظ العرض", description: apiErrorMessage(error), variant: "destructive" }); } finally { setSaving(false); }
  }
  return <div className="mx-auto max-w-6xl space-y-5 p-4" dir="rtl">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">العروض والبكجات</h1><p className="text-sm text-muted-foreground">يُخصم مخزون المكونات تلقائياً عند بيع العرض.</p></div><Button variant="outline" asChild><Link href="/admin/products"><ArrowRight className="ml-2 h-4 w-4" />المنتجات</Link></Button></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]"><section className="rounded-xl border bg-card p-4 space-y-3"><h2 className="font-semibold flex items-center gap-2"><PackagePlus className="h-5 w-5" />إضافة عرض</h2><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم العرض" className="w-full rounded border bg-background p-2" /><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="الوصف" className="w-full rounded border bg-background p-2" /><div className="grid grid-cols-2 gap-2"><input type="number" value={form.normalPrice} onChange={(e) => setForm({ ...form, normalPrice: e.target.value })} placeholder="السعر الطبيعي" className="rounded border bg-background p-2" /><input type="number" value={form.offerPrice} onChange={(e) => setForm({ ...form, offerPrice: e.target.value })} placeholder="سعر العرض" className="rounded border bg-background p-2" /></div><input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="الباركود (اختياري)" className="w-full rounded border bg-background p-2" />
      <div className="space-y-2"><p className="text-sm font-medium">المكونات</p>{form.items.map((item, index) => <div key={item.productId} className="flex gap-2"><span className="flex-1 rounded bg-muted px-2 py-1.5 text-sm">{products.find((p) => p.id === item.productId)?.nameAr ?? item.productId}</span><input type="number" step="0.001" min="0.001" value={item.quantity} onChange={(e) => setForm({ ...form, items: form.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: e.target.value } : row) })} className="w-24 rounded border bg-background p-1.5" /><Button size="icon" variant="ghost" onClick={() => setForm({ ...form, items: form.items.filter((_, rowIndex) => rowIndex !== index) })}><Trash2 className="h-4 w-4" /></Button></div>)}<select value="" onChange={(e) => { const productId = Number(e.target.value); if (productId) setForm({ ...form, items: [...form.items, { productId, quantity: "1" }] }); }} className="w-full rounded border bg-background p-2"><option value="">إضافة منتج كمكوّن…</option>{products.filter((p) => p.isActive && !chosen.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.nameAr || p.name}</option>)}</select></div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.showInSalesInvoices} onChange={(e) => setForm({ ...form, showInSalesInvoices: e.target.checked })} />إظهار في فواتير المبيعات</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.showInStore} onChange={(e) => setForm({ ...form, showInStore: e.target.checked })} />إظهار في المتجر</label><Button className="w-full" disabled={saving} onClick={() => void save()}><Save className="ml-2 h-4 w-4" />{saving ? "جاري الحفظ…" : "حفظ العرض"}</Button></section>
      <section className="rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">العروض الحالية</h2><div className="space-y-2">{bundles.map((bundle) => <div key={bundle.id} className="rounded-lg border p-3"><div className="flex justify-between gap-3"><strong>{bundle.name}</strong><span className="text-primary">{formatCurrency(bundle.offerPrice)}</span></div><p className="mt-1 text-xs text-muted-foreground">متاح للبيع: {bundle.availableQuantity} · {bundle.items?.map((item: any) => `${item.productNameAr || item.productName} × ${item.quantity}`).join("، ")}</p></div>)}{!bundles.length && <p className="py-10 text-center text-sm text-muted-foreground">لا توجد عروض بعد.</p>}</div></section></div>
  </div>;
}
