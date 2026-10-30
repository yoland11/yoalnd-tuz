import {
  bookingCountLabel,
  bookingStatusLabel,
  eventServicesLabel,
  formatEventTime,
  formatLongDay,
  summarizeCalendarDay,
  summarizeCalendarRange,
  type BookingCalendarEvent,
  type CalendarCardFilters,
  filterCalendarCards,
} from "./booking-calendar";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

export type BookingSchedulePrintInput = {
  title: string;
  rangeLabel: string;
  days: readonly string[];
  events: readonly BookingCalendarEvent[];
  filters: CalendarCardFilters;
  /** Spelled out on paper: what the listed bookings were narrowed to. */
  filterNote?: string | null;
  generatedAt: string;
};

/** Printable day or week schedule. A document only: printing writes nothing. */
export function buildBookingSchedulePrintHtml(input: BookingSchedulePrintInput): string {
  const range = summarizeCalendarRange(input.days, input.events, input.filters.status);
  const chips = [
    `<span>إجمالي الحجوزات: <b>${range.total}</b></span>`,
    ...range.departments.map((row) => `<span>${escapeHtml(row.label)}: <b>${row.bookings}</b></span>`),
  ].join("");
  const sections = input.days
    .map((day) => {
      const summary = summarizeCalendarDay(day, input.events, input.filters.status);
      const cards = filterCalendarCards(input.events.filter((event) => event.day === day), input.filters);
      const counters = summary.departments.map((row) => `${escapeHtml(row.label)} ${row.bookings}`).join(" · ");
      const body = cards.length
        ? `<table><thead><tr><th>الوقت</th><th>العميل</th><th>رقم الحجز</th><th>الخدمات</th><th>الموقع</th><th>الحالة</th></tr></thead><tbody>${cards
            .map(
              (event) =>
                `<tr><td class="num">${escapeHtml(formatEventTime(event))}</td><td>${escapeHtml(event.customerName)}</td><td class="num" dir="ltr">${escapeHtml(event.number)}</td><td>${escapeHtml(eventServicesLabel(event))}</td><td>${escapeHtml(event.location)}</td><td>${escapeHtml(bookingStatusLabel(event.status))}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : `<p class="empty">${summary.total ? "لا حجوزات مطابقة للتصفية" : "لا توجد حجوزات"}</p>`;
      return `<section class="day"><h2>${escapeHtml(formatLongDay(day))} <small>${escapeHtml(bookingCountLabel(summary.total))}</small></h2>${counters ? `<p class="counters">${counters}</p>` : ""}${body}</section>`;
    })
    .join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="color-scheme" content="light">
    <title>${escapeHtml(input.title)}</title>
    <style>
      @page{size:A4;margin:12mm;}
      *{box-sizing:border-box;}
      body{font-family:'Segoe UI',Tahoma,sans-serif;color:#111;background:#fff;margin:0;padding:16px;}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px;}
      .head h1{margin:0;font-size:19px;}
      .head small{color:#555;}
      .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;font-size:12px;}
      .chips span{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:3px 8px;}
      .note{margin-bottom:10px;color:#555;font-size:12px;}
      .day{margin-bottom:16px;}
      .day h2{font-size:14px;margin:0 0 4px;padding:5px 8px;background:#f3f4f6;border-radius:4px;}
      .day h2 small{font-weight:400;color:#555;margin-inline-start:6px;}
      .counters{margin:0 0 6px;font-size:12px;color:#333;}
      table{width:100%;border-collapse:collapse;font-size:11.5px;}
      th,td{border:1px solid #e5e7eb;padding:5px 6px;text-align:right;vertical-align:top;}
      thead th{background:#111;color:#fff;font-weight:600;}
      .num{font-variant-numeric:tabular-nums;white-space:nowrap;}
      .empty{margin:0;padding:6px 8px;color:#777;font-size:12px;}
      tr{page-break-inside:avoid;}
      h2{page-break-after:avoid;}
      @media print{body{padding:0;}}
    </style></head>
    <body>
      <div class="head">
        <div><h1>${escapeHtml(input.title)}</h1><small>${escapeHtml(input.rangeLabel)}</small></div>
        <div style="text-align:left"><small>تاريخ الطباعة</small><br><b>${escapeHtml(input.generatedAt)}</b></div>
      </div>
      <div class="chips">${chips}</div>
      ${input.filterNote ? `<p class="note">${escapeHtml(input.filterNote)}</p>` : ""}
      ${sections}
    </body></html>`;
}
