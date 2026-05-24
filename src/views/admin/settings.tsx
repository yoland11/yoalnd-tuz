import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Upload, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, compressImageFile, fileToDataUrl } from "./_lib";

type Settings = {
  siteName: string;
  logoUrl: string;
  phones: string[];
  social: { instagram: string; facebook: string; whatsapp: string };
  paymentQr: string;
  packagingFee: number;
  deliveryFee: number;
  deliveryTime: string;
  address: string;
  city: string;
  mapUrl: string;
  imageSettings: {
    productMaxSize: number;
    serviceMaxSize: number;
    galleryMaxSize: number;
    logoMaxSize: number;
    quality: number;
    cropRatio: string;
    compression: boolean;
    watermark: boolean;
  };
};

const defaultImageSettings: Settings["imageSettings"] = {
  productMaxSize: 1600,
  serviceMaxSize: 1600,
  galleryMaxSize: 1800,
  logoMaxSize: 600,
  quality: 0.82,
  cropRatio: "free",
  compression: true,
  watermark: false,
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => adminFetch<Settings>("/admin/settings"),
  });
  const [form, setForm] = useState<Settings | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (data && !form) setForm({ ...data, imageSettings: { ...defaultImageSettings, ...(data.imageSettings ?? {}) } });
  }, [data, form]);

  const save = useMutation({
    mutationFn: (s: Settings) => adminFetch("/admin/settings", { method: "PATCH", body: JSON.stringify(s) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["settings", "public"] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    },
  });

  async function handleLogoUpload(file: File) {
    const dataUrl = await compressImageFile(file, form?.imageSettings?.logoMaxSize ?? 600, form?.imageSettings?.quality ?? 0.82, {
      ...(form?.imageSettings ?? {}),
      watermarkText: form?.siteName,
    });
    const res = await adminFetch<{ logoUrl: string }>("/admin/settings/logo", {
      method: "POST",
      body: JSON.stringify({ logoUrl: dataUrl }),
    });
    setForm(f => ({ ...f!, logoUrl: res.logoUrl }));
    qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    qc.invalidateQueries({ queryKey: ["settings", "public"] });
  }
  async function handleQrUpload(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setForm(f => ({ ...f!, paymentQr: dataUrl }));
  }

  if (isLoading || !form) return <div className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;

  return (
    <form onSubmit={e => { e.preventDefault(); save.mutate(form); }} className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between sticky top-0 bg-background py-2 z-10">
        <h1 className="text-2xl font-bold text-foreground">إعدادات الموقع</h1>
        <Button type="submit" disabled={save.isPending} className="gap-2">
          <Save className="w-4 h-4" /> {save.isPending ? "جاري الحفظ..." : savedFlash ? "تم الحفظ ✓" : "حفظ التغييرات"}
        </Button>
      </div>

      <Section title="معلومات الموقع">
        <Field label="اسم الموقع" value={form.siteName} onChange={v => setForm(f => ({ ...f!, siteName: v }))} />
        <Field label="العنوان" value={form.address} onChange={v => setForm(f => ({ ...f!, address: v }))} />
        <Field label="المدينة / المحافظة" value={form.city ?? ""} onChange={v => setForm(f => ({ ...f!, city: v }))} />
        <Field label="رابط موقع المحل" value={form.mapUrl ?? ""} onChange={v => setForm(f => ({ ...f!, mapUrl: v }))} placeholder="https://maps.google.com/..." />
        <div>
          <label className="block text-xs text-muted-foreground mb-1">الشعار (Logo)</label>
          {form.logoUrl && <img src={form.logoUrl} alt="شعار" className="h-16 w-36 mb-2 rounded-lg bg-background/40 p-2 object-contain" />}
          <div className="flex gap-2 items-center">
            <label className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 cursor-pointer hover:bg-primary/20">
              <Upload className="w-3.5 h-3.5" /> رفع
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} className="hidden" />
            </label>
            <input value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl} onChange={e => setForm(f => ({ ...f!, logoUrl: e.target.value }))}
              placeholder="أو رابط URL"
              className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
          </div>
        </div>
      </Section>

      <Section title="أرقام الهاتف">
        <div className="space-y-2">
          {form.phones.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input value={p} onChange={e => setForm(f => ({ ...f!, phones: f!.phones.map((x, idx) => idx === i ? e.target.value : x) }))}
                className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
              <button type="button" onClick={() => setForm(f => ({ ...f!, phones: f!.phones.filter((_, idx) => idx !== i) }))}
                className="text-red-400 hover:bg-red-500/10 p-2 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm(f => ({ ...f!, phones: [...f!.phones, ""] }))}
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> إضافة رقم</button>
        </div>
      </Section>

      <Section title="السوشيال ميديا">
        <Field label="إنستغرام" value={form.social.instagram} onChange={v => setForm(f => ({ ...f!, social: { ...f!.social, instagram: v } }))} placeholder="https://instagram.com/..." />
        <Field label="فيسبوك" value={form.social.facebook} onChange={v => setForm(f => ({ ...f!, social: { ...f!.social, facebook: v } }))} placeholder="https://facebook.com/..." />
        <Field label="واتساب" value={form.social.whatsapp} onChange={v => setForm(f => ({ ...f!, social: { ...f!.social, whatsapp: v } }))} placeholder="https://wa.me/..." />
      </Section>

      <Section title="الدفع والتوصيل">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">QR الدفع</label>
          {form.paymentQr && <img src={form.paymentQr} alt="QR" className="h-32 mb-2 rounded-lg bg-white p-2" />}
          <div className="flex gap-2 items-center">
            <label className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 cursor-pointer hover:bg-primary/20">
              <Upload className="w-3.5 h-3.5" /> رفع QR
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleQrUpload(e.target.files[0])} className="hidden" />
            </label>
            <input value={form.paymentQr.startsWith("data:") ? "" : form.paymentQr} onChange={e => setForm(f => ({ ...f!, paymentQr: e.target.value }))}
              placeholder="أو رابط URL"
              className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
          </div>
        </div>
        <Field label="سعر التغليف (د.ع)" type="number" value={String(form.packagingFee)} onChange={v => setForm(f => ({ ...f!, packagingFee: parseFloat(v) || 0 }))} />
        <Field label="تكلفة التوصيل الافتراضية (د.ع)" type="number" value={String(form.deliveryFee)} onChange={v => setForm(f => ({ ...f!, deliveryFee: parseFloat(v) || 0 }))} />
        <Field label="مدة التوصيل" value={form.deliveryTime} onChange={v => setForm(f => ({ ...f!, deliveryTime: v }))} placeholder="مثلاً: 1-3 أيام" />
      </Section>

      <Section title="إعدادات الصور">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="حجم صور المنتجات" type="number" value={String(form.imageSettings?.productMaxSize ?? 1600)} onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, productMaxSize: parseInt(v) || 1600 } }))} />
          <Field label="حجم صور الخدمات" type="number" value={String(form.imageSettings?.serviceMaxSize ?? 1600)} onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, serviceMaxSize: parseInt(v) || 1600 } }))} />
          <Field label="حجم صور المعرض" type="number" value={String(form.imageSettings?.galleryMaxSize ?? 1800)} onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, galleryMaxSize: parseInt(v) || 1800 } }))} />
          <Field label="حجم اللوغو" type="number" value={String(form.imageSettings?.logoMaxSize ?? 600)} onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, logoMaxSize: parseInt(v) || 600 } }))} />
          <Field label="جودة الصور 0.45 - 0.95" type="number" value={String(form.imageSettings?.quality ?? 0.82)} onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, quality: Math.min(0.95, Math.max(0.45, parseFloat(v) || 0.82)) } }))} />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">نسبة القص</label>
            <select value={form.imageSettings?.cropRatio ?? "free"} onChange={e => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, cropRatio: e.target.value } }))}
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50">
              <option value="free">بدون قص</option>
              <option value="1:1">مربع 1:1</option>
              <option value="4:3">4:3</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.imageSettings?.compression !== false} onChange={e => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, compression: e.target.checked } }))} className="accent-primary" />
            تفعيل ضغط الصور
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.imageSettings?.watermark} onChange={e => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, watermark: e.target.checked } }))} className="accent-primary" />
            تفعيل watermark باسم المحل
          </label>
        </div>
        <div className="rounded-xl bg-background/60 border border-border/25 p-4">
          <p className="text-xs text-muted-foreground mb-2">Preview</p>
          <div className="h-24 w-40 rounded-lg border border-border/30 bg-card overflow-hidden">
            {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full object-contain" /> : null}
          </div>
        </div>
      </Section>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-xl border border-border/30 p-6 space-y-4">
      <h2 className="font-semibold text-foreground border-b border-border/20 pb-2">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
    </div>
  );
}
