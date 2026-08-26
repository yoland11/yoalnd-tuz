export type BookingPhoto = {
  url: string;
  thumbnailUrl?: string | null;
  mediumUrl?: string | null;
  largeUrl?: string | null;
  checksum?: string | null;
  addedAt?: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBookingPhoto(value: unknown): BookingPhoto | null {
  if (typeof value === "string") {
    const url = text(value);
    return url ? { url } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const url = text(
    record.url || record.originalUrl || record.largeUrl || record.mediumUrl,
  );
  if (!url) return null;
  return {
    url,
    thumbnailUrl: text(record.thumbnailUrl) || null,
    mediumUrl: text(record.mediumUrl) || null,
    largeUrl: text(record.largeUrl) || null,
    checksum: text(record.checksum) || null,
    addedAt: text(record.addedAt) || null,
  };
}

/** Reads the new gallery while retaining the previous single-image field. */
export function bookingPhotosFromFields(
  fields: Record<string, unknown> | null | undefined,
): BookingPhoto[] {
  const source = Array.isArray(fields?.bookingPhotos)
    ? fields.bookingPhotos
    : [];
  const legacy = fields?.bookingImage ? [fields.bookingImage] : [];
  const seen = new Set<string>();
  return [...source, ...legacy].flatMap((value) => {
    const photo = normalizeBookingPhoto(value);
    if (!photo) return [];
    const key = photo.checksum || photo.url;
    if (seen.has(key)) return [];
    seen.add(key);
    return [photo];
  });
}

export function bookingPhotoKey(photo: BookingPhoto): string {
  return photo.checksum || photo.url;
}

export function bookingPhotoPreview(photo: BookingPhoto): string {
  return photo.thumbnailUrl || photo.mediumUrl || photo.largeUrl || photo.url;
}

export function isStoredBookingPhoto(photo: BookingPhoto): boolean {
  return /^(https?:\/\/|\/)/i.test(photo.url) && !/^(data:|blob:)/i.test(photo.url);
}

/**
 * Persists only storage-backed URLs. The legacy first-image alias is kept so
 * older booking consumers continue to work without a data migration.
 */
export function fieldsWithBookingPhotos(
  fields: Record<string, unknown>,
  photos: BookingPhoto[],
): Record<string, unknown> {
  return {
    ...fields,
    bookingPhotos: photos,
    bookingImage: photos[0] ?? null,
  };
}
