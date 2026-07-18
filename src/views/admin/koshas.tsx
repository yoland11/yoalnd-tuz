import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, BarChart3, Check, Edit2, Eye, EyeOff, FileDown, Gift, Image as ImageIcon, Layers, LayoutGrid, MapPin, Minus, Package, Plus, Printer, Save, ScanLine, Sparkles, Trash2, X } from "lucide-react";
import { LiveScanner } from "../staff/live-scanner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { usePublicSettings } from "@/lib/public-settings";
import { adminFetch, apiErrorMessage, apiErrorStatus, formatCurrency } from "./_lib";
import { thermalReceiptCss, printWhenImagesReadyScript } from "./print-helpers";
import { EmptyState } from "./_layout";
import type { Kosha, KoshaImage, KoshaCategory } from "@/views/koshas";
import { formatMoney } from "@/lib/money";
import { AccountSummaryCard } from "./payment-collection";

type KoshaFormState = Omit<Kosha, "id" | "galleryImages"> & {
  id?: number;
  galleryImages: KoshaImage[];
};

type KoshaBooking = {
  id: number;
  koshaId: number | null;
  koshaName: string | null;
  packageId?: number | null;
  packageName?: string | null;
  packagePrice?: number | null;
  customerName: string;
  phone: string;
  brideName: string;
  groomName: string;
  eventDate: string;
  eventTime: string;
  eventType: string;
  serviceLevel: string;
  venueType: string;
  themeColor: string;
  province: string;
  area: string;
  mahalla: string;
  nearestPoint: string;
  addressNotes: string;
  bridePhone: string;
  groomPhone: string;
  alternatePhone: string;
  cityArea: string;
  hallLocation: string;
  selectedAddons: string[];
  welcomeBoards: string[];
  selectedAccessories: string[];
  venueImages: string[];
  bookingDetails: Record<string, unknown>;
  primaryEmployeeId?: number | null;
  primaryEmployeeName?: string | null;
  assistantEmployeeId?: number | null;
  assistantEmployeeName?: string | null;
  notes: string;
  status: string;
  trackingCode?: string | null;
  trackingStatus?: string;
  internalNotes: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  /** Unified financial projection (populated by the booking finance API when available). */
  approvedCollectedAmount?: number;
  pendingCollectionAmount?: number;
  refundedAmount?: number;
  discount?: number;
  additionalCharges?: number;
  latestPaymentDate?: string | null;
  customerId?: number | null;
  finance?: KoshaBookingFinance | null;
  paymentStatus: string;
  dueDate?: string | null;
  createdAt: string;
};

type KoshaBookingFinanceMovement = {
  id?: number | string;
  transactionNo?: string | null;
  receiptVoucherNo?: string | null;
  amount: number;
  date?: string | null;
  status?: string | null;
  method?: string | null;
  source?: string | null;
  collector?: string | null;
  approvedBy?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
};

type KoshaBookingFinance = {
  totalAmount?: number;
  paidAmount?: number;
  approvedCollectedAmount?: number;
  pendingCollectionAmount?: number;
  refundedAmount?: number;
  discount?: number;
  additionalCharges?: number;
  remainingAmount?: number;
  paymentStatus?: string;
  latestPaymentDate?: string | null;
  payments?: KoshaBookingFinanceMovement[];
  collections?: KoshaBookingFinanceMovement[];
  cashboxMovements?: KoshaBookingFinanceMovement[];
  journalEntries?: Array<KoshaBookingFinanceMovement & { entryNo?: string | null }>;
  customerId?: number | null;
};
type KoshaBookingFinanceResponse = KoshaBookingFinance & { finance?: KoshaBookingFinance | null };

type KoshaOption = {
  id: number;
  name: string;
  price?: number;
  description?: string | null;
  mainImage?: string | null;
  isActive: boolean;
  sortOrder: number;
};

const EMPTY_KOSHA: KoshaFormState = {
  name: "",
  slug: "",
  description: "",
  price: 0,
  oldPrice: null,
  discountPercentage: 0,
  mainImage: "",
  galleryImages: [],
  numberOfPieces: null,
  mainColor: "",
  flowerColor: "",
  koshaSpace: "",
  sideConsoleSpace: "",
  accessories: [],
  notes: "",
  availabilityStatus: "available",
  isFeatured: false,
  isActive: true,
  sortOrder: 0,
  categoryId: null,
};

const KOSHA_TRACKING_STAGES: Array<{ key: string; label: string }> = [
  { key: "booked", label: "تم الحجز" },
  { key: "preparing", label: "قيد التجهيز" },
  { key: "accessories", label: "تجهيز الإكسسوارات" },
  { key: "welcome_board", label: "تجهيز البورد الترحيبي" },
  { key: "ready", label: "جاهزة للتنفيذ" },
  { key: "executed", label: "تم التنفيذ" },
  { key: "completed", label: "مكتمل" },
];

const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  confirmed: "مؤكد",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغي",
};

function koshaBookingTotal(details: Record<string, unknown> | null | undefined) {
  const value = Number((details as any)?.total ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isKoshaPendingPricing(booking: Pick<KoshaBooking, "paymentStatus" | "totalAmount">) {
  return booking.paymentStatus === "pending_pricing" || Number(booking.totalAmount ?? 0) <= 0;
}

function koshaBookingAmountLabel(booking: Pick<KoshaBooking, "paymentStatus" | "totalAmount">) {
  return isKoshaPendingPricing(booking) ? "بانتظار التسعير" : formatCurrency(booking.totalAmount);
}

/** Remaining = Total − Paid (prefers the server-computed value, falls back to the difference). */
function koshaRemaining(booking: Pick<KoshaBooking, "totalAmount" | "paidAmount" | "remainingAmount">) {
  const total = Number(booking.totalAmount ?? 0);
  const paid = Number(booking.paidAmount ?? 0);
  const stored = booking.remainingAmount;
  return stored === null || stored === undefined ? Math.max(0, total - paid) : Number(stored);
}

/** Colour rule: 0 = green · <50% of total = orange · ≥50% of total = red. */
function koshaRemainingTone(remaining: number, total: number) {
  if (remaining <= 0) return "text-status-success";
  if (total > 0 && remaining < total * 0.5) return "text-status-warning";
  return "text-destructive";
}

type KoshaCatalogEndpoint = "kosha-addons" | "kosha-welcome-boards" | "kosha-accessories";

const EMPTY_KOSHA_OPTION = {
  name: "",
  price: 0,
  description: "",
  mainImage: "",
  isActive: true,
  sortOrder: 0,
};

function fieldValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  textarea = false,
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  type?: string;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {textarea ? (
        <textarea value={fieldValue(value)} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      ) : (
        <input value={fieldValue(value)} type={type} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      )}
    </div>
  );
}

function normalizeForm(kosha: Partial<Kosha> | null | undefined): KoshaFormState {
  return {
    ...EMPTY_KOSHA,
    ...(kosha ?? {}),
    galleryImages: kosha?.galleryImages ?? [],
    accessories: kosha?.accessories ?? [],
  };
}

function optionalNumber(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanKoshaPayload(form: KoshaFormState) {
  return {
    name: String(form.name ?? "").trim(),
    slug: String(form.slug ?? "").trim(),
    description: String(form.description ?? "").trim(),
    price: numberOrZero(form.price),
    oldPrice: optionalNumber(form.oldPrice),
    discountPercentage: Math.min(100, Math.max(0, Math.floor(numberOrZero(form.discountPercentage)))),
    mainImage: form.mainImage || null,
    numberOfPieces: optionalNumber(form.numberOfPieces),
    mainColor: String(form.mainColor ?? "").trim(),
    flowerColor: String(form.flowerColor ?? "").trim(),
    koshaSpace: String(form.koshaSpace ?? "").trim(),
    sideConsoleSpace: String(form.sideConsoleSpace ?? "").trim(),
    accessories: Array.isArray(form.accessories) ? form.accessories.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
    notes: String(form.notes ?? "").trim(),
    availabilityStatus: form.availabilityStatus || "available",
    isFeatured: Boolean(form.isFeatured),
    isActive: form.isActive !== false,
    sortOrder: Math.floor(numberOrZero(form.sortOrder)),
    categoryId: form.categoryId ?? null,
    galleryImages: (form.galleryImages ?? []).map((image, index) => ({
      imageUrl: image.imageUrl || "",
      imageMetadata: image.imageMetadata && typeof image.imageMetadata === "object" ? image.imageMetadata : {},
      sortOrder: index,
    })).filter((image) => image.imageUrl),
  };
}

function KoshaCatalogOptionsManager({
  title,
  description,
  endpoint,
}: {
  title: string;
  description: string;
  endpoint: KoshaCatalogEndpoint;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: publicSettings } = usePublicSettings();
  const [draft, setDraft] = useState({ ...EMPTY_KOSHA_OPTION });
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", endpoint],
    queryFn: () => adminFetch<KoshaOption[]>(`/admin/${endpoint}`),
  });
  const create = useMutation({
    mutationFn: () => adminFetch(`/admin/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        name: draft.name.trim(),
        price: numberOrZero(draft.price),
        sortOrder: Number.isFinite(Number(draft.sortOrder)) ? Number(draft.sortOrder) : data.length * 10 + 10,
      }),
    }),
    onSuccess: () => {
      setDraft({ ...EMPTY_KOSHA_OPTION, sortOrder: data.length * 10 + 20 });
      queryClient.invalidateQueries({ queryKey: ["admin", endpoint] });
      toast({ title: "تمت الإضافة" });
    },
    onError: (err: any) => toast({ title: "تعذر الإضافة", description: err?.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<KoshaOption> }) => adminFetch(`/admin/${endpoint}/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", endpoint] });
      toast({ title: "تم الحفظ" });
    },
    onError: (err: any) => toast({ title: "تعذر الحفظ", description: err?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/${endpoint}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", endpoint] });
      toast({ title: "تم الحذف" });
    },
    onError: (err: any) => toast({ title: "تعذر الحذف", description: err?.message, variant: "destructive" }),
  });

  function draftImageResult(results: ImageEditResult[]) {
    const result = results[0];
    if (!result) return;
    setDraft((current) => ({ ...current, mainImage: result.dataUrl }));
  }

  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <div className="mb-3">
        <h2 className="font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mb-4 grid gap-3 rounded-lg border border-border/30 bg-background/45 p-3 lg:grid-cols-[1fr_110px_90px]">
        <Field label="الاسم" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
        <Field label="السعر" type="number" value={draft.price} onChange={(value) => setDraft((current) => ({ ...current, price: Number(value) || 0 }))} />
        <Field label="الترتيب" type="number" value={draft.sortOrder} onChange={(value) => setDraft((current) => ({ ...current, sortOrder: Number(value) || 0 }))} />
        <div className="lg:col-span-2">
          <Field label="الوصف" textarea value={draft.description} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">الصورة</label>
          <ImageUploadEditor
            kind="gallery"
            label="رفع صورة"
            currentImage={draft.mainImage || null}
            settings={publicSettings?.image_settings}
            watermarkText={publicSettings?.site_name}
            onComplete={draftImageResult}
            onRemove={() => setDraft((current) => ({ ...current, mainImage: "" }))}
          />
        </div>
        <div className="flex items-end">
          <Button type="button" size="sm" onClick={() => create.mutate()} disabled={!draft.name.trim() || create.isPending} className="w-full">
            {create.isPending ? "جاري الإضافة..." : "إضافة"}
          </Button>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-28 rounded-lg" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((item) => (
            <KoshaCatalogOptionRow
              key={item.id}
              item={item}
              settings={publicSettings?.image_settings}
              watermarkText={publicSettings?.site_name}
              endpoint={endpoint}
              onSave={(values) => update.mutate({ id: item.id, values })}
              onDelete={() => confirm("حذف العنصر؟") && remove.mutate(item.id)}
            />
          ))}
          {data.length === 0 && <p className="rounded-lg border border-border/30 bg-background/60 p-3 text-center text-sm text-muted-foreground md:col-span-2">لا توجد عناصر بعد.</p>}
        </div>
      )}
    </div>
  );
}

function KoshaCatalogOptionRow({
  item,
  settings,
  watermarkText,
  endpoint,
  onSave,
  onDelete,
}: {
  item: KoshaOption;
  settings: any;
  watermarkText?: string;
  endpoint: KoshaCatalogEndpoint;
  onSave: (values: Partial<KoshaOption>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price ?? 0));
  const [description, setDescription] = useState(item.description ?? "");
  const [mainImage, setMainImage] = useState(item.mainImage ?? "");
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder ?? 0));
  useEffect(() => {
    setName(item.name);
    setPrice(String(item.price ?? 0));
    setDescription(item.description ?? "");
    setMainImage(item.mainImage ?? "");
    setSortOrder(String(item.sortOrder ?? 0));
  }, [item.name, item.price, item.description, item.mainImage, item.sortOrder]);

  function rowImageResult(results: ImageEditResult[]) {
    const result = results[0];
    if (!result) return;
    setMainImage(result.dataUrl);
  }

  return (
    <div className="rounded-lg border border-border/30 bg-background/50 p-3">
      <div className="grid gap-3 sm:grid-cols-[112px_1fr]">
        <div className="space-y-2">
          <div className="aspect-square overflow-hidden rounded-lg border border-border/30 bg-card">
            {mainImage ? <img src={mainImage} alt={name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">بدون صورة</div>}
          </div>
          <ImageUploadEditor
            kind="gallery"
            label="تغيير الصورة"
            currentImage={mainImage || null}
            settings={settings}
            watermarkText={watermarkText}
            onComplete={rowImageResult}
            onRemove={() => setMainImage("")}
          />
        </div>
        <div className="grid gap-2">
          <Field label="الاسم" value={name} onChange={setName} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="السعر" type="number" value={price} onChange={setPrice} />
            <Field label="الترتيب" type="number" value={sortOrder} onChange={setSortOrder} />
          </div>
          <Field label="الوصف" textarea value={description} onChange={setDescription} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onSave({ isActive: !item.isActive })}>{item.isActive ? "تعطيل" : "تفعيل"}</Button>
            <Button type="button" size="sm" onClick={() => onSave({ name, price: numberOrZero(price), description, mainImage, sortOrder: Number(sortOrder) || 0 })}>حفظ</Button>
            <Button type="button" size="sm" variant="outline" onClick={onDelete} className="text-status-danger hover:text-status-danger">حذف</Button>
          </div>
        </div>
      </div>
      <LinkedStoreProductsPanel sectionType={endpoint} sectionId={item.id} />
    </div>
  );
}

function KoshaOptionsManager({
  title,
  description,
  endpoint,
}: {
  title: string;
  description: string;
  endpoint: "kosha-accessories" | "kosha-provinces" | "kosha-categories";
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", endpoint],
    queryFn: () => adminFetch<KoshaOption[]>(`/admin/${endpoint}`),
  });
  const create = useMutation({
    mutationFn: () => adminFetch(`/admin/${endpoint}`, { method: "POST", body: JSON.stringify({ name, sortOrder: data.length * 10 + 10 }) }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["admin", endpoint] });
      toast({ title: "تمت الإضافة" });
    },
    onError: (err: any) => toast({ title: "تعذر الإضافة", description: err?.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<KoshaOption> }) => adminFetch(`/admin/${endpoint}/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", endpoint] });
      toast({ title: "تم الحفظ" });
    },
    onError: (err: any) => toast({ title: "تعذر الحفظ", description: err?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/${endpoint}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", endpoint] });
      toast({ title: "تم الحذف" });
    },
    onError: (err: any) => toast({ title: "تعذر الحذف", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <div className="mb-3">
        <h2 className="font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mb-3 flex gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم جديد" className="min-w-0 flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
        <Button type="button" size="sm" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>إضافة</Button>
      </div>
      {isLoading ? <Skeleton className="h-28 rounded-lg" /> : (
        <div className="space-y-2">
          {data.map((item) => <KoshaOptionRow key={item.id} item={item} onSave={(values) => update.mutate({ id: item.id, values })} onDelete={() => confirm("حذف العنصر؟") && remove.mutate(item.id)} />)}
          {data.length === 0 && <p className="rounded-lg border border-border/30 bg-background/60 p-3 text-center text-sm text-muted-foreground">لا توجد عناصر بعد.</p>}
        </div>
      )}
    </div>
  );
}

function KoshaOptionRow({ item, onSave, onDelete }: { item: KoshaOption; onSave: (values: Partial<KoshaOption>) => void; onDelete: () => void }) {
  const [name, setName] = useState(item.name);
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder ?? 0));
  useEffect(() => {
    setName(item.name);
    setSortOrder(String(item.sortOrder ?? 0));
  }, [item.name, item.sortOrder]);
  return (
    <div className="grid gap-2 rounded-lg border border-border/30 bg-background/50 p-2 sm:grid-cols-[1fr_86px_auto_auto_auto]">
      <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1.5 text-sm" />
      <input value={sortOrder} type="number" onChange={(event) => setSortOrder(event.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1.5 text-sm" />
      <Button type="button" size="sm" variant="outline" onClick={() => onSave({ isActive: !item.isActive })}>{item.isActive ? "تعطيل" : "تفعيل"}</Button>
      <Button type="button" size="sm" onClick={() => onSave({ name, sortOrder: Number(sortOrder) || 0 })}>حفظ</Button>
      <Button type="button" size="sm" variant="outline" onClick={onDelete} className="text-status-danger hover:text-status-danger">حذف</Button>
    </div>
  );
}

type LinkedProduct = { productId: number; variantId: number | null; name: string; imageUrl: string | null; barcode: string | null; variantLabel: string | null; quantity: number };

/**
 * 🛒 Store products permanently linked to a Kosha section (accessory/addon/board).
 * Reuses the store product catalogue + variants; persisted in settings (no new table).
 * When a booking selects this section, these products are surfaced automatically.
 */
function LinkedStoreProductsPanel({ sectionType, sectionId }: { sectionType: string; sectionId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [variantOptions, setVariantOptions] = useState<any[] | null>(null);
  const [variantId, setVariantId] = useState("");
  const key = ["admin", "kosha-section-products", sectionType, sectionId] as const;

  const { data } = useQuery<{ items: LinkedProduct[] }>({
    queryKey: key,
    queryFn: () => adminFetch(`/admin/kosha-section-products?type=${sectionType}&id=${sectionId}`),
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["admin", "reservation-products-picker"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 2 * 60 * 1000,
    enabled: adding,
  });
  const items = data?.items ?? [];
  const productImg = (p: any): string | null => (Array.isArray(p?.images) ? p.images[0] : null) ?? p?.mainImage ?? null;

  const save = useMutation({
    mutationFn: (next: LinkedProduct[]) => adminFetch("/admin/kosha-section-products", { method: "PUT", body: JSON.stringify({ type: sectionType, id: sectionId, items: next.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })) }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(e), variant: "destructive" }),
  });

  function addProduct(p: any, vId: number | null, vLabel: string | null) {
    if (items.some((i) => i.productId === p.id && i.variantId === vId)) { toast({ title: "المنتج مضاف مسبقاً" }); return; }
    save.mutate([...items, { productId: p.id, variantId: vId, name: p.nameAr || p.name, imageUrl: productImg(p), barcode: p.barcode ?? null, variantLabel: vLabel, quantity: 1 }]);
  }
  async function choose(p: any) {
    setPicked({ id: p.id, name: p.nameAr || p.name }); setVariantId(""); setSearch("");
    try { const stock = await adminFetch<any>(`/products/${p.id}/stock`); setVariantOptions(stock.hasVariants ? stock.variants : []); }
    catch { setVariantOptions([]); }
  }
  function confirmPicked() {
    const src = products.find((x) => x.id === picked?.id);
    if (!src) return;
    const vId = variantId ? Number(variantId) : null;
    const v = variantOptions?.find((x) => x.id === vId);
    addProduct(src, vId, v ? [v.color, v.size].filter(Boolean).join(" / ") || null : null);
    setPicked(null); setVariantOptions(null); setVariantId("");
  }
  function onScan(code: string) {
    const c = code.trim().toLowerCase();
    const p = products.find((x) => String(x.barcode ?? "").toLowerCase() === c);
    if (!p) { toast({ title: "لم يُعثر على منتج بهذا الباركود", variant: "destructive" }); return; }
    addProduct(p, null, null);
    toast({ title: `تمت إضافة ${p.nameAr || p.name}` });
  }

  const results = search.trim().length >= 2
    ? products.filter((p) => [p.nameAr, p.name, p.barcode].some((v) => String(v ?? "").toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 10)
    : [];
  const variantsNeedPick = variantOptions && variantOptions.length > 0;

  return (
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">🛒 المنتجات المرتبطة من المتجر {items.length ? `(${items.length})` : ""}</span>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setAdding((a) => !a)}><Plus className="h-3.5 w-3.5" /> إضافة من المتجر</Button>
      </div>

      {items.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border/30 bg-background/60 p-2">
              {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" /> : <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{it.name}</div>
                {it.variantLabel ? <div className="text-[11px] text-primary">{it.variantLabel}</div> : null}
              </div>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">كمية
                <input type="number" min={1} defaultValue={it.quantity} onBlur={(e) => { const q = Math.max(1, Number(e.target.value) || 1); if (q !== it.quantity) save.mutate(items.map((x, xi) => (xi === i ? { ...x, quantity: q } : x))); }} className="w-14 rounded border border-border/40 bg-background px-1 py-0.5 text-center text-xs" />
              </label>
              <button type="button" onClick={() => save.mutate(items.filter((_, xi) => xi !== i))} className="grid h-7 w-7 flex-shrink-0 place-items-center rounded border border-destructive/30 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">لا توجد منتجات مرتبطة بهذا القسم بعد.</p>}

      {adding && (
        <div className="mt-3 space-y-2 border-t border-border/20 pt-3">
          {picked ? (
            <div className="rounded-lg border border-primary/20 bg-background/60 p-2 space-y-2">
              <div className="flex items-center justify-between"><span className="text-sm text-foreground">{picked.name}</span><button type="button" onClick={() => { setPicked(null); setVariantOptions(null); }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
              {variantsNeedPick && (
                <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-xs">
                  <option value="">— اختر المتغيّر (لون / مقاس) —</option>
                  {variantOptions!.map((v) => <option key={v.id} value={v.id}>{[v.color, v.size].filter(Boolean).join(" / ")} (متاح {v.available})</option>)}
                </select>
              )}
              <Button size="sm" className="w-full" disabled={save.isPending || (Boolean(variantsNeedPick) && !variantId)} onClick={confirmPicked}>ربط المنتج</Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الباركود أو SKU..." className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
                <button type="button" onClick={() => setScanning((s) => !s)} className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border ${scanning ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground"}`} title="مسح باركود"><ScanLine className="h-4 w-4" /></button>
              </div>
              {scanning ? <div className="overflow-hidden rounded-lg border border-border/30"><LiveScanner active={scanning} onDetect={onScan} /></div> : null}
              {results.length ? (
                <div className="divide-y divide-border/20 rounded-lg border border-border/30">
                  {results.map((p) => (
                    <button key={p.id} type="button" onClick={() => choose(p)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-background/60">
                      {productImg(p) ? <img src={productImg(p)!} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></span>}
                      <span className="min-w-0 flex-1 truncate text-right">{p.nameAr || p.name}</span>
                      <Plus className="h-4 w-4 text-primary" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KoshaForm({ mode }: { mode: "new" | "edit" }) {
  const params = useParams<{ id?: string }>();
  const id = Number(params.id ?? 0);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: publicSettings } = usePublicSettings();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "koshas", id],
    queryFn: () => adminFetch<Kosha>(`/admin/koshas/${id}`),
    enabled: mode === "edit" && id > 0,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["admin", "kosha-categories"],
    queryFn: () => adminFetch<KoshaCategory[]>("/admin/kosha-categories"),
  });
  const [form, setForm] = useState<KoshaFormState>(EMPTY_KOSHA);

  useEffect(() => {
    if (mode === "new") setForm(EMPTY_KOSHA);
    else if (data) setForm(normalizeForm(data));
  }, [data, mode]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = cleanKoshaPayload(form);
      if (!payload.name) throw new Error("اسم الكوشة مطلوب");
      return mode === "edit"
        ? adminFetch<Kosha>(`/admin/koshas/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : adminFetch<Kosha>("/admin/koshas", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "koshas"] });
      toast({ title: mode === "edit" ? "تم حفظ الكوشة" : "تمت إضافة الكوشة" });
      setLocation("/admin/koshas");
    },
    onError: (err: any) => toast({ title: "تعذر حفظ الكوشة", description: err?.message, variant: "destructive" }),
  });

  function mainImageResult(results: ImageEditResult[]) {
    const result = results[0];
    if (!result) return;
    setForm((current) => ({ ...current, mainImage: result.dataUrl }));
  }

  function galleryResult(results: ImageEditResult[]) {
    setForm((current) => ({
      ...current,
      galleryImages: [
        ...current.galleryImages,
        ...results.map((result, index) => ({
          id: Date.now() + index,
          imageUrl: result.dataUrl,
          imageMetadata: result.metadata,
          sortOrder: current.galleryImages.length + index,
        })),
      ],
    }));
  }

  function moveImage(index: number, direction: -1 | 1) {
    setForm((current) => {
      const next = [...current.galleryImages];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, galleryImages: next };
    });
  }

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;

  return (
    <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{mode === "edit" ? "تعديل كوشة" : "إضافة كوشة"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">هذا القسم منفصل عن منتجات المتجر.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/koshas"><Button type="button" variant="outline">إلغاء</Button></Link>
          <Button type="submit" disabled={save.isPending} className="gap-2"><Save className="h-4 w-4" /> {save.isPending ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <div className="space-y-4 rounded-xl border border-border/30 bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="اسم الكوشة" value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
            <Field label="السعر" type="number" value={form.price} onChange={(value) => setForm((f) => ({ ...f, price: Number(value) || 0 }))} />
            <Field label="Slug" value={form.slug} onChange={(value) => setForm((f) => ({ ...f, slug: value }))} />
            <Field label="السعر القديم" type="number" value={form.oldPrice} onChange={(value) => setForm((f) => ({ ...f, oldPrice: value ? Number(value) : null }))} />
            <Field label="نسبة الخصم" type="number" value={form.discountPercentage} onChange={(value) => setForm((f) => ({ ...f, discountPercentage: Number(value) || 0 }))} />
            <Field label="عدد القطع" type="number" value={form.numberOfPieces} onChange={(value) => setForm((f) => ({ ...f, numberOfPieces: value ? Number(value) : null }))} />
            <Field label="اللون الرئيسي" value={form.mainColor} onChange={(value) => setForm((f) => ({ ...f, mainColor: value }))} />
            <Field label="لون الورد" value={form.flowerColor} onChange={(value) => setForm((f) => ({ ...f, flowerColor: value }))} />
            <Field label="مساحة الكوشة" value={form.koshaSpace} onChange={(value) => setForm((f) => ({ ...f, koshaSpace: value }))} />
            <Field label="مساحة السايد كونسول" value={form.sideConsoleSpace} onChange={(value) => setForm((f) => ({ ...f, sideConsoleSpace: value }))} />
          </div>
          <Field label="الوصف" textarea value={form.description} onChange={(value) => setForm((f) => ({ ...f, description: value }))} />
          <Field label="الملحقات المشمولة (كل ملحق بسطر)" textarea value={(form.accessories ?? []).join("\n")} onChange={(value) => setForm((f) => ({ ...f, accessories: value.split(/\n|،|,/).map((item) => item.trim()).filter(Boolean) }))} />
          <Field label="ملاحظات" textarea value={form.notes} onChange={(value) => setForm((f) => ({ ...f, notes: value }))} />
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">القسم</label>
              <select value={form.categoryId ?? ""} onChange={(event) => setForm((f) => ({ ...f, categoryId: event.target.value ? Number(event.target.value) : null }))} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
                <option value="">بدون قسم</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">حالة التوفر</label>
              <select value={form.availabilityStatus} onChange={(event) => setForm((f) => ({ ...f, availabilityStatus: event.target.value }))} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
                <option value="available">متاحة</option>
                <option value="booked">محجوزة</option>
                <option value="maintenance">صيانة</option>
                <option value="hidden">مخفية</option>
              </select>
            </div>
            <Field label="ترتيب العرض" type="number" value={form.sortOrder} onChange={(value) => setForm((f) => ({ ...f, sortOrder: Number(value) || 0 }))} />
            <div className="flex items-end gap-4 pb-2">
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((f) => ({ ...f, isActive: event.target.checked }))} className="accent-primary" /> ظاهرة</label>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isFeatured} onChange={(event) => setForm((f) => ({ ...f, isFeatured: event.target.checked }))} className="accent-primary" /> مميزة</label>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border/30 bg-card p-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">الصورة الرئيسية</label>
            <ImageUploadEditor
              kind="service"
              label="رفع الصورة الرئيسية"
              currentImage={form.mainImage || null}
              settings={publicSettings?.image_settings}
              watermarkText={publicSettings?.site_name}
              onComplete={mainImageResult}
              onRemove={() => setForm((f) => ({ ...f, mainImage: "" }))}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">معرض الصور</label>
            <ImageUploadEditor
              kind="gallery"
              label="رفع صور متعددة"
              multiple
              settings={publicSettings?.image_settings}
              watermarkText={publicSettings?.site_name}
              onComplete={galleryResult}
            />
            {form.galleryImages.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {form.galleryImages.map((image, index) => (
                  <div key={`${image.id}-${index}`} className="overflow-hidden rounded-lg border border-border/30 bg-background">
                    <img src={image.imageUrl} alt="" className="h-28 w-full object-cover" />
                    <div className="flex items-center justify-between gap-1 p-2">
                      <button type="button" onClick={() => moveImage(index, -1)} className="rounded border border-border/40 p-1 text-muted-foreground hover:text-primary"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => moveImage(index, 1)} className="rounded border border-border/40 p-1 text-muted-foreground hover:text-primary"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, galleryImages: f.galleryImages.filter((_, i) => i !== index) }))} className="rounded border border-status-danger/30 p-1 text-status-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function useKoshaListCount(endpoint: string) {
  const { data } = useQuery({ queryKey: ["admin", endpoint], queryFn: () => adminFetch<unknown[]>(`/admin/${endpoint}`) });
  return Array.isArray(data) ? data.length : 0;
}

function KoshaBackBar({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/admin/koshas"><Button type="button" size="sm" variant="outline" className="gap-1"><ArrowRight className="h-4 w-4" /> رجوع</Button></Link>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function KoshaHubCard({ title, description, count, icon: Icon, href }: { title: string; description: string; count: number; icon: typeof Plus; href: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-border/30 bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
        <span className="text-2xl font-bold text-foreground">{count}</span>
      </div>
      <h3 className="mt-4 font-bold text-foreground">{title}</h3>
      <p className="mt-1 flex-1 text-xs leading-5 text-muted-foreground">{description}</p>
      <Link href={href} className="mt-4 block"><Button type="button" size="sm" variant="outline" className="w-full justify-center gap-2">إدارة <ArrowLeft className="h-4 w-4" /></Button></Link>
    </div>
  );
}

function KoshaHub() {
  const koshas = useKoshaListCount("koshas");
  const categories = useKoshaListCount("kosha-categories");
  const addons = useKoshaListCount("kosha-addons");
  const boards = useKoshaListCount("kosha-welcome-boards");
  const accessories = useKoshaListCount("kosha-accessories");
  const packages = useKoshaListCount("kosha-packages");
  const provinces = useKoshaListCount("kosha-provinces");
  const cards = [
    { title: "الكوشات", description: "إضافة وتعديل وحذف الكوشات الرئيسية.", count: koshas, icon: LayoutGrid, href: "/admin/koshas/items" },
    { title: "أقسام الكوشات", description: "أقسام المناسبات (حنة، خطوبة، عرس…) لفلترة العميل.", count: categories, icon: Layers, href: "/admin/koshas/categories" },
    { title: "الخدمات الإضافية", description: "خدمات اختيارية تُضاف للحجز مع الصورة والسعر.", count: addons, icon: Sparkles, href: "/admin/koshas/addons" },
    { title: "بورد الترحيب", description: "بوردات الترحيب، يختار الزبون واحداً منها.", count: boards, icon: ImageIcon, href: "/admin/koshas/welcome-boards" },
    { title: "الإكسسوارات", description: "إكسسوارات إضافية باختيار متعدد.", count: accessories, icon: Gift, href: "/admin/koshas/accessories" },
    { title: "إدارة الباقات", description: "الباقات الجاهزة، مكوّناتها وأسعارها.", count: packages, icon: Package, href: "/admin/kosha-packages" },
    { title: "محافظات الكوشات", description: "محافظات تظهر في نموذج بيانات الحجز.", count: provinces, icon: MapPin, href: "/admin/koshas/provinces" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة الكوشات</h1>
          <p className="mt-1 text-sm text-muted-foreground">اختر القسم الذي تريد إدارته — كل قسم في صفحة مستقلة.</p>
        </div>
        <Link href="/admin/koshas/new"><Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> إضافة كوشة</Button></Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => <KoshaHubCard key={card.title} {...card} />)}
      </div>
    </div>
  );
}

function KoshaItemsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data = [], isLoading } = useQuery({ queryKey: ["admin", "koshas"], queryFn: () => adminFetch<Kosha[]>("/admin/koshas") });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/koshas/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "koshas"] }); toast({ title: "تم حذف الكوشة" }); },
    onError: (err: any) => toast({ title: "تعذر حذف الكوشة", description: err?.message, variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: (kosha: Kosha) => adminFetch(`/admin/koshas/${kosha.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !kosha.isActive }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "koshas"] }),
  });
  return (
    <div className="space-y-4">
      <KoshaBackBar title="الكوشات" subtitle="إضافة وتعديل وحذف الكوشات الرئيسية." action={<Link href="/admin/koshas/new"><Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> إضافة كوشة</Button></Link>} />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-72 rounded-xl" />)}</div>
      ) : data.length === 0 ? <EmptyState /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((kosha) => (
            <div key={kosha.id} className="overflow-hidden rounded-xl border border-border/30 bg-card">
              <img src={kosha.mainImage || kosha.galleryImages?.[0]?.imageUrl || "/images/kosha.png"} alt={kosha.name} className="h-40 w-full object-cover" />
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-foreground">{kosha.name}</h3>
                    <p className="text-xs text-muted-foreground">{formatCurrency(kosha.price)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${kosha.isActive ? "bg-status-success/10 text-status-success" : "bg-muted text-muted-foreground"}`}>
                    {kosha.isActive ? "ظاهرة" : "مخفية"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link href={`/admin/koshas/${kosha.id}/edit`} className="flex-1">
                    <Button size="sm" variant="outline" className="w-full gap-1"><Edit2 className="h-3.5 w-3.5" /> تعديل</Button>
                  </Link>
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate(kosha)} className="gap-1">
                    {kosha.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => confirm("حذف الكوشة؟") && del.mutate(kosha.id)} className="gap-1 text-status-danger hover:text-status-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KoshaLookupPage({ title, subtitle, managerTitle, managerDescription, endpoint }: { title: string; subtitle: string; managerTitle: string; managerDescription: string; endpoint: "kosha-categories" | "kosha-provinces" }) {
  return (
    <div className="space-y-4">
      <KoshaBackBar title={title} subtitle={subtitle} />
      <div className="max-w-2xl">
        <KoshaOptionsManager title={managerTitle} description={managerDescription} endpoint={endpoint} />
      </div>
    </div>
  );
}

function KoshaCatalogPage({ title, subtitle, managerTitle, managerDescription, endpoint }: { title: string; subtitle: string; managerTitle: string; managerDescription: string; endpoint: KoshaCatalogEndpoint }) {
  return (
    <div className="space-y-4">
      <KoshaBackBar title={title} subtitle={subtitle} />
      <KoshaCatalogOptionsManager title={managerTitle} description={managerDescription} endpoint={endpoint} />
    </div>
  );
}

export default function AdminKoshasPage() {
  const [location] = useLocation();
  const normalizedLocation = location.replace(/\/+$/, "");
  if (normalizedLocation === "/admin/koshas/new") return <KoshaForm mode="new" />;
  if (/\/admin\/koshas\/\d+\/edit$/.test(normalizedLocation)) return <KoshaForm mode="edit" />;
  const sub = normalizedLocation.replace(/^\/admin\/koshas\/?/, "");
  if (sub === "items") return <KoshaItemsPage />;
  if (sub === "categories") return <KoshaLookupPage title="أقسام الكوشات" subtitle="أقسام المناسبات لفلترة العميل — أضف أي قسم جديد بلا كود." managerTitle="الأقسام" managerDescription="حنة، خطوبة، عرس، عيد ميلاد، تخرج… تُربط بكل كوشة من نموذج الكوشة." endpoint="kosha-categories" />;
  if (sub === "provinces") return <KoshaLookupPage title="محافظات الكوشات" subtitle="تظهر في نموذج بيانات الحجز داخل صفحة الكوشات." managerTitle="المحافظات" managerDescription="أضف المحافظات التي تخدمها." endpoint="kosha-provinces" />;
  if (sub === "addons") return <KoshaCatalogPage title="الخدمات الإضافية" subtitle="تظهر في خطوة الخدمات الإضافية مع الصورة والسعر." managerTitle="الخدمات الإضافية" managerDescription="خدمات اختيارية يضيفها الزبون لحجزه." endpoint="kosha-addons" />;
  if (sub === "welcome-boards") return <KoshaCatalogPage title="بورد الترحيب" subtitle="تظهر في خطوة بورد الترحيب، ويختار الزبون واحداً." managerTitle="بورد الترحيب" managerDescription="بوردات الترحيب المتاحة للزبون." endpoint="kosha-welcome-boards" />;
  if (sub === "accessories") return <KoshaCatalogPage title="الإكسسوارات" subtitle="تظهر كمنتجات مستقلة باختيار متعدد." managerTitle="الإكسسوارات" managerDescription="إكسسوارات إضافية للحجز." endpoint="kosha-accessories" />;
  return <KoshaHub />;
}

export function AdminKoshaBookingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<KoshaBooking | null>(null);
  const [detailing, setDetailing] = useState<KoshaBooking | null>(null);
  const [sortRemaining, setSortRemaining] = useState<null | "asc" | "desc">(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "kosha-bookings", status],
    queryFn: () => adminFetch<KoshaBooking[]>(`/admin/kosha-bookings?search=&status=${encodeURIComponent(status)}`),
    refetchInterval: 15_000, // live update after collections are approved, no manual refresh
  });

  // Search (incl. the Remaining amount) + optional sort by Remaining — done client-side
  // so the new numeric column is fully searchable/sortable without changing the API.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data;
    if (q) {
      list = data.filter((item) => {
        const remaining = koshaRemaining(item);
        return [
          item.customerName, item.phone, item.brideName, item.groomName, item.koshaName, item.packageName,
          item.province, item.area, item.cityArea, item.primaryEmployeeName, item.assistantEmployeeName,
          String(item.totalAmount ?? ""), String(item.paidAmount ?? ""), String(remaining),
        ].filter(Boolean).join(" ").toLowerCase().includes(q);
      });
    }
    if (sortRemaining) {
      list = [...list].sort((a, b) =>
        sortRemaining === "asc" ? koshaRemaining(a) - koshaRemaining(b) : koshaRemaining(b) - koshaRemaining(a),
      );
    }
    return list;
  }, [data, search, sortRemaining]);
  const update = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<KoshaBooking> }) => adminFetch(`/admin/kosha-bookings/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] }); toast({ title: "تم تحديث الحجز" }); },
    onError: (err: any) => toast({ title: "تعذر تحديث الحجز", description: err?.message, variant: "destructive" }),
  });

  const csv = useMemo(() => {
    const header = ["الرقم", "الباقة", "الكوشة", "الزبون", "الهاتف", "العروس", "العريس", "التاريخ", "الوقت", "المحافظة", "المنطقة", "الموظف الأساسي", "الموظف المساعد", "الاكسسوارات", "الإجمالي", "المدفوع", "المتبقي", "الحالة"];
    const csvRows = rows.map((item) => [item.id, item.packageName ?? "", item.koshaName ?? "", item.customerName, item.phone, item.brideName, item.groomName, item.eventDate, item.eventTime, item.province, item.area || item.cityArea, item.primaryEmployeeName ?? "", item.assistantEmployeeName ?? "", item.selectedAccessories?.join("، ") ?? "", koshaBookingAmountLabel(item), Number(item.paidAmount ?? 0), koshaRemaining(item), STATUS_LABELS[item.status] ?? item.status]);
    return [header, ...csvRows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }, [rows]);

  function exportCsv() {
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kosha-bookings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function printBooking(item: KoshaBooking, format: "a4" | "thermal") {
    if (isKoshaPendingPricing(item)) {
      toast({ title: "الحجز بانتظار التسعير", description: "أدخل السعر أولاً قبل طباعة الفاتورة النهائية.", variant: "destructive" });
      return;
    }
    if (format === "a4") {
      const preview = window.open(`/admin/invoice/${item.id}?type=kosha&print=1`, "_blank", "width=1080,height=1160");
      if (!preview) toast({ title: "تعذر فتح معاينة الطباعة", description: "يرجى السماح بالنوافذ المنبثقة لطباعة فاتورة الكوشة.", variant: "destructive" });
      return;
    }
    // Open synchronously (avoids popup blocking) then fill once the QR is fetched.
    const win = window.open("", "_blank", "width=420,height=720");
    if (!win) return;
    win.document.write('<!doctype html><meta charset="utf-8"><div dir="rtl" style="font-family:sans-serif;padding:24px">جاري تحضير الفاتورة…</div>');
    let full: KoshaBooking & { qr?: { dataUrl?: string } } = item;
    let qrDataUrl = "";
    try {
      const res = await adminFetch<KoshaBooking & { qr?: { dataUrl?: string } }>(`/admin/kosha-bookings/${item.id}`);
      full = res;
      qrDataUrl = res.qr?.dataUrl ?? "";
    } catch { /* fall back to row data without QR */ }
    const details = (full.bookingDetails ?? {}) as Record<string, any>;
    const total = Number(full.totalAmount ?? koshaBookingTotal(details) ?? 0);
    const paid = Number(full.paidAmount ?? 0);
    const remaining = Number(full.remainingAmount ?? Math.max(0, total - paid));
    const pricing = (details.pricing ?? {}) as Record<string, any>;
    const pricedLines = [
      { name: "سعر الكوشة", price: Number(pricing.koshaPrice ?? 0) },
      { name: "سعر بورد الترحيب", price: Number(pricing.welcomeBoardPrice ?? 0) },
      { name: "سعر الإكسسوارات", price: Number(pricing.accessoriesPrice ?? 0) },
      { name: "سعر الخدمات الإضافية", price: Number(pricing.addonsPrice ?? 0) },
      { name: "الخصم", price: -Number(pricing.discountAmount ?? 0) },
    ].filter((row) => Number(row.price) !== 0);
    const lineItems = pricedLines.length ? pricedLines : [{ name: "إجمالي الحجز حسب الاتفاق", price: total }];
    const trackingCode = full.trackingCode ?? `KB-${full.id}`;
    const dateLine = [full.eventDate, full.eventTime].filter(Boolean).join(" ") || "—";
    const qrCaption = "امسح الكود لمتابعة حالة الكوشة";

    let html = "";
    if (format === "thermal") {
      const rows = lineItems.map((it) => `<tr><td class="name">${it.name}</td><td class="num">${formatMoney(it.price)}</td></tr>`).join("");
      const qrBlock = qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" alt="QR"><div class="cap">${qrCaption}</div></div>` : "";
      html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${trackingCode}</title>
        <style>${thermalReceiptCss("80mm")}</style></head><body>
        <div class="receipt">
          <div class="r-head"><div class="r-company">مجموعة علي جان نهاد</div><div class="r-sub">فاتورة حجز كوشة</div><div class="r-sub num">${trackingCode} · ${dateLine}</div></div>
          <hr class="rule">
          <div class="kv"><span>الزبون</span><span class="v">${full.customerName}</span></div>
          <div class="kv"><span>الهاتف</span><span class="v num">${full.phone || "—"}</span></div>
          <hr class="rule dashed">
          <table class="items"><thead><tr><th class="name">البند</th><th>السعر</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="totals">
            <div class="grand"><span>الإجمالي</span><span class="num">${formatCurrency(total)}</span></div>
            <div class="payline"><span>الواصل</span><span class="num">${formatCurrency(paid)}</span></div>
            <div class="payline remain"><span>المتبقي</span><span class="num">${formatCurrency(remaining)}</span></div>
          </div>
          ${qrBlock}
          <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
        </div>
        ${printWhenImagesReadyScript()}
      </body></html>`;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">حجوزات الكوشات</h1>
          <p className="mt-1 text-sm text-muted-foreground">طلبات الحجز القادمة من صفحة الكوشات.</p>
        </div>
        <Button onClick={exportCsv} variant="outline" className="gap-2"><FileDown className="h-4 w-4" /> CSV</Button>
      </div>
      <div className="grid gap-3 rounded-xl border border-border/30 bg-card p-4 md:grid-cols-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الهاتف أو المنطقة" className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {isLoading ? <Skeleton className="h-80 rounded-xl" /> : rows.length === 0 ? <EmptyState /> : (
        <div className="overflow-hidden rounded-xl border border-border/30 bg-card">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-right">الكوشة</th>
                  <th className="px-4 py-3 text-right">الزبون</th>
                  <th className="px-4 py-3 text-right">الهاتف</th>
                  <th className="px-4 py-3 text-right">الموعد</th>
                  <th className="px-4 py-3 text-right">الإجمالي</th>
                  <th className="px-4 py-3 text-right">التفاصيل</th>
                  <th className="px-4 py-3 text-right">المدفوع</th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSortRemaining((s) => (s === "desc" ? "asc" : s === "asc" ? null : "desc"))}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      title="ترتيب حسب المتبقي"
                    >
                      💰 المتبقي {sortRemaining === "desc" ? "▼" : sortRemaining === "asc" ? "▲" : ""}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">حالة الدفع</th>
                  <th className="px-4 py-3 text-right">آخر دفعة</th>
                  <th className="px-4 py-3 text-right">الحالة</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-t border-border/30">
                    <td className="px-4 py-3"><div>{item.koshaName ?? "-"}</div>{item.packageName ? <div className="mt-1 text-xs font-semibold text-primary">{item.packageName}</div> : null}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{item.customerName}</div>
                      {(item.brideName || item.groomName) && <div className="text-xs text-muted-foreground">{[item.brideName, item.groomName].filter(Boolean).join(" و ")}</div>}
                      {(item.primaryEmployeeName || item.assistantEmployeeName) && (
                        <div className="mt-0.5 text-xs text-primary">فريق: {[item.primaryEmployeeName, item.assistantEmployeeName].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td className="px-4 py-3" dir="ltr">{item.phone}</td>
                    <td className="px-4 py-3">{item.eventDate || "-"} {item.eventTime || ""}</td>
                    <td className={`px-4 py-3 font-bold ${isKoshaPendingPricing(item) ? "text-status-warning" : "text-primary"}`}>{koshaBookingAmountLabel(item)}</td>
                    <td className="px-4 py-3">
                      <div className="max-w-64 text-xs leading-6 text-muted-foreground">
                        {[item.eventType, item.serviceLevel, item.venueType, item.themeColor].filter(Boolean).join(" · ") || "-"}
                        <br />
                        {[item.province, item.area || item.cityArea, item.nearestPoint].filter(Boolean).join(" - ")}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">{isKoshaPendingPricing(item) ? "—" : formatCurrency(item.paidAmount ?? 0)}</td>
                    <td className="px-4 py-3">
                      {isKoshaPendingPricing(item) ? (
                        <span className="text-status-warning">—</span>
                      ) : (
                        (() => {
                          const remaining = koshaRemaining(item);
                          return <span className={`font-bold ${koshaRemainingTone(remaining, Number(item.totalAmount ?? 0))}`}>{formatCurrency(remaining)}</span>;
                        })()
                      )}
                    </td>
                    <td className="px-4 py-3"><span className={item.paymentStatus === "paid" ? "text-status-success" : item.paymentStatus === "partial" ? "text-status-warning" : "text-muted-foreground"}>{item.paymentStatus ?? "unpaid"}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.latestPaymentDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <select value={item.status} onChange={(event) => update.mutate({ id: item.id, values: { status: event.target.value } })} className="rounded-lg border border-border/40 bg-background px-2 py-1 text-xs">
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDetailing(item)} className="gap-1"><Eye className="h-3.5 w-3.5" /> عرض التفاصيل</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(item)} className="gap-1"><Edit2 className="h-3.5 w-3.5" /> تعديل</Button>
                        <Button size="sm" variant="outline" onClick={() => printBooking(item, "a4")} className="gap-1"><Printer className="h-3.5 w-3.5" /> A4</Button>
                        <Button size="sm" variant="outline" onClick={() => printBooking(item, "thermal")} className="gap-1"><Printer className="h-3.5 w-3.5" /> حراري</Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const note = window.prompt("ملاحظات داخلية", item.internalNotes ?? "");
                            if (note !== null) update.mutate({ id: item.id, values: { internalNotes: note } });
                          }}
                        >
                          ملاحظات
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && (
        <EditKoshaBookingModal
          booking={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] });
          }}
        />
      )}
      {detailing && <KoshaBookingDetailsModal booking={detailing} onClose={() => setDetailing(null)} />}
    </div>
  );
}

function resolveKoshaOptions(names: string[], catalog: KoshaOption[]) {
  return (names ?? []).map((name) => {
    const match = catalog.find((item) => item.name === name);
    return { name, mainImage: match?.mainImage ?? null, price: match?.price ?? null };
  });
}

function KoshaDetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mt-4 border-t border-border/20 pt-4 first:mt-0 first:border-0 first:pt-0"><h3 className="mb-2 text-sm font-semibold text-primary">{title}</h3>{children}</div>;
}

function KoshaDetailGrid({ items }: { items: Array<[string, string | null | undefined]> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map(([label, value], index) => (
        <div key={index} className="rounded-lg border border-border/30 bg-background/50 p-2.5">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-sm text-foreground">{value && String(value).trim() ? value : "—"}</div>
        </div>
      ))}
    </div>
  );
}

function KoshaOptionTile({ name, mainImage, price, onZoom }: { name: string; mainImage?: string | null; price?: number | null; onZoom: (src: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-background/50 p-2">
      {mainImage ? (
        <button type="button" onClick={() => onZoom(mainImage)} className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border border-border/30"><img src={mainImage} alt={name} loading="lazy" decoding="async" className="h-full w-full object-cover" /></button>
      ) : (
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="h-5 w-5" /></span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{name}</div>
        {price != null ? <div className="text-xs text-primary">{formatCurrency(price)}</div> : null}
      </div>
    </div>
  );
}

function KoshaNoExtras() {
  return <p className="rounded-lg border border-dashed border-border/40 bg-background/40 p-3 text-center text-sm text-muted-foreground">لا توجد إضافات مختارة</p>;
}

/** Financial projection and links for a Kosha booking. */
function KoshaFinancialSummary({ booking, finance }: { booking: KoshaBooking; finance?: KoshaBookingFinance | null }) {
  const details = (booking.bookingDetails ?? {}) as Record<string, any>;
  const projected = (finance ?? booking.finance ?? details.financialSummary ?? {}) as KoshaBookingFinance;
  const total = Number(projected.totalAmount ?? booking.totalAmount ?? 0);
  const paid = Number(projected.paidAmount ?? booking.paidAmount ?? 0);
  const approved = Number(projected.approvedCollectedAmount ?? booking.approvedCollectedAmount ?? 0);
  const pending = Number(projected.pendingCollectionAmount ?? booking.pendingCollectionAmount ?? 0);
  const refunded = Number(projected.refundedAmount ?? booking.refundedAmount ?? 0);
  const discount = Number(projected.discount ?? details.pricing?.discountAmount ?? booking.discount ?? 0);
  const additional = Number(projected.additionalCharges ?? booking.additionalCharges ?? 0);
  const remaining = Number(projected.remainingAmount ?? booking.remainingAmount ?? Math.max(0, total + additional - discount - paid - approved + refunded));
  const customerId = projected.customerId ?? booking.customerId ?? details.customerId ?? null;
  const payments: KoshaBookingFinanceMovement[] = projected.payments ?? (details.financialPayments as KoshaBookingFinanceMovement[] | undefined) ?? [];
  const collections: KoshaBookingFinanceMovement[] = projected.collections ?? (details.financialCollections as KoshaBookingFinanceMovement[] | undefined) ?? [];
  const movements: KoshaBookingFinanceMovement[] = projected.cashboxMovements ?? (details.cashboxMovements as KoshaBookingFinanceMovement[] | undefined) ?? [];
  const journals: Array<KoshaBookingFinanceMovement & { entryNo?: string | null }> = projected.journalEntries ?? (details.journalEntries as Array<KoshaBookingFinanceMovement & { entryNo?: string | null }> | undefined) ?? [];
  const movementRows = [...payments, ...collections].slice(0, 8);
  const status = projected.paymentStatus ?? booking.paymentStatus ?? "unpaid";

  return (
    <KoshaDetailSection title="الملخص المالي الموحد">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["الإجمالي", total, "text-foreground"], ["المدفوع", paid, "text-status-success"], ["التحصيل المعتمد", approved, "text-status-success"], ["تحصيل قيد الانتظار", pending, "text-status-warning"], ["الاسترجاع", refunded, "text-status-danger"], ["الخصم", discount, "text-muted-foreground"], ["رسوم إضافية", additional, "text-muted-foreground"], ["المتبقي", remaining, remaining > 0 ? "text-status-warning" : "text-status-success"]].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-lg border border-border/25 bg-background/45 p-2.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`mt-1 text-sm font-bold ${tone}`}>{formatCurrency(Number(value))}</div></div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border border-border/30 bg-background/60 px-2.5 py-1 text-muted-foreground">حالة الدفع: <strong className="text-foreground">{status}</strong></span>{projected.latestPaymentDate || booking.latestPaymentDate ? <span className="rounded-full border border-border/30 bg-background/60 px-2.5 py-1 text-muted-foreground">آخر دفعة: <strong className="text-foreground">{projected.latestPaymentDate ?? booking.latestPaymentDate}</strong></span> : null}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Link href={`/admin/finance/master-cash?sourceType=kosha_booking&sourceId=${booking.id}`}><Button size="sm" variant="outline">حركات الصندوق</Button></Link><Link href={`/admin/operations?entityType=kosha_booking&entityId=${booking.id}`}><Button size="sm" variant="outline">القيود والسجل المالي</Button></Link>{customerId ? <Link href={`/admin/customers?focus=${customerId}`}><Button size="sm" variant="outline">كشف حساب العميل</Button></Link> : null}</div>
      {movementRows.length > 0 ? <div className="mt-4 overflow-x-auto rounded-lg border border-border/25"><div className="border-b border-border/25 bg-background/40 px-3 py-2 text-xs font-semibold text-primary">تاريخ الدفعات والتحصيل</div><table className="min-w-full text-xs"><thead className="text-muted-foreground"><tr><th className="px-3 py-2 text-right">التاريخ</th><th className="px-3 py-2 text-right">المبلغ</th><th className="px-3 py-2 text-right">المصدر</th><th className="px-3 py-2 text-right">الحالة</th><th className="px-3 py-2 text-right">الرصيد قبل/بعد</th><th className="px-3 py-2 text-right">سند القبض / المعاملة</th></tr></thead><tbody>{movementRows.map((row, index) => <tr key={String(row.id ?? row.transactionNo ?? index)} className="border-t border-border/15"><td className="px-3 py-2">{row.date ?? "—"}</td><td className="px-3 py-2 font-semibold">{formatCurrency(Number(row.amount ?? 0))}</td><td className="px-3 py-2">{row.source ?? row.method ?? "—"}</td><td className="px-3 py-2">{row.status ?? "—"}</td><td className="px-3 py-2">{row.balanceBefore == null ? "—" : formatCurrency(Number(row.balanceBefore))} / {row.balanceAfter == null ? "—" : formatCurrency(Number(row.balanceAfter))}</td><td className="px-3 py-2 font-mono">{row.receiptVoucherNo ?? row.transactionNo ?? "—"}</td></tr>)}</tbody></table></div> : null}
      {movements.length > 0 ? <div className="mt-3 overflow-x-auto rounded-lg border border-border/25"><div className="border-b border-border/25 bg-background/40 px-3 py-2 text-xs font-semibold text-primary">حركات الصندوق</div><table className="min-w-full text-xs"><tbody>{movements.slice(0, 6).map((row, index) => <tr key={String(row.id ?? row.transactionNo ?? index)} className="border-t border-border/15"><td className="px-3 py-2">{row.date ?? "—"}</td><td className="px-3 py-2 font-semibold">{formatCurrency(Number(row.amount ?? 0))}</td><td className="px-3 py-2">{row.status ?? "—"}</td><td className="px-3 py-2 font-mono">{row.transactionNo ?? "—"}</td></tr>)}</tbody></table></div> : null}
      {journals.length > 0 ? <div className="mt-3 overflow-x-auto rounded-lg border border-border/25"><div className="border-b border-border/25 bg-background/40 px-3 py-2 text-xs font-semibold text-primary">القيود المحاسبية</div><table className="min-w-full text-xs"><tbody>{journals.slice(0, 6).map((row, index) => <tr key={String(row.id ?? row.entryNo ?? index)} className="border-t border-border/15"><td className="px-3 py-2">{row.date ?? "—"}</td><td className="px-3 py-2 font-semibold">{formatCurrency(Number(row.amount ?? 0))}</td><td className="px-3 py-2">{row.status ?? "—"}</td><td className="px-3 py-2 font-mono">{row.entryNo ?? row.transactionNo ?? "—"}</td></tr>)}</tbody></table></div> : null}
    </KoshaDetailSection>
  );
}

function KoshaBookingDetailsModal({ booking, onClose }: { booking: KoshaBooking; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState(booking.trackingStatus ?? "booked");
  const financeQuery = useQuery({
    queryKey: ["admin", "kosha-booking-finance", booking.id],
    queryFn: () => adminFetch<KoshaBookingFinanceResponse>(`/admin/kosha-bookings/${booking.id}/finance`),
    retry: false,
  });
  const updateTracking = useMutation({
    mutationFn: (next: string) => adminFetch(`/admin/kosha-bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({ trackingStatus: next }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] }); toast({ title: "تم تحديث حالة التتبع" }); },
    onError: (err: any) => toast({ title: "تعذر تحديث الحالة", description: err?.message, variant: "destructive" }),
  });
  const koshasQuery = useQuery({ queryKey: ["admin", "koshas"], queryFn: () => adminFetch<Kosha[]>("/admin/koshas") });
  const addonsQuery = useQuery({ queryKey: ["admin", "kosha-addons"], queryFn: () => adminFetch<KoshaOption[]>("/admin/kosha-addons") });
  const boardsQuery = useQuery({ queryKey: ["admin", "kosha-welcome-boards"], queryFn: () => adminFetch<KoshaOption[]>("/admin/kosha-welcome-boards") });
  const accessoriesQuery = useQuery({ queryKey: ["admin", "kosha-accessories"], queryFn: () => adminFetch<KoshaOption[]>("/admin/kosha-accessories") });
  const staffQuery = useQuery({ queryKey: ["admin", "staff"], queryFn: () => adminFetch<{ id: number; fullName?: string; username?: string }[]>("/admin/staff") });
  const [primaryId, setPrimaryId] = useState(String(booking.primaryEmployeeId ?? ""));
  const [assistantId, setAssistantId] = useState(String(booking.assistantEmployeeId ?? ""));
  const saveCrew = useMutation({
    mutationFn: () => adminFetch(`/admin/kosha-bookings/${booking.id}/employees`, { method: "POST", body: JSON.stringify({ primaryEmployeeId: primaryId ? Number(primaryId) : null, assistantEmployeeId: assistantId ? Number(assistantId) : null }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] }); toast({ title: "تم حفظ الطاقم" }); },
    onError: (err: any) => toast({ title: "تعذر حفظ الطاقم", description: err?.message, variant: "destructive" }),
  });

  const kosha = (koshasQuery.data ?? []).find((item) => item.id === booking.koshaId) ?? null;
  const addons = resolveKoshaOptions(booking.selectedAddons, addonsQuery.data ?? []);
  const boards = resolveKoshaOptions(booking.welcomeBoards, boardsQuery.data ?? []);
  const accessories = resolveKoshaOptions(booking.selectedAccessories, accessoriesQuery.data ?? []);
  const galleryImages = [
    kosha?.mainImage ?? null,
    ...accessories.map((item) => item.mainImage),
    ...boards.map((item) => item.mainImage),
    ...addons.map((item) => item.mainImage),
    ...(booking.venueImages ?? []),
  ].filter((src): src is string => Boolean(src));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl rounded-2xl border border-border/40 bg-card p-5" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground">تفاصيل الحجز</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{booking.koshaName ?? "كوشة"}{booking.packageName ? ` • ${booking.packageName}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </div>

        <KoshaDetailSection title="بيانات الحجز">
          <KoshaDetailGrid items={[["اسم الزبون", booking.customerName], ["رقم الهاتف", booking.phone], ["تاريخ الحجز", booking.eventDate], ["وقت الحجز", booking.eventTime], ["حالة الطلب", STATUS_LABELS[booking.status] ?? booking.status], ["الموظف الأساسي", booking.primaryEmployeeName ?? "—"], ["الموظف المساعد", booking.assistantEmployeeName ?? "—"], ["الملاحظات", booking.notes]]} />
        </KoshaDetailSection>

        <KoshaDetailSection title="الطاقم وإخراج/استلام الأصول">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">الموظف الأساسي
              <select value={primaryId} onChange={(e) => setPrimaryId(e.target.value)} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {(staffQuery.data ?? []).map((s) => <option key={s.id} value={String(s.id)}>{s.fullName || s.username}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">الموظف المساعد
              <select value={assistantId} onChange={(e) => setAssistantId(e.target.value)} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {(staffQuery.data ?? []).map((s) => <option key={s.id} value={String(s.id)}>{s.fullName || s.username}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => saveCrew.mutate()} disabled={saveCrew.isPending} className="gap-1">حفظ الطاقم</Button>
            <Link href={`/admin/asset-gate?bookingId=${booking.id}&mode=checkout`}>
              <Button size="sm" variant="outline" className="gap-1"><ScanLine className="h-3.5 w-3.5" /> مسح / إخراج من المخزن</Button>
            </Link>
            <Link href={`/admin/asset-gate?bookingId=${booking.id}&mode=return`}>
              <Button size="sm" variant="outline" className="gap-1"><ArrowDownToLine className="h-3.5 w-3.5" /> استلام الأصول</Button>
            </Link>
          </div>
        </KoshaDetailSection>

        <KoshaDetailSection title="التتبع وحالة الكوشة">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">رقم التتبع:</span>
            <span className="font-mono font-bold text-primary">{booking.trackingCode ?? "—"}</span>
            {booking.trackingCode ? <a href={`/kosha-tracking/${booking.trackingCode}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">فتح صفحة التتبع</a> : null}
          </div>
          <div className="mt-2">
            <label className="mb-1 block text-xs text-muted-foreground">حالة التتبع (تظهر للزبون)</label>
            <select value={trackingStatus} disabled={updateTracking.isPending} onChange={(event) => { setTrackingStatus(event.target.value); updateTracking.mutate(event.target.value); }} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm sm:w-72">
              {KOSHA_TRACKING_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
            </select>
          </div>
        </KoshaDetailSection>

        <KoshaDetailSection title="معدات الحجز والمستشار">
          <BookingEquipmentSection bookingId={booking.id} />
        </KoshaDetailSection>

        <KoshaDetailSection title="📦 منتجات الإنتاج (BOM)">
          <BookingProductionSection bookingId={booking.id} />
        </KoshaDetailSection>

        <KoshaDetailSection title="🛒 المنتجات من المتجر">
          <BookingReservationSection bookingId={booking.id} />
        </KoshaDetailSection>

        <KoshaDetailSection title="💌 الدعوة الإلكترونية">
          <BookingInvitationButton bookingId={booking.id} />
        </KoshaDetailSection>

        <KoshaDetailSection title="الكوشة المختارة">
          <KoshaOptionTile name={booking.koshaName ?? kosha?.name ?? "—"} mainImage={kosha?.mainImage ?? null} price={kosha?.price ?? null} onZoom={setLightbox} />
        </KoshaDetailSection>

        <KoshaDetailSection title="الإكسسوارات المختارة">
          {accessories.length ? <div className="grid gap-2 sm:grid-cols-2">{accessories.map((item, index) => <KoshaOptionTile key={index} {...item} onZoom={setLightbox} />)}</div> : <KoshaNoExtras />}
        </KoshaDetailSection>

        <KoshaDetailSection title="بورد الترحيب">
          {boards.length ? <div className="grid gap-2 sm:grid-cols-2">{boards.map((item, index) => <KoshaOptionTile key={index} {...item} onZoom={setLightbox} />)}</div> : <KoshaNoExtras />}
        </KoshaDetailSection>

        <KoshaDetailSection title="الخدمات الإضافية">
          {addons.length ? <div className="grid gap-2 sm:grid-cols-2">{addons.map((item, index) => <KoshaOptionTile key={index} {...item} onZoom={setLightbox} />)}</div> : <KoshaNoExtras />}
        </KoshaDetailSection>

        {galleryImages.length > 0 && (
          <KoshaDetailSection title="معرض الصور">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {galleryImages.map((src, index) => (
                <button key={index} type="button" onClick={() => setLightbox(src)} className="aspect-square overflow-hidden rounded-lg border border-border/30 bg-background">
                  <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 hover:scale-105" />
                </button>
              ))}
            </div>
          </KoshaDetailSection>
        )}

        <KoshaFinancialSummary booking={booking} finance={financeQuery.data?.finance ?? financeQuery.data} />
        <KoshaDetailSection title="المبالغ">
          {isKoshaPendingPricing(booking) ? (
            <div className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-3 text-sm font-semibold text-status-warning">بانتظار تحديد السعر من الإدارة</div>
          ) : (
            <AccountSummaryCard
              sourceType="kosha_booking"
              sourceId={booking.id}
              total={Number(booking.totalAmount ?? 0)}
              discount={Number((booking.bookingDetails as any)?.pricing?.discountAmount ?? 0)}
              paid={Number(booking.paidAmount ?? 0)}
              remaining={Number(booking.remainingAmount ?? 0)}
              paymentStatus={booking.paymentStatus ?? "unpaid"}
              onCollected={() => {
                queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] });
                onClose();
              }}
              compact
            />
          )}
        </KoshaDetailSection>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={(event) => { event.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="" className="max-h-[88dvh] max-w-full rounded-lg object-contain" />
          <button type="button" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </div>
      )}
    </div>
  );
}

type BookingAsset = { productId: number; quantity: number; name: string; status: string; stock: number };
type BookingAssetsResponse = {
  assets: BookingAsset[];
  suggestions: Array<{ productId: number; name: string; reason: string }>;
  warnings: string[];
  searchResults: Array<{ productId: number; name: string; stock: number; status: string }>;
};

// Feature #17 — link equipment to a booking, with emergency-lock guards and backup suggestions.
function BookingEquipmentSection({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const key = ["admin", "kosha-booking-assets", bookingId] as const;
  const { data } = useQuery<BookingAssetsResponse>({
    queryKey: [...key, search],
    queryFn: () => adminFetch(`/admin/kosha-bookings/${bookingId}/assets?search=${encodeURIComponent(search)}`),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: (productId: number) => adminFetch(`/admin/kosha-bookings/${bookingId}/assets`, { method: "POST", body: JSON.stringify({ productId }) }),
    onSuccess: () => { setSearch(""); invalidate(); toast({ title: "تمت إضافة المعدّة للحجز" }); },
    onError: (e) => toast({ title: "تعذّر الإضافة", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (productId: number) => adminFetch(`/admin/kosha-bookings/${bookingId}/assets/${productId}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); },
    onError: (e) => toast({ title: "تعذّر الحذف", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const assets = data?.assets ?? [];
  return (
    <div className="space-y-3">
      {data?.warnings?.length ? (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-2 text-xs text-status-danger">
          {data.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      ) : null}

      {assets.length ? (
        <div className="flex flex-wrap gap-2">
          {assets.map((a) => (
            <span key={a.productId} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${a.status === "locked" ? "bg-status-danger/10 text-status-danger" : "bg-primary/10 text-primary"}`}>
              {a.name}{a.status === "locked" ? " 🔒" : ""}
              <button type="button" onClick={() => remove.mutate(a.productId)} className="font-bold hover:opacity-70" aria-label="إزالة">×</button>
            </span>
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">لا توجد معدات مرتبطة بهذا الحجز.</p>}

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن معدّة لإضافتها..." className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
      {search.length >= 2 && data?.searchResults?.length ? (
        <div className="divide-y divide-border/20 rounded-lg border border-border/30">
          {data.searchResults.map((r) => (
            <button key={r.productId} type="button" disabled={add.isPending} onClick={() => add.mutate(r.productId)} className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-background/60">
              <span>{r.name}{r.status === "locked" ? " 🔒 مقفول" : ""}</span>
              <span className="text-xs text-muted-foreground">مخزون {r.stock}</span>
            </button>
          ))}
        </div>
      ) : null}

      {data?.suggestions?.length ? (
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> اقتراحات احتياطية:</p>
          <div className="flex flex-wrap gap-2">
            {data.suggestions.map((s) => (
              <button key={s.productId} type="button" disabled={add.isPending} onClick={() => add.mutate(s.productId)} className="rounded-full border border-border/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary">+ {s.name}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type BookingProductionResponse = {
  status: string;
  items: Array<{ productId: number; name: string; quantity: number; unitPrice?: number; status?: string }>;
  materials: Array<{ productId: number; name: string; required: number; available: number; missing: number; unit: string }>;
  shoppingList: Array<{ productId: number; name: string; required: number; missing: number; unit: string }>;
  stockOk: boolean;
  totalCost: number;
  expectedRevenue: number;
  expectedProfit: number;
  profitMargin: number;
};

const PRODUCTION_STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  preparing: "التحضير",
  in_production: "قيد الإنتاج",
  quality_check: "فحص الجودة",
  ready: "جاهز",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

type ReservationRow = { productId: number; variantId: number | null; quantity: number; productName: string; variantLabel: string | null };

// Reserve products/variants against a booking (holds stock without deducting). Confirming the
// booking consumes the holds; cancelling releases them. Blocks quantities beyond available.
type StoreLine = {
  productId: number; variantId: number | null; productName: string; variantLabel: string | null;
  imageUrl: string | null; quantity: number; status: string; barcode: string | null;
  unitPrice: number; free: boolean; lineTotal: number; note: string | null;
};

const STORE_STATUS_BADGE: Record<string, { t: string; c: string }> = {
  reserved: { t: "🔒 محجوز", c: "border-status-warning/30 bg-status-warning/10 text-status-warning" },
  consumed: { t: "✅ مخصوم", c: "border-status-success/30 bg-status-success/10 text-status-success" },
  released: { t: "↩︎ محرَّر", c: "border-border/30 text-muted-foreground" },
};

// Create an electronic invitation pre-filled from this booking (no duplicate entry).
function BookingInvitationButton({ bookingId }: { bookingId: number }) {
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: () => adminFetch<{ id: number }>("/admin/invitations", { method: "POST", body: JSON.stringify({ type: "wedding", bookingId }) }),
    onSuccess: (card) => { window.location.assign(`/admin/invitations/${card.id}`); },
    onError: (e: any) => toast({ title: "تعذّر إنشاء الدعوة", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending} className="gap-1">💌 إنشاء دعوة إلكترونية</Button>
      <span className="text-xs text-muted-foreground">تُستورد بيانات العروسين والتاريخ والموقع والهاتف تلقائياً من الحجز.</span>
    </div>
  );
}

function BookingReservationSection({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [pickedProduct, setPickedProduct] = useState<{ id: number; name: string; price: number } | null>(null);
  const [variantOptions, setVariantOptions] = useState<any[] | null>(null);
  const [variantId, setVariantId] = useState<string>("");
  const [qty, setQty] = useState(1);
  const key = ["admin", "kosha-booking-reservations", bookingId] as const;

  const { data } = useQuery<{ items: StoreLine[]; subtotal: number; status: string }>({
    queryKey: key,
    queryFn: () => adminFetch(`/admin/kosha-bookings/${bookingId}/reservations`),
    refetchInterval: 15_000, // reflect consumption/release on status change without refresh
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["admin", "reservation-products-picker"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 2 * 60 * 1000,
  });

  const lines: StoreLine[] = (data?.items ?? []).filter((r) => r.status !== "released");
  const subtotal = data?.subtotal ?? lines.reduce((s, l) => s + (l.free ? 0 : l.unitPrice * l.quantity), 0);
  const productImage = (p: any): string | null => (Array.isArray(p?.images) ? p.images[0] : null) ?? p?.mainImage ?? null;

  const commit = useMutation({
    mutationFn: (items: StoreLine[]) =>
      adminFetch(`/admin/kosha-bookings/${bookingId}/reservations`, {
        method: "PUT",
        body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice, free: i.free, note: i.note })) }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e: any) => {
      if (apiErrorStatus(e) === 409) toast({ title: "المخزون المتاح غير كافٍ", description: apiErrorMessage(e), variant: "destructive" });
      else toast({ title: "تعذّر الحفظ", description: apiErrorMessage(e), variant: "destructive" });
    },
  });
  const editable = lines.every((l) => l.status === "reserved"); // once consumed, holds are locked

  function updateLine(target: StoreLine, patch: Partial<StoreLine>) {
    commit.mutate(lines.map((l) => (l === target ? { ...l, ...patch } : l)));
  }
  function removeLine(target: StoreLine) {
    commit.mutate(lines.filter((l) => l !== target));
  }
  function addOrBump(p: any, variant: { id: number | null; label: string | null }, addQty: number) {
    const existing = lines.find((l) => l.productId === p.id && l.variantId === variant.id);
    const next = existing
      ? lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + addQty } : l))
      : [...lines, {
          productId: p.id, variantId: variant.id, productName: p.nameAr || p.name, variantLabel: variant.label,
          imageUrl: productImage(p), quantity: addQty, status: "reserved", barcode: p.barcode ?? null,
          unitPrice: Number(p.price ?? 0), free: false, lineTotal: 0, note: null,
        }];
    commit.mutate(next);
  }

  async function choose(p: any) {
    setPickedProduct({ id: p.id, name: p.nameAr || p.name, price: Number(p.price ?? 0) });
    setVariantId(""); setSearch("");
    try { const stock = await adminFetch<any>(`/products/${p.id}/stock`); setVariantOptions(stock.hasVariants ? stock.variants : []); }
    catch { setVariantOptions([]); }
  }
  function addPicked() {
    if (!pickedProduct) return;
    const src = products.find((x) => x.id === pickedProduct.id) ?? { id: pickedProduct.id, name: pickedProduct.name, price: pickedProduct.price };
    const vId = variantId ? Number(variantId) : null;
    const v = variantOptions?.find((x) => x.id === vId);
    const vLabel = v ? [v.color, v.size].filter(Boolean).join(" / ") || null : null;
    addOrBump(src, { id: vId, label: vLabel }, qty);
    setPickedProduct(null); setVariantOptions(null); setVariantId(""); setQty(1);
  }
  function onScan(code: string) {
    const c = code.trim().toLowerCase();
    const p = products.find((x) => String(x.barcode ?? "").toLowerCase() === c || `ajn-a${String(x.id).padStart(6, "0")}` === c);
    if (!p) { toast({ title: "لم يُعثر على منتج بهذا الباركود", variant: "destructive" }); return; }
    addOrBump(p, { id: null, label: null }, 1);
    toast({ title: `تمت إضافة ${p.nameAr || p.name}` });
  }

  const searchResults = search.trim().length >= 2
    ? products.filter((p) => [p.nameAr, p.name, p.barcode].some((v) => String(v ?? "").toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 10)
    : [];
  const variantsNeedPick = variantOptions && variantOptions.length > 0;

  return (
    <div className="space-y-3">
      {lines.length ? (
        <div className="overflow-x-auto rounded-lg border border-border/25">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground">
              <tr>{["", "المنتج", "الكمية", "سعر الوحدة", "الإجمالي", "الحالة", "ملاحظة", ""].map((h, i) => <th key={i} className="px-2 py-2 text-right font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const badge = STORE_STATUS_BADGE[l.status] ?? STORE_STATUS_BADGE.reserved;
                return (
                  <tr key={i} className="border-t border-border/20">
                    <td className="px-2 py-2">{l.imageUrl ? <img src={l.imageUrl} alt="" className="h-9 w-9 rounded object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></span>}</td>
                    <td className="px-2 py-2"><div className="font-medium text-foreground">{l.productName}</div>{l.variantLabel ? <div className="text-[11px] text-primary">{l.variantLabel}</div> : null}</td>
                    <td className="px-2 py-2">
                      {editable ? (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => (l.quantity > 1 ? updateLine(l, { quantity: l.quantity - 1 }) : removeLine(l))} className="grid h-6 w-6 place-items-center rounded border border-border/40"><Minus className="h-3 w-3" /></button>
                          <span className="w-7 text-center font-bold">{l.quantity}</span>
                          <button type="button" onClick={() => updateLine(l, { quantity: l.quantity + 1 })} className="grid h-6 w-6 place-items-center rounded border border-border/40"><Plus className="h-3 w-3" /></button>
                        </div>
                      ) : <span className="font-bold">{l.quantity}</span>}
                    </td>
                    <td className="px-2 py-2">
                      {l.free ? <span className="text-status-success">مجاناً</span> : editable ? (
                        <input type="number" min={0} defaultValue={l.unitPrice} onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== l.unitPrice) updateLine(l, { unitPrice: v }); }} className="w-24 rounded border border-border/40 bg-background px-2 py-1 text-xs" />
                      ) : formatCurrency(l.unitPrice)}
                    </td>
                    <td className="px-2 py-2 font-bold text-foreground">{l.free ? "—" : formatCurrency(l.unitPrice * l.quantity)}</td>
                    <td className="px-2 py-2"><span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] ${badge.c}`}>{badge.t} {l.quantity}</span></td>
                    <td className="px-2 py-2">
                      {editable ? <input defaultValue={l.note ?? ""} placeholder="—" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (l.note ?? "")) updateLine(l, { note: v || null }); }} className="w-28 rounded border border-border/40 bg-background px-2 py-1 text-xs" /> : <span className="text-xs text-muted-foreground">{l.note ?? "—"}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <button type="button" title="مجاني / مشمول" onClick={() => updateLine(l, { free: !l.free })} disabled={!editable} className={`grid h-6 w-6 place-items-center rounded border ${l.free ? "border-status-success/40 bg-status-success/10 text-status-success" : "border-border/40 text-muted-foreground"} disabled:opacity-40`}><Gift className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => removeLine(l)} disabled={!editable} className="grid h-6 w-6 place-items-center rounded border border-destructive/30 text-destructive disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-xs text-muted-foreground">لا توجد منتجات متجر مضافة لهذا الحجز.</p>}

      {lines.length > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-background/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">إجمالي منتجات المتجر</span>
          <span className="font-bold text-primary">{formatCurrency(subtotal)}</span>
        </div>
      )}

      {pickedProduct ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{pickedProduct.name}</span>
            <button type="button" onClick={() => { setPickedProduct(null); setVariantOptions(null); }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          {variantsNeedPick && (
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-xs">
              <option value="">— اختر المتغيّر (لون / مقاس) —</option>
              {variantOptions!.map((v) => <option key={v.id} value={v.id}>{[v.color, v.size].filter(Boolean).join(" / ")} (متاح {v.available})</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="w-20 rounded-lg border border-border/40 bg-background px-2 py-1 text-center text-sm" />
            <Button size="sm" className="flex-1" disabled={commit.isPending || (Boolean(variantsNeedPick) && !variantId)} onClick={addPicked}>إضافة وحجز</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الباركود أو SKU..." className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
            <button type="button" onClick={() => setScanning((s) => !s)} className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border ${scanning ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground"}`} title="مسح باركود"><ScanLine className="h-4 w-4" /></button>
          </div>
          {scanning ? <div className="overflow-hidden rounded-lg border border-border/30"><LiveScanner active={scanning} onDetect={onScan} /></div> : null}
          {searchResults.length ? (
            <div className="divide-y divide-border/20 rounded-lg border border-border/30">
              {searchResults.map((p) => (
                <button key={p.id} type="button" onClick={() => choose(p)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-background/60">
                  {productImage(p) ? <img src={productImage(p)!} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></span>}
                  <span className="min-w-0 flex-1 truncate text-right">{p.nameAr || p.name}</span>
                  <span className="text-[11px] text-muted-foreground">متاح {Number(p.stock ?? 0)}</span>
                  <Plus className="h-4 w-4 text-primary" />
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">يُحجز المخزون دون خصمه. عند تأكيد الحجز (مؤكد/قيد التنفيذ/مكتمل) يُخصم فعلياً، وعند الإلغاء يُحرَّر تلقائياً.</p>
        <button type="button" onClick={() => setShowReports((s) => !s)} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><BarChart3 className="h-3.5 w-3.5" /> تقارير المنتجات</button>
      </div>
      {showReports && <StoreProductsReport />}
    </div>
  );
}

function StoreProductsReport() {
  const { data } = useQuery<{ mostUsed: any[]; byCustomer: any[]; products: any[] }>({
    queryKey: ["admin", "kosha-store-products-report"],
    queryFn: () => adminFetch("/admin/kosha-store-products"),
  });
  if (!data) return <p className="text-xs text-muted-foreground">جارٍ التحميل…</p>;
  const totalProfit = (data.products ?? []).reduce((s, p) => s + Number(p.profit || 0), 0);
  return (
    <div className="grid gap-3 rounded-lg border border-border/25 bg-background/30 p-3 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-semibold text-foreground">الأكثر استخداماً</p>
        {(data.mostUsed ?? []).length ? (data.mostUsed).map((p: any) => (
          <div key={p.productId} className="flex justify-between text-xs"><span className="truncate text-foreground">{p.name}</span><span className="text-muted-foreground">{p.qty} · ربح {formatCurrency(p.profit)}</span></div>
        )) : <p className="text-xs text-muted-foreground">لا بيانات</p>}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-foreground">حسب الزبون</p>
        {(data.byCustomer ?? []).length ? (data.byCustomer).slice(0, 8).map((c: any, i: number) => (
          <div key={i} className="flex justify-between text-xs"><span className="truncate text-foreground">{c.customer}</span><span className="text-muted-foreground">{c.qty} قطعة · {c.bookings} حجز</span></div>
        )) : <p className="text-xs text-muted-foreground">لا بيانات</p>}
        <div className="mt-2 flex justify-between border-t border-border/20 pt-1 text-xs font-bold"><span>إجمالي ربحية المنتجات</span><span className="text-status-success">{formatCurrency(totalProfit)}</span></div>
      </div>
    </div>
  );
}

// Attach production (BOM) products to a booking. Deducts recipe components, not finished items.
function BookingProductionSection({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const key = ["admin", "kosha-booking-production", bookingId] as const;
  const { data } = useQuery<BookingProductionResponse>({
    queryKey: key,
    queryFn: () => adminFetch(`/admin/kosha-bookings/${bookingId}/production`),
  });
  const { data: products = [] } = useQuery<Array<{ id: number; name: string; nameAr: string; stock: number }>>({
    queryKey: ["admin", "production-products-picker"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 2 * 60 * 1000,
    enabled: search.trim().length >= 2,
  });
  // Production orders explicitly linked to this booking — shows live manufacturing progress.
  const { data: linkedOrders = [] } = useQuery<Array<{ id: number; orderNo: string; status: string; totalCost: number; expectedProfit: number }>>({
    queryKey: ["admin", "kosha-booking-production-orders", bookingId],
    queryFn: () => adminFetch(`/admin/production?bookingType=kosha_booking&bookingId=${bookingId}`),
  });

  const items = data?.items ?? [];
  const save = useMutation({
    mutationFn: (payload: { items: any[]; status?: string }) =>
      adminFetch(`/admin/kosha-bookings/${bookingId}/production`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(e), variant: "destructive" }),
  });

  function commit(nextItems: any[], status?: string) {
    save.mutate({ items: nextItems.map((i) => ({ productId: i.productId, quantity: i.quantity, status: i.status })), status: status ?? data?.status });
  }
  function addProduct(p: { id: number; nameAr: string; name: string }) {
    if (items.some((i) => i.productId === p.id)) return;
    commit([...items, { productId: p.id, name: p.nameAr || p.name, quantity: 1, status: "pending" }]);
    setSearch("");
  }
  function setQty(productId: number, quantity: number) {
    commit(items.map((i) => (i.productId === productId ? { ...i, quantity } : i)));
  }
  function removeProduct(productId: number) {
    commit(items.filter((i) => i.productId !== productId));
  }

  const searchResults = search.trim().length >= 2
    ? products.filter((p) => [p.nameAr, p.name].some((v) => String(v ?? "").toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 12)
    : [];

  return (
    <div className="space-y-3">
      {linkedOrders.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-1">
          <p className="text-[11px] font-semibold text-foreground">🏭 أوامر إنتاج مرتبطة:</p>
          {linkedOrders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-xs">
              <span className="font-mono text-foreground">{o.orderNo}</span>
              <span className="text-muted-foreground">{PRODUCTION_STATUS_LABELS[o.status] ?? o.status} · {formatCurrency(o.totalCost)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground">حالة الإنتاج</label>
        <select
          value={data?.status ?? "pending"}
          onChange={(e) => commit(items, e.target.value)}
          className="rounded-lg border border-border/40 bg-background px-2 py-1 text-xs"
        >
          {Object.entries(PRODUCTION_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {items.length ? (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.productId} className="flex items-center gap-2 rounded-lg border border-border/25 bg-background/40 p-2">
              <span className="flex-1 min-w-0 truncate text-sm text-foreground">{it.name}</span>
              <input type="number" min={1} value={it.quantity}
                onChange={(e) => setQty(it.productId, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-16 rounded-lg border border-border/40 bg-background px-2 py-1 text-center text-sm" />
              <button type="button" onClick={() => removeProduct(it.productId)} className="p-1 text-status-danger hover:opacity-70"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">لا توجد منتجات إنتاج مرتبطة بهذا الحجز.</p>}

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن منتج للإضافة..." className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
      {searchResults.length ? (
        <div className="divide-y divide-border/20 rounded-lg border border-border/30">
          {searchResults.map((r) => (
            <button key={r.id} type="button" onClick={() => addProduct(r)} className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-background/60">
              <span>{r.nameAr || r.name}</span>
              <span className="text-xs text-muted-foreground">مخزون {r.stock}</span>
            </button>
          ))}
        </div>
      ) : null}

      {data && items.length ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border/30 bg-background/40 p-2"><p className="text-[10px] text-muted-foreground">التكلفة</p><p className="text-xs font-bold text-foreground">{formatCurrency(data.totalCost)}</p></div>
            <div className="rounded-lg border border-border/30 bg-background/40 p-2"><p className="text-[10px] text-muted-foreground">الإيراد</p><p className="text-xs font-bold text-foreground">{formatCurrency(data.expectedRevenue)}</p></div>
            <div className="rounded-lg border border-border/30 bg-background/40 p-2"><p className="text-[10px] text-muted-foreground">الربح</p><p className={`text-xs font-bold ${data.expectedProfit >= 0 ? "text-status-success" : "text-status-danger"}`}>{formatCurrency(data.expectedProfit)}</p></div>
          </div>
          {!data.stockOk && data.shoppingList.length ? (
            <div className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-2">
              <p className="text-xs font-semibold text-status-danger">🛒 مواد ناقصة قبل التأكيد:</p>
              <ul className="mt-1 space-y-0.5">
                {data.shoppingList.map((s) => <li key={s.productId} className="flex justify-between text-xs text-foreground"><span>{s.name}</span><span className="text-status-danger">ناقص {s.missing} {s.unit}</span></li>)}
              </ul>
            </div>
          ) : items.length ? (
            <p className="text-xs text-status-success">✅ جميع المواد متوفرة.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function EditKoshaBookingModal({ booking, onClose, onSaved }: { booking: KoshaBooking; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [previewReady, setPreviewReady] = useState(false);
  const savedPricing = ((booking.bookingDetails ?? {}) as any).pricing ?? {};
  const textNumber = (value: unknown) => String(Number(value ?? 0) || 0);
  const [form, setForm] = useState({
    koshaId: booking.koshaId ?? 0,
    customerName: booking.customerName ?? "",
    phone: booking.phone ?? "",
    brideName: booking.brideName ?? "",
    groomName: booking.groomName ?? "",
    bridePhone: booking.bridePhone ?? "",
    groomPhone: booking.groomPhone ?? "",
    alternatePhone: booking.alternatePhone ?? "",
    eventDate: booking.eventDate ?? "",
    eventTime: booking.eventTime ?? "",
    eventType: booking.eventType ?? "",
    serviceLevel: booking.serviceLevel ?? "",
    venueType: booking.venueType ?? "",
    themeColor: booking.themeColor ?? "",
    province: booking.province ?? "",
    area: booking.area ?? "",
    mahalla: booking.mahalla ?? "",
    nearestPoint: booking.nearestPoint ?? "",
    addressNotes: booking.addressNotes ?? "",
    selectedAddons: booking.selectedAddons ?? [],
    welcomeBoards: booking.welcomeBoards ?? [],
    selectedAccessories: booking.selectedAccessories ?? [],
    notes: booking.notes ?? "",
    internalNotes: booking.internalNotes ?? "",
    koshaPrice: textNumber(savedPricing.koshaPrice),
    welcomeBoardPrice: textNumber(savedPricing.welcomeBoardPrice),
    accessoriesPrice: textNumber(savedPricing.accessoriesPrice),
    addonsPrice: textNumber(savedPricing.addonsPrice),
    discountAmount: textNumber(savedPricing.discountAmount),
    totalAmount: textNumber(booking.totalAmount ?? savedPricing.totalAmount),
    paidAmount: String(booking.paidAmount ?? 0),
    paymentMethod: String(savedPricing.paymentMethod ?? (booking.paymentStatus === "paid" ? "cash" : "transfer")),
    financialNotes: String(savedPricing.financialNotes ?? ""),
  });
  useEffect(() => setPreviewReady(false), [form]);
  const { data: koshas = [] } = useQuery<Kosha[]>({ queryKey: ["admin", "koshas", "booking-editor"], queryFn: () => adminFetch("/admin/koshas") });
  const { data: options } = useQuery<{ addons: KoshaOption[]; welcomeBoards: KoshaOption[]; accessories: KoshaOption[]; provinces: Array<{ id: number; name: string }> }>({
    queryKey: ["koshas", "options", "booking-editor"], queryFn: () => fetch("/api/koshas/options").then((response) => response.json()),
  });
  const requestedPaidAmount = Number(form.paidAmount || 0) || 0;
  const breakdownTotal = Math.max(0,
    (Number(form.koshaPrice || 0) || 0) +
    (Number(form.welcomeBoardPrice || 0) || 0) +
    (Number(form.accessoriesPrice || 0) || 0) +
    (Number(form.addonsPrice || 0) || 0) -
    (Number(form.discountAmount || 0) || 0),
  );
  const pricedTotal = (Number(form.totalAmount || 0) || 0) > 0 ? Number(form.totalAmount || 0) || 0 : breakdownTotal;
  const paidAmount = form.paymentMethod === "cash" ? pricedTotal : requestedPaidAmount;
  const remainingAmount = Math.max(0, pricedTotal - paidAmount);
  const computedPaymentStatus = pricedTotal <= 0 ? "pending_pricing" : remainingAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
  const save = useMutation({
    mutationFn: () => adminFetch(`/admin/kosha-bookings/${booking.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...form,
        totalAmount: pricedTotal,
        paidAmount,
        paymentStatus: computedPaymentStatus,
        paymentMethod: form.paymentMethod,
        pricing: {
          koshaPrice: Number(form.koshaPrice || 0) || 0,
          welcomeBoardPrice: Number(form.welcomeBoardPrice || 0) || 0,
          accessoriesPrice: Number(form.accessoriesPrice || 0) || 0,
          addonsPrice: Number(form.addonsPrice || 0) || 0,
          discountAmount: Number(form.discountAmount || 0) || 0,
          totalAmount: pricedTotal,
          paidAmount,
          remainingAmount,
          paymentMethod: form.paymentMethod,
          financialNotes: form.financialNotes,
        },
      }),
    }),
    onSuccess: () => { toast({ title: "تم حفظ تعديل حجز الكوشة" }); onSaved(); },
    onError: (error: any) => toast({ title: "تعذر حفظ التعديل", description: error?.message, variant: "destructive" }),
  });
  const projectedTotal = pricedTotal;

  function toggle(key: "selectedAddons" | "selectedAccessories", name: string) {
    setForm((current) => ({ ...current, [key]: current[key].includes(name) ? current[key].filter((item) => item !== name) : [...current[key], name] }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4" dir="rtl">
      <form onSubmit={(event) => { event.preventDefault(); if (!previewReady) { setPreviewReady(true); return; } save.mutate(); }} className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 p-4 sm:p-5">
          <div><h3 className="font-bold text-foreground">تعديل حجز الكوشة KB-{booking.id}</h3><p className="mt-1 text-xs text-muted-foreground">التغييرات المالية تظهر قبل اعتماد الحفظ.</p></div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="mb-1 block text-xs text-muted-foreground">الكوشة</label><select value={form.koshaId} onChange={(event) => setForm({ ...form, koshaId: Number(event.target.value) })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">{koshas.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatCurrency(item.price)}</option>)}</select></div>
            <Field label="اسم الزبون" value={form.customerName} onChange={(value) => setForm({ ...form, customerName: value })} />
            <Field label="رقم الهاتف" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
            <Field label="اسم العروس" value={form.brideName} onChange={(value) => setForm({ ...form, brideName: value })} />
            <Field label="اسم العريس" value={form.groomName} onChange={(value) => setForm({ ...form, groomName: value })} />
            <Field label="رقم العروس" value={form.bridePhone} onChange={(value) => setForm({ ...form, bridePhone: value })} />
            <Field label="رقم العريس" value={form.groomPhone} onChange={(value) => setForm({ ...form, groomPhone: value })} />
            <Field label="هاتف آخر" value={form.alternatePhone} onChange={(value) => setForm({ ...form, alternatePhone: value })} />
            <Field label="تاريخ المناسبة" type="date" value={form.eventDate} onChange={(value) => setForm({ ...form, eventDate: value })} />
            <Field label="وقت المناسبة" type="time" value={form.eventTime} onChange={(value) => setForm({ ...form, eventTime: value })} />
            <Field label="نوع الحفل" value={form.eventType} onChange={(value) => setForm({ ...form, eventType: value })} />
            <Field label="مستوى الخدمة" value={form.serviceLevel} onChange={(value) => setForm({ ...form, serviceLevel: value })} />
            <Field label="نوع المكان" value={form.venueType} onChange={(value) => setForm({ ...form, venueType: value })} />
            <Field label="لون الثيم" value={form.themeColor} onChange={(value) => setForm({ ...form, themeColor: value })} />
            <div><label className="mb-1 block text-xs text-muted-foreground">المحافظة</label><select value={form.province} onChange={(event) => setForm({ ...form, province: event.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">—</option>{(options?.provinces ?? []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></div>
            <Field label="المنطقة" value={form.area} onChange={(value) => setForm({ ...form, area: value })} />
            <Field label="المحلة" value={form.mahalla} onChange={(value) => setForm({ ...form, mahalla: value })} />
            <Field label="أقرب نقطة" value={form.nearestPoint} onChange={(value) => setForm({ ...form, nearestPoint: value })} />
            <Field label="ملاحظة العنوان" value={form.addressNotes} onChange={(value) => setForm({ ...form, addressNotes: value })} />
          </div>

          <KoshaBookingOptionPicker title="الخدمات الإضافية" options={options?.addons ?? []} selected={form.selectedAddons} onToggle={(name) => toggle("selectedAddons", name)} />
          <KoshaBookingOptionPicker title="بورد الترحيب" options={options?.welcomeBoards ?? []} selected={form.welcomeBoards} single onToggle={(name) => setForm({ ...form, welcomeBoards: form.welcomeBoards.includes(name) ? [] : [name] })} />
          <KoshaBookingOptionPicker title="الإكسسوارات" options={options?.accessories ?? []} selected={form.selectedAccessories} onToggle={(name) => toggle("selectedAccessories", name)} />

          <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-foreground">تسعير الحجز</h4>
                <p className="mt-1 text-xs text-muted-foreground">الزبون لا يرى الأسعار قبل حفظ التسعير من هنا.</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${computedPaymentStatus === "pending_pricing" ? "bg-status-warning/15 text-status-warning" : "bg-primary/10 text-primary"}`}>
                {computedPaymentStatus === "pending_pricing" ? "بانتظار التسعير" : "تم التسعير"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="سعر الكوشة" type="number" value={form.koshaPrice} onChange={(value) => setForm({ ...form, koshaPrice: value })} />
              <Field label="سعر بورد الترحيب" type="number" value={form.welcomeBoardPrice} onChange={(value) => setForm({ ...form, welcomeBoardPrice: value })} />
              <Field label="سعر الإكسسوارات" type="number" value={form.accessoriesPrice} onChange={(value) => setForm({ ...form, accessoriesPrice: value })} />
              <Field label="سعر الخدمات الإضافية" type="number" value={form.addonsPrice} onChange={(value) => setForm({ ...form, addonsPrice: value })} />
              <Field label="خصم إن وجد" type="number" value={form.discountAmount} onChange={(value) => setForm({ ...form, discountAmount: value })} />
              <Field label="المبلغ الكلي" type="number" value={form.totalAmount} onChange={(value) => setForm({ ...form, totalAmount: value })} />
              <div><label className="mb-1 block text-xs text-muted-foreground">طريقة الدفع</label><select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value, paidAmount: event.target.value === "cash" ? String(pricedTotal) : form.paidAmount })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="cash">نقداً</option><option value="transfer">تحويل</option><option value="pos">بطاقة</option></select></div>
              <Field label="المبلغ المدفوع" type="number" value={String(paidAmount)} onChange={(value) => setForm({ ...form, paidAmount: form.paymentMethod === "cash" ? String(pricedTotal) : value })} />
              <div className="rounded-lg border border-border/30 bg-background/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">المبلغ المتبقي</div>
                <div className="mt-1 text-sm font-bold text-foreground">{formatCurrency(remainingAmount)}</div>
              </div>
              <div className="rounded-lg border border-border/30 bg-background/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">حالة الدفع</div>
                <div className="mt-1 text-sm font-bold text-primary">{computedPaymentStatus === "paid" ? "مدفوع" : computedPaymentStatus === "partial" ? "جزئي" : computedPaymentStatus === "pending_pricing" ? "بانتظار التسعير" : "غير مدفوع"}</div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="ملاحظات مالية" value={form.financialNotes} onChange={(value) => setForm({ ...form, financialNotes: value })} textarea />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ملاحظات الزبون" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} textarea />
            <Field label="ملاحظات داخلية" value={form.internalNotes} onChange={(value) => setForm({ ...form, internalNotes: value })} textarea />
          </div>

          {previewReady && <div className="rounded-xl border border-primary/35 bg-primary/5 p-4"><div className="mb-3 flex items-center justify-between"><h4 className="font-semibold text-foreground">معاينة التغييرات</h4><Check className="h-4 w-4 text-primary" /></div><div className="grid gap-2 text-xs sm:grid-cols-3"><div><p className="text-muted-foreground">الإجمالي السابق</p><p className="mt-1 font-semibold">{formatCurrency(booking.totalAmount)}</p></div><div><p className="text-muted-foreground">الإجمالي الجديد</p><p className="mt-1 font-semibold">{formatCurrency(projectedTotal)}</p></div><div><p className="text-muted-foreground">الفرق المالي</p><p className="mt-1 font-semibold text-primary">{formatCurrency(projectedTotal - booking.totalAmount)}</p></div></div></div>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border/30 p-4"><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "جاري الحفظ..." : previewReady ? "تأكيد وحفظ" : "معاينة التغييرات"}</Button></div>
      </form>
    </div>
  );
}

function KoshaBookingOptionPicker({ title, options, selected, onToggle, single = false }: { title: string; options: KoshaOption[]; selected: string[]; onToggle: (name: string) => void; single?: boolean }) {
  return <div className="space-y-2"><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-foreground">{title}</h4><span className="text-xs text-muted-foreground">{single ? "اختيار واحد" : `${selected.length} مختار`}</span></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{options.map((option) => { const active = selected.includes(option.name); return <button key={option.id} type="button" onClick={() => onToggle(option.name)} className={`flex items-center gap-3 rounded-lg border p-2.5 text-right transition-colors ${active ? "border-primary/60 bg-primary/10" : "border-border/30 bg-background/35 hover:border-primary/30"}`}>{option.mainImage ? <img src={option.mainImage} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" /> : <span className="h-11 w-11 shrink-0 rounded-md bg-muted" />}<span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">{option.name}</span><span className="text-xs text-primary">{formatCurrency(option.price ?? 0)}</span></span>{active && <Check className="h-4 w-4 shrink-0 text-primary" />}</button>; })}</div></div>;
}
