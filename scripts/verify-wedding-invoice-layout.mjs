import { readFileSync } from "node:fs";

const invoice = readFileSync("src/views/admin/invoice.tsx", "utf8");
const styles = readFileSync("src/views/admin/print-helpers.ts", "utf8");

const weddingCssStart = styles.indexOf("export function luxuryWeddingInvoiceCss");
const weddingCss = styles.slice(weddingCssStart, styles.indexOf("\n}\n", weddingCssStart));

const checks = [
  ["the wedding invoice uses one full-width totals card", invoice.includes('className="wi-totals-card"')],
  ["the six requested account fields remain in the horizontal summary", ["Subtotal", "Discount", "Delivery", "Additional", "Paid", "Remaining"].every((label) => invoice.includes(`english="${label}"`))],
  ["the grand total remains a separate highlighted panel", invoice.includes("الإجمالي الكلي · GRAND TOTAL")],
  ["payment methods are absent from the A4 wedding invoice", !invoice.includes("PAYMENT METHODS") && !invoice.includes("wi-payments")],
  ["notes and terms are absent from the A4 wedding invoice", !invoice.includes("الملاحظات · NOTES") && !invoice.includes("Terms & Conditions")],
  ["the required customer email and main manager fields print", invoice.includes("البريد الإلكتروني") && invoice.includes("المدير الرئيسي")],
  ["all five requested signature lines print", ["توقيع العميل", "مندوب المبيعات", "المحاسب", "اعتماد الفاتورة", "المدير الرئيسي"].every((label) => invoice.includes(`label="${label}"`))],
  ["the summary stays horizontal with six aligned columns", styles.includes("grid-template-columns:repeat(6,minmax(0,1fr))") && styles.includes("grid-template-columns:minmax(0,1fr) 38mm")],
  ["the floral A4 frame remains intact", ["ajn-rose-corner-burgundy.png", ".wi-floral", "--wi-gold"].every((token) => invoice.includes(token) || styles.includes(token))],
  ["all four corners carry the burgundy roses", !invoice.includes('src="/images/invoice/ajn-rose-corner.png"') && (invoice.match(/ajn-rose-corner-burgundy\.png/g) ?? []).length === 2],
  ["printing leaves no blank last page (no forced break; sheet under the page height)", !styles.includes(".wedding-invoice-bleed{margin:0;box-shadow:none;break-after:page}") && styles.includes("min-height:calc(303mm - 1px)") && styles.includes("min-height:calc(297mm - 1px)") && styles.includes("@page { size: 216mm 303mm; margin: 0; }")],
  ["the PDF copy of the sheet carries no screen margin", styles.includes(".wedding-invoice-bleed { margin:0 auto;") && !styles.includes(".wedding-invoice-bleed { margin:20px auto;")],
  // Upper section (Nov 2026): burgundy/gold header with customer and invoice panels.
  ["the header shows the real logo, both panels, the barcode and the QR", ["logoSrc(settings)", "معلومات العميل", "معلومات الفاتورة", "barcodeRef", "data.qr?.dataUrl", "ajn-rose-corner-burgundy.png"].every((token) => invoice.includes(token))],
  ["the header reads the company name and tagline from the receipt identity", invoice.includes("settings?.receipt_brand") && invoice.includes("brand?.tagline")],
  // html2canvas (the «PDF للطباعة» button) fails or greys out on these; screen and print are unaffected.
  ["no gradient fades to `transparent` (html2canvas draws it grey)", !/gradient\([^;]*transparent/.test(weddingCss)],
  ["no sub-pixel gradient hairline (html2canvas createPattern crash)", !styles.includes("height:.15mm; flex:1; background:linear-gradient")],
  ["header SVG images carry an intrinsic size (html2canvas skips size-less SVG)", (invoice.match(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox=/g) ?? []).length === 0],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
