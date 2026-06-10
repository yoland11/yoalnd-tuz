import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Upload, X, Plus, Palette, RotateCcw, Check, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, fileToDataUrl } from "./_lib";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import type { ImageMetadata } from "@/lib/image-tools";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_APPEARANCE_SETTINGS, type AppearanceSettings, normalizeAppearanceSettings } from "@/lib/appearance";
import { THEME_PRESETS, matchPresetId, type ThemePreset } from "@/lib/theme-presets";
import { type SeasonalTheme, normalizeSeasonalThemes, findActiveSeason } from "@/lib/seasonal-themes";
import { cn } from "@/lib/utils";

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
  customThemes?: CustomTheme[];
  seasonalEnabled?: boolean;
  seasonalThemes?: SeasonalTheme[];
};

type CustomTheme = { id: string; label: string; colors: AppearanceSettings };

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
      customThemes: Array.isArray(data.customThemes)
        ? data.customThemes
            .filter((t) => t && typeof t.id === "string" && typeof t.label === "string")
            .map((t) => ({ id: t.id, label: t.label, colors: normalizeAppearanceSettings(t.colors) }))
        : [],
      seasonalEnabled: data.seasonalEnabled === true,
      seasonalThemes: normalizeSeasonalThemes(data.seasonalThemes),
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

  // تطبيق ثيم كامل فوراً مع حفظه في إعدادات النظام (يتحدّث الموقع بالكامل عبر نفس مسار حفظ المظهر الحالي)
  function persistTheme(appearance: AppearanceSettings, successTitle: string) {
    if (!form) return;
    const next: Settings = { ...form, appearanceSettings: normalizeAppearanceSettings(appearance) };
    setForm(next);
    save.mutate(next, { onSuccess: () => toast({ title: successTitle }) });
  }

  const applyThemePreset = (preset: ThemePreset) => persistTheme(preset.colors, `تم تطبيق الثيم: ${preset.label}`);
  const restoreDefaultTheme = () => persistTheme(DEFAULT_APPEARANCE_SETTINGS, "تمت استعادة الثيم الافتراضي");

  // حفظ الألوان الحالية كثيم مخصّص باسم يختاره المدير (يُخزَّن ضمن الإعدادات بلا أي migration)
  function saveCurrentAsCustomTheme() {
    if (!form) return;
    const name = window.prompt("اسم الثيم المخصّص:", `ثيمي ${(form.customThemes?.length ?? 0) + 1}`)?.trim();
    if (!name) return;
    const id = `custom-${Date.now().toString(36)}`;
    const colors = normalizeAppearanceSettings(form.appearanceSettings);
    const next: Settings = { ...form, customThemes: [...(form.customThemes ?? []), { id, label: name, colors }] };
    setForm(next);
    save.mutate(next, { onSuccess: () => toast({ title: `تم حفظ الثيم المخصّص: ${name}` }) });
  }

  function deleteCustomTheme(id: string) {
    if (!form) return;
    const next: Settings = { ...form, customThemes: (form.customThemes ?? []).filter((t) => t.id !== id) };
    setForm(next);
    save.mutate(next, { onSuccess: () => toast({ title: "تم حذف الثيم المخصّص" }) });
  }

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

  if (isLoading || !form) return <div className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;

  const customThemes = form.customThemes ?? [];
  const customPresets: ThemePreset[] = customThemes.map((t) => ({ id: t.id, name: t.label, label: t.label, colors: t.colors }));
  const allPresets: ThemePreset[] = [...THEME_PRESETS, ...customPresets];
  const normalizedCurrent = JSON.stringify(normalizeAppearanceSettings(form.appearanceSettings));
  const activeThemeId =
    matchPresetId(form.appearanceSettings) ??
    customThemes.find((t) => JSON.stringify(normalizeAppearanceSettings(t.colors)) === normalizedCurrent)?.id ??
    null;

  const presetIdForColors = (colors: AppearanceSettings): string => {
    const norm = JSON.stringify(normalizeAppearanceSettings(colors));
    return allPresets.find((p) => JSON.stringify(normalizeAppearanceSettings(p.colors)) === norm)?.id ?? "";
  };

  const seasonalThemes = form.seasonalThemes ?? [];
  const activeSeason = form.seasonalEnabled ? findActiveSeason(seasonalThemes) : null;
  const updateSeasons = (next: SeasonalTheme[]) => setForm((f) => (f ? { ...f, seasonalThemes: next } : f));
  const addSeason = () =>
    updateSeasons([
      ...seasonalThemes,
      { id: `season-${Date.now().toString(36)}`, label: "موسم جديد", start: "", end: "", enabled: true, colors: normalizeAppearanceSettings(form.appearanceSettings) },
    ]);
  const patchSeason = (id: string, patch: Partial<SeasonalTheme>) =>
    updateSeasons(seasonalThemes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSeason = (id: string) => updateSeasons(seasonalThemes.filter((s) => s.id !== id));

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
              className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-2" />
          </div>
        </div>
      </Section>

      <Section title="أرقام الهاتف">
        <div className="space-y-2">
          {form.phones.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input value={p} onChange={e => setForm(f => ({ ...f!, phones: f!.phones.map((x, idx) => idx === i ? e.target.value : x) }))}
                className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <button type="button" onClick={() => setForm(f => ({ ...f!, phones: f!.phones.filter((_, idx) => idx !== i) }))}
                className="text-status-danger hover:bg-status-danger/10 p-2 rounded-lg"><X className="w-4 h-4" /></button>
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
              className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
        </div>
        <Field label="سعر التغليف (د.ع)" type="number" value={String(form.packagingFee)} onChange={v => setForm(f => ({ ...f!, packagingFee: parseFloat(v) || 0 }))} />
        <Field label="تكلفة التوصيل الافتراضية (د.ع)" type="number" value={String(form.deliveryFee)} onChange={v => setForm(f => ({ ...f!, deliveryFee: parseFloat(v) || 0 }))} />
        <Field label="مدة التوصيل" value={form.deliveryTime} onChange={v => setForm(f => ({ ...f!, deliveryTime: v }))} placeholder="مثلاً: 1-3 أيام" />
      </Section>

      <Section title="مظهر الموقع">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">الثيمات الجاهزة</h3>
              <span className="text-[11px] text-muted-foreground">(Theme Presets)</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={save.isPending}
              onClick={restoreDefaultTheme}
            >
              <RotateCcw className="w-3.5 h-3.5" /> استعادة الثيم الافتراضي
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            اختر ثيماً جاهزاً ليُطبَّق فوراً على الموقع بالكامل ولوحة الإدارة ويُحفظ تلقائياً. كل بطاقة تعرض ألوان الثيم قبل تطبيقه، ويمكنك بعدها تخصيص أي لون يدوياً بالأسفل.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {THEME_PRESETS.map((preset) => (
              <ThemePresetCard
                key={preset.id}
                preset={preset}
                active={activeThemeId === preset.id}
                disabled={save.isPending}
                onSelect={() => applyThemePreset(preset)}
              />
            ))}
            {customPresets.map((preset) => (
              <ThemePresetCard
                key={preset.id}
                preset={preset}
                active={activeThemeId === preset.id}
                disabled={save.isPending}
                onSelect={() => applyThemePreset(preset)}
                onDelete={() => deleteCustomTheme(preset.id)}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-border/20 pt-4">
          <p className="text-xs text-muted-foreground mb-3">تخصيص يدوي للألوان</p>
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
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={save.isPending}
            onClick={saveCurrentAsCustomTheme}
          >
            <Plus className="w-4 h-4" /> حفظ الألوان كثيم مخصّص
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setForm(f => ({ ...f!, appearanceSettings: DEFAULT_APPEARANCE_SETTINGS }))}
          >
            استعادة الألوان الافتراضية
          </Button>
        </div>

        <div className="border-t border-border/20 pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">الثيمات الموسمية</h3>
              {activeSeason && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-px text-[10px] text-primary">نشط الآن: {activeSeason.label}</span>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={!!form.seasonalEnabled}
                onChange={(e) => setForm(f => (f ? { ...f, seasonalEnabled: e.target.checked } : f))}
                className="accent-primary"
              />
              تفعيل تلقائي حسب التاريخ
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            أضف مواسم بفترات تاريخية (رمضان، العيد…) ليتحوّل الموقع لثيمها تلقائياً خلال الفترة ثم يعود للثيم الأساسي. لا تنسَ الضغط على «حفظ التغييرات» بالأعلى.
          </p>

          {seasonalThemes.length === 0 && (
            <p className="rounded-lg border border-dashed border-border/40 px-3 py-3 text-center text-xs text-muted-foreground">لا توجد مواسم بعد.</p>
          )}

          <div className="space-y-2">
            {seasonalThemes.map((season) => {
              const isActive = !!form.seasonalEnabled && !!findActiveSeason([season]);
              const selectedId = presetIdForColors(season.colors);
              return (
                <div key={season.id} className={cn("rounded-xl border p-3 space-y-2", isActive ? "border-primary/50" : "border-border/30")}>
                  <div className="flex items-center gap-2">
                    <input
                      value={season.label}
                      onChange={(e) => patchSeason(season.id, { label: e.target.value })}
                      placeholder="اسم الموسم"
                      className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    {isActive && <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-px text-[10px] text-primary">نشط</span>}
                    <button type="button" onClick={() => removeSeason(season.id)} className="text-status-danger hover:bg-status-danger/10 p-2 rounded-lg" aria-label="حذف الموسم">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">من تاريخ</label>
                      <input type="date" value={season.start} onChange={(e) => patchSeason(season.id, { start: e.target.value })} dir="ltr" className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">إلى تاريخ</label>
                      <input type="date" value={season.end} onChange={(e) => patchSeason(season.id, { end: e.target.value })} dir="ltr" className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">الثيم</label>
                      <select
                        value={selectedId}
                        onChange={(e) => { const p = allPresets.find((x) => x.id === e.target.value); if (p) patchSeason(season.id, { colors: normalizeAppearanceSettings(p.colors) }); }}
                        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {selectedId === "" && <option value="">مخصّص (الحالي)</option>}
                        {allPresets.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input type="checkbox" checked={season.enabled} onChange={(e) => patchSeason(season.id, { enabled: e.target.checked })} className="accent-primary" /> مفعّل
                    </label>
                    <span className="flex items-center gap-1">
                      {[season.colors.background, season.colors.primaryButton, season.colors.cards, season.colors.links].map((c, i) => (
                        <span key={i} className="h-4 w-4 rounded-full border border-border/30" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addSeason}>
            <Plus className="w-3.5 h-3.5" /> إضافة موسم
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
              className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
        className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    </div>
  );
}

function ThemePresetCard({
  preset,
  active,
  disabled,
  onSelect,
  onDelete,
}: {
  preset: ThemePreset;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const c = preset.colors;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      title={preset.name}
      className={cn(
        "group relative rounded-xl border bg-card p-2.5 text-right transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
        active ? "border-primary ring-1 ring-primary/40" : "border-border/30 hover:border-primary/50",
      )}
    >
      {active && (
        <span className="absolute top-2 left-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
      {onDelete && (
        <span
          role="button"
          tabIndex={0}
          title="حذف الثيم المخصّص"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onDelete(); } }}
          className="absolute top-2 right-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/40 bg-background/80 text-muted-foreground hover:text-status-danger"
        >
          <X className="h-3 w-3" />
        </span>
      )}
      {/* معاينة ألوان الثيم قبل تطبيقه */}
      <div className="overflow-hidden rounded-lg border border-border/25" style={{ backgroundColor: c.background }}>
        <div className="px-2 py-1.5" style={{ backgroundColor: c.header }}>
          <div className="h-1.5 w-10 rounded-full" style={{ backgroundColor: c.headings }} />
        </div>
        <div className="p-2">
          <div className="rounded-md border p-2" style={{ backgroundColor: c.cards, borderColor: c.secondaryButton }}>
            <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: c.text, opacity: 0.7 }} />
            <div className="mt-1 h-1.5 w-2/3 rounded-full" style={{ backgroundColor: c.text, opacity: 0.4 }} />
            <div className="mt-2 flex items-center gap-1">
              <span className="h-3 w-8 rounded" style={{ backgroundColor: c.primaryButton }} />
              <span className="h-3 w-5 rounded" style={{ backgroundColor: c.secondaryButton }} />
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.links }} />
            </div>
          </div>
        </div>
      </div>
      {/* الاسم + عيّنات الألوان */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-xs font-medium text-foreground">{preset.label}</span>
          {onDelete && (
            <span className="shrink-0 rounded-full border border-border/40 px-1.5 py-px text-[9px] text-muted-foreground">مخصّص</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {[c.background, c.primaryButton, c.cards, c.links].map((color, i) => (
            <span key={i} className="h-3 w-3 rounded-full border border-border/30" style={{ backgroundColor: color }} />
          ))}
        </span>
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
