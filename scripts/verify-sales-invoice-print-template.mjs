import { readFileSync } from "node:fs";
import {
  buildSalesInvoiceThermalHtml,
  formatLatinNumber,
  toLatinDigits,
} from "@workspace/print-template";

const purchasesSource = readFileSync(
  new URL("../src/views/admin/purchases.tsx", import.meta.url),
  "utf8",
);

const html = buildSalesInvoiceThermalHtml({
  paperSize: "80mm",
  invoiceNo: "SI-١٢٣",
  issuedAt: "2026-08-11T14:35:00.000Z",
  customerName: "عميل اختبار",
  customerPhone: "٠٧٧٠١٢٣٤٥٦٧",
  paymentMethod: "cash",
  paymentStatus: "partial",
  items: [
    {
      productName: "خدمة اختبار",
      quantity: "٠٫٥",
      unitPrice: "١٠٠٠٠",
      total: "٥٠٠٠",
    },
  ],
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
const offerDeliveryReceipt = buildSalesInvoiceThermalHtml({
  paperSize: "80mm",
  invoiceNo: "SI-OFFER-1",
  items: [],
  offerDeliveryFee: "5000",
  total: "60000",
  paid: "0",
  remaining: "60000",
});
const noOfferDeliveryReceipt = buildSalesInvoiceThermalHtml({
  paperSize: "80mm",
  invoiceNo: "SI-OFFER-2",
  items: [],
  offerDeliveryFee: "0",
  total: "55000",
  paid: "0",
  remaining: "55000",
});
const longReceipt = buildSalesInvoiceThermalHtml({
  paperSize: "80mm",
  invoiceNo: "SI-2026-000000123456",
  issuedAt: "2026-08-16T21:15:00.000Z",
  customerName:
    "عميل باسم عربي طويل لاختبار التفاف نص معلومات الفاتورة داخل مساحة الطابعة الحرارية",
  customerPhone: "07701234567",
  paymentMethod: "cash",
  paymentStatus: "partial",
  employeeName: "موظف مبيعات باسم طويل",
  items: [
    {
      productName:
        "خدمة تجهيز مناسبة باسم عربي طويل جداً يجب أن يلتف داخل عمود الصنف من دون أن يخرج من عرض الإيصال",
      quantity: 1000,
      unitPrice: 123456789,
      total: 123456789000,
    },
    {
      productName: "إضافة اختبار ثانية",
      quantity: 25,
      unitPrice: 5000000,
      total: 125000000,
    },
  ],
  subtotal: 123581789000,
  discount: 9999999,
  total: 123571789001,
  paid: 50000000000,
  remaining: 73571789001,
  qrImageUrl: "data:image/png;base64,AAAA",
  qrCaption: "SI-2026-000000123456",
  companyPhone: "07701234567",
  companyAddress: "بغداد، عنوان فرع طويل لاختبار التفاف تذييل الإيصال الحراري",
});
const checks = [
  ["Latin number helper", formatLatinNumber("١٢٣٤٥٦٧٫٥") === "1,234,567.5"],
  [
    "Latin digit normalization",
    toLatinDigits("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹") === "01234567890123456789",
  ],
  ["Receipt has no Arabic/Persian digits", !/[٠-٩۰-۹]/.test(html)],
  ["Decimal quantity is preserved", html.includes("0.5")],
  ["Receipt numeric values are LTR", html.includes(".num { direction:ltr")],
  [
    "Receipt has zero page and body margins",
    html.includes("@page { size: 80mm auto; margin: 0; }") &&
      html.includes("margin:0 !important; padding:0 !important"),
  ],
  [
    "80mm receipt uses a conservative centered 64mm printable area",
    longReceipt.includes(
      ".invoice-thermal-80 { width:64mm; max-width:64mm; }",
    ) && longReceipt.includes('class="receipt invoice-thermal-80"'),
  ],
  [
    "Thermal wrapper clips no content and uses natural page height",
    longReceipt.includes("background:#fff; overflow:hidden") &&
      !longReceipt.includes("min-height:210mm") &&
      !longReceipt.includes("height:210mm"),
  ],
  [
    "Invoice information rows can shrink and wrap",
    longReceipt.includes(
      ".receipt-info-row > *, .kv > * { min-width:0; overflow-wrap:anywhere; word-break:break-word; }",
    ),
  ],
  [
    "80mm items table uses fixed compact columns",
    [
      "table-layout:fixed",
      "width:6%;",
      "width:40%;",
      "width:12%;",
      "width:20%;",
      "width:22%;",
    ].every((token) => longReceipt.includes(token)),
  ],
  [
    "Large numeric values may wrap inside compact table columns",
    longReceipt.includes(
      ".receipt-items .num { white-space:normal; overflow-wrap:anywhere; word-break:break-word; }",
    ),
  ],
  [
    "QR code is restricted to 28mm",
    longReceipt.includes(".qr img { width:28mm; height:28mm;"),
  ],
  [
    "Thermal print removes default page margins and isolates the receipt",
    longReceipt.includes(
      "@media print { html,body { width:80mm; max-width:80mm; margin:0 !important; padding:0 !important;",
    ) &&
      longReceipt.includes(
        "body > :not(.receipt) { display:none !important; }",
      ),
  ],
  [
    "Thermal receipts do not use a centering transform",
    !longReceipt.includes("transform:translate"),
  ],
  ["Blank notes are omitted", !html.includes("ملاحظات")],
  [
    "Purchase invoices use the shared 80mm receipt instead of a desktop A4 window",
    purchasesSource.includes("openSalesInvoicePrintWindow({") &&
      purchasesSource.includes('paperSize: "80mm"') &&
      purchasesSource.includes('documentTitle: "فاتورة مشتريات"') &&
      !purchasesSource.includes("@page{size:A4;margin:14mm}"),
  ],
];
checks.push(
  [
    "Offer delivery fee has a separate thermal row",
    offerDeliveryReceipt.includes("أجور توصيل العرض") &&
      offerDeliveryReceipt.includes("5,000"),
  ],
  [
    "Zero offer delivery fee is omitted",
    !noOfferDeliveryReceipt.includes("أجور توصيل العرض"),
  ],
);
let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
