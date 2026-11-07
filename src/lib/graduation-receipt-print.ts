/**
 * Professional graduation receipts for the representatives portal:
 * «وصل وكشف حساب الطالب» and «وصل استلام دفعة», in 80mm thermal or A5 — both on
 * the shared branded receipt (src/lib/branded-receipt.ts). Tailor sheets keep
 * their own workshop layout below.
 *
 * Read-only projections of values the server already computed (total, paid,
 * remaining, receipt numbers); nothing is recalculated here. The print window
 * is opened synchronously on the click (popup blockers), then filled once the
 * QR code and barcode are ready.
 */
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { formatCurrency } from "@/lib/money";
import { brandedReceiptBody, buildBrandedReceiptHtml, type BrandedReceiptDoc, type BrandedReceiptSize, type ReceiptFact } from "@/lib/branded-receipt";
import { currentReceiptBrand, type ReceiptBrand as BrandIdentity } from "@/lib/receipt-brand";

export type ReceiptFormat = "80mm" | "a5";

export type ReceiptBrand = {
  logo: string;
  company: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
};

export type ReceiptStudent = {
  name: string;
  studentCode: string;
  phone?: string | null;
  receiptNo?: string | null;
  orderNo?: string | null;
  trackingUrl?: string | null;
};

export type ReceiptGroup = {
  title: string;
  groupNo: string;
  batchLabel?: string;
  university?: string;
  college?: string;
  department?: string;
  representativeName?: string;
};

export type ReceiptLine = { label: string; value: string };
export type ReceiptPayment = { date: string; receiptNo: string; method: string; amount: number };
export type ReceiptTotals = { total: number; paid: number; remaining: number };

const BURGUNDY = "#7b1e3a";

const PAYMENT_METHODS: Record<string, string> = { cash: "نقدي", transfer: "تحويل مصرفي", card: "بطاقة", other: "أخرى" };

export function receiptPaymentMethodLabel(method: unknown) {
  const key = String(method ?? "");
  return PAYMENT_METHODS[key] || key || "—";
}

export function escapeReceipt(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

const money = (value: number) => formatCurrency(value);

function stamp(totals: ReceiptTotals) {
  if (totals.total > 0 && totals.remaining <= 0) return { label: "مدفوع بالكامل", tone: "paid" };
  if (totals.paid > 0) return { label: "مدفوع جزئياً", tone: "partial" };
  return { label: "غير مدفوع", tone: "unpaid" };
}

/** «2026/10/12 · 14:05» — fixed order with western digits, so RTL text never reorders it. */
function nowText(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} · ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Opens the print window right away (inside the click) and shows a placeholder. */
export function openReceiptWindow(format: ReceiptFormat) {
  const popup = window.open("", "_blank", format === "a5" ? "width=760,height=900" : "width=460,height=820");
  if (!popup) throw new Error("تعذر فتح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة لهذا الموقع");
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>جارٍ تجهيز الوصل…</title></head><body style="font-family:Tahoma,Arial,sans-serif;display:grid;place-items:center;height:90vh;color:#555">جارٍ تجهيز الوصل…</body></html>`);
  return popup;
}

async function qrDataUrl(text: string) {
  if (!text) return "";
  try {
    return await QRCode.toDataURL(text, { width: 240, margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  } catch {
    return "";
  }
}

function barcodeSvg(value: string) {
  if (!value) return "";
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, value, { format: "CODE128", height: 34, width: 1.15, margin: 0, displayValue: false, background: "transparent", lineColor: "#000" });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return "";
  }
}

/** Receipt rules; every selector lives under `.doc` so they can also be scoped inside a page. */
function rules(format: ReceiptFormat) {
  const thermal = format === "80mm";
  return `
  .doc, .doc * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Thermal: fluid width inside a zero-margin page, so the content always fits
     the printer's real printable area (~72mm on 80mm rolls). */
  .doc { width: 100%; margin: 0 auto; padding: ${thermal ? "2.5mm" : "0"}; background: #fff; color: #111; direction: rtl; text-align: right;
    font-family: "Cairo", "Tajawal", "Segoe UI", Tahoma, Arial, sans-serif; font-size: ${thermal ? "12.5px" : "12.5px"}; line-height: 1.5; ${thermal ? "font-weight: 600;" : ""} }
  ${thermal ? `.doc * { color: #000 !important; }
  .doc .title { color: #fff !important; }
  .doc .kv span:first-child { font-weight: 600; }` : ""}
  .num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  .head { display: flex; align-items: center; gap: ${thermal ? "8px" : "14px"}; ${thermal ? "flex-direction: column; text-align: center;" : `border-bottom: 3px solid ${BURGUNDY}; padding-bottom: 10px;`} }
  .logo { width: ${thermal ? "46px" : "62px"}; height: ${thermal ? "46px" : "62px"}; object-fit: contain; }
  .brand { flex: 1; }
  .company { font-size: ${thermal ? "16px" : "20px"}; font-weight: 800; letter-spacing: -0.2px; ${thermal ? "" : `color: ${BURGUNDY};`} }
  .tagline { font-size: ${thermal ? "10.5px" : "11.5px"}; color: #444; }
  .contact { font-size: ${thermal ? "10px" : "11px"}; color: #444; margin-top: 2px; }
  .meta { text-align: ${thermal ? "center" : "left"}; font-size: 11px; color: #333; }
  .title { margin: ${thermal ? "8px 0 6px" : "12px 0 10px"}; padding: ${thermal ? "5px 6px" : "8px 12px"}; text-align: center; font-weight: 800; font-size: ${thermal ? "13.5px" : "16px"};
    ${thermal ? "background: #000; color: #fff; border-radius: 4px;" : `background: ${BURGUNDY}; color: #fff; border-radius: 8px;`} }
  .docno { display: flex; justify-content: space-between; gap: 8px; font-size: ${thermal ? "10.5px" : "11.5px"}; margin-bottom: 6px; }
  .card { border: 1px solid ${thermal ? "#000" : "#e7d6dc"}; border-radius: ${thermal ? "4px" : "10px"}; padding: ${thermal ? "6px" : "10px 12px"}; margin: ${thermal ? "6px 0" : "8px 0"}; ${thermal ? "" : "background: #fffafb;"} }
  .card h3 { margin: 0 0 4px; font-size: ${thermal ? "11px" : "12px"}; font-weight: 800; ${thermal ? "" : `color: ${BURGUNDY};`} }
  .student-name { font-size: ${thermal ? "15px" : "18px"}; font-weight: 800; margin: 0; }
  .grid { display: grid; grid-template-columns: ${thermal ? "1fr" : "1fr 1fr"}; gap: ${thermal ? "1px 0" : "3px 18px"}; }
  /* A value that no longer fits next to its label drops to its own line, never past the edge. */
  .kv { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 8px; padding: 1px 0; }
  .kv span:first-child { color: #555; white-space: nowrap; }
  .kv span:last-child { font-weight: 700; text-align: left; margin-right: auto; min-width: 0; overflow-wrap: anywhere; }
  .doc table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  .doc th, .doc td { padding: ${thermal ? "3px 2px" : "5px 6px"}; text-align: right; border-bottom: 1px ${thermal ? "dashed #999" : "solid #eee"}; font-size: ${thermal ? "10.5px" : "11.5px"}; }
  .doc th { font-weight: 800; ${thermal ? "border-bottom: 1px solid #000;" : `background: #f6eef1; color: ${BURGUNDY};`} }
  .doc td.amount, .doc th.amount { text-align: left; }
  .empty { text-align: center; color: #666; padding: 6px 0; }
  .totals { margin-top: ${thermal ? "6px" : "10px"}; border-top: 2px solid #000; padding-top: 4px; }
  .totals .kv { font-size: ${thermal ? "12px" : "13px"}; }
  .grand { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding: ${thermal ? "5px 6px" : "8px 12px"}; border: 2px solid #000; border-radius: ${thermal ? "4px" : "8px"}; font-weight: 800; font-size: ${thermal ? "14px" : "16px"}; }
  .stamp { display: inline-block; margin: ${thermal ? "8px auto 0" : "0"}; padding: 3px 12px; border: 2px solid; border-radius: 999px; font-weight: 800; font-size: ${thermal ? "12px" : "13px"}; transform: rotate(-4deg); }
  .stamp.paid { color: ${thermal ? "#000" : "#0f7a44"}; }
  .stamp.partial { color: ${thermal ? "#000" : "#a35f00"}; }
  .stamp.unpaid { color: ${thermal ? "#000" : "#b42318"}; }
  .verify { display: flex; align-items: center; gap: 10px; margin-top: ${thermal ? "8px" : "12px"}; ${thermal ? "flex-direction: column; text-align: center;" : ""} }
  .verify img { width: ${thermal ? "30mm" : "26mm"}; height: ${thermal ? "30mm" : "26mm"}; }
  .verify .hint { font-size: 10.5px; color: #444; }
  .barcode svg { width: ${thermal ? "100%" : "58mm"}; max-width: ${thermal ? "60mm" : "58mm"}; height: 11mm; }
  .barcode .code { font-size: 10.5px; letter-spacing: 1px; text-align: center; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: ${thermal ? "12px" : "20px"}; }
  .signs div { border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 10.5px; color: #333; min-height: ${thermal ? "20px" : "34px"}; }
  .foot { margin-top: ${thermal ? "8px" : "14px"}; text-align: center; font-size: 10px; color: #444; border-top: 1px dashed #999; padding-top: 5px; }
  .thanks { font-weight: 800; font-size: ${thermal ? "11.5px" : "12.5px"}; color: #111; }
  .copy { font-size: 9.5px; color: #666; }
  .nowrap { white-space: nowrap; }
  /* Tailor sheets: measurement cells with large values, read at a glance in the workshop. */
  .measures { display: grid; grid-template-columns: ${thermal ? "1fr 1fr" : "repeat(4, 1fr)"}; gap: ${thermal ? "4px" : "6px"}; margin-top: 4px; }
  .m-cell { border: 1px solid ${thermal ? "#000" : "#e7d6dc"}; border-radius: ${thermal ? "4px" : "8px"}; padding: ${thermal ? "3px 4px" : "6px 8px"}; text-align: center; background: #fff; }
  .m-label { font-size: ${thermal ? "10.5px" : "11px"}; color: #555; }
  .m-value { font-size: ${thermal ? "17px" : "19px"}; font-weight: 800; line-height: 1.25; }
  .m-empty .m-value { font-weight: 400; color: #999; }
  .m-count { font-weight: 600; font-size: 10.5px; color: #555; }
  .stage { margin: 2px 0 4px; font-size: ${thermal ? "12px" : "13px"}; }
  .warn { margin: ${thermal ? "6px 0" : "8px 0"}; padding: ${thermal ? "5px 6px" : "8px 12px"}; border: 2px solid #000; border-radius: ${thermal ? "4px" : "8px"}; ${thermal ? "" : "background: #fff7e6;"} }
  `;
}

/** Full stylesheet of the print window. */
function css(format: ReceiptFormat) {
  const thermal = format === "80mm";
  return `
  @page { size: ${thermal ? "80mm auto" : "A5 portrait"}; margin: ${thermal ? "0" : "9mm"}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  ${rules(format)}
  @media screen { body { background: #eee; padding: 14px; } .doc { ${thermal ? "max-width: 80mm;" : "padding: 18px;"} box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
  `;
}

/** Workshop roll layout only; student/payment receipts and A5 keep their existing composition. */
function tailorThermalRules() {
  return `
  .doc.tailor-thermal { max-width: 72mm; padding: 1.5mm; font-size: 11px; line-height: 1.3; }
  .tailor-thermal .head { flex-direction: row; gap: 6px; text-align: right; }
  .tailor-thermal .logo { width: 30px; height: 30px; }
  .tailor-thermal .company { font-size: 14px; }
  .tailor-thermal .tagline, .tailor-thermal .contact { font-size: 8.5px; }
  .tailor-thermal .title { margin: 4px 0; padding: 3px 4px; font-size: 12px; }
  .tailor-thermal .docno { margin-bottom: 3px; font-size: 9px; flex-wrap: wrap; }
  .tailor-thermal .card { margin: 4px 0; padding: 4px; }
  .tailor-thermal .card h3 { margin-bottom: 3px; font-size: 10.5px; }
  .tailor-thermal .student-name { font-size: 13px; }
  .tailor-thermal .kv { font-size: 10.5px; padding: 0; }
  .tailor-thermal .measures { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
  .tailor-thermal .m-cell { min-width: 0; padding: 3px 2px; break-inside: avoid; }
  .tailor-thermal .m-label { font-size: 9px; overflow-wrap: anywhere; }
  .tailor-thermal .m-value { font-size: 15px; overflow-wrap: anywhere; }
  .tailor-thermal .warn { margin: 4px 0; padding: 3px 4px; }
  .tailor-thermal .verify { flex-direction: column; gap: 2mm; margin-top: 4px; }
  .tailor-thermal .verify img { width: 22mm; height: 22mm; }
  .tailor-thermal .verify > div { width: 100%; min-width: 0; }
  .tailor-thermal .verify .hint { font-size: 9px; }
  .tailor-thermal .barcode svg { width: 60mm; max-width: 100%; height: 11mm; }
  .tailor-thermal .barcode .code { font-size: 8px; letter-spacing: 0; overflow-wrap: anywhere; }
  .tailor-thermal .signs { margin-top: 7px; gap: 10px; }
  .tailor-thermal .signs div { font-size: 9px; min-height: 12px; }
  .tailor-thermal .foot { margin-top: 4px; padding-top: 3px; }
  .tailor-thermal .thanks { font-size: 10px; }
  .tailor-thermal .copy { font-size: 8px; }
  /* No @page size: the printer driver's paper defines the page and the sheet
     starts at its top. Chromium centres a CSS page smaller than the paper
     (blank strip before and after it; ~1.5 m on a 3276 mm roll) and shrinks a
     larger one. When a sheet is longer than a fixed driver page it continues
     on the next one between sections, never through a line. */
  .tailor-thermal .head, .tailor-thermal .title, .tailor-thermal .docno, .tailor-thermal .card,
  .tailor-thermal .warn, .tailor-thermal .verify, .tailor-thermal .signs, .tailor-thermal .foot,
  .tailor-thermal .kv, .tailor-thermal tr { break-inside: avoid; page-break-inside: avoid; }
  .tailor-thermal .card h3 { break-after: avoid; page-break-after: avoid; }
  `;
}

/** The same rules confined to one container (in-page PDF export never restyles the page). */
export function scopedReceiptCss(format: ReceiptFormat, scope: string) {
  return rules(format).replace(/(^|\})\s*([^{}]+)\{/g, (_match, close: string, selectors: string) =>
    `${close}
  ${selectors.split(",").map((selector) => `${scope} ${selector.trim()}`).join(", ")} {`);
}

function headerHtml(brand: ReceiptBrand, format: ReceiptFormat, meta: string) {
  const contact = [brand.phone && `هاتف ${brand.phone}`, brand.whatsapp && brand.whatsapp !== brand.phone && `واتساب ${brand.whatsapp}`, brand.address]
    .filter(Boolean).map((item) => `<span>${escapeReceipt(item)}</span>`).join(" · ");
  return `<header class="head">
    ${brand.logo ? `<img class="logo" src="${escapeReceipt(brand.logo)}" alt="AJN">` : ""}
    <div class="brand">
      <div class="company">${escapeReceipt(brand.company)}</div>
      <div class="tagline">تجهيزات التخرج — أرواب · أوشحة · قبعات</div>
      ${contact ? `<div class="contact">${contact}</div>` : ""}
    </div>
    ${format === "a5" ? `<div class="meta">${meta}</div>` : ""}
  </header>`;
}

function printScript(tailorThermal = false) {
  return `<script>
    (function () {
      function images() {
        return Promise.all(Array.prototype.slice.call(document.images).map(function (img) {
          if (img.complete && img.naturalWidth > 0) return null;
          return new Promise(function (resolve) { img.onload = img.onerror = resolve; setTimeout(resolve, 2500); });
        }));
      }
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      Promise.all([images(), fonts]).then(function () {
        setTimeout(function () {
          var desktop = window.ajnDesktop && window.ajnDesktop.print;
          if (desktop) desktop(${tailorThermal ? '{ paperSize: "80mm" }' : ""}); else window.print();
        }, 150);
      });
    })();
  </script>`;
}

function writeDocument(popup: Window, title: string, format: ReceiptFormat, body: string, tailorSheet = false) {
  const tailorThermal = tailorSheet && format === "80mm";
  popup.document.open();
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeReceipt(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
    <style>${css(format)}${tailorThermal ? tailorThermalRules() : ""}</style>
    </head><body><main class="doc${tailorThermal ? " tailor-thermal" : ""}">${body}</main>${printScript(tailorThermal)}</body></html>`);
  popup.document.close();
}

function studentCard(student: ReceiptStudent, group: ReceiptGroup, format: ReceiptFormat) {
  const place = [group.university, group.college, group.department].filter(Boolean).join(" — ");
  return `<section class="card">
    <h3>بيانات الطالب</h3>
    <p class="student-name">${escapeReceipt(student.name)}</p>
    <div class="grid">
      <div class="kv"><span>كود الطالب</span><span class="num nowrap">${escapeReceipt(student.studentCode)}</span></div>
      ${student.phone ? `<div class="kv"><span>الهاتف</span><span class="num">${escapeReceipt(student.phone)}</span></div>` : ""}
      <div class="kv"><span>المجموعة</span><span>${escapeReceipt(group.title)}</span></div>
      ${group.batchLabel ? `<div class="kv"><span>الوجبة</span><span>${escapeReceipt(group.batchLabel)}</span></div>` : ""}
      ${format === "a5" && place ? `<div class="kv" style="grid-column:1/-1"><span>الجهة</span><span>${escapeReceipt(place)}</span></div>` : ""}
      ${group.representativeName ? `<div class="kv"><span>ممثل الدفعة</span><span>${escapeReceipt(group.representativeName)}</span></div>` : ""}
    </div>
  </section>`;
}

function verifyBlock(qr: string, barcode: string, code: string, hint = "امسح الرمز لمتابعة حالة طلبك ودفعاتك") {
  if (!qr && !barcode) return "";
  return `<section class="verify">
    ${qr ? `<img src="${qr}" alt="QR">` : ""}
    <div>
      ${qr ? `<div class="hint">${escapeReceipt(hint)}</div>` : ""}
      ${barcode ? `<div class="barcode">${barcode}<div class="code num">${escapeReceipt(code)}</div></div>` : ""}
    </div>
  </section>`;
}

/** «وصل وكشف حساب الطالب»: order details, approved payments and the balance. */
export type StudentReceiptInput = {
  format: ReceiptFormat;
  brand: ReceiptBrand;
  student: ReceiptStudent;
  group: ReceiptGroup;
  details: ReceiptLine[];
  payments: ReceiptPayment[];
  totals: ReceiptTotals;
  printedBy?: string;
};

/** The graduation tagline replaces the group tagline on graduation receipts. */
const GRADUATION_TAGLINE = "تجهيزات التخرج — أرواب · أوشحة · قبعات";

function graduationBrand(brand: ReceiptBrand): BrandIdentity {
  const base = currentReceiptBrand();
  return { ...base, tagline: GRADUATION_TAGLINE, logoUrl: base.logoUrl || brand.logo };
}

const brandedSize = (format: ReceiptFormat): BrandedReceiptSize => (format === "a5" ? "a5" : "80mm");

function studentFacts(student: ReceiptStudent, group: ReceiptGroup): ReceiptFact[] {
  const place = [group.university, group.college, group.department].filter(Boolean).join(" — ");
  return [
    { label: "الطالب", value: student.name, icon: "user" },
    { label: "كود الطالب", value: student.studentCode, icon: "id" },
    { label: "الهاتف", value: student.phone, icon: "phone" },
    { label: "المجموعة", value: group.title, icon: "graduation" },
    { label: "الوجبة", value: group.batchLabel, icon: "layers" },
    { label: "ممثل الدفعة", value: group.representativeName, icon: "user" },
    { label: "الجهة", value: place, icon: "pin", wide: true },
  ];
}

function studentReceiptDoc(input: StudentReceiptInput, barcode: string): BrandedReceiptDoc {
  const { student, group, totals } = input;
  const receiptNo = student.receiptNo || student.orderNo || student.studentCode;
  const details = input.details.filter((line) => line.value && line.value !== "—");
  return {
    documentTitle: `وصل ${student.name}`,
    title: "وصل وكشف حساب الطالب",
    icon: "graduation",
    copyLabel: `نسخة الطالب${input.printedBy ? ` · طُبع بواسطة ${input.printedBy}` : ""}`,
    facts: [
      { label: "رقم الوصل", value: receiptNo, icon: "receipt" },
      { label: "تاريخ الطباعة", value: nowText(), icon: "calendar" },
      ...studentFacts(student, group),
      { label: "حالة الدفع", value: stamp(totals).label, icon: "wallet" },
    ],
    sections: details.length ? [{ title: "تفاصيل التجهيز", facts: details.map((line) => ({ label: line.label, value: line.value })) }] : [],
    items: {
      title: "الدفعات المعتمدة",
      columns: [
        { key: "i", label: "#", role: "index" },
        { key: "date", label: "التاريخ", role: "name" },
        { key: "receiptNo", label: "رقم الوصل", role: "number", wideOnly: true },
        { key: "method", label: "الطريقة", wideOnly: true },
        { key: "amount", label: "المبلغ", role: "total" },
      ],
      rows: input.payments.map((payment) => ({ cells: { date: payment.date, receiptNo: payment.receiptNo, method: payment.method, amount: money(payment.amount) } })),
      empty: "لا توجد دفعات معتمدة بعد",
    },
    totals: [
      { label: "إجمالي التجهيز", value: money(totals.total) },
      { label: "المدفوع", value: money(totals.paid) },
      { label: "المتبقي", value: money(totals.remaining), tone: "due" },
    ],
    qr: student.trackingUrl ? { url: student.trackingUrl, caption: "تابع طلبك ودفعاتك" } : null,
    hideQr: !student.trackingUrl && !barcode,
    barcode: barcode ? { svg: barcode, code: student.studentCode } : null,
    signatures: ["توقيع ممثل الدفعة", "توقيع الطالب"],
    footNote: "المبالغ أعلاه معتمدة من الإدارة؛ الدفعات بانتظار الاعتماد لا تظهر في هذا الوصل.",
  };
}

export async function printStudentReceipt(popup: Window, input: StudentReceiptInput) {
  writeBrandedDocument(popup, buildBrandedReceiptHtml(studentReceiptDoc(input, barcodeSvg(input.student.studentCode)), brandedSize(input.format), graduationBrand(input.brand)));
}

/**
 * The same receipt as a detached element for PDF export: the branded receipt
 * styles are scoped to its root, so adding it to the page never restyles the page.
 */
export async function studentReceiptElement(input: StudentReceiptInput): Promise<HTMLElement> {
  const element = document.createElement("div");
  element.className = "ajn-receipt-pdf";
  element.dir = "rtl";
  element.style.width = input.format === "80mm" ? "72mm" : "148mm";
  element.style.background = "#fff";
  element.innerHTML = brandedReceiptBody(studentReceiptDoc(input, barcodeSvg(input.student.studentCode)), brandedSize(input.format), graduationBrand(input.brand));
  return element;
}

/** Writes a branded receipt into the already-open popup and prints once images and fonts are ready. */
function writeBrandedDocument(popup: Window, html: string) {
  popup.document.open();
  popup.document.write(html.replace("</body>", `${printScript(false)}</body>`));
  popup.document.close();
}

/** «وصل استلام دفعة» for one approved payment, from the payment's own snapshot. */
export async function printPaymentReceipt(popup: Window, input: {
  format: ReceiptFormat;
  brand: ReceiptBrand;
  student: ReceiptStudent;
  group: ReceiptGroup;
  payment: ReceiptPayment & { receivedBy?: string | null; notes?: string | null };
  totals?: ReceiptTotals | null;
  printedBy?: string;
}) {
  const { student, group, payment, totals } = input;
  const barcode = barcodeSvg(student.studentCode);
  const doc: BrandedReceiptDoc = {
    documentTitle: payment.receiptNo || "وصل دفعة",
    title: "وصل استلام دفعة",
    icon: "cash-in",
    copyLabel: `نسخة الطالب${input.printedBy ? ` · طُبع بواسطة ${input.printedBy}` : ""}`,
    facts: [
      { label: "رقم الوصل", value: payment.receiptNo, icon: "receipt" },
      { label: "تاريخ الدفعة", value: payment.date, icon: "calendar" },
      ...studentFacts(student, group),
      { label: "طريقة الدفع", value: payment.method, icon: "wallet" },
      { label: "المستلم", value: payment.receivedBy, icon: "id" },
    ],
    totals: [
      { label: "المبلغ المستلم", value: money(payment.amount), tone: totals ? "strong" : "due" },
      ...(totals ? [
        { label: "إجمالي التجهيز", value: money(totals.total) },
        { label: "مجموع المدفوع حتى الآن", value: money(totals.paid) },
        { label: "المتبقي حالياً", value: money(totals.remaining), tone: "due" as const },
      ] : []),
    ],
    notes: payment.notes || null,
    qr: student.trackingUrl ? { url: student.trackingUrl, caption: "تابع طلبك ودفعاتك" } : null,
    hideQr: !student.trackingUrl && !barcode,
    barcode: barcode ? { svg: barcode, code: student.studentCode } : null,
    signatures: ["توقيع المستلم", "توقيع الطالب"],
  };
  writeBrandedDocument(popup, buildBrandedReceiptHtml(doc, brandedSize(input.format), graduationBrand(input.brand)));
}

// ------------------------------------------------------------------ tailor sheets

export type TailorSheetInput = {
  format: ReceiptFormat;
  kind: "measurements" | "production";
  brand: ReceiptBrand;
  student: { name: string; studentCode: string; trackingUrl?: string | null };
  /** Group, university, tailor, due date… (no prices: tailors never see money). */
  info: ReceiptLine[];
  garment: ReceiptLine[];
  measurements: ReceiptLine[];
  stage?: string;
  alterations?: Array<{ type: string; change: string }>;
  notes?: string;
  warning?: string;
};

/** «ورقة قياسات الخياط» / «ورقة إنتاج الخياطة» in 80mm thermal or A5, same design as the receipts. */
export async function printTailorSheet(popup: Window, input: TailorSheetInput) {
  const { format, brand, student } = input;
  const [qr, barcode] = await Promise.all([qrDataUrl(student.trackingUrl || ""), Promise.resolve(barcodeSvg(student.studentCode))]);
  const title = input.kind === "production" ? "ورقة إنتاج الخياطة" : "ورقة قياسات الخياط";
  const printed = nowText();
  const meta = `<div>كود الطالب: <b class="num">${escapeReceipt(student.studentCode)}</b></div><div>تاريخ الطباعة: <span class="num">${escapeReceipt(printed)}</span></div>`;
  const lines = (items: ReceiptLine[]) => items.filter((line) => line.value && line.value !== "—")
    .map((line) => `<div class="kv"><span>${escapeReceipt(line.label)}</span><span>${escapeReceipt(line.value)}</span></div>`).join("");
  const filled = input.measurements.filter((line) => line.value && line.value !== "—").length;
  const cells = input.measurements.map((line) => {
    const empty = !line.value || line.value === "—";
    return `<div class="m-cell${empty ? " m-empty" : ""}"><div class="m-label">${escapeReceipt(line.label)}</div><div class="m-value num">${empty ? "—" : escapeReceipt(line.value)}</div></div>`;
  }).join("");
  const alterations = input.kind === "production"
    ? `<section class="card"><h3>التعديلات المطلوبة</h3>${(input.alterations ?? []).length
      ? `<table><thead><tr><th>النوع</th><th>المطلوب</th></tr></thead><tbody>${(input.alterations ?? []).map((item) => `<tr><td>${escapeReceipt(item.type)}</td><td>${escapeReceipt(item.change)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">لا توجد تعديلات</div>`}</section>`
    : "";
  const body = `${headerHtml(brand, format, meta)}
    <div class="title">${title}</div>
    ${format === "80mm" ? `<div class="docno"><span>كود: <b class="num">${escapeReceipt(student.studentCode)}</b></span><span class="num">${escapeReceipt(printed)}</span></div>` : ""}
    <section class="card">
      <h3>بيانات الطالب</h3>
      <p class="student-name">${escapeReceipt(student.name)}</p>
      ${input.stage ? `<div class="stage">المرحلة الحالية: <b>${escapeReceipt(input.stage)}</b></div>` : ""}
      <div class="grid">${lines(input.info)}</div>
    </section>
    ${lines(input.garment) ? `<section class="card"><h3>تفاصيل التفصيل</h3><div class="grid">${lines(input.garment)}</div></section>` : ""}
    <section class="card">
      <h3>القياسات <span class="m-count">(${filled} من ${input.measurements.length} مدخلة)</span></h3>
      <div class="measures">${cells}</div>
    </section>
    ${alterations}
    ${input.warning ? `<section class="warn"><b>تنبيه:</b> ${escapeReceipt(input.warning)}</section>` : ""}
    ${input.notes ? `<section class="card"><h3>ملاحظات</h3><div>${escapeReceipt(input.notes)}</div></section>` : ""}
    ${verifyBlock(qr, barcode, student.studentCode, "امسح الرمز لفتح ملف الطالب")}
    <div class="signs"><div>توقيع الخياط</div><div>مراقبة الجودة</div></div>
    <footer class="foot">
      <div class="thanks">${escapeReceipt(brand.company)} — قسم الخياطة</div>
      <div class="copy">ورقة داخلية للورشة · لا تحتوي أسعاراً</div>
    </footer>`;
  writeDocument(popup, `${title} — ${student.name}`, format, body, true);
}
