import { formatCurrency } from "@/lib/money";
import { buildSalesInvoiceThermalHtml } from "@workspace/print-template";

export type ThermalPaperSize = "58mm" | "80mm" | "a4" | "pdf";

export function thermalPageWidth(size: ThermalPaperSize) {
  return size === "58mm" ? "58mm" : size === "80mm" ? "80mm" : "A4";
}

export function thermalBaseCss(size: ThermalPaperSize, fontSize?: string) {
  const isNarrow = size === "58mm" || size === "80mm";
  const pageWidth = thermalPageWidth(size);
  const margin =
    size === "58mm" ? "2mm 3mm" : size === "80mm" ? "3mm 4mm" : "12mm";
  const bodyFontSize =
    fontSize ?? (size === "58mm" ? "8px" : isNarrow ? "9px" : "12px");

  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    @page { size: ${pageWidth} auto; margin: ${margin}; }
    * {
      box-sizing: border-box;
      color: #000 !important;
      text-shadow: none !important;
      box-shadow: none !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      background: #fff !important;
      color: #000 !important;
      margin: 0;
      padding: 0;
      direction: rtl;
      font-family: Cairo, Tahoma, Arial, sans-serif;
      font-size: ${bodyFontSize};
      line-height: 1.55;
    }
    body, p, div, span, td, th, li {
      color: #000 !important;
    }
    .receipt, .qr-label {
      width: 100%;
      background: #fff !important;
    }
    .muted, .meta, .footer {
      color: #000 !important;
      opacity: 1 !important;
    }
    strong, b, .title, .company-name, .grand, .total, .section-title {
      font-weight: 700 !important;
      color: #000 !important;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      color: #000 !important;
    }
    th {
      background: #fff !important;
      color: #000 !important;
      border: 1px solid #000 !important;
      font-weight: 700 !important;
    }
    td {
      border-bottom: 1px solid #000 !important;
      color: #000 !important;
    }
    .divider {
      border: none !important;
      border-top: 1px dashed #000 !important;
      margin: 6px 0;
      opacity: 1 !important;
    }
    .qr, .qr-block {
      text-align: center;
      margin-top: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    img.qr-code {
      display: block !important;
      width: 120px !important;
      height: 120px !important;
      object-fit: contain !important;
      image-rendering: pixelated;
      margin: 0 auto 4px !important;
      opacity: 1 !important;
    }
    img.logo {
      object-fit: contain !important;
      filter: none !important;
      opacity: 1 !important;
    }
    @media print {
      body { background: #fff !important; color: #000 !important; }
      * { color: #000 !important; }
    }
  `;
}

/**
 * Dedicated thermal-receipt stylesheet (58mm / 80mm ONLY).
 * Built from scratch for thermal printers — NOT a scaled A4 sheet.
 * Goals: 100% black, heavy weights, thick borders, minimal margins,
 * dynamic height (page height = content), tabular numbers, large crisp QR.
 */
export function thermalReceiptCss(size: "58mm" | "80mm") {
  const is58 = size === "58mm";
  const pad = is58 ? "1.5mm" : "2.5mm";
  const base = is58 ? "12px" : "13px";
  const qr = is58 ? 140 : 172;
  const logoH = is58 ? 34 : 46;

  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800;900&display=swap');
    @page { size: ${size} auto; margin: 0; }
    * {
      box-sizing: border-box;
      color: #000 !important;
      text-shadow: none !important;
      box-shadow: none !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body { margin: 0; padding: 0; background: #fff !important; }
    body {
      direction: rtl;
      font-family: Cairo, Tahoma, Arial, sans-serif;
      font-weight: 600;
      font-size: ${base};
      line-height: 1.3;
      color: #000 !important;
    }
    .receipt { width: 100%; padding: ${pad}; }
    .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .center { text-align: center; }
    /* Header */
    .r-head { text-align: center; margin-bottom: 3px; }
    .r-logo { height: ${logoH}px; width: auto; max-width: 72%; object-fit: contain; display: block; margin: 0 auto 3px; filter: grayscale(1) contrast(1.45); }
    .r-company { font-size: 1.65em; font-weight: 900; line-height: 1.12; }
    .r-sub { font-size: 0.92em; font-weight: 600; }
    /* Dividers — solid & thick for clean thermal output */
    .rule { border: 0; border-top: 1.5px solid #000; margin: 4px 0; }
    .rule.dashed { border-top: 1.5px dashed #000; }
    /* Key/value meta rows */
    .kv { display: flex; justify-content: space-between; gap: 8px; margin: 1.5px 0; font-weight: 700; }
    .kv .v { font-weight: 800; text-align: left; }
    .kv .v.big { font-size: 1.12em; }
    /* Items table */
    table.items { width: 100%; border-collapse: collapse; margin: 2px 0; }
    table.items th { font-weight: 900; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 3px; text-align: center; }
    table.items th.name, table.items td.name { text-align: right; }
    table.items td { padding: 3px 3px; border-bottom: 1px solid #000; font-weight: 700; vertical-align: top; }
    table.items td.name { font-weight: 800; }
    table.items tr.ln2 td { border-bottom: 1.5px solid #000; padding-top: 0; }
    /* Totals */
    .totals { margin-top: 3px; }
    .totals .row { display: flex; justify-content: space-between; gap: 10px; font-weight: 700; margin: 2px 0; }
    .grand { display: flex; justify-content: space-between; gap: 10px; align-items: center; border: 2.5px solid #000; padding: 4px 6px; margin: 4px 0; font-size: 1.35em; font-weight: 900; }
    .payline { display: flex; justify-content: space-between; gap: 10px; font-weight: 800; font-size: 1.08em; margin: 2px 0; }
    .payline.remain { font-size: 1.2em; border: 1.5px solid #000; padding: 2px 5px; margin-top: 3px; }
    /* QR */
    .qr { text-align: center; margin-top: 6px; break-inside: avoid; page-break-inside: avoid; }
    .qr img { width: ${qr}px; height: ${qr}px; object-fit: contain; image-rendering: pixelated; display: block; margin: 0 auto 2px; }
    .qr .cap { font-weight: 700; font-size: 0.9em; }
    .thanks { text-align: center; font-weight: 800; font-size: 1.05em; margin-top: 5px; }
    @media print { * { color: #000 !important; } }
  `;
}

export type SalesInvoicePrintSize = "58mm" | "80mm" | "a4";

export type SalesInvoiceReceiptInput = {
  paperSize: SalesInvoicePrintSize;
  invoiceNo: string;
  issuedAt?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  employeeName?: string | null;
  items: Array<{
    productName: string;
    quantity: number | string;
    unitPrice: number | string;
    total: number | string;
  }>;
  subtotal?: number | string | null;
  discount?: number | string | null;
  tax?: number | string | null;
  offerDeliveryFee?: number | string | null;
  deliveryFee?: number | string | null;
  total: number | string;
  paid: number | string;
  remaining: number | string;
  notes?: string | null;
  qrDataUrl?: string | null;
  qrCaption?: string | null;
  logoUrl?: string | null;
  companyName?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
  footerText?: string | null;
  documentTitle?: string | null;
  showLogo?: boolean;
  showQr?: boolean;
  showCustomerPhone?: boolean;
  showEmployeeName?: boolean;
  showAddress?: boolean;
};

/** Escapes dynamic invoice content before it is written to a print-window HTML document. */
function escapePrintHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function thermalPaymentStatusLabel(
  status?: string | null,
  paid?: number | string,
  remaining?: number | string,
) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "overpaid") return "دفع أكثر من المطلوب";
  if (normalized === "paid" || (Number(remaining) <= 0 && Number(paid) > 0))
    return "مدفوع بالكامل";
  if (normalized === "partial" || Number(paid) > 0) return "مدفوع جزئياً";
  return "غير مدفوع";
}

function salesInvoiceSheetCss() {
  return `${sheetReportCss("a4")}
    @page { size: A4 portrait; margin: 12mm; }
    .sales-sheet { max-width: 186mm; margin: 0 auto; }
    .sales-sheet .r-head { text-align:center; border-bottom:2px solid #000; padding-bottom:8px; }
    .sales-sheet .r-logo { height:46px; max-width:120px; object-fit:contain; filter:grayscale(1) contrast(1.45); }
    .sales-sheet .r-company { font-size:18px; font-weight:900; }
    .sales-sheet .r-sub { font-weight:700; margin-top:2px; }
    .sales-sheet .rule { border:0; border-top:1.5px dashed #000; margin:9px 0; }
    .sales-sheet .kv-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:6px 16px; }
    .sales-sheet .kv { display:flex; justify-content:space-between; gap:10px; border-bottom:1px dotted #000; padding:3px 0; font-weight:700; }
    .sales-sheet .items { width:100%; border-collapse:collapse; margin-top:10px; }
    .sales-sheet .items th,.sales-sheet .items td { border:1px solid #000; padding:6px; text-align:right; }
    .sales-sheet .items th { font-weight:900; }
    .sales-sheet .num { direction:ltr; unicode-bidi:embed; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .sales-sheet .totals { width:72mm; margin:12px 0 0 auto; }
    .sales-sheet .row,.sales-sheet .payline,.sales-sheet .grand { display:flex; justify-content:space-between; gap:12px; padding:4px 0; font-weight:700; }
    .sales-sheet .grand { border:2.5px solid #000; padding:7px; font-size:16px; font-weight:900; }
    .sales-sheet .remain { border:1.5px solid #000; padding:5px; font-weight:900; }
    .sales-sheet .qr { text-align:center; margin-top:12px; break-inside:avoid; page-break-inside:avoid; }
    .sales-sheet .qr img { width:112px; height:112px; object-fit:contain; image-rendering:pixelated; }
    .sales-sheet .thanks { text-align:center; margin-top:10px; font-weight:800; }
  `;
}

/**
 * Sales-only invoice print builder. Thermal layouts use the shared receipt CSS
 * while A4 remains an intentionally separate sheet mode.
 */
function salesInvoicePrintWindowFeatures(paperSize: SalesInvoicePrintSize) {
  const isThermal = paperSize === "58mm" || paperSize === "80mm";
  return isThermal ? "width=440,height=760" : "width=980,height=760";
}

/**
 * Open the browser print surface during the original user gesture. This keeps
 * local printing reliable on mobile after the invoice save request finishes.
 */
export function prepareSalesInvoicePrintWindow(
  paperSize: SalesInvoicePrintSize,
): Window {
  const popup = window.open(
    "",
    "_blank",
    salesInvoicePrintWindowFeatures(paperSize),
  );
  if (!popup) throw new Error("تعذر فتح نافذة الطباعة");
  popup.document.write(
    '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>AJN</title></head><body style="font-family:Tahoma,Arial,sans-serif;padding:24px">جارٍ حفظ الفاتورة وتجهيز الطباعة...</body></html>',
  );
  popup.document.close();
  return popup;
}

/** Builds a hidden thermal receipt node for the real PDF export path. */
export function createSalesInvoiceThermalPdfElement(
  input: SalesInvoiceReceiptInput,
): HTMLDivElement {
  const documentHtml = buildSalesInvoiceThermalHtml({
    paperSize: input.paperSize === "58mm" ? "58mm" : "80mm",
    invoiceNo: input.invoiceNo,
    issuedAt: input.issuedAt,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    employeeName: input.employeeName,
    items: input.items,
    subtotal: input.subtotal,
    discount: input.discount,
    tax: input.tax,
    offerDeliveryFee: input.offerDeliveryFee,
    deliveryFee: input.deliveryFee,
    total: input.total,
    paid: input.paid,
    remaining: input.remaining,
    notes: input.notes,
    qrImageUrl: input.qrDataUrl,
    qrCaption: input.qrCaption,
    logoUrl: input.logoUrl,
    companyName: input.companyName,
    companyPhone: input.companyPhone,
    companyAddress: input.companyAddress,
    footerText: input.footerText,
    documentTitle: input.documentTitle,
    showLogo: input.showLogo,
    showQr: input.showQr,
    showCustomerPhone: input.showCustomerPhone,
    showEmployeeName: input.showEmployeeName,
    showAddress: input.showAddress,
  });
  const parsed = new DOMParser().parseFromString(documentHtml, "text/html");
  const wrapper = document.createElement("div");
  wrapper.dir = "rtl";
  wrapper.style.width = input.paperSize === "58mm" ? "58mm" : "80mm";
  wrapper.style.background = "#fff";
  wrapper.innerHTML = `<style>${parsed.head.querySelector("style")?.textContent ?? ""}</style>${parsed.body.innerHTML}`;
  return wrapper;
}

export function openSalesInvoicePrintWindow(
  input: SalesInvoiceReceiptInput,
  existingWindow?: Window | null,
) {
  const isThermal = input.paperSize === "58mm" || input.paperSize === "80mm";
  const popup =
    existingWindow && !existingWindow.closed
      ? existingWindow
      : window.open(
          "",
          "_blank",
          salesInvoicePrintWindowFeatures(input.paperSize),
        );
  if (!popup) throw new Error("تعذر فتح نافذة الطباعة");
  popup.document.open();

  // Browser printing and AJN Print Agent both render this same document
  // builder. Keep thermal invoice markup and number formatting out of this
  // view-local integration layer so the two outputs cannot drift.
  if (isThermal) {
    const thermalDocument = buildSalesInvoiceThermalHtml({
      paperSize: input.paperSize as "58mm" | "80mm",
      invoiceNo: input.invoiceNo,
      issuedAt: input.issuedAt,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      paymentMethod: input.paymentMethod,
      paymentStatus: input.paymentStatus,
      employeeName: input.employeeName,
      items: input.items,
      subtotal: input.subtotal,
      discount: input.discount,
      tax: input.tax,
      offerDeliveryFee: input.offerDeliveryFee,
      deliveryFee: input.deliveryFee,
      total: input.total,
      paid: input.paid,
      remaining: input.remaining,
      notes: input.notes,
      qrImageUrl: input.qrDataUrl,
      qrCaption: input.qrCaption,
      logoUrl: input.logoUrl,
      companyName: input.companyName,
      companyPhone: input.companyPhone,
      companyAddress: input.companyAddress,
      footerText: input.footerText,
      documentTitle: input.documentTitle,
      showLogo: input.showLogo,
      showQr: input.showQr,
      showCustomerPhone: input.showCustomerPhone,
      showEmployeeName: input.showEmployeeName,
      showAddress: input.showAddress,
    });
    popup.document.write(
      thermalDocument.replace(
        "</body>",
        `${printWhenImagesReadyScript()}</body>`,
      ),
    );
    popup.document.close();
    return;
  }

  const esc = escapePrintHtml;
  const company = input.companyName?.trim() || "مجموعة علي جان نهاد";
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : null;
  const dateTime =
    issuedAt && !Number.isNaN(issuedAt.getTime())
      ? new Intl.DateTimeFormat("en-CA", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(issuedAt)
      : String(input.issuedAt ?? "");
  const kv = (label: string, value: unknown, className = "") =>
    value === undefined || value === null || String(value).trim() === ""
      ? ""
      : `<div class="kv"><span>${esc(label)}</span><span class="v ${className}">${esc(value)}</span></div>`;
  const paymentMethodLabel =
    (
      {
        cash: "نقدي",
        card: "بطاقة",
        transfer: "تحويل",
        credit: "آجل",
      } as Record<string, string>
    )[String(input.paymentMethod ?? "").toLowerCase()] ?? input.paymentMethod;
  const paymentStatus = thermalPaymentStatusLabel(
    input.paymentStatus,
    input.paid,
    input.remaining,
  );
  const amounts = {
    subtotal: Number(input.subtotal ?? 0),
    discount: Number(input.discount ?? 0),
    tax: Number(input.tax ?? 0),
    offerDelivery: Number(input.offerDeliveryFee ?? 0),
    delivery: Number(input.deliveryFee ?? 0),
  };
  const metaRows = [
    kv("رقم الفاتورة", input.invoiceNo, "num big"),
    kv("التاريخ والوقت", dateTime, "num"),
    kv("العميل", input.customerName),
    input.showCustomerPhone !== false
      ? kv("الهاتف", input.customerPhone, "num")
      : "",
    kv("نوع الدفع", paymentMethodLabel),
    kv("حالة الدفع", paymentStatus),
    input.showEmployeeName !== false ? kv("الموظف", input.employeeName) : "",
  ].join("");
  const itemRows = input.items
    .map(
      (item, index) =>
        `<tr><td class="num center">${index + 1}</td><td class="name">${esc(item.productName)}</td><td class="num center">${esc(item.quantity)}</td><td class="num center">${esc(formatCurrency(item.unitPrice))}</td><td class="num" style="text-align:left">${esc(formatCurrency(item.total))}</td></tr>`,
    )
    .join("");
  const itemHead =
    '<tr><th>#</th><th class="name">الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>';
  const totals = `
    <div class="totals">
      ${amounts.subtotal ? `<div class="row"><span>المجموع الفرعي</span><span class="num">${esc(formatCurrency(amounts.subtotal))}</span></div>` : ""}
      ${amounts.discount > 0 ? `<div class="row"><span>الخصم</span><span class="num">- ${esc(formatCurrency(amounts.discount))}</span></div>` : ""}
      ${amounts.tax > 0 ? `<div class="row"><span>الضريبة</span><span class="num">${esc(formatCurrency(amounts.tax))}</span></div>` : ""}
      ${amounts.offerDelivery > 0 ? `<div class="row"><span>أجور توصيل العرض</span><span class="num">${esc(formatCurrency(amounts.offerDelivery))}</span></div>` : ""}
      ${amounts.delivery > 0 ? `<div class="row"><span>أجور التوصيل</span><span class="num">${esc(formatCurrency(amounts.delivery))}</span></div>` : ""}
      <div class="grand"><span>الإجمالي</span><span class="num">${esc(formatCurrency(input.total))}</span></div>
      <div class="payline"><span>المدفوع</span><span class="num">${esc(formatCurrency(input.paid))}</span></div>
      <div class="payline remain"><span>المتبقي</span><span class="num">${esc(formatCurrency(input.remaining))}</span></div>
    </div>`;
  const header = `<div class="r-head">
    ${input.showLogo !== false && input.logoUrl ? `<img class="r-logo" src="${esc(input.logoUrl)}" alt="" onerror="this.remove()">` : ""}
    <div class="r-company">${esc(company)}</div><div class="r-sub">لتنظيم المناسبات</div><div class="r-sub">${esc(input.documentTitle?.trim() || "فاتورة مبيعات")}</div>
  </div>`;
  const footer = `<div class="thanks">${esc(input.footerText?.trim() || "شكراً لاختياركم مجموعة علي جان نهاد")}</div>
    ${input.companyPhone ? `<div class="r-sub center num">${esc(input.companyPhone)}</div>` : ""}
    ${input.showAddress !== false && input.companyAddress ? `<div class="r-sub center">${esc(input.companyAddress)}</div>` : ""}`;
  const qr =
    input.showQr !== false && input.qrDataUrl
      ? `<div class="qr"><img src="${esc(input.qrDataUrl)}" alt="QR"><div class="cap num">${esc(input.qrCaption || input.invoiceNo)}</div></div>`
      : "";
  const body = `<main class="sales-sheet">${header}<hr class="rule"><div class="kv-grid">${metaRows}</div><table class="items"><thead>${itemHead}</thead><tbody>${itemRows}</tbody></table>${totals}${qr}${footer}</main>`;
  const css = salesInvoiceSheetCss();
  popup.document.write(
    `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(input.invoiceNo)}</title><style>${css}</style></head><body>${body}${printWhenImagesReadyScript()}</body></html>`,
  );
  popup.document.close();
}

export function sheetReportCss(size: "a4" | "a5" = "a4") {
  const page = size === "a5" ? "A5" : "A4";
  const margin = size === "a5" ? "10mm" : "14mm";
  const base = size === "a5" ? "11px" : "12px";
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    @page { size: ${page} portrait; margin: ${margin}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fff; color: #000; direction: rtl; font-family: Cairo, Tahoma, Arial, sans-serif; font-size: ${base}; }
    .report-sheet { width: 100%; background: #fff; color: #000; }
    .report-head { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
    .report-logo { width: auto; height: ${size === "a5" ? "40px" : "52px"}; object-fit: contain; }
    .report-company { font-size: 18px; font-weight: 800; }
    .report-title { font-size: 20px; font-weight: 800; }
    .report-meta { font-size: 11px; font-weight: 600; line-height: 1.8; }
    .report-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
    .report-stat { border: 1px solid #000; padding: 7px; }
    .report-stat strong { display: block; margin-top: 3px; font-size: 14px; }
    table.report-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    .report-table th { background: #f2f2f2; border: 1px solid #000; padding: 6px; font-weight: 800; text-align: right; }
    .report-table td { border: 1px solid #000; padding: 6px; vertical-align: top; }
    .report-footer { margin-top: 12px; border-top: 1px solid #000; padding-top: 7px; text-align: center; font-size: 10px; }
    @media print { body { background: #fff !important; } .report-sheet { box-shadow: none !important; } }
  `;
}

/** Shared A4 landscape asset-sale report used by print and PDF export. */
export function assetSalesReportCss() {
  return `${sheetReportCss("a4")}
    @page { size: A4 landscape; margin: 9mm; }
    .asset-sales-sheet { min-height: 190mm; }
    .asset-sales-sheet .report-summary { grid-template-columns: repeat(5, 1fr); }
    .asset-sales-sheet .report-table { font-size: 8.5px; }
    .asset-sales-sheet .report-table thead { display: table-header-group; }
    .asset-sales-sheet .report-table tr { break-inside: avoid; page-break-inside: avoid; }
    .asset-sales-sheet .num { direction: ltr; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .asset-sales-sheet .profit { font-weight: 800; }
    .asset-sales-sheet .filter-note { border: 1px solid #000; padding: 6px; margin: 8px 0; font-size: 9px; }
  `;
}

/** A4 employee custody statement; shared so every branch prints the same form. */
export function custodyStatementCss() {
  return `${sheetReportCss("a4")}
    .custody-statement .signatures { display:flex; justify-content:space-between; gap:40px; margin-top:42px; }
    .custody-statement .signatures div { width:42%; border-top:1px dashed #000; padding-top:8px; text-align:center; }
    .custody-statement .report-table { margin-top:14px; }
  `;
}

export type CustomerStatementPrintTransaction = {
  reference: string;
  date: string;
  serviceType: string;
  total: number;
  paid: number;
  remaining: number;
  paymentHistory?: Array<{ date: string; amount: number; reference?: string }>;
};

export type CustomerStatementPrintInput = {
  companyName?: string;
  logoUrl?: string;
  customerName: string;
  customerPhone?: string | null;
  totalCharges: number;
  totalPayments: number;
  outstandingBalance: number;
  customerCredit: number;
  transactions: CustomerStatementPrintTransaction[];
};

/** Shared A4 customer-account statement used by both browser print and PDF export. */
export function customerStatementSheetCss() {
  return `${sheetReportCss("a4")}
    @page { size: A4 portrait; margin: 12mm; }
    .customer-statement-sheet { max-width: 186mm; margin: 0 auto; }
    .customer-statement-sheet .statement-customer { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:center; margin:12px 0; padding:10px; border:1px solid #000; }
    .customer-statement-sheet .statement-customer img { width:44px; max-height:44px; object-fit:contain; }
    .customer-statement-sheet .statement-summary { grid-template-columns:repeat(4,1fr); }
    .customer-statement-sheet .statement-table { font-size:10px; }
    .customer-statement-sheet .statement-table th,.customer-statement-sheet .statement-table td { padding:5px; }
    .customer-statement-sheet .num,.customer-statement-sheet .reference { direction:ltr; unicode-bidi:isolate; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .customer-statement-sheet .payment-history { font-size:8px; line-height:1.55; }
    .customer-statement-sheet tr { break-inside:avoid; page-break-inside:avoid; }
    .customer-statement-pdf-host { position:fixed; left:-10000px; top:0; width:186mm; background:#fff; color:#000; }
  `;
}

function statementEsc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function customerStatementPrintHtml(input: CustomerStatementPrintInput) {
  const rows = input.transactions.map((transaction) => {
    const history = transaction.paymentHistory?.length
      ? transaction.paymentHistory.map((payment) => `<div>${statementEsc(new Date(payment.date).toLocaleDateString("ar-IQ"))} · <span class="num">${statementEsc(formatCurrency(payment.amount))}</span>${payment.reference ? ` · ${statementEsc(payment.reference)}` : ""}</div>`).join("")
      : "—";
    return `<tr><td class="reference">${statementEsc(transaction.reference)}</td><td>${statementEsc(new Date(transaction.date).toLocaleDateString("ar-IQ"))}</td><td>${statementEsc(transaction.serviceType)}</td><td class="num">${statementEsc(formatCurrency(transaction.total))}</td><td class="num">${statementEsc(formatCurrency(transaction.paid))}</td><td class="num">${statementEsc(formatCurrency(transaction.remaining))}</td><td class="payment-history">${history}</td></tr>`;
  }).join("") || "<tr><td colspan=\"7\" style=\"text-align:center;padding:18px\">لا توجد عمليات لهذا العميل</td></tr>";
  return `<main class="report-sheet customer-statement-sheet"><header class="report-head"><div><div class="report-company">${statementEsc(input.companyName || "مجموعة علي جان نهاد")}</div><div class="report-title">كشف حساب العميل</div><div class="report-meta">تاريخ الإنشاء: ${statementEsc(new Date().toLocaleString("ar-IQ"))}</div></div>${input.logoUrl ? `<img class="report-logo" src="${statementEsc(input.logoUrl)}" alt="AJN">` : ""}</header><section class="statement-customer"><div><strong>العميل: ${statementEsc(input.customerName)}</strong><br><span class="num">${statementEsc(input.customerPhone || "—")}</span></div>${input.logoUrl ? `<img src="${statementEsc(input.logoUrl)}" alt="">` : ""}</section><section class="report-summary statement-summary"><div class="report-stat">إجمالي المستحق<strong class="num">${statementEsc(formatCurrency(input.totalCharges))}</strong></div><div class="report-stat">إجمالي المدفوع<strong class="num">${statementEsc(formatCurrency(input.totalPayments))}</strong></div><div class="report-stat">الرصيد المستحق<strong class="num">${statementEsc(formatCurrency(input.outstandingBalance))}</strong></div><div class="report-stat">رصيد العميل<strong class="num">${statementEsc(formatCurrency(input.customerCredit))}</strong></div></section><table class="report-table statement-table"><thead><tr><th>رقم العملية</th><th>التاريخ</th><th>نوع الخدمة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>سجل الدفعات</th></tr></thead><tbody>${rows}</tbody></table><footer class="report-footer">كشف حساب صادر من نظام AJN</footer></main>`;
}

export function openCustomerStatementPrintWindow(input: CustomerStatementPrintInput) {
  const popup = window.open("", "_blank", "width=980,height=760");
  if (!popup) throw new Error("تعذر فتح نافذة الطباعة");
  popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>كشف حساب العميل</title><style>${customerStatementSheetCss()}</style></head><body>${customerStatementPrintHtml(input)}${printWhenImagesReadyScript()}</body></html>`);
  popup.document.close();
}

/**
 * Shared depreciation report styles.  Both the browser print window and the
 * downloadable PDF preview use this builder so A4 and thermal never drift.
 */
export function depreciationReportCss(kind: "a4" | "80mm") {
  if (kind === "80mm")
    return `${thermalReceiptCss("80mm")}
    .depreciation-thermal .asset { padding:4px 0; border-bottom:1.5px solid #000; }
    .depreciation-thermal .asset b { display:block; font-size:1.03em; }
    .depreciation-thermal .asset .line { display:flex; justify-content:space-between; gap:5px; font-size:.88em; }
    .depreciation-thermal .filter-note { font-size:.82em; line-height:1.45; }
  `;
  return `${sheetReportCss("a4")}
    @page { size:A4 portrait; margin:10mm; }
    .depreciation-sheet { min-height:277mm; }
    .depreciation-sheet .report-summary { grid-template-columns:repeat(5,1fr); }
    .depreciation-sheet .filter-note { border:1px solid #000; padding:7px; margin:10px 0; font-size:10px; }
    .depreciation-sheet .report-table { font-size:9px; }
    .depreciation-sheet .report-table thead { display:table-header-group; }
    .depreciation-sheet .report-table tr { break-inside:avoid; page-break-inside:avoid; }
    .depreciation-sheet .report-table .num { direction:ltr; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .depreciation-sheet .print-page { position:fixed; bottom:2mm; left:10mm; right:10mm; display:flex; justify-content:space-between; font-size:9px; }
    .depreciation-sheet .page-counter:after { content:"صفحة " counter(page); }
  `;
}

/** Shared A4 salary-slip layout. Keep salary printing out of view-local CSS. */
export function salarySlipCss() {
  return `
    ${sheetReportCss("a4")}
    .salary-slip { border: 1px solid #111; padding: 9mm; min-height: 180mm; }
    .salary-person { display: grid; grid-template-columns: repeat(2,1fr); gap: 8px; margin: 14px 0; }
    .salary-person .field { border: 1px solid #bbb; padding: 8px; min-height: 52px; }
    .salary-person .field span { display:block; font-size:10px; margin-bottom:4px; }
    .salary-person .field b { font-size:13px; }
    .salary-components { width:100%; border-collapse:collapse; margin-top:12px; font-variant-numeric:tabular-nums; }
    .salary-components th,.salary-components td { border:1px solid #111; padding:7px; text-align:right; }
    .salary-components th { background:#f2f2f2; font-weight:800; }
    .salary-net { display:flex; justify-content:space-between; align-items:center; border:2px solid #111; padding:12px; margin-top:14px; font-size:18px; font-weight:800; }
    .salary-signatures { display:flex; justify-content:space-between; gap:30px; margin-top:35px; }
    .salary-signatures div { width:42%; border-top:1px dashed #111; padding-top:7px; text-align:center; }
    .salary-slip .qr-block { margin-top:14px; text-align:center; break-inside:avoid; page-break-inside:avoid; }
    .salary-slip .qr-code { width:96px; height:96px; object-fit:contain; image-rendering:pixelated; display:block; margin:0 auto 4px; }
    .salary-slip .qr-block small { display:block; font-variant-numeric:tabular-nums; }
  `;
}

/** A4 portrait sheet containing two identical compact luxury invoices for cutting. */
export function luxuryDuplicateInvoiceCss() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap');
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin:0; padding:0; background:#fffdf9; direction:rtl; font-family:Cairo,Tahoma,Arial,sans-serif; color:#7a3e52; }
    .luxury-invoice-page { width:210mm; min-height:297mm; padding:5mm 7mm; background:linear-gradient(135deg,#fffdf9 0%,#fff7f0 52%,#fffdf9 100%); }
    .luxury-invoice-copy { position:relative; height:140mm; overflow:hidden; padding:5mm; border:0.45mm solid #d8a94d; border-radius:5mm 5mm 2.5mm 2.5mm; background:linear-gradient(145deg,rgba(255,253,249,.98),rgba(255,239,239,.86)); }
    .luxury-invoice-copy:before,.luxury-invoice-copy:after { content:""; position:absolute; width:31mm; height:31mm; pointer-events:none; opacity:.62; background:radial-gradient(circle at 24% 26%,#f9bdc6 0 10%,transparent 11%),radial-gradient(circle at 42% 17%,#eab166 0 5%,transparent 6%),radial-gradient(circle at 58% 30%,#f5d9a4 0 4%,transparent 5%),radial-gradient(circle at 75% 17%,#e1b951 0 3%,transparent 4%); }
    .luxury-invoice-copy:before { top:-3mm; right:-3mm; transform:rotate(15deg); } .luxury-invoice-copy:after { bottom:-4mm; left:-3mm; transform:rotate(195deg); }
    .luxury-cut { height:7mm; display:flex; align-items:center; gap:3mm; color:#d897a7; font-size:10px; letter-spacing:.16em; }
    .luxury-cut:before,.luxury-cut:after { content:""; flex:1; border-top:.25mm dashed #d897a7; }.luxury-cut .scissors { color:#c69a3d; font-size:17px; line-height:1; }
    .li-header { position:relative; z-index:1; display:grid; grid-template-columns:31mm 1fr 41mm; gap:3mm; align-items:start; }
    .li-meta,.li-customer { border:.2mm solid #efc7cc; border-radius:3mm; padding:2.2mm 2.8mm; background:rgba(255,255,255,.6); font-size:8px; line-height:1.45; }.li-meta b,.li-customer b { color:#b64969; }.li-kv { display:flex; justify-content:space-between; gap:2mm; }.li-kv + .li-kv { margin-top:1mm; }
    .li-brand { text-align:center; padding-top:1mm; }.li-logo { width:17mm; height:10mm; object-fit:contain; display:block; margin:0 auto .5mm; }.li-brand-name { font:700 13px "Playfair Display",Cairo,serif; letter-spacing:.07em; color:#bb8540; }.li-brand-ar { font-size:10px; font-weight:800; color:#c65370; }.li-title { margin-top:1mm; font:700 17px "Playfair Display",Cairo,serif; color:#c7506e; letter-spacing:.08em; }.li-subtitle { color:#c49643; font-size:7px; font-weight:700; letter-spacing:.22em; }
    .li-qr { width:18mm; height:18mm; object-fit:contain; image-rendering:pixelated; display:block; margin:2mm auto 0; }
    .li-section { position:relative; z-index:1; margin-top:2.2mm; }.li-section-title { display:flex; align-items:center; gap:2mm; color:#bf506e; font-size:8px; font-weight:800; }.li-section-title:after { content:""; height:.2mm; flex:1; background:linear-gradient(90deg,#e8c675,transparent); }
    .li-table { width:100%; margin-top:1.5mm; border-collapse:separate; border-spacing:0; overflow:hidden; border:.2mm solid #efc4c8; border-radius:2mm; font-size:7px; table-layout:fixed; background:rgba(255,255,255,.45); }.li-table th { padding:1.2mm 1mm; color:#ad3e5a; background:linear-gradient(90deg,#fde1e4,#fff0ee); font-weight:800; text-align:center; }.li-table td { padding:1.05mm 1mm; border-top:.15mm solid #f3d8d3; vertical-align:top; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.li-table td:nth-child(2),.li-table td:nth-child(3) { text-align:right; }.li-table .num { font-variant-numeric:tabular-nums; }
    .li-bottom { position:relative; z-index:1; display:grid; grid-template-columns:1.1fr .9fr; gap:3mm; margin-top:2mm; }.li-payments { display:flex; flex-wrap:wrap; gap:1.2mm; margin-top:1.5mm; }.li-chip { border:.18mm solid #e8c68b; border-radius:10mm; padding:1mm 2mm; font-size:6.5px; color:#976e33; background:rgba(255,255,255,.55); }.li-notes { margin-top:2.5mm; font-size:7px; color:#975f6c; line-height:1.5; }.li-sign { display:flex; align-items:end; justify-content:space-between; gap:2mm; margin-top:2.8mm; font-size:6.5px; }.li-sign-line { width:33mm; border-bottom:.2mm solid #c79b45; text-align:center; padding-bottom:.8mm; font-family:"Playfair Display",serif; font-size:11px; color:#b85c73; }
    .li-summary { padding:2mm 2.4mm; border-radius:2.5mm; background:rgba(255,255,255,.5); }.li-summary-row { display:flex; justify-content:space-between; gap:3mm; padding:.55mm 0; border-bottom:.12mm solid #f2dfd4; font-size:7px; }.li-total-card { margin-top:1.5mm; padding:2mm; border:.35mm solid #d7a849; border-radius:2.5mm; text-align:center; background:linear-gradient(135deg,#fde4e7,#fff1e5); box-shadow:inset 0 0 0 .35mm rgba(255,255,255,.7); }.li-total-card span { display:block; color:#b4506a; font-size:7px; font-weight:800; letter-spacing:.13em; }.li-total-card b { display:block; margin-top:.6mm; color:#c34b67; font:700 16px "Playfair Display",Cairo,serif; }
    .li-footer { position:absolute; z-index:1; right:5mm; left:5mm; bottom:3.3mm; display:flex; justify-content:space-between; align-items:center; padding-top:1.5mm; border-top:.15mm solid #e8cd9a; color:#a67840; font-size:6.2px; direction:ltr; }.li-stamp { width:13mm; height:13mm; border:.3mm solid #d29b4a; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#bf5871; font:700 7px "Playfair Display",serif; transform:rotate(-10deg); }
    @media screen { .luxury-invoice-page { margin:20px auto; box-shadow:0 20px 50px rgba(133,91,79,.16); } }
    @media print { html,body { width:210mm; height:297mm; background:#fffdf9; }.luxury-invoice-page { margin:0; box-shadow:none; } }
  `;
}

/**
 * Premium full-page wedding invoice. The outer sheet is 216 × 303 mm so the
 * 210 × 297 mm A4 trim receives a real 3 mm bleed on every edge.
 * Palette targets CMYK-friendly blush/rose/champagne inks while keeping body
 * copy dark enough for reliable offset and office printing.
 */
export function luxuryWeddingInvoiceCss() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap');
    @page { size: 216mm 303mm; margin: 0; }
    :root { --wi-ivory:#fffaf3; --wi-cream:#fff3e7; --wi-blush:#f8dfe3; --wi-rose:#b64b68; --wi-rose-dark:#733647; --wi-gold:#c6953f; --wi-gold-light:#e7c87d; --wi-ink:#4d3038; }
    * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    html,body { margin:0; min-height:100%; background:#f4f0ed; color:var(--wi-ink); direction:rtl; font-family:Cairo,Tahoma,Arial,sans-serif; }
    .wedding-invoice-bleed { position:relative; width:216mm; min-height:303mm; margin:0 auto; padding:3mm; overflow:hidden; background:linear-gradient(145deg,#fffdf9 0%,var(--wi-cream) 52%,#fffdf9 100%); }
    .wedding-invoice { position:relative; min-height:297mm; padding:11mm 11mm 9mm; overflow:hidden; isolation:isolate; background:radial-gradient(circle at 50% 3%,rgba(255,255,255,.96),transparent 34%),linear-gradient(135deg,rgba(255,255,255,.96),rgba(255,248,242,.94)); border:.35mm solid var(--wi-gold); }
    .wedding-invoice:before { content:""; position:absolute; inset:2.2mm; z-index:0; pointer-events:none; border:.18mm solid rgba(198,149,63,.72); border-radius:7mm 7mm 4mm 4mm; }
    .wedding-invoice:after { content:""; position:absolute; inset:4.1mm; z-index:0; pointer-events:none; border:.12mm solid rgba(182,75,104,.24); border-radius:5.5mm; }
    .wi-content { position:relative; z-index:3; min-height:274mm; display:flex; flex-direction:column; }
    .wi-floral { position:absolute; z-index:2; width:59mm; height:84mm; object-fit:contain; pointer-events:none; opacity:.88; filter:saturate(.92) contrast(1.03); }
    .wi-floral.tr { top:-8mm; right:-8mm; }.wi-floral.tl { top:-8mm; left:-8mm; transform:scaleX(-1); }
    .wi-floral.br { right:-8mm; bottom:-10mm; transform:scaleY(-1); }.wi-floral.bl { left:-8mm; bottom:-10mm; transform:scale(-1); }
    .wi-sparkles { position:absolute; inset:8mm; z-index:1; pointer-events:none; opacity:.42; background-image:radial-gradient(circle,#d8a84d 0 .35mm,transparent .42mm),radial-gradient(circle,#e5afbc 0 .3mm,transparent .38mm); background-size:38mm 43mm,51mm 37mm; background-position:5mm 8mm,21mm 18mm; }
    .wi-crop { position:absolute; z-index:9; width:5mm; height:5mm; pointer-events:none; opacity:.75; }.wi-crop:before,.wi-crop:after { content:""; position:absolute; background:#5b3b42; }
    .wi-crop:before { width:5mm; height:.12mm; top:2.5mm; }.wi-crop:after { width:.12mm; height:5mm; left:2.5mm; }
    .wi-crop.tl{top:.5mm;left:.5mm}.wi-crop.tr{top:.5mm;right:.5mm}.wi-crop.bl{bottom:.5mm;left:.5mm}.wi-crop.br{bottom:.5mm;right:.5mm}
    .wi-brand { text-align:center; padding:0 42mm 2.2mm; }
    .wi-crown { display:block; height:6mm; color:var(--wi-gold); font:700 22px Georgia,serif; line-height:1; }
    .wi-logo { display:block; width:24mm; height:14mm; margin:0 auto 1mm; object-fit:contain; }
    .wi-company-en { color:#9e6f2e; font:700 17px "Playfair Display",Georgia,serif; letter-spacing:.12em; line-height:1.05; }
    .wi-company-ar { margin-top:.7mm; color:var(--wi-rose); font-size:12px; font-weight:800; line-height:1.25; }
    .wi-for-events { color:#a77734; font:700 8px "Playfair Display",Georgia,serif; letter-spacing:.25em; direction:ltr; }
    .wi-title { display:flex; align-items:center; justify-content:center; gap:3mm; margin-top:1.5mm; color:var(--wi-rose); font:700 21px "Playfair Display",Cairo,serif; }
    .wi-title:before,.wi-title:after { content:""; width:18mm; height:.18mm; background:linear-gradient(90deg,transparent,var(--wi-gold)); }.wi-title:after{transform:scaleX(-1)}
    .wi-title small { color:var(--wi-gold); font:600 8px Cairo,sans-serif; letter-spacing:.08em; }
    .wi-top { display:grid; grid-template-columns:1fr 45mm 1fr; gap:3.2mm; align-items:start; margin-top:-28mm; min-height:36mm; }
    .wi-top-spacer { min-height:1px; }
    .wi-panel { min-height:36mm; padding:3mm 3.4mm; border:.22mm solid rgba(198,149,63,.6); border-radius:4mm; background:rgba(255,255,255,.74); }
    .wi-panel-title { display:flex; align-items:center; gap:1.6mm; margin-bottom:1.5mm; padding-bottom:1mm; color:var(--wi-rose); border-bottom:.16mm solid rgba(198,149,63,.35); font-size:8.5px; font-weight:800; }
    .wi-panel-title:before { content:"✦"; color:var(--wi-gold); }
    .wi-info-grid { display:grid; grid-template-columns:1fr 1fr; gap:.85mm 2mm; }
    .wi-field { min-width:0; display:grid; grid-template-columns:19mm 1fr; gap:1.2mm; align-items:start; font-size:7.2px; line-height:1.45; }
    .wi-field.wide { grid-column:1/-1; }.wi-field span { color:#875b67; font-weight:600; }.wi-field b { min-width:0; color:var(--wi-ink); font-weight:700; overflow-wrap:anywhere; }
    .wi-codes { display:grid; grid-template-columns:19mm 1fr; gap:2mm; align-items:end; margin-top:2mm; }
    .wi-qr { width:18mm; height:18mm; padding:1mm; border:.18mm solid var(--wi-gold-light); border-radius:2mm; background:#fff; image-rendering:pixelated; }
    .wi-code-caption { display:block; margin-top:.7mm; color:var(--wi-rose); font-size:5.8px; text-align:center; direction:ltr; }
    .wi-barcode { width:100%; height:11mm; overflow:hidden; }.wi-barcode svg { width:100%; height:10mm; display:block; }
    .wi-readable { margin-top:.3mm; direction:ltr; color:#76535c; font:600 6px ui-monospace,Consolas,monospace; text-align:center; letter-spacing:.08em; }
    .wi-section { margin-top:3.4mm; }
    .wi-section-heading { display:flex; align-items:center; gap:2mm; margin-bottom:1.5mm; color:var(--wi-rose); font-size:9px; font-weight:800; }
    .wi-section-heading:before { content:"✦"; color:var(--wi-gold); }.wi-section-heading:after { content:""; height:.15mm; flex:1; background:linear-gradient(90deg,var(--wi-gold-light),transparent); }
    table.wi-items { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; overflow:hidden; border:.2mm solid rgba(198,149,63,.65); border-radius:3mm; font-size:7.1px; font-variant-numeric:tabular-nums; }
    .wi-items thead { display:table-header-group; }.wi-items th { padding:2mm 1mm; color:#923e57; background:linear-gradient(90deg,#f9d8de,#fff0e9); border-bottom:.2mm solid rgba(198,149,63,.55); font-weight:800; text-align:center; }
    .wi-items td { padding:1.7mm 1mm; border-bottom:.12mm solid #ecd8d1; border-inline-start:.1mm solid #f0dfd8; vertical-align:top; text-align:center; overflow-wrap:anywhere; }
    .wi-items tbody tr:nth-child(even) td { background:rgba(249,223,227,.32); }.wi-items tbody tr:last-child td { border-bottom:0; }
    .wi-items td.service,.wi-items td.description { text-align:right; }.wi-items td.num { direction:ltr; white-space:nowrap; }
    .wi-totals-card { margin-top:3.5mm; padding:2.8mm; border:.22mm solid rgba(198,149,63,.58); border-radius:3.5mm; background:rgba(255,255,255,.7); break-inside:avoid; page-break-inside:avoid; }
    .wi-totals-layout { display:grid; grid-template-columns:minmax(0,1fr) 38mm; overflow:hidden; border:.15mm solid rgba(198,149,63,.34); border-radius:2.6mm; background:#fffdfa; }
    .wi-summary-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); align-items:stretch; }
    .wi-summary-cell { display:flex; min-width:0; flex-direction:column; justify-content:space-between; gap:1.2mm; padding:2.5mm 1.5mm; border-inline-start:.12mm solid #ead9d1; text-align:center; }.wi-summary-cell:first-child { border-inline-start:0; }.wi-summary-cell span { color:#865666; font-size:6.5px; font-weight:700; line-height:1.25; }.wi-summary-cell small { display:block; margin-top:.35mm; color:#a78470; direction:ltr; font:600 5.6px "Playfair Display",Cairo,serif; letter-spacing:.03em; }.wi-summary-cell b { direction:ltr; color:var(--wi-ink); font-size:7.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }.wi-summary-cell.remaining { background:rgba(248,223,227,.42); }.wi-summary-cell.remaining span,.wi-summary-cell.remaining b { color:var(--wi-rose); }
    .wi-grand { position:relative; display:flex; min-height:21mm; flex-direction:column; align-items:center; justify-content:center; padding:2.6mm 1.5mm; text-align:center; border-inline-start:.25mm solid var(--wi-gold); background:linear-gradient(135deg,#f7d9df,#fff0e3); box-shadow:inset 0 0 0 .6mm rgba(255,255,255,.75); }.wi-grand:before{content:"♛";position:absolute;top:-3.2mm;right:calc(50% - 3mm);width:6mm;color:var(--wi-gold);background:var(--wi-ivory);font-size:12px}.wi-grand span{display:block;color:#9d4059;font:700 6.5px "Playfair Display",Cairo,serif;letter-spacing:.05em}.wi-grand b{display:block;margin-top:.8mm;color:var(--wi-rose);font:700 14px "Playfair Display",Cairo,serif;direction:ltr;white-space:nowrap}
    .wi-signatures { display:grid; grid-template-columns:repeat(6,1fr); gap:2.4mm; margin-top:auto; padding:5mm 3mm 0; break-inside:avoid; page-break-inside:avoid; }.wi-signature { min-height:16mm; text-align:center; color:#724b56; font-size:6.5px; }.wi-signature .line { display:flex; align-items:flex-end; justify-content:center; height:10mm; border-bottom:.16mm solid #c79b51; color:#8d5362; font:600 10px "Playfair Display",Cairo,serif; }.wi-stamp { width:18mm; height:18mm; margin:-2mm auto 0; display:flex; align-items:center; justify-content:center; border:.35mm double var(--wi-rose); border-radius:50%; color:var(--wi-rose); font:700 7px "Playfair Display",serif; transform:rotate(-8deg); }
    .wi-footer { margin-top:3.2mm; padding:2.4mm 15mm 0; border-top:.16mm solid rgba(198,149,63,.65); text-align:center; }.wi-footer-main { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:1.3mm 4mm; direction:ltr; color:#7b5360; font-size:6.2px; }.wi-footer-main span:before{content:"✦";margin-right:1mm;color:var(--wi-gold)}.wi-footer-address{margin-top:1mm;color:#8a653d;font-size:6.3px}.wi-website-qr{position:absolute;bottom:4.2mm;left:7mm;width:13mm;height:13mm;padding:.6mm;background:#fff;border:.15mm solid var(--wi-gold-light);border-radius:1.5mm}
    .wi-status { display:inline-flex; align-items:center; justify-content:center; padding:.7mm 2mm; border-radius:8mm; color:#fff; background:var(--wi-rose); font-size:6.2px; font-weight:800; }
    .wi-continued { display:none; }
    @media screen { .wedding-invoice-bleed { margin:20px auto; box-shadow:0 8px 24px rgba(92,54,62,.16); }.wedding-invoice-stage{overflow:auto;padding:1px}.wi-crop{display:none} }
    @media print { html,body { width:216mm; min-height:303mm; background:#fff; }.wedding-invoice-bleed{margin:0;box-shadow:none;break-after:page}.wedding-invoice-stage{overflow:visible}.wi-items tr,.wi-totals-card,.wi-signatures{break-inside:avoid;page-break-inside:avoid} }
  `;
}

/** Print the current document only after every logo/QR/decorative image settles. */
export async function printDocumentWhenImagesReady(
  root: ParentNode = document,
) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            window.setTimeout(done, 2500);
          }),
    ),
  );
  window.print();
}

export function printWhenImagesReadyScript(closeAfterPrint = true) {
  return `
    <script>
      function waitForImages() {
        var imgs = Array.prototype.slice.call(document.images || []);
        if (!imgs.length) return Promise.resolve();
        return Promise.all(imgs.map(function(img) {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise(function(resolve) {
            var done = function() { resolve(); };
            img.onload = done;
            img.onerror = done;
            setTimeout(done, 2200);
          });
        }));
      }
      window.onload = function() {
        waitForImages().then(function() {
          setTimeout(function() {
            var desktopPrint = window.ajnDesktop && window.ajnDesktop.print;
            if (desktopPrint) {
              Promise.resolve(desktopPrint()).finally(function() {
                ${closeAfterPrint ? "setTimeout(function(){ window.close(); }, 250);" : ""}
              });
            } else {
              window.print();
              ${closeAfterPrint ? "setTimeout(function(){ window.close(); }, 700);" : ""}
            }
          }, 150);
        });
      };
    </script>
  `;
}

export function openQrPrintWindow({
  qrDataUrl,
  customerName,
  amount,
  title = "QR الفاتورة",
  paperSize = "80mm",
}: {
  qrDataUrl?: string | null;
  customerName?: string | null;
  amount?: string | number | null;
  title?: string;
  paperSize?: ThermalPaperSize;
}) {
  if (!qrDataUrl) {
    throw new Error("تعذر توليد QR للطباعة");
  }
  const amountText =
    amount === null || amount === undefined || amount === ""
      ? ""
      : formatCurrency(amount);
  const safeName = customerName?.trim() || "عميل";
  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      ${thermalBaseCss(paperSize, paperSize === "58mm" ? "9px" : "10px")}
      body { text-align: center; }
      .qr-label { padding: 4mm 2mm; }
      .title { font-size: 1.1em; margin-bottom: 6px; }
      .name { font-size: 1.05em; font-weight: 700; margin-top: 6px; }
      .amount { font-size: 1.05em; font-weight: 700; margin-top: 3px; }
    </style>
  </head><body>
    <div class="qr-label">
      <div class="title">${title}</div>
      <img class="qr-code" src="${qrDataUrl}" alt="QR" />
      <div class="name">${safeName}</div>
      ${amountText ? `<div class="amount">${amountText}</div>` : ""}
    </div>
    ${printWhenImagesReadyScript()}
  </body></html>`;
  const w = window.open("", "_blank", "width=360,height=520");
  if (!w) throw new Error("تعذر فتح نافذة الطباعة");
  w.document.write(html);
  w.document.close();
}

export function graduationLabelCss(size: "40x30" | "58mm" | "80mm" = "40x30") {
  if (size !== "40x30")
    return thermalBaseCss(size, size === "58mm" ? "9px" : "10px");
  return `
    @page { size: 40mm 30mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 40mm; min-height: 30mm; margin: 0; padding: 0; }
    body { direction: rtl; background: #fff; color: #000; font-family: Cairo, Tahoma, Arial, sans-serif; }
    .graduation-label { width: 40mm; min-height: 30mm; padding: 1.6mm; display: grid; grid-template-columns: 1fr 15mm; gap: 1.2mm; align-items: center; overflow: hidden; }
    .graduation-label .brand { font-size: 8px; font-weight: 900; }
    .graduation-label .name { margin-top: 1mm; font-size: 9px; line-height: 1.2; font-weight: 900; }
    .graduation-label .meta { margin-top: .7mm; font-size: 7px; line-height: 1.35; font-weight: 700; }
    .graduation-label .code { margin-top: .8mm; direction: ltr; font-family: ui-monospace, Consolas, monospace; font-size: 6.5px; font-weight: 900; overflow-wrap: anywhere; }
    .graduation-label img { display: block; width: 15mm; height: 15mm; object-fit: contain; image-rendering: pixelated; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  `;
}

export function openGraduationLabelPrintWindow({
  qrDataUrl,
  studentName,
  studentCode,
  itemType,
  size,
  color,
  group,
  paperSize = "40x30",
}: {
  qrDataUrl: string;
  studentName: string;
  studentCode: string;
  itemType: string;
  size?: string | null;
  color?: string | null;
  group?: string | null;
  paperSize?: "40x30" | "58mm" | "80mm";
}) {
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${itemType} - ${studentCode}</title><style>${graduationLabelCss(paperSize)}</style></head><body>
    <main class="graduation-label"><section><div class="brand">AJN · مجموعة علي جان نهاد</div><div class="name">${studentName}</div><div class="meta">${itemType}${size ? ` · ${size}` : ""}${color ? ` · ${color}` : ""}${group ? `<br>${group}` : ""}</div><div class="code">${studentCode}</div></section><img src="${qrDataUrl}" alt="QR"></main>
    ${printWhenImagesReadyScript()}
  </body></html>`;
  const popup = window.open("", "_blank", "width=420,height=420");
  if (!popup) throw new Error("تعذر فتح نافذة طباعة الملصق");
  popup.document.write(html);
  popup.document.close();
}

export function openGraduationProductionSheet({
  sheetType,
  studentName,
  studentCode,
  orderNo,
  snapshot,
}: {
  sheetType: string;
  studentName: string;
  studentCode: string;
  orderNo: string;
  snapshot?: Record<string, unknown> | null;
}) {
  const labels: Record<string, string> = {
    cutting: "ملف القص",
    sewing: "ملف الخياطة",
    printing: "ملف الطباعة",
    embroidery: "ملف التطريز",
    quality_control: "قائمة فحص الجودة",
    packaging: "قائمة التغليف",
    delivery: "ملف التسليم",
  };
  const safe = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character] || character,
    );
  const details = Object.entries(snapshot || {})
    .filter(
      ([key]) =>
        !["orderId", "studentName", "studentCode", "orderNo"].includes(key),
    )
    .map(
      ([key, value]) =>
        `<tr><th>${safe(key)}</th><td><pre>${safe(typeof value === "object" ? JSON.stringify(value, null, 2) : value)}</pre></td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${safe(labels[sheetType] || sheetType)} - ${safe(studentCode)}</title><style>${sheetReportCss("a4")} pre{white-space:pre-wrap;font:inherit;margin:0}.sheet-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.check{height:18px;width:18px;border:1px solid #111;display:inline-block;margin-left:7px}</style></head><body><main class="sheet"><header class="sheet-title"><div><div class="eyebrow">AJN · مجموعة علي جان نهاد</div><h1>${safe(labels[sheetType] || sheetType)}</h1><p>${safe(studentName)} · ${safe(studentCode)}</p></div><div><strong>${safe(orderNo)}</strong><p>${new Date().toLocaleDateString("ar-IQ")}</p></div></header><table><tbody>${details || "<tr><td>لا توجد تفاصيل إضافية.</td></tr>"}</tbody></table><section class="signature-row"><div><span class="check"></span>تم التنفيذ</div><div>اسم الموظف: __________________</div><div>التوقيع: __________________</div></section></main>${printWhenImagesReadyScript()}</body></html>`;
  const popup = window.open("", "_blank", "width=980,height=760");
  if (!popup) throw new Error("تعذر فتح نافذة طباعة ملف الإنتاج");
  popup.document.write(html);
  popup.document.close();
}

export function openResearchReceiptPrint({
  order,
  chapters = [],
  sources = [],
}: {
  order: Record<string, any>;
  chapters?: Array<Record<string, any>>;
  sources?: Array<Record<string, any>>;
}) {
  const safe = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character] || character,
    );
  const rows = chapters
    .map(
      (chapter) =>
        `<tr><td>${safe(chapter.title)}</td><td>${safe(chapter.status)}</td><td class="num">${safe(chapter.progress)}%</td></tr>`,
    )
    .join("");
  const references = sources
    .slice(0, 12)
    .map(
      (source, index) =>
        `<li><strong>[${index + 1}]</strong> ${safe(source.authors?.join?.(", ") || "")}. ${safe(source.title)}. ${safe(source.publicationYear || "")}${source.doi ? `. DOI: ${safe(source.doi)}` : ""}</li>`,
    )
    .join("");
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${safe(order.researchNo)}</title><style>${sheetReportCss("a4")}.research-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:20px}.research-code{font-family:ui-monospace,Consolas,monospace}.research-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.research-meta>div{border:1px solid #111;padding:8px}.references{font-size:10px;line-height:1.7;padding-right:18px}.num{font-variant-numeric:tabular-nums}@media(max-width:700px){.research-meta{grid-template-columns:1fr}}</style></head><body><main class="sheet"><header class="research-head"><div><div class="eyebrow">مجموعة علي جان نهاد</div><h1>ملف طلب بحث أكاديمي</h1><p>${safe(order.title)}</p></div><div><strong class="research-code">${safe(order.researchNo)}</strong><p>${new Date().toLocaleDateString("ar-IQ")}</p></div></header><section class="research-meta"><div><strong>الجامعة</strong><br>${safe(order.universityName)}</div><div><strong>الكلية والقسم</strong><br>${safe(order.college)} · ${safe(order.department)}</div><div><strong>نمط التوثيق</strong><br>${safe(order.citationStyle)}</div><div><strong>الإجمالي</strong><br>${formatCurrency(order.totalAmount)}</div><div><strong>المدفوع</strong><br>${formatCurrency(order.paidAmount)}</div><div><strong>المتبقي</strong><br>${formatCurrency(order.remainingAmount)}</div></section><h2>الفصول والتقدم</h2><table><thead><tr><th>الفصل</th><th>الحالة</th><th>الإنجاز</th></tr></thead><tbody>${rows}</tbody></table>${references ? `<h2>المراجع المختارة</h2><ol class="references">${references}</ol>` : ""}<footer><p>هذا المستند ملخص تشغيلي صادر من AJN Research Center.</p></footer></main>${printWhenImagesReadyScript()}</body></html>`;
  const popup = window.open("", "_blank", "width=980,height=760");
  if (!popup) throw new Error("تعذر فتح نافذة طباعة ملف البحث");
  popup.document.write(html);
  popup.document.close();
}

export function downloadDataUrl(
  dataUrl: string | undefined | null,
  filename: string,
) {
  if (!dataUrl) throw new Error("لا توجد صورة QR للتحميل");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
