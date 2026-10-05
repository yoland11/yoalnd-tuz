import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as portal from "../src/views/staff/tailors/index";

Object.assign(globalThis, { React });
const References = (portal as typeof portal & {
  TailorStudentReferences?: React.ComponentType<{ references: Array<{ placement: string; note: string; imageUrl?: string }> }>;
}).TailorStudentReferences;
assert.equal(typeof References, "function", "tailor portal must render the student's saved reference section");

const markup = renderToStaticMarkup(React.createElement(References, { references: [
  { placement: "cap_edge", note: "اكتب الاسم هنا", imageUrl: "https://assets.example/cap.png" },
  { placement: "cap_top", note: "فوق القبعة" },
  { placement: "sash_back", note: "خلف الوشاح", imageUrl: "https://assets.example/sash.png" },
  { placement: "other", note: "خيط إضافي" },
] }));
assert.match(markup, /صور وملاحظات الطالب/);
for (const label of ["طرف القبعة", "فوق القبعة", "خلف الوشاح", "أخرى"]) assert.ok(markup.includes(label), label);
assert.match(markup, /اكتب الاسم هنا/);
assert.match(markup, /https:\/\/assets\.example\/cap\.png/);
assert.match(markup, /https:\/\/assets\.example\/sash\.png/);
assert.match(markup, /target="_blank"/);
assert.match(markup, /rel="noopener noreferrer"/);
assert.doesNotMatch(markup, /الصور \(اختياري\)/, "student references stay separate from tailor execution photos");
assert.equal(renderToStaticMarkup(React.createElement(References, { references: [] })), "");
console.log("PASS tailor portal renders student placement photos and notes separately from tailor uploads");
