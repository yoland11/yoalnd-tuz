import { formatBytes, processImageFile } from "@/lib/image-tools";

/** Shared client limits for every AJN image picker.  The server enforces them too. */
export const MAX_IMAGE_UPLOAD_BYTES = 40 * 1024 * 1024;
export const IMAGE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
] as const;

export type StoredImageUpload = {
  originalUrl: string;
  thumbnailUrl: string;
  mediumUrl: string;
  largeUrl: string;
  checksum: string;
};

export type ImageUploadProgress = {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  remainingSeconds: number | null;
  phase: "original" | "optimizing" | "complete";
};

export class ImageUploadError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "ImageUploadError";
  }
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
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "avif") return "image/avif";
  return supplied;
}

export async function validateImageUpload(file: File): Promise<string> {
  if (!file || file.size <= 0) throw new ImageUploadError("الملف فارغ. اختر صورة صالحة.");
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new ImageUploadError("The maximum allowed image size is 40 MB.");
  const mime = imageMimeFromFile(file);
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mime as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    throw new ImageUploadError("نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP أو HEIC أو AVIF.");
  }
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!looksLikeSupportedImage(header)) throw new ImageUploadError("تعذر التحقق من ملف الصورة. اختر ملفاً غير تالف.");
  return mime;
}

function looksLikeSupportedImage(bytes: Uint8Array): boolean {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  const brand = ascii(8, 12).toLowerCase();
  const isIsoImage = ascii(4, 8) === "ftyp" && /avif|avis|heic|heix|hevc|hevx|mif1/.test(brand);
  return isJpeg || isPng || isWebp || isIsoImage;
}

// SHA-256 over the whole file. Reads in slices so a 40 MB file is never fully
// materialised as one ArrayBuffer (which can throw/OOM on constrained devices);
// falls back to a single digest where incremental hashing is unavailable.
async function checksum(file: File): Promise<string> {
  try {
    const CHUNK = 8 * 1024 * 1024;
    if (file.size <= CHUNK) {
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return hex(hash);
    }
    // Incremental streaming digest via Web Streams when the platform supports it.
    // DigestStream is non-standard; accessed defensively and guarded below.
    const DigestStreamCtor = typeof globalThis !== "undefined" ? (globalThis as any).DigestStream : undefined;
    if (typeof DigestStreamCtor === "function") {
      const stream = new DigestStreamCtor("SHA-256");
      await file.stream().pipeTo(stream.writable);
      return hex(await stream.digest);
    }
    // Portable fallback: hash slices, then hash the concatenation of slice hashes.
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      const slice = await file.slice(offset, Math.min(file.size, offset + CHUNK)).arrayBuffer();
      parts.push(new Uint8Array(await crypto.subtle.digest("SHA-256", slice)));
    }
    const combined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { combined.set(p, at); at += p.length; }
    return hex(await crypto.subtle.digest("SHA-256", combined));
  } catch (cause) {
    throw new ImageUploadError("تعذر قراءة الملف على هذا الجهاز، قد تكون الصورة كبيرة جداً. جرّب صورة أصغر.", true);
  }
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function sessionKey(folder: string, digest: string, suffix: string) {
  return `ajn:image-upload:${folder}:${digest}:${suffix}`;
}

async function uploadChunked(
  file: File,
  folder: string,
  suffix: string,
  mime: string,
  digest: string,
  signal: AbortSignal | undefined,
  onProgress: (uploaded: number) => void,
): Promise<string> {
  const key = sessionKey(folder, digest, suffix);
  let session = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
  let offset = 0;
  let alreadyUrl: string | null = null;

  if (session) {
    const status = await uploadRequest<{ offset: number; url?: string }>("status", { session });
    if (status.url) return status.url;
    offset = Math.max(0, Number(status.offset ?? 0));
  } else {
    const started = await uploadRequest<{ session?: string; offset?: number; url?: string }>("init", {
      name: file.name,
      size: file.size,
      mime,
      checksum: digest,
      folder,
      suffix,
    });
    alreadyUrl = started.url ?? null;
    if (alreadyUrl) return alreadyUrl;
    session = started.session ?? null;
    offset = Math.max(0, Number(started.offset ?? 0));
    if (!session) throw new ImageUploadError("تعذر بدء رفع الصورة إلى التخزين.", true);
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, session);
  }

  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const chunk = file.slice(offset, Math.min(file.size, offset + IMAGE_UPLOAD_CHUNK_BYTES));
    const payload = await blobToBase64(chunk);
    const response = await uploadRequest<{ offset: number; url?: string }>("chunk", { session, offset, chunk: payload }, signal);
    const nextOffset = Number(response.offset ?? 0);
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) throw new ImageUploadError("تعذر متابعة رفع الصورة. أعد المحاولة.", true);
    offset = nextOffset;
    onProgress(offset);
    if (response.url) {
      if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
      return response.url;
    }
  }
  throw new ImageUploadError("اكتمل الإرسال لكن لم يتأكد التخزين. أعد المحاولة.", true);
}

async function uploadRequest<T>(action: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/uploads/images/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ImageUploadError("تعذر الاتصال بالتخزين. سيتم الاحتفاظ بالتقدم لإعادة المحاولة.", true);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ImageUploadError(String(data?.error || "تعذر رفع الصورة."), response.status >= 500 || response.status === 408);
  return data as T;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/webp" });
}

export async function uploadImageWithVariants(
  file: File,
  options: {
    folder: string;
    signal?: AbortSignal;
    onProgress?: (progress: ImageUploadProgress) => void;
  },
): Promise<StoredImageUpload> {
  const mime = await validateImageUpload(file);
  const digest = await checksum(file);
  const startedAt = performance.now();
  const emit = (uploadedBytes: number, totalBytes: number, phase: ImageUploadProgress["phase"]) => {
    const elapsed = Math.max(1, (performance.now() - startedAt) / 1000);
    const bytesPerSecond = uploadedBytes / elapsed;
    const remaining = Math.max(0, totalBytes - uploadedBytes);
    options.onProgress?.({
      percent: Math.min(100, Math.round((uploadedBytes / Math.max(1, totalBytes)) * 100)),
      uploadedBytes,
      totalBytes,
      bytesPerSecond,
      remainingSeconds: bytesPerSecond > 0 ? Math.ceil(remaining / bytesPerSecond) : null,
      phase,
    });
  };

  // Original gets the majority of the visual progress; variants are generated and
  // uploaded sequentially so a mobile browser never holds multiple canvases at once.
  const originalUrl = await uploadChunked(file, options.folder, "original", mime, digest, options.signal, (uploaded) => emit(uploaded, file.size * 1.25, "original"));
  emit(file.size, file.size * 1.25, "optimizing");

  const variants = [
    ["thumbnail", 300],
    ["medium", 1200],
    ["large", 2000],
  ] as const;
  const uploaded: Record<string, string> = {};
  let completedVariantBytes = 0;
  for (const [name, maxSize] of variants) {
    if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const dataUrl = await processImageFile(file, { maxSize, compression: true, quality: 0.86 });
    const variant = await dataUrlToFile(dataUrl, `${file.name.replace(/\.[^.]+$/, "")}-${name}.webp`);
    const variantMime = imageMimeFromFile(variant);
    const variantChecksum = await checksum(variant);
    uploaded[name] = await uploadChunked(variant, options.folder, name, variantMime, variantChecksum, options.signal, (bytes) => {
      emit(file.size + completedVariantBytes + bytes, file.size * 1.25, "optimizing");
    });
    completedVariantBytes += variant.size;
  }
  emit(file.size * 1.25, file.size * 1.25, "complete");
  return { originalUrl, thumbnailUrl: uploaded.thumbnail, mediumUrl: uploaded.medium, largeUrl: uploaded.large, checksum: digest };
}

export function uploadProgressLabel(progress: ImageUploadProgress): string {
  const eta = progress.remainingSeconds === null ? "—" : progress.remainingSeconds < 60 ? `${progress.remainingSeconds} ث` : `${Math.ceil(progress.remainingSeconds / 60)} د`;
  return `${progress.percent}% · ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)} · ${formatBytes(progress.bytesPerSecond)}/ث · المتبقي ${eta}`;
}
