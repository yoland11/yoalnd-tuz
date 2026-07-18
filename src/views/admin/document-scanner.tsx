import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Camera, CheckCircle2, Crop, ImageUp, Loader2, RefreshCw,
  RotateCcw, RotateCw, ScanLine, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fetchAdminMe, hasPerm, type AdminMe } from "./_lib";
import DocumentLayout from "./document-layout";
import DocumentSave from "./document-save";
import {
  analyzeQuality, canvasFrom, canvasToDataUrl, defaultCorners, detectDocumentCorners,
  effectiveDpi, enhance, loadImage, pixelsForMm, presetFor, rotateCanvas, warpPerspective,
  DEFAULT_ADJUSTMENTS, SCAN_MODES,
  type Adjustments, type Corners, type Point, type QualityReport, type ScanMode,
} from "@/lib/document-scan";

// ─── Document types ─────────────────────────────────────────────────────────

type DocTypeDef = {
  value: string;
  label: string;
  /** Physical size in mm; drives the 300 DPI output and the aspect ratio. */
  widthMm: number;
  heightMm: number;
};

export const DOCUMENT_TYPES: DocTypeDef[] = [
  { value: "national_id", label: "البطاقة الوطنية", widthMm: 85.6, heightMm: 53.98 },
  { value: "civil_id", label: "هوية الأحوال المدنية", widthMm: 85.6, heightMm: 53.98 },
  { value: "residence_card", label: "بطاقة السكن", widthMm: 85.6, heightMm: 53.98 },
  { value: "passport", label: "جواز السفر", widthMm: 125, heightMm: 88 },
  { value: "driving_license", label: "إجازة السوق", widthMm: 85.6, heightMm: 53.98 },
  { value: "ration_card", label: "البطاقة التموينية", widthMm: 148, heightMm: 105 },
  { value: "employee_id", label: "هوية موظف", widthMm: 85.6, heightMm: 53.98 },
  { value: "student_id", label: "هوية طالب", widthMm: 85.6, heightMm: 53.98 },
  { value: "certificate", label: "شهادة", widthMm: 210, heightMm: 297 },
  { value: "custom", label: "مستمسك مخصص", widthMm: 85.6, heightMm: 53.98 },
];

export type Side = "front" | "back";

/** A finished, print-ready side. Phase 2 consumes these for the A4 layout. */
export type ScannedSide = {
  side: Side;
  /** Enhanced, perspective-corrected, 300 DPI JPEG data URL. */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
};

type Stage = "capture" | "adjust" | "done";

export default function DocumentScannerPage() {
  const { toast } = useToast();
  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });
  const user = me ?? null;
  const canScan = hasPerm(user, "doc_scanner_scan");
  const canPrint = hasPerm(user, "doc_scanner_print");
  const canExport = hasPerm(user, "doc_scanner_export");
  const canSave = hasPerm(user, "doc_scanner_save");

  const [docType, setDocType] = useState<string>("national_id");
  const [customSize, setCustomSize] = useState({ w: "85.6", h: "53.98" });
  const [side, setSide] = useState<Side>("front");
  const [stage, setStage] = useState<Stage>("capture");

  // Source image + working state for the side currently being scanned.
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);
  const [mode, setMode] = useState<ScanMode>("enhanced");
  const [adj, setAdj] = useState<Adjustments>(presetFor("enhanced"));
  const [busy, setBusy] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  // Completed sides.
  const [scans, setScans] = useState<Partial<Record<Side, ScannedSide>>>({});

  const typeDef = useMemo(
    () => DOCUMENT_TYPES.find((t) => t.value === docType) ?? DOCUMENT_TYPES[0],
    [docType],
  );
  const targetMm = useMemo(() => {
    if (docType !== "custom") return { w: typeDef.widthMm, h: typeDef.heightMm };
    return { w: Number(customSize.w) || 85.6, h: Number(customSize.h) || 53.98 };
  }, [docType, typeDef, customSize]);

  // ── Capture ───────────────────────────────────────────────────────────────

  const acceptImage = useCallback(
    async (dataUrl: string) => {
      setBusy(true);
      try {
        const img = await loadImage(dataUrl);
        const canvas = canvasFrom(img);
        setSourceCanvas(canvas);
        setQuality(analyzeQuality(canvas));

        const detected = detectDocumentCorners(canvas);
        if (detected && detected.confidence >= 0.2) {
          setCorners(detected.corners);
          setDetectFailed(false);
        } else {
          setCorners(defaultCorners(canvas.width, canvas.height));
          setDetectFailed(true);
        }
        setStage("adjust");
      } catch (err: any) {
        toast({
          title: "تعذر قراءة الصورة",
          description: err?.message ?? "حاول مرة أخرى",
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast({ title: "الملف ليس صورة", variant: "destructive" });
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast({ title: "حجم الملف كبير جدًا", description: "الحد الأقصى 25 ميغابايت", variant: "destructive" });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => void acceptImage(String(reader.result));
      reader.onerror = () => toast({ title: "تعذر قراءة الملف", variant: "destructive" });
      reader.readAsDataURL(file);
    },
    [acceptImage, toast],
  );

  // ── Apply (warp + enhance) ────────────────────────────────────────────────

  const applyScan = useCallback(async () => {
    if (!sourceCanvas || !corners) return;
    setBusy(true);
    try {
      // Output sized for 300 DPI at the document's physical dimensions.
      const outW = pixelsForMm(targetMm.w, 300);
      const outH = pixelsForMm(targetMm.h, 300);
      let flat = warpPerspective(sourceCanvas, corners, outW, outH);
      if (adj.rotation !== 0) flat = rotateCanvas(flat, adj.rotation);
      const finished = enhance(flat, mode, adj);

      setScans((prev) => ({
        ...prev,
        [side]: {
          side,
          dataUrl: canvasToDataUrl(finished, 0.95),
          widthPx: finished.width,
          heightPx: finished.height,
          widthMm: targetMm.w,
          heightMm: targetMm.h,
        },
      }));
      setStage("done");
    } catch (err: any) {
      toast({ title: "تعذر تصحيح المنظور", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [sourceCanvas, corners, targetMm, adj, mode, side, toast]);

  const resetSide = useCallback(() => {
    setSourceCanvas(null);
    setCorners(null);
    setQuality(null);
    setDetectFailed(false);
    setStage("capture");
    setAdj(presetFor(mode));
  }, [mode]);

  function startSide(next: Side) {
    setSide(next);
    resetSide();
  }

  function removeScan(target: Side) {
    setScans((prev) => {
      const copy = { ...prev };
      delete copy[target];
      return copy;
    });
  }

  /**
   * Records an action in the audit log. Only metadata travels — never the image
   * itself and never any document number.
   */
  const audit = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      void adminFetch("/admin/document-scanner/audit", {
        method: "POST",
        body: JSON.stringify({ action, documentType: docType, ...extra }),
      }).catch(() => {
        // Auditing must never block the user's print/export.
      });
    },
    [docType],
  );

  const sourceDpi = sourceCanvas
    ? effectiveDpi(Math.max(sourceCanvas.width, sourceCanvas.height), Math.max(targetMm.w, targetMm.h))
    : 0;
  const lowRes = sourceCanvas ? sourceDpi < 200 : false;
  const current = scans[side];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-primary" /> مسح وطباعة المستمسكات
        </h1>
        {(scans.front || scans.back) && (
          <span className="text-xs text-status-success flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            {[scans.front && "الوجه الأمامي", scans.back && "الوجه الخلفي"].filter(Boolean).join(" · ")} جاهز
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        تتم كل المعالجة داخل جهازك — لا تُرفع صور المستمسكات إلى الخادم إلا إذا ضغطت زر الحفظ.
      </p>

      {/* ── Document type + side ── */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1.5">نوع المستمسك</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={FIELD}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <div>
            <span className="block text-xs text-muted-foreground mb-1.5">الوجه</span>
            <div className="grid grid-cols-2 gap-2">
              {(["front", "back"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => startSide(s)}
                  className={`rounded-lg border p-2 text-xs font-medium transition-colors ${
                    side === s
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/30 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {s === "front" ? "الوجه الأمامي" : "الوجه الخلفي"}
                  {scans[s] ? " ✓" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>

        {docType === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1.5">العرض (ملم)</span>
              <input
                type="number" min={10} step="0.1" dir="ltr"
                value={customSize.w}
                onChange={(e) => setCustomSize((c) => ({ ...c, w: e.target.value }))}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1.5">الارتفاع (ملم)</span>
              <input
                type="number" min={10} step="0.1" dir="ltr"
                value={customSize.h}
                onChange={(e) => setCustomSize((c) => ({ ...c, h: e.target.value }))}
                className={FIELD}
              />
            </label>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          القياس المستهدف: {targetMm.w} × {targetMm.h} ملم — يُنتَج بدقة 300 نقطة/بوصة
          ({pixelsForMm(targetMm.w)} × {pixelsForMm(targetMm.h)} بكسل).
        </p>
      </section>

      {/* ── Stage: capture ── */}
      {stage === "capture" && <CapturePanel busy={busy} onImage={acceptImage} onFiles={onFiles} />}

      {/* ── Stage: adjust ── */}
      {stage === "adjust" && sourceCanvas && corners && (
        <>
          {quality && quality.issues.length > 0 && (
            <div className="space-y-2">
              {quality.issues.map((issue) => (
                <div
                  key={issue.key}
                  className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${
                    issue.severity === "error"
                      ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
                      : "border-status-warning/30 bg-status-warning/10 text-status-warning"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {issue.message}
                </div>
              ))}
            </div>
          )}

          {detectFailed && (
            <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              لم يتم اكتشاف حدود المستمسك — يرجى تحديد الزوايا يدويًا بسحب النقاط الأربع.
            </div>
          )}

          {lowRes && (
            <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              دقة الصورة منخفضة ({sourceDpi} نقطة/بوصة عند هذا القياس)، يُفضّل إعادة التصوير.
            </div>
          )}

          <CornerEditor source={sourceCanvas} corners={corners} onChange={setCorners} />

          <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => setCorners(defaultCorners(sourceCanvas.width, sourceCanvas.height))}>
                <Crop className="w-3.5 h-3.5" /> إعادة ضبط الزوايا
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => setAdj((a) => ({ ...a, rotation: a.rotation - 90 }))}>
                <RotateCcw className="w-3.5 h-3.5" /> تدوير يسار
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => setAdj((a) => ({ ...a, rotation: a.rotation + 90 }))}>
                <RotateCw className="w-3.5 h-3.5" /> تدوير يمين
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={resetSide}>
                <RefreshCw className="w-3.5 h-3.5" /> إعادة التصوير
              </Button>
            </div>

            <ModeAndSliders
              mode={mode}
              adj={adj}
              onMode={(m) => { setMode(m); setAdj(presetFor(m)); }}
              onAdj={setAdj}
            />

            <Button className="gap-2 w-full sm:w-auto" disabled={busy} onClick={() => void applyScan()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              تطبيق المسح
            </Button>
          </section>
        </>
      )}

      {/* ── Stage: done ── */}
      {stage === "done" && current && (
        <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-foreground text-sm">
              نتيجة المسح — {side === "front" ? "الوجه الأمامي" : "الوجه الخلفي"}
            </h2>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={showOriginal}
                onChange={(e) => setShowOriginal(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-foreground">عرض الأصلي للمقارنة</span>
            </label>
          </div>
          <div className={`grid gap-3 ${showOriginal ? "sm:grid-cols-2" : ""}`}>
            {showOriginal && sourceCanvas && (
              <figure className="space-y-1">
                <img
                  src={sourceCanvas.toDataURL("image/jpeg", 0.7)}
                  alt="قبل المعالجة"
                  className="w-full rounded-lg border border-border/30"
                />
                <figcaption className="text-[11px] text-muted-foreground text-center">قبل</figcaption>
              </figure>
            )}
            <figure className="space-y-1">
              <img
                src={current.dataUrl}
                alt="بعد المعالجة"
                className="w-full rounded-lg border border-border/30 bg-white"
              />
              <figcaption className="text-[11px] text-muted-foreground text-center">
                بعد — {current.widthPx} × {current.heightPx} بكسل (300 نقطة/بوصة)
              </figcaption>
            </figure>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStage("adjust")}>
              <Crop className="w-3.5 h-3.5" /> تعديل
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={resetSide}>
              <RefreshCw className="w-3.5 h-3.5" /> إعادة المسح
            </Button>
            {side === "front" && !scans.back && (
              <Button size="sm" className="gap-1.5" onClick={() => startSide("back")}>
                <Camera className="w-3.5 h-3.5" /> التقاط الوجه الخلفي
              </Button>
            )}
          </div>
        </section>
      )}

      {/* ── Completed sides ── */}
      {(scans.front || scans.back) && (
        <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
          <h2 className="font-semibold text-foreground text-sm">الأوجه الجاهزة</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["front", "back"] as const).map((s) =>
              scans[s] ? (
                <div key={s} className="rounded-lg border border-border/20 bg-background/40 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {s === "front" ? "الوجه الأمامي" : "الوجه الخلفي"}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeScan(s)}
                      className="text-muted-foreground hover:text-status-danger"
                      aria-label="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <img src={scans[s]!.dataUrl} alt="" className="w-full rounded bg-white" />
                </div>
              ) : null,
            )}
          </div>
        </section>
      )}

      {/* ── A4 layout designer + print/export ── */}
      {(scans.front || scans.back) && (
        <DocumentLayout
          scans={scans}
          docTypeLabel={typeDef.label}
          canPrint={canPrint}
          canExport={canExport}
          onPrinted={() => audit("document_printed", { copies: 1 })}
          onExported={(format) => audit("pdf_exported", { format })}
        />
      )}

      {/* ── Optional protected save + entity linking ── */}
      {(scans.front || scans.back) && canSave && (
        <DocumentSave
          scans={scans}
          documentType={docType}
          documentTypeLabel={typeDef.label}
          onSaved={() => audit("document_saved")}
        />
      )}

      {!canScan && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> لا تملك صلاحية مسح المستمسكات — العرض فقط.
        </div>
      )}
    </div>
  );
}

const FIELD =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// ─── Capture panel (camera + upload + drag & drop) ──────────────────────────

function CapturePanel({
  busy, onImage, onFiles,
}: {
  busy: boolean;
  onImage: (dataUrl: string) => void;
  onFiles: (files: FileList | null) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  // Never leave the camera running when the user navigates away or cancels —
  // no temporary frame outlives the component.
  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: "تعذر فتح الكاميرا", description: "المتصفح لا يدعم الكاميرا", variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // Rear camera by default on mobile, at the highest practical resolution.
          facingMode: { ideal: "environment" },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch (err: any) {
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      toast({
        title: denied ? "لم يتم منح صلاحية الكاميرا" : "تعذر فتح الكاميرا",
        description: denied ? "اسمح بالوصول للكاميرا من إعدادات المتصفح" : err?.message,
        variant: "destructive",
      });
    }
  }

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = c.toDataURL("image/jpeg", 0.95);
    stopCamera();
    onImage(dataUrl);
  }

  return (
    <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4">
      {cameraOn ? (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted className="w-full max-h-[60vh] object-contain" />
            {/* Alignment frame — 85.6:53.98 is the ID-1 card ratio. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="w-full max-w-md aspect-[85.6/53.98] rounded-lg border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/90">
              ضع المستمسك داخل الإطار واملأه قدر الإمكان
            </p>
          </div>
          <div className="flex gap-2">
            <Button className="gap-2 flex-1" onClick={shoot} disabled={busy}>
              <Camera className="w-4 h-4" /> تصوير المستمسك
            </Button>
            <Button variant="outline" className="gap-2" onClick={stopCamera}>
              <X className="w-4 h-4" /> إغلاق
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed p-6 sm:p-10 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border/40"
          }`}
        >
          {busy ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">جارٍ تحليل الصورة…</p>
            </div>
          ) : (
            <>
              <ImageUp className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-foreground mb-1">اسحب صورة المستمسك وأفلتها هنا</p>
              <p className="text-xs text-muted-foreground mb-4">أو اختر من الخيارات أدناه</p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button className="gap-2" onClick={() => void startCamera()}>
                  <Camera className="w-4 h-4" /> فتح الكاميرا
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
                  <Upload className="w-4 h-4" /> رفع صورة من الجهاز
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Corner editor ──────────────────────────────────────────────────────────

function CornerEditor({
  source, corners, onChange,
}: {
  source: HTMLCanvasElement;
  corners: Corners;
  onChange: (c: Corners) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const preview = useMemo(() => source.toDataURL("image/jpeg", 0.7), [source]);

  const toLocal = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = wrapRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * source.width;
      const y = ((clientY - rect.top) / rect.height) * source.height;
      return {
        x: Math.max(0, Math.min(source.width, x)),
        y: Math.max(0, Math.min(source.height, y)),
      };
    },
    [source.width, source.height],
  );

  useEffect(() => {
    if (dragging === null) return;
    const index = dragging;
    function move(e: PointerEvent) {
      const p = toLocal(e.clientX, e.clientY);
      if (!p) return;
      const next = [...corners] as Corners;
      next[index] = p;
      onChange(next);
    }
    function up() { setDragging(null); }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, corners, onChange, toLocal]);

  const polygon = corners
    .map((p) => `${(p.x / source.width) * 100}% ${(p.y / source.height) * 100}%`)
    .join(", ");

  return (
    <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-2">
      <p className="text-xs text-muted-foreground">اسحب النقاط الأربع لتطابق زوايا المستمسك بدقة.</p>
      <div
        ref={wrapRef}
        className="relative w-full select-none touch-none rounded-lg overflow-hidden bg-black/40"
        style={{ aspectRatio: `${source.width} / ${source.height}` }}
      >
        <img src={preview} alt="" className="absolute inset-0 w-full h-full object-contain" draggable={false} />
        <div className="absolute inset-0 bg-primary/15" style={{ clipPath: `polygon(${polygon})` }} />
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${source.width} ${source.height}`}
          preserveAspectRatio="none"
        >
          <polygon
            points={corners.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth={Math.max(2, source.width / 300)}
          />
        </svg>
        {corners.map((p, i) => (
          <button
            key={i}
            type="button"
            aria-label={`زاوية ${i + 1}`}
            onPointerDown={(e) => { e.preventDefault(); setDragging(i); }}
            style={{
              left: `${(p.x / source.width) * 100}%`,
              top: `${(p.y / source.height) * 100}%`,
            }}
            className="absolute w-7 h-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary border-2 border-white shadow-lg touch-none"
          />
        ))}
      </div>
    </section>
  );
}

// ─── Mode + sliders ─────────────────────────────────────────────────────────

const SLIDERS: Array<{ key: keyof Adjustments; label: string; min: number; max: number }> = [
  { key: "brightness", label: "السطوع", min: -100, max: 100 },
  { key: "contrast", label: "التباين", min: -100, max: 100 },
  { key: "sharpness", label: "الحدة", min: 0, max: 100 },
  { key: "saturation", label: "تشبّع الألوان", min: -100, max: 100 },
  { key: "shadows", label: "تقليل الظلال", min: 0, max: 100 },
  { key: "denoise", label: "تقليل التشويش", min: 0, max: 100 },
  { key: "rotation", label: "تدوير دقيق (°)", min: -180, max: 180 },
];

function ModeAndSliders({
  mode, adj, onMode, onAdj,
}: {
  mode: ScanMode;
  adj: Adjustments;
  onMode: (m: ScanMode) => void;
  onAdj: (a: Adjustments) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <span className="block text-xs text-muted-foreground mb-1.5">نمط المسح</span>
        <div className="flex gap-1.5 flex-wrap">
          {SCAN_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onMode(m.value)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                mode === m.value
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/30 text-muted-foreground hover:border-primary/30"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {SLIDERS.map((s) => (
          <label key={s.key} className="block">
            <span className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{s.label}</span>
              <span className="tabular-nums">{adj[s.key]}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              value={adj[s.key]}
              onChange={(e) => onAdj({ ...adj, [s.key]: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </label>
        ))}
      </div>

      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onAdj({ ...DEFAULT_ADJUSTMENTS })}>
        <RefreshCw className="w-3.5 h-3.5" /> إعادة الضبط للأصلي
      </Button>
    </div>
  );
}
