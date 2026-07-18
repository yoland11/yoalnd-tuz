import { formatCurrency } from "@/lib/money";
import { printWhenImagesReadyScript } from "./print-helpers";

/**
 * The delivery payload as returned by formatDeliveryDetail on the server. Kept
 * loose because the label is a presentation-only view.
 */
export type DeliveryLabelData = {
  provinceName?: string;
  city?: string;
  district?: string;
  area?: string;
  fullAddress?: string;
  landmark?: string;
  receiverName?: string;
  receiverPhone?: string | null;
  receiverAltPhone?: string | null;
  deliveryCompany?: string | null;
  deliveryTypeLabel?: string;
  codEnabled?: boolean;
  codAmount?: number;
  isFragile?: boolean;
  needsRefrigeration?: boolean;
  expectedArrivalDate?: string | null;
  order?: { deliveryNo?: string; status?: string } | null;
};

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c],
  );
}

/**
 * Opens a print window with an A6 shipping label for a delivery order. Includes
 * receiver + address, province/city, company, invoice and delivery numbers, COD
 * amount, QR, and fragile / refrigerated indicators.
 */
export function printDeliveryLabel(opts: {
  delivery: DeliveryLabelData;
  invoiceNo: string;
  company: string;
  qrDataUrl?: string;
}) {
  const { delivery: d, invoiceNo, company, qrDataUrl } = opts;
  const deliveryNo = d.order?.deliveryNo ?? "—";
  const addressLine = [d.city, d.district, d.area].filter(Boolean).join(" — ");
  const indicators = [d.isFragile ? "قابل للكسر ⚠" : "", d.needsRefrigeration ? "يحتاج تبريد ❄" : ""].filter(Boolean);

  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>ملصق التوصيل ${esc(deliveryNo)}</title>
  <style>
    @page { size: A6; margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #000; margin: 0; font-size: 12px; }
    .label { width: 100%; border: 2px solid #000; border-radius: 6px; padding: 8px; }
    .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .brand { font-weight: 800; font-size: 14px; }
    .muted { color: #333; font-size: 10px; }
    .nums { text-align: left; direction: ltr; }
    .big { font-size: 13px; font-weight: 800; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    .kv { margin: 2px 0; }
    .kv b { display: inline-block; min-width: 68px; color: #000; }
    .prov { font-size: 18px; font-weight: 800; text-align: center; margin: 4px 0; letter-spacing: 1px; }
    .cod { border: 2px solid #000; border-radius: 6px; padding: 4px 6px; text-align: center; font-weight: 800; font-size: 14px; margin-top: 6px; }
    .flags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .flag { border: 1px solid #000; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 700; }
    .qr { text-align: center; }
    .qr img { width: 74px; height: 74px; object-fit: contain; image-rendering: pixelated; }
  </style></head><body>
  <div class="label">
    <div class="row">
      <div>
        <div class="brand">${esc(company)}</div>
        <div class="muted">ملصق توصيل / SHIPPING LABEL</div>
      </div>
      <div class="qr">${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" />` : ""}</div>
    </div>
    <div class="prov">${esc(d.provinceName || "—")}</div>
    <div class="row">
      <div><span class="muted">رقم التوصيل</span><div class="big nums">${esc(deliveryNo)}</div></div>
      <div><span class="muted">رقم الفاتورة</span><div class="big nums">${esc(invoiceNo)}</div></div>
    </div>
    <hr />
    <div class="kv"><b>المستلم:</b> ${esc(d.receiverName || "—")}</div>
    <div class="kv"><b>الهاتف:</b> <span class="nums">${esc(d.receiverPhone || "—")}</span>${
      d.receiverAltPhone ? ` / <span class="nums">${esc(d.receiverAltPhone)}</span>` : ""
    }</div>
    <div class="kv"><b>المدينة:</b> ${esc(addressLine || "—")}</div>
    <div class="kv"><b>العنوان:</b> ${esc(d.fullAddress || "—")}</div>
    ${d.landmark ? `<div class="kv"><b>نقطة دالة:</b> ${esc(d.landmark)}</div>` : ""}
    <div class="kv"><b>الشركة:</b> ${esc(d.deliveryCompany || "—")} · ${esc(d.deliveryTypeLabel || "")}</div>
    ${d.expectedArrivalDate ? `<div class="kv"><b>الوصول:</b> <span class="nums">${esc(d.expectedArrivalDate)}</span></div>` : ""}
    ${d.codEnabled ? `<div class="cod">تحصيل عند الاستلام: ${formatCurrency(d.codAmount ?? 0)}</div>` : ""}
    ${indicators.length ? `<div class="flags">${indicators.map((x) => `<span class="flag">${esc(x)}</span>`).join("")}</div>` : ""}
  </div>
  ${printWhenImagesReadyScript()}
  </body></html>`;

  const w = window.open("", "_blank", "width=480,height=680");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}
