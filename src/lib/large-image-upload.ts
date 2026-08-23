import { dataUrlToFile, formatBytes, processImageFile } from "@/lib/image-tools";
import { IMAGE_UPLOAD_CONFIG, outputByteTarget, type ImageCompressionMode } from "@/lib/image-upload-config";

/** Maximum source selected on the device. The source is never uploaded as-is. */
export const MAX_IMAGE_UPLOAD_BYTES = IMAGE_UPLOAD_CONFIG.maxSourceBytes;
export const MAX_LOGO_UPLOAD_BYTES = IMAGE_UPLOAD_CONFIG.maxSourceBytes;
export const MAX_IMAGE_OUTPUT_BYTES = IMAGE_UPLOAD_CONFIG.maxOutputBytes;
export const MAX_LOGO_OUTPUT_BYTES = IMAGE_UPLOAD_CONFIG.maxLogoOutputBytes;
export const IMAGE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_TASK_FILE_UPLOAD_BYTES = 40 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/heic", "image/heif", "image/avif", "image/tiff", "image/svg+xml",
] as const;

export type StoredImageUpload = { originalUrl: string; thumbnailUrl: string; mediumUrl: string; largeUrl: string; checksum: string };
export type StoredFileUpload = { url: string; checksum: string; mime: string };
export type ImageUploadProgress = { percent: number; uploadedBytes: number; totalBytes: number; bytesPerSecond: number; remainingSeconds: number | null; phase: "original" | "optimizing" | "complete" };

export class ImageUploadError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); this.name = "ImageUploadError"; }
}

export function imageUploadFolder(kind: string): string {
  if (kind === "product" || kind.startsWith("product-")) return "products";
  if (kind === "gallery") return "gallery";
  if (kind === "logo") return "settings/logo";
  if (kind === "avatar") return "avatars";
  if (kind === "attachment") return "uploads/attachments";
  return "uploads/images";
}

export function imageMimeFromFile(file: File): string {
  const supplied = file.type.toLowerCase();
  if (ALLOWED_IMAGE_MIME_TYPES.includes(supplied as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) return supplied;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const fromExtension: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
    heic: "image/heic", heif: "image/heif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml",
  };
  return fromExtension[extension ?? ""] ?? supplied;
}

export async function validateImageUpload(file: File, maxBytes = MAX_IMAGE_UPLOAD_BYTES): Promise<string> {
  if (!file || file.size <= 0) throw new ImageUploadError("الملف فارغ. اختر صورة صالحة.");
  if (file.size > maxBytes) throw new ImageUploadError(maxBytes >= MAX_IMAGE_UPLOAD_BYTES ? "حجم الصورة أكبر من الحد المسموح (100 ميغابايت)." : "حجم الصورة الناتجة أكبر من الحد المسموح.");
  const mime = imageMimeFromFile(file);
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mime as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) throw new ImageUploadError("نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP أو GIF أو BMP أو AVIF أو HEIC أو TIFF أو SVG آمن.");
  if (mime === "image/svg+xml") {
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) throw new ImageUploadError("ملف SVG تالف أو غير صالح.");
    return mime;
  }
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!looksLikeSupportedImage(header)) throw new ImageUploadError("تعذر التحقق من ملف الصورة. اختر ملفاً غير تالف.");
  return mime;
}

function looksLikeSupportedImage(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  const isGif = ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
  const isBmp = ascii(0, 2) === "BM";
  const isTiff = (ascii(0, 2) === "II" && bytes[2] === 0x2a && bytes[3] === 0) || (ascii(0, 2) === "MM" && bytes[2] === 0 && bytes[3] === 0x2a);
  const isIsoImage = ascii(4, 8) === "ftyp" && /avif|avis|heic|heix|hevc|hevx|mif1/.test(ascii(8, 12).toLowerCase());
  return isJpeg || isPng || isWebp || isGif || isBmp || isTiff || isIsoImage;
}

async function checksum(file: File): Promise<string> {
  try {
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch { throw new ImageUploadError("تعذر تجهيز الصورة للرفع على هذا الجهاز. حاول بصورة أصغر.", true); }
}

const TASK_FILE_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

function taskFileMime(file: File): string {
  const supplied = file.type.toLowerCase();
  if (TASK_FILE_MIME_TYPES.has(supplied)) return supplied;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
  };
  return byExtension[extension ?? ""] ?? supplied;
}

export function isSupportedTaskFile(file: File): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.includes(imageMimeFromFile(file) as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])
    || TASK_FILE_MIME_TYPES.has(taskFileMime(file));
}

function sessionKey(folder: string, digest: string, suffix: string) { return `ajn:image-upload:${folder}:${digest}:${suffix}`; }

async function uploadRequest<T>(action: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/uploads/images/${action}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ImageUploadError("تعذر الاتصال بالتخزين. سيُحتفظ بالتقدم لإعادة المحاولة.", true);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ImageUploadError(String(data?.error || "تعذر رفع الصورة."), response.status >= 500 || response.status === 408);
  return data as T;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function uploadChunked(file: File, folder: string, suffix: string, mime: string, digest: string, signal: AbortSignal | undefined, onProgress: (uploaded: number) => void): Promise<string> {
  const key = sessionKey(folder, digest, suffix);
  let session = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
  let offset = 0;
  if (session) {
    const status = await uploadRequest<{ offset: number; url?: string }>("status", { session });
    if (status.url) return status.url;
    offset = Math.max(0, Number(status.offset ?? 0));
  } else {
    const started = await uploadRequest<{ session?: string; offset?: number; url?: string }>("init", { name: file.name, size: file.size, mime, checksum: digest, folder, suffix });
    if (started.url) return started.url;
    session = started.session ?? null; offset = Math.max(0, Number(started.offset ?? 0));
    if (!session) throw new ImageUploadError("تعذر بدء رفع الصورة إلى التخزين.", true);
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, session);
  }
  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const chunk = file.slice(offset, Math.min(file.size, offset + IMAGE_UPLOAD_CHUNK_BYTES));
    const response = await uploadRequest<{ offset: number; url?: string }>("chunk", { session, offset, chunk: await blobToBase64(chunk) }, signal);
    const nextOffset = Number(response.offset ?? 0);
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) throw new ImageUploadError("تعذر متابعة رفع الصورة. أعد المحاولة.", true);
    offset = nextOffset; onProgress(offset);
    if (response.url) { if (typeof window !== "undefined") window.sessionStorage.removeItem(key); return response.url; }
  }
  throw new ImageUploadError("اكتمل الإرسال لكن لم يتأكد التخزين. أعد المحاولة.", true);
}

export async function uploadImageWithVariants(file: File, options: {
  folder: string; maxBytes?: number; outputMaxBytes?: number; maxSize?: number; compressionMode?: ImageCompressionMode; preserveTransparency?: boolean;
  signal?: AbortSignal; onProgress?: (progress: ImageUploadProgress) => void;
}): Promise<StoredImageUpload> {
  await validateImageUpload(file, options.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES);
  const startedAt = performance.now();
  const emit = (uploadedBytes: number, totalBytes: number, phase: ImageUploadProgress["phase"]) => {
    const elapsed = Math.max(1, (performance.now() - startedAt) / 1000); const bytesPerSecond = uploadedBytes / elapsed; const remaining = Math.max(0, totalBytes - uploadedBytes);
    options.onProgress?.({ percent: Math.min(100, Math.round((uploadedBytes / Math.max(1, totalBytes)) * 100)), uploadedBytes, totalBytes, bytesPerSecond, remainingSeconds: bytesPerSecond > 0 ? Math.ceil(remaining / bytesPerSecond) : null, phase });
  };
  emit(0, Math.max(1, file.size), "optimizing");
  const outputLimit = options.outputMaxBytes ?? outputByteTarget(options.folder === "settings/logo" ? "logo" : "image");
  const primaryDataUrl = await processImageFile(file, {
    maxSize: options.maxSize ?? 2400, compression: true, compressionMode: options.compressionMode ?? "auto", maxBytes: outputLimit,
    preserveTransparency: options.preserveTransparency ?? /png|webp|svg/i.test(file.type),
  });
  const extension = primaryDataUrl.startsWith("data:image/png") ? "png" : "webp";
  const primary = await dataUrlToFile(primaryDataUrl, `${file.name.replace(/\.[^.]+$/, "")}-optimized.${extension}`);
  const mime = await validateImageUpload(primary, outputLimit);
  const digest = await checksum(primary); const totalBytes = Math.ceil(primary.size * 1.25);
  const originalUrl = await uploadChunked(primary, options.folder, "original", mime, digest, options.signal, (uploaded) => emit(uploaded, totalBytes, "original"));
  emit(primary.size, totalBytes, "optimizing");
  const uploaded: Record<string, string> = {}; let completedVariantBytes = 0;
  for (const [name, maxSize] of [["thumbnail", 300], ["medium", 1200], ["large", 2000]] as const) {
    if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const dataUrl = await processImageFile(primary, { maxSize, compression: true, quality: 0.86, maxBytes: outputLimit, preserveTransparency: /png|webp/i.test(primary.type) });
    const variant = await dataUrlToFile(dataUrl, `${file.name.replace(/\.[^.]+$/, "")}-${name}.${dataUrl.startsWith("data:image/png") ? "png" : "webp"}`);
    const variantMime = imageMimeFromFile(variant); const variantChecksum = await checksum(variant);
    uploaded[name] = await uploadChunked(variant, options.folder, name, variantMime, variantChecksum, options.signal, (bytes) => emit(primary.size + completedVariantBytes + bytes, totalBytes, "optimizing"));
    completedVariantBytes += variant.size;
  }
  emit(totalBytes, totalBytes, "complete");
  return { originalUrl, thumbnailUrl: uploaded.thumbnail, mediumUrl: uploaded.medium, largeUrl: uploaded.large, checksum: digest };
}

/**
 * Upload videos and documents through the existing resumable AJN/Supabase
 * pipeline. Images continue to use `uploadImageWithVariants` so thumbnails and
 * optimized variants are preserved.
 */
export async function uploadTaskFile(
  file: File,
  options: {
    folder?: string;
    signal?: AbortSignal;
    onProgress?: (progress: ImageUploadProgress) => void;
  } = {},
): Promise<StoredFileUpload> {
  if (!file || file.size <= 0) throw new ImageUploadError("الملف فارغ. اختر ملفاً صالحاً.");
  if (file.size > MAX_TASK_FILE_UPLOAD_BYTES)
    throw new ImageUploadError("حجم الملف أكبر من الحد المسموح (40 ميغابايت).");
  const mime = taskFileMime(file);
  if (!TASK_FILE_MIME_TYPES.has(mime))
    throw new ImageUploadError("نوع الملف غير مدعوم. استخدم فيديو MP4/WebM/MOV أو PDF/Word/Excel/Text.");
  const digest = await checksum(file);
  const startedAt = performance.now();
  const emit = (uploadedBytes: number, phase: ImageUploadProgress["phase"]) => {
    const elapsed = Math.max(1, (performance.now() - startedAt) / 1000);
    const bytesPerSecond = uploadedBytes / elapsed;
    const remaining = Math.max(0, file.size - uploadedBytes);
    options.onProgress?.({
      percent: Math.min(100, Math.round((uploadedBytes / Math.max(1, file.size)) * 100)),
      uploadedBytes,
      totalBytes: file.size,
      bytesPerSecond,
      remainingSeconds: bytesPerSecond > 0 ? Math.ceil(remaining / bytesPerSecond) : null,
      phase,
    });
  };
  emit(0, "original");
  const url = await uploadChunked(
    file,
    options.folder ?? "uploads/tasks",
    "original",
    mime,
    digest,
    options.signal,
    (uploaded) => emit(uploaded, "original"),
  );
  emit(file.size, "complete");
  return { url, checksum: digest, mime };
}

export function uploadProgressLabel(progress: ImageUploadProgress): string {
  const eta = progress.remainingSeconds === null ? "—" : progress.remainingSeconds < 60 ? `${progress.remainingSeconds} ث` : `${Math.ceil(progress.remainingSeconds / 60)} د`;
  return `${progress.percent}% · ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)} · ${formatBytes(progress.bytesPerSecond)}/ث · المتبقي ${eta}`;
}
