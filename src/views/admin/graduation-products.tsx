import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Loader2,
  Package,
  Plus,
  Save,
  Search,
  Shirt,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  adminFetch,
  apiErrorMessage,
  compressImageFile,
  formatCurrency,
} from "./_lib";

type ProductType = "robe" | "sash" | "cap";

const TYPE_LABEL: Record<ProductType, string> = {
  robe: "الروبات",
  sash: "الأوشحة",
  cap: "القبعات",
};
const TYPE_SINGULAR: Record<ProductType, string> = {
  robe: "روب",
  sash: "وشاح",
  cap: "قبعة",
};

type StatusFilter = "all" | "active" | "inactive" | "archived";

const emptyProduct = {
  id: null as number | null,
  templateType: "robe" as ProductType,
  name: "",
  code: "",
  sku: "",
  barcode: "",
  previewImageUrl: "",
  images: [] as string[],
  defaultPrice: 0,
  costPrice: 0,
  discountPrice: "" as string,
  trackStock: false,
  stock: 0,
  minStock: 0,
  isActive: true,
  isFeatured: false,
  sortOrder: 0,
  // Flexible per-type attributes (comma separated in the form).
  sizes: "",
  colors: "",
  fabrics: "",
  printOptions: "",
  embroideryOptions: "",
  tasselColors: "",
  productionDays: "",
  rentalOrSale: "sale",
  gownModel: "",
  gownStyle: "",
  fabricType: "",
  sizeChart: "",
  sashModel: "",
  material: "",
  capModel: "",
  optionPricesText: "",
  notes: "",
  // Any configuration keys we don't surface — preserved on save.
  _configuration: {} as Record<string, unknown>,
};

type ProductForm = typeof emptyProduct;

function splitList(value: string): string[] {
  return value
    .split(/[,،\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join("، ") : "";
}

function parseOptionPrices(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split(/\n/)) {
    const match = line.split("=");
    if (match.length < 2) continue;
    const key = match[0].trim();
    const amount = Number(match.slice(1).join("=").replace(/[,،]/g, "").trim());
    if (key && Number.isFinite(amount)) out[key] = amount;
  }
  return out;
}

function formatOptionPrices(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([key, amount]) => `${key} = ${Number(amount) || 0}`)
    .join("\n");
}

function unitPrice(item: any) {
  const discount = item.discountPrice;
  return discount != null && Number(discount) > 0
    ? Number(discount)
    : Number(item.defaultPrice || 0);
}

function stockStatus(item: any): { label: string; tone: string } {
  if (!item.trackStock) return { label: "غير مُتتبع", tone: "text-muted-foreground" };
  const stock = Number(item.stock || 0);
  if (stock <= 0) return { label: "نفد المخزون", tone: "text-destructive" };
  if (stock <= Number(item.minStock || 0))
    return { label: `منخفض (${stock})`, tone: "text-status-warning" };
  return { label: `متوفر (${stock})`, tone: "text-status-success" };
}

function buildConfiguration(form: ProductForm): Record<string, unknown> {
  const config: Record<string, unknown> = { ...form._configuration };
  config.sizes = splitList(form.sizes);
  config.colors = splitList(form.colors);
  config.optionPrices = parseOptionPrices(form.optionPricesText);
  if (form.productionDays) config.productionDays = Number(form.productionDays);
  config.rentalOrSale = form.rentalOrSale;
  if (form.templateType === "robe") {
    config.gownModel = form.gownModel;
    config.gownStyle = form.gownStyle;
    config.fabricType = form.fabricType;
    config.sizeChart = form.sizeChart;
    config.fabrics = splitList(form.fabrics);
  }
  if (form.templateType === "sash") {
    config.sashModel = form.sashModel;
    config.material = form.material;
    config.printOptions = splitList(form.printOptions);
    config.embroideryOptions = splitList(form.embroideryOptions);
  }
  if (form.templateType === "cap") {
    config.capModel = form.capModel;
    config.tasselColors = splitList(form.tasselColors);
  }
  if (form.notes) config.notes = form.notes;
  return config;
}

function formFromItem(item: any): ProductForm {
  const config = (item.configuration || {}) as Record<string, any>;
  return {
    ...emptyProduct,
    id: item.id,
    templateType: (["robe", "sash", "cap"].includes(item.templateType)
      ? item.templateType
      : "robe") as ProductType,
    name: item.name || "",
    code: item.code || "",
    sku: item.sku || "",
    barcode: item.barcode || "",
    previewImageUrl: item.previewImageUrl || "",
    images: Array.isArray(item.images) ? item.images : [],
    defaultPrice: Number(item.defaultPrice || 0),
    costPrice: Number(item.costPrice || 0),
    discountPrice: item.discountPrice != null ? String(item.discountPrice) : "",
    trackStock: Boolean(item.trackStock),
    stock: Number(item.stock || 0),
    minStock: Number(item.minStock || 0),
    isActive: item.isActive !== false,
    isFeatured: Boolean(item.isFeatured),
    sortOrder: Number(item.sortOrder || 0),
    sizes: joinList(config.sizes),
    colors: joinList(config.colors),
    fabrics: joinList(config.fabrics),
    printOptions: joinList(config.printOptions),
    embroideryOptions: joinList(config.embroideryOptions),
    tasselColors: joinList(config.tasselColors),
    productionDays: config.productionDays ? String(config.productionDays) : "",
    rentalOrSale: String(config.rentalOrSale || "sale"),
    gownModel: config.gownModel || "",
    gownStyle: config.gownStyle || "",
    fabricType: config.fabricType || "",
    sizeChart: config.sizeChart || "",
    sashModel: config.sashModel || "",
    material: config.material || "",
    capModel: config.capModel || "",
    optionPricesText: formatOptionPrices(config.optionPrices),
    notes: config.notes || "",
    _configuration: config,
  };
}

function savePayload(form: ProductForm) {
  return {
    name: form.name,
    code: form.code || undefined,
    templateType: form.templateType,
    sku: form.sku || undefined,
    barcode: form.barcode || undefined,
    previewImageUrl: form.previewImageUrl,
    images: form.images,
    defaultPrice: form.defaultPrice,
    costPrice: form.costPrice,
    discountPrice: form.discountPrice === "" ? null : Number(form.discountPrice),
    trackStock: form.trackStock,
    stock: form.stock,
    minStock: form.minStock,
    isActive: form.isActive,
    isFeatured: form.isFeatured,
    sortOrder: form.sortOrder,
    configuration: buildConfiguration(form),
  };
}

export function GraduationProductsCenter() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [tab, setTab] = useState<ProductType>("robe");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ items: any[] }>({
    queryKey: ["admin", "graduation", "templates"],
    queryFn: () => adminFetch("/admin/graduation/templates"),
  });
  const items = data?.items ?? [];

  const invalidate = () =>
    client.invalidateQueries({ queryKey: ["admin", "graduation", "templates"] });

  const save = useMutation({
    mutationFn: () =>
      adminFetch(
        form.id
          ? `/admin/graduation/templates/${form.id}`
          : "/admin/graduation/templates",
        {
          method: form.id ? "PATCH" : "POST",
          body: JSON.stringify(savePayload(form)),
        },
      ),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      toast({ title: form.id ? "تم تحديث المنتج" : "تمت إضافة المنتج" });
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ المنتج",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  const action = useMutation<
    any,
    Error,
    { id: number; verb: "archive" | "restore" | "duplicate" | "delete" }
  >({
    mutationFn: ({ id, verb }) =>
      adminFetch(
        verb === "delete"
          ? `/admin/graduation/templates/${id}`
          : `/admin/graduation/templates/${id}/${verb}`,
        { method: verb === "delete" ? "DELETE" : verb === "duplicate" ? "POST" : "PATCH" },
      ),
    onSuccess: (_result, variables) => {
      invalidate();
      const labels = {
        archive: "تمت أرشفة المنتج",
        restore: "تمت استعادة المنتج",
        duplicate: "تم نسخ المنتج",
        delete: "تم حذف المنتج نهائياً",
      };
      toast({ title: labels[variables.verb] });
    },
    onError: (error) =>
      toast({
        title: "تعذر تنفيذ الإجراء",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });

  const overview = useMemo(() => {
    const byType = (type: ProductType) =>
      items.filter((item) => item.templateType === type && !item.archivedAt).length;
    return {
      robe: byType("robe"),
      sash: byType("sash"),
      cap: byType("cap"),
      active: items.filter((item) => item.isActive && !item.archivedAt).length,
      outOfStock: items.filter(
        (item) => item.trackStock && Number(item.stock || 0) <= 0 && !item.archivedAt,
      ).length,
      archived: items.filter((item) => item.archivedAt).length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter((item) => item.templateType === tab)
      .filter((item) => {
        if (statusFilter === "archived") return Boolean(item.archivedAt);
        if (item.archivedAt) return false;
        if (statusFilter === "active") return item.isActive;
        if (statusFilter === "inactive") return !item.isActive;
        return true;
      })
      .filter((item) =>
        term
          ? [item.name, item.code, item.sku, item.barcode]
              .filter(Boolean)
              .some((value: string) => String(value).toLowerCase().includes(term))
          : true,
      );
  }, [items, tab, statusFilter, search]);

  function openCreate() {
    setForm({ ...emptyProduct, templateType: tab });
    setOpen(true);
  }
  function openEdit(item: any) {
    setForm(formFromItem(item));
    setOpen(true);
  }
  async function uploadImage(file: File) {
    try {
      const dataUrl = await compressImageFile(file, 1400, 0.82);
      setForm((current) => ({
        ...current,
        previewImageUrl: current.previewImageUrl || dataUrl,
        images: [...current.images, dataUrl],
      }));
    } catch {
      toast({ title: "تعذر معالجة الصورة", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["الروبات", overview.robe],
          ["الأوشحة", overview.sash],
          ["القبعات", overview.cap],
          ["المنتجات النشطة", overview.active],
          ["غير المتوفرة", overview.outOfStock],
          ["المؤرشفة", overview.archived],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <strong className="text-xl">{value as number}</strong>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as ProductType)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="robe">الروبات</TabsTrigger>
            <TabsTrigger value="sash">الأوشحة</TabsTrigger>
            <TabsTrigger value="cap">القبعات</TabsTrigger>
          </TabsList>
          <Button onClick={openCreate}>
            <Plus className="ml-2 h-4 w-4" />
            إضافة {TYPE_SINGULAR[tab]}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pr-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالاسم أو الكود أو SKU أو الباركود"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="active">نشط</SelectItem>
              <SelectItem value="inactive">متوقف</SelectItem>
              <SelectItem value="archived">مؤرشف</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(["robe", "sash", "cap"] as ProductType[]).map((type) => (
          <TabsContent key={type} value={type} className="mt-4">
            {isLoading ? (
              <Skeleton className="h-72" />
            ) : filtered.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((item) => {
                  const stock = stockStatus(item);
                  const discounted =
                    item.discountPrice != null &&
                    Number(item.discountPrice) > 0 &&
                    Number(item.discountPrice) < Number(item.defaultPrice || 0);
                  return (
                    <Card key={item.id} className="overflow-hidden">
                      <div className="aspect-[16/9] bg-muted">
                        {item.previewImageUrl ? (
                          <img
                            src={item.previewImageUrl}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Shirt className="h-12 w-12 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate font-bold">{item.name}</h3>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {item.code}
                              {item.sku ? ` · ${item.sku}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {item.isFeatured ? <Badge>مميز</Badge> : null}
                            {item.archivedAt ? (
                              <Badge variant="secondary">مؤرشف</Badge>
                            ) : !item.isActive ? (
                              <Badge variant="secondary">متوقف</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className={stock.tone}>{stock.label}</span>
                          <div className="text-left">
                            {discounted ? (
                              <span className="block text-[11px] text-muted-foreground line-through">
                                {formatCurrency(Number(item.defaultPrice || 0))}
                              </span>
                            ) : null}
                            <strong>{formatCurrency(unitPrice(item))}</strong>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => openEdit(item)}
                          >
                            تعديل
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="نسخ المنتج"
                            onClick={() =>
                              action.mutate({ id: item.id, verb: "duplicate" })
                            }
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          {item.archivedAt ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="استعادة"
                              onClick={() =>
                                action.mutate({ id: item.id, verb: "restore" })
                              }
                            >
                              <ArchiveRestore className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="أرشفة"
                              onClick={() =>
                                action.mutate({ id: item.id, verb: "archive" })
                              }
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            title="حذف نهائي"
                            onClick={() => {
                              if (
                                confirm(
                                  "سيتم حذف المنتج نهائياً إن لم يكن مرتبطاً بأي طلب. هل تريد المتابعة؟",
                                )
                              )
                                action.mutate({ id: item.id, verb: "delete" });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-12 text-center">
                <Package className="mx-auto h-10 w-10 text-primary" />
                <h3 className="mt-3 font-bold">لا توجد منتجات في هذا القسم</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  أضف أول {TYPE_SINGULAR[type]} ليظهر في مُعدّ الباقة المخصصة للزبون.
                </p>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-h-[92dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "تعديل المنتج" : `إضافة ${TYPE_SINGULAR[form.templateType]}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>نوع المنتج</Label>
              <Select
                value={form.templateType}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, templateType: value as ProductType }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="robe">روب</SelectItem>
                  <SelectItem value="sash">وشاح</SelectItem>
                  <SelectItem value="cap">قبعة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field label="اسم المنتج" value={form.name} onChange={(v) => setForm((c) => ({ ...c, name: v }))} />
            <Field label="الكود (يُولّد تلقائياً)" value={form.code} onChange={(v) => setForm((c) => ({ ...c, code: v }))} />
            <Field label="SKU" value={form.sku} onChange={(v) => setForm((c) => ({ ...c, sku: v }))} />
            <Field label="الباركود" value={form.barcode} onChange={(v) => setForm((c) => ({ ...c, barcode: v }))} />
            <NumberField label="السعر الأساسي" value={form.defaultPrice} onChange={(v) => setForm((c) => ({ ...c, defaultPrice: v }))} />
            <NumberField label="سعر الكلفة" value={form.costPrice} onChange={(v) => setForm((c) => ({ ...c, costPrice: v }))} />
            <div>
              <Label>سعر الخصم (اتركه فارغاً لإلغائه)</Label>
              <Input
                className="mt-2"
                type="number"
                value={form.discountPrice}
                onChange={(event) =>
                  setForm((current) => ({ ...current, discountPrice: event.target.value }))
                }
              />
            </div>
            <NumberField label="ترتيب العرض" value={form.sortOrder} onChange={(v) => setForm((c) => ({ ...c, sortOrder: v }))} />

            <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-lg border border-border p-3">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.trackStock}
                  onCheckedChange={(v) => setForm((c) => ({ ...c, trackStock: v === true }))}
                />
                تتبع المخزون
              </label>
              {form.trackStock ? (
                <>
                  <NumberField label="الكمية المتاحة" value={form.stock} onChange={(v) => setForm((c) => ({ ...c, stock: v }))} inline />
                  <NumberField label="حد التنبيه" value={form.minStock} onChange={(v) => setForm((c) => ({ ...c, minStock: v }))} inline />
                </>
              ) : null}
            </div>

            <Field label="المقاسات (افصل بفواصل)" value={form.sizes} onChange={(v) => setForm((c) => ({ ...c, sizes: v }))} />
            <Field label="الألوان (افصل بفواصل)" value={form.colors} onChange={(v) => setForm((c) => ({ ...c, colors: v }))} />

            {form.templateType === "robe" ? (
              <>
                <Field label="موديل الروب" value={form.gownModel} onChange={(v) => setForm((c) => ({ ...c, gownModel: v }))} />
                <Field label="ستايل الروب" value={form.gownStyle} onChange={(v) => setForm((c) => ({ ...c, gownStyle: v }))} />
                <Field label="نوع القماش" value={form.fabricType} onChange={(v) => setForm((c) => ({ ...c, fabricType: v }))} />
                <Field label="الأقمشة المتاحة (فواصل)" value={form.fabrics} onChange={(v) => setForm((c) => ({ ...c, fabrics: v }))} />
                <Field label="رابط جدول المقاسات" value={form.sizeChart} onChange={(v) => setForm((c) => ({ ...c, sizeChart: v }))} />
              </>
            ) : null}
            {form.templateType === "sash" ? (
              <>
                <Field label="موديل الوشاح" value={form.sashModel} onChange={(v) => setForm((c) => ({ ...c, sashModel: v }))} />
                <Field label="الخامة" value={form.material} onChange={(v) => setForm((c) => ({ ...c, material: v }))} />
                <Field label="خيارات الطباعة (فواصل)" value={form.printOptions} onChange={(v) => setForm((c) => ({ ...c, printOptions: v }))} />
                <Field label="خيارات التطريز (فواصل)" value={form.embroideryOptions} onChange={(v) => setForm((c) => ({ ...c, embroideryOptions: v }))} />
              </>
            ) : null}
            {form.templateType === "cap" ? (
              <>
                <Field label="موديل القبعة" value={form.capModel} onChange={(v) => setForm((c) => ({ ...c, capModel: v }))} />
                <Field label="ألوان الشرابة (فواصل)" value={form.tasselColors} onChange={(v) => setForm((c) => ({ ...c, tasselColors: v }))} />
              </>
            ) : null}

            <div>
              <Label>مدة التجهيز (أيام)</Label>
              <Input
                className="mt-2"
                type="number"
                value={form.productionDays}
                onChange={(event) =>
                  setForm((current) => ({ ...current, productionDays: event.target.value }))
                }
              />
            </div>
            <div>
              <Label>البيع أو الإيجار</Label>
              <Select
                value={form.rentalOrSale}
                onValueChange={(value) => setForm((c) => ({ ...c, rentalOrSale: value }))}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sale">بيع</SelectItem>
                  <SelectItem value="rental">إيجار</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2">
              <Label>أسعار الخيارات الإضافية (كل سطر: المفتاح = المبلغ)</Label>
              <Textarea
                className="mt-2 min-h-20 font-mono text-xs"
                dir="ltr"
                placeholder={"size:XL = 5000\nfabric:velvet = 10000\nprint:full = 8000"}
                value={form.optionPricesText}
                onChange={(event) =>
                  setForm((current) => ({ ...current, optionPricesText: event.target.value }))
                }
              />
            </div>

            <div className="sm:col-span-2">
              <Label>صور المنتج</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {form.images.map((image, index) => (
                  <div key={`${image.slice(0, 24)}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                    <img src={image} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-0 top-0 bg-destructive p-0.5 text-white"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          images: current.images.filter((_, i) => i !== index),
                          previewImageUrl:
                            current.previewImageUrl === image
                              ? current.images.filter((_, i) => i !== index)[0] || ""
                              : current.previewImageUrl,
                        }))
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="flex h-16 w-16 flex-col items-center justify-center rounded-lg border border-dashed border-primary/50 text-primary"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-5 w-5" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadImage(file);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea
                className="mt-2"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>

            <label className="flex items-center gap-2">
              <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm((c) => ({ ...c, isActive: v === true }))} />
              نشط
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={form.isFeatured} onCheckedChange={(v) => setForm((c) => ({ ...c, isFeatured: v === true }))} />
              مميز
            </label>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || form.name.trim().length < 2}
            >
              {save.isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="ml-2 h-4 w-4" />
              )}
              حفظ المنتج
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-2" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  inline,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "w-32" : undefined}>
      <Label>{label}</Label>
      <Input
        className="mt-2"
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
