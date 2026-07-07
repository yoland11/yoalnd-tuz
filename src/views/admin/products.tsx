import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCreateProduct, useUpdateProduct, useDeleteProduct,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { ArrowRight, Eye, Plus, Edit2, Trash2, X, Search, Upload, Boxes, Save, Star, Video, Play, ImagePlus, Link2, AlertTriangle, CheckCircle2, PackageX, CalendarDays, QrCode } from "lucide-react";
import { Link } from "wouter";
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
  // Admin uses the admin endpoint (same products table, but NO isActive filter and a high
  // limit) so hidden/archived products and products beyond the store's page also appear.
  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ["admin", "products-all"],
    queryFn: () => adminFetch("/admin/products?limit=2000"),
    staleTime: 30_000,
  });
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
  const [visFilter, setVisFilter] = useState<"all" | "visible" | "hidden" | "archived" | "rental" | "nocat">("all");
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

  const isArchived = (p: any) => Boolean(p.archivedAt);
  const isHidden = (p: any) => !isArchived(p) && p.isActive === false;
  const isVisible = (p: any) => !isArchived(p) && p.isActive !== false;
  const hasNoCategory = (p: any) => !p.categoryId && !p.subcategoryId && !String(p.category ?? "").trim();

  const filtered = useMemo(() => {
    let rows = productRows;
    if (catFilter) rows = rows.filter((p: any) => p.category === catFilter);
    if (stockFilter !== "all") rows = rows.filter((p: any) => stockStatus(p) === stockFilter);
    if (visFilter === "visible") rows = rows.filter(isVisible);
    else if (visFilter === "hidden") rows = rows.filter(isHidden);
    else if (visFilter === "archived") rows = rows.filter(isArchived);
    else if (visFilter === "rental") rows = rows.filter((p: any) => p.isRental);
    else if (visFilter === "nocat") rows = rows.filter(hasNoCategory);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((p: any) =>
        [
          p.nameAr,
          p.name,
          p.barcode, // product code
          p.category,
          p.subcategory,
          p.description,
          p.descriptionAr,
          p.sharedStockProductName,
        ].some((v) => String(v ?? "").toLowerCase().includes(s)),
      );
    }
    return rows;
  }, [productRows, search, catFilter, stockFilter, visFilter]);

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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الباركود أو التصنيف أو الوصف..."
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
        <select value={visFilter} onChange={e => setVisFilter(e.target.value as typeof visFilter)}
          className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <option value="all">كل المنتجات</option>
          <option value="visible">الظاهرة</option>
          <option value="hidden">المخفية</option>
          <option value="archived">المؤرشفة</option>
          <option value="rental">الإيجار</option>
          <option value="nocat">بدون تصنيف</option>
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
                        <div className="flex flex-wrap gap-1">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            isArchived(p) ? "bg-muted text-muted-foreground"
                              : p.isActive === false ? "bg-status-danger/10 text-status-danger"
                                : "bg-status-success/10 text-status-success"
                          }`}>
                            {isArchived(p) ? "مؤرشف" : p.isActive === false ? "مخفي" : "ظاهر"}
                          </span>
                          {hasNoCategory(p) && (
                            <span className="text-xs px-2 py-1 rounded-full bg-status-warning/10 text-status-warning">بدون تصنيف</span>
                          )}
                        </div>
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
  const [activeTab, setActiveTab] = useState<"details" | "rentals">("details");
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
          </div>
        )}

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
        ) : (
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
        )}
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
