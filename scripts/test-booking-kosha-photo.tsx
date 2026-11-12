import assert from "node:assert/strict";
import * as React from "react";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveBookedKosha } from "../src/lib/booking-kosha-photo";
import { BookingKoshaPhoto } from "../src/components/booking-kosha-photo";

(globalThis as any).React = React;

// The same numeric ID in the package and Kosha tables must never cross-match.
assert.deepEqual(resolveBookedKosha("service", {}, {
  koshaSelection: { mode: "custom", id: 32, name: "كوشة ملكية" },
  packageId: 9,
}), { kind: "kosha", id: 32, name: "كوشة ملكية" });
assert.deepEqual(resolveBookedKosha("service", {}, {
  koshaSelection: { mode: "package", id: 32, name: "الباقة الذهبية" },
  koshaId: 9,
}), { kind: "package", id: 32, name: "الباقة الذهبية" });
assert.deepEqual(resolveBookedKosha("kosha", { koshaId: 7, packageId: 8 }, {
  koshaSelection: { mode: "package", id: 32 },
}), { kind: "kosha", id: 7, name: "الكوشة المحجوزة" });
assert.deepEqual(resolveBookedKosha("kosha", { packageId: 8, packageName: "باقة قديمة" }, {}),
  { kind: "package", id: 8, name: "باقة قديمة" });
assert.deepEqual(resolveBookedKosha("service", {}, { koshaId: "7" }),
  { kind: "kosha", id: 7, name: "الكوشة المحجوزة" });
assert.deepEqual(resolveBookedKosha("service", {}, { packageId: 8, packageName: "باقة قديمة" }),
  { kind: "package", id: 8, name: "باقة قديمة" });
for (const id of [0, -1, 1.5, "bad", true, null]) {
  assert.equal(resolveBookedKosha("service", {}, { koshaSelection: { mode: "custom", id }, koshaId: 9 }), null);
}
assert.equal(resolveBookedKosha("service", {}, { koshaSelection: { mode: "unknown", id: 7 } }), null);
assert.equal(resolveBookedKosha("service", {}, { koshaSelection: { name: "كوشة بلا رابط" } }), null);
assert.equal(resolveBookedKosha("service", {}, {}), null);

// Exercise the actual API projection against a bounded catalogue reader. It
// must reuse existing media URLs, read hidden historical items, and propagate
// database errors rather than turn them into an empty-photo response.
const api = readFileSync("src/server/api.ts", "utf8");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const projection = api.slice(api.indexOf("async function bookingOperationsKoshaPhoto("), api.indexOf("\nasync function saveBookingOperations("));
const code = esbuild.transformSync(projection + "\nreturn bookingOperationsKoshaPhoto;", { loader: "ts" }).code;
const koshasTable = { id: "koshas.id", name: "koshas.name", mainImage: "koshas.main_image", updatedAt: "koshas.updated_at" };
const koshaPackagesTable = { id: "packages.id", name: "packages.name", mainImage: "packages.main_image", updatedAt: "packages.updated_at" };
const catalogueItem = { id: 32, name: "الكوشة الأصلية", mainImage: "data:image/jpeg;base64,fixture", isActive: false };
let selectedTable: unknown, condition: unknown, failure: Error | null = null;
let rows: unknown[] = [catalogueItem];
const db = { select() { return { from(table: unknown) { selectedTable = table; return { where(value: unknown) { condition = value; return { async limit(count: number) { assert.equal(count, 1); if (failure) throw failure; return rows; } }; } }; } }; } };
const loadPhoto = new Function("db", "koshasTable", "koshaPackagesTable", "eq", "publicMediaValue", "resolveBookedKosha", code)(db, koshasTable, koshaPackagesTable, (key: unknown, id: number) => [key, id], (kind: string, item: any, image: string) => { assert.equal(image, catalogueItem.mainImage); return `/api/media/${kind}/${item.id}`; }, resolveBookedKosha);
let photo = await loadPhoto({ source: "service", row: {}, details: { koshaSelection: { mode: "custom", id: 32 } } });
assert.equal(selectedTable, koshasTable);
assert.deepEqual(condition, ["koshas.id", 32]);
assert.equal(photo.imageUrl, "/api/media/kosha/32");
assert.equal(photo.name, catalogueItem.name);
photo = await loadPhoto({ source: "service", row: {}, details: { koshaSelection: { mode: "package", id: 32 } } });
assert.equal(selectedTable, koshaPackagesTable);
assert.deepEqual(condition, ["packages.id", 32]);
assert.equal(photo.imageUrl, "/api/media/kosha-package/32");
rows = [];
assert.deepEqual(await loadPhoto({ source: "kosha", row: { koshaId: 32 }, details: {} }), { kind: "kosha", id: 32, name: "الكوشة المحجوزة", imageUrl: null });
failure = new Error("catalogue database unavailable");
await assert.rejects(loadPhoto({ source: "kosha", row: { koshaId: 32 }, details: {} }), /catalogue database unavailable/);
assert.equal(await loadPhoto({ source: "service", row: {}, details: {} }), null);
assert.match(api, /resource === "overview" \? bookingOperationsKoshaPhoto\(reference\) : null/);

const kosha = { kind: "kosha" as const, id: 32, name: "الكوشة الملكية", imageUrl: "/api/media/kosha/32" };
const render = (props: React.ComponentProps<typeof BookingKoshaPhoto>) =>
  renderToStaticMarkup(React.createElement(BookingKoshaPhoto, props));
const markup = render({ kosha });
assert.match(markup, /الكوشة المحجوزة/);
assert.match(markup, /الكوشة الملكية/);
assert.match(markup, /src="\/api\/media\/kosha\/32"/);
assert.match(markup, /alt="الكوشة الملكية"/);
assert.match(markup, /عرض صورة الكوشة الملكية/);
assert.match(markup, /object-contain/);
assert.equal(render({ kosha: null }), "");
const withoutPhoto = render({ kosha: { ...kosha, imageUrl: null } });
assert.match(withoutPhoto, /لا توجد صورة لهذه الكوشة/);
assert.doesNotMatch(withoutPhoto, /<img/);
const error = render({ error: new Error("تعذر الاتصال · REQ-photo-test"), onRetry() {} });
assert.match(error, /تعذر تحميل بيانات الكوشة المحجوزة/);
assert.match(error, /REQ-photo-test/);
assert.match(error, /إعادة المحاولة/);
assert.doesNotMatch(error, /لا توجد صورة/);
assert.match(render({ loading: true }), /جارٍ تحميل الكوشة المحجوزة/);
assert.match(render({ kosha, error: new Error("حدث خطأ"), onRetry() {} }), /src="\/api\/media\/kosha\/32"/);
console.log("PASS booked Kosha identity, legacy references, image presentation and error states");
