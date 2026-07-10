import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { ArrowRight, Eye, Plus, Edit2, Trash2, X, Search, Upload, Boxes, Save, Star, Video, Play, ImagePlus, Link2, AlertTriangle, CheckCircle2, PackageX, CalendarDays, QrCode, RefreshCw, Copy } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, fileToDataUrl, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { usePublicSettings } from "@/lib/public-settings";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { inspectImageFile, type ImageMetadata } from "@/lib/image-tools";
import { ProductColorPicker, ProductColorDots } from "@/components/product-colors";
import { normalizeColors, type ProductColor } from "@/lib/colors";
import { AutoTranslateButton } from "./auto-translate-button";
import { generateQrDataUrl } from "./label-helpers";

type Category = { id: number; name: string; nameAr: string; slug: string; parentId: number | null; sortOrder: number; isActive: boolean };

type ProductForm = {
  id?: number;
  name: string; nameAr: string;
  nameKu?: string; nameTr?: string;
  description?: string; descriptionAr?: string;
  descriptionKu?: string; descriptionTr?: string;
  price: string; originalPrice?: string; costPrice?: string;
  stock: string; minStock?: string; barcode?: string;
  isRental?: boolean; pricePerDay?: string;
  sharedStockProductId?: number | null;
  sharedStockLinkedProductIds?: number[];
  categoryId?: number | null; subcategoryId?: number | null;
  category?: string; subcategory?: string;
  images: string[]; videos: string[]; colors: ProductColor[];
  imageMetadata: ImageMetadata[];
  isFeatured: boolean; isActive?: boolean;
};

type RentalBookingRow = {
  id: number;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  days: number;
  total: number;
  status: "active" | "returned" | "cancelled" | string;
};

const blank: ProductForm = {
  name: "", nameAr: "", price: "0", costPrice: "0", stock: "0", minStock: "0", barcode: "",
  isRental: false, pricePerDay: "0",
  sharedStockProductId: null, sharedStockLinkedProductIds: [],
  images: [], videos: [], imageMetadata: [], colors: [], isFeatured: false, isActive: true,
};

const DEFAULT_LOW_STOCK_THRESHOLD = 5;
type StockFilter = "all" | "available" | "low" | "out";

function stockQuantity(product: any) {
  return Number(product?.stock ?? 0);
}

function stockThreshold(product: any) {
  const productThreshold = Number(product?.minStock ?? 0);
  return productThreshold > 0 ? productThreshold : DEFAULT_LOW_STOCK_THRESHOLD;
}

function stockStatus(product: any): "available" | "low" | "out" {
  const quantity = stockQuantity(product);
  if (quantity <= 0) return "out";
  if (quantity < stockThreshold(product)) return "low";
  return "available";
}

function stockStatusMeta(status: ReturnType<typeof stockStatus>) {
  if (status === "out") {
    return {
      label: "نفد المخزون",
      className: "border-status-danger/30 bg-status-danger/10 text-status-danger",
      icon: PackageX,
    };
  }
  if (status === "low") {
    return {
      label: "منخفض",
      className: "border-status-warning/30 bg-status-warning/10 text-status-warning",
      icon: AlertTriangle,
    };
  }
  return {
    label: "متوفر",
    className: "border-status-success/30 bg-status-success/10 text-status-success",
    icon: CheckCircle2,
  };
}

function StockStatusBadge({ product }: { product: any }) {
  const meta = stockStatusMeta(stockStatus(product));
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${meta.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

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
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [view, setView] = useState<"list" | "stock">("list");
  const [stockDrafts, setStockDrafts] = useState<Record<number, string>>({});

  const productRows = products ?? [];
  const stockStats = useMemo(() => {
    return productRows.reduce(
      (acc, product: any) => {
        const status = stockStatus(product);
        if (status === "out") acc.out += 1;
        else if (status === "low") acc.low += 1;
        else acc.available += 1;
        return acc;
      },
      { available: 0, low: 0, out: 0 },
    );
  }, [productRows]);

  const filtered = useMemo(() => {
    let rows = productRows;
    if (catFilter) rows = rows.filter((p: any) => p.category === catFilter);
    if (stockFilter !== "all") rows = rows.filter((p: any) => stockStatus(p) === stockFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((p: any) => p.nameAr.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || String(p.sharedStockProductName ?? "").toLowerCase().includes(s));
    }
    return rows;
  }, [productRows, search, catFilter, stockFilter]);

  const parentCats = categories?.filter(c => !c.parentId) ?? [];
  const subCats = categories?.filter(c => c.parentId) ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["admin", "products-all"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "inventory-alert-count"] });
  }

  async function saveStock(product: any) {
    const draft = stockDrafts[product.id];
    const nextStock = Math.max(0, parseInt(draft ?? String(stockQuantity(product)), 10) || 0);
    await update.mutateAsync({
      id: product.id,
      data: {
        name: product.name,
        nameAr: product.nameAr,
        price: Number(product.price),
        stock: nextStock,
      },
    });
    setStockDrafts((drafts) => {
      const next = { ...drafts };
      delete next[product.id];
      return next;
    });
    invalidate();
    toast({
      title: "تم تحديث المخزون",
      description: product.sharedStockProductName
        ? `تم تحديث مخزون المصدر: ${product.sharedStockProductName}`
        : product.nameAr || product.name,
    });
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
      isRental: form.isRental === true,
      pricePerDay: parseFloat(form.pricePerDay ?? "0") || 0,
      sharedStockProductId: form.sharedStockProductId ?? null,
      ...(form.id && !form.sharedStockProductId ? { sharedStockLinkedProductIds: form.sharedStockLinkedProductIds ?? [] } : {}),
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

      <div className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === "out" ? "all" : "out")}
          className={`rounded-xl border p-4 text-right transition-colors ${
            stockFilter === "out"
              ? "border-status-danger/45 bg-status-danger/15"
              : "border-border/30 bg-card hover:bg-background/40"
          }`}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">منتجات نفد مخزونها</span>
            <PackageX className="h-5 w-5 text-status-danger" />
          </span>
          <strong className="mt-2 block text-2xl text-foreground">{stockStats.out}</strong>
          <span className="mt-1 block text-[11px] text-muted-foreground">يعتمد على المخزون الفعلي، بما فيه المخزون المشترك</span>
        </button>
        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === "low" ? "all" : "low")}
          className={`rounded-xl border p-4 text-right transition-colors ${
            stockFilter === "low"
              ? "border-status-warning/45 bg-status-warning/15"
              : "border-border/30 bg-card hover:bg-background/40"
          }`}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">المخزون المنخفض</span>
            <AlertTriangle className="h-5 w-5 text-status-warning" />
          </span>
          <strong className="mt-2 block text-2xl text-foreground">{stockStats.low}</strong>
          <span className="mt-1 block text-[11px] text-muted-foreground">أقل من حد التنبيه أو {DEFAULT_LOW_STOCK_THRESHOLD} كافتراضي</span>
        </button>
        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === "available" ? "all" : "available")}
          className={`rounded-xl border p-4 text-right transition-colors ${
            stockFilter === "available"
              ? "border-status-success/45 bg-status-success/15"
              : "border-border/30 bg-card hover:bg-background/40"
          }`}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">منتجات متوفرة</span>
            <CheckCircle2 className="h-5 w-5 text-status-success" />
          </span>
          <strong className="mt-2 block text-2xl text-foreground">{stockStats.available}</strong>
          <span className="mt-1 block text-[11px] text-muted-foreground">اضغط على العدادات لتفعيل الفلتر السريع</span>
        </button>
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
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value as StockFilter)}
          className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <option value="all">كل حالات المخزون</option>
          <option value="available">متوفر</option>
          <option value="low">المخزون المنخفض</option>
          <option value="out">نفد المخزون</option>
        </select>
        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === "out" ? "all" : "out")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
            stockFilter === "out"
              ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
              : "border-border/40 bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <PackageX className="h-4 w-4" />
          عرض المنتجات ذات المخزون 0 فقط
        </button>
        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === "low" ? "all" : "low")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
            stockFilter === "low"
              ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
              : "border-border/40 bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          المخزون المنخفض
        </button>
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
                    <th className="text-right p-3 font-medium w-36">حالة المخزون</th>
                    <th className="text-right p-3 font-medium w-32">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {filtered.map((p: any) => {
                    const draft = stockDrafts[p.id];
                    const currentStock = stockQuantity(p);
                    const dirty = draft !== undefined && draft !== String(currentStock);
                    const status = stockStatus(p);
                    return (
                      <tr key={p.id} className={`hover:bg-background/30 ${status === "out" ? "bg-status-danger/5" : ""}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            {p.images?.[0]
                              ? <img src={p.images[0]} className="w-10 h-10 rounded-lg" style={{ objectFit: (p as any).imageMetadata?.[0]?.objectFit ?? "cover" }} alt="" />
                              : <div className="w-10 h-10 rounded-lg bg-background border border-border/30" />}
                            <span className="font-medium text-foreground">{p.nameAr}</span>
                            {p.sharedStockProductName && (
                              <span className="text-[11px] text-primary inline-flex items-center gap-1">
                                <Link2 className="w-3 h-3" /> مشترك مع {p.sharedStockProductName}
                              </span>
                            )}
                            {(p.sharedStockLinkedProducts?.length ?? 0) > 0 && (
                              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                <Link2 className="w-3 h-3" /> مرتبط به {p.sharedStockLinkedProducts.map((item: any) => item.name).join("، ")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-primary">{formatCurrency(p.price)}</td>
                        <td className="p-3">
                          <input type="number" min={0}
                            value={draft ?? String(currentStock)}
                            onChange={e => setStockDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                            className={`w-24 bg-background border rounded-lg px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${dirty ? "border-primary" : "border-border/40"} ${status === "out" ? "text-status-danger" : ""}`} />
                        </td>
                        <td className="p-3"><StockStatusBadge product={p} /></td>
                        <td className="p-3">
                          {dirty && (
                            <button onClick={() => void saveStock(p)} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
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
                  <th className="text-right p-3 font-medium">حالة المخزون</th>
                  <th className="text-right p-3 font-medium">التصنيف</th>
                  <th className="text-right p-3 font-medium">حالة النشر</th>
                  <th className="text-right p-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filtered.map((p: any) => {
                  const draft = stockDrafts[p.id];
                  const currentStock = stockQuantity(p);
                  const dirty = draft !== undefined && draft !== String(currentStock);
                  const status = stockStatus(p);
                  return (
                    <tr key={p.id} className={`hover:bg-background/30 ${status === "out" ? "bg-status-danger/5" : ""}`}>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          {p.images?.[0]
                            ? <img src={p.images[0]} className="w-12 h-12 rounded-lg" style={{ objectFit: (p as any).imageMetadata?.[0]?.objectFit ?? "cover" }} alt="" />
                            : <div className="w-12 h-12 rounded-lg bg-background border border-border/30" />}
                            <div>
                              <p className="font-medium text-foreground">{p.nameAr}</p>
                              <p className="text-xs text-muted-foreground">{p.name}</p>
                              {p.barcode && <p className="text-[11px] text-muted-foreground font-mono" dir="ltr">{p.barcode}</p>}
                              {p.sharedStockProductName && (
                                <p className="text-[11px] text-primary inline-flex items-center gap-1 mt-0.5">
                                  <Link2 className="w-3 h-3" /> مخزون مشترك مع {p.sharedStockProductName}
                                </p>
                              )}
                              {(p.sharedStockLinkedProducts?.length ?? 0) > 0 && (
                                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                                  <Link2 className="w-3 h-3" /> يستخدمه {p.sharedStockLinkedProducts.map((item: any) => item.name).join("، ")}
                                </p>
                              )}
                              <ProductColorDots colors={p.colors} max={4} />
                              {p.isFeatured && <span className="text-xs text-primary">★ مميز</span>}
                            </div>
                        </div>
                      </td>
                      <td className="p-3 text-primary font-semibold">{formatCurrency(p.price)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            value={draft ?? String(currentStock)}
                            onChange={e => setStockDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                            className={`w-20 bg-background border rounded-lg px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${dirty ? "border-primary" : "border-border/40"} ${status === "out" ? "text-status-danger" : ""}`}
                          />
                          {dirty && (
                            <button onClick={() => void saveStock(p)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
                              <Save className="h-3.5 w-3.5" /> حفظ
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-3"><StockStatusBadge product={p} /></td>
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
                            stock: String(currentStock), minStock: p.minStock ? String(p.minStock) : "0", barcode: p.barcode ?? "",
                            isRental: !!(p as any).isRental, pricePerDay: (p as any).pricePerDay ? String((p as any).pricePerDay) : "0",
                            sharedStockProductId: (p as any).sharedStockProductId ?? null,
                            sharedStockLinkedProductIds: Array.isArray((p as any).sharedStockLinkedProducts) ? (p as any).sharedStockLinkedProducts.map((item: any) => Number(item.id)).filter(Boolean) : [],
                            categoryId: (p as any).categoryId ?? null, subcategoryId: (p as any).subcategoryId ?? null,
                            category: p.category ?? "", subcategory: p.subcategory ?? "",
                            images: p.images ?? [], videos: (p as any).videos ?? [], imageMetadata: (p as any).imageMetadata ?? [], colors: normalizeColors(p.colors ?? []),
                            isFeatured: !!p.isFeatured, isActive: p.isActive !== false,
                          })} className="text-primary hover:bg-primary/10 p-2 rounded-lg">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <Link href={`/admin/print-labels?productId=${p.id}&kind=product`} className="text-muted-foreground hover:bg-muted p-2 rounded-lg" title="طباعة ملصق">
                            <QrCode className="w-4 h-4" />
                          </Link>
                          <button onClick={() => confirm("حذف المنتج؟") && remove.mutateAsync({ id: p.id }).then(invalidate)} className="text-status-danger hover:bg-status-danger/10 p-2 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <ProductFormModal form={editing} onChange={setEditing} onClose={() => setEditing(null)} onSave={save} parentCats={parentCats} subCats={subCats} products={products ?? []} />}
    </div>
  );
}

function ProductFormModal({ form, onChange, onClose, onSave, parentCats, subCats, products }: {
  form: ProductForm; onChange: (f: ProductForm) => void; onClose: () => void;
  onSave: (f: ProductForm) => Promise<void>;
  parentCats: Category[]; subCats: Category[];
  products: any[];
}) {
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "rentals" | "recipe" | "variants">("details");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);
  const [draggedImage, setDraggedImage] = useState<number | null>(null);
  const [draggedVideo, setDraggedVideo] = useState<number | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [sharedStockEnabled, setSharedStockEnabled] = useState(Boolean(form.sharedStockProductId));
  const [stockSearch, setStockSearch] = useState("");
  const [linkedSearch, setLinkedSearch] = useState("");
  const [rentalStatusBusy, setRentalStatusBusy] = useState<number | null>(null);
  const { data: publicSettings } = usePublicSettings();
  const {
    data: rentalBookings = [],
    refetch: refetchRentalBookings,
  } = useQuery({
    queryKey: ["admin", "rental-orders", form.id],
    queryFn: () => adminFetch<RentalBookingRow[]>(`/rental-orders?productId=${form.id}`),
    enabled: Boolean(form.id && form.isRental),
  });
  useEffect(() => {
    setSharedStockEnabled(Boolean(form.sharedStockProductId));
    setStockSearch("");
    setLinkedSearch("");
    setActiveTab("details");
  }, [form.id]);
  const selectedParent = form.categoryId
    ? parentCats.find(p => p.id === form.categoryId)
    : parentCats.find(p => p.slug === form.category);
  const selectedSubcategory = form.subcategoryId
    ? subCats.find(s => s.id === form.subcategoryId)
    : subCats.find(s => s.slug === form.subcategory);
  const filteredSubs = subCats.filter(s => {
    return selectedParent ? s.parentId === selectedParent.id : true;
  });
  const linkedStockProduct = products.find((product: any) => product.id === form.sharedStockProductId);
  const linkableProducts = products.filter((product: any) => product.id !== form.id);
  const selectedLinkedIds = new Set((form.sharedStockLinkedProductIds ?? []).filter((id) => id !== form.id));
  const filteredLinkableProducts = linkableProducts
    .filter((product: any) => {
      const term = stockSearch.trim().toLowerCase();
      if (!term) return true;
      return [
        product.nameAr,
        product.name,
        product.barcode,
        product.category,
        product.categoryName,
        product.subcategory,
        product.subcategoryName,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    })
    .slice(0, 24);
  const filteredLinkedCandidates = linkableProducts
    .filter((product: any) => {
      const term = linkedSearch.trim().toLowerCase();
      if (!term) return true;
      return [
        product.nameAr,
        product.name,
        product.barcode,
        product.category,
        product.categoryName,
        product.subcategory,
        product.subcategoryName,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    })
    .sort((a: any, b: any) => Number(selectedLinkedIds.has(b.id)) - Number(selectedLinkedIds.has(a.id)))
    .slice(0, 30);
  const selectedLinkedProducts = linkableProducts.filter((product: any) => selectedLinkedIds.has(product.id));

  function toggleLinkedStockProduct(productId: number) {
    const current = new Set((form.sharedStockLinkedProductIds ?? []).filter((id) => id !== form.id));
    if (current.has(productId)) current.delete(productId);
    else current.add(productId);
    onChange({ ...form, sharedStockLinkedProductIds: Array.from(current) });
  }

  async function updateRentalStatus(id: number, status: "active" | "returned" | "cancelled") {
    setRentalStatusBusy(id);
    try {
      await adminFetch(`/rental-orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refetchRentalBookings();
    } finally {
      setRentalStatusBusy(null);
    }
  }

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
        className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground">{form.id ? "تعديل منتج" : "منتج جديد"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {form.id && (
          <div className="flex rounded-xl border border-border/30 bg-background/40 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${activeTab === "details" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              تفاصيل المنتج
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("rentals")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${activeTab === "rentals" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              حجوزات الإيجار
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("recipe")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${activeTab === "recipe" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              🧩 وصفة المنتج
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("variants")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${activeTab === "variants" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              🎨 المتغيّرات
            </button>
          </div>
        )}

        {activeTab === "recipe" && form.id ? (
          <RecipeTab
            productId={form.id}
            sellingPrice={Number(form.price) || 0}
            products={products}
          />
        ) : null}

        {activeTab === "variants" && form.id ? (
          <VariantsTab productId={form.id} />
        ) : null}

        {activeTab === "rentals" ? (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">حجوزات الإيجار</h4>
                <p className="mt-1 text-[11px] text-muted-foreground">الحجوزات المرتبطة بهذا المنتج أو بمصدر مخزونه المشترك.</p>
              </div>
              <span className="text-[11px] text-muted-foreground">{rentalBookings.length} حجز</span>
            </div>
            {rentalBookings.length === 0 ? (
              <div className="rounded-lg border border-border/25 bg-card/50 p-3 text-xs text-muted-foreground">
                لا توجد حجوزات إيجار لهذا المنتج حتى الآن.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border/25 divide-y divide-border/20">
                {rentalBookings.map((booking) => {
                  const active = booking.status === "active";
                  const returned = booking.status === "returned";
                  const cancelled = booking.status === "cancelled";
                  return (
                    <div key={booking.id} className="bg-card/60 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-foreground">{booking.orderNo}</p>
                          <p className="mt-1 text-sm text-foreground">{booking.customerName || "زبون"} · {booking.customerPhone}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {booking.startDate} ← {booking.endDate} · {booking.days} يوم · {formatCurrency(booking.total)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-1 text-[11px] ${
                            active ? "border-status-success/30 bg-status-success/10 text-status-success"
                              : returned ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-status-danger/30 bg-status-danger/10 text-status-danger"
                          }`}>
                            {active ? "active" : returned ? "returned" : cancelled ? "cancelled" : booking.status}
                          </span>
                          {active ? (
                            <>
                              <button
                                type="button"
                                disabled={rentalStatusBusy === booking.id}
                                onClick={() => void updateRentalStatus(booking.id, "returned")}
                                className="rounded-lg border border-primary/30 px-2.5 py-1.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50"
                              >
                                إرجاع
                              </button>
                              <button
                                type="button"
                                disabled={rentalStatusBusy === booking.id}
                                onClick={() => void updateRentalStatus(booking.id, "cancelled")}
                                className="rounded-lg border border-status-danger/30 px-2.5 py-1.5 text-[11px] text-status-danger hover:bg-status-danger/10 disabled:opacity-50"
                              >
                                إلغاء
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={rentalStatusBusy === booking.id}
                              onClick={() => void updateRentalStatus(booking.id, "active")}
                              className="rounded-lg border border-border/40 px-2.5 py-1.5 text-[11px] text-foreground hover:text-primary disabled:opacity-50"
                            >
                              إعادة تفعيل
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === "details" ? (
          <>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">إعدادات الإيجار</h4>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.isRental === true}
              onChange={(event) => onChange({
                ...form,
                isRental: event.target.checked,
                pricePerDay: event.target.checked ? form.pricePerDay ?? form.price ?? "0" : form.pricePerDay ?? "0",
                stock: event.target.checked && (!form.stock || form.stock === "0") ? "1" : form.stock,
              })}
              className="accent-primary"
            />
            منتج للإيجار
          </label>
          {form.isRental && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label="سعر الإيجار لليوم" type="number" value={form.pricePerDay ?? "0"} onChange={v => onChange({ ...form, pricePerDay: v })} />
              <Inp label="الكمية" type="number" value={form.stock} onChange={v => onChange({ ...form, stock: v })} />
            </div>
          )}
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
          <div className="col-span-2 rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sharedStockEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSharedStockEnabled(checked);
                    onChange({
                      ...form,
                      sharedStockProductId: checked ? form.sharedStockProductId ?? null : null,
                      sharedStockLinkedProductIds: checked ? [] : form.sharedStockLinkedProductIds ?? [],
                    });
                  }}
                  className="accent-primary"
                />
                مخزون مشترك مع منتج مشابه
              </span>
              {linkedStockProduct && (
                <span className="text-[11px] text-primary inline-flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> {linkedStockProduct.nameAr || linkedStockProduct.name}
                </span>
              )}
            </label>
            {sharedStockEnabled && (
              <div className="space-y-2">
                <label className="block text-xs text-muted-foreground">اختر المنتج الذي يشارك المخزون</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={stockSearch}
                    onChange={(event) => setStockSearch(event.target.value)}
                    placeholder="ابحث بالاسم، الباركود، أو التصنيف..."
                    className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border/30 bg-background/30 divide-y divide-border/20">
                  {filteredLinkableProducts.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground">لا توجد منتجات مطابقة للبحث</div>
                  ) : filteredLinkableProducts.map((product: any) => {
                    const selected = product.id === form.sharedStockProductId;
                    const category = product.categoryName || product.category || "بدون تصنيف";
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => onChange({
                          ...form,
                          sharedStockProductId: product.id,
                          stock: String(product.stock ?? 0),
                          minStock: String(product.minStock ?? 0),
                        })}
                        className={`w-full text-right px-3 py-2 transition-colors ${selected ? "bg-primary/10 text-primary" : "hover:bg-card/70 text-foreground"}`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium truncate">{product.nameAr || product.name}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">
                              {category}{product.barcode ? ` · ${product.barcode}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">المخزون {product.stock ?? 0}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  سيبقى المنتج ظاهر بشكل مستقل في المتجر، لكن البيع أو الشراء لأي منتج مرتبط سيؤثر على نفس رصيد المخزون.
                </p>
              </div>
            )}
          </div>
          {form.id && !sharedStockEnabled && (
            <div className="col-span-2 rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-foreground inline-flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-primary" />
                  المنتجات التي تستخدم مخزون هذا المنتج
                </label>
                <span className="text-[11px] text-muted-foreground">{selectedLinkedIds.size} منتج مرتبط</span>
              </div>
              {selectedLinkedProducts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedLinkedProducts.map((product: any) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => toggleLinkedStockProduct(product.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/15"
                    >
                      <X className="w-3 h-3" />
                      {product.nameAr || product.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={linkedSearch}
                  onChange={(event) => setLinkedSearch(event.target.value)}
                  placeholder="ابحث لإضافة منتجات تستخدم نفس المخزون..."
                  className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border/30 bg-background/30 divide-y divide-border/20">
                {filteredLinkedCandidates.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">لا توجد منتجات مطابقة للبحث</div>
                ) : filteredLinkedCandidates.map((product: any) => {
                  const selected = selectedLinkedIds.has(product.id);
                  const category = product.categoryName || product.category || "بدون تصنيف";
                  const usesOtherSource = product.sharedStockProductId && product.sharedStockProductId !== form.id;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => toggleLinkedStockProduct(product.id)}
                      className={`w-full text-right px-3 py-2 transition-colors ${selected ? "bg-primary/10 text-primary" : "hover:bg-card/70 text-foreground"}`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{product.nameAr || product.name}</span>
                          <span className="block text-[11px] text-muted-foreground truncate">
                            {category}{product.barcode ? ` · ${product.barcode}` : ""}
                            {usesOtherSource ? ` · مرتبط حالياً مع ${product.sharedStockProductName ?? "مصدر آخر"}` : ""}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${selected ? "border-primary/40 bg-primary/15 text-primary" : "border-border/40 text-muted-foreground"}`}>
                          {selected ? "مختار" : "ربط"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                أي منتج تختاره هنا سيظهر بشكل مستقل في المتجر، لكن البيع منه سيخصم من مخزون هذا المنتج الرئيسي.
              </p>
            </div>
          )}
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
                    <span className="absolute top-1 right-1 inline-flex items-center gap-1 rounded bg-primary text-primary-foreground px-1.5 py-0.5 text-[11px]">
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
                    {i === 0 && <span className="absolute top-1 right-1 rounded bg-primary px-1 py-0.5 text-[11px] text-primary-foreground">رئيسية</span>}
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
          </>
        ) : null}
      </form>
      {previewImage && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}>
          <img src={previewImage} alt="" className="max-h-[86dvh] max-w-[92vw] rounded-xl object-contain border border-border/40 bg-card" />
        </div>
      )}
      {previewVideo && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setPreviewVideo(null); }}>
          <video src={previewVideo} controls autoPlay className="max-h-[86dvh] max-w-[92vw] rounded-xl border border-border/40 bg-black" onClick={(event) => event.stopPropagation()} />
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

// ───── 🧩 Product Recipe (BOM) tab ─────
type RecipeComp = {
  id?: number;
  componentProductId: number;
  name: string;
  quantity: number;
  unit: string;
  unitCost: number;
  notes?: string | null;
  componentStock?: number;
};
type LaborLine = { worker: string; hours: number; hourlyRate: number };

function RecipeTab({ productId, sellingPrice, products }: { productId: number; sellingPrice: number; products: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rows, setRows] = useState<RecipeComp[]>([]);
  const [labor, setLabor] = useState<LaborLine[]>([]);
  const [wastagePercent, setWastagePercent] = useState(0);
  const [recipeNotes, setRecipeNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [dupTarget, setDupTarget] = useState<string>("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "product-recipe", productId],
    queryFn: () => adminFetch<any>(`/products/${productId}/recipe`),
    enabled: Boolean(productId),
  });

  useEffect(() => {
    if (data?.components) {
      setRows(data.components.map((c: any) => ({
        id: c.id,
        componentProductId: c.componentProductId,
        name: c.name,
        quantity: Number(c.quantity) || 0,
        unit: c.unit || "قطعة",
        unitCost: Number(c.unitCost) || 0,
        notes: c.notes ?? "",
        componentStock: Number(c.componentStock ?? 0),
      })));
      setLabor(Array.isArray(data.labor) ? data.labor.map((l: any) => ({ worker: l.worker || "", hours: Number(l.hours) || 0, hourlyRate: Number(l.hourlyRate) || 0 })) : []);
      setWastagePercent(Number(data.wastagePercent) || 0);
      setRecipeNotes(data.notes ?? "");
      setDirty(false);
    }
  }, [data]);

  const materialCost = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0),
    [rows],
  );
  const laborCost = useMemo(
    () => labor.reduce((sum, l) => sum + (Number(l.hours) || 0) * (Number(l.hourlyRate) || 0), 0),
    [labor],
  );
  const totalCost = materialCost + laborCost;
  const profit = sellingPrice - totalCost;
  const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

  function addLaborLine() {
    setLabor((prev) => [...prev, { worker: "", hours: 0, hourlyRate: 0 }]);
    setDirty(true);
  }
  function updateLabor(i: number, patch: Partial<LaborLine>) {
    setLabor((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function removeLabor(i: number) {
    setLabor((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  const usedIds = new Set(rows.map((r) => r.componentProductId));
  const pickable = products
    .filter((p: any) => p.id !== productId)
    .filter((p: any) => (replaceIndex != null ? true : !usedIds.has(p.id)))
    .filter((p: any) => {
      const term = pickerSearch.trim().toLowerCase();
      if (!term) return true;
      return [p.nameAr, p.name, p.barcode].some((v) => String(v ?? "").toLowerCase().includes(term));
    })
    .slice(0, 40);

  function update(i: number, patch: Partial<RecipeComp>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function pickProduct(p: any) {
    if (replaceIndex != null) {
      update(replaceIndex, { componentProductId: p.id, name: p.nameAr || p.name, unitCost: Number(p.costPrice) || 0, componentStock: Number(p.stock) || 0 });
      setReplaceIndex(null);
    } else {
      setRows((prev) => [...prev, {
        componentProductId: p.id,
        name: p.nameAr || p.name,
        quantity: 1,
        unit: "قطعة",
        unitCost: Number(p.costPrice) || 0,
        notes: "",
        componentStock: Number(p.stock) || 0,
      }]);
      setDirty(true);
    }
    setPickerOpen(false);
    setPickerSearch("");
  }

  async function save() {
    setBusy(true);
    try {
      await adminFetch(`/products/${productId}/recipe`, {
        method: "PUT",
        body: JSON.stringify({
          components: rows.map((r) => ({
            componentProductId: r.componentProductId,
            quantity: Number(r.quantity) || 0,
            unit: r.unit || "قطعة",
            unitCost: Number(r.unitCost) || 0,
            notes: r.notes || null,
          })),
          labor: labor
            .filter((l) => l.worker || l.hours > 0 || l.hourlyRate > 0)
            .map((l) => ({ worker: l.worker, hours: Number(l.hours) || 0, hourlyRate: Number(l.hourlyRate) || 0 })),
          wastagePercent: Number(wastagePercent) || 0,
          recipeNotes: recipeNotes || null,
        }),
      });
      toast({ title: "تم حفظ الوصفة ✅" });
      setDirty(false);
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin", "product-recipe", productId] });
    } catch (e: any) {
      toast({ title: "تعذر حفظ الوصفة", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    const targetId = Number(dupTarget);
    if (!targetId) return;
    setBusy(true);
    try {
      await adminFetch(`/products/${productId}/recipe/duplicate`, {
        method: "POST",
        body: JSON.stringify({ targetProductId: targetId }),
      });
      const targetName = products.find((p: any) => p.id === targetId)?.nameAr || "المنتج";
      toast({ title: `تم نسخ الوصفة إلى ${targetName} ✅` });
      setDupTarget("");
    } catch (e: any) {
      toast({ title: "تعذر نسخ الوصفة", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-foreground">🧩 وصفة المنتج (BOM)</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">المكوّنات المستهلكة عند بيع أو إنتاج هذا المنتج. لا يُخصم المنتج النهائي — تُخصم مكوّناته فقط.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => { setReplaceIndex(null); setPickerOpen(true); }}>
          <Plus className="w-4 h-4 ml-1" /> إضافة مكوّن
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border/25 bg-card/50 p-3 text-xs text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 bg-card/40 p-6 text-center text-xs text-muted-foreground">
          لا توجد مكوّنات بعد. أضف مكوّنات من منتجات المتجر لتكوين الوصفة.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const low = (r.componentStock ?? 0) < (Number(r.quantity) || 0);
            return (
              <div key={`${r.componentProductId}-${i}`} className="rounded-lg border border-border/25 bg-card/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                    {low && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[10px] text-status-warning">
                        <AlertTriangle className="w-3 h-3" /> مخزون {r.componentStock ?? 0}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" title="استبدال" onClick={() => { setReplaceIndex(i); setPickerOpen(true); }}
                      className="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" title="حذف" onClick={() => removeRow(i)}
                      className="rounded-md border border-border/40 px-2 py-1 text-[11px] text-status-danger hover:bg-status-danger/10">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="block">
                    <span className="block text-[10px] text-muted-foreground mb-0.5">الكمية</span>
                    <input type="number" min={0} step="any" value={r.quantity}
                      onChange={(e) => update(i, { quantity: Number(e.target.value) })}
                      className="w-full bg-background border border-border/40 rounded-lg px-2 py-1 text-sm" />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-muted-foreground mb-0.5">الوحدة</span>
                    <input value={r.unit} onChange={(e) => update(i, { unit: e.target.value })}
                      className="w-full bg-background border border-border/40 rounded-lg px-2 py-1 text-sm" />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-muted-foreground mb-0.5">تكلفة الوحدة</span>
                    <input type="number" min={0} step="any" value={r.unitCost}
                      onChange={(e) => update(i, { unitCost: Number(e.target.value) })}
                      className="w-full bg-background border border-border/40 rounded-lg px-2 py-1 text-sm" />
                  </label>
                  <div className="flex flex-col justify-end">
                    <span className="block text-[10px] text-muted-foreground mb-0.5">تكلفة السطر</span>
                    <span className="px-2 py-1 text-sm font-semibold text-foreground">{formatCurrency((Number(r.quantity) || 0) * (Number(r.unitCost) || 0))}</span>
                  </div>
                </div>
                <input value={r.notes ?? ""} onChange={(e) => update(i, { notes: e.target.value })}
                  placeholder="ملاحظات (اختياري)"
                  className="mt-2 w-full bg-background border border-border/40 rounded-lg px-2 py-1 text-xs" />
              </div>
            );
          })}
        </div>
      )}

      {/* Labor + wastage */}
      <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">👷 تكلفة العمالة</h4>
          <button type="button" onClick={addLaborLine} className="inline-flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Plus className="w-3.5 h-3.5" /> إضافة عامل
          </button>
        </div>
        {labor.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">لا توجد تكلفة عمالة. أضف عاملاً لاحتساب صافي الربح بدقة.</p>
        ) : (
          <div className="space-y-2">
            {labor.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                <input value={l.worker} onChange={(e) => updateLabor(i, { worker: e.target.value })} placeholder="العامل"
                  className="col-span-5 bg-background border border-border/40 rounded-lg px-2 py-1 text-xs" />
                <input type="number" min={0} step="any" value={l.hours} onChange={(e) => updateLabor(i, { hours: Number(e.target.value) })} placeholder="ساعات"
                  className="col-span-2 bg-background border border-border/40 rounded-lg px-1.5 py-1 text-xs text-center" />
                <input type="number" min={0} step="any" value={l.hourlyRate} onChange={(e) => updateLabor(i, { hourlyRate: Number(e.target.value) })} placeholder="أجر/س"
                  className="col-span-2 bg-background border border-border/40 rounded-lg px-1.5 py-1 text-xs text-center" />
                <span className="col-span-2 text-[11px] text-foreground text-center">{formatCurrency((Number(l.hours) || 0) * (Number(l.hourlyRate) || 0))}</span>
                <button type="button" onClick={() => removeLabor(i)} className="col-span-1 text-status-danger"><Trash2 className="w-3.5 h-3.5 mx-auto" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <label className="text-[11px] text-muted-foreground">نسبة الهدر %</label>
          <input type="number" min={0} max={100} step="any" value={wastagePercent}
            onChange={(e) => { setWastagePercent(Number(e.target.value)); setDirty(true); }}
            className="w-20 bg-background border border-border/40 rounded-lg px-2 py-1 text-xs text-center" />
          <input value={recipeNotes} onChange={(e) => { setRecipeNotes(e.target.value); setDirty(true); }}
            placeholder="ملاحظات الوصفة (اختياري)"
            className="flex-1 bg-background border border-border/40 rounded-lg px-2 py-1 text-xs" />
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="rounded-lg border border-border/30 bg-card/60 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">تكلفة المواد</p>
          <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(materialCost)}</p>
        </div>
        <div className="rounded-lg border border-border/30 bg-card/60 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">تكلفة العمالة</p>
          <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(laborCost)}</p>
        </div>
        <div className="rounded-lg border border-border/30 bg-card/60 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">سعر البيع</p>
          <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(sellingPrice)}</p>
        </div>
        <div className="rounded-lg border border-border/30 bg-card/60 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">صافي الربح</p>
          <p className={`mt-1 text-sm font-bold ${profit >= 0 ? "text-status-success" : "text-status-danger"}`}>{formatCurrency(profit)}</p>
        </div>
        <div className="rounded-lg border border-border/30 bg-card/60 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">هامش الربح</p>
          <p className={`mt-1 text-sm font-bold ${margin >= 0 ? "text-status-success" : "text-status-danger"}`}>{margin.toFixed(1)}%</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button type="button" size="sm" onClick={save} disabled={busy || !dirty}>
          <Save className="w-4 h-4 ml-1" /> {busy ? "جارٍ الحفظ…" : dirty ? "حفظ الوصفة" : "محفوظة"}
        </Button>
        <div className="flex items-center gap-1">
          <select value={dupTarget} onChange={(e) => setDupTarget(e.target.value)}
            className="bg-background border border-border/40 rounded-lg px-2 py-1.5 text-xs max-w-[150px]">
            <option value="">نسخ الوصفة إلى…</option>
            {products.filter((p: any) => p.id !== productId).map((p: any) => (
              <option key={p.id} value={p.id}>{p.nameAr || p.name}</option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" onClick={duplicate} disabled={busy || !dupTarget}>
            <Copy className="w-4 h-4 ml-1" /> نسخ
          </Button>
        </div>
      </div>

      {/* Component picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" dir="rtl"
          onClick={() => { setPickerOpen(false); setReplaceIndex(null); }}>
          <div className="bg-card border border-border/40 rounded-2xl max-w-md w-full max-h-[80dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border/30">
              <h4 className="text-sm font-semibold text-foreground">{replaceIndex != null ? "استبدال المكوّن" : "اختر مكوّناً"}</h4>
              <button type="button" onClick={() => { setPickerOpen(false); setReplaceIndex(null); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 border-b border-border/30">
              <div className="relative">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input autoFocus value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="بحث عن منتج…"
                  className="w-full bg-background border border-border/40 rounded-lg pr-9 pl-3 py-2 text-sm" />
              </div>
            </div>
            <div className="overflow-y-auto divide-y divide-border/20">
              {pickable.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">لا توجد منتجات مطابقة.</div>
              ) : pickable.map((p: any) => (
                <button key={p.id} type="button" onClick={() => pickProduct(p)}
                  className="w-full text-right p-3 hover:bg-primary/5 flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground truncate">{p.nameAr || p.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">مخزون {Number(p.stock) || 0} · {formatCurrency(Number(p.costPrice) || 0)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───── 🎨 Product Variants tab ─────
type Variant = {
  id: number; color: string | null; colorHex: string | null; size: string | null;
  sku: string | null; barcode: string | null; qrToken: string | null; image: string | null;
  price: number | null; cost: number | null; stock: number; minStock: number;
  reserved: number; available: number; warehouseId: number | null; lowStock: boolean; outOfStock: boolean;
};
type VariantSummary = {
  hasVariants: boolean; totalStock: number; reserved: number; available: number;
  variants: Variant[]; lowStockVariants: number[]; outOfStockVariants: number[];
  reservingSources?: Array<{ sourceType: string; sourceId: number; sourceLabel: string | null; variantId: number | null; quantity: number }>;
};
type VariantForm = {
  id?: number; color: string; colorHex: string; size: string; sku: string; barcode: string;
  price: string; cost: string; stock: string; minStock: string; warehouseId: string; image: string;
};
const blankVariant: VariantForm = { color: "", colorHex: "", size: "", sku: "", barcode: "", price: "", cost: "", stock: "0", minStock: "0", warehouseId: "", image: "" };

function VariantQr({ token }: { token: string | null }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => { let ok = true; if (token) generateQrDataUrl(token, 120).then((d) => ok && setSrc(d)).catch(() => {}); return () => { ok = false; }; }, [token]);
  if (!token) return null;
  return src ? <img src={src} alt="QR" className="w-9 h-9 rounded bg-white p-0.5" /> : <div className="w-9 h-9 rounded bg-muted/40 animate-pulse" />;
}

function VariantsTab({ productId }: { productId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VariantForm | null>(null);
  const [busy, setBusy] = useState(false);
  const key = ["admin", "product-variants", productId];
  const { data, isLoading, refetch } = useQuery<VariantSummary>({
    queryKey: key,
    queryFn: () => adminFetch(`/products/${productId}/stock`),
  });
  const { data: warehouseData } = useQuery<any>({
    queryKey: ["admin", "warehouse-list"],
    queryFn: () => adminFetch("/admin/warehouse-transfers"),
    staleTime: 5 * 60 * 1000,
  });
  const warehouses: Array<{ id: number; name: string }> = warehouseData?.warehouses ?? [];
  const variants = data?.variants ?? [];

  async function save(form: VariantForm) {
    setBusy(true);
    try {
      const payload: any = {
        color: form.color || null, colorHex: form.colorHex || null, size: form.size || null,
        sku: form.sku || null, barcode: form.barcode || null,
        price: form.price === "" ? null : Number(form.price),
        cost: form.cost === "" ? null : Number(form.cost),
        stock: Number(form.stock) || 0, minStock: Number(form.minStock) || 0,
        warehouseId: form.warehouseId ? Number(form.warehouseId) : null,
      };
      if (form.image && form.image.startsWith("data:")) payload.image = form.image;
      if (form.id) await adminFetch(`/products/${productId}/variants/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await adminFetch(`/products/${productId}/variants`, { method: "POST", body: JSON.stringify(payload) });
      toast({ title: "تم حفظ المتغيّر ✅" });
      setEditing(null);
      await refetch();
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      toast({ title: "تعذر حفظ المتغيّر", description: apiErrorMessage(e), variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function remove(v: Variant) {
    if (!confirm(`حذف المتغيّر ${[v.color, v.size].filter(Boolean).join(" / ") || v.id}؟`)) return;
    try { await adminFetch(`/products/${productId}/variants/${v.id}`, { method: "DELETE" }); await refetch(); }
    catch (e: any) { toast({ title: "تعذر الحذف", description: apiErrorMessage(e), variant: "destructive" }); }
  }

  return (
    <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-foreground">🎨 متغيّرات المنتج</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">إدارة المخزون لكل متغيّر (لون/حجم) على حدة — باركود و QR وسعر ومستودع مستقل.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ ...blankVariant })}>
          <Plus className="w-4 h-4 ml-1" /> إضافة متغيّر
        </Button>
      </div>

      {/* Product stock summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border/30 bg-card/60 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">📦 إجمالي المخزون</p>
          <p className="mt-1 text-sm font-bold text-foreground">{data?.totalStock ?? 0}</p>
        </div>
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">🔒 المحجوز</p>
          <p className="mt-1 text-sm font-bold text-status-warning">{data?.reserved ?? 0}</p>
        </div>
        <div className="rounded-lg border border-status-success/30 bg-status-success/10 p-2.5 text-center">
          <p className="text-[10px] text-muted-foreground">✅ المتاح</p>
          <p className="mt-1 text-sm font-bold text-status-success">{data?.available ?? 0}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border/25 bg-card/50 p-3 text-xs text-muted-foreground">جارٍ التحميل…</div>
      ) : variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 bg-card/40 p-6 text-center text-xs text-muted-foreground">
          لا توجد متغيّرات بعد. أضف ألواناً/أحجاماً لإدارة المخزون لكل متغيّر.
        </div>
      ) : (
        <div className="space-y-2">
          {variants.map((v) => (
            <div key={v.id} className="rounded-lg border border-border/25 bg-card/60 p-2.5">
              <div className="flex items-center gap-2.5">
                {v.image ? (
                  <img src={v.image} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                ) : (
                  <span className="w-10 h-10 rounded shrink-0 border border-border/40" style={{ background: v.colorHex || "transparent" }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{[v.color, v.size].filter(Boolean).join(" / ") || `#${v.id}`}</span>
                    {v.outOfStock ? (
                      <span className="rounded-full border border-status-danger/30 bg-status-danger/10 px-1.5 py-0.5 text-[10px] text-status-danger">نفد</span>
                    ) : v.lowStock ? (
                      <span className="rounded-full border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[10px] text-status-warning">منخفض</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground font-mono truncate">{v.barcode}{v.sku ? ` · ${v.sku}` : ""}</p>
                  <p className="mt-0.5 text-[11px]">
                    <span className="text-foreground">📦 {v.stock}</span>
                    <span className="text-status-warning"> · 🔒 {v.reserved}</span>
                    <span className="text-status-success"> · ✅ {v.available}</span>
                    {v.price != null && <span className="text-muted-foreground"> · {formatCurrency(v.price)}</span>}
                  </p>
                </div>
                <VariantQr token={v.qrToken} />
                <div className="flex flex-col gap-1 shrink-0">
                  <button type="button" onClick={() => setEditing({ id: v.id, color: v.color ?? "", colorHex: v.colorHex ?? "", size: v.size ?? "", sku: v.sku ?? "", barcode: v.barcode ?? "", price: v.price != null ? String(v.price) : "", cost: v.cost != null ? String(v.cost) : "", stock: String(v.stock), minStock: String(v.minStock), warehouseId: v.warehouseId ? String(v.warehouseId) : "", image: v.image ?? "" })}
                    className="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => remove(v)} className="rounded-md border border-border/40 px-2 py-1 text-[11px] text-status-danger hover:bg-status-danger/10"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reserving bookings */}
      {data?.reservingSources && data.reservingSources.length > 0 && (
        <div className="rounded-lg border border-border/25 bg-card/50 p-2.5">
          <p className="text-[11px] font-semibold text-foreground mb-1">🔒 حجوزات تحجز هذا المخزون:</p>
          {data.reservingSources.map((s, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{s.sourceLabel || `${s.sourceType} #${s.sourceId}`}</span>
              <span>{s.quantity}</span>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <VariantEditor form={editing} warehouses={warehouses} busy={busy} onChange={setEditing} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  );
}

function VariantEditor({ form, warehouses, busy, onChange, onClose, onSave }: {
  form: VariantForm; warehouses: Array<{ id: number; name: string }>; busy: boolean;
  onChange: (f: VariantForm) => void; onClose: () => void; onSave: (f: VariantForm) => void;
}) {
  async function pickImage(files: FileList | null) {
    if (!files?.[0]) return;
    const dataUrl = await fileToDataUrl(files[0]);
    onChange({ ...form, image: dataUrl });
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-2xl max-w-md w-full max-h-[85dvh] overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">{form.id ? "تعديل متغيّر" : "متغيّر جديد"}</h4>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Inp label="اللون" value={form.color} onChange={(v) => onChange({ ...form, color: v })} />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">لون العرض</label>
            <input type="color" value={form.colorHex || "#22c55e"} onChange={(e) => onChange({ ...form, colorHex: e.target.value })} className="w-full h-9 bg-background border border-border/40 rounded-lg" />
          </div>
          <Inp label="الحجم (اختياري)" value={form.size} onChange={(v) => onChange({ ...form, size: v })} />
          <Inp label="SKU" value={form.sku} onChange={(v) => onChange({ ...form, sku: v })} />
          <Inp label="الباركود (تلقائي إن تُرك)" value={form.barcode} onChange={(v) => onChange({ ...form, barcode: v })} />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">المستودع</label>
            <select value={form.warehouseId} onChange={(e) => onChange({ ...form, warehouseId: e.target.value })} className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <Inp label="سعر البيع (اختياري)" value={form.price} onChange={(v) => onChange({ ...form, price: v })} type="number" />
          <Inp label="تكلفة الشراء (اختياري)" value={form.cost} onChange={(v) => onChange({ ...form, cost: v })} type="number" />
          <Inp label="الكمية" value={form.stock} onChange={(v) => onChange({ ...form, stock: v })} type="number" />
          <Inp label="الحد الأدنى" value={form.minStock} onChange={(v) => onChange({ ...form, minStock: v })} type="number" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">صورة المتغيّر</label>
          <div className="flex items-center gap-2">
            {form.image && <img src={form.image} alt="" className="w-12 h-12 rounded object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files)} className="text-xs text-muted-foreground" />
          </div>
        </div>
        <Button type="button" onClick={() => onSave(form)} disabled={busy} className="w-full">
          <Save className="w-4 h-4 ml-1" /> {busy ? "جارٍ الحفظ…" : "حفظ المتغيّر"}
        </Button>
      </div>
    </div>
  );
}
