/**
 * One place for browser image-input and generated-upload limits.  Source files
 * never leave the browser until they have been converted to one of the safe
 * output formats below.
 */
export const IMAGE_UPLOAD_CONFIG = {
  maxSourceBytes: 100 * 1024 * 1024,
  maxOutputBytes: 8 * 1024 * 1024,
  maxLogoOutputBytes: 2 * 1024 * 1024,
  maxCanvasPixels: 24_000_000,
  maxCanvasDimension: 8_192,
} as const;

export type ImageCompressionMode = "auto" | "maximum" | "high" | "balanced" | "small";

export const IMAGE_COMPRESSION_OPTIONS: Array<{ value: ImageCompressionMode; label: string; quality: number }> = [
  { value: "auto", label: "تلقائي", quality: 0.84 },
  { value: "maximum", label: "أعلى جودة", quality: 0.93 },
  { value: "high", label: "جودة عالية", quality: 0.89 },
  { value: "balanced", label: "متوازن", quality: 0.82 },
  { value: "small", label: "حجم صغير", quality: 0.72 },
];

export const SUPPORTED_IMAGE_INPUT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/svg+xml",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".svg",
].join(",");

export function compressionQuality(mode: ImageCompressionMode): number {
  return IMAGE_COMPRESSION_OPTIONS.find((option) => option.value === mode)?.quality ?? 0.84;
}

export function outputByteTarget(kind: string): number {
  return kind === "logo" ? IMAGE_UPLOAD_CONFIG.maxLogoOutputBytes : IMAGE_UPLOAD_CONFIG.maxOutputBytes;
}
