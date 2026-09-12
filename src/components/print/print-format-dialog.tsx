import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, Printer, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { printWhenImagesReadyScript } from "@/views/admin/print-helpers";

/**
 * Unified AJN print system — shared types + presentation dialog.
 *
 * Every "طباعة" button across the platform funnels through this one component.
 * It is deliberately DATA-AGNOSTIC: a caller only supplies, per format, a
 * `buildHtml()` that returns a complete standalone HTML document. All financial
 * calculation, invoice numbering, QR generation and payment-state logic stay in
 * the caller's existing builders — printing here is a read-only presentation
 * action and never mutates anything.
 */

export type PrintFormatId = "a4" | "thermal80";

export type PrintFormat = {
  id: PrintFormatId;
  /**
   * Returns a full standalone HTML document (`<!doctype html>…`) WITHOUT any
   * auto-print `<script>`. The dialog uses the raw document for the on-screen
   * preview and appends the print script only when the user actually prints.
   */
  buildHtml: () => string;
  /**
   * Optional custom print action, run instead of the default popup printer when
   * the user confirms. Use it for flows that need extra work at print time
   * (audit logging, multiple copies, remote/direct printing). It still runs
   * inside the confirm click gesture, so opening a print window here is safe.
   */
  onPrint?: () => void | Promise<void>;
  /** Optional override for the card's sub-label (defaults per format). */
  sublabel?: string;
};

export type PrintJob = {
  /** e.g. "فاتورة #INV-1042" — shown in the preview header and window title. */
  documentLabel?: string;
  /** Ordered formats. When only one is supplied the selector step is skipped. */
  formats: PrintFormat[];
  /** Preselected format (defaults to the first supplied format). */
  defaultFormat?: PrintFormatId;
  /** Fired after the print window opens for a format (audit hooks, etc.). */
  onPrinted?: (format: PrintFormatId) => void;
};

const FORMAT_META: Record<
  PrintFormatId,
  { title: string; sublabel: string; badge: string; naturalWidth: number }
> = {
  a4: {
    title: "A4",
    sublabel: "فاتورة كاملة",
    badge: "A4 · ورقة كاملة",
    naturalWidth: 794, // 210mm @ 96dpi
  },
  thermal80: {
    title: "80mm",
    sublabel: "طباعة حرارية",
    badge: "80mm حراري",
    naturalWidth: 302, // 80mm @ 96dpi
  },
};

/**
 * Writes a standalone document to a fresh print window and triggers printing.
 * Mirrors the platform's existing popup-print behaviour (desktop print agent
 * hook + auto-close) so output stays identical to the legacy print paths.
 */
export function printHtmlDocument(
  html: string,
  opts: { thermal?: boolean; title?: string } = {},
): void {
  const features = opts.thermal ? "width=440,height=760" : "width=980,height=760";
  const popup = window.open("", "_blank", features);
  if (!popup) {
    throw new Error(
      "تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.",
    );
  }
  // Some document builders already embed the shared auto-print script; never
  // append a second copy (it would fire window.print() twice).
  const alreadyHasPrintScript = html.includes("waitForImages");
  const withScript = alreadyHasPrintScript
    ? html
    : html.includes("</body>")
      ? html.replace("</body>", `${printWhenImagesReadyScript()}</body>`)
      : `${html}${printWhenImagesReadyScript()}`;
  popup.document.open();
  popup.document.write(withScript);
  popup.document.close();
}

/** Scaled, sandboxed preview of a print document — never prints on its own. */
function DocumentPreview({
  html,
  format,
}: {
  html: string;
  format: PrintFormatId;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [frameHeight, setFrameHeight] = useState(
    format === "a4" ? 1123 : 520,
  );
  const naturalWidth = FORMAT_META[format].naturalWidth;

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const available = container.clientWidth - 24;
    const next = Math.min(1, Math.max(0.25, available / naturalWidth));
    setScale(next);
  }, [naturalWidth]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  // Thermal receipts have dynamic height — size the frame to its content once
  // rendered so the preview shows the full receipt without an inner scrollbar.
  const handleLoad = useCallback(() => {
    if (format !== "thermal80") return;
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const height = Math.max(
      doc.body?.scrollHeight ?? 0,
      doc.documentElement?.scrollHeight ?? 0,
    );
    if (height > 0) setFrameHeight(height + 8);
  }, [format]);

  return (
    <div
      ref={containerRef}
      className="flex justify-center overflow-auto rounded-xl bg-muted/40 p-3"
      style={{ maxHeight: "58dvh" }}
    >
      <div
        style={{
          width: naturalWidth * scale,
          height: frameHeight * scale,
          flex: "0 0 auto",
        }}
      >
        <iframe
          ref={frameRef}
          title="معاينة الطباعة"
          srcDoc={html}
          onLoad={handleLoad}
          sandbox="allow-same-origin"
          className="rounded-md border border-border bg-white shadow-sm"
          style={{
            width: naturalWidth,
            height: frameHeight,
            transform: `scale(${scale})`,
            transformOrigin: "top center",
            border: "1px solid var(--border, #e5e7eb)",
          }}
        />
      </div>
    </div>
  );
}

function FormatCard({
  format,
  active,
  onSelect,
}: {
  format: PrintFormat;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = FORMAT_META[format.id];
  const Icon = format.id === "a4" ? FileText : Receipt;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "motion-safe:active:scale-[0.97]",
        active
          ? "border-primary bg-primary/8 shadow-sm"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/5",
      )}
    >
      <span
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-2xl border transition-colors",
          active
            ? "border-primary/40 bg-primary/12 text-primary"
            : "border-border bg-muted/50 text-muted-foreground group-hover:text-primary",
        )}
      >
        <Icon className="h-8 w-8" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-lg font-extrabold text-foreground">
          {meta.title}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {format.sublabel ?? meta.sublabel}
        </span>
      </span>
    </button>
  );
}

export function PrintFormatDialog({
  job,
  onClose,
}: {
  job: PrintJob | null;
  onClose: () => void;
}) {
  const formats = job?.formats ?? [];
  const singleFormat = formats.length === 1;

  const initialFormat = useMemo<PrintFormatId | null>(() => {
    if (!job || formats.length === 0) return null;
    if (job.defaultFormat && formats.some((f) => f.id === job.defaultFormat)) {
      return job.defaultFormat;
    }
    return formats[0].id;
  }, [job, formats]);

  const [selected, setSelected] = useState<PrintFormatId | null>(initialFormat);
  const [step, setStep] = useState<"select" | "preview">(
    singleFormat ? "preview" : "select",
  );
  const [error, setError] = useState<string | null>(null);

  // Reset the flow whenever a new job opens.
  useEffect(() => {
    if (!job) return;
    setSelected(initialFormat);
    setStep(singleFormat ? "preview" : "select");
    setError(null);
  }, [job, initialFormat, singleFormat]);

  const activeFormat = useMemo(
    () => formats.find((f) => f.id === selected) ?? null,
    [formats, selected],
  );

  const previewHtml = useMemo(() => {
    if (step !== "preview" || !activeFormat) return "";
    try {
      return activeFormat.buildHtml();
    } catch {
      return "";
    }
  }, [step, activeFormat]);

  if (!job) return null;

  const handleSelect = (id: PrintFormatId) => {
    setSelected(id);
    setStep("preview");
  };

  const handleBack = () => {
    if (singleFormat) {
      onClose();
      return;
    }
    setStep("select");
  };

  const handlePrint = () => {
    if (!activeFormat) return;
    try {
      if (activeFormat.onPrint) {
        void activeFormat.onPrint();
      } else {
        const html = activeFormat.buildHtml();
        printHtmlDocument(html, { thermal: activeFormat.id === "thermal80" });
      }
      job.onPrinted?.(activeFormat.id);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر فتح نافذة الطباعة. حاول مرة أخرى.",
      );
    }
  };

  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir="rtl"
        className={cn(step === "preview" ? "max-w-3xl" : "max-w-md")}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            {step === "select" ? "اختيار نوع الطباعة" : "معاينة قبل الطباعة"}
          </DialogTitle>
          <DialogDescription>
            {job.documentLabel
              ? job.documentLabel
              : "اختر مقاس الطباعة المناسب لهذا المستند."}
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="grid grid-cols-2 gap-4 py-2">
            {formats.map((format) => (
              <FormatCard
                key={format.id}
                format={format}
                active={selected === format.id}
                onSelect={() => handleSelect(format.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/8 px-3 py-1 text-xs font-bold text-primary",
                )}
              >
                {activeFormat?.id === "a4" ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : (
                  <Receipt className="h-3.5 w-3.5" />
                )}
                {activeFormat ? FORMAT_META[activeFormat.id].badge : ""}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">
                معاينة فقط — لن تتأثر أي بيانات مالية
              </span>
            </div>
            {activeFormat ? (
              <DocumentPreview html={previewHtml} format={activeFormat.id} />
            ) : null}
          </div>
        )}

        {error ? (
          <p className="text-sm font-semibold text-destructive">{error}</p>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          {step === "preview" ? (
            <Button type="button" variant="outline" onClick={handleBack}>
              <ArrowRight className="h-4 w-4" />
              {singleFormat ? "إلغاء" : "رجوع"}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          )}
          {step === "preview" ? (
            <Button type="button" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">
              اختر مقاس الطباعة للمتابعة
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
