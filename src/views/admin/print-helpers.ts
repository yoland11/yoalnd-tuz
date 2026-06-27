import { formatCurrency } from "@/lib/money";

export type ThermalPaperSize = "58mm" | "80mm" | "a4" | "pdf";

export function thermalPageWidth(size: ThermalPaperSize) {
  return size === "58mm" ? "58mm" : size === "80mm" ? "80mm" : "A4";
}

export function thermalBaseCss(size: ThermalPaperSize, fontSize?: string) {
  const isNarrow = size === "58mm" || size === "80mm";
  const pageWidth = thermalPageWidth(size);
  const margin = size === "58mm" ? "2mm 3mm" : size === "80mm" ? "3mm 4mm" : "12mm";
  const bodyFontSize = fontSize ?? (size === "58mm" ? "8px" : isNarrow ? "9px" : "12px");

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
            window.print();
            ${closeAfterPrint ? "setTimeout(function(){ window.close(); }, 700);" : ""}
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
  const amountText = amount === null || amount === undefined || amount === ""
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

export function downloadDataUrl(dataUrl: string | undefined | null, filename: string) {
  if (!dataUrl) throw new Error("لا توجد صورة QR للتحميل");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
