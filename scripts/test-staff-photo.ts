import assert from "node:assert/strict";
import { staffPhotoUpdateSchema } from "../src/server/staff-photo";

const schema = staffPhotoUpdateSchema({ storageUrl: "https://owned.supabase.co", bucket: "ajn-assets" });
assert.deepEqual(schema.parse({ fullName: "Legacy employee" }), {}, "omitted photo must preserve the current reference");
assert.deepEqual(schema.parse({ photoUrl: null }), { photoUrl: null }, "explicit null clears only the reference");
for (const photoUrl of ["/uploads/staff/photo.jpg", "https://owned.supabase.co/storage/v1/object/public/ajn-assets/staff/ab/photo-original.webp"]) {
  assert.deepEqual(schema.parse({ photoUrl }), { photoUrl });
}
for (const photoUrl of ["", "data:image/png;base64,abc", "blob:https://owned.supabase.co/abc", "javascript:alert(1)", "//evil.example/image.jpg", "https://evil.example/photo.jpg", "https://owned.supabase.co.evil.example/storage/v1/object/public/ajn-assets/photo.jpg", "https://owned.supabase.co/storage/v1/object/public/private/photo.jpg", "https://user@owned.supabase.co/storage/v1/object/public/ajn-assets/photo.jpg", "/uploads/../secret.jpg", "/uploads/%2e%2e/secret.jpg", "/uploads/%252e%252e/secret.jpg", "/uploads/photo.svg", "/uploads/photo.jpg?redirect=https://evil.example", "/uploads/photo.jpg#fragment", "/uploads/evil\\photo.jpg", 123, {}]) {
  assert.equal(schema.safeParse({ photoUrl }).success, false, `unsafe reference was accepted: ${String(photoUrl)}`);
}
assert.equal(staffPhotoUpdateSchema({ storageUrl: "", bucket: "ajn-assets" }).safeParse({ photoUrl: "/uploads/staff/photo.png" }).success, true);
assert.equal(staffPhotoUpdateSchema({ storageUrl: "", bucket: "ajn-assets" }).safeParse({ photoUrl: "https://owned.supabase.co/storage/v1/object/public/ajn-assets/photo.jpg" }).success, false);
console.log("PASS staff photo validation: existing uploaded references, omission, clearing, and unsafe URLs");
