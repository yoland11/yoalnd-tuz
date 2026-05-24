import { useMemo, useRef, useState } from "react";
import type * as React from "react";
import { Crop, Image as ImageIcon, Lock, Minus, Move, Plus, RotateCcw, Unlock, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dataUrlSize,
  fileToDataUrl,
  formatBytes,
  inspectImageFile,
  processImageFile,
  type ImageMetadata,
  type ImageObjectFit,
  type ImageProcessOptions,
} from "@/lib/image-tools";
import type { ImageSettings } from "@/lib/public-settings";

export type ImageEditResult = {
  dataUrl: string;
  metadata: ImageMetadata;
};

type ImageKind = "product" | "service" | "gallery" | "logo" | "avatar" | "attachment";

type Preset = {
  id: string;
  label: string;
  ratio: number | null;
  fit: ImageObjectFit;
  width?: number;
  height?: number;
};

const PRESETS: Preset[] = [
  { id: "square", label: "مربع 1:1", ratio: 1, fit: "cover" },
  { id: "wide", label: "أفقي 16:9", ratio: 16 / 9, fit: "cover" },
  { id: "portrait", label: "عمودي 4:5", ratio: 4 / 5, fit: "cover" },
  { id: "banner", label: "بانر 21:9", ratio: 21 / 9, fit: "cover" },
  { id: "logo", label: "لوغو object-contain", ratio: 2, fit: "contain" },
  { id: "product", label: "منتج square", ratio: 1, fit: "cover" },
  { id: "story", label: "ستوري 9:16", ratio: 9 / 16, fit: "cover" },
  { id: "custom", label: "مخصص", ratio: null, fit: "cover" },
];

const DEFAULT_PRESET: Record<ImageKind, string> = {
  product: "product",
  service: "wide",
  gallery: "custom",
  logo: "logo",
  avatar: "square",
  attachment: "custom",
};

type EditorState = {
  width: number;
  height: number;
  objectFit: ImageObjectFit;
  lockRatio: boolean;
  zoom: number;
  offsetX: number;
  offsetY: number;
  preset: string;
};

type SourceInfo = ImageMetadata & {
  dataUrl: string;
  fileName: string;
};

type Props = {
  kind: ImageKind;
  label?: string;
  multiple?: boolean;
  accept?: string;
  currentImage?: string | null;
  currentMetadata?: ImageMetadata | null;
  settings?: Partial<ImageSettings>;
  watermarkText?: string;
  onComplete: (results: ImageEditResult[]) => void;
  onRemove?: () => void;
};

export function ImageUploadEditor({
  kind,
  label = "رفع صورة",
  multiple = false,
  accept = "image/*",
  currentImage,
  currentMetadata,
  settings,
  watermarkText,
  onComplete,
  onRemove,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const maxSize = maxSizeForKind(kind, settings);
  const isAvatar = kind === "avatar";

  const cropRatio = useMemo(() => {
    if (!editor?.width || !editor?.height) return "free";
    return `${editor.width}:${editor.height}`;
  }, [editor?.height, editor?.width]);

  async function receiveFiles(files: FileList | File[] | null) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    setError("");
    const oversized = picked.find((file) => file.size > 18 * 1024 * 1024);
    if (oversized) {
      setError("الصورة كبيرة جداً. الرجاء اختيار ملف أقل من 18MB.");
      return;
    }
    const unsupported = picked.find((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"));
    if (unsupported) {
      setError("نوع الملف غير مدعوم. استخدم صورة WebP/PNG/JPG أو فيديو للمعرض.");
      return;
    }

    const videos = picked.filter((file) => file.type.startsWith("video/"));
    if (videos.length > 0) {
      setProgress(20);
      const results: ImageEditResult[] = [];
      for (let index = 0; index < videos.length; index++) {
        const dataUrl = await fileToDataUrl(videos[index]);
        results.push({
          dataUrl,
          metadata: {
            originalSize: videos[index].size,
            originalType: videos[index].type,
            processedSize: videos[index].size,
            processedType: videos[index].type,
            objectFit: "cover",
            updatedAt: new Date().toISOString(),
          },
        });
        setProgress(Math.round(((index + 1) / videos.length) * 100));
      }
      onComplete(results);
      setTimeout(() => setProgress(0), 500);
    }

    const images = picked.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const nextQueue = multiple ? images : [images[0]];
    setQueue(nextQueue);
    await loadForEdit(nextQueue[0]);
  }

  async function loadForEdit(file: File) {
    try {
      setProgress(10);
      const info = await inspectImageFile(file);
      const sourceInfo = { ...info, fileName: file.name };
      setSource(sourceInfo);
      setEditor(initialEditor(kind, sourceInfo, maxSize, settings));
      setProgress(0);
    } catch {
      setProgress(0);
      setError("تعذر قراءة الصورة. جرّب صورة أخرى.");
    }
  }

  function setPreset(id: string) {
    if (!source) return;
    const preset = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
    setEditor((state) => {
      const next = state ?? initialEditor(kind, source, maxSize, settings);
      const dims = dimensionsForPreset(preset, source, maxSize);
      return {
        ...next,
        ...dims,
        preset: id,
        objectFit: preset.fit,
        lockRatio: preset.ratio !== null,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      };
    });
  }

  function changeWidth(width: number) {
    setEditor((state) => {
      if (!state) return state;
      const nextWidth = clampDimension(width);
      if (!state.lockRatio || state.height <= 0) return { ...state, width: nextWidth, preset: "custom" };
      const ratio = state.width / state.height || 1;
      return { ...state, width: nextWidth, height: clampDimension(Math.round(nextWidth / ratio)), preset: "custom" };
    });
  }

  function changeHeight(height: number) {
    setEditor((state) => {
      if (!state) return state;
      const nextHeight = clampDimension(height);
      if (!state.lockRatio || state.width <= 0) return { ...state, height: nextHeight, preset: "custom" };
      const ratio = state.width / state.height || 1;
      return { ...state, height: nextHeight, width: clampDimension(Math.round(nextHeight * ratio)), preset: "custom" };
    });
  }

  async function applyEdits() {
    if (!source || !editor || queue.length === 0) return;
    setError("");
    setProgress(15);
    const results: ImageEditResult[] = [];
    for (let index = 0; index < queue.length; index++) {
      const file = queue[index];
      const inspected = index === 0 ? source : { ...(await inspectImageFile(file)), fileName: file.name };
      const dataUrl = await processImageFile(file, processingOptions(editor, cropRatio, settings, watermarkText));
      const size = await dataUrlSize(dataUrl);
      results.push({
        dataUrl,
        metadata: {
          originalWidth: inspected.originalWidth,
          originalHeight: inspected.originalHeight,
          originalSize: inspected.originalSize,
          originalType: inspected.originalType,
          width: editor.width,
          height: editor.height,
          processedSize: size,
          processedType: dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/webp",
          cropRatio,
          objectFit: editor.objectFit,
          cropZoom: editor.zoom,
          cropOffsetX: editor.offsetX,
          cropOffsetY: editor.offsetY,
          preset: editor.preset,
          updatedAt: new Date().toISOString(),
        },
      });
      setProgress(Math.round(((index + 1) / queue.length) * 100));
    }
    onComplete(results);
    setQueue([]);
    setSource(null);
    setEditor(null);
    setTimeout(() => setProgress(0), 500);
  }

  function reset() {
    if (!source) return;
    setEditor(initialEditor(kind, source, maxSize, settings));
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!editor || editor.objectFit !== "cover") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: editor.offsetX, oy: editor.offsetY };
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !editor || editor.objectFit !== "cover") return;
    const rect = previewRef.current?.getBoundingClientRect();
    const scaleX = editor.width / Math.max(1, rect?.width ?? editor.width);
    const scaleY = editor.height / Math.max(1, rect?.height ?? editor.height);
    setEditor({
      ...editor,
      offsetX: Math.round(drag.ox + (event.clientX - drag.x) * scaleX),
      offsetY: Math.round(drag.oy + (event.clientY - drag.y) * scaleY),
    });
  }

  function pointerUp() {
    dragRef.current = null;
  }

  const previewStyle = editor
    ? ({ aspectRatio: `${editor.width} / ${editor.height}` } as React.CSSProperties)
    : undefined;

  return (
    <div className="space-y-3">
      {currentImage && !source && (
        <div className="rounded-xl border border-border/30 bg-background/40 p-3">
          <div className="flex items-start gap-3">
            <div className={`h-20 w-24 overflow-hidden border border-border/30 bg-card ${isAvatar ? "rounded-full" : "rounded-lg"}`}>
              <img
                src={currentImage}
                alt=""
                className="h-full w-full"
                style={{ objectFit: currentMetadata?.objectFit ?? (kind === "logo" ? "contain" : "cover") }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">الصورة الحالية</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {currentMetadata?.width && currentMetadata?.height ? `${currentMetadata.width} × ${currentMetadata.height}` : "بدون بيانات أبعاد محفوظة"}
                {currentMetadata?.objectFit ? ` · ${currentMetadata.objectFit}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20">
                  استبدال الصورة
                </button>
                {onRemove && (
                  <button type="button" onClick={onRemove} className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20">
                    حذف
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <label
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void receiveFiles(event.dataTransfer.files);
        }}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/40 bg-background/40 px-4 py-5 text-sm text-foreground hover:border-primary/50"
      >
        <Upload className="h-4 w-4 text-primary" />
        {label}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(event) => void receiveFiles(event.target.files)}
          className="hidden"
        />
      </label>

      {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      {progress > 0 && (
        <div className="h-2 overflow-hidden rounded-full border border-border/20 bg-background">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {source && editor && (
        <div className="rounded-xl border border-border/30 bg-background/45 p-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
              <div
                ref={previewRef}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
                className={`relative mx-auto w-full max-w-md overflow-hidden border border-primary/35 bg-card shadow-inner ${isAvatar ? "rounded-full" : "rounded-xl"} ${editor.objectFit === "cover" ? "cursor-move" : ""}`}
                style={previewStyle}
              >
                <img
                  src={source.dataUrl}
                  alt=""
                  draggable={false}
                  className="h-full w-full select-none"
                  style={{
                    objectFit: editor.objectFit,
                    transform: editor.objectFit === "cover" ? `translate(${editor.offsetX / 12}px, ${editor.offsetY / 12}px) scale(${editor.zoom})` : undefined,
                    transition: dragRef.current ? "none" : "transform 160ms ease",
                  }}
                />
                <div className={`pointer-events-none absolute inset-2 border border-white/50 ${isAvatar ? "rounded-full" : "rounded-lg"}`} />
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/55 px-2 py-1 text-[10px] text-white">
                  <Crop className="h-3 w-3" /> {editor.width}×{editor.height}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                <Info label="الأبعاد الأصلية" value={`${source.originalWidth ?? 0}×${source.originalHeight ?? 0}`} />
                <Info label="الحجم" value={formatBytes(source.originalSize)} />
                <Info label="الصيغة" value={source.originalType?.replace("image/", "").toUpperCase() || "IMAGE"} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPreset(preset.id)}
                    className={`rounded-lg border px-2 py-2 text-[11px] transition-colors ${
                      editor.preset === preset.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/35 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <Stepper label="العرض" value={editor.width} min={96} max={3200} onChange={changeWidth} />
              <Stepper label="الارتفاع" value={editor.height} min={96} max={3200} onChange={changeHeight} />

              <button
                type="button"
                onClick={() => setEditor({ ...editor, lockRatio: !editor.lockRatio })}
                className="inline-flex items-center gap-2 rounded-lg border border-border/35 bg-card px-3 py-2 text-xs text-foreground hover:border-primary/40"
              >
                {editor.lockRatio ? <Lock className="h-3.5 w-3.5 text-primary" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}
                {editor.lockRatio ? "النسبة مقفلة" : "قفل النسبة"}
              </button>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">طريقة عرض الصورة</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["cover", "contain", "fill"] as ImageObjectFit[]).map((fit) => (
                    <button
                      type="button"
                      key={fit}
                      onClick={() => setEditor({ ...editor, objectFit: fit, zoom: fit === "cover" ? editor.zoom : 1 })}
                      className={`rounded-lg border px-2 py-2 text-[11px] ${
                        editor.objectFit === fit
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/35 bg-card text-muted-foreground"
                      }`}
                    >
                      object-{fit}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  cover يملأ الإطار، contain يحافظ على الصورة كاملة، fill يمددها داخل القياس.
                </p>
              </div>

              {editor.objectFit === "cover" && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Move className="h-3.5 w-3.5" /> اسحب الصورة داخل الإطار أو عدّل التقريب
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={editor.zoom}
                    onChange={(event) => setEditor({ ...editor, zoom: Number(event.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border border-border/35 bg-card px-3 py-2 text-xs text-foreground hover:border-primary/40">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
                <Button type="button" onClick={() => void applyEdits()} className="flex-1 gap-2">
                  <ImageIcon className="h-4 w-4" /> حفظ الصورة
                </Button>
                <button type="button" onClick={() => { setSource(null); setQueue([]); setEditor(null); }} className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-400">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/25 bg-card px-2 py-2">
      <p>{label}</p>
      <p className="mt-1 truncate font-medium text-foreground">{value}</p>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground">{label}</label>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onChange(value - 32)} className="rounded-md border border-border/30 p-1 text-muted-foreground hover:text-foreground">
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-16 rounded-md border border-border/30 bg-card px-2 py-1 text-center text-xs text-foreground">{value}px</span>
          <button type="button" onClick={() => onChange(value + 32)} className="rounded-md border border-border/30 p-1 text-muted-foreground hover:text-foreground">
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      <input type="range" min={min} max={max} step={16} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-primary" />
    </div>
  );
}

function maxSizeForKind(kind: ImageKind, settings?: Partial<ImageSettings>): number {
  if (kind === "product") return Number(settings?.productMaxSize ?? 1600);
  if (kind === "service") return Number(settings?.serviceMaxSize ?? 1600);
  if (kind === "gallery") return Number(settings?.galleryMaxSize ?? 1800);
  if (kind === "logo") return Number(settings?.logoMaxSize ?? 600);
  if (kind === "avatar") return 512;
  return 1600;
}

function initialEditor(kind: ImageKind, source: ImageMetadata, maxSize: number, settings?: Partial<ImageSettings>): EditorState {
  const configuredPreset = settings?.cropRatio && settings.cropRatio !== "free"
    ? presetFromRatio(settings.cropRatio)
    : DEFAULT_PRESET[kind];
  const defaultPreset = kind === "gallery" || kind === "attachment" ? configuredPreset : DEFAULT_PRESET[kind];
  const preset = PRESETS.find((item) => item.id === defaultPreset) ?? PRESETS[0];
  const dims = dimensionsForPreset(preset, source, maxSize);
  return {
    width: dims.width,
    height: dims.height,
    objectFit: kind === "logo" ? "contain" : preset.fit,
    lockRatio: preset.ratio !== null,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    preset: preset.id,
  };
}

function presetFromRatio(ratio: string): string {
  if (ratio === "1:1") return "square";
  if (ratio === "16:9") return "wide";
  if (ratio === "4:5") return "portrait";
  if (ratio === "21:9") return "banner";
  if (ratio === "9:16") return "story";
  return "custom";
}

function dimensionsForPreset(preset: Preset, source: ImageMetadata, maxSize: number) {
  const sourceWidth = Number(source.originalWidth || source.width || maxSize);
  const sourceHeight = Number(source.originalHeight || source.height || maxSize);
  const safeMax = clampDimension(maxSize || 1600, 96, 3200);
  if (preset.id === "custom" || !preset.ratio) {
    const scale = Math.min(1, safeMax / Math.max(sourceWidth, sourceHeight));
    return {
      width: clampDimension(Math.round(sourceWidth * scale)),
      height: clampDimension(Math.round(sourceHeight * scale)),
    };
  }
  if (preset.id === "logo") {
    return { width: clampDimension(safeMax), height: clampDimension(Math.round(safeMax / 2)) };
  }
  if (preset.ratio >= 1) {
    return { width: clampDimension(safeMax), height: clampDimension(Math.round(safeMax / preset.ratio)) };
  }
  return { width: clampDimension(Math.round(safeMax * preset.ratio)), height: clampDimension(safeMax) };
}

function processingOptions(
  editor: EditorState,
  cropRatio: string,
  settings?: Partial<ImageSettings>,
  watermarkText?: string,
): ImageProcessOptions {
  return {
    ...(settings ?? {}),
    targetWidth: editor.width,
    targetHeight: editor.height,
    objectFit: editor.objectFit,
    cropZoom: editor.zoom,
    cropOffsetX: editor.offsetX,
    cropOffsetY: editor.offsetY,
    cropRatio,
    maxSize: Math.max(editor.width, editor.height),
    watermarkText,
  };
}

function clampDimension(value: number, min = 96, max = 3200): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, Math.round(safe)));
}
