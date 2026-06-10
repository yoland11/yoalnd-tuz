import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { ArrowRight, Eye, Plus, Edit2, Trash2, X, Search, Upload, Boxes, Save, Star, Video, Play, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fileToDataUrl, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { usePublicSettings } from "@/lib/public-settings";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { inspectImageFile, type ImageMetadata } from "@/lib/image-tools";
import { ProductColorPicker, ProductColorDots } from "@/components/product-colors";
import { normalizeColors, type ProductColor } from "@/lib/colors";
import { AutoTranslateButton } from "./auto-translate-button";

type Category = { id: number; name: string; nameAr: string; slug: string; parentId: number | null; sortOrder: number; isActive: boolean };

type ProductForm = {
  id?: number;
  name: string; nameAr: string;
  nameKu?: string; nameTr?: string;
  description?: string; descriptionAr?: string;
  descriptionKu?: string; descriptionTr?: string;
  price: string; originalPrice?: string; costPrice?: string;
  stock: string; minStock?: string; barcode?: string;
  categoryId?: number | null; subcategoryId?: number | null;
  category?: string; subcategory?: string;
  images: string[]; videos: string[]; colors: ProductColor[];
  imageMetadata: ImageMetadata[];
  isFeatured: boolean; isActive?: boolean;
};

const blank: ProductForm = {
  name: "", nameAr: "", price: "0", costPrice: "0", stock: "0", minStock: "0", barcode: "",
  images: [], videos: [], imageMetadata: [], colors: [], isFeatured: false, isActive: true,
};

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: products, isLoading } = useListProducts({ limit: 250 });
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
    queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alert-count"] });
  }

  async function save(form: ProductForm) {
    const price = parseFloat(form.price) || 0;
    const parsedOriginalPrice = form.originalPrice ? parseFloat(form.originalPrice) : undefined;

    const body = {
      name: form.name.trim(),
      nameAr: form.nameAr.trim(),
      nameKu: form.nameKu?.trim() || "",
      nameTr: form.nameTr?.trim() || "",
      description: form.description?.trim() || "",
      descriptionAr: form.descriptionAr?.trim() || "",
      descriptionKu: form.descriptionKu?.trim() || "",
      descriptionTr: form.descriptionTr?.trim() || "",
      price,
      originalPrice: parsedOriginalPrice && parsedOriginalPrice > price ? parsedOriginalPrice : 0,
      costPrice: parseFloat(form.costPrice ?? "0") || 0,
      stock: parseInt(form.stock) || 0,
      minStock: parseInt(form.minStock ?? "0") || 0,
      barcode: form.barcode?.trim() ?? "",
      categoryId: form.categoryId ?? null,
      subcategoryId: form.subcategoryId ?? null,
      category: form.category ?? "",
      subcategory: form.subcategory ?? "",
      images: form.images ?? [],
      videos: form.videos ?? [],
      imageMetadata: form.imageMetadata ?? [],
      colors: normalizeColors(form.colors ?? []),
      isFeatured: form.isFeatured,
      ...(form.isActive !== undefined ? { isActive: form.isActive } : {}),
    } as any;

    if (form.id) {
      await update.mutateAsync({ id: form.id, data: body });
      invalidate();
      toast({ title: "تم تحديث المنتج بنجاح", description: form.nameAr || form.name });
      setEditing(null);
    } else {
      await create.mutateAsync({ data: body });
      invalidate();
      toast({ title: "تم إضافة المنتج بنجاح", description: form.nameAr || form.name });
      setEditing({ ...blank });
    }
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
            className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
                              ? <img src={p.images[0]} className="w-10 h-10 rounded-lg" style={{ objectFit: (p as any).imageMetadata?.[0]?.objectFit ?? "cover" }} alt="" />
                              : <div className="w-10 h-10 rounded-lg bg-background border border-border/30" />}
                            <span className="font-medium text-foreground">{p.nameAr}</span>
                          </div>
                        </td>
                        <td className="p-3 text-primary">{formatCurrency(p.price)}</td>
                        <td className="p-3">
                          <input type="number" min={0}
                            value={draft ?? String(p.stock)}
                            onChange={e => setStockDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                            className={`w-24 bg-background border rounded-lg px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${dirty ? "border-primary" : "border-border/40"} ${p.stock === 0 ? "text-status-danger" : ""}`} />
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
                          ? <img src={p.images[0]} className="w-12 h-12 rounded-lg" style={{ objectFit: (p as any).imageMetadata?.[0]?.objectFit ?? "cover" }} alt="" />
                          : <div className="w-12 h-12 rounded-lg bg-background border border-border/30" />}
                          <div>
                            <p className="font-medium text-foreground">{p.nameAr}</p>
                            <p className="text-xs text-muted-foreground">{p.name}</p>
                            {p.barcode && <p className="text-[11px] text-muted-foreground font-mono" dir="ltr">{p.barcode}</p>}
                            <ProductColorDots colors={p.colors} max={4} />
                            {p.isFeatured && <span className="text-xs text-primary">★ مميز</span>}
                          </div>
                      </div>
                    </td>
                    <td className="p-3 text-primary font-semibold">{formatCurrency(p.price)}</td>
                    <td className="p-3"><span className={p.stock === 0 ? "text-status-danger" : "text-status-success"}>{p.stock}</span></td>
                    <td className="p-3 text-muted-foreground">{p.category ?? "—"}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${p.isActive === false ? "bg-status-danger/10 text-status-danger" : "bg-status-success/10 text-status-success"}`}>
                        {p.isActive === false ? "مخفي" : "ظاهر"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditing({
                          id: p.id, name: p.name, nameAr: p.nameAr,
                          nameKu: (p as any).nameKu ?? "", nameTr: (p as any).nameTr ?? "",
                          description: p.description ?? "", descriptionAr: p.descriptionAr ?? "",
                          descriptionKu: (p as any).descriptionKu ?? "", descriptionTr: (p as any).descriptionTr ?? "",
                          price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : "",
                          costPrice: p.costPrice ? String(p.costPrice) : "0",
                          stock: String(p.stock), minStock: p.minStock ? String(p.minStock) : "0", barcode: p.barcode ?? "",
                          categoryId: (p as any).categoryId ?? null, subcategoryId: (p as any).subcategoryId ?? null,
                          category: p.category ?? "", subcategory: p.subcategory ?? "",
                          images: p.images ?? [], videos: (p as any).videos ?? [], imageMetadata: (p as any).imageMetadata ?? [], colors: normalizeColors(p.colors ?? []),
                          isFeatured: !!p.isFeatured, isActive: p.isActive !== false,
                        })} className="text-primary hover:bg-primary/10 p-2 rounded-lg">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => confirm("حذف المنتج؟") && remove.mutateAsync({ id: p.id }).then(invalidate)} className="text-status-danger hover:bg-status-danger/10 p-2 rounded-lg">
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);
  const [draggedImage, setDraggedImage] = useState<number | null>(null);
  const [draggedVideo, setDraggedVideo] = useState<number | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const { data: publicSettings } = usePublicSettings();
  const selectedParent = form.categoryId
    ? parentCats.find(p => p.id === form.categoryId)
    : parentCats.find(p => p.slug === form.category);
  const selectedSubcategory = form.subcategoryId
    ? subCats.find(s => s.id === form.subcategoryId)
    : subCats.find(s => s.slug === form.subcategory);
  const filteredSubs = subCats.filter(s => {
    return selectedParent ? s.parentId === selectedParent.id : true;
  });

  function addImages(results: ImageEditResult[]) {
    onChange({
      ...form,
      images: [...form.images, ...results.map((result) => result.dataUrl)],
      imageMetadata: [...(form.imageMetadata ?? []), ...results.map((result) => result.metadata)],
    });
  }

  function replaceImage(results: ImageEditResult[]) {
    if (replaceIndex == null || !results[0]) return;
    const images = [...form.images];
    const metadata = [...(form.imageMetadata ?? [])];
    images[replaceIndex] = results[0].dataUrl;
    metadata[replaceIndex] = results[0].metadata;
    onChange({ ...form, images, imageMetadata: metadata });
    setReplaceIndex(null);
  }

  function moveImage(index: number) {
    if (index <= 0) return;
    const images = [...form.images];
    const metadata = [...(form.imageMetadata ?? [])];
    [images[index - 1], images[index]] = [images[index], images[index - 1]];
    [metadata[index - 1], metadata[index]] = [metadata[index], metadata[index - 1]];
    onChange({ ...form, images, imageMetadata: metadata });
  }

  function makeMain(index: number) {
    if (index === 0) return;
    const images = [...form.images];
    const metadata = [...(form.imageMetadata ?? [])];
    const [selected] = images.splice(index, 1);
    const [selectedMeta] = metadata.splice(index, 1);
    onChange({ ...form, images: [selected, ...images], imageMetadata: [selectedMeta ?? {}, ...metadata] });
  }

  function dropImage(targetIndex: number) {
    if (draggedImage == null || draggedImage === targetIndex) return;
    const images = [...form.images];
    const metadata = [...(form.imageMetadata ?? [])];
    const [selected] = images.splice(draggedImage, 1);
    const [selectedMeta] = metadata.splice(draggedImage, 1);
    images.splice(targetIndex, 0, selected);
    metadata.splice(targetIndex, 0, selectedMeta ?? {});
    onChange({ ...form, images, imageMetadata: metadata });
    setDraggedImage(null);
  }

  function removeImage(index: number) {
    onChange({
      ...form,
      images: form.images.filter((_, idx) => idx !== index),
      imageMetadata: (form.imageMetadata ?? []).filter((_, idx) => idx !== index),
    });
    if (replaceIndex === index) setReplaceIndex(null);
  }

  async function addVideos(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).filter((file) => file.type.startsWith("video/"));
    if (!selected.length) return;
    const dataUrls = await Promise.all(selected.map((file) => fileToDataUrl(file)));
    onChange({ ...form, videos: [...(form.videos ?? []), ...dataUrls] });
  }

  async function addMediaFiles(files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files);
    const imageFiles = picked.filter((file) => file.type.startsWith("image/"));
    const videoFiles = picked.filter((file) => file.type.startsWith("video/"));
    const imageResults = await Promise.all(imageFiles.map((file) => inspectImageFile(file)));
    const videoUrls = await Promise.all(videoFiles.map((file) => fileToDataUrl(file)));
    if (!imageResults.length && !videoUrls.length) return;
    onChange({
      ...form,
      images: [...form.images, ...imageResults.map((result) => result.dataUrl)],
      imageMetadata: [
        ...(form.imageMetadata ?? []),
        ...imageResults.map((result) => ({
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          originalSize: result.originalSize,
          originalType: result.originalType,
          width: result.width,
          height: result.height,
          objectFit: "cover" as const,
          updatedAt: new Date().toISOString(),
        })),
      ],
      videos: [...(form.videos ?? []), ...videoUrls],
    });
  }

  function dropVideo(targetIndex: number) {
    if (draggedVideo == null || draggedVideo === targetIndex) return;
    const videos = [...(form.videos ?? [])];
    const [selected] = videos.splice(draggedVideo, 1);
    videos.splice(targetIndex, 0, selected);
    onChange({ ...form, videos });
    setDraggedVideo(null);
  }

  function moveVideo(index: number) {
    if (index <= 0) return;
    const videos = [...(form.videos ?? [])];
    [videos[index - 1], videos[index]] = [videos[index], videos[index - 1]];
    onChange({ ...form, videos });
  }

  function removeVideo(index: number) {
    onChange({ ...form, videos: (form.videos ?? []).filter((_, idx) => idx !== index) });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={e => e.stopPropagation()}>
      <form
        onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave(form); } catch (error: any) { alert(error?.message || "تعذر حفظ المنتج"); } finally { setBusy(false); } }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground">{form.id ? "تعديل منتج" : "منتج جديد"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Inp label="الاسم بالعربي" value={form.nameAr} onChange={v => onChange({ ...form, nameAr: v })} />
          <Inp label="الاسم بالإنجليزي" value={form.name} onChange={v => onChange({ ...form, name: v })} />
          <Inp label="الاسم (كردي)" value={form.nameKu ?? ""} onChange={v => onChange({ ...form, nameKu: v })} />
          <Inp label="الاسم (تركي)" value={form.nameTr ?? ""} onChange={v => onChange({ ...form, nameTr: v })} />
          <Inp label="السعر" type="number" value={form.price} onChange={v => onChange({ ...form, price: v })} />
          <Inp label="السعر الأصلي (اختياري)" type="number" value={form.originalPrice ?? ""} onChange={v => onChange({ ...form, originalPrice: v })} />
          <Inp label="سعر الشراء" type="number" value={form.costPrice ?? "0"} onChange={v => onChange({ ...form, costPrice: v })} />
          <Inp label="المخزون" type="number" value={form.stock} onChange={v => onChange({ ...form, stock: v })} />
          <Inp label="حد التنبيه للمخزون" type="number" value={form.minStock ?? "0"} onChange={v => onChange({ ...form, minStock: v })} />
          <Inp label="الباركود (اختياري)" value={form.barcode ?? ""} onChange={v => onChange({ ...form, barcode: v })} />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">القسم الرئيسي</label>
            <select
              value={selectedParent ? String(selectedParent.id) : ""}
              onChange={e => {
                const next = parentCats.find(c => c.id === Number(e.target.value));
                onChange({
                  ...form,
                  categoryId: next?.id ?? null,
                  category: next?.slug ?? "",
                  subcategoryId: null,
                  subcategory: "",
                });
              }}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <option value="">—</option>
              {parentCats.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">القسم الفرعي</label>
            <select
              value={selectedSubcategory ? String(selectedSubcategory.id) : ""}
              onChange={e => {
                const next = subCats.find(c => c.id === Number(e.target.value));
                const parent = next?.parentId ? parentCats.find(c => c.id === next.parentId) : selectedParent;
                onChange({
                  ...form,
                  categoryId: parent?.id ?? form.categoryId ?? null,
                  category: parent?.slug ?? form.category ?? "",
                  subcategoryId: next?.id ?? null,
                  subcategory: next?.slug ?? "",
                });
              }}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <option value="">—</option>
              {filteredSubs.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/30 bg-background/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">اكتب العربي ثم ترجم تلقائياً إلى الكردية والتركية</span>
          <AutoTranslateButton
            name={form.nameAr}
            description={form.descriptionAr}
            className="gap-1.5"
            onResult={(r) => onChange({ ...form, nameKu: r.nameKu, nameTr: r.nameTr, descriptionKu: r.descriptionKu, descriptionTr: r.descriptionTr })}
          />
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">الوصف (عربي)</label>
          <textarea value={form.descriptionAr ?? ""} onChange={e => onChange({ ...form, descriptionAr: e.target.value })} rows={3}
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">الوصف (كردي)</label>
            <textarea value={form.descriptionKu ?? ""} onChange={e => onChange({ ...form, descriptionKu: e.target.value })} rows={3}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">الوصف (تركي)</label>
            <textarea value={form.descriptionTr ?? ""} onChange={e => onChange({ ...form, descriptionTr: e.target.value })} rows={3}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">الصور</label>
          </div>
          <ImageUploadEditor
            kind="product"
            multiple
            label="اسحب الصور هنا أو استخدم زر الرفع"
            settings={publicSettings?.image_settings}
            watermarkText={publicSettings?.site_name}
            onComplete={addImages}
          />
          {form.images.length > 0 && (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
              {form.images.map((img, i) => (
                <div
                  key={`${img}-${i}`}
                  draggable
                  onDragStart={() => setDraggedImage(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropImage(i)}
                  className={`relative w-28 shrink-0 rounded-xl overflow-hidden border bg-background transition-colors hover:border-primary/45 ${i === 0 ? "border-primary/60" : "border-border/30"}`}
                >
                  <button type="button" onClick={() => setPreviewImage(img)} className="block h-24 w-full">
                    <img src={img} className="w-full h-full" style={{ objectFit: (form.imageMetadata?.[i]?.objectFit as any) ?? "cover" }} alt="" />
                  </button>
                  {i === 0 && (
                    <span className="absolute top-1 right-1 inline-flex items-center gap-1 rounded bg-primary text-primary-foreground px-1.5 py-0.5 text-[10px]">
                      <Star className="w-3 h-3" /> رئيسية
                    </span>
                  )}
                  <div className="grid grid-cols-5 divide-x divide-border/20 divide-x-reverse border-t border-border/20 bg-card/95">
                    <button type="button" title="معاينة" onClick={() => setPreviewImage(img)} className="p-1.5 text-muted-foreground hover:text-foreground">
                      <Eye className="w-3.5 h-3.5 mx-auto" />
                    </button>
                    <button type="button" title="صورة رئيسية" onClick={() => makeMain(i)} className="p-1.5 text-muted-foreground hover:text-primary">
                      <Star className="w-3.5 h-3.5 mx-auto" />
                    </button>
                    <button type="button" title="تقديم الصورة" onClick={() => moveImage(i)} className="p-1.5 text-muted-foreground hover:text-foreground">
                      <ArrowRight className="w-3.5 h-3.5 mx-auto" />
                    </button>
                    <button type="button" title="استبدال" onClick={() => setReplaceIndex(i)} className="p-1.5 text-muted-foreground hover:text-primary">
                      <Upload className="w-3.5 h-3.5 mx-auto" />
                    </button>
                    <button type="button" title="حذف" onClick={() => removeImage(i)} className="p-1.5 text-status-danger hover:bg-status-danger/10">
                      <X className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {replaceIndex != null && form.images[replaceIndex] && (
            <div className="mt-3">
              <ImageUploadEditor
                kind="product"
                label="استبدال الصورة المحددة"
                currentImage={form.images[replaceIndex]}
                currentMetadata={form.imageMetadata?.[replaceIndex]}
                settings={publicSettings?.image_settings}
                watermarkText={publicSettings?.site_name}
                onComplete={replaceImage}
                onRemove={() => removeImage(replaceIndex)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">الألوان</label>
          <ProductColorPicker value={form.colors} onChange={(colors) => onChange({ ...form, colors })} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">صور وفيديوهات المنتج</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/20">
                <ImagePlus className="h-3.5 w-3.5" /> رفع صورة
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void addMediaFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/20">
                <Video className="h-3.5 w-3.5" /> رفع فيديو
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void addVideos(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          <div
            className="rounded-xl border border-dashed border-border/35 bg-background/40 p-4 text-center text-xs text-muted-foreground"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void addMediaFiles(event.dataTransfer.files);
            }}
          >
            اسحب الصور أو الفيديوهات هنا. الصور تضاف لمعرض المنتج، والفيديوهات تظهر عند توفرها.
          </div>
          {form.images.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] text-muted-foreground">صور المنتج</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {form.images.map((img, i) => (
                  <div
                    key={`media-${img}-${i}`}
                    className={`relative w-24 shrink-0 overflow-hidden rounded-xl border bg-background transition-colors hover:border-primary/45 ${i === 0 ? "border-primary/60" : "border-border/30"}`}
                  >
                    <button type="button" onClick={() => setPreviewImage(img)} className="block h-20 w-full">
                      <img src={img} className="h-full w-full" style={{ objectFit: (form.imageMetadata?.[i]?.objectFit as any) ?? "cover" }} alt="" />
                    </button>
                    {i === 0 && <span className="absolute top-1 right-1 rounded bg-primary px-1 py-0.5 text-[9px] text-primary-foreground">رئيسية</span>}
                    <div className="grid grid-cols-3 divide-x divide-border/20 divide-x-reverse border-t border-border/20 bg-card/95">
                      <button type="button" title="معاينة" onClick={() => setPreviewImage(img)} className="p-1.5 text-muted-foreground hover:text-foreground">
                        <Eye className="mx-auto h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="صورة رئيسية" onClick={() => makeMain(i)} className="p-1.5 text-muted-foreground hover:text-primary">
                        <Star className="mx-auto h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="حذف" onClick={() => removeImage(i)} className="p-1.5 text-status-danger hover:bg-status-danger/10">
                        <X className="mx-auto h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(form.videos ?? []).length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] text-muted-foreground">فيديوهات المنتج</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {form.videos.map((video, i) => (
                  <div
                    key={`${video}-${i}`}
                    draggable
                    onDragStart={() => setDraggedVideo(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropVideo(i)}
                    className="relative w-36 shrink-0 overflow-hidden rounded-xl border border-border/30 bg-background transition-colors hover:border-primary/45"
                  >
                    <button type="button" onClick={() => setPreviewVideo(video)} className="relative block h-24 w-full overflow-hidden bg-black">
                      <video src={video} preload="metadata" muted className="h-full w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                        <Play className="h-7 w-7" />
                      </span>
                    </button>
                    <div className="grid grid-cols-3 divide-x divide-border/20 divide-x-reverse border-t border-border/20 bg-card/95">
                      <button type="button" title="معاينة" onClick={() => setPreviewVideo(video)} className="p-1.5 text-muted-foreground hover:text-foreground">
                        <Eye className="w-3.5 h-3.5 mx-auto" />
                      </button>
                      <button type="button" title="تقديم الفيديو" onClick={() => moveVideo(i)} className="p-1.5 text-muted-foreground hover:text-foreground">
                        <ArrowRight className="w-3.5 h-3.5 mx-auto" />
                      </button>
                      <button type="button" title="حذف" onClick={() => removeVideo(i)} className="p-1.5 text-status-danger hover:bg-status-danger/10">
                        <X className="w-3.5 h-3.5 mx-auto" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
      {previewImage && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}>
          <img src={previewImage} alt="" className="max-h-[86vh] max-w-[92vw] rounded-xl object-contain border border-border/40 bg-card" />
        </div>
      )}
      {previewVideo && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setPreviewVideo(null); }}>
          <video src={previewVideo} controls autoPlay className="max-h-[86vh] max-w-[92vw] rounded-xl border border-border/40 bg-black" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function Inp({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    </div>
  );
}
