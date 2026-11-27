/**
 * Album printing: «وصل طلب الألبوم», «أمر تصنيع الألبوم», «وصل تسليم الألبوم»
 * and «ملصق الألبوم» with QR code and barcode. Built as standalone HTML and sent
 * through the existing printStandaloneDocument, so it works on the local
 * Windows server and shop Wi-Fi with no internet (QR/barcode drawn in-browser).
 *
 * The QR code and barcode carry only the album's opaque token / number — never
 * the customer's name or phone.
 */
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { printStandaloneDocument } from "@/lib/pdf";
import { albumQrPayload, albumStageLabel, formatIqd } from "@/lib/albums";
import { formatIraqiPhone } from "@/lib/phone";

export type AlbumPrintBrand = { name: string; logo?: string | null; phone?: string | null; address?: string | null };
export type AlbumPrintAlbum = {
  albumNo: string; qrToken: string; barcodeValue: string; customerName: string; phone: string; bookingCode?: string | null;
  occasionType?: string | null; albumType: string; albumSize: string; pageCount?: number | null; photoCount?: number | null; copies: number;
  coverType?: string | null; coverColor?: string | null; paperType?: string | null; boxType?: string | null; coverNames?: string | null;
  occasionDate?: string | null; orderDate?: string | null; dueDate?: string | null; stage: string; financeMode: string;
  designerName?: string | null; printerName?: string | null; binderName?: string | null; qualityName?: string | null;
  customerNotes?: string | null; internalNotes?: string | null;
  salePrice?: string; paidAmount?: string; remainingAmount?: string; invoiceNo?: string | null;
  deliveredAt?: string | null; deliveredToName?: string | null; deliveredByName?: string | null;
};
export type AlbumPrintCopy = { copyNo: number; code: string; qrToken: string };
export type AlbumDocFormat = "a4" | "80mm";

const BURGUNDY = "#7b1e3a";
const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const safeImage = (value?: string | null) => (value && /^(https?:\/\/|\/|data:image\/)/i.test(value) ? value : "");
const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

export async function albumQrDataUrl(token: string, width = 240) {
  return QRCode.toDataURL(albumQrPayload(origin(), token), { width, margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}
export function albumBarcodeSvg(value: string, height = 34) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, { format: "CODE128", height, width: 1.2, margin: 0, displayValue: false, background: "transparent", lineColor: "#000" });
  return new XMLSerializer().serializeToString(svg);
}

function shell(title: string, format: AlbumDocFormat, body: string) {
  const thermal = format === "80mm";
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  /* 80mm: zero-margin page, fluid width (Chromium centres a fixed page size on roll printers). */
  @page { ${thermal ? "margin: 0;" : "size: A4; margin: 12mm;"} }
  *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #fff; }
  body { direction: rtl; font-family: "Cairo", "Tajawal", "Segoe UI", Tahoma, Arial, sans-serif; color: #111; font-size: ${thermal ? "12px" : "13px"}; line-height: 1.55; ${thermal ? "padding: 2.5mm; font-weight: 600;" : ""} }
  ${thermal ? "body * { color: #000 !important; } .title { color: #fff !important; }" : ""}
  .head { display: flex; align-items: center; gap: 12px; ${thermal ? "flex-direction: column; text-align: center; gap: 4px;" : `border-bottom: 3px solid ${BURGUNDY}; padding-bottom: 10px;`} }
  .logo { width: ${thermal ? "44px" : "60px"}; height: ${thermal ? "44px" : "60px"}; object-fit: contain; }
  .company { font-size: ${thermal ? "15px" : "20px"}; font-weight: 800; ${thermal ? "" : `color: ${BURGUNDY};`} }
  .contact { font-size: 11px; color: #444; }
  .title { margin: 10px 0; padding: ${thermal ? "4px" : "8px"}; text-align: center; font-weight: 800; font-size: ${thermal ? "13px" : "16px"}; border-radius: 6px; background: ${thermal ? "#000" : BURGUNDY}; color: #fff; }
  .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: ${thermal ? "2px 0" : "5px 8px"}; border-bottom: 1px ${thermal ? "dashed #000" : "solid #eee2e6"}; vertical-align: top; }
  table.kv td:first-child { color: #555; width: ${thermal ? "42%" : "30%"}; white-space: nowrap; }
  .grid { display: ${thermal ? "block" : "grid"}; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  .codes { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; ${thermal ? "flex-direction: column;" : ""} }
  .codes img { width: ${thermal ? "30mm" : "28mm"}; height: auto; }
  .codes .bar svg { height: 34px; max-width: 60mm; }
  .money { margin-top: 10px; border: 1px solid ${thermal ? "#000" : "#e7d6dc"}; border-radius: 8px; padding: 6px 10px; }
  .sign { display: flex; justify-content: space-between; gap: 20px; margin-top: 26px; font-size: 12px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
  .note { margin-top: 8px; padding: 6px 10px; border: 1px dashed #999; border-radius: 6px; white-space: pre-wrap; }
  .foot { margin-top: 12px; text-align: center; font-size: 10.5px; color: #555; }
  </style></head><body>${body}</body></html>`;
}

function header(brand: AlbumPrintBrand, format: AlbumDocFormat) {
  const logo = safeImage(brand.logo);
  return `<div class="head">${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ""}<div style="flex:1">
    <div class="company">${esc(brand.name)}</div>
    ${brand.phone || brand.address ? `<div class="contact">${[brand.phone ? `<span class="num">${esc(brand.phone)}</span>` : "", esc(brand.address ?? "")].filter(Boolean).join(" · ")}</div>` : ""}
  </div>${format === "a4" ? `<div class="contact" style="text-align:left">طُبع في<br><span class="num">${esc(new Date().toLocaleString("en-GB", { hour12: false }))}</span></div>` : ""}</div>`;
}
const row = (label: string, value: unknown, num = false) =>
  value === null || value === undefined || String(value).trim() === "" ? "" : `<tr><td>${esc(label)}</td><td>${num ? `<span class="num">${esc(value)}</span>` : esc(value)}</td></tr>`;

function specs(album: AlbumPrintAlbum) {
  return `<table class="kv">
    ${row("نوع الألبوم", album.albumType)}${row("القياس", album.albumSize, true)}${row("عدد الصفحات", album.pageCount, true)}
    ${row("عدد الصور", album.photoCount, true)}${row("عدد النسخ", album.copies, true)}${row("نوع الغلاف", album.coverType)}
    ${row("لون الغلاف", album.coverColor)}${row("ورق الطباعة", album.paperType)}${row("العلبة", album.boxType)}${row("الأسماء على الغلاف", album.coverNames)}
  </table>`;
}
function customer(album: AlbumPrintAlbum) {
  return `<table class="kv">
    ${row("رقم الألبوم", album.albumNo, true)}${row("الزبون", album.customerName)}${row("الهاتف", formatIraqiPhone(album.phone), true)}${row("رقم الحجز", album.bookingCode, true)}
    ${row("المناسبة", album.occasionType)}${row("تاريخ المناسبة", album.occasionDate, true)}${row("تاريخ الطلب", album.orderDate, true)}${row("موعد التسليم", album.dueDate, true)}
  </table>`;
}
async function codes(album: AlbumPrintAlbum) {
  const qr = await albumQrDataUrl(album.qrToken);
  return `<div class="codes"><img src="${qr}" alt="QR"><div class="bar" style="text-align:center">${albumBarcodeSvg(album.barcodeValue)}<div class="num" style="font-size:11px">${esc(album.albumNo)}</div></div></div>`;
}
function moneyBlock(album: AlbumPrintAlbum) {
  if (album.financeMode === "package") return `<div class="money">الحساب: <b>مشمول بباقة الحجز ${esc(album.bookingCode ?? "")}</b></div>`;
  if (album.salePrice === undefined) return "";
  return `<div class="money"><table class="kv">${row("سعر الألبوم", formatIqd(album.salePrice), true)}${row("المدفوع", formatIqd(album.paidAmount), true)}${row("المتبقي", formatIqd(album.remainingAmount), true)}${row("رقم الفاتورة", album.invoiceNo, true)}</table></div>`;
}

/** وصل طلب الألبوم — for the customer. */
export async function albumOrderReceiptHtml(album: AlbumPrintAlbum, brand: AlbumPrintBrand, format: AlbumDocFormat) {
  return shell(`وصل طلب ${album.albumNo}`, format, `${header(brand, format)}<div class="title">وصل طلب ألبوم</div>
    <div class="grid"><div>${customer(album)}</div><div>${specs(album)}</div></div>
    ${moneyBlock(album)}${album.customerNotes ? `<div class="note">ملاحظات: ${esc(album.customerNotes)}</div>` : ""}
    ${await codes(album)}<div class="foot">احتفظ بهذا الوصل لاستلام الألبوم · امسح الرمز لمتابعة الطلب لدى الموظف</div>`);
}

/** أمر تصنيع الألبوم — for the workshop: specifications and team, never prices. */
export async function albumManufacturingOrderHtml(album: AlbumPrintAlbum, brand: AlbumPrintBrand, copies: AlbumPrintCopy[]) {
  return shell(`أمر تصنيع ${album.albumNo}`, "a4", `${header(brand, "a4")}<div class="title">أمر تصنيع ألبوم ${esc(album.albumNo)}</div>
    <div class="grid"><div>${customer(album)}</div><div>${specs(album)}</div></div>
    <table class="kv" style="margin-top:8px">${row("المرحلة الحالية", albumStageLabel(album.stage))}${row("المصمم", album.designerName)}${row("الطباعة", album.printerName)}${row("التجليد", album.binderName)}${row("فحص الجودة", album.qualityName)}</table>
    ${album.customerNotes ? `<div class="note">ملاحظات الزبون: ${esc(album.customerNotes)}</div>` : ""}
    ${album.internalNotes ? `<div class="note">ملاحظات داخلية: ${esc(album.internalNotes)}</div>` : ""}
    <table class="kv" style="margin-top:10px">${copies.map((copy) => row(`النسخة ${copy.copyNo}`, copy.code, true)).join("")}</table>
    ${await codes(album)}
    <div class="sign"><div>التصميم</div><div>الطباعة</div><div>التجليد</div><div>فحص الجودة</div></div>`);
}

/** وصل تسليم الألبوم — signed when the customer takes the album. */
export async function albumDeliveryReceiptHtml(album: AlbumPrintAlbum, brand: AlbumPrintBrand, format: AlbumDocFormat) {
  return shell(`وصل تسليم ${album.albumNo}`, format, `${header(brand, format)}<div class="title">وصل تسليم ألبوم</div>
    ${customer(album)}<table class="kv" style="margin-top:6px">${row("الألبوم", `${album.albumType} ${album.albumSize}`)}${row("عدد النسخ", album.copies, true)}
    ${row("تاريخ التسليم", album.deliveredAt ? new Date(album.deliveredAt).toLocaleString("en-GB", { hour12: false }) : "", true)}${row("المستلم", album.deliveredToName)}${row("سلّمه", album.deliveredByName)}</table>
    ${moneyBlock(album)}${await codes(album)}
    <div class="sign"><div>توقيع المستلم</div><div>توقيع الموظف</div></div>`);
}

export type AlbumLabelSize = { width: number; height: number };
/** One label per physical copy: logo, album number, customer, size, pages, delivery date, QR + barcode. */
export async function albumLabelsHtml(album: AlbumPrintAlbum, copies: AlbumPrintCopy[], brand: AlbumPrintBrand, size: AlbumLabelSize) {
  const { width, height } = size;
  const small = height < 35;
  const qrMm = Math.min(height - 4, width * 0.36);
  const list = copies.length ? copies : [{ copyNo: 1, code: album.albumNo, qrToken: album.qrToken }];
  const labels = await Promise.all(list.map(async (copy) => {
    const qr = await albumQrDataUrl(copy.qrToken, 200);
    const logo = safeImage(brand.logo);
    return `<section class="label">
      <div class="info">
        <div class="top">${logo ? `<img class="lg" src="${esc(logo)}" alt="">` : ""}<b class="num">${esc(copy.code)}</b></div>
        <div class="name">${esc(album.customerName)}</div>
        <div class="meta"><span class="num">${esc(album.albumSize)}</span>${album.pageCount ? ` · <span class="num">${album.pageCount}</span> ص` : ""}${album.dueDate ? ` · <span class="num">${esc(album.dueDate)}</span>` : ""}</div>
        <div class="bar">${albumBarcodeSvg(album.barcodeValue, small ? 14 : 22)}</div>
      </div>
      <img class="qr" src="${qr}" alt="QR">
    </section>`;
  }));
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ملصق ${esc(album.albumNo)}</title><style>
    /* Label printers take the exact label as the page. */
    @page { size: ${width}mm ${height}mm; margin: 0; }
    *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; background: #fff; color: #000; font-family: "Cairo", "Tajawal", Tahoma, Arial, sans-serif; }
    .label { width: ${width}mm; height: ${height}mm; padding: 1.5mm; display: flex; align-items: center; gap: 1.5mm; overflow: hidden; page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${small ? "0.2mm" : "0.6mm"}; }
    .top { display: flex; align-items: center; gap: 1mm; font-size: ${small ? "7.5pt" : "9pt"}; }
    .lg { height: ${small ? "3.5mm" : "5mm"}; width: auto; }
    .name { font-size: ${small ? "7pt" : "8.5pt"}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: ${small ? "6pt" : "7pt"}; white-space: nowrap; overflow: hidden; }
    .bar svg { width: 100%; height: ${small ? "3.8mm" : "6mm"}; }
    .qr { width: ${qrMm}mm; height: ${qrMm}mm; flex: none; }
    .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  </style></head><body>${labels.join("")}</body></html>`;
}

export function printAlbumHtml(html: string, format: AlbumDocFormat | "label" = "a4") {
  printStandaloneDocument(html, format === "80mm" ? 320 : format === "label" ? 420 : 1024);
}
