/**
 * Printable vehicle documents: the partner payout receipt (A4 + 80mm) and the
 * vehicle's monthly report (A4). Pure builders over values the caller already
 * read from the server; they compute nothing financial and post nothing.
 */
import { sheetReportCss, thermalReceiptCss } from "@/views/admin/print-helpers";
import { formatCurrency } from "@/lib/money";
import { clean, displayDate, esc } from "@/components/booking-thermal-receipt";

const printedAt = () => new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short" }).format(new Date());
const monthText = (month: string | null | undefined) => (month ? month.replace("-", " / ") : "");
const money = (value: number | null | undefined) => (value == null ? "—" : formatCurrency(value));
const percent = (points: number) => `${points % 100 ? (points / 100).toFixed(2).replace(/0$/, "") : points / 100}%`;
const METHOD: Record<string, string> = { cash: "نقدي", transfer: "تحويل", pos: "بطاقة" };

export type PartnerPayoutReceiptData = {
  id: number;
  transactionNo: string | null;
  date: string;
  /** The month this payout pays; null for payouts made before months were recorded. */
  month: string | null;
  amount: number;
  /** pending | executed | rejected | reversed | partially_reversed | cancelled */
  status: string;
  paymentMethod: string | null;
  note: string | null;
  partnerName: string;
  partnerPhone: string | null;
  vehicleName: string;
  plateNumber: string | null;
  /** That month's partner share and what is left of it, as shown on screen. */
  monthShare?: number | null;
  monthRemaining?: number | null;
};

/** Only an executed payout is a receipt of money; anything else says what it is. */
function payoutTitle(status: string) {
  if (status === "executed") return "وصل صرف حصة شريك";
  if (status === "pending") return "طلب صرف حصة شريك — بانتظار الموافقة";
  if (status === "reversed" || status === "partially_reversed") return "صرف حصة شريك — معكوس";
  return "طلب صرف حصة شريك — غير منفذ";
}

function payoutThermal(data: PartnerPayoutReceiptData) {
  const kv = (label: string, value: unknown, num = false) => {
    const text = clean(value);
    return text ? `<div class="kv"><span>${esc(label)}</span><b class="v${num ? " num" : ""}">${esc(text)}</b></div>` : "";
  };
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(payoutTitle(data.status))}</title><style>${thermalReceiptCss("80mm")}
    .payout-slip .kv { align-items: baseline; }
    .payout-slip .kv .v { max-width: 62%; overflow-wrap: anywhere; }
    .payout-slip .state { text-align: center; font-weight: 800; margin: 2px 0; }
    .payout-slip .sign { margin-top: 26px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-weight: 700; }
  </style></head><body><div class="receipt payout-slip">
    <div class="r-head"><div class="r-company">AJN — مجموعة علي جان نهاد</div><div class="r-sub">${esc(payoutTitle(data.status))}</div></div>
    <hr class="rule">
    ${kv("رقم الحركة", data.transactionNo ?? `#${data.id}`, true)}
    ${kv("التاريخ", displayDate(data.date), true)}
    ${kv("عن شهر", monthText(data.month), true)}
    <hr class="rule dashed">
    ${kv("الشريك", data.partnerName)}
    ${kv("الهاتف", data.partnerPhone, true)}
    ${kv("السيارة", [data.vehicleName, data.plateNumber].filter(Boolean).join(" · "))}
    ${kv("طريقة الدفع", METHOD[data.paymentMethod ?? ""] ?? data.paymentMethod)}
    <hr class="rule">
    <div class="grand"><span>المبلغ</span><span class="num">${esc(formatCurrency(data.amount))}</span></div>
    ${data.monthShare != null ? kv("حصة الشهر", formatCurrency(data.monthShare), true) : ""}
    ${data.monthRemaining != null ? kv("الباقي من الشهر", formatCurrency(data.monthRemaining), true) : ""}
    ${clean(data.note) ? `<hr class="rule dashed">${kv("ملاحظة", data.note)}` : ""}
    <div class="sign">توقيع المستلم</div>
    <div class="thanks">طُبع ${esc(printedAt())}</div>
  </div></body></html>`;
}

function payoutA4(data: PartnerPayoutReceiptData) {
  const field = (label: string, value: unknown, wide = false) =>
    `<div class="p-field${wide ? " wide" : ""}"><span>${esc(label)}</span><b>${esc(clean(value) || "—")}</b></div>`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(payoutTitle(data.status))}</title><style>${sheetReportCss("a4")}
    .p-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 14px 0; }
    .p-field { border: 1px solid #111; padding: 8px 10px; min-height: 48px; }
    .p-field.wide { grid-column: 1 / -1; }
    .p-field span { display: block; color: #555; font-size: 10px; margin-bottom: 4px; }
    .p-field b { font-size: 13px; overflow-wrap: anywhere; }
    .p-amount { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border: 2px solid #000; padding: 12px 14px; margin: 14px 0 6px; }
    .p-amount span { font-size: 14px; font-weight: 800; }
    .p-amount b { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .p-state { font-size: 12px; font-weight: 800; margin-bottom: 14px; }
    .p-sign { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 56px; }
    .p-sign div { border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 11px; font-weight: 700; }
    .num { font-variant-numeric: tabular-nums; }
  </style></head><body><main class="report-sheet">
    <header class="report-head">
      <div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">${esc(payoutTitle(data.status))}</div></div>
      <div class="report-meta">رقم الحركة: <b class="num">${esc(data.transactionNo ?? `#${data.id}`)}</b><br>تاريخ الطباعة: <span class="num">${esc(printedAt())}</span></div>
    </header>
    <section class="p-grid">
      ${field("الشريك", data.partnerName)}
      ${field("الهاتف", data.partnerPhone)}
      ${field("السيارة", [data.vehicleName, data.plateNumber].filter(Boolean).join(" · "))}
      ${field("عن شهر", monthText(data.month) || "—")}
      ${field("تاريخ الصرف", displayDate(data.date))}
      ${field("طريقة الدفع", METHOD[data.paymentMethod ?? ""] ?? data.paymentMethod)}
      ${data.monthShare != null ? field("حصة الشريك لهذا الشهر", formatCurrency(data.monthShare)) : ""}
      ${data.monthRemaining != null ? field("الباقي له من هذا الشهر", formatCurrency(data.monthRemaining)) : ""}
      ${clean(data.note) ? field("ملاحظة", data.note, true) : ""}
    </section>
    <div class="p-amount"><span>المبلغ المصروف</span><b>${esc(formatCurrency(data.amount))}</b></div>
    <div class="p-state">${data.status === "executed" ? "انصرف من الصندوق الرئيسي." : "هذا طلب، والمبلغ ما ينصرف إلا بعد موافقة الإدارة."}</div>
    <section class="p-sign"><div>توقيع الشريك المستلم</div><div>توقيع المحاسب</div></section>
    <footer class="report-footer">مجموعة علي جان نهاد — حصة شريك السيارة ${esc(data.vehicleName)}</footer>
  </main></body></html>`;
}

export function buildPartnerPayoutReceiptHtml(data: PartnerPayoutReceiptData, size: "a4" | "80mm") {
  return size === "a4" ? payoutA4(data) : payoutThermal(data);
}

export type VehicleMonthReportData = {
  vehicleName: string;
  plateNumber: string | null;
  month: string;
  summary: { tripCount: number; income: number | null; expenses: number; net: number | null; unallocatedBookings: number };
  trips: Array<{ date: string | null; number: string; customer: string; driver: string | null; fee: number | null; standalone: boolean }>;
  expenses: Array<{ date: string; type: string; description: string | null; amount: number; counted: boolean; status: string }>;
  partner: null | { name: string; shareBasisPoints: number; partnerShare: number; companyShare: number; paid: number; pending: number; remaining: number };
  payouts: Array<{ date: string; number: string; amount: number; status: string }>;
};

const STATUS: Record<string, string> = { executed: "منفذ", pending: "بانتظار الموافقة", rejected: "مرفوض", reversed: "معكوس", partially_reversed: "معكوس جزئياً", cancelled: "ملغي" };

/** A4 monthly vehicle report: what the car earned, what it cost, and who gets what. */
export function buildVehicleMonthReportHtml(data: VehicleMonthReportData) {
  const stat = (label: string, value: string) => `<div class="report-stat">${esc(label)}<strong class="num">${esc(value)}</strong></div>`;
  const trips = data.trips.map((trip) => `<tr><td class="num">${esc(displayDate(trip.date) || "—")}</td><td class="num">${esc(trip.number)}${trip.standalone ? " <small>(نقل مستقل)</small>" : ""}</td><td>${esc(trip.customer)}</td><td>${esc(trip.driver || "—")}</td><td class="num">${esc(trip.fee == null ? "أجرة كلية لعدة سيارات" : formatCurrency(trip.fee))}</td></tr>`).join("");
  const expenses = data.expenses.map((row) => `<tr${row.counted ? "" : ' class="muted"'}><td class="num">${esc(displayDate(row.date))}</td><td>${esc(row.type)}</td><td>${esc(row.description || "—")}</td><td class="num">${esc(formatCurrency(row.amount))}</td><td>${esc(row.counted ? "محسوب" : `${STATUS[row.status] ?? row.status} — غير محسوب`)}</td></tr>`).join("");
  const payouts = data.payouts.map((row) => `<tr><td class="num">${esc(displayDate(row.date))}</td><td class="num">${esc(row.number)}</td><td class="num">${esc(formatCurrency(row.amount))}</td><td>${esc(STATUS[row.status] ?? row.status)}</td></tr>`).join("");
  const partner = data.partner;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تقرير ${esc(data.vehicleName)} — ${esc(monthText(data.month))}</title><style>${sheetReportCss("a4")}
    h2 { font-size: 14px; margin: 16px 0 6px; }
    .num { font-variant-numeric: tabular-nums; }
    .report-table thead { display: table-header-group; }
    .report-table tr { break-inside: avoid; page-break-inside: avoid; }
    .report-table tr.muted td { color: #555; }
    .report-table tfoot td { font-weight: 800; background: #f7f7f7; }
    .split { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .split div { border: 1px solid #000; padding: 8px; }
    .split strong { display: block; font-size: 15px; margin-top: 3px; }
    .split .main { border-width: 2px; }
    .note { border: 1px dashed #000; padding: 6px 8px; margin: 8px 0; font-size: 11px; }
    .empty { border: 1px solid #000; padding: 10px; text-align: center; color: #444; }
    .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; margin-top: 46px; }
    .signs div { border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 11px; font-weight: 700; }
  </style></head><body><main class="report-sheet">
    <header class="report-head">
      <div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">تقرير السيارة الشهري</div></div>
      <div class="report-meta">السيارة: <b>${esc(data.vehicleName)}${data.plateNumber ? ` · <span class="num">${esc(data.plateNumber)}</span>` : ""}</b><br>الشهر: <b class="num">${esc(monthText(data.month))}</b><br>تاريخ الطباعة: <span class="num">${esc(printedAt())}</span></div>
    </header>
    <section class="report-summary">
      ${stat("عدد الرحلات", String(data.summary.tripCount))}
      ${stat("دخل النقل", money(data.summary.income))}
      ${stat("مصاريف السيارة", formatCurrency(data.summary.expenses))}
      ${stat("الصافي", money(data.summary.net))}
    </section>
    ${data.summary.unallocatedBookings ? `<p class="note">${data.summary.unallocatedBookings} حجز بأجرة كلية لعدة سيارات، أجرته غير محسوبة لهذه السيارة.</p>` : ""}
    ${partner ? `<h2>تقسيم الصافي</h2>
    <section class="split">
      <div class="main">حصة الشريك ${esc(partner.name)} (${esc(percent(partner.shareBasisPoints))})<strong class="num">${esc(formatCurrency(partner.partnerShare))}</strong></div>
      <div>حصة الشركة<strong class="num">${esc(formatCurrency(partner.companyShare))}</strong></div>
      <div>انصرف للشريك عن هذا الشهر<strong class="num">${esc(formatCurrency(partner.paid))}</strong>${partner.pending ? `<small>بانتظار الموافقة: ${esc(formatCurrency(partner.pending))}</small>` : ""}</div>
    </section>
    <p class="note">الباقي للشريك من هذا الشهر: <b class="num">${esc(formatCurrency(partner.remaining))}</b></p>` : `<p class="note">لا يوجد شريك بهذا الشهر؛ الصافي كله للشركة.</p>`}
    <h2>الرحلات</h2>
    ${data.trips.length ? `<table class="report-table"><thead><tr><th>التاريخ</th><th>الرقم</th><th>الزبون</th><th>السائق</th><th>الأجرة</th></tr></thead><tbody>${trips}</tbody><tfoot><tr><td colspan="4">مجموع الأجور</td><td class="num">${esc(money(data.summary.income))}</td></tr></tfoot></table>` : `<div class="empty">لا توجد رحلات بهذا الشهر.</div>`}
    <h2>المصاريف</h2>
    ${data.expenses.length ? `<table class="report-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>ملاحظة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${expenses}</tbody><tfoot><tr><td colspan="3">المصاريف المحسوبة (المنفذة)</td><td class="num">${esc(formatCurrency(data.summary.expenses))}</td><td></td></tr></tfoot></table>` : `<div class="empty">لا توجد مصاريف بهذا الشهر.</div>`}
    ${partner ? `<h2>صرف حصة الشريك عن هذا الشهر</h2>
    ${data.payouts.length ? `<table class="report-table"><thead><tr><th>التاريخ</th><th>رقم الحركة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${payouts}</tbody></table>` : `<div class="empty">لم يُصرف شيء عن هذا الشهر.</div>`}` : ""}
    <section class="signs"><div>المحاسب</div><div>${partner ? "الشريك" : "السائق"}</div><div>المدير</div></section>
    <footer class="report-footer">مجموعة علي جان نهاد — تقرير ${esc(data.vehicleName)} لشهر ${esc(monthText(data.month))}</footer>
  </main></body></html>`;
}
