import { usePrint } from "@/components/print/print-provider";
import { buildBrandedReceiptHtml, type BrandedReceiptSize } from "@/lib/branded-receipt";
import type { ReceiptBrand } from "@/lib/receipt-brand";
import { formatCurrency } from "@/lib/money";
import { clean, displayDate } from "@/components/booking-thermal-receipt";

/**
 * Transport slip (وصل خدمة النقل) for one booking: the AJN transport fee and its
 * details. Renders the SAVED transport values passed by the caller; it computes
 * nothing financial. A5 is the branded copy with signatures (and the WhatsApp
 * image), 80mm the driver slip.
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
  /** A standalone trip («نقل مستقل») is not a booking: its own number label, title and fee note. */
  numberLabel?: string;
  title?: string;
  feeNoteText?: string;
};

const feeNote = (data: BookingTransportPrintData) => data.feeNoteText ?? (data.inTotal ? "ضمن مبلغ الحجز" : "للعلم — غير مضافة إلى مبلغ الحجز");
const title = (data: BookingTransportPrintData) => data.title ?? "وصل خدمة النقل";
const numberLabel = (data: BookingTransportPrintData) => data.numberLabel ?? "رقم الحجز";
/** Parts on one line, each its own bidi isolate (FSI…PDI) so numbers keep their order. */
const oneLine = (...parts: unknown[]) => parts.map((part) => clean(part)).filter(Boolean).map((part) => `\u2068${part}\u2069`).join(" · ");

/** Pure builder (no auto-print script; the shared print dialog adds it). */
export function buildBookingTransportHtml(data: BookingTransportPrintData, size: BrandedReceiptSize, brand?: ReceiptBrand) {
  // 80mm: a short slip with related facts on one line; A5 keeps every fact on its own line.
  if (size !== "a5") return buildBrandedReceiptHtml({
    documentTitle: `وصل نقل ${data.bookingNumber}`,
    title: title(data),
    icon: "truck",
    compact: true,
    facts: [
      { label: numberLabel(data), value: data.bookingNumber, icon: "receipt" },
      { label: "العميل", value: oneLine(data.customerName, data.phone), icon: "user" },
      { label: "الموعد", value: oneLine(displayDate(data.eventDate), data.eventTime), icon: "calendar" },
      { label: "الموقع", value: data.location, icon: "pin" },
      { label: "السيارة", value: oneLine(...clean(data.vehicle).split(" · ")), icon: "car" },
      { label: "السائق", value: data.driver, icon: "id" },
    ],
    totals: [{ label: "أجرة النقل", value: formatCurrency(data.fee), tone: "strong" }],
    totalsNote: feeNote(data),
    notes: clean(data.note) || null,
  }, size, brand);
  return buildBrandedReceiptHtml({
    documentTitle: `وصل نقل ${data.bookingNumber}`,
    title: title(data),
    icon: "truck",
    facts: [
      { label: numberLabel(data), value: data.bookingNumber, icon: "receipt" },
      { label: "العميل", value: data.customerName, icon: "user" },
      { label: "الهاتف", value: data.phone, icon: "phone" },
      { label: "تاريخ المناسبة", value: displayDate(data.eventDate), icon: "calendar" },
      { label: "وقت المناسبة", value: data.eventTime, icon: "clock" },
      { label: "السيارة", value: data.vehicle, icon: "car" },
      { label: "السائق", value: data.driver, icon: "id" },
      { label: "الموقع", value: data.location, icon: "pin", wide: true },
    ],
    totals: [{ label: "أجرة النقل", value: formatCurrency(data.fee), tone: "strong" }],
    totalsNote: feeNote(data),
    notes: clean(data.note) || null,
    signatures: size === "a5" ? ["توقيع السائق", "توقيع المستلم"] : undefined,
  }, size, brand);
}

/** Opens the shared print dialog with the A5 (+ WhatsApp image) and 80mm transport slip. */
export function useBookingTransportPrint() {
  const { print } = usePrint();
  return (data: BookingTransportPrintData) =>
    print({
      documentLabel: `وصل نقل ${data.bookingNumber}`,
      formats: [
        { id: "a5", buildHtml: () => buildBookingTransportHtml(data, "a5"), imageName: `وصل نقل ${data.bookingNumber}` },
        { id: "thermal80", buildHtml: () => buildBookingTransportHtml(data, "80mm") },
      ],
    });
}
