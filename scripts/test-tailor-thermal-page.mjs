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
// The 50×30 mm sticker on the same 80 mm roll: no fixed page either, so it prints at the top.
const tailorPage = readFileSync("src/views/staff/tailors/index.tsx", "utf8");
const label = tailorPage.slice(tailorPage.indexOf("async function printLabel()"), tailorPage.indexOf("async function saveNotes()"));
assert.ok(label.length > 100, "sticker print found");
assert.ok(!/@page\s*\{[^}]*size/.test(label), "the sticker declares no page size (a smaller CSS page is centred on the roll)");
assert.match(label, /\.lbl\{width:50mm;height:30mm;margin:0 auto;/, "50×30 mm sticker centred in the printable width");
assert.match(label, /esc\(order\.name\)/, "student data is escaped in the print window");
console.log("Tailor 80mm sheet page sizing checks passed.");
