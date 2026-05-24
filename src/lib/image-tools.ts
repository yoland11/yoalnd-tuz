import type { ImageSettings } from "@/lib/public-settings";

export type ImageProcessOptions = Partial<ImageSettings> & {
  maxSize?: number;
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

export async function processImageFile(file: File, options: ImageProcessOptions = {}): Promise<string> {
  if (!file.type.startsWith("image/") || typeof window === "undefined") return fileToDataUrl(file);
  const source = await fileToDataUrl(file);
  if (options.compression === false && !options.cropRatio && !options.watermark) return source;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const crop = cropDimensions(image.width, image.height, options.cropRatio ?? "free");
      const maxSize = options.maxSize ?? Math.max(1, Number(options.productMaxSize ?? 1600));
      const scale = Math.min(1, maxSize / Math.max(crop.sw, crop.sh));
      const width = Math.max(1, Math.round(crop.sw * scale));
      const height = Math.max(1, Math.round(crop.sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(source);
        return;
      }
      ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
      if (options.watermark && options.watermarkText) {
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
      const supportsWebp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
      const mime = supportsWebp ? "image/webp" : (file.type === "image/png" ? "image/png" : "image/jpeg");
      resolve(canvas.toDataURL(mime, Math.min(0.95, Math.max(0.45, Number(options.quality ?? 0.82)))));
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
}
