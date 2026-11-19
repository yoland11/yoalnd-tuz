import { buildBookingReceiptHtml } from "@/components/booking-thermal-receipt";
import { buildBrandedReceiptHtml } from "./branded-receipt";
import { preparationDepartmentLabel } from "./preparation-departments";
import { bookingShareServiceLabel, type ShareBooking } from "./booking-share";

export type SharePreparation = {
  source: "service" | "kosha"; id: number;
  items: Array<{ name: string; department: string; required: number; sku: string | null; status: string; preparationState: string | null; infoOnly: boolean; stockIssued: boolean }>;
};
export function bookingShareContractNumber(booking: ShareBooking): string | null {
  const value = booking.raw?.customFields?.contractNumber ?? booking.raw?.contractNumber ?? booking.raw?.customFields?.contractNo;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

// The canvas capture needs extra Arabic descender room inside clipped pills,
// totals and table borders. Scope it to outbound images; original print layouts stay intact.
function imageCaptureHtml(html: string) {
  return html.replace('<div class="ajn-r ajn-r--a5" dir="rtl" lang="ar">', '<div class="ajn-r ajn-r--a5 ajn-r--booking-attachment-image" dir="rtl" lang="ar"><style>.ajn-r.ajn-r--booking-attachment-image{line-height:1.8}.ajn-r.ajn-r--booking-attachment-image .pill-in{line-height:1.8;padding-top:2.5mm;padding-bottom:2.5mm}.ajn-r.ajn-r--booking-attachment-image .brand-name{line-height:1.5}.ajn-r.ajn-r--booking-attachment-image .thanks span{line-height:1.8;padding-top:2mm;padding-bottom:2mm}.ajn-r.ajn-r--booking-attachment-image .trow{line-height:1.9;padding-top:2mm;padding-bottom:3mm;align-items:center}.ajn-r.ajn-r--booking-attachment-image .items td,.ajn-r.ajn-r--booking-attachment-image .items th{line-height:1.8;padding-top:2mm;padding-bottom:2mm}.ajn-r.ajn-r--booking-attachment-image .item small{line-height:1.9;padding-bottom:1mm}</style>');
}

/** Validate the original authorized checklist and copy only outward-facing fields. */
export function bookingSharePreparation(booking: Pick<ShareBooking, "source" | "id">, input: unknown): SharePreparation {
  const data = input as Record<string, any> | null;
  if (!data || data.source !== booking.source || Number(data.id) !== booking.id || !Array.isArray(data.items)) throw Error("تعذر قراءة قائمة التجهيز الأصلية لهذا الحجز");
  return { source: booking.source, id: booking.id, items: data.items.map((item: any) => {
    if (!item || typeof item.name !== "string" || !item.name.trim() || !["number", "string"].includes(typeof item.required) || String(item.required).trim() === "" || !Number.isFinite(Number(item.required)) || Number(item.required) < 0) throw Error("تعذر قراءة اسم أو كمية عنصر في قائمة التجهيز");
    return { name: item.name.trim(), required: Number(item.required), department: typeof item.department === "string" ? item.department : "other", sku: typeof item.sku === "string" ? item.sku : null, status: typeof item.status === "string" ? item.status : "", preparationState: typeof item.preparationState === "string" ? item.preparationState : null, infoOnly: item.infoOnly === true, stockIssued: item.stockIssued === true };
  }) };
}

/** Reuse the unchanged original A5 booking receipt; the caller passes canonical money. */
export function bookingShareReceiptHtml(booking: ShareBooking, note: string) {
  if ([booking.total, booking.paid, booking.remaining].some(value => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) throw Error("تعذر قراءة المبالغ المعتمدة لصورة الوصل");
  return imageCaptureHtml(buildBookingReceiptHtml({ bookingNumber: booking.number, contractNumber: bookingShareContractNumber(booking), customerName: booking.customerName, phone: booking.phone, service: booking.services.map(service => bookingShareServiceLabel(service.type)).join(" · "), eventDate: booking.eventDate, eventTime: booking.eventTime, location: booking.hall, total: booking.total, paid: booking.paid, remaining: booking.remaining, paymentStatus: booking.paymentStatus, notes: note.trim() || null }, "a5"));
}

const CHECKLIST_STATUS: Record<string, string> = { ready: "مسجل كجاهز", preparing: "قيد التجهيز", shortage: "ناقص", needs_purchase: "يحتاج شراء", reserved_elsewhere: "محجوز لحجز آخر", damaged: "تالف", lost: "مفقود", unavailable: "غير متوفر", note: "للعلم", completed: "مكتمل" };
const PREPARED: Record<string, string> = { ...CHECKLIST_STATUS, ready: "جاهز", in_progress: "قيد التجهيز" };

/** One source, bounded image pages. Stock availability is never asserted as preparation evidence. */
export function bookingSharePreparationHtml(booking: ShareBooking, input: SharePreparation): string[] {
  const preparation = bookingSharePreparation(booking, input), count = Math.max(1, Math.ceil(preparation.items.length / 12));
  return Array.from({ length: count }, (_, page) => imageCaptureHtml(buildBrandedReceiptHtml({
    documentTitle: `قائمة التجهيز ${booking.number}`, title: "قائمة التجهيز", icon: "box", hideQr: true,
    copyLabel: count > 1 ? `الجزء ${page + 1} من ${count}` : null,
    facts: [{ label: "رقم الحجز", value: booking.number }, { label: "الزبون", value: booking.customerName }, { label: "تاريخ المناسبة", value: booking.eventDate || "غير محدد" }, { label: "الوقت", value: booking.eventTime || "غير محدد" }, { label: "المكان", value: booking.hall || "غير محدد", wide: true }],
    items: { columns: [{ key: "name", label: "العنصر", role: "name" }, { key: "quantity", label: "المطلوب", role: "number" }, { key: "prepared", label: "التجهيز المسجل", role: "text" }], empty: "لا توجد عناصر تجهيز مرتبطة بهذا الحجز", rows: preparation.items.slice(page * 12, (page + 1) * 12).map(item => ({ cells: { name: item.name, quantity: item.required, prepared: item.infoOnly ? "للعلم" : PREPARED[item.preparationState || ""] || item.preparationState || "لم يُؤكّد التجهيز" }, sub: [preparationDepartmentLabel(item.department), item.sku, `حالة القائمة: ${CHECKLIST_STATUS[item.status] || item.status || "غير محددة"}`, item.stockIssued ? "تم الصرف من المخزون" : null].filter(Boolean).join(" · ") })) },
    footNote: "قائمة الحجز الأصلية — مشاركة القائمة لا تؤكد التجهيز ولا تنشئ حركة مخزون.",
  }, "a5")));
}

export function bookingShareFileLabel(name: string, index: number) {
  if (name.endsWith("-receipt.png")) return "صورة وصل الحجز";
  const preparation = name.match(/-preparation-(\d+)\.png$/);
  return preparation ? `قائمة التجهيز — الجزء ${preparation[1]}` : `تفاصيل الحجز وصور المحجوزات — الجزء ${index + 1}`;
}
