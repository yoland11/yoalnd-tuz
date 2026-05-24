import type { ImageSettings } from "@/lib/public-settings";

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
  cropRatio?: string;
  objectFit?: ImageObjectFit;
  cropZoom?: number;
  cropOffsetX?: number;
  cropOffsetY?: number;
  preset?: string;
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
};

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes?: number): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export async function dataUrlSize(dataUrl: string): Promise<number> {
  if (!dataUrl.startsWith("data:")) return 0;
  try {
    const response = await fetch(dataUrl);
    return (await response.blob()).size;
  } catch {
    const base64 = dataUrl.split(",")[1] ?? "";
    return Math.round((base64.length * 3) / 4);
  }
}

function mimeFromDataUrl(dataUrl: string): string {
  return dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/jpeg";
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    image.src = source;
  });
}

export async function inspectImageFile(file: File): Promise<ImageMetadata & { dataUrl: string }> {
  const dataUrl = await fileToDataUrl(file);
  if (!file.type.startsWith("image/") || typeof window === "undefined") {
    return {
      dataUrl,
      originalSize: file.size,
      originalType: file.type,
      width: 0,
      height: 0,
    };
  }
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
    };
  } catch {
    return {
      dataUrl,
      originalSize: file.size,
      originalType: file.type,
      width: 0,
      height: 0,
    };
  }
}

function cropDimensions(width: number, height: number, ratio: string) {
  if (!ratio || ratio === "free") return { sx: 0, sy: 0, sw: width, sh: height };
  const [rw, rh] = ratio.split(":").map(Number);
  if (!rw || !rh) return { sx: 0, sy: 0, sw: width, sh: height };
  const target = rw / rh;
  const current = width / height;
  if (current > target) {
    const sw = Math.round(height * target);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / target);
  return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

export async function processImageDataUrl(source: string, options: ImageProcessOptions = {}, sourceType = "image/jpeg"): Promise<string> {
  if (typeof window === "undefined") return source;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const targetWidth = Math.max(1, Math.round(Number(options.targetWidth ?? 0)));
      const targetHeight = Math.max(1, Math.round(Number(options.targetHeight ?? 0)));
      const hasTargetSize = targetWidth > 1 && targetHeight > 1;
      const objectFit = options.objectFit ?? "cover";
      const maxSize = options.maxSize ?? Math.max(1, Number(options.productMaxSize ?? 1600));
      const canvas = document.createElement("canvas");
      let width = targetWidth;
      let height = targetHeight;

      if (!hasTargetSize) {
        const crop = cropDimensions(image.width, image.height, options.cropRatio ?? "free");
        const scale = Math.min(1, maxSize / Math.max(crop.sw, crop.sh));
        width = Math.max(1, Math.round(crop.sw * scale));
        height = Math.max(1, Math.round(crop.sh * scale));
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(source);
          return;
        }
        ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
        drawWatermark(ctx, width, height, options);
        resolve(canvasToDataUrl(canvas, sourceType, options.quality));
        return;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(source);
        return;
      }
      ctx.clearRect(0, 0, width, height);

      if (objectFit === "fill") {
        ctx.drawImage(image, 0, 0, width, height);
      } else {
        const baseScale = objectFit === "contain"
          ? Math.min(width / image.width, height / image.height)
          : Math.max(width / image.width, height / image.height);
        const zoom = objectFit === "contain" ? 1 : Math.min(3, Math.max(1, Number(options.cropZoom ?? 1)));
        const scale = baseScale * zoom;
        const drawnWidth = image.width * scale;
        const drawnHeight = image.height * scale;
        const maxOffsetX = Math.max(0, (drawnWidth - width) / 2);
        const maxOffsetY = Math.max(0, (drawnHeight - height) / 2);
        const offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, Number(options.cropOffsetX ?? 0)));
        const offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, Number(options.cropOffsetY ?? 0)));
        const dx = (width - drawnWidth) / 2 + offsetX;
        const dy = (height - drawnHeight) / 2 + offsetY;
        ctx.drawImage(image, dx, dy, drawnWidth, drawnHeight);
      }

      drawWatermark(ctx, width, height, options);
      resolve(canvasToDataUrl(canvas, sourceType, options.quality));
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, options: ImageProcessOptions) {
  if (!options.watermark || !options.watermarkText) return;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.max(14, Math.round(width / 30))}px sans-serif`;
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.fillText(options.watermarkText, 16, height - 16);
  ctx.restore();
}

function canvasToDataUrl(canvas: HTMLCanvasElement, sourceType: string, quality?: number): string {
  const supportsWebp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  const sourceMime = sourceType || mimeFromDataUrl(canvas.toDataURL());
  const mime = supportsWebp ? "image/webp" : (sourceMime === "image/png" ? "image/png" : "image/jpeg");
  return canvas.toDataURL(mime, Math.min(0.95, Math.max(0.45, Number(quality ?? 0.82))));
}

export async function processImageFile(file: File, options: ImageProcessOptions = {}): Promise<string> {
  if (!file.type.startsWith("image/") || typeof window === "undefined") return fileToDataUrl(file);
  const source = await fileToDataUrl(file);
  if (options.compression === false && !options.targetWidth && !options.targetHeight && !options.cropRatio && !options.watermark) return source;
  return processImageDataUrl(source, options, file.type);
}
