import { bookingPhotoKey, bookingPhotoPreview, bookingPhotosFromFields } from "./booking-photos";

export type BookingWorkspacePhoto = {
  key: string;
  name: string;
  label: string;
  url: string;
  thumbnailUrl?: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** Stable product IDs only; department labels and variant IDs are not products. */
export function bookingPhotoProductIds(fields: Record<string, unknown>, items: Array<{ productId?: unknown }>): number[] {
  const ids = new Set<number>();
  const lines = [...items, ...["flowerItems", "giftItems", "videoItems", "soundItems"].flatMap(key => Array.isArray(fields[key]) ? fields[key] as unknown[] : [])];
  for (const line of lines) {
    const value = record(line).productId;
    if (typeof value !== "number" && typeof value !== "string") continue;
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    if (ids.size === 200) break;
  }
  return [...ids];
}

/** Display original booking uploads first. Catalogue photos never replace them. */
export function bookingWorkspacePhotos(source: "service" | "kosha", value: Record<string, unknown> | null | undefined, koshaImage?: string | null): BookingWorkspacePhoto[] {
  const raw = record(value);
  const fields = record(source === "kosha" ? raw.bookingDetails : raw.customFields);
  const seen = new Set<string>(koshaImage ? [koshaImage] : []);
  const photos: BookingWorkspacePhoto[] = [];
  const add = (photo: BookingWorkspacePhoto) => {
    if (!photo.url || seen.has(photo.url)) return;
    seen.add(photo.url);
    photos.push(photo);
  };
  bookingPhotosFromFields(fields).forEach((photo, index) => add({ key: `booking:${bookingPhotoKey(photo)}`, name: `صورة الحجز ${index + 1}`, label: "صورة مرفقة بالحجز", url: photo.url, thumbnailUrl: bookingPhotoPreview(photo) }));
  if (source === "service" && Array.isArray(raw.bookedProductPhotos)) {
    for (const value of raw.bookedProductPhotos) {
      const photo = record(value);
      add({ key: `product:${photo.productId}`, name: text(photo.name) || "منتج محجوز", label: "المنتج المحجوز", url: text(photo.imageUrl) });
    }
  }
  // A real primary-service FK is the only safe service catalogue fallback.
  // Combined bookings store department labels, not additional service IDs.
  if (source === "service" && !photos.length && !koshaImage && text(raw.serviceImage)) {
    add({ key: `service:${raw.serviceId}`, name: text(raw.serviceName) || "الخدمة المحجوزة", label: "الخدمة المحجوزة", url: text(raw.serviceImage) });
  }
  return photos;
}
