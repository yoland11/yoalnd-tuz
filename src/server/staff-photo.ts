import { z } from "zod/v4";

type PhotoStorage = { storageUrl: string; bucket: string };

function isStaffPhotoReference(value: string, storage: PhotoStorage): boolean {
  if (/[\s\\?#\u0000-\u001f]/.test(value)) return false;
  let path: string;
  if (value.startsWith("/uploads/")) {
    path = value.slice("/uploads/".length);
  } else {
    try {
      const url = new URL(value);
      const ownedStorage = new URL(storage.storageUrl);
      const prefix = `/storage/v1/object/public/${storage.bucket}/`;
      if (url.protocol !== "https:" || url.origin !== ownedStorage.origin || url.username || url.password || !url.pathname.startsWith(prefix)) return false;
      path = url.pathname.slice(prefix.length);
    } catch {
      return false;
    }
  }
  // Uploads use image files. Reject encoded separators/traversal and active SVG.
  try {
    for (let depth = 0; depth < 3 && path.includes("%"); depth++) path = decodeURIComponent(path);
  } catch {
    return false;
  }
  return !/[\\%?#\u0000-\u001f]/.test(path) && path.split("/").every((part) => part !== ".." && part !== "." && part !== "") && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(path);
}

/** Omitted PATCH fields preserve the reference; null removes it without deleting media. */
export function staffPhotoUpdateSchema(storage: PhotoStorage) {
  return z.object({
    photoUrl: z.string().trim().min(1).max(2000).refine((value) => isStaffPhotoReference(value, storage), "صورة الموظف يجب أن تكون من الصور المرفوعة إلى النظام").nullable().optional(),
  });
}
