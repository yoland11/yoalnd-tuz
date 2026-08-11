import { buildSalesInvoiceThermalHtml, formatLatinNumber, toLatinDigits } from "@workspace/print-template";

const html = buildSalesInvoiceThermalHtml({
  paperSize: "80mm",
  invoiceNo: "SI-١٢٣",
  issuedAt: "2026-08-11T14:35:00.000Z",
  customerName: "عميل اختبار",
  customerPhone: "٠٧٧٠١٢٣٤٥٦٧",
  paymentMethod: "cash",
  paymentStatus: "partial",
  items: [{ productName: "خدمة اختبار", quantity: "٠٫٥", unitPrice: "١٠٠٠٠", total: "٥٠٠٠" }],
  subtotal: "١٠٠٠٠",
  discount: "٠",
  tax: "٠",
  total: "١٠٠٠٠",
  paid: "٥٠٠٠",
  remaining: "٥٠٠٠",
  qrImageUrl: "data:image/png;base64,AAAA",
  qrCaption: "SI-١٢٣",
  notes: "   ",
});
const checks = [
  ["Latin number helper", formatLatinNumber("١٢٣٤٥٦٧٫٥") === "1,234,567.5"],
  ["Latin digit normalization", toLatinDigits("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹") === "01234567890123456789"],
  ["Receipt has no Arabic/Persian digits", !/[٠-٩۰-۹]/.test(html)],
  ["Decimal quantity is preserved", html.includes("0.5")],
  ["Receipt numeric values are LTR", html.includes(".num { direction:ltr")],
  ["Receipt has zero page and body margins", html.includes("@page { size: 80mm auto; margin: 0; }") && html.includes("margin:0; padding:0" )],
  ["Blank notes are omitted", !html.includes("ملاحظات")],
];
let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
