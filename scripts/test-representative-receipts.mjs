/** Representative receipts: professional 80mm/A5 templates, opened inside the click, values never recomputed. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const print = readFileSync("src/views/representative/receipt-print.ts", "utf8");
const dialog = readFileSync("src/views/representative/receipt-dialog.tsx", "utf8");
const workspace = readFileSync("src/views/representative/workspace.tsx", "utf8");
const portal = readFileSync("src/views/representative/index.tsx", "utf8");

assert.match(print, /size: \$\{thermal \? "80mm auto" : "A5 portrait"\}/, "both paper sizes are supported");
assert.match(print, /export async function printStudentReceipt/);
assert.match(print, /export async function printPaymentReceipt/);
assert.match(print, /QRCode\.toDataURL/, "a tracking QR is printed");
assert.match(print, /JsBarcode\(svg, value, \{ format: "CODE128"/, "the student code is printed as a barcode");
assert.match(print, /مدفوع بالكامل[\s\S]*مدفوع جزئياً[\s\S]*غير مدفوع/, "the payment state stamp is shown");
assert.match(print, /escapeReceipt\(/, "all printed values are escaped");
assert.match(dialog, /popup = openReceiptWindow\(chosen\);\s*\} catch/, "the window opens synchronously inside the click");
assert.match(dialog, /job\.render\(popup, chosen\)/);
assert.match(workspace, /totals: \{ total: student\.total, paid: student\.paid, remaining: student\.remaining \}/, "totals come from the server, not recomputed");
assert.match(workspace, /<ReceiptPrintDialog job=\{printing\}/, "student statements and payment receipts use the print dialog");
assert.match(portal, /<ReceiptPrintDialog job=\{printJob\}/, "the payments page uses the same receipt design");
assert.ok(!/thermalReceiptCss/.test(workspace + portal), "the old plain receipt template is gone");
console.log("representative receipts: all checks passed");
