import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { bookingWorkspacePhotos, bookingPhotoProductIds } from "../src/lib/booking-workspace-photos";

const raw = {
  serviceName: "حجز تصوير", serviceImage: "/service.jpg",
  customFields: {
    bookingPhotos: [{ url: "/original.jpg", thumbnailUrl: "/thumb.jpg", checksum: "one" }, { url: "/duplicate.jpg", checksum: "one" }],
    bookingImage: { url: "/original.jpg", checksum: "one" },
  },
  bookedProductPhotos: [{ productId: 8, name: "باقة ورد", imageUrl: "/flowers.jpg" }, { productId: 9, name: "ورود مشتركة", imageUrl: "/flowers.jpg" }],
};
const photos = bookingWorkspacePhotos("service", raw);
assert.equal(photos.length, 2);
assert.equal(photos[0].url, "/original.jpg");
assert.equal(photos[0].thumbnailUrl, "/thumb.jpg");
assert.match(photos[0].label, /مرفقة/);
assert.equal(photos[1].name, "باقة ورد");
assert.equal(photos[1].label, "المنتج المحجوز");
assert.deepEqual(bookingWorkspacePhotos("service", { serviceName: "صوتيات", serviceImage: "/sound.jpg" }).map(photo => photo.url), ["/sound.jpg"]);
assert.equal(bookingWorkspacePhotos("service", { serviceImage: "/generic-kosha.jpg" }, "/actual-kosha.jpg").length, 0);
assert.equal(bookingWorkspacePhotos("service", raw, "/original.jpg").length, 1);
assert.equal(bookingWorkspacePhotos("service", { customFields: { bookingImage: "/legacy.jpg" } })[0].url, "/legacy.jpg");
assert.equal(bookingWorkspacePhotos("kosha", { bookingDetails: { bookingPhotos: [{ originalUrl: "/native.jpg" }] } })[0].url, "/native.jpg");
assert.equal(bookingWorkspacePhotos("service", { customFields: {}, bookingDetails: { bookingImage: "/wrong-source.jpg" } }).length, 0);
assert.deepEqual(bookingWorkspacePhotos("service", {}), []);
assert.deepEqual(bookingPhotoProductIds({ flowerItems: [{ productId: "4", variantId: 99 }], giftItems: [{ productId: 5 }], soundItems: [{ productId: 4 }, { productId: true }], videoItems: [{ productId: -1 }], photographyItems: [{ id: 90, name: "ليس معرف منتج" }] }, [{ productId: 3 }, { productId: null }]), [3, 4, 5]);
assert.equal(bookingPhotoProductIds({ soundItems: Array.from({ length: 250 }, (_, i) => ({ productId: i + 1 })) }, []).length, 200);

// Run the actual bounded catalogue projection. Inactive historical products
// remain readable and database failures must reach the structured API handler.
const api = readFileSync("src/server/api.ts", "utf8");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const projection = api.slice(api.indexOf("async function bookingServiceProductPhotos("), api.indexOf("\nasync function saveBookingOperations("));
const code = esbuild.transformSync(projection + "\nreturn bookingServiceProductPhotos;", { loader: "ts" }).code;
const table = { id: "products.id", name: "products.name", nameAr: "products.name_ar", images: "products.images", updatedAt: "products.updated_at" };
let queries = 0, failure: Error | null = null;
const db = { select() { queries++; return { from(value: unknown) { assert.equal(value, table); return { where(value: unknown) { assert.deepEqual(value, ["products.id", [3, 4, 5]]); return { async limit(count: number) { assert.equal(count, 200); if (failure) throw failure; return [{ id: 5, name: "gift", nameAr: "هدية", images: ["data:image/png;base64,five"], isActive: false }, { id: 3, name: "صوت", nameAr: "", images: ["data:image/png;base64,three"] }, { id: 4, name: "ورد", images: [] }]; } }; } }; } }; } };
const reader = new Function("db", "productsTable", "inArray", "publicMediaList", "bookingPhotoProductIds", code)(db, table, (key: unknown, ids: number[]) => [key, ids], (kind: string, product: { id: number }, images: string[]) => images.map(() => `/api/media/${kind}/${product.id}`), bookingPhotoProductIds);
assert.deepEqual(await reader({ giftItems: [{ productId: 5 }], flowerItems: [{ productId: 4 }] }, [{ productId: 3 }]), [{ productId: 3, name: "صوت", imageUrl: "/api/media/product/3" }, { productId: 5, name: "هدية", imageUrl: "/api/media/product/5" }]);
assert.equal(queries, 1);
assert.deepEqual(await reader({}, []), []);
assert.equal(queries, 1);
failure = new Error("selected product lookup failed");
await assert.rejects(reader({ flowerItems: [{ productId: 4 }, { productId: 5 }] }, [{ productId: 3 }]), /selected product lookup failed/);
assert.match(api, /serviceImage: service \? publicMediaValue\("service", service, service.image\) : null/);
assert.match(api, /const bookedProductPhotos = await bookingServiceProductPhotos\(\(row.customFields \?\? \{\}\)/);
console.log("PASS all booking photo sources: original uploads, native/service identity, original previews, URL/checksum dedup, bounded stable product IDs and primary service fallback");
