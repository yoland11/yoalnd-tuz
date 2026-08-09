import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, CheckCircle2, ChevronLeft, MapPin, Phone, Upload, Loader2, AlertTriangle, Banknote, ImageIcon, Video, RotateCcw, X } from "lucide-react";
import {
  WORKFLOW_STAGES, STAGE_LABEL, isKoshaPendingPricing, workflowStageRank, nextWorkflowStage, money, mapsUrl, staffApi,
  type BookingDetail, type StageKey, type MediaInput, type SetupItem,
} from "./lib";
import { isQueued } from "./offline";
import { LiveScanner } from "./live-scanner";
import { KoshaOperationsPanel } from "./operations";
import { fileToDataUrl, formatBytes, inspectImageFile } from "@/lib/image-tools";
import {
  ImageUploadError,
  uploadImageWithVariants,
  uploadProgressLabel,
  validateImageUpload,
  type ImageUploadProgress,
} from "@/lib/large-image-upload";

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

function Progress({ label, value }: { label: string; value: number }) {
  return <div>
    <div className="mb-1 flex items-center justify-between gap-2"><span className="text-muted-foreground">{label}</span><b className="tabular-nums">{value}%</b></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${value}%` }} /></div>
  </div>;
}

type UploadState = "queued" | "uploading" | "complete" | "error" | "cancelled";
type PendingMediaUpload = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "video";
  state: UploadState;
  progress?: ImageUploadProgress;
  error?: string;
  width?: number;
  height?: number;
  stored?: MediaInput;
  controller?: AbortController;
};

function uploadId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uploadFailureMessage(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "AbortError") return "تم إلغاء الرفع. يمكنك إعادة المحاولة دون اختيار الصورة من جديد.";
  if (cause instanceof ImageUploadError) return cause.message;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "انقطع الاتصال بالإنترنت. أعد المحاولة عند عودة الشبكة.";
  return cause instanceof Error && cause.message ? cause.message : "تعذر رفع الصورة إلى التخزين. حاول مرة أخرى.";
}

function MediaPicker({
  media,
  setMedia,
  label,
  imagesOnly = false,
  onUploadingChange,
}: {
  media: MediaInput[];
  setMedia: (next: MediaInput[] | ((current: MediaInput[]) => MediaInput[])) => void;
  label: string;
  imagesOnly?: boolean;
  onUploadingChange?: (value: boolean) => void;
}) {
  const [uploads, setUploads] = useState<PendingMediaUpload[]>([]);
  const uploadsRef = useRef<PendingMediaUpload[]>([]);
  const hasActiveUpload = uploads.some((upload) => upload.state === "queued" || upload.state === "uploading");

  useEffect(() => { uploadsRef.current = uploads; }, [uploads]);
  useEffect(() => { onUploadingChange?.(hasActiveUpload); }, [hasActiveUpload, onUploadingChange]);
  useEffect(() => () => {
    for (const upload of uploadsRef.current) {
      upload.controller?.abort();
      if (upload.previewUrl.startsWith("blob:")) URL.revokeObjectURL(upload.previewUrl);
    }
  }, []);

  const patchUpload = useCallback((id: string, patch: Partial<PendingMediaUpload>) => {
    setUploads((current) => current.map((upload) => upload.id === id ? { ...upload, ...patch } : upload));
  }, []);

  const startUpload = useCallback(async (entry: PendingMediaUpload) => {
    const controller = new AbortController();
    patchUpload(entry.id, { state: "uploading", error: undefined, progress: undefined, controller });
    try {
      if (entry.kind === "video") {
        // Video proof follows the existing small JSON-media flow. Field photos
        // use the resumable image path below, so a 40 MB image never enters JSON.
        if (entry.file.size > 7 * 1024 * 1024) throw new Error("حجم فيديو التوثيق كبير. ارفع صورة أو فيديو أصغر من 7 MB.");
        const stored: MediaInput = { url: await fileToDataUrl(entry.file), kind: "video" };
        setMedia((current) => [...current, stored]);
        patchUpload(entry.id, { state: "complete", stored, controller: undefined });
        return;
      }

      // Validate the actual signature as well as MIME/size before any request.
      await validateImageUpload(entry.file);
      const image = await inspectImageFile(entry.file);
      if (image.dataUrl.startsWith("blob:") && image.dataUrl !== entry.previewUrl) URL.revokeObjectURL(image.dataUrl);
      patchUpload(entry.id, { width: image.originalWidth ?? image.width, height: image.originalHeight ?? image.height });

      const stored = await uploadImageWithVariants(entry.file, {
        folder: "kosha/operations",
        signal: controller.signal,
        onProgress: (progress) => patchUpload(entry.id, { progress }),
      });
      const mediaItem: MediaInput = {
        url: stored.largeUrl,
        kind: "image",
        fileName: entry.file.name,
        fileSize: entry.file.size,
        mimeType: entry.file.type,
        width: image.originalWidth ?? image.width,
        height: image.originalHeight ?? image.height,
      };
      setMedia((current) => [...current, mediaItem]);
      patchUpload(entry.id, { state: "complete", stored: mediaItem, progress: { percent: 100, uploadedBytes: entry.file.size, totalBytes: entry.file.size, bytesPerSecond: 0, remainingSeconds: 0, phase: "complete" }, controller: undefined });
    } catch (cause) {
      const cancelled = cause instanceof DOMException && cause.name === "AbortError";
      patchUpload(entry.id, { state: cancelled ? "cancelled" : "error", error: uploadFailureMessage(cause), controller: undefined });
    }
  }, [patchUpload, setMedia]);

  async function queueFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (!selected.length || hasActiveUpload) return;
    const queued = selected.map((file): PendingMediaUpload => ({
      id: uploadId(),
      file,
      previewUrl: URL.createObjectURL(file),
      kind: file.type.startsWith("video/") ? "video" : "image",
      state: "queued",
    }));
    setUploads((current) => [...current, ...queued]);
    // Process a selected batch serially so mobile devices never generate image
    // variants for several 40 MB files at the same time.
    for (const entry of queued) await startUpload(entry);
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    event.target.value = "";
    if (files) void queueFiles(files);
  }

  function cancelUpload(id: string) {
    uploadsRef.current.find((upload) => upload.id === id)?.controller?.abort();
  }

  async function retryUpload(id: string) {
    const entry = uploadsRef.current.find((upload) => upload.id === id);
    if (entry && !hasActiveUpload) await startUpload(entry);
  }

  function removeUpload(id: string) {
    const entry = uploadsRef.current.find((upload) => upload.id === id);
    entry?.controller?.abort();
    if (entry?.stored) setMedia((current) => current.filter((item) => item.url !== entry.stored?.url));
    if (entry?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl);
    setUploads((current) => current.filter((upload) => upload.id !== id));
  }

  const accepted = imagesOnly
    ? "image/jpeg,image/png,image/webp"
    : "image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,video/*";

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="space-y-2">
        {uploads.map((upload) => (
          <div key={upload.id} className="overflow-hidden rounded-lg border border-border bg-background" aria-live="polite">
            <div className="flex gap-2 p-2">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                {upload.kind === "video"
                  ? <video src={upload.previewUrl} className="h-full w-full object-cover" muted />
                  : <img src={upload.previewUrl} alt={`معاينة ${upload.file.name}`} className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-medium">{upload.file.name}</div>
                <div className="mt-0.5 text-muted-foreground">
                  {formatBytes(upload.file.size)}{upload.width && upload.height ? ` · ${upload.width}×${upload.height}` : ""}
                </div>
                {upload.state === "uploading" && upload.progress && <>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className="text-primary">{upload.progress.percent}%</span><span className="truncate text-muted-foreground">{uploadProgressLabel(upload.progress)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary/15"><div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${upload.progress.percent}%` }} /></div>
                </>}
                {upload.state === "queued" && <div className="mt-2 text-muted-foreground">بانتظار بدء الرفع…</div>}
                {upload.state === "complete" && <div className="mt-2 inline-flex rounded-full bg-status-success/15 px-2 py-0.5 font-medium text-status-success">تم الرفع بنجاح</div>}
                {(upload.state === "error" || upload.state === "cancelled") && <div className="mt-2 text-destructive" role="alert">{upload.error}</div>}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {upload.state === "uploading" && <button type="button" onClick={() => cancelUpload(upload.id)} className="rounded-md border border-destructive/30 px-2 py-1 text-[11px] text-destructive">إلغاء</button>}
                {(upload.state === "error" || upload.state === "cancelled") && <button type="button" onClick={() => void retryUpload(upload.id)} disabled={hasActiveUpload} className="inline-flex items-center gap-1 rounded-md border border-primary/30 px-2 py-1 text-[11px] text-primary disabled:opacity-50"><RotateCcw className="h-3 w-3" />إعادة</button>}
                <button type="button" onClick={() => removeUpload(upload.id)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground"><X className="h-3 w-3" />إزالة</button>
              </div>
            </div>
          </div>
        ))}
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!hasActiveUpload) void queueFiles(event.dataTransfer.files);
          }}
          className={`flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary ${hasActiveUpload ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {hasActiveUpload ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          <span>{media.length || uploads.some((upload) => upload.state === "complete") ? "إضافة أو استبدال صورة" : "اختر صورة للتوثيق"}</span>
          <input type="file" accept={accepted} multiple disabled={hasActiveUpload} capture="environment" className="hidden" onChange={onPick} />
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
        <label className="text-sm font-medium">توقيع العميل (إلزامي قبل الإكمال)</label>
        <button onClick={clear} className="text-xs text-muted-foreground underline">مسح</button>
      </div>
      <canvas ref={ref} width={320} height={120} className="w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
    </div>
  );
}

export default function StaffBookingDetail({ id, source, onBack }: { id: number; source: "kosha" | "service"; onBack: () => void }) {
  const [data, setData] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "before-install" | "after-install" | "before-return" | "after-return" | "delivered">(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [operationsTab, setOperationsTab] = useState<"checklist" | "scan" | "damage">("checklist");
  const stageRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try { setData(await staffApi.booking(id, source)); setErr(null); }
    catch (e: any) { setErr(e?.message ?? "تعذر تحميل الحجز"); }
    finally { setLoading(false); }
  }, [id, source]);
  useEffect(() => { reload(); }, [reload]);

  if (loading) return <div className="flex min-h-[60dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (err || !data) return <div className="p-6 text-center text-muted-foreground">{err ?? "غير موجود"}<div className="mt-3"><button onClick={onBack} className="text-primary underline">رجوع</button></div></div>;

  const b = data.booking;
  const setup = data.setup;
  const current = b.executionStage as StageKey;
  const next = nextWorkflowStage(current);
  const pendingPay = data.paymentRequests.find((p) => p.status === "pending");
  const pendingPricing = isKoshaPendingPricing(b);
  const preparationPercent = current === "booked" ? 0 : workflowStageRank(current) >= workflowStageRank("ready") ? 100 : 50;
  const installationPercent = workflowStageRank(current) < workflowStageRank("executing") ? 0 : workflowStageRank(current) < workflowStageRank("executed") ? 50 : 100;
  const overallPercent = Math.round((workflowStageRank(current) / Math.max(1, WORKFLOW_STAGES.length - 1)) * 100);

  async function run(fn: () => Promise<any>) {
    if (busy) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await fn();
      if (isQueued(res)) { setNotice("تم الحفظ محليًا — سيُرفع تلقائيًا عند عودة الاتصال"); setPanel(null); }
      else {
        if (res && (res as any).booking) setData(res as BookingDetail); else await reload();
        setNotice("تم تحديث مرحلة التنفيذ بنجاح");
        setPanel(null);
        requestAnimationFrame(() => stageRef.current?.scrollIntoView({ block: "nearest" }));
      }
    }
    catch (e: any) {
      // A 409 means another request/device changed the row first. Re-read the
      // canonical booking so the worker never remains on a stale next action.
      if (e?.status === 409) await reload();
      setErr(e?.message ?? "تعذر إكمال العملية");
    }
    finally { setBusy(false); }
  }

  function onAdvance() {
    if (!next) return;
    if (next === "executing") return setPanel("before-install");
    if (next === "executed") return setPanel("after-install");
    if (next === "before_return") return setPanel("before-return");
    if (next === "returned") return setPanel("after-return");
    if (next === "delivered") return setPanel("delivered");
    run(() => staffApi.setStage(id, next, undefined, undefined, source));
  }

  return (
    <div className="mx-auto max-w-xl pb-24">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button onClick={onBack} aria-label="رجوع"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{b.departmentBadge || b.koshaName || "كوشة"}</div>
          <div className="truncate text-xs text-muted-foreground">{b.customerName} · #{b.id}</div>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{STAGE_LABEL[current]}</span>
      </div>

      <div className="space-y-4 p-4">
        {err && <Banner kind="error">{err}</Banner>}
        {notice && <Banner kind="ok">{notice}</Banner>}

        <section className="rounded-xl border border-border bg-card p-3" aria-label="تقدم التنفيذ">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-bold">حالة التنفيذ الآن</h2><p className="text-xs text-muted-foreground">{STAGE_LABEL[current]}{next ? ` · الإجراء التالي: ${STAGE_LABEL[next]}` : ""}</p></div>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{overallPercent}%</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Progress label="التحضير" value={preparationPercent} />
            <Progress label="التركيب" value={installationPercent} />
            <Progress label="الإجمالي" value={overallPercent} />
          </div>
        </section>

        {/* Customer + event meta */}
        <div className="rounded-xl border border-border bg-card p-3 text-sm">
          <div className="grid grid-cols-2 gap-y-2">
            <div className="text-muted-foreground">العميل</div><div className="text-left font-medium">{b.customerName}</div>
            <div className="text-muted-foreground">الهاتف</div>
            <a href={`tel:${b.phone}`} className="inline-flex items-center justify-end gap-1 text-left font-medium text-primary"><Phone className="h-3.5 w-3.5" />{b.phone}</a>
            {b.eventDate && (<><div className="text-muted-foreground">تاريخ الحفل</div><div className="text-left font-medium">{b.eventDate} {b.eventTime}</div></>)}
            {b.eventType && (<><div className="text-muted-foreground">نوع الحفل</div><div className="text-left font-medium">{b.eventType}</div></>)}
            {(b as any).primaryEmployeeName && (<><div className="text-muted-foreground">الموظف الأساسي</div><div className="text-left font-medium">{(b as any).primaryEmployeeName}</div></>)}
            {(b as any).assistantEmployeeName && (<><div className="text-muted-foreground">الموظف المساعد</div><div className="text-left font-medium">{(b as any).assistantEmployeeName}</div></>)}
            {b.assignedEmployees?.length ? (<><div className="text-muted-foreground">فريق التنفيذ</div><div className="text-left font-medium">{b.assignedEmployees.join("، ")}</div></>) : null}
            <div className="text-muted-foreground">العنوان</div>
            <div className="text-left font-medium">{[b.province, b.area, b.cityArea, b.hallLocation].filter(Boolean).join(" — ") || "—"}</div>
            {b.notes ? (<><div className="text-muted-foreground">الملاحظات</div><div className="text-left font-medium">{b.notes}</div></>) : null}
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
        <div ref={stageRef} className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 text-sm font-bold">مراحل التنفيذ</div>
          <ol className="space-y-1.5">
            {WORKFLOW_STAGES.map((s, i) => {
              const done = i < workflowStageRank(current); const cur = i === workflowStageRank(current);
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
          {next && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">الإجراء التالي متاح دائماً في الشريط السفلي: {STAGE_LABEL[next]}</p>}
          {current === "delivered" && <Banner kind="ok">تم تسليم الكوشة بنجاح.</Banner>}
        </div>

        <div className="scroll-mt-20">
          <KoshaOperationsPanel bookingId={id} source={source} activeTab={operationsTab} />
        </div>

        {/* Products & Assets — uses the canonical booking operations record shared with Admin. */}
        <ProductsAssetsSection id={id} source={source} />

        {/* Booking assets — QR checkout / return */}
        <AssetsSection id={id} source={source} />

        {panel === "before-install" && <StageMediaPanel title="قبل التركيب" label="ارفع صورة للموقع قبل بدء التركيب" busy={busy} onCancel={() => setPanel(null)} onSave={(media, note) => run(() => staffApi.setStage(id, "executing", note, media, source))} />}
        {panel === "after-install" && <StageMediaPanel title="بعد التركيب" label="ارفع صوراً أو فيديو بعد اكتمال التركيب" busy={busy} onCancel={() => setPanel(null)} onSave={(media, note) => run(() => staffApi.setStage(id, "executed", note, media, source))} />}
        {panel === "before-return" && <StageMediaPanel title="قبل الإرجاع" label="وثّق حالة المعدات قبل الفك والإرجاع" busy={busy} onCancel={() => setPanel(null)} onSave={(media, note) => run(() => staffApi.setStage(id, "before_return", note, media, source))} />}
        {panel === "after-return" && <StageMediaPanel title="بعد الإرجاع" label="وثّق المعدات بعد عودتها من الموقع" busy={busy} onCancel={() => setPanel(null)} onSave={(media, note) => run(() => staffApi.setStage(id, "returned", note, media, source))} />}

        {/* Delivery form */}
        {panel === "delivered" && <DeliveryPanel busy={busy} onCancel={() => setPanel(null)} onSave={(payload) => run(() => staffApi.delivery(id, payload, source))} />}

        {/* Collect remaining */}
        {source === "kosha" && !pendingPricing && current === "delivered" && b.remainingAmount > 0 && (
          pendingPay
            ? <Banner kind="info"><AlertTriangle className="ml-1 inline h-4 w-4" /> طلب تحصيل {money(pendingPay.amount)} د.ع بانتظار موافقة المدير.</Banner>
            : <CollectPanel remaining={b.remainingAmount} busy={busy} onSubmit={(amount, note) => run(() => staffApi.collect(id, amount, note, source))} />
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
          <img src={lightbox} alt="" className="max-h-[88dvh] max-w-full rounded-lg object-contain" />
        </div>
      )}
      {next && !panel && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 pb-safe backdrop-blur">
          <div className="mx-auto max-w-xl"><button onClick={onAdvance} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} الانتقال إلى: {STAGE_LABEL[next]}
          </button></div>
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

function StageMediaPanel({ title, label, busy, onCancel, onSave }: { title: string; label: string; busy: boolean; onCancel: () => void; onSave: (media: MediaInput[], note: string) => void }) {
  const [media, setMedia] = useState<MediaInput[]>([]);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  return (
    <PanelShell title={`${title} — توثيق (اختياري)`} onCancel={onCancel}>
      <MediaPicker media={media} setMedia={setMedia} label={label} onUploadingChange={setUploading} imagesOnly={title === "قبل الإرجاع"} />
      <p className="mt-2 text-center text-xs text-muted-foreground">يمكنك رفع صور لتوثيق العمل، أو المتابعة بدون رفع صور.</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" rows={2} className="mt-3 w-full rounded-lg border border-border bg-background p-2 text-sm" />
      <button disabled={busy || uploading} onClick={() => onSave(media, note)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
        {busy || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {uploading ? "جاري رفع التوثيق…" : media.length ? "حفظ التوثيق والمتابعة" : "المتابعة بدون صور"}
      </button>
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
  const valid = answered && note.trim().length > 0 && signature.length > 0;

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
        <Banner kind="info">يمكنك رفع صور للتوثيق عند التسليم، أو المتابعة بدون رفع صور.</Banner>
        <MediaPicker media={media} setMedia={setMedia} label={issue ? "صور الفقدان/الكسر (اختياري)" : "صور التسليم (اختياري)"} />
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
        {answered && !signature && <div className="text-center text-xs text-muted-foreground">توقيع العميل مطلوب لإكمال الحجز.</div>}
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

function ProductsAssetsSection({ id, source }: { id: number; source: "kosha" | "service" }) {
  const [items, setItems] = useState<Array<{ productId: number; name: string; imageUrl?: string | null; quantity?: number; warehouse?: string | null; checkedOut: boolean }>>([]);
  const [products, setProducts] = useState<Array<{ productId?: number | null; name: string; quantity: number; barcode?: string | null }>>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ productId: number; name: string; imageUrl: string | null }>>([]);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const r = await staffApi.assets(id, source); setItems(r.assets ?? []); setProducts(r.products ?? []); } catch { /* offline */ }
  }, [id, source]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try { const r = await staffApi.searchProducts(q); if (alive) setResults(r.products ?? []); } catch { /* ignore */ }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [search]);

  const linkedIds = new Set(items.map((i) => i.productId));

  function flash(ok: boolean, text: string) { setMsg({ ok, text }); if (ok) window.setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 2500); }

  async function add(productId?: number, code?: string) {
    setBusy(true);
    try { const r = await staffApi.linkAsset(id, { mode: "link", productId, code, quantity: 1 }, source); flash(true, `تمت إضافة ${r.name ?? ""}`); setSearch(""); setResults([]); await load(); }
    catch (e: any) { flash(false, String(e?.message ?? "").replace(/^HTTP\s+\d+:\s*/i, "") || "تعذّرت الإضافة"); } finally { setBusy(false); }
  }
  async function setQty(productId: number, quantity: number) {
    if (quantity < 1) return;
    setBusy(true);
    try { await staffApi.linkAsset(id, { mode: "setqty", productId, quantity }, source); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  }
  async function remove(productId: number) {
    setBusy(true);
    try { await staffApi.linkAsset(id, { mode: "unlink", productId }, source); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="text-sm font-bold">🛒 المنتجات والأصول</div>
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الباركود..." className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button type="button" onClick={() => setScan((s) => !s)} className="rounded-lg border border-border px-3 text-base" title="مسح لإضافة">📷</button>
      </div>
      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          {results.map((p) => (
            <button key={p.productId} type="button" disabled={busy || linkedIds.has(p.productId)} onClick={() => add(p.productId)}
              className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-primary/10 disabled:opacity-40">
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded bg-muted">📦</span>}
              <span className="flex-1 truncate">{p.name}</span>
              {linkedIds.has(p.productId) ? <span className="text-xs text-muted-foreground">مضاف ✓</span> : <span className="text-lg text-primary">＋</span>}
            </button>
          ))}
        </div>
      )}
      {scan && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
          <LiveScanner onDetect={(c) => add(undefined, c)} active={scan} />
          <button type="button" onClick={() => setScan(false)} className="mt-1 w-full rounded-lg border border-border py-1.5 text-xs">إغلاق الماسح</button>
        </div>
      )}
      {msg && <Banner kind={msg.ok ? "ok" : "error"}>{msg.text}</Banner>}
      {products.length > 0 && (
        <ul className="space-y-2">
          {products.map((product, index) => (
            <li key={`${product.productId ?? product.name}-${index}`} className="flex items-center justify-between rounded-lg border border-border/60 p-2 text-sm">
              <span className="min-w-0 truncate">{product.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{product.quantity} ×{product.barcode ? ` · ${product.barcode}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && products.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا توجد منتجات/أصول مرتبطة — أضِفها بالبحث أو المسح.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.productId} className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
              {a.imageUrl ? <img src={a.imageUrl} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded bg-muted">📦</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-[11px] text-muted-foreground">{a.warehouse ? `${a.warehouse} · ` : ""}{a.checkedOut ? "خارج المخزن" : "في المخزن"}</div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setQty(a.productId, (a.quantity ?? 1) - 1)} disabled={busy || (a.quantity ?? 1) <= 1} className="h-6 w-6 rounded border border-border text-sm disabled:opacity-40">−</button>
                <span className="w-6 text-center text-sm font-bold">{a.quantity ?? 1}</span>
                <button type="button" onClick={() => setQty(a.productId, (a.quantity ?? 1) + 1)} disabled={busy} className="h-6 w-6 rounded border border-border text-sm">＋</button>
              </div>
              <button type="button" onClick={() => remove(a.productId)} disabled={busy} className="rounded p-1 text-muted-foreground hover:text-destructive" title="إزالة">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type GateAsset = { productId: number; name: string; assetCode: string; imageUrl?: string | null; checkedOut: boolean };
type Pending = { productId: number; name: string; assetCode: string; status: string; imageUrl?: string | null; checkedOut: boolean };

export function AssetsSection({ id, source = "kosha" }: { id: number; source?: "kosha" | "service" }) {
  const [assets, setAssets] = useState<GateAsset[]>([]);
  const [mode, setMode] = useState<"checkout" | "return">("checkout");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<"none" | "broken" | "lost">("none");
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [managerApproval, setManagerApproval] = useState(false);

  const load = useCallback(async () => {
    try { const r = await staffApi.assets(id, source); setAssets(r.assets ?? []); } catch { /* offline / no assets */ }
  }, [id, source]);
  useEffect(() => { void load(); }, [load]);

  const total = assets.length;
  const doneCount = assets.filter((a) => (mode === "checkout" ? a.checkedOut : !a.checkedOut)).length;
  const allDone = total > 0 && doneCount >= total;

  async function onDetect(code: string) {
    if (busy || pending) return;
    setBusy(true); setMsg(null);
    try {
      const r = await staffApi.scanAsset(id, { mode: "resolve", code }, source);
      if (mode === "checkout" && r.checkedOut) { setMsg({ ok: false, text: `${r.name}: مُخرَج مسبقاً` }); return; }
      if (mode === "return" && !r.checkedOut) { setMsg({ ok: false, text: `${r.name}: غير مُخرَج` }); return; }
      setProblem("none"); setNote(""); setCost(""); setManagerApproval(false);
      setPending({ productId: r.productId, name: r.name ?? "", assetCode: r.assetCode ?? "", status: r.status ?? "", imageUrl: r.imageUrl, checkedOut: Boolean(r.checkedOut) });
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message ?? "").replace(/^HTTP\s+\d+:\s*/i, "") || "تعذّر المسح" });
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!pending) return;
    if (mode === "return") {
      if (problem === "broken" && !note.trim()) return setMsg({ ok: false, text: "أدخل سبب الكسر" });
      if (problem === "lost" && !note.trim()) return setMsg({ ok: false, text: "أدخل سبب الفقدان" });
      if (problem === "lost" && !managerApproval) return setMsg({ ok: false, text: "مطلوب اعتماد المدير" });
    }
    setBusy(true); setMsg(null);
    try {
      const code = pending.assetCode || `AJN-A${String(pending.productId).padStart(6, "0")}`;
      await staffApi.scanAsset(id, mode === "checkout"
        ? { mode: "checkout", code }
        : { mode: "return", code, problem, note: note || undefined, cost: cost ? Number(cost) : undefined, managerApproval: managerApproval || undefined }, source);
      setMsg({ ok: true, text: mode === "checkout" ? `تم إخراج ${pending.name}` : problem === "lost" ? `سُجّل ${pending.name} كمفقود` : problem === "broken" ? `${pending.name} أُرسل للصيانة` : `تم استلام ${pending.name}` });
      setPending(null);
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message ?? "").replace(/^HTTP\s+\d+:\s*/i, "") || "تعذّرت العملية" });
    } finally { setBusy(false); }
  }

  if (!assets.length) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold">📦 أصول الحجز</div>
        <div className="text-xs text-muted-foreground">{mode === "checkout" ? "تم إخراج" : "تم استلام"} {doneCount} / {total}{allDone ? " ✓" : ""}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setMode("checkout"); setPending(null); }} className={`rounded-lg border-2 py-2 text-sm font-bold ${mode === "checkout" ? "border-status-warning bg-status-warning/10 text-status-warning" : "border-border text-muted-foreground"}`}>🚚 إخراج الأصول</button>
        <button type="button" onClick={() => { setMode("return"); setPending(null); }} className={`rounded-lg border-2 py-2 text-sm font-bold ${mode === "return" ? "border-status-success bg-status-success/10 text-status-success dark:text-status-success" : "border-border text-muted-foreground"}`}>📥 استلام الأصول</button>
      </div>

      {pending ? (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex gap-3">
            {pending.imageUrl
              ? <img src={pending.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
              : <div className="grid h-16 w-16 place-items-center rounded-lg bg-muted text-2xl">📦</div>}
            <div className="min-w-0">
              <div className="font-bold">{pending.name}</div>
              <div className="font-mono text-xs text-muted-foreground" dir="ltr">{pending.assetCode}</div>
              <div className="text-xs text-muted-foreground">الحالة: {pending.status}</div>
            </div>
          </div>
          {mode === "return" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {([["none", "سليم"], ["broken", "يوجد كسر"], ["lost", "يوجد فقدان"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setProblem(v)} className={`rounded-lg border py-1.5 text-xs font-medium ${problem === v ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
                ))}
              </div>
              {problem === "broken" && (
                <div className="space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الكسر *" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="تكلفة الإصلاح التقديرية" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
              )}
              {problem === "lost" && (
                <div className="space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الفقدان *" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={managerApproval} onChange={(e) => setManagerApproval(e.target.checked)} className="accent-primary" /> اعتماد المدير *</label>
                </div>
              )}
            </>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setPending(null)} disabled={busy} className="flex-1 rounded-lg border border-border py-2 text-sm font-bold">إلغاء</button>
            <button type="button" onClick={confirm} disabled={busy} className="flex-1 rounded-lg bg-primary py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy ? "..." : mode === "checkout" ? "تأكيد الإخراج" : "تأكيد الاستلام"}</button>
          </div>
        </div>
      ) : scanning ? (
        <div className="space-y-2">
          <LiveScanner onDetect={onDetect} active={scanning && !pending} />
          <button type="button" onClick={() => setScanning(false)} className="w-full rounded-lg border border-border py-2 text-sm">إغلاق الماسح</button>
        </div>
      ) : (
        <button type="button" onClick={() => setScanning(true)} className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">📷 مسح QR / باركود</button>
      )}

      {msg && <Banner kind={msg.ok ? "ok" : "error"}>{msg.text}</Banner>}

      <ul className="space-y-1">
        {assets.map((a) => (
          <li key={a.productId} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-1.5 text-sm">
            <span className="truncate">{a.name}</span>
            <span className={`shrink-0 text-xs font-bold ${a.checkedOut ? "text-status-warning" : "text-status-success"}`}>{a.checkedOut ? "خارج المخزن" : "في المخزن"}</span>
          </li>
        ))}
      </ul>
      {!allDone && <div className="text-xs text-status-warning">⚠️ لا يمكن إكمال الحجز حتى {mode === "checkout" ? "إخراج" : "استلام"} كل الأصول.</div>}
    </div>
  );
}
