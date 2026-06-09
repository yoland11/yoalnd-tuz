import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Upload, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, fileToDataUrl } from "./_lib";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import type { ImageMetadata } from "@/lib/image-tools";
import { useToast } from "@/hooks/use-toast";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearancePreset,
  type AppearanceSettings,
  normalizeAppearanceSettings,
} from "@/lib/appearance";

type Settings = {
  siteName: string;
  logoUrl: string;
  logoMetadata?: ImageMetadata;
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
  appearanceSettings: AppearanceSettings;
};

type NotificationSettings = {
  pushEnabled: boolean;
  ordersEnabled: boolean;
  messagesEnabled: boolean;
  tasksEnabled: boolean;
  inventoryEnabled: boolean;
  customerEnabled: boolean;
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

const appearanceFields: Array<{ key: keyof AppearanceSettings; label: string }> = [
  { key: "background", label: "لون خلفية الموقع" },
  { key: "header", label: "لون الهيدر" },
  { key: "footer", label: "لون الفوتر" },
  { key: "sidebar", label: "لون القائمة الجانبية" },
  { key: "primaryButton", label: "لون الأزرار الأساسية" },
  { key: "secondaryButton", label: "لون الأزرار الثانوية" },
  { key: "headings", label: "لون العناوين" },
  { key: "text", label: "لون النصوص" },
  { key: "cards", label: "لون البطاقات" },
  { key: "links", label: "لون الروابط" },
  { key: "hover", label: "لون Hover" },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => adminFetch<Settings>("/admin/settings"),
  });
  const [form, setForm] = useState<Settings | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const { data: notificationSettings, isLoading: notificationsLoading } = useQuery({
    queryKey: ["admin", "notification-settings"],
    queryFn: () => adminFetch<NotificationSettings>("/admin/notifications/settings"),
  });

  useEffect(() => {
    if (data && !form) setForm({
      ...data,
      imageSettings: { ...defaultImageSettings, ...(data.imageSettings ?? {}) },
      appearanceSettings: normalizeAppearanceSettings(data.appearanceSettings),
    });
  }, [data, form]);

  const save = useMutation({
    mutationFn: (s: Settings) => adminFetch("/admin/settings", { method: "PATCH", body: JSON.stringify(s) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["settings", "public"] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    },
    onError: (err: any) => toast({ title: "تعذر حفظ الإعدادات", description: err?.message, variant: "destructive" }),
  });

  const saveNotificationSettings = useMutation({
    mutationFn: (settings: NotificationSettings) => adminFetch<NotificationSettings>("/admin/notifications/settings", { method: "PATCH", body: JSON.stringify(settings) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notification-settings"] });
      toast({ title: "تم حفظ إعدادات الإشعارات" });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ إعدادات الإشعارات", description: err?.message, variant: "destructive" }),
  });

  async function handleLogoResult(results: ImageEditResult[]) {
    const result = results[0];
    if (!result) return;
    try {
      const res = await adminFetch<{ logoUrl: string; logoMetadata?: ImageMetadata }>("/admin/settings/logo", {
        method: "POST",
        body: JSON.stringify({ logoUrl: result.dataUrl, logoMetadata: result.metadata }),
      });
      setForm(f => ({ ...f!, logoUrl: res.logoUrl, logoMetadata: res.logoMetadata ?? result.metadata }));
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["settings", "public"] });
      toast({ title: "تم تحديث الشعار" });
    } catch (err: any) {
      toast({ title: "تعذر رفع الشعار", description: err?.message, variant: "destructive" });
    }
  }
  async function handleQrUpload(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setForm(f => ({ ...f!, paymentQr: dataUrl }));
  }

  function applyAppearancePreset(preset: AppearancePreset) {
    if (!form || save.isPending) return;
    const nextForm = {
      ...form,
      appearanceSettings: normalizeAppearanceSettings(preset.settings),
    };
    setForm(nextForm);
    save.mutate(nextForm, {
      onSuccess: () => toast({ title: `تم تطبيق ستايل ${preset.name}` }),
    });
  }

  if (isLoading || !form) return <div className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;

  const activePresetId = APPEARANCE_PRESETS.find((preset) => appearanceEquals(form.appearanceSettings, preset.settings))?.id ?? "";

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
          <ImageUploadEditor
            kind="logo"
            label="رفع أو سحب اللوغو"
            currentImage={form.logoUrl}
            currentMetadata={form.logoMetadata}
            settings={form.imageSettings}
            watermarkText={form.siteName}
            onComplete={(results) => void handleLogoResult(results)}
            onRemove={() => setForm(f => ({ ...f!, logoUrl: "", logoMetadata: {} }))}
          />
          <div className="flex gap-2 items-center">
            <input value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl} onChange={e => setForm(f => ({ ...f!, logoUrl: e.target.value }))}
              placeholder="أو رابط URL"
              className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50 mt-2" />
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

      <Section title="مظهر الموقع">
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">ستايلات جاهزة</p>
            <p className="text-xs text-muted-foreground">اضغط على أي صورة ستايل لتطبيقها وحفظها مباشرة على الموقع.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {APPEARANCE_PRESETS.map((preset, index) => (
              <AppearancePresetCard
                key={preset.id}
                preset={preset}
                index={index + 1}
                selected={activePresetId === preset.id}
                disabled={save.isPending}
                onApply={() => applyAppearancePreset(preset)}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {appearanceFields.map((field) => (
            <ColorField
              key={field.key}
              label={field.label}
              value={form.appearanceSettings[field.key]}
              onChange={(value) => setForm(f => ({
                ...f!,
                appearanceSettings: normalizeAppearanceSettings({ ...f!.appearanceSettings, [field.key]: value }),
              }))}
            />
          ))}
        </div>
        <div
          className="rounded-xl border border-border/25 p-4 space-y-3"
          style={{ backgroundColor: form.appearanceSettings.background, color: form.appearanceSettings.text }}
        >
          <div className="rounded-lg border border-border/25 px-3 py-2" style={{ backgroundColor: form.appearanceSettings.header }}>
            <p className="text-sm font-semibold" style={{ color: form.appearanceSettings.headings }}>معاينة الهيدر والعناوين</p>
          </div>
          <div className="rounded-lg border border-border/25 p-3" style={{ backgroundColor: form.appearanceSettings.cards }}>
            <p className="text-sm font-semibold mb-2" style={{ color: form.appearanceSettings.headings }}>بطاقة تجربة</p>
            <p className="text-xs" style={{ color: form.appearanceSettings.text }}>هذه معاينة مباشرة للألوان قبل الحفظ.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: form.appearanceSettings.primaryButton, color: "#0A0A0A" }}>زر أساسي</span>
              <span className="rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: form.appearanceSettings.secondaryButton, color: form.appearanceSettings.text }}>زر ثانوي</span>
              <span className="rounded-lg px-3 py-2 text-xs font-medium" style={{ color: form.appearanceSettings.links }}>رابط</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setForm(f => ({ ...f!, appearanceSettings: DEFAULT_APPEARANCE_SETTINGS }))}
          >
            استعادة الألوان الافتراضية
          </Button>
        </div>
      </Section>

      <Section title="إعدادات الصور">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SliderField label="حجم صور المنتجات" value={form.imageSettings?.productMaxSize ?? 1600} min={512} max={3200} step={32} suffix="px" onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, productMaxSize: v } }))} />
          <SliderField label="حجم صور الخدمات" value={form.imageSettings?.serviceMaxSize ?? 1600} min={512} max={3200} step={32} suffix="px" onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, serviceMaxSize: v } }))} />
          <SliderField label="حجم صور المعرض" value={form.imageSettings?.galleryMaxSize ?? 1800} min={512} max={3200} step={32} suffix="px" onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, galleryMaxSize: v } }))} />
          <SliderField label="حجم اللوغو" value={form.imageSettings?.logoMaxSize ?? 600} min={160} max={1280} step={16} suffix="px" onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, logoMaxSize: v } }))} />
          <SliderField label="جودة الصور" value={form.imageSettings?.quality ?? 0.82} min={0.45} max={0.95} step={0.01} suffix="" onChange={v => setForm(f => ({ ...f!, imageSettings: { ...f!.imageSettings, quality: Math.min(0.95, Math.max(0.45, v)) } }))} />
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
            تفعيل علامة مائية باسم المحل
          </label>
        </div>
        <div className="rounded-xl bg-background/60 border border-border/25 p-4">
          <p className="text-xs text-muted-foreground mb-2">Preview</p>
          <div className="h-24 w-40 rounded-lg border border-border/30 bg-card overflow-hidden">
            {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full object-contain" /> : null}
          </div>
        </div>
      </Section>

      <NotificationSettingsSection
        settings={notificationSettings}
        isLoading={notificationsLoading}
        isSaving={saveNotificationSettings.isPending}
        onSave={(settings) => saveNotificationSettings.mutate(settings)}
      />
    </form>
  );
}

function NotificationSettingsSection({
  settings,
  isLoading,
  isSaving,
  onSave,
}: {
  settings?: NotificationSettings;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (settings: NotificationSettings) => void;
}) {
  const [draft, setDraft] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const current = draft ?? settings;

  return (
    <Section title="إعدادات الإشعارات">
      {isLoading || !current ? (
        <div className="space-y-2">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ToggleField label="تفعيل Push Notifications" checked={current.pushEnabled} onChange={(value) => setDraft({ ...current, pushEnabled: value })} />
            <ToggleField label="إشعارات الطلبات والحجوزات" checked={current.ordersEnabled} onChange={(value) => setDraft({ ...current, ordersEnabled: value })} />
            <ToggleField label="إشعارات الرسائل" checked={current.messagesEnabled} onChange={(value) => setDraft({ ...current, messagesEnabled: value })} />
            <ToggleField label="إشعارات المهام" checked={current.tasksEnabled} onChange={(value) => setDraft({ ...current, tasksEnabled: value })} />
            <ToggleField label="إشعارات المخزون" checked={current.inventoryEnabled} onChange={(value) => setDraft({ ...current, inventoryEnabled: value })} />
            <ToggleField label="إشعارات الزبائن" checked={current.customerEnabled} onChange={(value) => setDraft({ ...current, customerEnabled: value })} />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => onSave(current)}>
              {isSaving ? "جاري الحفظ..." : "حفظ إعدادات الإشعارات"}
            </Button>
          </div>
        </>
      )}
    </Section>
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

function AppearancePresetCard({
  preset,
  index,
  selected,
  disabled,
  onApply,
}: {
  preset: AppearancePreset;
  index: number;
  selected: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  const s = preset.settings;
  const palette = [s.background, s.cards, s.primaryButton, s.secondaryButton, s.headings];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onApply}
      className={`group overflow-hidden rounded-xl border bg-background text-right transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        selected ? "border-primary ring-1 ring-primary/40" : "border-border/30 hover:border-primary/45"
      }`}
      aria-pressed={selected}
    >
      <div
        className="relative h-28 border-b border-border/20"
        style={{
          background: `linear-gradient(135deg, ${s.background} 0%, ${s.cards} 55%, ${s.secondaryButton} 100%)`,
          color: s.text,
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `radial-gradient(circle at 18% 20%, ${s.primaryButton} 0, transparent 26%), radial-gradient(circle at 85% 75%, ${s.hover} 0, transparent 24%)` }} />
        <div className="relative flex h-full flex-col justify-between p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: s.primaryButton, color: readablePreviewText(s.primaryButton) }}>
              {String(index).padStart(2, "0")}
            </span>
            <div className="h-3 w-16 rounded-full" style={{ backgroundColor: s.header }} />
          </div>
          <div className="rounded-lg border p-2 shadow-sm" style={{ backgroundColor: s.cards, borderColor: `${s.primaryButton}55` }}>
            <div className="mb-2 h-2 w-20 rounded-full" style={{ backgroundColor: s.headings }} />
            <div className="mb-2 h-1.5 w-28 rounded-full opacity-70" style={{ backgroundColor: s.text }} />
            <div className="h-5 w-16 rounded-md" style={{ backgroundColor: s.primaryButton }} />
          </div>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{preset.name}</p>
            <p className="text-xs text-muted-foreground">{preset.description}</p>
          </div>
          {selected ? (
            <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-primary">مطبق</span>
          ) : null}
        </div>
        <div className="flex flex-row-reverse gap-1">
          {palette.map((color) => (
            <span
              key={`${preset.id}-${color}`}
              className="h-5 w-5 rounded-full border border-border/35"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </div>
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-background px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border/30 bg-transparent p-0"
          aria-label={label}
        />
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          dir="ltr"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
        />
      </div>
    </div>
  );
}

function appearanceEquals(a: AppearanceSettings, b: AppearanceSettings): boolean {
  const left = normalizeAppearanceSettings(a);
  const right = normalizeAppearanceSettings(b);
  return appearanceFields.every((field) => left[field.key] === right[field.key]);
}

function readablePreviewText(hex: string): string {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#101010" : "#FFFFFF";
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/25 bg-background/40 px-3 py-2 text-sm">
      <span className="text-foreground">{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-primary" />
    </label>
  );
}

function SliderField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void }) {
  const precision = step < 1 ? 2 : 0;
  return (
    <div className="rounded-lg border border-border/25 bg-background/40 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground">{label}</label>
        <span className="rounded-md border border-border/30 bg-card px-2 py-1 text-xs text-foreground">
          {value.toFixed(precision)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
