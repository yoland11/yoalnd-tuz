/**
 * Printable vehicle documents: the partner payout receipt (branded A5 + 80mm) and the
 * vehicle's monthly report (A4). Pure builders over values the caller already
 * read from the server; they compute nothing financial and post nothing.
 */
import { sheetReportCss } from "@/views/admin/print-helpers";
import { buildBrandedReceiptHtml, type BrandedReceiptDoc, type BrandedReceiptSize } from "@/lib/branded-receipt";
import type { ReceiptBrand } from "@/lib/receipt-brand";
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

/** Says plainly when a printed payout is not money paid out. */
function payoutState(status: string): BrandedReceiptDoc["state"] {
  if (status === "executed") return null;
  if (status === "pending") return { text: "هذا طلب — المبلغ ما ينصرف إلا بعد موافقة الإدارة. ليس وصل دفع." };
  if (status === "reversed" || status === "partially_reversed") return { text: "هذا الصرف معكوس — ليس وصل دفع.", tone: "danger" };
  return { text: "هذا الطلب غير منفذ — ليس وصل دفع.", tone: "danger" };
}

export function buildPartnerPayoutReceiptHtml(data: PartnerPayoutReceiptData, size: BrandedReceiptSize, brand?: ReceiptBrand) {
  const executed = data.status === "executed";
  return buildBrandedReceiptHtml({
    documentTitle: payoutTitle(data.status),
    title: payoutTitle(data.status),
    icon: "cash-out",
    state: payoutState(data.status),
    facts: [
      { label: "رقم الحركة", value: data.transactionNo ?? `#${data.id}`, icon: "receipt" },
      { label: "تاريخ الصرف", value: displayDate(data.date), icon: "calendar" },
      { label: "الشريك", value: data.partnerName, icon: "user" },
      { label: "الهاتف", value: data.partnerPhone, icon: "phone" },
      { label: "السيارة", value: [data.vehicleName, data.plateNumber].filter(Boolean).join(" · "), icon: "car" },
      { label: "عن شهر", value: monthText(data.month), icon: "calendar" },
      { label: "طريقة الدفع", value: METHOD[data.paymentMethod ?? ""] ?? data.paymentMethod, icon: "wallet" },
    ],
    totals: [
      { label: executed ? "المبلغ المصروف" : "المبلغ المطلوب", value: formatCurrency(data.amount), tone: executed ? "due" : "strong" },
      ...(data.monthShare != null ? [{ label: "حصة الشريك لهذا الشهر", value: formatCurrency(data.monthShare) }] : []),
      ...(data.monthRemaining != null ? [{ label: "الباقي له من هذا الشهر", value: formatCurrency(data.monthRemaining) }] : []),
    ],
    totalsNote: executed ? "انصرف من الصندوق الرئيسي." : null,
    notes: clean(data.note) || null,
    signatures: ["توقيع الشريك المستلم", "توقيع المحاسب"],
    hideQr: true,
  }, size, brand);
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
