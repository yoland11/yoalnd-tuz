import { readFileSync } from "node:fs";

const invoice = readFileSync("src/views/admin/invoice.tsx", "utf8");
const styles = readFileSync("src/views/admin/print-helpers.ts", "utf8");

const checks = [
  ["the wedding invoice uses one full-width totals card", invoice.includes('className="wi-totals-card"')],
  ["the six requested account fields remain in the horizontal summary", ["Subtotal", "Discount", "Delivery", "Additional", "Paid", "Remaining"].every((label) => invoice.includes(`english="${label}"`))],
  ["the grand total remains a separate highlighted panel", invoice.includes("الإجمالي الكلي · GRAND TOTAL")],
  ["payment methods are absent from the A4 wedding invoice", !invoice.includes("PAYMENT METHODS") && !invoice.includes("wi-payments")],
  ["notes and terms are absent from the A4 wedding invoice", !invoice.includes("الملاحظات · NOTES") && !invoice.includes("Terms & Conditions")],
  ["the required customer email and main manager fields print", invoice.includes("البريد الإلكتروني") && invoice.includes("المدير الرئيسي")],
  ["all five requested signature lines print", ["توقيع العميل", "مندوب المبيعات", "المحاسب", "اعتماد الفاتورة", "المدير الرئيسي"].every((label) => invoice.includes(`label="${label}"`))],
  ["the summary stays horizontal with six aligned columns", styles.includes("grid-template-columns:repeat(6,minmax(0,1fr))") && styles.includes("grid-template-columns:minmax(0,1fr) 38mm")],
  ["the floral A4 frame remains intact", ["ajn-rose-corner.png", ".wi-floral", "--wi-gold"].every((token) => invoice.includes(token) || styles.includes(token))],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
