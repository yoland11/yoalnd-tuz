import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, CheckCircle2, ChevronLeft, MapPin, Phone, Upload, Loader2, AlertTriangle, Banknote, ImageIcon, Video } from "lucide-react";
import {
  STAGES, STAGE_LABEL, isKoshaPendingPricing, stageRank, money, mapsUrl, filesToMedia, staffApi,
  type BookingDetail, type StageKey, type MediaInput, type SetupItem,
} from "./lib";
import { isQueued } from "./offline";

const PURPOSE_LABEL: Record<string, string> = {
  execution: "التنفيذ", delivery: "التسليم", breakage: "كسر/فقدان", loss: "فقدان", signature: "توقيع",
};
const TYPE_LABEL: Record<string, string> = {
  stage: "تغيير مرحلة", media: "رفع وسائط", delivery: "تسليم",
  payment_request: "طلب تحصيل", payment_approved: "اعتماد التحصيل", payment_rejected: "رفض التحصيل", note: "ملاحظة",
};

function Banner({ kind, children }: { kind: "info" | "error" | "ok"; children: React.ReactNode }) {
  const c = kind === "error" ? "border-destructive/40 bg-destructive/10 text-destructive"
    : kind === "ok" ? "border-status-success/40 bg-status-success/10 text-status-success dark:text-status-success"
    : "border-primary/30 bg-primary/5 text-foreground";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

function MediaPicker({ media, setMedia, label }: { media: MediaInput[]; setMedia: (m: MediaInput[]) => void; label: string }) {
  const [busy, setBusy] = useState(false);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setBusy(true);
    try { setMedia([...media, ...(await filesToMedia(e.target.files))]); }
    finally { setBusy(false); e.target.value = ""; }
  }
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap gap-2">
        {media.map((m, i) => (
          <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
            {m.kind === "video"
              ? <video src={m.url} className="h-full w-full object-cover" muted />
              : <img src={m.url} alt="" className="h-full w-full object-cover" />}
            <button onClick={() => setMedia(media.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[11px] font-bold text-white">×</button>
          </div>
        ))}
        <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          <span className="text-[11px]">إضافة</span>
          <input type="file" accept="image/*,video/*" multiple capture="environment" className="hidden" onChange={onPick} />
        </label>
      </div>
    </div>
  );
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
  }, []);
  const pos = (e: React.PointerEvent) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const up = () => { if (drawing.current) { drawing.current = false; onChange(ref.current!.toDataURL("image/png")); } };
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); onChange(""); };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium">توقيع العميل (اختياري)</label>
        <button onClick={clear} className="text-xs text-muted-foreground underline">مسح</button>
      </div>
      <canvas ref={ref} width={320} height={120} className="w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
    </div>
  );
}

export default function StaffBookingDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "checklist" | "executed" | "delivered">(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setData(await staffApi.booking(id)); setErr(null); }
    catch (e: any) { setErr(e?.message ?? "تعذر تحميل الحجز"); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (err || !data) return <div className="p-6 text-center text-muted-foreground">{err ?? "غير موجود"}<div className="mt-3"><button onClick={onBack} className="text-primary underline">رجوع</button></div></div>;

  const b = data.booking;
  const setup = data.setup;
  const current = b.executionStage as StageKey;
  const next = STAGES[stageRank(current) + 1]?.key as StageKey | undefined;
  const pendingPay = data.paymentRequests.find((p) => p.status === "pending");
  const pendingPricing = isKoshaPendingPricing(b);

  async function run(fn: () => Promise<any>) {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await fn();
      if (isQueued(res)) { setNotice("تم الحفظ محليًا — سيُرفع تلقائيًا عند عودة الاتصال"); setPanel(null); }
      else { if (res && (res as any).booking) setData(res as BookingDetail); else await reload(); setPanel(null); }
    }
    catch (e: any) { setErr(e?.message ?? "تعذر إكمال العملية"); }
    finally { setBusy(false); }
  }

  function onAdvance() {
    if (!next) return;
    if (next === "out_of_warehouse") return setPanel("checklist");
    if (next === "executed") return setPanel("executed");
    if (next === "delivered") return setPanel("delivered");
    run(() => staffApi.setStage(id, next));
  }

  return (
    <div className="mx-auto max-w-xl pb-24">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button onClick={onBack} aria-label="رجوع"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{b.koshaName || "كوشة"}</div>
          <div className="truncate text-xs text-muted-foreground">{b.customerName} · #{b.id}</div>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{STAGE_LABEL[current]}</span>
      </div>

      <div className="space-y-4 p-4">
        {err && <Banner kind="error">{err}</Banner>}
        {notice && <Banner kind="ok">{notice}</Banner>}

        {/* Customer + event meta */}
        <div className="rounded-xl border border-border bg-card p-3 text-sm">
          <div className="grid grid-cols-2 gap-y-2">
            <div className="text-muted-foreground">العميل</div><div className="text-left font-medium">{b.customerName}</div>
            <div className="text-muted-foreground">الهاتف</div>
            <a href={`tel:${b.phone}`} className="inline-flex items-center justify-end gap-1 text-left font-medium text-primary"><Phone className="h-3.5 w-3.5" />{b.phone}</a>
            {b.eventDate && (<><div className="text-muted-foreground">تاريخ الحفل</div><div className="text-left font-medium">{b.eventDate} {b.eventTime}</div></>)}
            {b.eventType && (<><div className="text-muted-foreground">نوع الحفل</div><div className="text-left font-medium">{b.eventType}</div></>)}
            <div className="text-muted-foreground">العنوان</div>
            <div className="text-left font-medium">{[b.province, b.area, b.cityArea, b.hallLocation].filter(Boolean).join(" — ") || "—"}</div>
          </div>
          <a href={mapsUrl(b)} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-primary/40 py-2 text-sm font-medium text-primary">
            <MapPin className="h-4 w-4" /> فتح بالخرائط
          </a>
        </div>

        {/* Money */}
        {pendingPricing ? (
          <Banner kind="info">بانتظار تحديد السعر من الإدارة. تظهر لك تفاصيل التجهيز فقط.</Banner>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["الكلي", b.totalAmount], ["المدفوع", b.paidAmount], ["المتبقي", b.remainingAmount]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-muted/40 p-2">
                <div className="text-[11px] text-muted-foreground">{l as string}</div>
                <div className="text-sm font-bold">{money(v as number)}</div>
              </div>
            ))}
          </div>
        )}

        {/* تفاصيل تجهيز الكوشة */}
        {setup && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-3 text-sm font-bold">تفاصيل تجهيز الكوشة</div>

            {setup.package && (
              <div className="mb-3 flex gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
                <SetupThumb src={setup.package.image} alt={setup.package.name} onZoom={setLightbox} size="h-16 w-16" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">باقة</span><span className="truncate font-bold">{setup.package.name}</span></div>
                  {setup.package.contents.length > 0 ? <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{setup.package.contents.join(" · ")}</div> : null}
                </div>
              </div>
            )}

            {setup.kosha && (
              <div className="overflow-hidden rounded-xl border border-border">
                <button type="button" onClick={() => setup.kosha?.image && setLightbox(setup.kosha.image)} className="block w-full">
                  {setup.kosha.image ? <img src={setup.kosha.image} alt={setup.kosha.name} loading="lazy" decoding="async" className="h-48 w-full object-cover" /> : <SetupPlaceholder className="h-48" />}
                </button>
                <div className="p-3">
                  <div className="font-bold">{setup.kosha.name}</div>
                  {setup.kosha.specs.length > 0 ? <div className="mt-1.5 flex flex-wrap gap-1">{setup.kosha.specs.map((s, i) => <span key={i} className="rounded-full bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">{s}</span>)}</div> : null}
                </div>
              </div>
            )}

            <SetupGroup title="بورد الترحيب" items={setup.welcomeBoards} onZoom={setLightbox} showPrices={false} />
            <SetupGroup title="الخدمات الإضافية" items={setup.addons} onZoom={setLightbox} showPrices={false} />
            <SetupGroup title="الإكسسوارات" items={setup.accessories} onZoom={setLightbox} showPrices={false} />
          </div>
        )}

        {/* Stage stepper */}
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 text-sm font-bold">مراحل التنفيذ</div>
          <ol className="space-y-1.5">
            {STAGES.map((s, i) => {
              const done = i < stageRank(current); const cur = i === stageRank(current);
              return (
                <li key={s.key} className="flex items-center gap-2.5 text-sm">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${done ? "bg-status-success text-white" : cur ? "bg-primary text-primary-foreground" : "border-2 border-border"}`}>
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : cur ? "●" : ""}
                  </span>
                  <span className={done || cur ? "font-bold" : "text-muted-foreground"}>{s.label}</span>
                </li>
              );
            })}
          </ol>
          {next && !panel && (
            <button onClick={onAdvance} disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              الانتقال إلى: {STAGE_LABEL[next]}
            </button>
          )}
          {current === "delivered" && <Banner kind="ok">تم تسليم الكوشة بنجاح.</Banner>}
        </div>

        {/* Checklist before warehouse exit */}
        {panel === "checklist" && <ChecklistPanel booking={b} busy={busy} onCancel={() => setPanel(null)} onConfirm={(note) => run(() => staffApi.setStage(id, "out_of_warehouse", note))} />}

        {/* Mandatory media for executed */}
        {panel === "executed" && <ExecutedPanel busy={busy} onCancel={() => setPanel(null)} onSave={(media, note) => run(() => staffApi.setStage(id, "executed", note, media))} />}

        {/* Delivery form */}
        {panel === "delivered" && <DeliveryPanel busy={busy} onCancel={() => setPanel(null)} onSave={(payload) => run(() => staffApi.delivery(id, payload))} />}

        {/* Collect remaining */}
        {!pendingPricing && current === "delivered" && b.remainingAmount > 0 && (
          pendingPay
            ? <Banner kind="info"><AlertTriangle className="ml-1 inline h-4 w-4" /> طلب تحصيل {money(pendingPay.amount)} د.ع بانتظار موافقة المدير.</Banner>
            : <CollectPanel remaining={b.remainingAmount} busy={busy} onSubmit={(amount, note) => run(() => staffApi.collect(id, amount, note))} />
        )}

        {/* Payment requests history */}
        {data.paymentRequests.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 text-sm font-bold">سجل التحصيل</div>
            <div className="space-y-1.5 text-sm">
              {data.paymentRequests.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <span>{money(p.amount)} د.ع</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${p.status === "approved" ? "bg-status-success/15 text-status-success dark:text-status-success" : p.status === "rejected" ? "bg-destructive/15 text-destructive" : "bg-status-warning/15 text-status-warning"}`}>
                    {p.status === "approved" ? "معتمد" : p.status === "rejected" ? "مرفوض" : "بالانتظار"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Media gallery */}
        {data.media.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold"><ImageIcon className="h-4 w-4" /> المرفقات ({data.media.length})</div>
            <div className="grid grid-cols-4 gap-2">
              {data.media.map((m) => (
                <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-lg border border-border">
                  {m.kind === "video" ? <><video src={m.url} className="h-full w-full object-cover" muted /><Video className="absolute bottom-1 right-1 h-3.5 w-3.5 text-white drop-shadow" /></> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                  <span className="absolute bottom-0 inset-x-0 bg-black/50 text-center text-[11px] text-white">{PURPOSE_LABEL[m.purpose] ?? m.purpose}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 text-sm font-bold">السجل الزمني</div>
          {data.timeline.length === 0 ? <div className="text-sm text-muted-foreground">لا يوجد سجل بعد.</div> : (
            <ol className="space-y-2.5">
              {data.timeline.map((t) => (
                <li key={t.id} className="border-r-2 border-primary/40 pr-3 text-sm">
                  <div className="font-medium">
                    {TYPE_LABEL[t.type] ?? t.type}
                    {t.toStage && <> · {STAGE_LABEL[t.toStage] ?? t.toStage}</>}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.staffName || "—"} · {new Date(t.createdAt).toLocaleString("ar-IQ")}</div>
                  {t.note && <div className="mt-0.5 text-xs">{t.note}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-h-[88vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}

function SetupPlaceholder({ className = "" }: { className?: string }) {
  return <div className={`flex w-full items-center justify-center bg-muted/40 text-muted-foreground ${className}`}><ImageIcon className="h-6 w-6" /></div>;
}

function SetupThumb({ src, alt, onZoom, size }: { src: string | null; alt: string; onZoom: (s: string) => void; size: string }) {
  return src
    ? <button type="button" onClick={() => onZoom(src)} className={`flex-shrink-0 overflow-hidden rounded-lg border border-border ${size}`}><img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" /></button>
    : <div className={`flex flex-shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground ${size}`}><ImageIcon className="h-5 w-5" /></div>;
}

function SetupGroup({ title, items, onZoom, showPrices }: { title: string; items: SetupItem[]; onZoom: (s: string) => void; showPrices: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs font-bold text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-background">
            <button type="button" onClick={() => it.image && onZoom(it.image)} className="block w-full">
              {it.image ? <img src={it.image} alt={it.name} loading="lazy" decoding="async" className="h-24 w-full object-cover" /> : <SetupPlaceholder className="h-24" />}
            </button>
            <div className="p-2">
              <div className="truncate text-xs font-medium">{it.name}</div>
              {showPrices && it.price != null && it.price > 0 ? <div className="text-[11px] font-bold text-primary">{money(it.price)} د.ع</div> : null}
              {it.description ? <div className="truncate text-[11px] text-muted-foreground">{it.description}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelShell({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="rounded-xl border-2 border-primary/40 bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-bold">{title}</div>
        <button onClick={onCancel} className="text-sm text-muted-foreground">إلغاء</button>
      </div>
      {children}
    </div>
  );
}

function ChecklistPanel({ booking, busy, onCancel, onConfirm }: { booking: any; busy: boolean; onCancel: () => void; onConfirm: (note: string) => void }) {
  const items = [
    "الكوشة الأساسية",
    ...((booking.selectedAccessories as string[]) ?? []),
    ...((booking.selectedAddons as string[]) ?? []),
    ...((booking.welcomeBoards as string[]) ?? []),
  ];
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const allChecked = items.every((i) => checked[i]);
  return (
    <PanelShell title="قائمة تجهيز قبل الخروج من المخزن" onCancel={onCancel}>
      <div className="space-y-1.5">
        {items.map((i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} className="h-4 w-4 accent-primary" />
            {i}
          </label>
        ))}
      </div>
      <button disabled={!allChecked || busy} onClick={() => onConfirm(`تم تجهيز: ${items.join("، ")}`)}
        className="mt-3 w-full rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
        تأكيد التجهيز والخروج
      </button>
      {!allChecked && <div className="mt-1.5 text-center text-xs text-muted-foreground">أكّد جميع القطع للمتابعة</div>}
    </PanelShell>
  );
}

function ExecutedPanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (media: MediaInput[], note: string) => void }) {
  const [media, setMedia] = useState<MediaInput[]>([]);
  const [note, setNote] = useState("");
  return (
    <PanelShell title="تم التنفيذ — رفع صور/فيديو (إجباري)" onCancel={onCancel}>
      <MediaPicker media={media} setMedia={setMedia} label="صور أو فيديو التنصيب" />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" rows={2} className="mt-3 w-full rounded-lg border border-border bg-background p-2 text-sm" />
      <button disabled={media.length === 0 || busy} onClick={() => onSave(media, note)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} حفظ مرحلة التنفيذ
      </button>
      {media.length === 0 && <div className="mt-1.5 text-center text-xs text-muted-foreground">يجب رفع ملف واحد على الأقل</div>}
    </PanelShell>
  );
}

function DeliveryPanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (p: { hasLoss: boolean; hasBreakage: boolean; note?: string; media?: MediaInput[]; signature?: string; compensationAmount?: number }) => void }) {
  const [hasLoss, setHasLoss] = useState<boolean | null>(null);
  const [hasBreakage, setHasBreakage] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [media, setMedia] = useState<MediaInput[]>([]);
  const [signature, setSignature] = useState("");
  const [compensation, setCompensation] = useState("");
  const issue = hasLoss === true || hasBreakage === true;
  const answered = hasLoss !== null && hasBreakage !== null;
  const valid = answered && note.trim().length > 0 && media.length > 0;

  const YN = ({ label, value, set }: { label: string; value: boolean | null; set: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <button onClick={() => set(true)} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${value === true ? "bg-destructive text-white" : "border border-border"}`}>نعم</button>
        <button onClick={() => set(false)} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${value === false ? "bg-status-success text-white" : "border border-border"}`}>لا</button>
      </div>
    </div>
  );

  return (
    <PanelShell title="تم التسليم — نموذج إلزامي" onCancel={onCancel}>
      <div className="space-y-3">
        <YN label="هل يوجد فقدان؟" value={hasLoss} set={setHasLoss} />
        <YN label="هل يوجد كسر؟" value={hasBreakage} set={setHasBreakage} />
        <Banner kind="info">صور وملاحظة إجبارية لإثبات حالة التسليم (في الحالتين).</Banner>
        <MediaPicker media={media} setMedia={setMedia} label={issue ? "صور الفقدان/الكسر (إجباري)" : "صور التسليم (إجباري)"} />
        {issue && (
          <div>
            <label className="mb-1 block text-sm font-medium">قيمة التعويض (اختياري — تُضاف للمتبقي)</label>
            <input value={compensation} onChange={(e) => setCompensation(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0" className="w-full rounded-lg border border-border bg-background p-2 text-sm" />
          </div>
        )}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة التسليم (إجباري)" rows={2} className="w-full rounded-lg border border-border bg-background p-2 text-sm" />
        <SignaturePad onChange={setSignature} />
        <button disabled={!valid || busy}
          onClick={() => onSave({ hasLoss: !!hasLoss, hasBreakage: !!hasBreakage, note, media, signature: signature || undefined, compensationAmount: Number(compensation) || 0 })}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} تأكيد التسليم
        </button>
        {!answered && <div className="text-center text-xs text-muted-foreground">أجب على السؤالين للمتابعة</div>}
      </div>
    </PanelShell>
  );
}

function CollectPanel({ remaining, busy, onSubmit }: { remaining: number; busy: boolean; onSubmit: (amount: number, note: string) => void }) {
  const [amount, setAmount] = useState(String(remaining));
  const [note, setNote] = useState("");
  const val = Number(amount) || 0;
  return (
    <div className="rounded-xl border-2 border-primary/40 bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 font-bold"><Banknote className="h-4 w-4" /> المبلغ المتبقي على العميل</div>
      <div className="mb-3 rounded-lg bg-muted/40 p-2 text-center text-lg font-extrabold">{money(remaining)} د.ع</div>
      <label className="mb-1 block text-sm font-medium">قيمة المبلغ المستلم</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className="w-full rounded-lg border border-border bg-background p-2 text-center text-lg font-bold" />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" rows={2} className="mt-2 w-full rounded-lg border border-border bg-background p-2 text-sm" />
      <button disabled={busy || val <= 0 || val > remaining} onClick={() => onSubmit(val, note)}
        className="mt-3 w-full rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
        {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "تم استلام المبلغ"}
      </button>
      <div className="mt-1.5 text-center text-xs text-muted-foreground">يُرسل للمدير للموافقة — لا يُسجَّل المال إلا بعد الاعتماد</div>
    </div>
  );
}
