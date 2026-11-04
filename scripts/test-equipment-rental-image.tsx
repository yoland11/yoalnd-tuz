import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EquipmentRentalImage } from "../src/components/equipment-rental-image";

Object.assign(globalThis, { React });

// A usable rental picture must keep its original source, stay uncropped and
// open a preview without submitting the surrounding rental form.
const picture = renderToStaticMarkup(
  <EquipmentRentalImage image="/uploads/royal-chair.png" name="كرسي ملكي" className="size-16" />,
);
assert.match(picture, /<img[^>]*src="\/uploads\/royal-chair\.png"/);
assert.match(picture, /<img[^>]*alt="كرسي ملكي"/);
assert.match(picture, /object-contain/);
assert.match(picture, /<button[^>]*type="button"/);
assert.match(picture, /aria-label="عرض صورة كرسي ملكي"/);
assert.match(picture, /aria-haspopup="dialog"/);
assert.match(picture, /size-16/);

// Older rental records can lack images. They must show a labelled placeholder,
// never a broken image tag or an empty preview action.
for (const image of [null, undefined, "", "   "]) {
  const placeholder = renderToStaticMarkup(<EquipmentRentalImage image={image} name="طاولة" />);
  assert.match(placeholder, /role="img"/);
  assert.match(placeholder, /aria-label="لا توجد صورة لـ طاولة"/);
  assert.match(placeholder, /لا توجد صورة/);
  assert.doesNotMatch(placeholder, /<img\b|<button\b/);
}

console.log("PASS rental image: original uncropped picture, accessible non-submit preview trigger, and clear legacy-image placeholders.");
