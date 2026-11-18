import { receiptHtmlToPng } from "./receipt-image";
import { IMAGE_UPLOAD_CONFIG } from "./image-upload-config";
import { bookingShareCardHtml, bookingSharePhotoPages, bookingShareItems, type ShareBooking, type SharePhoto } from "./booking-share";

const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("تم إلغاء التجهيز", "AbortError"); };
const MAX_IMAGE_UPLOAD_BYTES = IMAGE_UPLOAD_CONFIG.maxSourceBytes;

/** Fetch only the already authorized image URL in the browser; never publish a private file URL. */
export async function readBookingSharePhoto(photo: SharePhoto, signal: AbortSignal): Promise<string> {
  const url = new URL(photo.url, window.location.origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error(`رابط صورة ${photo.name} غير صالح`);
  const response = await fetch(url.href, { signal, credentials: url.origin === window.location.origin ? "same-origin" : "omit" });
  if (!response.ok) throw Error(`تعذر تحميل صورة ${photo.name} (HTTP ${response.status})`);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_UPLOAD_BYTES) throw Error(`حجم صورة ${photo.name} أكبر من الحد المسموح`);
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(blob.type) || !blob.size || blob.size > MAX_IMAGE_UPLOAD_BYTES) throw Error(`ملف صورة ${photo.name} غير صالح للمشاركة`);
  cancelled(signal);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error(`تعذرت قراءة صورة ${photo.name}`)); reader.readAsDataURL(blob);
  });
  await new Promise<void>((resolve, reject) => {
    const image = new Image(); image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(Error(`صورة ${photo.name} تالفة`));
    image.onerror = () => reject(Error(`تعذر فك صورة ${photo.name}`)); image.src = dataUrl;
  });
  cancelled(signal);
  return dataUrl;
}

export async function prepareBookingShareCards(input: {
  booking: ShareBooking; financial: boolean; note: string; photos: readonly SharePhoto[];
  signal: AbortSignal; onProgress: (completed: number, total: number) => void;
}, adapters = { loadPhoto: readBookingSharePhoto, render: receiptHtmlToPng }): Promise<File[]> {
  const pages = bookingSharePhotoPages(input.photos), files: File[] = [];
  while (pages.length < Math.ceil(bookingShareItems(input.booking).length / 20)) pages.push([]);
  const total = input.photos.length + pages.length; let completed = 0;
  input.onProgress(0, total);
  for (const [index, page] of pages.entries()) {
    const photos = [];
    for (const photo of page) {
      cancelled(input.signal);
      photos.push({ ...photo, dataUrl: await adapters.loadPhoto(photo, input.signal) });
      input.onProgress(++completed, total);
    }
    cancelled(input.signal);
    const blob = await adapters.render(bookingShareCardHtml(input.booking, input.financial, input.note, photos, index + 1, pages.length));
    cancelled(input.signal);
    const name = input.booking.number.replace(/[^\p{L}\p{N}_-]/gu, "-").slice(0, 70) || "booking";
    files.push(new File([blob], `${name}-${index + 1}.png`, { type: "image/png" }));
    input.onProgress(++completed, total);
  }
  return files;
}
