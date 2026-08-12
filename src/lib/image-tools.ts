import type { ImageSettings } from "@/lib/public-settings";
import {
  IMAGE_UPLOAD_CONFIG,
  type ImageCompressionMode,
  compressionQuality,
} from "@/lib/image-upload-config";

export type ImageObjectFit = "cover" | "contain" | "fill";

export type ImageMetadata = {
  originalWidth?: number;
  originalHeight?: number;
  originalSize?: number;
  originalType?: string;
  width?: number;
  height?: number;
  processedSize?: number;
  processedType?: string;
  compressionMode?: ImageCompressionMode;
  animationFlattened?: boolean;
  cropRatio?: string;
  objectFit?: ImageObjectFit;
  cropZoom?: number;
  cropOffsetX?: number;
  cropOffsetY?: number;
  preset?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  mediumUrl?: string;
  largeUrl?: string;
  checksum?: string;
  updatedAt?: string;
};

export type ImageProcessOptions = Partial<ImageSettings> & {
  maxSize?: number;
  targetWidth?: number;
  targetHeight?: number;
  objectFit?: ImageObjectFit;
  cropZoom?: number;
  cropOffsetX?: number;
  cropOffsetY?: number;
  watermarkText?: string;
  compressionMode?: ImageCompressionMode;
  maxBytes?: number;
  preserveTransparency?: boolean;
};

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Convert an editor data URL without issuing a network request. `fetch(data:)`
 * is blocked by AJN's intentionally strict connect-src CSP, and a data URL is
 * already local browser data—not an upload endpoint.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/is.exec(dataUrl);
  if (!match) throw new Error("تعذر إنشاء ملف الصورة");
  const type = match[1] || "application/octet-stream";
  const encoded = match[3] ?? "";
  try {
    if (match[2]) {
      const binary = atob(encoded.replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const blob = new Blob([bytes], { type });
      if (blob.size <= 0) throw new Error("empty image blob");
      return blob;
    }
    const blob = new Blob([decodeURIComponent(encoded)], { type });
    if (blob.size <= 0) throw new Error("empty image blob");
    return blob;
  } catch {
    throw new Error("تعذر إنشاء ملف الصورة");
  }
}

export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], name, { type: blob.type || "image/webp" });
}

export function formatBytes(bytes?: number): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export async function dataUrlSize(dataUrl: string): Promise<number> {
  if (!dataUrl.startsWith("data:")) return 0;
  return dataUrlToBlob(dataUrl).size;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    image.src = source;
  });
}

function imageExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function isHeic(file: File) {
  return ["image/heic", "image/heif"].includes(file.type.toLowerCase()) || ["heic", "heif"].includes(imageExtension(file));
}

function isSvg(file: File) {
  return file.type.toLowerCase() === "image/svg+xml" || imageExtension(file) === "svg";
}

/** Reject active or externally-referenced SVG before it is ever previewed. */
export async function sanitizeSvgFile(file: File): Promise<File> {
  const source = await file.text();
  if (source.length === 0 || source.length > 4 * 1024 * 1024 || !/<svg[\s>]/i.test(source)) throw new Error("ملف SVG تالف أو غير صالح.");
  const unsafe = /<(?:script|foreignObject|iframe|object|embed|link|use|audio|video)\b|\son[a-z]+\s*=|javascript\s*:|\b(?:href|xlink:href)\s*=\s*["']\s*(?!#)|url\s*\(\s*(?!\s*['"]?#)/i;
  if (unsafe.test(source)) throw new Error("ملف SVG يحتوي على محتوى غير آمن.");
  const clean = source.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[\s\S]*?\?>/gi, "");
  return new File([clean], file.name.replace(/\.[^.]+$/, ".svg"), { type: "image/svg+xml" });
}

async function normalizeDecodableImage(file: File): Promise<File> {
  if (isSvg(file)) return sanitizeSvgFile(file);
  if (!isHeic(file)) return file;
  const preview = URL.createObjectURL(file);
  try {
    await loadImage(preview);
    return file;
  } catch {
    const converter = (await import("heic2any")).default;
    const converted = await converter({ blob: file, toType: "image/png", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error("تعذر تحويل صورة HEIC/HEIF على هذا الجهاز.");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(preview);
  }
}

export async function inspectImageFile(file: File): Promise<ImageMetadata & { dataUrl: string }> {
  const normalized = await normalizeDecodableImage(file);
  const dataUrl = typeof URL !== "undefined" ? URL.createObjectURL(normalized) : await fileToDataUrl(normalized);
  if (typeof window === "undefined") return { dataUrl, originalSize: file.size, originalType: file.type, width: 0, height: 0 };
  try {
    const image = await loadImage(dataUrl);
    return {
      dataUrl,
      originalWidth: image.width,
      originalHeight: image.height,
      originalSize: file.size,
      originalType: file.type,
      width: image.width,
      height: image.height,
      animationFlattened: file.type === "image/gif" || imageExtension(file) === "gif",
    };
  } catch {
    URL.revokeObjectURL(dataUrl);
    throw new Error("تعذر قراءة الصورة أو تحويلها على هذا الجهاز.");
  }
}

function cropDimensions(width: number, height: number, ratio: string) {
  if (!ratio || ratio === "free") return { sx: 0, sy: 0, sw: width, sh: height };
  const [rw, rh] = ratio.split(":").map(Number);
  if (!rw || !rh) return { sx: 0, sy: 0, sw: width, sh: height };
  const target = rw / rh;
  if (width / height > target) {
    const sw = Math.round(height * target);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / target);
  return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

function outputMime(sourceType: string, options: ImageProcessOptions) {
  const alphaSource = options.preserveTransparency || /png|webp|svg/i.test(sourceType);
  const probe = document.createElement("canvas");
  const webp = probe.toDataURL("image/webp").startsWith("data:image/webp");
  if (alphaSource) return webp ? "image/webp" : "image/png";
  return webp ? "image/webp" : "image/jpeg";
}

function constrainDimensions(width: number, height: number) {
  const dimensionScale = Math.min(1, IMAGE_UPLOAD_CONFIG.maxCanvasDimension / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(IMAGE_UPLOAD_CONFIG.maxCanvasPixels / Math.max(1, width * height)));
  const scale = Math.min(dimensionScale, pixelScale);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, options: ImageProcessOptions) {
  if (!options.watermark || !options.watermarkText) return;
  ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = "#fff"; ctx.font = `${Math.max(14, Math.round(width / 30))}px sans-serif`;
  ctx.textAlign = "left"; ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 4; ctx.fillText(options.watermarkText, 16, height - 16); ctx.restore();
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number) {
  return canvas.toDataURL(mime, Math.min(0.95, Math.max(0.45, quality)));
}

export async function processImageDataUrl(source: string, options: ImageProcessOptions = {}, sourceType = "image/jpeg"): Promise<string> {
  if (typeof window === "undefined") return source;
  const image = await loadImage(source);
  const requestedWidth = Math.round(Number(options.targetWidth ?? 0));
  const requestedHeight = Math.round(Number(options.targetHeight ?? 0));
  const hasTargetSize = requestedWidth > 1 && requestedHeight > 1;
  const maxSize = Math.max(1, Number(options.maxSize ?? options.productMaxSize ?? 1600));
  const crop = hasTargetSize ? null : cropDimensions(image.width, image.height, options.cropRatio ?? "free");
  const baseWidth = hasTargetSize ? requestedWidth : Math.round((crop?.sw ?? image.width) * Math.min(1, maxSize / Math.max(crop?.sw ?? image.width, crop?.sh ?? image.height)));
  const baseHeight = hasTargetSize ? requestedHeight : Math.round((crop?.sh ?? image.height) * Math.min(1, maxSize / Math.max(crop?.sw ?? image.width, crop?.sh ?? image.height)));
  const target = constrainDimensions(baseWidth, baseHeight);
  const canvas = document.createElement("canvas");
  canvas.width = target.width; canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز الصورة على هذا الجهاز.");
  ctx.clearRect(0, 0, target.width, target.height);
  if (!hasTargetSize) {
    ctx.drawImage(image, crop!.sx, crop!.sy, crop!.sw, crop!.sh, 0, 0, target.width, target.height);
  } else if ((options.objectFit ?? "cover") === "fill") {
    ctx.drawImage(image, 0, 0, target.width, target.height);
  } else {
    const contain = (options.objectFit ?? "cover") === "contain";
    const baseScale = contain ? Math.min(target.width / image.width, target.height / image.height) : Math.max(target.width / image.width, target.height / image.height);
    const zoom = contain ? 1 : Math.min(3, Math.max(1, Number(options.cropZoom ?? 1)));
    const drawnWidth = image.width * baseScale * zoom; const drawnHeight = image.height * baseScale * zoom;
    const maxX = Math.max(0, (drawnWidth - target.width) / 2); const maxY = Math.max(0, (drawnHeight - target.height) / 2);
    const offsetX = Math.max(-maxX, Math.min(maxX, Number(options.cropOffsetX ?? 0)));
    const offsetY = Math.max(-maxY, Math.min(maxY, Number(options.cropOffsetY ?? 0)));
    ctx.drawImage(image, (target.width - drawnWidth) / 2 + offsetX, (target.height - drawnHeight) / 2 + offsetY, drawnWidth, drawnHeight);
  }
  drawWatermark(ctx, target.width, target.height, options);
  const mime = outputMime(sourceType, options);
  const targetBytes = Number(options.maxBytes ?? 0);
  let quality = options.quality ?? compressionQuality(options.compressionMode ?? "auto");
  let result = canvasToDataUrl(canvas, mime, quality);
  while (targetBytes > 0 && await dataUrlSize(result) > targetBytes && quality > 0.5) {
    quality = Math.max(0.5, quality - 0.07);
    result = canvasToDataUrl(canvas, mime, quality);
  }
  return result;
}

export async function processImageFile(file: File, options: ImageProcessOptions = {}): Promise<string> {
  if (typeof window === "undefined") return fileToDataUrl(file);
  const normalized = await normalizeDecodableImage(file);
  const source = URL.createObjectURL(normalized);
  try {
    return await processImageDataUrl(source, options, normalized.type || file.type);
  } finally {
    URL.revokeObjectURL(source);
  }
}
