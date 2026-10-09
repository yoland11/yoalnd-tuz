export type PreparationThermalItem = {
  department: string;
  name: string;
  required: number;
  available: number | null;
  status: string;
  assigneeName: string | null;
  note: string | null;
};

export type PreparationThermalInput = {
  bookingNumber: string;
  customerName: string;
  eventDate: string | null;
  location: string | null;
  items: PreparationThermalItem[];
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );

export function buildPreparationThermalHtml(input: PreparationThermalInput): string {
  const itemHtml = input.items.length
    ? input.items.map((item, index) => `
      <section class="item">
        <div class="item-head"><span class="item-index">${index + 1}</span><b>${escapeHtml(item.name)}</b></div>
        <div class="department">${escapeHtml(item.department)}</div>
        <div class="row"><span>الكمية المطلوبة</span><b class="num">${escapeHtml(item.required)}</b></div>
        ${item.available === null ? "" : `<div class="row"><span>المتاح</span><b class="num">${escapeHtml(item.available)}</b></div>`}
        <div class="row"><span>الحالة</span><b>${escapeHtml(item.status)}</b></div>
        ${item.assigneeName ? `<div class="row"><span>المسؤول</span><b>${escapeHtml(item.assigneeName)}</b></div>` : ""}
        ${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ""}
      </section>`).join("")
    : '<p class="empty">لا توجد عناصر تجهيز مرتبطة بهذا الحجز.</p>';

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قائمة تجهيز ${escapeHtml(input.bookingNumber)}</title><style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 80mm; max-width: 80mm; margin: 0; padding: 0; color: #111; background: #fff; direction: rtl; }
    body { font: 11px/1.5 Tahoma, Arial, sans-serif; }
    .receipt { width: 64mm; max-width: 64mm; margin: 0 auto; padding: 4mm 0 6mm; overflow-wrap: anywhere; word-break: break-word; }
    .brand { text-align: center; font-size: 18px; font-weight: 800; line-height: 1.2; }
    .title { text-align: center; font-size: 13px; font-weight: 800; margin: 1mm 0 2mm; }
    .rule { border-top: 1px dashed #555; margin: 2mm 0; }
    .meta-field { padding: 1mm 0; }
    .meta-field > span { display: block; color: #444; font-size: 10px; }
    .meta-field > b { display: block; max-width: 100%; text-align: right; font-size: 12px; overflow-wrap: anywhere; }
    .row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 2mm; margin: 1mm 0; }
    .row > span, .row > b { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
    .row > b { text-align: left; }
    .num, .code { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .code { text-align: right; word-break: break-all; }
    .item { border-top: 1px dashed #777; padding: 2mm 0; break-inside: avoid; page-break-inside: avoid; }
    .item-head { display: flex; align-items: flex-start; gap: 2mm; font-size: 12px; }
    .item-index { flex: 0 0 auto; font-weight: 800; }
    .item-head b { min-width: 0; overflow-wrap: anywhere; }
    .department { color: #444; font-size: 10px; margin: 0 0 1mm; }
    .note { margin-top: 1mm; border-right: 2px solid #555; padding-right: 2mm; white-space: pre-wrap; }
    .empty { text-align: center; margin: 5mm 0; }
    .footer { border-top: 1px dashed #555; margin-top: 2mm; padding-top: 2mm; text-align: center; }
  </style></head><body><main class="receipt">
    <div class="brand">AJN</div><div class="title">قائمة تجهيز الحجز</div><div class="rule"></div>
    <div class="meta-field"><span>رقم الحجز</span><b class="code">${escapeHtml(input.bookingNumber)}</b></div>
    <div class="meta-field"><span>العميل</span><b>${escapeHtml(input.customerName)}</b></div>
    <div class="meta-field"><span>تاريخ المناسبة</span><b class="num">${escapeHtml(input.eventDate || "الموعد غير محدد")}</b></div>
    ${input.location ? `<div class="meta-field"><span>الموقع</span><b>${escapeHtml(input.location)}</b></div>` : ""}
    <div class="rule"></div>${itemHtml}
    <div class="footer">عدد العناصر: <span class="num">${input.items.length}</span><br>مجموعة علي جان نهاد</div>
  </main></body></html>`;
}
