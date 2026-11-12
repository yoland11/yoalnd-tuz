import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingReferencePhotos } from "../src/components/booking-reference-photos";

(globalThis as any).React = React;
const render = (props: React.ComponentProps<typeof BookingReferencePhotos>) =>
  renderToStaticMarkup(React.createElement(BookingReferencePhotos, props));

const photos = [
  { key: "booking:one", name: "تصميم الحجز المطلوب", label: "صورة مرفقة بالحجز", url: "/private/original.webp", thumbnailUrl: "/private/thumbnail.webp" },
  { key: "service:photography", name: "تصوير استوديو", label: "الخدمة المحجوزة", url: "/api/media/service/8" },
  { key: "product:32:4", name: "ورد أبيض — كبير", label: "المنتج المحجوز", url: "/api/media/product/32" },
];
const markup = render({ photos });
assert.match(markup, /aria-label="صور الحجز"/);
assert.match(markup, /dir="rtl"/);
assert.match(markup, /عدد الصور: 3/);
for (const photo of photos) {
  assert.ok(markup.includes(photo.name));
  assert.ok(markup.includes(photo.label));
  assert.ok(markup.includes(`عرض صورة ${photo.name}`));
}
assert.match(markup, /src="\/private\/thumbnail.webp"/);
assert.match(markup, /src="\/api\/media\/service\/8"/);
assert.match(markup, /object-contain/);
assert.doesNotMatch(markup, /لا توجد صور مرتبطة بهذا الحجز/);
assert.doesNotMatch(markup, /إضافة صور/);

const empty = render({ photos: [], onEdit() {} });
assert.match(empty, /لا توجد صور مرتبطة بهذا الحجز/);
assert.match(empty, /عدد الصور: 0/);
assert.match(empty, /إضافة صور/);
assert.doesNotMatch(empty, /<img/);

const loading = render({ photos: [], loading: true });
assert.match(loading, /جارٍ تحميل صور الحجز/);
assert.doesNotMatch(loading, /لا توجد صور مرتبطة بهذا الحجز/);

const error = render({ photos: [], error: new Error("تعذر الاتصال · REQ-reference-photos"), onRetry() {} });
assert.match(error, /role="alert"/);
assert.match(error, /تعذر تحميل صور الحجز/);
assert.match(error, /REQ-reference-photos/);
assert.match(error, /إعادة المحاولة/);
assert.doesNotMatch(error, /لا توجد صور مرتبطة بهذا الحجز/);

const stale = render({ photos, error: new Error("حدث خطأ"), onRetry() {} });
assert.match(stale, /المعروض آخر قراءة ناجحة/);
assert.match(stale, /src="\/private\/thumbnail.webp"/);
assert.match(stale, /عدد الصور: 3/);
assert.ok(stale.includes("ورد أبيض — كبير"));
assert.match(render({ photos, loading: true }), /src="\/api\/media\/service\/8"/);
console.log("PASS booking reference photos UI: actual uploads/service/product captions, count, thumbnails, empty/loading/error and preserved successful pictures");
