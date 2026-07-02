import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Armchair, ChevronLeft, MapPin, CheckCircle2, Loader2, Video, Star, MessageCircle, Clock, LogIn } from "lucide-react";
import { usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { formatCurrency } from "@/lib/money";

const STAGES = [
  { key: "preparing", label: "قيد التجهيز" },
  { key: "out_of_warehouse", label: "خرجت من المخزن" },
  { key: "on_the_way", label: "في الطريق" },
  { key: "executing", label: "قيد التنفيذ" },
  { key: "executed", label: "تم التنفيذ" },
  { key: "delivered", label: "تم التسليم" },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const stageRank = (k: string) => Math.max(0, STAGES.findIndex((s) => s.key === k));
const isPendingPricing = (paymentStatus: string, totalAmount?: number) => paymentStatus === "pending_pricing" || Number(totalAmount ?? 0) <= 0;

type CBooking = { id: number; koshaName: string | null; eventDate: string; eventTime: string; eventType: string; executionStage: string; totalAmount: number; paidAmount: number; remainingAmount: number; paymentStatus: string };
type CDetail = CBooking & { koshaImage: string | null; customerName: string; province: string; area: string; cityArea: string; hallLocation: string; media: { id: number; url: string; kind: string }[]; stages: { stage: string; at: string }[]; confirmation: { confirmedAt: string; rating: number; note: string | null } | null };

async function cfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (res.status === 401) throw Object.assign(new Error("auth"), { auth: true });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? "تعذر التحميل");
  return res.json();
}

function LoginPrompt() {
  return (
    <div className="container mx-auto flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center" dir="rtl">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><Armchair className="h-8 w-8 text-primary" /></div>
      <h1 className="text-xl font-bold text-foreground">كوشاتي</h1>
      <p className="text-muted-foreground">سجّل الدخول لمتابعة حالة كوشاتك وصورها.</p>
      <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-bold text-primary-foreground"><LogIn className="h-4 w-4" /> تسجيل الدخول</Link>
    </div>
  );
}

export default function AccountKoshas() {
  const { data: settings } = usePublicSettings();
  const [list, setList] = useState<CBooking[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    cfetch<CBooking[]>("/customer/koshas")
      .then(setList)
      .catch((e: any) => { if (e?.auth) setNeedsLogin(true); setList([]); });
  }, []);

  if (needsLogin) return <LoginPrompt />;
  if (selected) return <KoshaDetail id={selected} onBack={() => setSelected(null)} whatsapp={settings?.whatsapp} />;

  return (
    <div className="container mx-auto min-h-dvh px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-foreground"><Armchair className="h-6 w-6 text-primary" /> كوشاتي</h1>
        {!list ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-border/30 bg-card py-16 text-center">
            <Armchair className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">لا توجد حجوزات كوشات على حسابك بعد.</p>
            <Link href="/koshas" className="mt-3 inline-block text-sm font-medium text-primary">تصفّح الكوشات</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((b) => (
              <button key={b.id} onClick={() => setSelected(b.id)} className="w-full rounded-xl border border-border/30 bg-card p-4 text-right transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-foreground"><Armchair className="h-4 w-4 text-primary" />{b.koshaName || "كوشة"}</div>
                    {b.eventDate && <div className="mt-0.5 text-xs text-muted-foreground">{b.eventDate} {b.eventTime}</div>}
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">{STAGE_LABEL[b.executionStage] ?? "—"}</span>
                </div>
                {isPendingPricing(b.paymentStatus, b.totalAmount) ? (
                  <div className="mt-2 text-xs font-medium text-primary">بانتظار تحديد السعر من الإدارة</div>
                ) : b.remainingAmount > 0 ? (
                  <div className="mt-2 text-xs font-medium text-destructive">متبقٍ: {formatCurrency(b.remainingAmount)}</div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KoshaDetail({ id, onBack, whatsapp }: { id: number; onBack: () => void; whatsapp?: string }) {
  const [d, setD] = useState<CDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    cfetch<CDetail>(`/customer/koshas/${id}`).then((x) => { setD(x); setRating(x.confirmation?.rating ?? 0); }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex min-h-[60dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (!d) return <div className="container mx-auto px-4 py-16 text-center text-muted-foreground" dir="rtl">الحجز غير موجود<div className="mt-3"><button onClick={onBack} className="text-primary">رجوع</button></div></div>;

  const current = d.executionStage;
  const lastUpdate = d.stages.length ? d.stages[d.stages.length - 1] : null;
  const waLink = whatsapp ? buildWhatsAppLink(whatsapp, `مرحباً، بخصوص كوشتي (${d.koshaName ?? "#" + d.id})`) : "";

  async function confirmReceipt() {
    setBusy(true);
    try { await cfetch(`/customer/koshas/${id}/confirm`, { method: "POST", body: JSON.stringify({ rating, note }) }); load(); }
    catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className="container mx-auto min-h-dvh px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-2xl space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> كوشاتي</button>

        <div className="overflow-hidden rounded-2xl border border-border/30 bg-card">
          {d.koshaImage && <img src={d.koshaImage} alt="" className="h-40 w-full object-cover" />}
          <div className="p-4">
            <h1 className="text-xl font-bold text-foreground">{d.koshaName || "كوشة"}</h1>
            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
              {d.eventDate && <div>{d.eventDate} {d.eventTime} {d.eventType && `· ${d.eventType}`}</div>}
              {(d.province || d.area || d.hallLocation) && <div className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[d.province, d.area, d.cityArea, d.hallLocation].filter(Boolean).join(" — ")}</div>}
            </div>
          </div>
        </div>

        {/* Live status */}
        <div className="rounded-2xl border border-border/30 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-foreground">حالة التنفيذ</h2>
            {lastUpdate && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {new Date(lastUpdate.at).toLocaleString("ar-IQ")}</span>}
          </div>
          <ol className="space-y-2">
            {STAGES.map((s, i) => {
              const done = i < stageRank(current); const cur = i === stageRank(current);
              return (
                <li key={s.key} className="flex items-center gap-2.5 text-sm">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${done ? "bg-status-success text-white" : cur ? "bg-primary text-primary-foreground" : "border-2 border-border"}`}>
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : cur ? "●" : ""}
                  </span>
                  <span className={done || cur ? "font-bold text-foreground" : "text-muted-foreground"}>{s.label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Crew media */}
        {d.media.length > 0 && (
          <div className="rounded-2xl border border-border/30 bg-card p-4">
            <h2 className="mb-2 font-bold text-foreground">صور ومقاطع التنفيذ</h2>
            <div className="grid grid-cols-3 gap-2">
              {d.media.map((m) => (
                <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-lg border border-border/30">
                  {m.kind === "video" ? <><video src={m.url} className="h-full w-full object-cover" muted /><Video className="absolute bottom-1 right-1 h-4 w-4 text-white drop-shadow" /></> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Payment */}
        <div className="rounded-2xl border border-border/30 bg-card p-4">
          <h2 className="mb-3 font-bold text-foreground">الدفع</h2>
          {isPendingPricing(d.paymentStatus, d.totalAmount) ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-center text-sm text-muted-foreground">بانتظار تحديد السعر من الإدارة</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[["الكلي", d.totalAmount], ["المدفوع", d.paidAmount], ["المتبقي", d.remainingAmount]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-muted/40 p-2">
                  <div className="text-[11px] text-muted-foreground">{l as string}</div>
                  <div className="text-sm font-bold text-foreground">{formatCurrency(v as number)}</div>
                </div>
              ))}
            </div>
          )}
          {!isPendingPricing(d.paymentStatus, d.totalAmount) && d.remainingAmount > 0 && waLink && (
            <a href={waLink} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-primary/40 py-2.5 text-sm font-bold text-primary">
              <MessageCircle className="h-4 w-4" /> تواصل بخصوص الدفع
            </a>
          )}
        </div>

        {/* Confirm receipt + rating (after delivery) */}
        {current === "delivered" && (
          <div className="rounded-2xl border border-border/30 bg-card p-4">
            {d.confirmation ? (
              <div className="text-center">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-status-success" />
                <p className="font-bold text-foreground">تم تأكيد الاستلام</p>
                {d.confirmation.rating > 0 && (
                  <div className="mt-1 flex justify-center gap-0.5 text-primary">
                    {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-4 w-4 ${n <= d.confirmation!.rating ? "fill-primary" : ""}`} />)}
                  </div>
                )}
              </div>
            ) : (
              <>
                <h2 className="font-bold text-foreground">تأكيد الاستلام والتقييم</h2>
                <div className="mt-3 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setRating(n)} aria-label={`تقييم ${n}`}><Star className={`h-7 w-7 ${n <= rating ? "fill-primary text-primary" : "text-muted-foreground"}`} /></button>
                  ))}
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="رأيك بالخدمة (اختياري)" rows={2} className="mt-3 w-full rounded-lg border border-border bg-background p-2 text-sm" />
                <button disabled={busy} onClick={confirmReceipt} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} تأكيد استلام الكوشة
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
