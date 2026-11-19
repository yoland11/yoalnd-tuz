import { buildBrandedReceiptHtml, receiptEsc, receiptImageSrc } from "./branded-receipt";
import { bookingEventTypeLabel, readBookingEventType } from "./booking-event-types";
import { bookingWorkspacePhotos, type BookingWorkspacePhoto } from "./booking-workspace-photos";
import { formatCurrency } from "./money";
import { toWhatsAppPhone } from "./phone";

export type ShareBooking = {
  source: "service" | "kosha"; id: number; number: string; customerName: string; phone: string;
  eventDate: string; eventTime: string; eventType?: unknown; hall: string; status: string;
  total: number; paid: number; remaining: number; paymentStatus: string;
  services: Array<{ type: string }>; raw: Record<string, any>;
  bookedItems?: Array<Record<string, unknown>>;
};
export type SharePhoto = BookingWorkspacePhoto;
export type PreparedSharePhoto = SharePhoto & { dataUrl: string };
export type ShareFinancialSummary = { source: string; id: number; finalTotal: number; paid: number; remaining: number; paymentStatus: string };
const SERVICES: Record<string, string> = { kosha: "الكوشة", photography: "التصوير", sound: "الصوتيات", flowers: "الورد", gifts: "الهدايا", graduation: "التخرج", led: "شاشات LED", transportation: "النقل", decorations: "الديكور" };
export const bookingShareServiceLabel = (type: string) => SERVICES[type] || type;

/** Map the existing canonical read. Do not reconstruct balances or trust card snapshots. */
export function bookingShareWithFinancialSummary(booking: ShareBooking, input: unknown): ShareBooking {
  const summary = input as ShareFinancialSummary | undefined;
  if (!summary || summary.source !== booking.source || Number(summary.id) !== booking.id || typeof summary.paymentStatus !== "string" || !summary.paymentStatus || [summary.finalTotal, summary.paid, summary.remaining].some(value => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) throw Error("تعذر قراءة الملخص المالي المعتمد للحجز");
  return { ...booking, total: Number(summary.finalTotal), paid: Number(summary.paid), remaining: Number(summary.remaining), paymentStatus: summary.paymentStatus };
}

function details(booking: ShareBooking, financial: boolean) {
  const facts = [
    { label: "رقم الحجز", value: booking.number }, { label: "الزبون", value: booking.customerName },
    { label: "الهاتف", value: booking.phone },
    { label: "نوع المناسبة", value: bookingEventTypeLabel(booking.eventType ?? readBookingEventType(booking.source, booking.raw)) },
    { label: "التاريخ", value: booking.eventDate || "غير محدد" }, { label: "الوقت", value: booking.eventTime || "غير محدد" },
    { label: "المكان", value: booking.hall || "غير محدد", wide: true },
    { label: "المحجوزات", value: booking.services.map(service => SERVICES[service.type] || service.type).join(" · ") || "غير محدد", wide: true },
  ];
  if (financial) {
    if ([booking.total, booking.paid, booking.remaining].some(value => value == null || !Number.isFinite(Number(value)) || Number(value) < 0)) throw Error("تعذر قراءة المعلومات المالية للحجز");
    facts.push({ label: "الإجمالي", value: formatCurrency(booking.total) }, { label: "المدفوع المعتمد", value: formatCurrency(booking.paid) }, { label: "المتبقي", value: formatCurrency(booking.remaining) });
  }
  return facts;
}

export function bookingShareText(booking: ShareBooking, financial: boolean, note: string) {
  const items = bookingShareItems(booking);
  return ["مجموعة علي جان نهاد — تفاصيل الحجز", ...details(booking, financial).map(fact => `${fact.label}: ${fact.value}`), ...(items.length ? ["تفاصيل المحجوزات:", ...items] : []), ...(note.trim() ? [`ملاحظة: ${note.trim()}`] : [])].join("\n");
}

/** Original line names/quantities only. No prices, costs, generic notes or identifiers. */
export function bookingShareItems(booking: ShareBooking): string[] {
  const fields = (booking.source === "kosha" ? booking.raw.bookingDetails : booking.raw.customFields) || {};
  const canonical = (booking.bookedItems || []).filter(row => row.status !== "released");
  const identity = (row: Record<string, unknown>) => row.productId ? `${row.productId}:${row.variantId ?? 0}` : null;
  const current = new Set(canonical.map(identity).filter(Boolean));
  const lines: string[] = [];
  function add(rows: unknown, group: string, snapshot = false) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object" || row.status === "released" || (snapshot && current.has(identity(row)))) continue;
      const name = String(row.productName || row.name || "صنف محجوز").trim();
      const quantity = row.quantity == null ? "كمية غير محددة" : String(row.quantity).trim();
      if (row.quantity != null && (!quantity || !Number.isFinite(Number(quantity)) || Number(quantity) < 0)) throw Error(`تعذر قراءة كمية ${name}`);
      lines.push(`${group}: ${name}${row.variantLabel ? ` — ${String(row.variantLabel)}` : ""} × ${quantity}${row.unit ? ` ${String(row.unit)}` : ""}`);
    }
  }
  if (fields.koshaSelection?.name) lines.push(`الكوشة المحجوزة: ${String(fields.koshaSelection.name)}`);
  add(canonical, "تجهيزات الحجز");
  for (const [key, group] of [["flowerItems", "الورد"], ["giftItems", "الهدايا"], ["soundItems", "الصوتيات"], ["videoItems", "الفيديو"], ["photographyItems", "التصوير"]]) add(fields[key], group, true);
  add(booking.raw.serviceItems, "خدمات الحجز", true);
  add(booking.raw.items, "المواد المحجوزة", true);
  return lines;
}

/** Booked/reference photos only. No execution photos, group gallery or public tracking links. */
export function bookingSharePhotos(booking: ShareBooking, kosha?: { name: string; imageUrl: string | null } | null): SharePhoto[] {
  const candidates = [
    ...(kosha?.imageUrl ? [{ key: "booked-kosha", name: kosha.name, label: "الكوشة المحجوزة", url: kosha.imageUrl }] : []),
    ...bookingWorkspacePhotos(booking.source, booking.raw, kosha?.imageUrl),
    ...[{ origin: "reservation", rows: booking.bookedItems || [] }, { origin: "native", rows: Array.isArray(booking.raw.items) ? booking.raw.items : [] }].flatMap(({ origin, rows }) => rows.flatMap((row: Record<string, any>, index: number) => row && row.status !== "released" && typeof row.imageUrl === "string" && row.imageUrl.trim() ? [{ key: `booked-item:${origin}:${row.id ?? `${row.productId ?? "legacy"}:${row.variantId ?? 0}:${index}`}`, name: String(row.productName || row.name || "صنف محجوز"), label: "المنتج المحجوز", url: row.imageUrl.trim() }] : [])),
  ];
  const seen = new Set<string>();
  return candidates.filter(photo => { if (seen.has(photo.url)) return false; seen.add(photo.url); return true; });
}

export function bookingSharePhotoPages<T>(photos: readonly T[]): T[][] {
  if (!photos.length) return [[]];
  return Array.from({ length: Math.ceil(photos.length / 4) }, (_, index) => photos.slice(index * 4, index * 4 + 4));
}

/** Same existing A5 image renderer, with full booked pictures instead of tiny item thumbnails. */
export function bookingShareCardHtml(booking: ShareBooking, financial: boolean, note: string, photos: readonly PreparedSharePhoto[], page: number, count: number) {
  const html = buildBrandedReceiptHtml({ documentTitle: `تفاصيل الحجز ${booking.number}`, title: "تفاصيل الحجز والمحجوزات", hideQr: true,
    state: financial && booking.paymentStatus === "pending_pricing" ? { text: "الحجز بانتظار التسعير — المبالغ غير نهائية" } : null,
    copyLabel: count > 1 ? `الجزء ${page} من ${count}` : null,
    facts: details(booking, financial), notes: note.trim() || null,
    sections: [{ title: "تفاصيل المحجوزات", text: bookingShareItems(booking).slice((page - 1) * 20, page * 20).join("\n") }],
    footNote: financial ? "المبالغ من الحجز الأصلي — ليست إيصال قبض جديداً" : "نسخة تفاصيل تشغيلية للحجز",
  }, "a5");
  const pictures = photos.map(photo => {
    const image = receiptImageSrc(photo.dataUrl);
    if (!image?.startsWith("data:image/")) throw Error(`تعذر تجهيز صورة ${photo.name}`);
    return `<figure style="margin:0;min-width:0;border:1px solid #dcc58a;border-radius:6px;padding:6px"><div style="display:flex;align-items:center;justify-content:center;height:${photos.length === 1 ? "82mm" : "58mm"}"><img src="${receiptEsc(image)}" alt="${receiptEsc(photo.name)}" style="display:block;width:auto;height:auto;max-width:100%;max-height:100%"></div><figcaption style="margin-top:4px;font-weight:700;text-align:center">${receiptEsc(photo.name)}</figcaption></figure>`;
  }).join("");
  return html.replace('<footer class="foot">', `${pictures ? `<section aria-label="صور المحجوزات" style="display:grid;grid-template-columns:repeat(${photos.length === 1 ? 1 : 2},minmax(0,1fr));gap:8px;margin:10px 0">${pictures}</section>` : ""}<footer class="foot">`).replace('<div class="ajn-r ajn-r--a5" dir="rtl" lang="ar">', '<div class="ajn-r ajn-r--a5 ajn-r--booking-share" dir="rtl" lang="ar"><style>.ajn-r.ajn-r--booking-share .pill-in{line-height:1.8;padding-top:2.5mm;padding-bottom:2.5mm}.ajn-r.ajn-r--booking-share .brand-name{line-height:1.5}.ajn-r.ajn-r--booking-share .thanks span{line-height:1.8;padding-top:2mm;padding-bottom:2mm}</style>');
}

export function bookingShareWhatsAppHref(phone: string, text: string): string | null {
  const normalized = toWhatsAppPhone(phone);
  return normalized ? `https://wa.me/${normalized}?text=${encodeURIComponent(text)}` : null;
}
