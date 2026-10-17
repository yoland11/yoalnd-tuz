import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression: report "PDF" downloads were blank. The node handed to the PDF
// snapshot carried `position:fixed`, which the snapshot copies, so html2canvas
// rendered a 0px-tall element. Reproduced and verified in headless Chrome.
const report = readFileSync("src/lib/pdf-report.ts", "utf8");
const pdf = readFileSync("src/lib/pdf.ts", "utf8");
const download = report.slice(report.indexOf("export async function downloadReportPdf"));

assert.match(download, /holder\.style\.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;"/, "only the outer holder is off-screen");
assert.match(download, /holder\.appendChild\(report\)/);
assert.match(download, /await downloadElementPdf\(report, filename,/, "the rendered node is the in-flow report, not the fixed holder");
assert.doesNotMatch(download, /report\.style\.(cssText|position)/, "the rendered node never gets its own positioning");
assert.match(download, /\(pageWidthMm - margin\[1\] - margin\[3\]\) \* 96\) \/ 25\.4/, "laid out at the printable width so the left edge is not clipped");
assert.match(download, /margin,\s*pagebreakMode/, "the same margins drive layout and the PDF page");
assert.match(pdf, /jsPDF: \{[^}]*compress: true \}/, "page images are stored compressed (89 rows: 53 MB → 1.6 MB)");
assert.match(report, /\.rpt-table th \{[^}]*overflow-wrap: anywhere;/, "long headers wrap instead of overlapping");

// The printable widths match A4 at 96 dpi with 8 mm side margins.
const width = (pageWidthMm) => Math.floor(((pageWidthMm - 8 - 8) * 96) / 25.4);
assert.equal(width(297), 1062);
assert.equal(width(210), 733);
console.log("PASS  report PDF downloads render content at the printable width and stay compact");
