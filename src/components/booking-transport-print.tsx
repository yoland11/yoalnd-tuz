import { usePrint } from "@/components/print/print-provider";
import { sheetReportCss, thermalReceiptCss } from "@/views/admin/print-helpers";
import { formatCurrency } from "@/lib/money";
import { clean, displayDate, esc } from "@/components/booking-thermal-receipt";

/**
 * Transport slip (وصل خدمة النقل) for one booking: the AJN transport fee and its
 * details. Renders the SAVED transport values passed by the caller; it computes
 * nothing financial. A4 is the formal copy with signatures, 80mm the driver slip.
 */
export type BookingTransportPrintData = {
  bookingNumber: string;
  customerName?: string | null;
  phone?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  location?: string | null;
  /** "Name · plate" of the saved vehicle. */
  vehicle?: string | null;
  driver?: string | null;
  fee: number;
  /** The fee is part of the booking total (always for kosha bookings). */
  inTotal: boolean;
  note?: string | null;
};

const printedAt = () => new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short" }).format(new Date());
const feeNote = (data: BookingTransportPrintData) => (data.inTotal ? "ضمن مبلغ الحجز" : "للعلم — غير مضافة إلى مبلغ الحجز");

function thermalHtml(data: BookingTransportPrintData) {
  const kv = (label: string, value: unknown, num = false) => {
    const text = clean(value);
    return text ? `<div class="kv"><span>${esc(label)}</span><b class="v${num ? " num" : ""}">${esc(text)}</b></div>` : "";
  };
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>وصل نقل ${esc(data.bookingNumber)}</title><style>${thermalReceiptCss("80mm")}
    .transport-slip .kv { align-items: baseline; }
    .transport-slip .kv .v { max-width: 62%; overflow-wrap: anywhere; }
    .transport-slip .kv.note { display: block; }
    .transport-slip .kv.note .v { display: block; max-width: 100%; text-align: right; margin-top: 2px; }
    .transport-slip .grand span:first-child { font-weight: 800; }
    .transport-slip .fee-note { text-align: center; font-size: 11px; font-weight: 700; margin-top: 2px; }
  </style></head><body><div class="receipt transport-slip">
    <div class="r-head">
      <div class="r-company">AJN — مجموعة علي جان نهاد</div>
      <div class="r-sub">وصل خدمة النقل</div>
    </div>
    <hr class="rule">
    ${kv("رقم الحجز", data.bookingNumber, true)}
    ${kv("تاريخ الطباعة", printedAt(), true)}
    <hr class="rule dashed">
    ${kv("العميل", data.customerName)}
    ${kv("الهاتف", data.phone, true)}
    ${kv("تاريخ المناسبة", displayDate(data.eventDate), true)}
    ${kv("وقت المناسبة", data.eventTime, true)}
    ${kv("الموقع", data.location)}
    <hr class="rule dashed">
    ${kv("السيارة", data.vehicle)}
    ${kv("السائق", data.driver)}
    <hr class="rule">
    <div class="grand"><span>أجرة النقل</span><span class="num">${esc(formatCurrency(data.fee))}</span></div>
    <div class="fee-note">${esc(feeNote(data))}</div>
    ${clean(data.note) ? `<hr class="rule dashed"><div class="kv note"><span>ملاحظات</span><b class="v">${esc(data.note)}</b></div>` : ""}
    <hr class="rule dashed">
    <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
  </div></body></html>`;
}

function a4Html(data: BookingTransportPrintData) {
  const field = (label: string, value: unknown, wide = false) =>
    `<div class="t-field${wide ? " wide" : ""}"><span>${esc(label)}</span><b>${esc(clean(value) || "—")}</b></div>`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>وصل نقل ${esc(data.bookingNumber)}</title><style>${sheetReportCss("a4")}
    .t-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 14px 0; }
    .t-field { border: 1px solid #111; padding: 8px 10px; min-height: 48px; }
    .t-field.wide { grid-column: 1 / -1; }
    .t-field span { display: block; color: #555; font-size: 10px; margin-bottom: 4px; }
    .t-field b { font-size: 13px; overflow-wrap: anywhere; }
    .t-fee { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border: 2px solid #000; padding: 12px 14px; margin: 14px 0 6px; }
    .t-fee span { font-size: 14px; font-weight: 800; }
    .t-fee b { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .t-fee-note { font-size: 11px; font-weight: 700; margin-bottom: 14px; }
    .t-note { border: 1px solid #111; padding: 10px; white-space: pre-wrap; margin: 12px 0; }
    .t-sign { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 48px; }
    .t-sign div { border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 11px; font-weight: 700; }
    .num { font-variant-numeric: tabular-nums; }
  </style></head><body><main class="report-sheet">
    <header class="report-head">
      <div><div class="report-company">مجموعة علي جان نهاد</div><div class="report-title">وصل خدمة النقل</div></div>
      <div class="report-meta">رقم الحجز: <b class="num">${esc(data.bookingNumber)}</b><br>تاريخ الطباعة: <span class="num">${esc(printedAt())}</span></div>
    </header>
    <section class="t-grid">
      ${field("العميل", data.customerName)}
      ${field("الهاتف", data.phone)}
      ${field("تاريخ المناسبة", displayDate(data.eventDate))}
      ${field("وقت المناسبة", data.eventTime)}
      ${field("الموقع", data.location, true)}
      ${field("السيارة", data.vehicle)}
      ${field("السائق", data.driver)}
    </section>
    <div class="t-fee"><span>أجرة النقل</span><b>${esc(formatCurrency(data.fee))}</b></div>
    <div class="t-fee-note">${esc(feeNote(data))}</div>
    ${clean(data.note) ? `<div class="t-note"><b>ملاحظات: </b>${esc(data.note)}</div>` : ""}
    <section class="t-sign"><div>توقيع السائق</div><div>توقيع المستلم</div></section>
    <footer class="report-footer">مجموعة علي جان نهاد — وصل خدمة النقل للحجز ${esc(data.bookingNumber)}</footer>
  </main></body></html>`;
}

/** Pure builder (no auto-print script; the shared print dialog adds it). */
export function buildBookingTransportHtml(data: BookingTransportPrintData, size: "a4" | "80mm") {
  return size === "a4" ? a4Html(data) : thermalHtml(data);
}

/** Opens the shared print dialog with the A4 and 80mm transport slip formats. */
export function useBookingTransportPrint() {
  const { print } = usePrint();
  return (data: BookingTransportPrintData) =>
    print({
      documentLabel: `وصل نقل ${data.bookingNumber}`,
      formats: [
        { id: "a4", buildHtml: () => buildBookingTransportHtml(data, "a4") },
        { id: "thermal80", buildHtml: () => buildBookingTransportHtml(data, "80mm") },
      ],
    });
}
