/** 80mm tailor sheets print from the top of the printer's own paper (no API, database or printing). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync("src/lib/graduation-receipt-print.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", "document", "XMLSerializer", compiled)(
  (name) => name === "@/lib/money" ? { formatCurrency: String } : name === "jsbarcode" ? () => {} : require(name),
  module, module.exports, { createElementNS: () => ({}) },
  class { serializeToString() { return '<svg xmlns="http://www.w3.org/2000/svg" width="230" height="34"></svg>'; } },
);

async function sheet(format, kind = "measurements") {
  let html = "";
  await module.exports.printTailorSheet({ document: { open() {}, write(value) { html = value; }, close() {} } }, {
    kind, format,
    brand: { logo: "", company: "مجموعة علي جان نهاد", phone: "", address: "" },
    student: { name: "طالب تجريبي", studentCode: "AJN-TEST-0001", trackingUrl: "" },
    info: [{ label: "المجموعة", value: "مجموعة تجريبية" }],
    garment: [{ label: "المقاس النهائي", value: "XL" }],
    measurements: [{ label: "طول روب", value: "140" }, { label: "عرض الكتف", value: "44" }],
    notes: "ملاحظة",
  });
  return html;
}

for (const kind of ["measurements", "production"]) {
  const html = await sheet("80mm", kind);
  const pageRules = html.match(/@page\s*\{[^}]*\}/g) ?? [];
  // A valid CSS page size smaller than the driver's paper is centred on it by
  // Chromium (blank paper before and after the sheet), a larger one is shrunk.
  assert.ok(pageRules.every((rule) => !/size:\s*\d+(\.\d+)?mm\s+\d+(\.\d+)?mm/.test(rule)), `${kind}: no fixed 80mm page height (${pageRules.join(" ")})`);
  assert.ok(!html.includes("tailor-roll-page"), `${kind}: the print script never rewrites the page size`);
  assert.match(html, /<main class="doc tailor-thermal">/, `${kind}: compact workshop layout`);
  assert.match(html, /\.tailor-thermal \.card,[\s\S]*break-inside: avoid/, `${kind}: a long sheet continues between sections, never through a line`);
  assert.match(html, /desktop\(\{ paperSize: "80mm" \}\)/, `${kind}: the desktop app prints it on 80mm paper`);
}
const a5 = await sheet("a5");
assert.match(a5, /@page \{ size: A5 portrait; margin: 9mm; \}/, "A5 keeps its page size");
assert.ok(!a5.includes("tailor-thermal"), "A5 keeps its own layout");
// 50×30 mm stickers on the same 80 mm roll (one student or a whole group).
const stickerJs = ts.transpileModule(readFileSync("src/lib/tailor-sticker.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sticker = { exports: {} };
new Function("require", "module", "exports", stickerJs)(require, sticker, sticker.exports);
const items = ["أحمد", "زينب <b>", "علي"].map((name, i) => ({ name, studentCode: `AJN-${i}`, groupName: "النسور", size: "XL", qr: "data:image/png;base64,AAAA" }));
const doc = sticker.exports.stickerDocument(items, "ملصقات");
assert.equal((doc.match(/<div class="lbl">/g) || []).length, 3, "one sticker per student");
assert.ok(!/@page\s*\{[^}]*size/.test(doc), "stickers declare no page size (a smaller CSS page is centred on the roll)");
assert.match(doc, /\.lbl\{width:50mm;height:30mm;margin:0 auto 2\.5mm;[^}]*break-inside:avoid/, "50×30 mm, centred, never split across pages");
assert.ok(doc.includes("زينب &lt;b&gt;") && !doc.includes("زينب <b>"), "student data is escaped");
assert.equal(sticker.exports.stickerSize({ readySize: "L", suggestedSize: "M" }), "L");
const tailorPage = readFileSync("src/views/staff/tailors/index.tsx", "utf8");
assert.match(tailorPage, /async function printLabel\(\) \{\s*const qr = await stickerQr\(order\.qrToken\);\s*openPrint\(stickerDocument\(\[/, "the order page prints the shared sticker");
assert.match(tailorPage, /printStickers\(rows\.filter\(\(r\) => sel\.has\(r\.id\)\)\)/, "group page: stickers for the selected students");
assert.match(tailorPage, /printStickers\(rows\)\}/, "group page: stickers for the whole group");
assert.match(readFileSync("src/server/tailoring.ts", "utf8"), /function serializeGroupRow[\s\S]{0,300}qrToken: order\.qrToken,/, "group rows carry the tracking token for the sticker QR");
console.log("Tailor 80mm sheet page sizing checks passed.");
