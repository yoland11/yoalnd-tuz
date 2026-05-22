import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { Plus, Edit2, Trash2, X, Search, Upload, Boxes, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, fileToDataUrl, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type Category = { id: number; name: string; nameAr: string; slug: string; parentId: number | null; sortOrder: number; isActive: boolean };

type ProductForm = {
  id?: number;
  name: string; nameAr: string;
  description?: string; descriptionAr?: string;
  price: string; originalPrice?: string;
  stock: string;
  category?: string; subcategory?: string;
  images: string[]; colors: string[];
  isFeatured: boolean; isActive?: boolean;
};

const blank: ProductForm = {
  name: "", nameAr: "", price: "0", stock: "0",
  images: [], colors: [], isFeatured: false, isActive: true,
};

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useListProducts({});
  const { data: categories } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminFetch<Category[]>("/admin/categories"),
  });
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();

  const [editing, setEditing] = useState<ProductForm | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [view, setView] = useState<"list" | "stock">("list");
  const [stockDrafts, setStockDrafts] = useState<Record<number, string>>({});

  const filtered = useMemo(() => {
    let rows = products ?? [];
    if (catFilter) rows = rows.filter((p: any) => p.category === catFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(p => p.nameAr.toLowerCase().includes(s) || p.name.toLowerCase().includes(s));
    }
    return rows;
  }, [products, search, catFilter]);

  const parentCats = categories?.filter(c => !c.parentId) ?? [];
  const subCats = categories?.filter(c => c.parentId) ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
  }

  async function save(form: ProductForm) {
    const body = {
      name: form.name, nameAr: form.nameAr,
      description: form.description ?? null, descriptionAr: form.descriptionAr ?? null,
      price: parseFloat(form.price) || 0,
      originalPrice: form.originalPrice ? parseFloat(form.originalPrice) : null,
      stock: parseInt(form.stock) || 0,
      category: form.category || null, subcategory: form.subcategory || null,
      images: form.images, colors: form.colors,
      isFeatured: form.isFeatured,
      ...(form.isActive !== undefined ? { isActive: form.isActive } : {}),
    } as any;

    if (form.id) {
      await update.mutateAsync({ id: form.id, data: body });
    } else {
      await create.mutateAsync({ data: body });
    }
    invalidate();
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">إدارة المتجر</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-card rounded-lg border border-border/40 p-0.5">
            <button onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded text-xs ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>المنتجات</button>
            <button onClick={() => setView("stock")}
              className={`px-3 py-1.5 rounded text-xs inline-flex items-center gap-1.5 ${view === "stock" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              <Boxes className="w-3.5 h-3.5" /> المخزون
            </button>
          </div>
          <Button onClick={() => setEditing({ ...blank })} size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> إضافة منتج
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث عن منتج..."
            className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
          <option value="">كل التصنيفات</option>
          {parentCats.map(c => <option key={c.id} value={c.slug}>{c.nameAr}</option>)}
        </select>
      </div>

      {view === "stock" ? (
        isLoading ? <Skeleton className="h-64 rounded-xl" /> : filtered.length === 0 ? <EmptyState message="لا توجد منتجات" /> : (
          <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background/50">
                  <tr className="text-muted-foreground border-b border-border/30">
                    <th className="text-right p-3 font-medium">المنتج</th>
                    <th className="text-right p-3 font-medium">السعر</th>
                    <th className="text-right p-3 font-medium w-40">المخزون</th>
                    <th className="text-right p-3 font-medium w-32">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {filtered.map((p: any) => {
                    const draft = stockDrafts[p.id];
                    const dirty = draft !== undefined && draft !== String(p.stock);
                    return (
                      <tr key={p.id} className="hover:bg-background/30">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            {p.images?.[0]
                              ? <img src={p.images[0]} className="w-10 h-10 rounded-lg object-cover" alt="" />
                              : <div className="w-10 h-10 rounded-lg bg-background border border-border/30" />}
                            <span className="font-medium text-foreground">{p.nameAr}</span>
                          </div>
                        </td>
                        <td className="p-3 text-primary">{formatCurrency(p.price)}</td>
                        <td className="p-3">
                          <input type="number" min={0}
                            value={draft ?? String(p.stock)}
                            onChange={e => setStockDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                            className={`w-24 bg-background border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary/50 ${dirty ? "border-primary" : "border-border/40"} ${p.stock === 0 ? "text-red-400" : ""}`} />
                        </td>
                        <td className="p-3">
                          {dirty && (
                            <button onClick={async () => {
                              await update.mutateAsync({ id: p.id, data: { name: p.name, nameAr: p.nameAr, price: Number(p.price), stock: parseInt(draft) || 0 } });
                              setStockDrafts(d => { const c = { ...d }; delete c[p.id]; return c; });
                              invalidate();
                            }} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                              <Save className="w-3.5 h-3.5" /> حفظ
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : isLoading ? <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      : filtered.length === 0 ? <EmptyState message="لا توجد منتجات" /> : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">المنتج</th>
                  <th className="text-right p-3 font-medium">السعر</th>
                  <th className="text-right p-3 font-medium">المخزون</th>
                  <th className="text-right p-3 font-medium">التصنيف</th>
                  <th className="text-right p-3 font-medium">الحالة</th>
                  <th className="text-right p-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filtered.map((p: any) => (
                  <tr key={p.id} className="hover:bg-background/30">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {p.images?.[0]
                          ? <img src={p.images[0]} className="w-12 h-12 rounded-lg object-cover" alt="" />
                          : <div className="w-12 h-12 rounded-lg bg-background border border-border/30" />}
                        <div>
                          <p className="font-medium text-foreground">{p.nameAr}</p>
                          <p className="text-xs text-muted-foreground">{p.name}</p>
                          {p.isFeatured && <span className="text-xs text-primary">★ مميز</span>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-primary font-semibold">{formatCurrency(p.price)}</td>
                    <td className="p-3"><span className={p.stock === 0 ? "text-red-400" : "text-green-400"}>{p.stock}</span></td>
                    <td className="p-3 text-muted-foreground">{p.category ?? "—"}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${p.isActive === false ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
                        {p.isActive === false ? "مخفي" : "ظاهر"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditing({
                          id: p.id, name: p.name, nameAr: p.nameAr,
                          description: p.description ?? "", descriptionAr: p.descriptionAr ?? "",
                          price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : "",
                          stock: String(p.stock),
                          category: p.category ?? "", subcategory: p.subcategory ?? "",
                          images: p.images ?? [], colors: p.colors ?? [],
                          isFeatured: !!p.isFeatured, isActive: p.isActive !== false,
                        })} className="text-primary hover:bg-primary/10 p-2 rounded-lg">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => confirm("حذف المنتج؟") && remove.mutateAsync({ id: p.id }).then(invalidate)} className="text-red-400 hover:bg-red-500/10 p-2 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <ProductFormModal form={editing} onChange={setEditing} onClose={() => setEditing(null)} onSave={save} parentCats={parentCats} subCats={subCats} />}
    </div>
  );
}

function ProductFormModal({ form, onChange, onClose, onSave, parentCats, subCats }: {
  form: ProductForm; onChange: (f: ProductForm) => void; onClose: () => void;
  onSave: (f: ProductForm) => Promise<void>;
  parentCats: Category[]; subCats: Category[];
}) {
  const [busy, setBusy] = useState(false);
  const filteredSubs = subCats.filter(s => {
    const parent = parentCats.find(p => p.slug === form.category);
    return parent ? s.parentId === parent.id : true;
  });

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const dataUrls = await Promise.all(Array.from(files).map(fileToDataUrl));
    onChange({ ...form, images: [...form.images, ...dataUrls] });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <form
        onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave(form); } finally { setBusy(false); } }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground">{form.id ? "تعديل منتج" : "منتج جديد"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Inp label="الاسم بالعربي *" value={form.nameAr} onChange={v => onChange({ ...form, nameAr: v })} required />
          <Inp label="الاسم بالإنجليزي *" value={form.name} onChange={v => onChange({ ...form, name: v })} required />
          <Inp label="السعر *" type="number" value={form.price} onChange={v => onChange({ ...form, price: v })} required />
          <Inp label="السعر الأصلي (اختياري)" type="number" value={form.originalPrice ?? ""} onChange={v => onChange({ ...form, originalPrice: v })} />
          <Inp label="المخزون *" type="number" value={form.stock} onChange={v => onChange({ ...form, stock: v })} required />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">القسم الرئيسي</label>
            <select value={form.category ?? ""} onChange={e => onChange({ ...form, category: e.target.value, subcategory: "" })}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
              <option value="">—</option>
              {parentCats.map(c => <option key={c.id} value={c.slug}>{c.nameAr}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">القسم الفرعي</label>
            <select value={form.subcategory ?? ""} onChange={e => onChange({ ...form, subcategory: e.target.value })}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
              <option value="">—</option>
              {filteredSubs.map(c => <option key={c.id} value={c.slug}>{c.nameAr}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">الوصف (عربي)</label>
          <textarea value={form.descriptionAr ?? ""} onChange={e => onChange({ ...form, descriptionAr: e.target.value })} rows={3}
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">الصور</label>
            <label className="inline-flex items-center gap-1 text-xs text-primary cursor-pointer hover:underline">
              <Upload className="w-3.5 h-3.5" /> رفع
              <input type="file" multiple accept="image/*" onChange={e => handleFiles(e.target.files)} className="hidden" />
            </label>
          </div>
          {form.images.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {form.images.map((img, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border/30">
                  <img src={img} className="w-full h-full object-cover" alt="" />
                  <button type="button" onClick={() => onChange({ ...form, images: form.images.filter((_, idx) => idx !== i) })}
                    className="absolute top-0.5 left-0.5 bg-black/70 text-white p-0.5 rounded">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">الألوان (افصل بفواصل)</label>
          <input value={form.colors.join(", ")} onChange={e => onChange({ ...form, colors: e.target.value.split(",").map(c => c.trim()).filter(Boolean) })}
            placeholder="ذهبي, أبيض, أحمر"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
          {form.colors.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {form.colors.map((c, i) => <span key={i} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{c}</span>)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isFeatured} onChange={e => onChange({ ...form, isFeatured: e.target.checked })} className="accent-primary" />
            منتج مميز
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive ?? true} onChange={e => onChange({ ...form, isActive: e.target.checked })} className="accent-primary" />
            ظاهر للزبائن
          </label>
        </div>

        <Button type="submit" disabled={busy} className="w-full">{busy ? "جاري الحفظ..." : "حفظ"}</Button>
      </form>
    </div>
  );
}

function Inp({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
    </div>
  );
}
