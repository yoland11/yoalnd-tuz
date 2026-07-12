import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Copy, Download, Eye, LayoutDashboard, Loader2, Palette, Plus, Printer, QrCode, Share2, Trash2, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage } from "./_lib";
import { EmptyState } from "./_layout";
import { generateQrDataUrl } from "./label-helpers";
import { InvitationCard, ANIMATION_STYLES, type InvitationData } from "../invite";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { usePublicSettings } from "@/lib/public-settings";

// Preset style templates — one-click apply of colours + font + animation.
const TEMPLATES: Array<{ name: string; category: string; bg: string; fg: string; font: string; anim: string }> = [
  { name: "ملكي", category: "Royal", bg: "#1b1130", fg: "#f3e9c9", font: "Amiri", anim: "glow" },
  { name: "فخم ذهبي", category: "Luxury", bg: "#0f0f12", fg: "#e9c46a", font: "Reem Kufi", anim: "zoom" },
  { name: "عصري", category: "Modern", bg: "#f4f6f8", fg: "#1f2937", font: "Tajawal", anim: "slide" },
  { name: "بسيط", category: "Minimal", bg: "#ffffff", fg: "#2a2118", font: "IBM Plex Sans Arabic", anim: "fade" },
  { name: "كلاسيكي", category: "Classic", bg: "#f7f1e8", fg: "#4a3b2a", font: "Amiri", anim: "fade" },
  { name: "إسلامي", category: "Islamic", bg: "#0d3b34", fg: "#e6d9a8", font: "Reem Kufi", anim: "glow" },
  { name: "ذهبي", category: "Gold", bg: "#faf6ec", fg: "#8a6d1f", font: "Amiri", anim: "float" },
  { name: "أسود", category: "Black", bg: "#111111", fg: "#f0f0f0", font: "Cairo", anim: "zoom" },
  { name: "أبيض", category: "White", bg: "#ffffff", fg: "#333333", font: "Tajawal", anim: "fade" },
  { name: "وردي", category: "Flowers", bg: "#fdeef2", fg: "#8a2846", font: "Amiri", anim: "float" },
  { name: "زجاجي", category: "Glass", bg: "#e8eef3", fg: "#274060", font: "Tajawal", anim: "zoom" },
  { name: "ثلاثي الأبعاد", category: "3D", bg: "#1a1a2e", fg: "#00d4ff", font: "Cairo", anim: "float" },
  { name: "أطفال", category: "Kids", bg: "#fff6e0", fg: "#ef6c57", font: "Tajawal", anim: "float" },
  { name: "شركات", category: "Corporate", bg: "#0e1726", fg: "#7aa2ff", font: "IBM Plex Sans Arabic", anim: "slide" },
  { name: "تخرّج", category: "Graduation", bg: "#0b132b", fg: "#e0b02c", font: "Reem Kufi", anim: "glow" },
];

type Card = InvitationData & { id: number; code?: string; status: string; views?: number; rsvpTotal?: number; confirmed?: number; companions?: number; customerPhone?: string | null; customerEmail?: string | null; bookingId?: number | null };
type Rsvp = { id: number; guestName: string; guestPhone: string | null; guestToken: string | null; attendanceStatus: string; companionsCount: number; guestMessage: string | null; viewedAt: string | null; respondedAt: string | null; createdAt: string };
type CardDetail = Card & { stats: { views: number; total: number; confirmed: number; declined: number; maybe: number; companions: number; noResponse: number }; rsvps: Rsvp[] };
type Widgets = { active: number; today: number; viewsTotal: number; newRsvpsToday: number; confirmedGuests: number; pendingGuests: number };

const TYPE_LABELS: Record<string, string> = {
  wedding: "زواج", engagement: "خطوبة", henna: "حنّة", graduation: "تخرّج", birthday: "عيد ميلاد",
  opening: "افتتاح", baby_shower: "استقبال مولود", conference: "مؤتمر", private: "مناسبة خاصة",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة", designing: "قيد التصميم", waiting_approval: "بانتظار موافقة الزبون", approved: "معتمدة",
  published: "منشورة", completed: "مكتملة", archived: "مؤرشفة",
};
const ARABIC_FONTS = ["Cairo", "Tajawal", "IBM Plex Sans Arabic", "Amiri", "Reem Kufi"];
const publicUrl = (slug?: string) => (slug ? `${window.location.origin}/invite/${slug}` : "");

export default function InvitationStudioPage() {
  const [match, params] = useRoute("/admin/invitations/:id");
  return match && params?.id ? <InvitationEditor id={Number(params.id)} /> : <InvitationList />;
}

function InvitationList() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ cards: Card[]; widgets?: Widgets }>({ queryKey: ["admin", "invitations"], queryFn: () => adminFetch("/admin/invitations") });
  const create = useMutation({
    mutationFn: () => adminFetch<Card>("/admin/invitations", { method: "POST", body: JSON.stringify({ type: "wedding" }) }),
    onSuccess: (card) => { queryClient.invalidateQueries({ queryKey: ["admin", "invitations"] }); navigate(`/admin/invitations/${card.id}`); },
    onError: (e: Error) => toast({ title: "تعذّر الإنشاء", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const cards = data?.cards ?? [];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">💌 استوديو الدعوات</h1>
          <p className="mt-1 text-sm text-muted-foreground">إنشاء وإدارة بطاقات الدعوات الإلكترونية وردود الضيوف.</p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending} className="gap-1.5">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} دعوة جديدة</Button>
      </div>

      {/* Command-Center widgets */}
      {data?.widgets && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {([["دعوات نشطة", data.widgets.active], ["دعوات اليوم", data.widgets.today], ["إجمالي المشاهدات", data.widgets.viewsTotal], ["ردود جديدة اليوم", data.widgets.newRsvpsToday], ["ضيوف مؤكدون", data.widgets.confirmedGuests], ["بانتظار الرد", data.widgets.pendingGuests]] as const).map(([l, v]) => (
            <div key={l} className="rounded-xl border border-border/30 bg-card p-3 text-center">
              <div className="text-xl font-extrabold text-primary">{Number(v).toLocaleString("ar-IQ")}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : cards.length === 0 ? <EmptyState message="لا توجد دعوات بعد — أنشئ أول دعوة." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.id} href={`/admin/invitations/${c.id}`} className="rounded-xl border border-border/30 bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-bold text-foreground">{[c.brideName, c.groomName].filter(Boolean).join(" و ") || c.eventName || "بدون عنوان"}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{TYPE_LABELS[c.type ?? "wedding"]} · {c.eventDate || "بلا تاريخ"}</div>
                </div>
                <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{STATUS_LABELS[c.status] ?? c.status}</span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {c.views ?? 0}</span>
                <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.confirmed ?? 0} مؤكد</span>
                <span>+{c.companions ?? 0} مرافق</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const FIELDS_KEYS: (keyof InvitationData)[] = ["brideName", "groomName", "eventName", "eventDate", "eventTime", "venueName", "venueAddress", "mapUrl", "welcomeMessage", "thankYouMessage", "mainImageUrl", "fontFamily", "textColor", "backgroundColor", "animationStyle"];

function InvitationEditor({ id }: { id: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"design" | "dashboard">("design");
  const [form, setForm] = useState<Card | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: publicSettings } = usePublicSettings();

  const { data, isLoading } = useQuery<CardDetail>({ queryKey: ["admin", "invitations", id], queryFn: () => adminFetch(`/admin/invitations/${id}`) });
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
  useEffect(() => { if (form?.slug) generateQrDataUrl(publicUrl(form.slug), 220).then(setQr).catch(() => {}); }, [form?.slug]);

  const patch = useMutation({
    mutationFn: (values: Partial<Card>) => adminFetch(`/admin/invitations/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "invitations", id] }),
  });
  // Debounced auto-save whenever the form changes.
  function setField<K extends keyof Card>(key: K, value: Card[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { patch.mutate({ [key]: value } as any); }, 800);
  }
  // Batch update (templates / image upload) — applied + saved immediately.
  function applyFields(values: Partial<Card>) {
    setForm((f) => (f ? { ...f, ...values } : f));
    patch.mutate(values);
  }
  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    applyFields({ backgroundColor: t.bg, textColor: t.fg, fontFamily: t.font, animationStyle: t.anim });
  }
  async function uploadFont(file: File) {
    if (file.size > 1_800_000) { toast({ title: "حجم الخط كبير (حتى ~1.7MB)", variant: "destructive" }); return; }
    const family = file.name.replace(/\.(woff2?|ttf|otf)$/i, "").replace(/[^\w؀-ۿ \-]/g, "").slice(0, 60) || "CustomFont";
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
    try {
      const out = await adminFetch<{ url: string; family: string }>(`/admin/invitations/${id}/upload-font`, { method: "POST", body: JSON.stringify({ dataUrl, family }) });
      applyFields({ customFontUrl: out.url, fontFamily: out.family });
      toast({ title: `تم رفع الخط: ${out.family}` });
    } catch (e: any) { toast({ title: "تعذّر رفع الخط", description: apiErrorMessage(e), variant: "destructive" }); }
  }

  const del = useMutation({
    mutationFn: () => adminFetch(`/admin/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "invitations"] }); window.history.back(); },
  });
  const duplicate = useMutation({
    mutationFn: () => adminFetch<Card>(`/admin/invitations/${id}/duplicate`, { method: "POST", body: "{}" }),
    onSuccess: (card) => { queryClient.invalidateQueries({ queryKey: ["admin", "invitations"] }); window.location.assign(`/admin/invitations/${card.id}`); },
    onError: (e: any) => toast({ title: "تعذّر النسخ", description: apiErrorMessage(e), variant: "destructive" }),
  });

  async function copyLink() { try { await navigator.clipboard.writeText(publicUrl(form?.slug)); toast({ title: "تم نسخ الرابط" }); } catch { toast({ title: "تعذّر النسخ", variant: "destructive" }); } }
  function downloadQr() { if (!qr) return; const a = document.createElement("a"); a.href = qr; a.download = `invitation-${form?.slug}.png`; a.click(); }
  async function share() {
    const url = publicUrl(form?.slug);
    if (navigator.share) { try { await navigator.share({ title: "دعوة", url }); } catch { /* cancelled */ } }
    else copyLink();
  }

  if (isLoading || !form) return <div className="space-y-4"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/admin/invitations" className="text-muted-foreground hover:text-foreground"><ArrowRight className="h-5 w-5" /></Link>
          <h1 className="text-xl font-bold text-foreground">💌 {[form.brideName, form.groomName].filter(Boolean).join(" و ") || "دعوة جديدة"}</h1>
          <span className="text-xs text-muted-foreground">{patch.isPending ? "جارٍ الحفظ…" : "محفوظ"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={publicUrl(form.slug)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1"><Eye className="h-4 w-4" /> معاينة عامة</Button></a>
          <Button size="sm" variant="outline" onClick={copyLink} className="gap-1"><Copy className="h-4 w-4" /> نسخ الرابط</Button>
          <Button size="sm" variant="outline" onClick={downloadQr} className="gap-1"><QrCode className="h-4 w-4" /> تحميل QR</Button>
          <Button size="sm" variant="outline" onClick={share} className="gap-1"><Share2 className="h-4 w-4" /> مشاركة</Button>
          <Button size="sm" variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending} className="gap-1"><Copy className="h-4 w-4" /> نسخ الدعوة</Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border/40">
        {([["design", "التصميم", Palette], ["dashboard", "لوحة الردود", LayoutDashboard]] as const).map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><Icon className="h-4 w-4" /> {l}</button>
        ))}
      </div>

      {tab === "design" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          {/* Editor form */}
          <div className="space-y-3 rounded-xl border border-border/30 bg-card p-4">
            <div>
              <div className="mb-1.5 text-xs font-semibold text-foreground">🎨 القوالب الجاهزة</div>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => {
                  const active = form.backgroundColor === t.bg && form.textColor === t.fg;
                  return (
                    <button key={t.name} type="button" onClick={() => applyTemplate(t)} title={t.category}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${active ? "border-primary ring-1 ring-primary" : "border-border/40 hover:border-primary/40"}`}>
                      <span className="h-4 w-4 rounded-full border" style={{ background: t.bg, borderColor: t.fg }} />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Fld label="نوع المناسبة"><select value={form.type ?? "wedding"} onChange={(e) => setField("type", e.target.value)} className={inp}>{Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
              <Fld label="الحالة"><select value={form.status} onChange={(e) => setField("status", e.target.value)} className={inp}>{Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
              <Fld label="اسم العروس"><input value={form.brideName ?? ""} onChange={(e) => setField("brideName", e.target.value)} className={inp} /></Fld>
              <Fld label="اسم العريس"><input value={form.groomName ?? ""} onChange={(e) => setField("groomName", e.target.value)} className={inp} /></Fld>
              <Fld label="اسم المناسبة (اختياري)"><input value={form.eventName ?? ""} onChange={(e) => setField("eventName", e.target.value)} className={inp} /></Fld>
              <Fld label="التاريخ"><input type="date" value={form.eventDate ?? ""} onChange={(e) => setField("eventDate", e.target.value)} className={inp} /></Fld>
              <Fld label="الوقت"><input value={form.eventTime ?? ""} onChange={(e) => setField("eventTime", e.target.value)} placeholder="7:00 مساءً" className={inp} /></Fld>
              <Fld label="اسم القاعة"><input value={form.venueName ?? ""} onChange={(e) => setField("venueName", e.target.value)} className={inp} /></Fld>
              <Fld label="عنوان القاعة"><input value={form.venueAddress ?? ""} onChange={(e) => setField("venueAddress", e.target.value)} className={inp} /></Fld>
              <Fld label="رابط الخريطة"><input value={form.mapUrl ?? ""} onChange={(e) => setField("mapUrl", e.target.value)} dir="ltr" className={inp} /></Fld>
              <Fld label="الصورة الرئيسية">
                <div className="flex items-center gap-2">
                  {form.mainImageUrl ? <img src={form.mainImageUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" /> : null}
                  <ImageUploadEditor kind="gallery" label="رفع صورة" currentImage={form.mainImageUrl ?? null} settings={publicSettings?.image_settings} watermarkText={publicSettings?.site_name} onComplete={(r: ImageEditResult[]) => r[0] && applyFields({ mainImageUrl: r[0].dataUrl })} onRemove={() => applyFields({ mainImageUrl: null })} />
                </div>
              </Fld>
            </div>
            <Fld label="صور إضافية (المعرض)">
              <div className="flex flex-wrap items-center gap-2">
                {(form.galleryImages ?? []).map((g, i) => (
                  <div key={i} className="relative">
                    <img src={g} alt="" className="h-12 w-12 rounded object-cover" />
                    <button type="button" onClick={() => applyFields({ galleryImages: (form.galleryImages ?? []).filter((_, xi) => xi !== i) })} className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-[10px] text-white">×</button>
                  </div>
                ))}
                <ImageUploadEditor kind="gallery" label="إضافة صورة" settings={publicSettings?.image_settings} watermarkText={publicSettings?.site_name} onComplete={(r: ImageEditResult[]) => r[0] && applyFields({ galleryImages: [...(form.galleryImages ?? []), r[0].dataUrl] })} />
              </div>
            </Fld>
            <Fld label="رسالة الترحيب"><textarea value={form.welcomeMessage ?? ""} onChange={(e) => setField("welcomeMessage", e.target.value)} rows={2} className={inp} /></Fld>
            <Fld label="رسالة الشكر (بعد الرد)"><textarea value={form.thankYouMessage ?? ""} onChange={(e) => setField("thankYouMessage", e.target.value)} rows={2} className={inp} /></Fld>
            <div className="grid gap-2 sm:grid-cols-3">
              <Fld label="الخط"><select value={form.fontFamily ?? "Cairo"} onChange={(e) => setField("fontFamily", e.target.value)} className={inp}>{ARABIC_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Fld>
              <Fld label="لون النص"><input type="color" value={form.textColor ?? "#2a2118"} onChange={(e) => setField("textColor", e.target.value)} className="h-10 w-full rounded-lg border border-border/40 bg-background" /></Fld>
              <Fld label="لون الخلفية"><input type="color" value={form.backgroundColor ?? "#f7f1e8"} onChange={(e) => setField("backgroundColor", e.target.value)} className="h-10 w-full rounded-lg border border-border/40 bg-background" /></Fld>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40">
                ⬆️ رفع خط مخصّص
                <input type="file" accept=".woff,.woff2,.ttf,.otf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFont(f); e.target.value = ""; }} />
              </label>
              {form.customFontUrl ? <span className="text-xs text-status-success">خط مخصّص مفعّل: {form.fontFamily}</span> : <span className="text-[11px] text-muted-foreground">woff/woff2/ttf/otf — حتى ~1.7MB</span>}
            </div>
            <Fld label="الحركة"><select value={form.animationStyle ?? "fade"} onChange={(e) => setField("animationStyle", e.target.value)} className={inp}>{ANIMATION_STYLES.map((a) => <option key={a} value={a}>{a}</option>)}</select></Fld>
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => confirm("حذف الدعوة؟") && del.mutate()} className="gap-1 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /> حذف الدعوة</Button>
            </div>
          </div>

          {/* Live preview */}
          <div className="lg:sticky lg:top-4 lg:h-fit">
            <div className="mb-2 text-xs text-muted-foreground">معاينة مباشرة</div>
            <div className="rounded-2xl bg-neutral-900 p-4">
              <InvitationCard data={form} qrDataUrl={qr} />
            </div>
          </div>
        </div>
      ) : (
        <InvitationDashboard detail={data!} />
      )}
    </div>
  );
}

const inp = "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60";
function Fld({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs text-muted-foreground">{label}<div className="mt-1">{children}</div></label>;
}

function InvitationDashboard({ detail }: { detail: CardDetail }) {
  const [search, setSearch] = useState("");
  const s = detail.stats;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (detail.rsvps ?? []).filter((r) => !q || [r.guestName, r.guestPhone].some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [detail.rsvps, search]);

  const ATT: Record<string, { t: string; c: string }> = {
    confirmed: { t: "مؤكد", c: "text-status-success" }, declined: { t: "معتذر", c: "text-destructive" },
    maybe: { t: "ربما", c: "text-status-warning" }, pending: { t: "لم يرد", c: "text-muted-foreground" },
  };

  function exportCsv() {
    const header = ["الاسم", "الهاتف", "الحالة", "المرافقون", "الرسالة", "تاريخ الرد"];
    const body = rows.map((r) => [r.guestName, r.guestPhone ?? "", ATT[r.attendanceStatus]?.t ?? r.attendanceStatus, r.companionsCount, r.guestMessage ?? "", r.respondedAt ? new Date(r.respondedAt).toLocaleString("ar-IQ") : ""]);
    const csv = [header, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" })); a.download = `rsvps-${detail.slug}.csv`; a.click();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {([["المشاهدات", s.views], ["تأكيدات", s.confirmed], ["اعتذارات", s.declined], ["ربما", s.maybe], ["لم يردّوا", s.noResponse], ["المرافقون", s.companions], ["إجمالي الردود", s.total]] as const).map(([l, v]) => (
          <div key={l} className="rounded-xl border border-border/30 bg-card p-3 text-center">
            <div className="text-xl font-extrabold text-foreground">{v}</div>
            <div className="text-[11px] text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف" className="min-w-48 flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" />
        <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1"><Download className="h-4 w-4" /> تصدير CSV</Button>
        <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1"><Printer className="h-4 w-4" /> طباعة القائمة</Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/30 bg-card">
        {rows.length === 0 ? <EmptyState message="لا توجد ردود بعد" /> : (
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-border/30 text-xs text-muted-foreground">{["الضيف", "الهاتف", "الحالة", "المرافقون", "الرسالة", "التاريخ"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/15">
                  <td className="px-3 py-2 font-medium text-foreground">{r.guestName}</td>
                  <td className="px-3 py-2 text-muted-foreground" dir="ltr">{r.guestPhone ?? "—"}</td>
                  <td className={`px-3 py-2 font-bold ${ATT[r.attendanceStatus]?.c ?? ""}`}>{ATT[r.attendanceStatus]?.t ?? r.attendanceStatus}</td>
                  <td className="px-3 py-2 text-center">{r.companionsCount}</td>
                  <td className="max-w-64 px-3 py-2 text-muted-foreground"><span className="line-clamp-2">{r.guestMessage ?? "—"}</span></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.respondedAt ? new Date(r.respondedAt).toLocaleDateString("ar-IQ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
