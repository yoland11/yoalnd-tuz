import { Receipt } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { usePrint } from "@/components/print/print-provider";
import { buildBrandedReceiptHtml, type BrandedReceiptDoc, type BrandedReceiptSize } from "@/lib/branded-receipt";
import type { ReceiptBrand } from "@/lib/receipt-brand";
import { formatCurrency } from "@/lib/money";
import { paymentLabels } from "@/lib/kosha-manager";

/**
 * Booking Center RECEIPT (وصل حجز): the branded A5 page (+ WhatsApp image) and
 * the 80mm thermal slip, both from the shared template in
 * src/lib/branded-receipt.ts. It is NOT the A4 wedding invoice scaled/zoomed
 * down, and shares no physical layout with it. It only RENDERS
 * authoritative Booking Center values passed in by the caller (total, paid,
 * remaining and the authoritative payment status); it performs no financial
 * calculation and no reconciliation.
 *
 * The protected A4 invoice (invoice.tsx / luxuryWeddingInvoiceCss) is a separate
 * template reached from its own button — this component never touches it.
 */

export type BookingThermalReceiptData = {
  bookingNumber: string;
  contractNumber?: string | null;
  customerName?: string | null;
  phone?: string | null;
  /** Pre-joined service label(s), e.g. "كوشة · تصوير". */
  service?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  location?: string | null;
  /** Authoritative amounts — displayed as-is, never recomputed here. */
  total: number;
  paid: number;
  remaining: number;
  /** Authoritative payment-status code (paid | partial | unpaid | pending_pricing | …). */
  paymentStatus?: string | null;
  notes?: string | null;
  companyPhone?: string | null;
};

export const clean = (value: unknown) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

export const esc = (value: unknown) =>
  clean(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );

/** Display-only date tidy: YYYY-MM-DD → DD / MM / YYYY; otherwise passes through. */
export function displayDate(value: unknown) {
  const raw = clean(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]} / ${match[2]} / ${match[1]}` : raw;
}

function bookingReceiptDoc(data: BookingThermalReceiptData): BrandedReceiptDoc {
  const statusLabel = data.paymentStatus ? paymentLabels[data.paymentStatus] ?? data.paymentStatus : "";
  return {
    documentTitle: `وصل حجز ${data.bookingNumber}`,
    title: "وصل حجز",
    icon: "receipt",
    // A booking still waiting for its price must not read as a settled amount.
    state: data.paymentStatus === "pending_pricing" ? { text: "الحجز بانتظار التسعير — المبالغ غير نهائية" } : null,
    facts: [
      { label: "رقم الحجز", value: data.bookingNumber, icon: "receipt" },
      { label: "رقم العقد", value: data.contractNumber, icon: "hash" },
      { label: "العميل", value: data.customerName, icon: "user" },
      { label: "الهاتف", value: data.phone, icon: "phone" },
      { label: "الخدمة", value: data.service, icon: "layers" },
      { label: "تاريخ المناسبة", value: displayDate(data.eventDate), icon: "calendar" },
      { label: "وقت المناسبة", value: data.eventTime, icon: "clock" },
      { label: "حالة الدفع", value: statusLabel, icon: "wallet" },
      { label: "الموقع", value: data.location, icon: "pin", wide: true },
    ],
    totals: [
      { label: "الإجمالي", value: formatCurrency(data.total) },
      { label: "المدفوع", value: formatCurrency(data.paid) },
      { label: "المتبقي", value: formatCurrency(data.remaining), tone: "due" },
    ],
    notes: data.notes,
  };
}

/**
 * Pure builder: the complete standalone booking receipt — the branded A5 page or
 * the 80mm thermal slip — WITHOUT an auto-print script (the print dialog adds it).
 */
export function buildBookingReceiptHtml(data: BookingThermalReceiptData, size: BrandedReceiptSize, brand?: ReceiptBrand): string {
  return buildBrandedReceiptHtml(bookingReceiptDoc(data), size, brand);
}

/** The 80mm booking receipt (kept for existing callers). */
export function buildBookingThermalReceiptHtml(data: BookingThermalReceiptData, brand?: ReceiptBrand): string {
  return buildBookingReceiptHtml(data, "80mm", brand);
}

/**
 * Booking Center action button: opens the shared print dialog with a single
 * 80mm thermal format (skips the size picker, shows a preview, then prints).
 * The A4 invoice remains its own separate action, so the two paper formats are
 * both available and the A4 output is completely unaffected.
 */
/** Opens the shared print dialog with the A5 (+ WhatsApp image) and 80mm booking receipt. */
export function useBookingThermalReceiptPrint() {
  const { print } = usePrint();
  return (data: BookingThermalReceiptData) =>
    print({
      documentLabel: `وصل حجز ${data.bookingNumber}`,
      formats: [
        { id: "a5", buildHtml: () => buildBookingReceiptHtml(data, "a5"), imageName: `وصل حجز ${data.bookingNumber}` },
        { id: "thermal80", buildHtml: () => buildBookingReceiptHtml(data, "80mm") },
      ],
    });
}

export function BookingThermalReceiptAction({
  data,
  size = "sm",
  variant = "outline",
  className,
}: {
  data: BookingThermalReceiptData;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const printReceipt = useBookingThermalReceiptPrint();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={() => printReceipt(data)}
    >
      <Receipt className="h-4 w-4" /> وصل الحجز
    </Button>
  );
}
