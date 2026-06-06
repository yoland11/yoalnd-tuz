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
    : `${Number(amount).toLocaleString("ar-IQ")} د.ع`;
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
