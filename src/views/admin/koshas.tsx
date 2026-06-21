import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Edit2, Eye, EyeOff, FileDown, Plus, Printer, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { usePublicSettings } from "@/lib/public-settings";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import type { Kosha, KoshaImage } from "@/views/koshas";

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
  notes: string;
  status: string;
  internalNotes: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: string;
  dueDate?: string | null;
  createdAt: string;
};

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
};

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
  onSave,
  onDelete,
}: {
  item: KoshaOption;
  settings: any;
  watermarkText?: string;
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
  endpoint: "kosha-accessories" | "kosha-provinces";
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
            <Field label="Slug" value={form.slug} onChange={(value) => setForm((f) => ({ ...f, slug: value }))} />
            <Field label="السعر" type="number" value={form.price} onChange={(value) => setForm((f) => ({ ...f, price: Number(value) || 0 }))} />
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

export default function AdminKoshasPage() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const normalizedLocation = location.replace(/\/+$/, "");
  const isNew = normalizedLocation === "/admin/koshas/new";
  const isEdit = /\/admin\/koshas\/\d+\/edit$/.test(normalizedLocation);
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "koshas"],
    queryFn: () => adminFetch<Kosha[]>("/admin/koshas"),
    enabled: !isNew && !isEdit,
  });
  const del = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/koshas/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "koshas"] }); toast({ title: "تم حذف الكوشة" }); },
    onError: (err: any) => toast({ title: "تعذر حذف الكوشة", description: err?.message, variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: (kosha: Kosha) => adminFetch(`/admin/koshas/${kosha.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !kosha.isActive }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "koshas"] }),
  });

  if (isNew) return <KoshaForm mode="new" />;
  if (isEdit) return <KoshaForm mode="edit" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة الكوشات</h1>
          <p className="mt-1 text-sm text-muted-foreground">كتالوج مستقل عن المتجر والمنتجات.</p>
        </div>
        <Link href="/admin/koshas/new"><Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> إضافة كوشة</Button></Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <KoshaCatalogOptionsManager
          title="إدارة الخدمات الإضافية"
          description="تظهر كمنتجات مصغرة في خطوة الخدمات الإضافية مع الصورة والسعر."
          endpoint="kosha-addons"
        />
        <KoshaCatalogOptionsManager
          title="إدارة بورد الترحيب"
          description="تظهر في خطوة بورد الترحيب، والزبون يختار بورد واحد فقط."
          endpoint="kosha-welcome-boards"
        />
        <KoshaCatalogOptionsManager
          title="إدارة الاكسسوارات"
          description="تظهر كمنتجات مستقلة في خطوة الاكسسوارات مع اختيار متعدد."
          endpoint="kosha-accessories"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <KoshaOptionsManager
          title="إدارة محافظات الكوشات"
          description="هذه المحافظات تظهر في نموذج بيانات الحجز داخل صفحة الكوشات."
          endpoint="kosha-provinces"
        />
      </div>

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

export function AdminKoshaBookingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<KoshaBooking | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "kosha-bookings", search, status],
    queryFn: () => adminFetch<KoshaBooking[]>(`/admin/kosha-bookings?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  });
  const update = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<KoshaBooking> }) => adminFetch(`/admin/kosha-bookings/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] }); toast({ title: "تم تحديث الحجز" }); },
    onError: (err: any) => toast({ title: "تعذر تحديث الحجز", description: err?.message, variant: "destructive" }),
  });

  const csv = useMemo(() => {
    const header = ["الرقم", "الباقة", "الكوشة", "الزبون", "الهاتف", "العروس", "العريس", "التاريخ", "الوقت", "المحافظة", "المنطقة", "الاكسسوارات", "الإجمالي", "الحالة"];
    const rows = data.map((item) => [item.id, item.packageName ?? "", item.koshaName ?? "", item.customerName, item.phone, item.brideName, item.groomName, item.eventDate, item.eventTime, item.province, item.area || item.cityArea, item.selectedAccessories?.join("، ") ?? "", koshaBookingTotal(item.bookingDetails) ?? "", STATUS_LABELS[item.status] ?? item.status]);
    return [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }, [data]);

  function exportCsv() {
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kosha-bookings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function printBooking(item: KoshaBooking) {
    const win = window.open("", "_blank", "width=420,height=640");
    if (!win) return;
    win.document.write(`<html dir="rtl"><head><title>حجز كوشة</title><style>body{font-family:Arial;padding:24px;color:#000}h1{font-size:20px}.row{margin:10px 0;border-bottom:1px solid #ddd;padding-bottom:8px}</style></head><body><h1>تفاصيل حجز الكوشة</h1>${[
      ["الباقة", item.packageName ?? "-"],
      ["الكوشة", item.koshaName ?? "-"],
      ["الزبون", item.customerName],
      ["الهاتف", item.phone],
      ["العروس", item.brideName],
      ["العريس", item.groomName],
      ["التاريخ", item.eventDate],
      ["الوقت", item.eventTime],
      ["نوع الحفل", item.eventType],
      ["مستوى الخدمة", item.serviceLevel],
      ["نوع المكان", item.venueType],
      ["لون الثيم", item.themeColor],
      ["المحافظة", item.province],
      ["المنطقة", item.area || item.cityArea],
      ["المحلة", item.mahalla],
      ["أقرب نقطة", item.nearestPoint || item.hallLocation],
      ["الخدمات الإضافية", item.selectedAddons?.join("، ")],
      ["بورد الترحيب", item.welcomeBoards?.join("، ")],
      ["الاكسسوارات", item.selectedAccessories?.join("، ")],
      ["الإجمالي", koshaBookingTotal(item.bookingDetails) ? formatCurrency(koshaBookingTotal(item.bookingDetails) ?? 0) : "-"],
      ["الحالة", STATUS_LABELS[item.status] ?? item.status],
      ["ملاحظات", item.notes],
    ].map(([label, value]) => `<div class="row"><strong>${label}</strong><br>${value || "-"}</div>`).join("")}<script>window.onload=()=>window.print()</script></body></html>`);
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
      {isLoading ? <Skeleton className="h-80 rounded-xl" /> : data.length === 0 ? <EmptyState /> : (
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
                  <th className="px-4 py-3 text-right">الحالة</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr key={item.id} className="border-t border-border/30">
                    <td className="px-4 py-3"><div>{item.koshaName ?? "-"}</div>{item.packageName ? <div className="mt-1 text-xs font-semibold text-primary">{item.packageName}</div> : null}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{item.customerName}</div>
                      {(item.brideName || item.groomName) && <div className="text-xs text-muted-foreground">{[item.brideName, item.groomName].filter(Boolean).join(" و ")}</div>}
                    </td>
                    <td className="px-4 py-3" dir="ltr">{item.phone}</td>
                    <td className="px-4 py-3">{item.eventDate || "-"} {item.eventTime || ""}</td>
                    <td className="px-4 py-3 font-bold text-primary">{koshaBookingTotal(item.bookingDetails) ? formatCurrency(koshaBookingTotal(item.bookingDetails) ?? 0) : "-"}</td>
                    <td className="px-4 py-3">
                      <div className="max-w-64 text-xs leading-6 text-muted-foreground">
                        {[item.eventType, item.serviceLevel, item.venueType, item.themeColor].filter(Boolean).join(" · ") || "-"}
                        <br />
                        {[item.province, item.area || item.cityArea, item.nearestPoint].filter(Boolean).join(" - ")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={item.status} onChange={(event) => update.mutate({ id: item.id, values: { status: event.target.value } })} className="rounded-lg border border-border/40 bg-background px-2 py-1 text-xs">
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(item)} className="gap-1"><Edit2 className="h-3.5 w-3.5" /> تعديل</Button>
                        <Button size="sm" variant="outline" onClick={() => printBooking(item)} className="gap-1"><Printer className="h-3.5 w-3.5" /> طباعة</Button>
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
    </div>
  );
}

function EditKoshaBookingModal({ booking, onClose, onSaved }: { booking: KoshaBooking; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [previewReady, setPreviewReady] = useState(false);
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
    paidAmount: String(booking.paidAmount ?? 0),
    paymentStatus: booking.paymentStatus ?? "unpaid",
  });
  useEffect(() => setPreviewReady(false), [form]);
  const { data: koshas = [] } = useQuery<Kosha[]>({ queryKey: ["admin", "koshas", "booking-editor"], queryFn: () => adminFetch("/admin/koshas") });
  const { data: options } = useQuery<{ addons: KoshaOption[]; welcomeBoards: KoshaOption[]; accessories: KoshaOption[]; provinces: Array<{ id: number; name: string }> }>({
    queryKey: ["koshas", "options", "booking-editor"], queryFn: () => fetch("/api/koshas/options").then((response) => response.json()),
  });
  const save = useMutation({
    mutationFn: () => adminFetch(`/admin/kosha-bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({ ...form, paidAmount: Number(form.paidAmount || 0) }) }),
    onSuccess: () => { toast({ title: "تم حفظ تعديل حجز الكوشة" }); onSaved(); },
    onError: (error: any) => toast({ title: "تعذر حفظ التعديل", description: error?.message, variant: "destructive" }),
  });
  const chosenKosha = koshas.find((item) => item.id === Number(form.koshaId));
  const optionTotal = [
    ...(options?.addons ?? []).filter((item) => form.selectedAddons.includes(item.name)),
    ...(options?.welcomeBoards ?? []).filter((item) => form.welcomeBoards.includes(item.name)),
    ...(options?.accessories ?? []).filter((item) => form.selectedAccessories.includes(item.name)),
  ].reduce((sum, item) => sum + Number(item.price ?? 0), 0);
  const packageSelectionsUnchanged = Boolean(booking.packageId)
    && Number(form.koshaId) === Number(booking.koshaId)
    && JSON.stringify(form.selectedAddons) === JSON.stringify(booking.selectedAddons)
    && JSON.stringify(form.welcomeBoards) === JSON.stringify(booking.welcomeBoards)
    && JSON.stringify(form.selectedAccessories) === JSON.stringify(booking.selectedAccessories);
  const projectedTotal = packageSelectionsUnchanged ? Number(booking.totalAmount) : Number(chosenKosha?.price ?? booking.totalAmount ?? 0) + optionTotal;

  function toggle(key: "selectedAddons" | "selectedAccessories", name: string) {
    setForm((current) => ({ ...current, [key]: current[key].includes(name) ? current[key].filter((item) => item !== name) : [...current[key], name] }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4" dir="rtl">
      <form onSubmit={(event) => { event.preventDefault(); if (!previewReady) { setPreviewReady(true); return; } save.mutate(); }} className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-2xl">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="المبلغ المدفوع" type="number" value={form.paidAmount} onChange={(value) => setForm({ ...form, paidAmount: value })} />
            <div><label className="mb-1 block text-xs text-muted-foreground">حالة الدفع</label><select value={form.paymentStatus} onChange={(event) => setForm({ ...form, paymentStatus: event.target.value })} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="unpaid">غير مدفوع</option><option value="partial">جزئي</option><option value="paid">مدفوع</option></select></div>
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
