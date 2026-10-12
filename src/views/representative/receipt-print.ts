/**
 * Professional graduation receipts for the representatives portal:
 * «وصل وكشف حساب الطالب» and «وصل استلام دفعة», in 80mm thermal or A5.
 *
 * Read-only projections of values the server already computed (total, paid,
 * remaining, receipt numbers); nothing is recalculated here. The print window
 * is opened synchronously on the click (popup blockers), then filled once the
 * QR code and barcode are ready.
 */
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { formatCurrency } from "@/lib/money";

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

function css(format: ReceiptFormat) {
  const thermal = format === "80mm";
  return `
  @page { size: ${thermal ? "80mm auto" : "A5 portrait"}; margin: ${thermal ? "3mm" : "9mm"}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: "Cairo", "Tajawal", "Segoe UI", Tahoma, Arial, sans-serif; font-size: ${thermal ? "11.5px" : "12.5px"}; line-height: 1.55; }
  .doc { width: ${thermal ? "74mm" : "100%"}; margin: 0 auto; }
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
  .kv { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .kv span:first-child { color: #555; white-space: nowrap; }
  .kv span:last-child { font-weight: 700; text-align: left; }
  table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  th, td { padding: ${thermal ? "3px 2px" : "5px 6px"}; text-align: right; border-bottom: 1px ${thermal ? "dashed #999" : "solid #eee"}; font-size: ${thermal ? "10.5px" : "11.5px"}; }
  th { font-weight: 800; ${thermal ? "border-bottom: 1px solid #000;" : `background: #f6eef1; color: ${BURGUNDY};`} }
  td.amount, th.amount { text-align: left; }
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
  .barcode svg { width: ${thermal ? "62mm" : "58mm"}; height: 11mm; }
  .barcode .code { font-size: 10.5px; letter-spacing: 1px; text-align: center; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: ${thermal ? "12px" : "20px"}; }
  .signs div { border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 10.5px; color: #333; min-height: ${thermal ? "20px" : "34px"}; }
  .foot { margin-top: ${thermal ? "8px" : "14px"}; text-align: center; font-size: 10px; color: #444; border-top: 1px dashed #999; padding-top: 5px; }
  .thanks { font-weight: 800; font-size: ${thermal ? "11.5px" : "12.5px"}; color: #111; }
  .copy { font-size: 9.5px; color: #666; }
  .nowrap { white-space: nowrap; }
  @media screen { body { background: #eee; padding: 14px; } .doc { background: #fff; padding: ${thermal ? "8px" : "18px"}; box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
  `;
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

function printScript() {
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
          if (desktop) desktop(); else window.print();
        }, 150);
      });
    })();
  </script>`;
}

function writeDocument(popup: Window, title: string, format: ReceiptFormat, body: string) {
  popup.document.open();
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeReceipt(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
    <style>${css(format)}</style></head><body><main class="doc">${body}</main>${printScript()}</body></html>`);
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

function verifyBlock(qr: string, barcode: string, code: string) {
  if (!qr && !barcode) return "";
  return `<section class="verify">
    ${qr ? `<img src="${qr}" alt="QR">` : ""}
    <div>
      ${qr ? `<div class="hint">امسح الرمز لمتابعة حالة طلبك ودفعاتك</div>` : ""}
      ${barcode ? `<div class="barcode">${barcode}<div class="code num">${escapeReceipt(code)}</div></div>` : ""}
    </div>
  </section>`;
}

/** «وصل وكشف حساب الطالب»: order details, approved payments and the balance. */
export async function printStudentReceipt(popup: Window, input: {
  format: ReceiptFormat;
  brand: ReceiptBrand;
  student: ReceiptStudent;
  group: ReceiptGroup;
  details: ReceiptLine[];
  payments: ReceiptPayment[];
  totals: ReceiptTotals;
  printedBy?: string;
}) {
  const { format, brand, student, group, totals } = input;
  const [qr, barcode] = await Promise.all([qrDataUrl(student.trackingUrl || ""), Promise.resolve(barcodeSvg(student.studentCode))]);
  const state = stamp(totals);
  const meta = `<div>رقم الوصل: <b class="num">${escapeReceipt(student.receiptNo || student.orderNo || student.studentCode)}</b></div><div>تاريخ الطباعة: <span class="num">${escapeReceipt(nowText())}</span></div>`;
  const details = input.details.filter((line) => line.value && line.value !== "—");
  const rows = input.payments.length
    ? input.payments.map((payment, index) => `<tr><td class="num">${index + 1}</td><td class="num">${escapeReceipt(payment.date)}</td>${format === "a5" ? `<td class="num">${escapeReceipt(payment.receiptNo)}</td><td>${escapeReceipt(payment.method)}</td>` : ""}<td class="amount num">${escapeReceipt(money(payment.amount))}</td></tr>`).join("")
    : `<tr><td colspan="${format === "a5" ? 5 : 3}" class="empty">لا توجد دفعات معتمدة بعد</td></tr>`;
  const body = `${headerHtml(brand, format, meta)}
    <div class="title">وصل وكشف حساب الطالب</div>
    ${format === "80mm" ? `<div class="docno"><span>رقم: <b class="num">${escapeReceipt(student.receiptNo || student.orderNo || student.studentCode)}</b></span><span class="num">${escapeReceipt(nowText())}</span></div>` : ""}
    ${studentCard(student, group, format)}
    ${details.length ? `<section class="card"><h3>تفاصيل التجهيز</h3><div class="grid">${details.map((line) => `<div class="kv"><span>${escapeReceipt(line.label)}</span><span>${escapeReceipt(line.value)}</span></div>`).join("")}</div></section>` : ""}
    <section class="card">
      <h3>الدفعات المعتمدة</h3>
      <table><thead><tr><th>#</th><th>التاريخ</th>${format === "a5" ? "<th>رقم الوصل</th><th>الطريقة</th>" : ""}<th class="amount">المبلغ</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
    <section class="totals">
      <div class="kv"><span>إجمالي التجهيز</span><span class="num">${escapeReceipt(money(totals.total))}</span></div>
      <div class="kv"><span>المدفوع</span><span class="num">${escapeReceipt(money(totals.paid))}</span></div>
      <div class="grand"><span>المتبقي</span><span class="num">${escapeReceipt(money(totals.remaining))}</span></div>
      <div style="text-align:center"><span class="stamp ${state.tone}">${state.label}</span></div>
    </section>
    ${verifyBlock(qr, barcode, student.studentCode)}
    <div class="signs"><div>توقيع ممثل الدفعة</div><div>توقيع الطالب</div></div>
    <footer class="foot">
      <div class="thanks">شكراً لاختياركم ${escapeReceipt(brand.company)}</div>
      <div>المبالغ أعلاه معتمدة من الإدارة؛ الدفعات بانتظار الاعتماد لا تظهر في هذا الوصل.</div>
      <div class="copy">نسخة الطالب${input.printedBy ? ` · طُبع بواسطة ${escapeReceipt(input.printedBy)}` : ""}</div>
    </footer>`;
  writeDocument(popup, `وصل ${student.name}`, format, body);
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
  const { format, brand, student, group, payment, totals } = input;
  const [qr, barcode] = await Promise.all([qrDataUrl(student.trackingUrl || ""), Promise.resolve(barcodeSvg(student.studentCode))]);
  const meta = `<div>رقم الوصل: <b class="num">${escapeReceipt(payment.receiptNo)}</b></div><div>تاريخ الدفعة: <span class="num">${escapeReceipt(payment.date)}</span></div>`;
  const body = `${headerHtml(brand, format, meta)}
    <div class="title">وصل استلام دفعة</div>
    ${format === "80mm" ? `<div class="docno"><span>رقم: <b class="num">${escapeReceipt(payment.receiptNo)}</b></span><span class="num">${escapeReceipt(payment.date)}</span></div>` : ""}
    ${studentCard(student, group, format)}
    <section class="card">
      <h3>تفاصيل الدفعة</h3>
      <div class="kv"><span>طريقة الدفع</span><span>${escapeReceipt(payment.method)}</span></div>
      ${payment.receivedBy ? `<div class="kv"><span>المستلم</span><span>${escapeReceipt(payment.receivedBy)}</span></div>` : ""}
      ${payment.notes ? `<div class="kv"><span>ملاحظات</span><span>${escapeReceipt(payment.notes)}</span></div>` : ""}
      <div class="grand"><span>المبلغ المستلم</span><span class="num">${escapeReceipt(money(payment.amount))}</span></div>
    </section>
    ${totals ? `<section class="totals">
      <div class="kv"><span>إجمالي التجهيز</span><span class="num">${escapeReceipt(money(totals.total))}</span></div>
      <div class="kv"><span>مجموع المدفوع حتى الآن</span><span class="num">${escapeReceipt(money(totals.paid))}</span></div>
      <div class="kv"><span>المتبقي حالياً</span><span class="num">${escapeReceipt(money(totals.remaining))}</span></div>
    </section>` : ""}
    ${verifyBlock(qr, barcode, student.studentCode)}
    <div class="signs"><div>توقيع المستلم</div><div>توقيع الطالب</div></div>
    <footer class="foot">
      <div class="thanks">شكراً لاختياركم ${escapeReceipt(brand.company)}</div>
      <div class="copy">نسخة الطالب${input.printedBy ? ` · طُبع بواسطة ${escapeReceipt(input.printedBy)}` : ""}</div>
    </footer>`;
  writeDocument(popup, payment.receiptNo || "وصل دفعة", format, body);
}
