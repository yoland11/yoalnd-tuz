import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, PackageCheck, Plus, Save, Search, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { useToast } from "@/hooks/use-toast";
import { usePublicSettings } from "@/lib/public-settings";
import type { Kosha, KoshaOptionProduct, KoshaPackage } from "@/views/koshas";
import { adminFetch, formatCurrency } from "./_lib";

type PackageStats = {
  totalBookings: number;
  totalRevenue: number;
  bestSeller: { packageId: number; packageName: string; bookingCount: number; revenue: number; selectionRate: number } | null;
  packages: Array<{ packageId: number; packageName: string; bookingCount: number; revenue: number; selectionRate: number }>;
};

type PackageForm = {
  id?: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  oldPrice: number | null;
  mainImage: string;
  featuresText: string;
  badgeText: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  koshaIds: number[];
  defaultKoshaId: number | null;
  addonIds: number[];
  welcomeBoardIds: number[];
  accessoryIds: number[];
};

const EMPTY_FORM: PackageForm = {
  name: "",
  slug: "",
  description: "",
  price: 0,
  oldPrice: null,
  mainImage: "",
  featuresText: "",
  badgeText: "",
  isFeatured: false,
  isActive: true,
  sortOrder: 0,
  koshaIds: [],
  defaultKoshaId: null,
  addonIds: [],
  welcomeBoardIds: [],
  accessoryIds: [],
};

function fromPackage(item: KoshaPackage): PackageForm {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description ?? "",
    price: Number(item.configuredPrice ?? item.price ?? 0),
    oldPrice: item.oldPrice ?? null,
    mainImage: item.mainImage ?? "",
    featuresText: (item.features ?? []).join("\n"),
    badgeText: item.badgeText ?? "",
    isFeatured: item.isFeatured,
    isActive: item.isActive,
    sortOrder: item.sortOrder,
    koshaIds: item.koshas.map((entry) => entry.id),
    defaultKoshaId: item.defaultKosha?.id ?? null,
    addonIds: item.addons.map((entry) => entry.id),
    welcomeBoardIds: item.welcomeBoards.map((entry) => entry.id),
    accessoryIds: item.accessories.map((entry) => entry.id),
  };
}

function toggleId(ids: number[], id: number) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function OptionPicker({ title, items, selected, onToggle, single = false }: {
  title: string;
  items: Array<{ id: number; name: string; price?: number }>;
  selected: number[];
  onToggle: (id: number) => void;
  single?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-border/30 bg-background/45 p-2 sm:grid-cols-2">
        {items.map((item) => {
          const active = selected.includes(item.id);
          return (
            <button key={item.id} type="button" onClick={() => onToggle(item.id)} className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-right text-sm transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border/30 bg-card text-foreground hover:border-primary/40"}`}>
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="flex flex-shrink-0 items-center gap-2 text-xs">
                {Number(item.price ?? 0) > 0 ? <span className="text-muted-foreground">{formatCurrency(Number(item.price))}</span> : null}
                <span className={`grid h-5 w-5 place-items-center ${single ? "rounded-full" : "rounded"} border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{active ? <Check className="h-3 w-3" /> : null}</span>
              </span>
            </button>
          );
        })}
        {items.length === 0 ? <p className="p-3 text-center text-sm text-muted-foreground sm:col-span-2">لا توجد عناصر متاحة.</p> : null}
      </div>
    </div>
  );
}

export default function KoshaPackagesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const packagesQuery = useQuery({ queryKey: ["admin", "kosha-packages"], queryFn: () => adminFetch<KoshaPackage[]>("/admin/kosha-packages") });
  const statsQuery = useQuery({ queryKey: ["admin", "kosha-packages", "stats"], queryFn: () => adminFetch<PackageStats>("/admin/kosha-packages/stats") });
  const koshasQuery = useQuery({ queryKey: ["admin", "koshas"], queryFn: () => adminFetch<Kosha[]>("/admin/koshas") });
  const addonsQuery = useQuery({ queryKey: ["admin", "kosha-addons"], queryFn: () => adminFetch<KoshaOptionProduct[]>("/admin/kosha-addons") });
  const boardsQuery = useQuery({ queryKey: ["admin", "kosha-welcome-boards"], queryFn: () => adminFetch<KoshaOptionProduct[]>("/admin/kosha-welcome-boards") });
  const accessoriesQuery = useQuery({ queryKey: ["admin", "kosha-accessories"], queryFn: () => adminFetch<KoshaOptionProduct[]>("/admin/kosha-accessories") });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim(),
        features: form.featuresText.split("\n").map((item) => item.trim()).filter(Boolean),
        badgeText: form.badgeText.trim(),
        price: Number(form.price) || 0,
        oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
      };
      return adminFetch<KoshaPackage>(form.id ? `/admin/kosha-packages/${form.id}` : "/admin/kosha-packages", {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (item) => {
      setForm(fromPackage(item));
      queryClient.invalidateQueries({ queryKey: ["admin", "kosha-packages"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "kosha-packages", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["koshas", "packages"] });
      toast({ title: form.id ? "تم حفظ تعديلات الباقة" : "تم إنشاء الباقة بنجاح" });
    },
    onError: (error: any) => toast({ title: "تعذر حفظ الباقة", description: error?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminFetch<{ message: string }>(`/admin/kosha-packages/${id}`, { method: "DELETE" }),
    onSuccess: (result) => {
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({ queryKey: ["admin", "kosha-packages"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "kosha-packages", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["koshas", "packages"] });
      toast({ title: result.message || "تم حذف الباقة" });
    },
    onError: (error: any) => toast({ title: "تعذر حذف الباقة", description: error?.message, variant: "destructive" }),
  });

  const packages = packagesQuery.data ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase("ar");
  const filteredKoshas = useMemo(() => (koshasQuery.data ?? []).filter((item) => !normalizedSearch || `${item.name} ${item.slug}`.toLocaleLowerCase("ar").includes(normalizedSearch)), [koshasQuery.data, normalizedSearch]);
  const stats = statsQuery.data;

  function updateImage(results: ImageEditResult[]) {
    const image = results[0];
    if (image) setForm((current) => ({ ...current, mainImage: image.dataUrl }));
  }

  function setKosha(id: number) {
    setForm((current) => {
      const koshaIds = toggleId(current.koshaIds, id);
      return { ...current, koshaIds, defaultKoshaId: koshaIds.includes(current.defaultKoshaId ?? -1) ? current.defaultKoshaId : koshaIds[0] ?? null };
    });
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-foreground">إدارة الباقات</h1><p className="mt-1 text-sm text-muted-foreground">أنشئ باقات كوشات جاهزة واربط مكوّناتها بالسعر والتقارير.</p></div>
        <Button type="button" onClick={() => setForm({ ...EMPTY_FORM, sortOrder: packages.length * 10 + 10 })}><Plus className="ml-2 h-4 w-4" /> باقة جديدة</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border/30 bg-card p-4"><p className="text-xs text-muted-foreground">إجمالي الحجوزات</p><p className="mt-2 text-xl font-bold text-foreground">{stats?.totalBookings ?? 0}</p></div>
        <div className="rounded-xl border border-border/30 bg-card p-4"><p className="text-xs text-muted-foreground">إيرادات الباقات</p><p className="mt-2 text-xl font-bold text-primary">{formatCurrency(stats?.totalRevenue ?? 0)}</p></div>
        <div className="rounded-xl border border-border/30 bg-card p-4"><p className="text-xs text-muted-foreground">الأكثر حجزاً</p><p className="mt-2 truncate text-lg font-bold text-foreground">{stats?.bestSeller?.packageName || "لا توجد حجوزات"}</p></div>
        <div className="rounded-xl border border-border/30 bg-card p-4"><p className="text-xs text-muted-foreground">الباقات الفعالة</p><p className="mt-2 text-xl font-bold text-foreground">{packages.filter((item) => item.isActive).length}</p></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start">
        <aside className="rounded-xl border border-border/30 bg-card p-3">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-foreground">الباقات الحالية</h2><PackageCheck className="h-5 w-5 text-primary" /></div>
          {packagesQuery.isLoading ? <Skeleton className="h-52 rounded-lg" /> : packages.length === 0 ? <div className="rounded-lg border border-dashed border-border/40 bg-background/45 p-6 text-center"><PackageCheck className="mx-auto h-7 w-7 text-primary" /><p className="mt-3 font-semibold text-foreground">لا توجد باقات</p><p className="mt-1 text-xs text-muted-foreground">أنشئ أول باقة جاهزة للحجز.</p></div> : (
            <div className="space-y-2">
              {packages.map((item) => {
                const rowStats = stats?.packages.find((entry) => entry.packageId === item.id);
                return (
                  <button key={item.id} type="button" onClick={() => setForm(fromPackage(item))} className={`w-full rounded-lg border p-3 text-right transition-colors ${form.id === item.id ? "border-primary bg-primary/10" : "border-border/30 bg-background/45 hover:border-primary/40"}`}>
                    <div className="flex items-start justify-between gap-2"><span className="font-semibold text-foreground">{item.name}</span>{item.isFeatured ? <Star className="h-4 w-4 flex-shrink-0 text-primary" /> : null}</div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{rowStats?.bookingCount ?? 0} حجز</span><span>{formatCurrency(item.price)}</span></div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="rounded-xl border border-border/30 bg-card p-4 md:p-5">
          <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-bold text-foreground">{form.id ? "تعديل الباقة" : "إضافة باقة"}</h2><p className="mt-1 text-xs text-muted-foreground">السعر المدخل هو سعر الباقة النهائي. عند تركه صفراً يُحسب من المكوّنات.</p></div>{form.id ? <Button type="button" variant="ghost" size="icon" onClick={() => setForm(EMPTY_FORM)} aria-label="إغلاق التعديل"><X className="h-4 w-4" /></Button> : null}</div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">اسم الباقة</span><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">الرابط المختصر</span><Input dir="ltr" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} placeholder="يُولّد تلقائياً" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">سعر الباقة</span><Input type="number" min="0" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: Number(event.target.value) || 0 }))} /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">السعر القديم</span><Input type="number" min="0" value={form.oldPrice ?? ""} onChange={(event) => setForm((current) => ({ ...current, oldPrice: event.target.value ? Number(event.target.value) : null }))} /></label>
            <label className="space-y-1 md:col-span-2"><span className="text-xs text-muted-foreground">الوصف المختصر</span><Textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <label className="space-y-1 md:col-span-2"><span className="text-xs text-muted-foreground">المميزات، ميزة في كل سطر</span><Textarea rows={5} value={form.featuresText} onChange={(event) => setForm((current) => ({ ...current, featuresText: event.target.value }))} /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">نص الشارة</span><Input value={form.badgeText} onChange={(event) => setForm((current) => ({ ...current, badgeText: event.target.value }))} placeholder="الأكثر طلباً" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">ترتيب الظهور</span><Input type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))} /></label>
            <div className="space-y-2 md:col-span-2"><span className="text-xs text-muted-foreground">صورة الباقة</span><ImageUploadEditor kind="gallery" label="رفع صورة الباقة" currentImage={form.mainImage || null} settings={settings?.image_settings} watermarkText={settings?.site_name} onComplete={updateImage} onRemove={() => setForm((current) => ({ ...current, mainImage: "" }))} /></div>
          </div>

          <div className="my-5 border-t border-border/30" />
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-foreground">الكوشات داخل الباقة</h3><div className="relative w-full sm:w-64"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الكوشة أو الكود" className="pr-9" /></div></div>
              <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-border/30 bg-background/45 p-2 sm:grid-cols-2">
                {filteredKoshas.map((item) => {
                  const active = form.koshaIds.includes(item.id);
                  const isDefault = form.defaultKoshaId === item.id;
                  return <div key={item.id} className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 ${active ? "border-primary/60 bg-primary/10" : "border-border/30 bg-card"}`}><button type="button" onClick={() => setKosha(item.id)} className="flex min-w-0 flex-1 items-center gap-2 text-right"><span className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{active ? <Check className="h-3 w-3" /> : null}</span><span className="truncate text-sm text-foreground">{item.name}</span></button>{active ? <button type="button" onClick={() => setForm((current) => ({ ...current, defaultKoshaId: item.id }))} className={`rounded-full px-2 py-1 text-[11px] ${isDefault ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-primary"}`}>{isDefault ? "الافتراضية" : "اجعلها افتراضية"}</button> : null}</div>;
                })}
              </div>
            </div>
            <OptionPicker title="الخدمات الإضافية" items={addonsQuery.data ?? []} selected={form.addonIds} onToggle={(id) => setForm((current) => ({ ...current, addonIds: toggleId(current.addonIds, id) }))} />
            <OptionPicker title="بورد الترحيب (اختيار واحد)" items={boardsQuery.data ?? []} selected={form.welcomeBoardIds} single onToggle={(id) => setForm((current) => ({ ...current, welcomeBoardIds: current.welcomeBoardIds.includes(id) ? [] : [id] }))} />
            <OptionPicker title="الاكسسوارات" items={accessoriesQuery.data ?? []} selected={form.accessoryIds} onToggle={(id) => setForm((current) => ({ ...current, accessoryIds: toggleId(current.accessoryIds, id) }))} />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/30 pt-4">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 accent-primary" /> ظاهرة للزبائن</label>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={form.isFeatured} onChange={(event) => setForm((current) => ({ ...current, isFeatured: event.target.checked }))} className="h-4 w-4 accent-primary" /> الباقة المميزة</label>
            </div>
            <div className="flex gap-2">
              {form.id ? <Button type="button" variant="destructive" onClick={() => confirm("حذف الباقة؟ سيتم إيقافها فقط إذا كانت مرتبطة بحجوزات قديمة.") && remove.mutate(form.id!)} disabled={remove.isPending}><Trash2 className="ml-2 h-4 w-4" /> حذف</Button> : null}
              <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim() || form.koshaIds.length === 0}><Save className="ml-2 h-4 w-4" /> {save.isPending ? "جاري الحفظ..." : "حفظ الباقة"}</Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
