import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Edit2, Eye, EyeOff, FileDown, Plus, Printer, Save, Trash2 } from "lucide-react";
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
  customerName: string;
  phone: string;
  eventDate: string;
  eventTime: string;
  cityArea: string;
  hallLocation: string;
  notes: string;
  status: string;
  internalNotes: string;
  createdAt: string;
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
      const payload = {
        ...form,
        accessories: Array.isArray(form.accessories) ? form.accessories : [],
        galleryImages: form.galleryImages.map((image, index) => ({ ...image, sortOrder: index })),
      };
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
  const isNew = location === "/admin/koshas/new";
  const isEdit = /\/admin\/koshas\/\d+\/edit$/.test(location);
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
    const header = ["الرقم", "الكوشة", "الزبون", "الهاتف", "التاريخ", "الوقت", "المنطقة", "الحالة"];
    const rows = data.map((item) => [item.id, item.koshaName ?? "", item.customerName, item.phone, item.eventDate, item.eventTime, item.cityArea, STATUS_LABELS[item.status] ?? item.status]);
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
      ["الكوشة", item.koshaName ?? "-"],
      ["الزبون", item.customerName],
      ["الهاتف", item.phone],
      ["التاريخ", item.eventDate],
      ["الوقت", item.eventTime],
      ["المنطقة", item.cityArea],
      ["الموقع", item.hallLocation],
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
                  <th className="px-4 py-3 text-right">الحالة</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr key={item.id} className="border-t border-border/30">
                    <td className="px-4 py-3">{item.koshaName ?? "-"}</td>
                    <td className="px-4 py-3">{item.customerName}</td>
                    <td className="px-4 py-3" dir="ltr">{item.phone}</td>
                    <td className="px-4 py-3">{item.eventDate || "-"} {item.eventTime || ""}</td>
                    <td className="px-4 py-3">
                      <select value={item.status} onChange={(event) => update.mutate({ id: item.id, values: { status: event.target.value } })} className="rounded-lg border border-border/40 bg-background px-2 py-1 text-xs">
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
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
    </div>
  );
}
