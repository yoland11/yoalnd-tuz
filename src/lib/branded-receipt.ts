/**
 * One branded receipt for the whole system (Nov 2026, owner's black-and-gold
 * sample): logo, company name and tagline, a pill title, a two-column facts
 * block, an items table, a totals box beside an Instagram QR, then address,
 * phones and «شكراً لتعاملكم معنا».
 *
 * - "a5": the coloured A5 page (also the source of the WhatsApp image).
 * - "80mm": the same order in plain black and white for thermal printers.
 *   Per the XP-80C rules it declares no @page size, zero margin and a fluid
 *   body no wider than 72mm.
 *
 * Pure presentation: callers pass values they already read from the server and
 * formatted. Nothing here computes money or decides payment state; a caller
 * that prints a pending request passes its own title and `state` banner.
 */
import QRCode from "qrcode";
import { currentReceiptBrand, instagramUrl, type ReceiptBrand } from "@/lib/receipt-brand";

export type BrandedReceiptSize = "a5" | "80mm" | "58mm";

export type ReceiptIcon =
  | "receipt" | "calendar" | "clock" | "user" | "layers" | "phone" | "pin" | "hash"
  | "truck" | "car" | "wallet" | "box" | "note" | "cash-in" | "cash-out" | "undo" | "id" | "camera" | "graduation";

export type ReceiptFact = {
  label: string;
  value: unknown;
  icon?: ReceiptIcon;
  /** Spans both columns on A5. */
  wide?: boolean;
};

export type ReceiptColumn = {
  key: string;
  label: string;
  /** name: the item text (bold, may carry an image and a sub line); total: the row amount. */
  role?: "index" | "name" | "number" | "total" | "text";
  /** Drop this column on the 80mm slip (its value then joins the sub line). */
  wideOnly?: boolean;
};

export type ReceiptRow = {
  cells: Record<string, unknown>;
  image?: string | null;
  sub?: string | null;
  /** Greyed (e.g. an expense that does not count). */
  muted?: boolean;
};

export type ReceiptTotal = {
  label: string;
  value: unknown;
  /** due: the black bar (المتبقي); strong: bold row. */
  tone?: "due" | "strong";
};

export type ReceiptSection = {
  title: string;
  facts?: ReceiptFact[];
  text?: string | null;
};

export type BrandedReceiptDoc = {
  /** Browser/window title. */
  documentTitle: string;
  title: string;
  icon?: ReceiptIcon;
  /** e.g. «نسخة العميل». */
  copyLabel?: string | null;
  /** A warning band under the title, e.g. a pending request that is not a payment. */
  state?: { text: string; tone?: "warn" | "danger" } | null;
  facts: ReceiptFact[];
  items?: { title?: string; columns: ReceiptColumn[]; rows: ReceiptRow[]; empty?: string; foot?: ReceiptRow | null } | null;
  sections?: ReceiptSection[];
  totals?: ReceiptTotal[];
  /** Small line under the totals (e.g. «أجرة خدمة — ليست إثبات دفع»). */
  totalsNote?: string | null;
  notes?: string | null;
  signatures?: string[];
  /** A document QR (e.g. verification page): text to encode, or a server-made QR image. Without it the brand Instagram QR is shown. */
  qr?: { url: string; caption: string; image?: string | null } | null;
  /** Hide the QR card completely (e.g. internal slips). */
  hideQr?: boolean;
  /** A CODE128 barcode under the QR (trusted SVG markup from JsBarcode) and its readable code. */
  barcode?: { svg: string; code: string } | null;
  /** Replaces «شكراً لتعاملكم معنا». */
  thanks?: string;
  /** Small line above the thanks band (e.g. «وصل للقراءة والطباعة فقط»). */
  footNote?: string | null;
  printedAt?: string;
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const receiptEsc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";
/** Values are isolated so numbers, codes and Latin names keep their order inside Arabic lines. */
const val = (value: unknown) => `<bdi>${receiptEsc(String(value ?? "").trim())}</bdi>`;

export function receiptPrintedAt(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(date);
}

/** Only image sources the receipt can safely load: same-site paths, http(s) and inline images. */
export function receiptImageSrc(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Crisp vector QR (prints sharp on any printer, no async image generation). */
export function receiptQrSvg(text: string, color = "#111111"): string {
  if (!text) return "";
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 2;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const box = size + quiet * 2;
  return `<svg class="qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${box}" height="${box}" fill="#ffffff"/><path d="${path}" fill="${color}"/></svg>`;
}

const ICON_PATHS: Record<ReceiptIcon, string> = {
  receipt: '<path d="M6 2h9l4 4v16l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3-1-.7V2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>',
  layers: '<path d="M12 3 2.5 8 12 13l9.5-5L12 3z"/><path d="m2.5 12.5 9.5 5 9.5-5M2.5 16.5l9.5 5 9.5-5"/>',
  phone: '<path d="M5 3h3.5l1.8 4.6-2.4 1.6a12 12 0 0 0 6 6l1.6-2.4 4.5 1.8V18a2.5 2.5 0 0 1-2.5 2.5A15.5 15.5 0 0 1 2.5 5.5 2.5 2.5 0 0 1 5 3z"/>',
  pin: '<path d="M12 21.5s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9.5" r="2.6"/>',
  hash: '<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18"/>',
  truck: '<path d="M2 6h11v10H2zM13 9.5h4.5L21 13v3h-8z"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4H4z"/><path d="M4 12h16"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M16 13.8h.01"/>',
  box: '<path d="M12 2.5 3 7v10l9 4.5 9-4.5V7l-9-4.5z"/><path d="M3 7l9 4.5L21 7M12 11.5v10"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 11h8M8 15h8"/>',
  "cash-in": '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  "cash-out": '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M12 9v6M9.5 12.5 12 15l2.5-2.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  id: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.7-1.6 1.7-2.3 3-2.3s2.3.7 3 2.3M14 10h4.5M14 14h3"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13.5" r="3.5"/>',
  graduation: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c3.5 2.5 8.5 2.5 12 0v-5M22 9v6"/>',
};

function icon(name: ReceiptIcon | undefined, cls = "ic") {
  if (!name) return "";
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a87b21" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

const INSTAGRAM_ICON = '<svg class="ig" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a87b21" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="#a87b21" stroke="none"/></svg>';

/**
 * Black-and-gold corner swooshes (top and bottom), drawn in mm and placed as
 * images: print and the WhatsApp image (html2canvas) both draw an <img> the same way.
 */
const CORNERS_TOP = `<svg xmlns="http://www.w3.org/2000/svg" width="1480" height="280" viewBox="0 0 148 30" preserveAspectRatio="none">
  <path d="M0 0h44C30 4 16 12 0 27z" fill="#0b0b0b"/><path d="M0 30C15 15 30 6 50 0" fill="none" stroke="#c9a14a" stroke-width="0.9"/><path d="M0 24C12 12 24 5 37 0" fill="none" stroke="#e6cb7f" stroke-width="0.45"/>
  <path d="M148 0h-44c14 4 28 12 44 27z" fill="#0b0b0b"/><path d="M148 30C133 15 118 6 98 0" fill="none" stroke="#c9a14a" stroke-width="0.9"/><path d="M148 24c-12-12-24-19-37-24" fill="none" stroke="#e6cb7f" stroke-width="0.45"/>
</svg>`;
const CORNERS_BOTTOM = `<svg xmlns="http://www.w3.org/2000/svg" width="1480" height="200" viewBox="0 0 148 22" preserveAspectRatio="none">
  <path d="M0 22h38C26 18 13 11 0 2z" fill="#0b0b0b"/><path d="M0 0c12 9 26 16 44 22" fill="none" stroke="#c9a14a" stroke-width="0.9"/><path d="M0 7c10 7 20 12 31 15" fill="none" stroke="#e6cb7f" stroke-width="0.45"/>
  <path d="M148 22h-38c12-4 25-11 38-20z" fill="#0b0b0b"/><path d="M148 0c-12 9-26 16-44 22" fill="none" stroke="#c9a14a" stroke-width="0.9"/><path d="M148 7c-10 7-20 12-31 15" fill="none" stroke="#e6cb7f" stroke-width="0.45"/>
</svg>`;

const svgData = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s*\n\s*/g, ""))}`;
const CORNER_IMAGES = `<img class="corner corner-top" src="${svgData(CORNERS_TOP)}" alt=""><img class="corner corner-bottom" src="${svgData(CORNERS_BOTTOM)}" alt="">`;

const FONT_FACE = `@font-face{font-family:"AJN Cairo";src:url("/fonts/Cairo-Variable.ttf") format("truetype");font-weight:200 1000;font-display:block}`;

/** Scoped to .ajn-r so the same markup can be cloned into the app for the WhatsApp image. */
const A5_CSS = `
.ajn-r{--ink:#111;--gold:#a87b21;--gold-2:#c9a14a;--gold-3:#e6cb7f;--gold-ink:#7a560f;--line:#dcc58a;
  position:relative;box-sizing:border-box;width:148mm;min-height:209.5mm;margin:0 auto;padding:4.5mm 9mm 6.5mm;background:#fff;color:var(--ink);
  font-family:"AJN Cairo",Cairo,Tahoma,Arial,sans-serif;font-size:11px;line-height:1.5;direction:rtl;display:flex;flex-direction:column;overflow-wrap:anywhere;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ajn-r *{box-sizing:border-box}
.ajn-r bdi{unicode-bidi:isolate}
.ajn-r .corner{position:absolute;left:0;width:100%;display:block;pointer-events:none}
.ajn-r .corner-top{top:0;height:28mm}.ajn-r .corner-bottom{bottom:0;height:20mm}
.ajn-r .head{text-align:center}
.ajn-r .medal{width:18mm;height:18mm;margin:0 auto 1mm;border-radius:50%;padding:.7mm;background:#0b0b0b}
.ajn-r .medal-ring{width:100%;height:100%;border-radius:50%;padding:.8mm;background:#c9a14a}
.ajn-r .medal-in{width:100%;height:100%;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ajn-r .medal-in img{max-width:84%;max-height:84%;object-fit:contain}
.ajn-r .brand-name{font-size:23px;font-weight:900;line-height:1.15;color:var(--gold-ink)}
.ajn-r .tagline{display:flex;align-items:center;justify-content:center;gap:3mm;font-size:13px;font-weight:800;color:#1c1c1c;margin-top:.4mm}
.ajn-r .tagline:before,.ajn-r .tagline:after{content:"";width:16mm;height:.5mm;background:var(--gold-2)}
.ajn-r .pill{display:block;width:fit-content;margin:2mm auto 0;padding:.55mm;border-radius:99px;background:var(--gold-2)}
.ajn-r .pill-in{display:block;white-space:nowrap;padding:.9mm 9mm;border-radius:99px;background:#0b0b0b;color:#f2d790;font-size:17px;font-weight:900;line-height:1.3}
.ajn-r .pill-in .ic{display:inline-block;vertical-align:middle;width:6.5mm;height:6.5mm;margin-inline-end:2.5mm;stroke:#e6cb7f}
.ajn-r .pill-in span{vertical-align:middle}
.ajn-r .copy{margin-top:1.2mm;font-size:10.5px;font-weight:800;color:#333}
.ajn-r .state{margin:3mm 0 0;padding:2mm 3mm;border:.5mm dashed #000;border-radius:2mm;background:#fff6dc;text-align:center;font-size:12.5px;font-weight:900;color:#000}
.ajn-r .state.danger{background:#fde8e8}
.ajn-r .facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5mm 6mm;margin-top:2.8mm;padding-bottom:2.2mm;border-bottom:.6mm dotted #222}
.ajn-r .fact{display:flex;align-items:baseline;gap:1.6mm;min-width:0}
.ajn-r .fact.wide{grid-column:1/-1}
.ajn-r .fact .ic{flex:none;width:4.6mm;height:4.6mm;align-self:center}
.ajn-r .fact span{flex:none;font-weight:700;color:#2b2b2b;white-space:nowrap}
.ajn-r .fact strong{min-width:0;font-size:12px;font-weight:800;color:#000}
.ajn-r .block-title{display:flex;align-items:center;gap:2mm;margin:2.4mm 0 1mm;font-size:12px;font-weight:900;color:var(--gold-ink)}
.ajn-r .block-title:after{content:"";flex:1;height:.35mm;background:var(--line)}
.ajn-r table.items{width:100%;margin-top:3mm;border-collapse:separate;border-spacing:0;border:.55mm solid var(--gold-2);border-radius:2.6mm;overflow:hidden;table-layout:auto}
.ajn-r .block-title + table.items{margin-top:0}
.ajn-r .items thead{display:table-header-group}
.ajn-r .items th{background:#0b0b0b;color:#f2d790;font-size:11.5px;font-weight:900;padding:1.5mm 1.6mm;text-align:center;border-inline-start:.35mm solid #6b5320}
.ajn-r .items th:first-child,.ajn-r .items td:first-child{border-inline-start:0}
.ajn-r .items td{padding:1mm 1.6mm;border-top:.35mm solid var(--line);border-inline-start:.35mm solid var(--line);text-align:center;vertical-align:middle;font-weight:800;font-size:12px}
.ajn-r .items tr{break-inside:avoid;page-break-inside:avoid}
.ajn-r .items td.name{text-align:right}
.ajn-r .items td.num,.ajn-r .items td.total{font-variant-numeric:tabular-nums;white-space:nowrap}
.ajn-r .items td.idx{width:7mm;color:#000}
.ajn-r .items tr.muted td{color:#777}
.ajn-r .items tr.foot td{background:#f7f0de;font-weight:900}
.ajn-r .item{display:flex;align-items:center;gap:2mm}
.ajn-r .item img{flex:none;width:7.5mm;height:7.5mm;object-fit:contain;border-radius:1.2mm}
.ajn-r .item small{display:block;font-size:10px;font-weight:600;color:#444}
.ajn-r .empty{padding:3mm;text-align:center;color:#444;font-weight:700}
.ajn-r .section{margin-top:1.6mm;break-inside:avoid}
.ajn-r .section .facts{margin-top:0;border-bottom:0;padding-bottom:0}
.ajn-r .section p{margin:0;white-space:pre-wrap;font-weight:600}
.ajn-r .bottom{display:flex;gap:5mm;align-items:stretch;margin-top:3mm;break-inside:avoid;page-break-inside:avoid}
.ajn-r .bottom .qr-card:only-child{margin:0 auto}
.ajn-r .qr-card{flex:none;width:32mm;padding:1.8mm 1.8mm 1.2mm;border:.55mm solid var(--gold-2);border-radius:3mm;text-align:center;background:#fff}
.ajn-r .qr-svg{display:block;width:100%;height:auto}
.ajn-r .qr-cap{display:flex;align-items:center;justify-content:center;gap:1mm;margin-top:1mm;font-size:10.5px;font-weight:900;color:var(--gold-ink);direction:ltr;white-space:nowrap}
.ajn-r .qr-cap .ig{width:3.6mm;height:3.6mm;flex:none}
.ajn-r .barcode{margin-top:1.2mm;border-top:.35mm solid var(--line);padding-top:1mm}
.ajn-r .barcode svg{display:block;width:100%;height:9mm}
.ajn-r .barcode-code{font-size:9px;font-weight:800;direction:ltr}
.ajn-r .totals{flex:1;display:flex;flex-direction:column;justify-content:center;min-width:0}
.ajn-r .tbox{border:.4mm solid #bdbdbd;border-radius:3mm;overflow:hidden;background:#fbfbfb}
.ajn-r .trow{display:flex;justify-content:space-between;align-items:baseline;gap:3mm;padding:1.25mm 3.5mm;border-top:.35mm solid #dedede;font-size:13px;font-weight:900}
.ajn-r .trow:first-child{border-top:0}
.ajn-r .trow strong{font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}
.ajn-r .trow.due{margin:1.2mm;border:.55mm solid var(--gold-2);border-radius:2.4mm;background:#0b0b0b;color:#fff;font-size:15px}
.ajn-r .trow.due strong{font-size:18px;color:#fff}
.ajn-r .trow.strong{margin:1.2mm;border:.55mm solid var(--gold-2);border-radius:2.4mm;background:#fff;font-size:14px}
.ajn-r .trow.strong strong{font-size:18px}
.ajn-r .tnote{margin-top:.8mm;text-align:center;font-size:9.5px;line-height:1.4;font-weight:700;color:#333}
.ajn-r .notes{margin-top:2.4mm;padding:1.6mm 3mm;border:.35mm solid var(--line);border-radius:2mm;break-inside:avoid}
.ajn-r .notes strong{display:block;font-size:11px;color:var(--gold-ink)}
.ajn-r .notes p{margin:0;white-space:pre-wrap;font-weight:700}
.ajn-r .signs{display:flex;gap:8mm;margin-top:5.5mm;break-inside:avoid}
.ajn-r .signs div{flex:1;border-top:.4mm solid #000;padding-top:1mm;text-align:center;font-size:10.5px;font-weight:800}
.ajn-r .foot{margin-top:auto;padding-top:2.4mm;text-align:center;break-inside:avoid;page-break-inside:avoid}
.ajn-r .foot-rule{border-top:.6mm dotted #222;margin-bottom:1.4mm}
.ajn-r .contact{display:flex;align-items:center;justify-content:center;gap:1.6mm;font-size:13px;font-weight:800;color:#000}
.ajn-r .contact .ic{width:4.6mm;height:4.6mm;stroke:#111}
.ajn-r .phones{margin-top:.4mm;font-size:15px;font-weight:900}
.ajn-r .phones i{font-style:normal;color:#9a9a9a;margin:0 2.5mm;font-weight:400}
.ajn-r .ig-line{margin-top:.2mm;font-size:10.5px;font-weight:800;color:var(--gold-ink);direction:ltr;display:flex;align-items:center;justify-content:center;gap:1mm}
.ajn-r .ig-line .ig{width:3.6mm;height:3.6mm}
.ajn-r .thanks{display:block;width:fit-content;margin:2mm auto 0;padding:.55mm;border-radius:99px;background:var(--gold-2)}
.ajn-r .thanks span{display:block;padding:1.3mm 11mm;border-radius:99px;background:#0b0b0b;color:#f2d790;font-size:15px;font-weight:900}
.ajn-r .printed{margin-top:1mm;font-size:8.5px;color:#555}
.ajn-r .foot-note{margin-top:1mm;font-size:9.5px;font-weight:700;color:#333}
`;

/** 58mm rolls (printable ~48mm): the 80mm slip, narrower and a step smaller. */
const NARROW_CSS = `
.ajn-r--58{max-width:48mm;padding:1mm .5mm 2mm;font-size:10px}
.ajn-r--58 .medal{width:11mm;height:11mm}
.ajn-r--58 .brand-name{font-size:13.5px}
.ajn-r--58 .tagline{font-size:9.5px}
.ajn-r--58 .pill-in{padding:.3mm 3.5mm;font-size:13.5px}
.ajn-r--58 .fact{grid-template-columns:minmax(0,42%) minmax(0,58%);gap:1mm}
.ajn-r--58 .items td,.ajn-r--58 .items th{font-size:9.5px}
.ajn-r--58 .item small{font-size:8.5px}
.ajn-r--58 .trow{font-size:10.5px}
.ajn-r--58 .trow.due{font-size:11.5px;padding:1mm}
.ajn-r--58 .trow.due strong,.ajn-r--58 .trow.strong strong{font-size:12.5px}
.ajn-r--58 .qr-card{width:19mm}
.ajn-r--58 .phones{font-size:10.5px}
.ajn-r--58 .contact,.ajn-r--58 .ig-line,.ajn-r--58 .thanks span{font-size:9.5px}
`;

const THERMAL_CSS = `
.ajn-r{box-sizing:border-box;width:100%;max-width:72mm;margin:0 auto;padding:1.5mm 1mm 3mm;background:#fff;color:#000;
  font-family:"AJN Cairo",Cairo,Tahoma,Arial,sans-serif;font-size:11.5px;line-height:1.5;direction:rtl;overflow-wrap:anywhere}
.ajn-r *{box-sizing:border-box;color:#000}
.ajn-r bdi{unicode-bidi:isolate}
.ajn-r .corner,.ajn-r .pill-in .ic,.ajn-r .fact .ic{display:none}
.ajn-r .head{text-align:center;break-inside:avoid}
.ajn-r .medal{width:15mm;height:15mm;margin:0 auto 1mm;border:.5mm solid #000;border-radius:50%;padding:.6mm}
.ajn-r .medal-ring,.ajn-r .medal-in{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ajn-r .medal-in img{max-width:86%;max-height:86%;object-fit:contain;filter:grayscale(1) contrast(1.4)}
.ajn-r .brand-name{font-size:17px;font-weight:900;line-height:1.3}
.ajn-r .tagline{font-size:11px;font-weight:700}
.ajn-r .pill{display:inline-block;margin-top:1.6mm;border:.6mm solid #000;border-radius:99px}
.ajn-r .pill-in{padding:.6mm 6mm;font-size:17px;font-weight:900}
.ajn-r .copy{font-size:10px;font-weight:700;margin-top:.6mm}
.ajn-r .state{margin-top:1.6mm;padding:1.2mm;border:.6mm dashed #000;text-align:center;font-weight:900;font-size:12px}
.ajn-r .facts{margin-top:2mm;padding-bottom:1.6mm;border-bottom:.4mm dashed #000}
.ajn-r .fact{display:grid;grid-template-columns:minmax(0,38%) minmax(0,62%);gap:1.5mm;padding:.35mm 0;align-items:baseline}
.ajn-r .fact span{font-weight:600}
.ajn-r .fact strong{font-weight:800;text-align:left}
.ajn-r .block-title{margin:2mm 0 .8mm;font-size:12px;font-weight:900;border-bottom:.4mm solid #000}
.ajn-r table.items{width:100%;margin-top:2mm;border-collapse:collapse;table-layout:fixed}
.ajn-r .block-title + table.items{margin-top:0}
.ajn-r .items th{font-size:10.5px;font-weight:900;border-top:.5mm solid #000;border-bottom:.5mm solid #000;padding:.8mm .5mm;text-align:right}
.ajn-r .items th.total,.ajn-r .items td.total{text-align:left;width:34%}
.ajn-r .items td{padding:.9mm .5mm;border-bottom:.3mm dashed #000;vertical-align:top;font-weight:700;font-size:11px}
.ajn-r .items tr{break-inside:avoid;page-break-inside:avoid}
.ajn-r .items tr.muted td{font-weight:400}
.ajn-r .items tr.foot td{font-weight:900;border-bottom:.5mm solid #000}
.ajn-r .item img{display:none}
.ajn-r .item small{display:block;font-size:10px;font-weight:600}
.ajn-r .empty{padding:1.5mm;text-align:center}
.ajn-r .section{margin-top:1.6mm;break-inside:avoid}
.ajn-r .section .facts{margin-top:0;border-bottom:0}
.ajn-r .section p{margin:0;white-space:pre-wrap}
.ajn-r .bottom{margin-top:2mm;break-inside:avoid}
.ajn-r .tbox{border-top:.5mm solid #000}
.ajn-r .trow{display:flex;justify-content:space-between;gap:2mm;padding:.7mm 0;font-weight:800;font-size:12px}
.ajn-r .trow strong{font-weight:900;white-space:nowrap}
.ajn-r .trow.due{margin-top:1mm;padding:1.2mm 1.6mm;border:.7mm solid #000;font-size:14px}
.ajn-r .trow.due strong{font-size:16px}
.ajn-r .trow.strong{padding:1mm 0;font-size:13px}.ajn-r .trow.strong strong{font-size:15px}
.ajn-r .tnote{text-align:center;font-size:10px;font-weight:700}
.ajn-r .qr-card{width:24mm;margin:2mm auto 0;text-align:center}
.ajn-r .qr-svg{display:block;width:100%;height:auto}
.ajn-r .qr-cap{font-size:9.5px;font-weight:800;direction:ltr;white-space:nowrap}
.ajn-r .barcode svg{display:block;width:100%;height:8mm;margin-top:1mm}
.ajn-r .barcode-code{font-size:9px;font-weight:800;direction:ltr}
.ajn-r .qr-cap .ig,.ajn-r .ig-line .ig,.ajn-r .contact .ic{display:none}
.ajn-r .notes{margin-top:1.6mm;padding-top:1mm;border-top:.4mm dashed #000;break-inside:avoid}
.ajn-r .notes strong{display:block}
.ajn-r .notes p{margin:0;white-space:pre-wrap;font-weight:700}
.ajn-r .signs{display:flex;gap:5mm;margin-top:8mm;break-inside:avoid}
.ajn-r .signs div{flex:1;border-top:.4mm solid #000;padding-top:.6mm;text-align:center;font-size:10px;font-weight:800}
.ajn-r .foot{margin-top:2mm;padding-top:1.4mm;border-top:.4mm dashed #000;text-align:center;break-inside:avoid}
.ajn-r .foot-rule{display:none}
.ajn-r .contact{font-size:11px;font-weight:700}
.ajn-r .phones{font-size:12.5px;font-weight:900}
.ajn-r .phones i{font-style:normal;margin:0 1.5mm}
.ajn-r .ig-line{font-size:10.5px;font-weight:800;direction:ltr}
.ajn-r .thanks span{display:block;margin-top:1mm;font-size:12.5px;font-weight:900}
.ajn-r .printed{font-size:9px;margin-top:.6mm}
.ajn-r .foot-note{font-size:9.5px;font-weight:700;margin-top:.6mm}
`;

function factsHtml(facts: ReceiptFact[]) {
  const shown = facts.filter((fact) => present(fact.value));
  if (!shown.length) return "";
  return `<div class="facts">${shown
    .map((fact) => `<div class="fact${fact.wide ? " wide" : ""}">${icon(fact.icon)}<span>${receiptEsc(fact.label)}:</span><strong>${val(fact.value)}</strong></div>`)
    .join("")}</div>`;
}

function itemsHtml(items: NonNullable<BrandedReceiptDoc["items"]>, size: BrandedReceiptSize) {
  const thermal = size !== "a5";
  const columns = thermal ? items.columns.filter((column) => !column.wideOnly && column.role !== "index") : items.columns;
  const folded = thermal ? items.columns.filter((column) => column.wideOnly) : [];
  const heading = items.title ? `<div class="block-title">${receiptEsc(items.title)}</div>` : "";
  const head = `<thead><tr>${columns.map((column) => `<th class="${column.role ?? "text"}">${receiptEsc(column.label)}</th>`).join("")}</tr></thead>`;
  const cell = (column: ReceiptColumn, row: ReceiptRow, index: number) => {
    const raw = column.role === "index" ? (row.cells[column.key] ?? index + 1) : row.cells[column.key];
    if (column.role === "name") {
      const extra = folded
        .map((other) => (present(row.cells[other.key]) ? `${receiptEsc(other.label)} ${val(row.cells[other.key])}` : ""))
        .filter(Boolean)
        .join(" · ");
      const sub = [row.sub ? receiptEsc(row.sub) : "", extra].filter(Boolean).join(" · ");
      const image = !thermal ? receiptImageSrc(row.image) : null;
      return `<td class="name"><div class="item">${image ? `<img src="${receiptEsc(image)}" alt="" onerror="this.remove()">` : ""}<div><bdi>${receiptEsc(raw)}</bdi>${sub ? `<small>${sub}</small>` : ""}</div></div></td>`;
    }
    const cls = column.role === "total" ? "total" : column.role === "number" ? "num" : column.role === "index" ? "idx" : "";
    return `<td class="${cls}">${present(raw) ? val(raw) : "—"}</td>`;
  };
  const rows = items.rows.length
    ? items.rows.map((row, index) => `<tr${row.muted ? ' class="muted"' : ""}>${columns.map((column) => cell(column, row, index)).join("")}</tr>`).join("")
    : `<tr><td class="empty" colspan="${columns.length}">${receiptEsc(items.empty ?? "لا توجد مواد")}</td></tr>`;
  const foot = items.foot
    ? `<tr class="foot">${columns.map((column, index) => (column.role === "index" ? "<td></td>" : cell(column, items.foot!, index))).join("")}</tr>`
    : "";
  return `${heading}<table class="items">${head}<tbody>${rows}${foot}</tbody></table>`;
}

function sectionsHtml(sections: ReceiptSection[] | undefined) {
  return (sections ?? [])
    .map((section) => {
      const facts = section.facts ? factsHtml(section.facts) : "";
      const text = present(section.text) ? `<p>${receiptEsc(section.text)}</p>` : "";
      if (!facts && !text) return "";
      return `<section class="section"><div class="block-title">${receiptEsc(section.title)}</div>${facts}${text}</section>`;
    })
    .join("");
}

function qrHtml(doc: BrandedReceiptDoc, brand: ReceiptBrand) {
  if (doc.hideQr) return "";
  const own = doc.qr && (doc.qr.url || receiptImageSrc(doc.qr.image)) ? doc.qr : null;
  const target = own ?? (brand.instagram ? { url: instagramUrl(brand.instagram), caption: `@${brand.instagram.toUpperCase()}`, image: null } : null);
  if (!target) return "";
  const isInstagram = !own;
  const image = receiptImageSrc(target.image);
  const code = image ? `<img class="qr-svg" src="${receiptEsc(image)}" alt="QR">` : receiptQrSvg(target.url);
  const barcode = doc.barcode?.svg ? `<div class="barcode">${doc.barcode.svg}<div class="barcode-code"><bdi>${receiptEsc(doc.barcode.code)}</bdi></div></div>` : "";
  return `<div class="qr-card">${code}<div class="qr-cap">${isInstagram ? INSTAGRAM_ICON : ""}<bdi>${receiptEsc(target.caption)}</bdi></div>${barcode}</div>`;
}

/** The receipt body (root element with its own scoped styles), shared by print and image export. */
export function brandedReceiptBody(doc: BrandedReceiptDoc, size: BrandedReceiptSize, brand: ReceiptBrand = currentReceiptBrand()) {
  const thermal = size !== "a5";
  const logo = receiptImageSrc(brand.logoUrl);
  const totals = (doc.totals ?? []).filter((row) => present(row.value));
  const qr = qrHtml(doc, brand);
  const totalsHtml = totals.length
    ? `<div class="totals"><div class="tbox">${totals
        .map((row) => `<div class="trow${row.tone ? ` ${row.tone}` : ""}"><span>${receiptEsc(row.label)}</span><strong>${val(row.value)}</strong></div>`)
        .join("")}</div>${doc.totalsNote ? `<div class="tnote">${receiptEsc(doc.totalsNote)}</div>` : ""}</div>`
    : "";
  // RTL: the first child sits on the right — the QR card on the right, totals on the left, as in the sample.
  const bottom = totalsHtml || qr ? `<div class="bottom">${thermal ? `${totalsHtml}${qr}` : `${qr}${totalsHtml}`}</div>` : "";
  const phones = brand.phones.filter(Boolean);
  // A document QR replaces the Instagram one in the card, so the account still shows as text.
  const igLine = brand.instagram && (doc.qr?.url || doc.qr?.image || doc.hideQr) ? `<div class="ig-line">${INSTAGRAM_ICON}<bdi>@${receiptEsc(brand.instagram)}</bdi></div>` : "";
  const rootClass = size === "a5" ? "ajn-r--a5" : size === "58mm" ? "ajn-r--thermal ajn-r--58" : "ajn-r--thermal";
  return `<div class="ajn-r ${rootClass}" dir="rtl" lang="ar"><style>${FONT_FACE}${thermal ? THERMAL_CSS : A5_CSS}${size === "58mm" ? NARROW_CSS : ""}</style>${thermal ? "" : CORNER_IMAGES}
    <header class="head">
      ${logo ? `<div class="medal"><div class="medal-ring"><div class="medal-in"><img src="${receiptEsc(logo)}" alt="" onerror="this.remove()"></div></div></div>` : ""}
      ${brand.name ? `<div class="brand-name">${receiptEsc(brand.name)}</div>` : ""}
      ${brand.tagline ? `<div class="tagline">${receiptEsc(brand.tagline)}</div>` : ""}
      <div class="pill"><div class="pill-in">${icon(doc.icon ?? "receipt")}<span>${receiptEsc(doc.title)}</span></div></div>
      ${doc.copyLabel ? `<div class="copy">${receiptEsc(doc.copyLabel)}</div>` : ""}
    </header>
    ${doc.state ? `<div class="state${doc.state.tone === "danger" ? " danger" : ""}">${receiptEsc(doc.state.text)}</div>` : ""}
    ${factsHtml(doc.facts)}
    ${doc.items ? itemsHtml(doc.items, size) : ""}
    ${sectionsHtml(doc.sections)}
    ${bottom}
    ${present(doc.notes) ? `<div class="notes"><strong>ملاحظات</strong><p>${receiptEsc(doc.notes)}</p></div>` : ""}
    ${doc.signatures?.length ? `<div class="signs">${doc.signatures.map((label) => `<div>${receiptEsc(label)}</div>`).join("")}</div>` : ""}
    <footer class="foot">
      <div class="foot-rule"></div>
      ${brand.address ? `<div class="contact">${icon("pin")}<span>${receiptEsc(brand.address)}</span></div>` : ""}
      ${phones.length ? `<div class="contact phones">${icon("phone")}<span>${phones.map((phone) => `<bdi>${receiptEsc(phone)}</bdi>`).join("<i>|</i>")}</span></div>` : ""}
      ${igLine}
      ${doc.footNote ? `<div class="foot-note">${receiptEsc(doc.footNote)}</div>` : ""}
      <div class="thanks"><span>${receiptEsc(doc.thanks ?? "شكراً لتعاملكم معنا")}</span></div>
      <div class="printed">طُبع <bdi>${receiptEsc(doc.printedAt ?? receiptPrintedAt())}</bdi></div>
    </footer>
  </div>`;
}

/** Complete standalone document WITHOUT an auto-print script (the print dialog adds it). */
export function buildBrandedReceiptHtml(doc: BrandedReceiptDoc, size: BrandedReceiptSize, brand?: ReceiptBrand) {
  // Thermal: no @page size (Chromium would centre it on the 297mm driver page), only zero margin.
  const page = size === "a5"
    ? "@page{size:148mm 210mm;margin:0}html,body{margin:0;padding:0;background:#fff}@media screen{html{background:#f1f1f1}body{padding:0}}"
    : "@page{margin:0}html,body{margin:0;padding:0;background:#fff}";
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${receiptEsc(doc.documentTitle)}</title><style>${page}</style></head><body>${brandedReceiptBody(doc, size, brand)}</body></html>`;
}
