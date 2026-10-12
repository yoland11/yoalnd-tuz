/** Representative receipts: professional 80mm/A5 templates, opened inside the click, values never recomputed. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const print = readFileSync("src/lib/graduation-receipt-print.ts", "utf8");
const dialog = readFileSync("src/components/graduation-receipt-dialog.tsx", "utf8");
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
const admin = readFileSync("src/views/admin/graduation-order-center.tsx", "utf8");
const operations = readFileSync("src/server/graduation-operations.ts", "utf8");
assert.match(admin, /<ReceiptPrintDialog job=\{job\}/, "the admin students page and group table use the same receipt dialog");
assert.match(admin, /await printStudentReceipt\(popup, receiptInput\(receipt, format\)\)/, "admin printing uses the designed receipt");
assert.match(admin, /studentReceiptElement\(receiptInput\(receipt, format\)\)/, "the PDF download uses the same design");
assert.ok(!/studentReceiptMarkup|thermalReceiptCss\("80mm"\)/.test(admin), "the old admin thermal template is gone");
assert.match(operations, /FROM graduation_student_payments p[\s\S]{0,200}WHERE p\.graduation_order_id = \$\{saved\.id\}/, "the admin receipt lists the order's posted payments");
assert.match(print, /export function scopedReceiptCss/, "in-page PDF styles are scoped to the receipt");
// Real 80mm printers print ~72mm: a fixed 74mm body plus page margins was cut on the left.
assert.match(print, /@page \{ size: \$\{thermal \? "80mm auto" : "A5 portrait"\}; margin: \$\{thermal \? "0" : "9mm"\}; \}/, "the thermal page has no margin");
assert.match(print, /\.doc \{ width: 100%;/, "the receipt body is fluid, never a fixed width wider than the printable area");
assert.match(print, /\.kv \{ display: flex; flex-wrap: wrap;/, "long values wrap instead of running off the paper");
console.log("representative receipts: all checks passed");
