import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Download, FileImage, FileText, Loader2, Minus, Plus, Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  A4, SAFE_MARGIN_MM, SIZE_PRESETS, TEMPLATES, capacity, defaultMargins, fitWithin,
  mmToPx, placeItems, planForTemplate, printDpi, qualityForDpi, sizeForWidth,
  type LayoutConfig, type Orientation, type Side, type TemplateId,
} from "@/lib/a4-layout";

export type LayoutSource = {
  side: Side;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
};

const FIELD =
  "w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function DocumentLayout({
  scans,
  docTypeLabel,
  canPrint,
  canExport,
  onPrinted,
  onExported,
}: {
  scans: Partial<Record<Side, LayoutSource>>;
  docTypeLabel: string;
  canPrint: boolean;
  canExport: boolean;
  onPrinted?: () => void;
  onExported?: (format: string) => void;
}) {
  const { toast } = useToast();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const available = useMemo(
    () => (["front", "back"] as Side[]).filter((s) => Boolean(scans[s])),
    [scans],
  );
  const [primary, setPrimary] = useState<Side>(available[0] ?? "front");
  const [template, setTemplate] = useState<TemplateId>("copies_4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [sizePreset, setSizePreset] = useState("id1");
  const [customSize, setCustomSize] = useState({ w: "85.6", h: "53.98" });
  const [margins, setMargins] = useState(defaultMargins(10));
  const [gap, setGap] = useState({ x: 5, y: 5 });
  const [grid, setGrid] = useState({ rows: 2, cols: 2 });
  const [border, setBorder] = useState(0);
  const [rounded, setRounded] = useState(false);
  const [cutMarks, setCutMarks] = useState(true);
  const [copyCount, setCopyCount] = useState(4);

  const activePrimary = available.includes(primary) ? primary : (available[0] ?? "front");
  const sample = scans[activePrimary];

  // ── Physical size of one copy ─────────────────────────────────────────────
  const itemSize = useMemo(() => {
    if (!sample) return { w: 85.6, h: 53.98 };
    const natW = sample.widthMm;
    const natH = sample.heightMm;
    if (sizePreset === "original") return { w: natW, h: natH };
    if (sizePreset === "custom") {
      const w = Number(customSize.w) || natW;
      // Keep the document's real proportions — never stretch it.
      return sizeForWidth(natW, natH, w);
    }
    const preset = SIZE_PRESETS.find((p) => p.value === sizePreset);
    if (!preset?.w || !preset?.h) return { w: natW, h: natH };
    // Fit inside the preset box, preserving aspect ratio.
    return fitWithin(natW, natH, preset.w, preset.h);
  }, [sample, sizePreset, customSize]);

  // ── Apply a template ──────────────────────────────────────────────────────
  function applyTemplate(id: TemplateId) {
    setTemplate(id);
    const plan = planForTemplate(id, available, activePrimary);
    if (plan.config.rows && plan.config.cols) setGrid({ rows: plan.config.rows, cols: plan.config.cols });
    if (plan.config.gapX !== undefined) setGap({ x: plan.config.gapX, y: plan.config.gapY ?? plan.config.gapX });
    if (plan.sizePreset) setSizePreset(plan.sizePreset);
    setCopyCount(plan.sides.length);
  }

  // ── Slots ─────────────────────────────────────────────────────────────────
  const sides = useMemo<Side[]>(() => {
    const plan = planForTemplate(template, available, activePrimary);
    if (template === "custom_grid") {
      return Array.from({ length: copyCount }, () => activePrimary);
    }
    // Respect an explicit copy-count change on repeat templates.
    if (plan.sides.length !== copyCount && !TEMPLATES.find((t) => t.id === template)?.needsBothSides) {
      return Array.from({ length: copyCount }, () => activePrimary);
    }
    return plan.sides;
  }, [template, available, activePrimary, copyCount]);

  const config: LayoutConfig = useMemo(
    () => ({
      orientation,
      margins,
      itemW: itemSize.w,
      itemH: itemSize.h,
      gapX: gap.x,
      gapY: gap.y,
      rows: grid.rows,
      cols: grid.cols,
      border,
      rounded,
      cutMarks,
    }),
    [orientation, margins, itemSize, gap, grid, border, rounded, cutMarks],
  );

  const cap = useMemo(() => capacity(config), [config]);
  const placed = useMemo(() => placeItems(config, sides), [config, sides]);
  const page = A4[orientation];

  const dpi = sample ? printDpi(sample.widthPx, itemSize.w) : 0;
  const quality = qualityForDpi(dpi);
  const notAllFit = placed.length < sides.length;
  const tooTightMargin = Math.min(margins.top, margins.right, margins.bottom, margins.left) < SAFE_MARGIN_MM;

  // ── Print (native, exact mm) ──────────────────────────────────────────────
  function printSheet() {
    if (!sheetRef.current) return;
    if (cap.overflow) {
      toast({ title: "لا يمكن ترتيب النسخ ضمن ورقة A4 بهذا القياس", variant: "destructive" });
      return;
    }
    const html = buildSheetHtml(placed, scans, config, page, docTypeLabel);
    const w = window.open("", "_blank", "width=900,height=1200");
    if (!w) {
      toast({ title: "تعذر فتح نافذة الطباعة", description: "اسمح بالنوافذ المنبثقة", variant: "destructive" });
      return;
    }
    w.document.write(html);
    w.document.close();
    onPrinted?.();
  }

  // ── Export: PDF (A4, physical mm preserved) ───────────────────────────────
  async function exportPdf() {
    if (!sheetRef.current) return;
    setBusy("pdf");
    try {
      const mod = await import("html2pdf.js");
      const factory = ((mod as any).default ?? mod) as () => any;
      if (typeof factory !== "function") throw new Error("مكتبة PDF غير جاهزة");
      await factory()
        .set({
          margin: 0,
          filename: `${docTypeLabel}-A4.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          // 3.125 ≈ 300 DPI relative to CSS's 96 DPI baseline.
          html2canvas: { scale: 3.125, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation },
        })
        .from(sheetRef.current)
        .save();
      onExported?.("pdf");
    } catch (err: any) {
      toast({ title: "تعذر إنشاء ملف PDF", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  // ── Export: raster sheet at true 300 DPI ──────────────────────────────────
  async function exportRaster(format: "png" | "jpeg") {
    setBusy(format);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = mmToPx(page.w, 300);
      canvas.height = mmToPx(page.h, 300);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("تعذر تجهيز مساحة الرسم");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cache = new Map<string, HTMLImageElement>();
      for (const item of placed) {
        const src = scans[item.side]?.dataUrl;
        if (!src) continue;
        let img = cache.get(src);
        if (!img) {
          img = await loadImg(src);
          cache.set(src, img);
        }
        ctx.drawImage(img, mmToPx(item.x), mmToPx(item.y), mmToPx(item.w), mmToPx(item.h));
        if (border > 0) {
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = Math.max(1, mmToPx(border));
          ctx.strokeRect(mmToPx(item.x), mmToPx(item.y), mmToPx(item.w), mmToPx(item.h));
        }
      }

      const mime = format === "png" ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(mime, 0.95);
      downloadDataUrl(dataUrl, `${docTypeLabel}-A4-300dpi.${format}`);
      onExported?.(format);
    } catch (err: any) {
      toast({ title: "تعذر إنشاء الصورة", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  function exportScan(side: Side) {
    const s = scans[side];
    if (!s) return;
    downloadDataUrl(s.dataUrl, `${docTypeLabel}-${side === "front" ? "امامي" : "خلفي"}-300dpi.jpg`);
    onExported?.("scan");
  }

  if (available.length === 0) {
    return (
      <section className="bg-card rounded-xl border border-border/30 p-4 text-sm text-muted-foreground">
        امسح وجهاً واحداً على الأقل لعرض تخطيط الطباعة.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Template + basics ── */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h2 className="font-semibold text-foreground text-sm">تخطيط الطباعة A4</h2>

        <label className="block">
          <span className="block text-xs text-muted-foreground mb-1.5">القالب</span>
          <select value={template} onChange={(e) => applyTemplate(e.target.value as TemplateId)} className={FIELD}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id} disabled={t.needsBothSides && available.length < 2}>
                {t.label}
                {t.needsBothSides && available.length < 2 ? " (يتطلب الوجهين)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1.5">اتجاه الورقة</span>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)} className={FIELD}>
              <option value="portrait">طولي (210 × 297)</option>
              <option value="landscape">عرضي (297 × 210)</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-muted-foreground mb-1.5">قياس النسخة</span>
            <select value={sizePreset} onChange={(e) => setSizePreset(e.target.value)} className={FIELD}>
              {SIZE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          {available.length > 1 && (
            <label className="block">
              <span className="block text-xs text-muted-foreground mb-1.5">الوجه الأساسي</span>
              <select value={activePrimary} onChange={(e) => setPrimary(e.target.value as Side)} className={FIELD}>
                <option value="front">الوجه الأمامي</option>
                <option value="back">الوجه الخلفي</option>
              </select>
            </label>
          )}
        </div>

        {sizePreset === "custom" && (
          <label className="block max-w-xs">
            <span className="block text-xs text-muted-foreground mb-1.5">العرض المطبوع (ملم) — الارتفاع يُحسب تلقائياً</span>
            <input
              type="number" min={10} step="0.1" dir="ltr"
              value={customSize.w}
              onChange={(e) => setCustomSize((c) => ({ ...c, w: e.target.value }))}
              className={FIELD}
            />
          </label>
        )}

        <p className="text-[11px] text-muted-foreground">
          القياس المطبوع لكل نسخة: {itemSize.w.toFixed(1)} × {itemSize.h.toFixed(1)} ملم — النسب محفوظة دائماً بلا تمديد.
        </p>
      </section>

      {/* ── Grid designer ── */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h3 className="font-semibold text-foreground text-sm">الشبكة والهوامش</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <NumField label="الصفوف" value={grid.rows} min={1} max={20}
            onChange={(v) => setGrid((g) => ({ ...g, rows: v }))} />
          <NumField label="الأعمدة" value={grid.cols} min={1} max={20}
            onChange={(v) => setGrid((g) => ({ ...g, cols: v }))} />
          <NumField label="تباعد أفقي (ملم)" value={gap.x} min={0} max={50} step={0.5}
            onChange={(v) => setGap((g) => ({ ...g, x: v }))} />
          <NumField label="تباعد عمودي (ملم)" value={gap.y} min={0} max={50} step={0.5}
            onChange={(v) => setGap((g) => ({ ...g, y: v }))} />
          <NumField label="هامش علوي" value={margins.top} min={0} max={50} step={0.5}
            onChange={(v) => setMargins((m) => ({ ...m, top: v }))} />
          <NumField label="هامش سفلي" value={margins.bottom} min={0} max={50} step={0.5}
            onChange={(v) => setMargins((m) => ({ ...m, bottom: v }))} />
          <NumField label="هامش أيمن" value={margins.right} min={0} max={50} step={0.5}
            onChange={(v) => setMargins((m) => ({ ...m, right: v }))} />
          <NumField label="هامش أيسر" value={margins.left} min={0} max={50} step={0.5}
            onChange={(v) => setMargins((m) => ({ ...m, left: v }))} />
          <NumField label="سماكة الإطار (ملم)" value={border} min={0} max={5} step={0.1} onChange={setBorder} />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Toggle label="زوايا دائرية" checked={rounded} onChange={setRounded} />
          <Toggle label="علامات القص" checked={cutMarks} onChange={setCutMarks} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">عدد النسخ</span>
            <button type="button" onClick={() => setCopyCount((c) => Math.max(1, c - 1))}
              className="w-7 h-7 rounded-lg border border-border/40 flex items-center justify-center hover:bg-muted" aria-label="حذف نسخة">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-semibold tabular-nums w-6 text-center">{sides.length}</span>
            <button type="button" onClick={() => setCopyCount((c) => Math.min(cap.max || 1, c + 1))}
              className="w-7 h-7 rounded-lg border border-border/40 flex items-center justify-center hover:bg-muted" aria-label="إضافة نسخة">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          يتّسع في هذه الورقة: {cap.cols} × {cap.rows} = {cap.max} نسخة بهذا القياس والهوامش.
        </p>

        {cap.overflow && (
          <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            لا يمكن ترتيب النسخ ضمن ورقة A4 بهذا القياس — صغّر القياس أو الهوامش.
          </div>
        )}
        {!cap.overflow && notAllFit && (
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            تم عرض {placed.length} من {sides.length} نسخة — الباقي لا يتّسع في الورقة.
          </div>
        )}
        {tooTightMargin && (
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            الهامش أقل من {SAFE_MARGIN_MM} ملم — قد تقتطع الطابعة أطراف النسخ.
          </div>
        )}
      </section>

      {/* ── Live A4 preview ── */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h3 className="font-semibold text-foreground text-sm">معاينة الورقة</h3>
        <div className="overflow-auto">
          <div
            ref={sheetRef}
            className="relative bg-white mx-auto shadow-lg"
            style={{
              width: `${page.w}mm`,
              height: `${page.h}mm`,
              // Scale only the on-screen preview; print uses the real mm size.
              transform: "scale(var(--sheet-scale, 1))",
              transformOrigin: "top center",
            }}
          >
            {placed.map((item) => {
              const src = scans[item.side]?.dataUrl;
              return (
                <div
                  key={item.index}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${item.x}mm`,
                    top: `${item.y}mm`,
                    width: `${item.w}mm`,
                    height: `${item.h}mm`,
                    border: border > 0 ? `${border}mm solid #000` : undefined,
                    borderRadius: rounded ? "2mm" : undefined,
                  }}
                >
                  {src && <img src={src} alt="" className="w-full h-full object-fill" />}
                </div>
              );
            })}
            {cutMarks && placed.length > 0 && <CutMarks items={placed} />}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground text-center">
          المعاينة مصغّرة للعرض فقط — الطباعة تخرج بالقياس الفعلي.
        </p>
      </section>

      {/* ── Print summary ── */}
      <section className="bg-card rounded-xl border border-border/30 p-3 sm:p-4 space-y-3">
        <h3 className="font-semibold text-foreground text-sm">ملخّص الطباعة</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <Info label="الورقة" value={`A4 ${orientation === "portrait" ? "طولي" : "عرضي"} — ${page.w} × ${page.h} ملم`} />
          <Info label="عدد النسخ" value={String(placed.length)} />
          <Info label="قياس النسخة" value={`${itemSize.w.toFixed(1)} × ${itemSize.h.toFixed(1)} ملم`} />
          <Info label="دقة الصورة" value={sample ? `${sample.widthPx} × ${sample.heightPx} بكسل` : "—"} />
          <Info label="جودة الطباعة" value={`${dpi} نقطة/بوصة — ${quality.label}`} tone={quality.tone} />
          <Info label="هوامش الطابعة" value={`${margins.top}/${margins.right}/${margins.bottom}/${margins.left} ملم`} />
        </div>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
          <p className="font-semibold mb-1">تعليمات الطباعة</p>
          <p>حجم الطباعة: <span className="font-mono">Actual Size / 100%</span></p>
          <p>عطّل خيار <span className="font-mono">Fit to Page</span> وإلا لن يخرج القياس صحيحاً.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canPrint && (
            <Button className="gap-2" onClick={printSheet} disabled={cap.overflow}>
              <Printer className="w-4 h-4" /> طباعة
            </Button>
          )}
          {canExport && (
            <>
              <Button variant="outline" className="gap-2" disabled={busy !== null || cap.overflow} onClick={() => void exportPdf()}>
                {busy === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} حفظ PDF
              </Button>
              <Button variant="outline" className="gap-2" disabled={busy !== null || cap.overflow} onClick={() => void exportRaster("png")}>
                {busy === "png" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileImage className="w-4 h-4" />} PNG بدقة 300
              </Button>
              <Button variant="outline" className="gap-2" disabled={busy !== null || cap.overflow} onClick={() => void exportRaster("jpeg")}>
                {busy === "jpeg" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileImage className="w-4 h-4" />} JPEG
              </Button>
              {available.map((s) => (
                <Button key={s} variant="outline" className="gap-2" onClick={() => exportScan(s)}>
                  <Download className="w-4 h-4" /> المسح {s === "front" ? "الأمامي" : "الخلفي"}
                </Button>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    img.src = src;
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

/**
 * Builds a standalone print document whose page box is exactly A4 with zero
 * page margin, so the browser prints every item at its true millimetre size.
 */
function buildSheetHtml(
  items: ReturnType<typeof placeItems>,
  scans: Partial<Record<Side, LayoutSource>>,
  cfg: LayoutConfig,
  page: { w: number; h: number },
  title: string,
): string {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) =>
      (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c]);

  const cells = items
    .map((it) => {
      const src = scans[it.side]?.dataUrl;
      if (!src) return "";
      return `<div class="cell" style="left:${it.x}mm;top:${it.y}mm;width:${it.w}mm;height:${it.h}mm"><img src="${src}" alt="" /></div>`;
    })
    .join("");

  const marks = cfg.cutMarks
    ? items
        .map((it) => {
          const m = 3; // mark length in mm
          return `
            <div class="mk" style="left:${it.x}mm;top:${it.y - m}mm;width:0;height:${m}mm"></div>
            <div class="mk" style="left:${it.x + it.w}mm;top:${it.y - m}mm;width:0;height:${m}mm"></div>
            <div class="mk" style="left:${it.x}mm;top:${it.y + it.h}mm;width:0;height:${m}mm"></div>
            <div class="mk" style="left:${it.x + it.w}mm;top:${it.y + it.h}mm;width:0;height:${m}mm"></div>
            <div class="mkh" style="left:${it.x - m}mm;top:${it.y}mm;width:${m}mm;height:0"></div>
            <div class="mkh" style="left:${it.x - m}mm;top:${it.y + it.h}mm;width:${m}mm;height:0"></div>
            <div class="mkh" style="left:${it.x + it.w}mm;top:${it.y}mm;width:${m}mm;height:0"></div>
            <div class="mkh" style="left:${it.x + it.w}mm;top:${it.y + it.h}mm;width:${m}mm;height:0"></div>`;
        })
        .join("")
    : "";

  return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: ${cfg.orientation === "portrait" ? "A4 portrait" : "A4 landscape"}; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .sheet { position: relative; width: ${page.w}mm; height: ${page.h}mm; overflow: hidden; }
    .cell { position: absolute; overflow: hidden;
      ${cfg.border > 0 ? `border: ${cfg.border}mm solid #000;` : ""}
      ${cfg.rounded ? "border-radius: 2mm;" : ""} }
    .cell img { width: 100%; height: 100%; object-fit: fill; display: block; }
    .mk { position: absolute; border-left: 0.2mm solid #000; }
    .mkh { position: absolute; border-top: 0.2mm solid #000; }
    @media print { .sheet { page-break-after: avoid; } }
  </style></head><body>
  <div class="sheet">${cells}${marks}</div>
  <script>
    (function () {
      var imgs = Array.prototype.slice.call(document.images);
      var pending = imgs.filter(function (i) { return !i.complete; }).length;
      function go() { window.focus(); window.print(); }
      if (!pending) { setTimeout(go, 120); return; }
      imgs.forEach(function (i) {
        if (i.complete) return;
        i.addEventListener('load', function () { if (--pending === 0) setTimeout(go, 120); });
        i.addEventListener('error', function () { if (--pending === 0) setTimeout(go, 120); });
      });
    })();
  </script>
  </body></html>`;
}

function CutMarks({ items }: { items: ReturnType<typeof placeItems> }) {
  return (
    <>
      {items.map((it) => (
        <span key={`m-${it.index}`}>
          {[
            { left: it.x, top: it.y - 3, w: 0, h: 3 },
            { left: it.x + it.w, top: it.y - 3, w: 0, h: 3 },
            { left: it.x, top: it.y + it.h, w: 0, h: 3 },
            { left: it.x + it.w, top: it.y + it.h, w: 0, h: 3 },
          ].map((m, i) => (
            <span
              key={`v${i}`}
              className="absolute border-l border-black/70"
              style={{ left: `${m.left}mm`, top: `${m.top}mm`, height: `${m.h}mm` }}
            />
          ))}
          {[
            { left: it.x - 3, top: it.y },
            { left: it.x - 3, top: it.y + it.h },
            { left: it.x + it.w, top: it.y },
            { left: it.x + it.w, top: it.y + it.h },
          ].map((m, i) => (
            <span
              key={`h${i}`}
              className="absolute border-t border-black/70"
              style={{ left: `${m.left}mm`, top: `${m.top}mm`, width: "3mm" }}
            />
          ))}
        </span>
      ))}
    </>
  );
}

function NumField({
  label, value, onChange, min, max, step = 1,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted-foreground mb-1">{label}</span>
      <input
        type="number" dir="ltr" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="w-full bg-background border border-border/40 rounded-lg px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
      <span className="text-foreground">{label}</span>
    </label>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color =
    tone === "bad" ? "text-status-danger" : tone === "warn" ? "text-status-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/20 bg-background/40 p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xs font-medium mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
