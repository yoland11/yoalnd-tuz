const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const MONEY_LABEL = "د.ع";

export function toLatinDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = toLatinDigits(value).replace(/[\s,،]/g, "").replace(new RegExp(MONEY_LABEL, "g"), "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatLatinNumber(value, options = {}) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, ...options, numberingSystem: "latn" }).format(numericValue(value));
}

export function formatLatinMoney(value) {
  return `${formatLatinNumber(value)} ${MONEY_LABEL}`;
}

export function formatLatinDate(value) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return toLatinDigits(value);
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(date);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function paymentMethodLabel(value) {
  return ({ cash: "نقدي", card: "بطاقة", transfer: "تحويل", credit: "آجل" })[String(value ?? "").toLowerCase()] ?? String(value ?? "");
}

function paymentStatusLabel(value, paid, remaining) {
  const status = String(value ?? "").toLowerCase();
  if (status === "overpaid") return "دفع أكثر من المطلوب";
  if (status === "paid" || numericValue(remaining) <= 0 && numericValue(paid) > 0) return "مدفوع بالكامل";
  if (status === "partial" || numericValue(paid) > 0) return "مدفوع جزئياً";
  return "غير مدفوع";
}

function boundedOffset(value) {
  return Math.min(5, Math.max(-5, numericValue(value)));
}

/** Canonical thermal stylesheet shared by browser printing and AJN Print Agent. */
export function salesInvoiceThermalCss(size, horizontalOffsetMm = 0, verticalOffsetMm = 0, orientation = "portrait", customWidthMm = 80, customHeightMm = 297) {
  const isThermal = size === "58mm" || size === "80mm";
  const is58 = size === "58mm";
  const customWidth = Math.min(210, Math.max(40, Number(customWidthMm) || 80));
  const customHeight = Math.min(500, Math.max(40, Number(customHeightMm) || 297));
  const pageSize = isThermal ? `${size} auto` : size === "a4" ? `A4 ${orientation}` : size === "a5" ? `A5 ${orientation}` : `${orientation === "landscape" ? customHeight : customWidth}mm ${orientation === "landscape" ? customWidth : customHeight}mm`;
  const pageMargin = isThermal ? "0" : "10mm";
  const pageWidth = isThermal ? size : "100%";
  const receiptWidth = isThermal ? (is58 ? "52mm" : "72mm") : "100%";
  const pad = isThermal ? (is58 ? "1.5mm" : "2mm") : "0";
  const base = isThermal ? (is58 ? "10px" : "11px") : "12px";
  const qr = isThermal ? (is58 ? "28mm" : "32mm") : "172px";
  const logoSize = isThermal ? (is58 ? "16mm" : "18mm") : "46px";
  const horizontal = boundedOffset(horizontalOffsetMm);
  const vertical = boundedOffset(verticalOffsetMm);
  // 80mm printers have non-printable side edges. Center a safe receipt area
  // instead of shifting it with a transform that can crop Arabic content.
  const calibration = !isThermal && (horizontal || vertical)
    ? `transform:translate(${horizontal}mm,${vertical}mm);`
    : "";
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800;900&display=swap');
    @page { size: ${pageSize}; margin: ${pageMargin}; }
    * { box-sizing:border-box; color:#000 !important; text-shadow:none !important; box-shadow:none !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    html, body { width:${pageWidth}; max-width:${pageWidth}; margin:0 !important; padding:0 !important; background:#fff !important; }
    body { direction:rtl; text-align:right; font-family:Cairo,Tahoma,Arial,sans-serif; font-weight:600; font-size:${base}; line-height:1.3; color:#000 !important; overflow:hidden; }
    .receipt { width:${receiptWidth}; max-width:${receiptWidth}; margin:0 auto; padding:${pad}; background:#fff; overflow:hidden; ${calibration} }
    .invoice-thermal-80 { width:72mm; max-width:72mm; }
    .invoice-thermal-58 { width:52mm; max-width:52mm; }
    .num { direction:ltr; unicode-bidi:isolate; font-variant-numeric:tabular-nums; font-feature-settings:"tnum"; }
    .center { text-align:center; }
    .r-head { width:100%; text-align:center; margin-bottom:2px; overflow-wrap:anywhere; }
    .r-logo { width:${logoSize}; height:${logoSize}; max-width:${logoSize}; max-height:${logoSize}; object-fit:contain; display:block; margin:0 auto 2px; filter:grayscale(1) contrast(1.45); }
    .r-company { max-width:100%; font-size:16px; font-weight:900; line-height:1.3; overflow-wrap:anywhere; }
    .r-sub { max-width:100%; font-size:.9em; font-weight:600; overflow-wrap:anywhere; }
    .rule { border:0; border-top:1.5px solid #000; margin:4px 0; }
    .rule.dashed { border-top:1.5px dashed #000; }
    .meta-rows { width:100%; }
    .receipt-info-row, .kv { display:flex; justify-content:space-between; align-items:flex-start; gap:4px; width:100%; min-width:0; margin:2px 0; font-weight:700; }
    .receipt-info-row > *, .kv > * { min-width:0; overflow-wrap:anywhere; word-break:break-word; }
    .receipt-info-row > :first-child, .kv > :first-child { flex:0 1 42%; }
    .kv .v { flex:1 1 58%; font-weight:800; text-align:left; }
    .kv .v.big { font-size:1.12em; }
    table.receipt-items { width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse; margin:2px 0; }
    table.receipt-items th { font-size:10px; line-height:1.2; font-weight:900; border-top:2px solid #000; border-bottom:2px solid #000; padding:2px 1px; text-align:center; overflow-wrap:anywhere; }
    table.receipt-items th.name, table.receipt-items td.name { text-align:right; }
    table.receipt-items td { padding:2px 1px; font-size:10px; line-height:1.2; border-bottom:1px solid #000; font-weight:700; vertical-align:top; overflow-wrap:anywhere; word-break:break-word; }
    table.receipt-items td.name { font-weight:800; }
    .invoice-thermal-80 .receipt-items th:nth-child(1), .invoice-thermal-80 .receipt-items td:nth-child(1) { width:6%; }
    .invoice-thermal-80 .receipt-items th:nth-child(2), .invoice-thermal-80 .receipt-items td:nth-child(2) { width:40%; }
    .invoice-thermal-80 .receipt-items th:nth-child(3), .invoice-thermal-80 .receipt-items td:nth-child(3) { width:12%; }
    .invoice-thermal-80 .receipt-items th:nth-child(4), .invoice-thermal-80 .receipt-items td:nth-child(4) { width:20%; }
    .invoice-thermal-80 .receipt-items th:nth-child(5), .invoice-thermal-80 .receipt-items td:nth-child(5) { width:22%; }
    .receipt-items .num { white-space:normal; overflow-wrap:anywhere; word-break:break-word; }
    table.receipt-items tr.ln2 td { border-bottom:1.5px solid #000; padding-top:0; }
    .totals { width:100%; max-width:100%; margin-top:3px; }
    .totals .row, .grand, .payline { display:flex; justify-content:space-between; align-items:center; gap:6px; width:100%; min-width:0; }
    .totals .row { font-weight:700; margin:2px 0; }
    .totals .row > *, .grand > *, .payline > * { min-width:0; overflow-wrap:anywhere; word-break:break-word; }
    .totals .row .num, .grand .num, .payline .num { flex:0 1 58%; text-align:left; white-space:normal; }
    .grand { border:2.5px solid #000; padding:4px; margin:4px 0; font-size:1.22em; font-weight:900; }
    .payline { font-weight:800; font-size:1.02em; margin:2px 0; }
    .payline.remain { font-size:1.2em; border:1.5px solid #000; padding:2px 5px; margin-top:3px; }
    .qr { width:100%; text-align:center; margin:3mm auto 1mm; break-inside:avoid; page-break-inside:avoid; }
    .qr img { width:${qr}; height:${qr}; object-fit:contain; image-rendering:pixelated; display:block; margin:0 auto 2px; }
    .qr .cap { max-width:100%; font-weight:700; font-size:.85em; overflow-wrap:anywhere; word-break:break-word; }
    .thanks { width:100%; text-align:center; font-weight:800; font-size:.95em; margin-top:3px; overflow-wrap:anywhere; }
    @media print { html,body { width:${pageWidth}; max-width:${pageWidth}; margin:0 !important; padding:0 !important; background:#fff !important; } body > :not(.receipt) { display:none !important; } .receipt, .receipt * { visibility:visible; } * { color:#000 !important; } }
  `;
}

/** Builds the one trusted Sales Invoice thermal document used by both print paths. */
export function buildSalesInvoiceThermalHtml(input) {
  const is58 = input.paperSize === "58mm";
  const kv = (label, value, className = "") => value === undefined || value === null || String(value).trim() === ""
    ? ""
    : `<div class="receipt-info-row kv"><span>${esc(label)}</span><span class="v ${className}">${esc(value)}</span></div>`;
  const items = Array.isArray(input.items) ? input.items : [];
  const itemRows = items.map((item, index) => {
    const name = item.productName ?? item.name ?? "";
    const quantity = formatLatinNumber(item.quantity, { maximumFractionDigits: 4 });
    if (is58) return `<tr><td class="name" colspan="2">${esc(name)}</td></tr><tr class="ln2"><td class="num">${quantity} × ${esc(formatLatinMoney(item.unitPrice))}</td><td class="num" style="text-align:left">${esc(formatLatinMoney(item.total))}</td></tr>`;
    return `<tr><td class="num center">${index + 1}</td><td class="name">${esc(name)}</td><td class="num center">${quantity}</td><td class="num center">${esc(formatLatinMoney(item.unitPrice))}</td><td class="num" style="text-align:left">${esc(formatLatinMoney(item.total))}</td></tr>`;
  }).join("");
  const itemHead = is58
    ? '<tr><th class="name">الصنف</th><th>الإجمالي</th></tr>'
    : '<tr><th>#</th><th class="name">الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>';
  const subtotal = numericValue(input.subtotal);
  const discount = numericValue(input.discount);
  const tax = numericValue(input.tax);
  const offerDelivery = numericValue(input.offerDeliveryFee);
  const delivery = numericValue(input.deliveryFee);
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : "";
  const meta = [
    kv("رقم الفاتورة", toLatinDigits(input.invoiceNo), "num big"),
    kv("التاريخ والوقت", formatLatinDate(input.issuedAt), "num"),
    kv("العميل", input.customerName),
    input.showCustomerPhone !== false ? kv("الهاتف", toLatinDigits(input.customerPhone), "num") : "",
    kv("نوع الدفع", paymentMethodLabel(input.paymentMethod)),
    kv("حالة الدفع", paymentStatusLabel(input.paymentStatus, input.paid, input.remaining)),
    input.showEmployeeName !== false ? kv("الموظف", input.employeeName) : "",
  ].join("");
  const header = `<div class="r-head">${input.showLogo !== false && input.logoUrl ? `<img class="r-logo" src="${esc(input.logoUrl)}" alt="" onerror="this.remove()">` : ""}<div class="r-company">${esc(input.companyName?.trim() || "مجموعة علي جان نهاد")}</div><div class="r-sub">لتنظيم المناسبات</div><div class="r-sub">فاتورة مبيعات</div></div>`;
  const totals = `<div class="totals">${subtotal ? `<div class="row"><span>المجموع الفرعي</span><span class="num">${esc(formatLatinMoney(subtotal))}</span></div>` : ""}${discount > 0 ? `<div class="row"><span>الخصم</span><span class="num">- ${esc(formatLatinMoney(discount))}</span></div>` : ""}${tax > 0 ? `<div class="row"><span>الضريبة</span><span class="num">${esc(formatLatinMoney(tax))}</span></div>` : ""}${offerDelivery > 0 ? `<div class="row"><span>أجور توصيل العرض</span><span class="num">${esc(formatLatinMoney(offerDelivery))}</span></div>` : ""}${delivery > 0 ? `<div class="row"><span>أجور التوصيل</span><span class="num">${esc(formatLatinMoney(delivery))}</span></div>` : ""}<div class="grand"><span>الإجمالي</span><span class="num">${esc(formatLatinMoney(input.total))}</span></div><div class="payline"><span>المدفوع</span><span class="num">${esc(formatLatinMoney(input.paid))}</span></div><div class="payline remain"><span>المتبقي</span><span class="num">${esc(formatLatinMoney(input.remaining))}</span></div></div>`;
  const qr = input.showQr !== false && input.qrImageUrl ? `<div class="qr"><img src="${esc(input.qrImageUrl)}" alt="QR"><div class="cap num">${esc(toLatinDigits(input.qrCaption || input.invoiceNo))}</div></div>` : "";
  const footer = `<div class="thanks">${esc(input.footerText?.trim() || "شكراً لاختياركم مجموعة علي جان نهاد")}</div>${input.companyPhone ? `<div class="r-sub center num">${esc(toLatinDigits(input.companyPhone))}</div>` : ""}${input.showAddress !== false && input.companyAddress ? `<div class="r-sub center">${esc(input.companyAddress)}</div>` : ""}`;
  const receiptClass = input.paperSize === "80mm" ? "invoice-thermal-80" : input.paperSize === "58mm" ? "invoice-thermal-58" : "";
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(toLatinDigits(input.invoiceNo))}</title><style>${salesInvoiceThermalCss(input.paperSize, input.horizontalOffsetMm, input.verticalOffsetMm, input.orientation, input.customWidthMm, input.customHeightMm)}</style></head><body><div class="receipt ${receiptClass}">${header}<hr class="rule"><div class="meta-rows">${meta}</div><hr class="rule dashed"><table class="items receipt-items"><thead>${itemHead}</thead><tbody>${itemRows}</tbody></table>${totals}${notes ? `<hr class="rule dashed"><div class="receipt-info-row kv"><span>ملاحظات</span><span class="v">${esc(notes)}</span></div>` : ""}${qr}${footer}</div></body></html>`;
}
