import { Receipt } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { usePrint } from "@/components/print/print-provider";
import { thermalReceiptCss } from "@/views/admin/print-helpers";
import { formatCurrency } from "@/lib/money";
import { paymentLabels } from "@/lib/kosha-manager";

/**
 * Dedicated Booking Center 80mm thermal RECEIPT (وصل حجز).
 *
 * This is a genuine vertical thermal layout built on the from-scratch
 * `thermalReceiptCss("80mm")` stylesheet — it is NOT the A4 wedding invoice
 * scaled/zoomed down, and shares no physical layout with it. It only RENDERS
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

const clean = (value: unknown) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

const esc = (value: unknown) =>
  clean(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );

/** Display-only date tidy: YYYY-MM-DD → DD / MM / YYYY; otherwise passes through. */
function displayDate(value: unknown) {
  const raw = clean(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]} / ${match[2]} / ${match[1]}` : raw;
}

/**
 * Pure builder: the complete standalone 80mm booking-receipt document, WITHOUT
 * an auto-print script (the shared print dialog adds it at print time).
 */
export function buildBookingThermalReceiptHtml(data: BookingThermalReceiptData): string {
  const kv = (label: string, value: unknown, opts: { num?: boolean; big?: boolean } = {}) => {
    const text = clean(value);
    if (!text) return "";
    const cls = `v${opts.num ? " num" : ""}${opts.big ? " big" : ""}`;
    return `<div class="kv"><span>${esc(label)}</span><b class="${cls}">${esc(text)}</b></div>`;
  };
  const statusLabel = data.paymentStatus ? paymentLabels[data.paymentStatus] ?? data.paymentStatus : "";
  const printedAt = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short" }).format(new Date());

  const body = `<div class="receipt booking-receipt">
    <div class="r-head">
      <div class="r-company">AJN — مجموعة علي جان نهاد</div>
      <div class="r-sub">لتنظيم المناسبات</div>
      <div class="r-sub">وصل حجز</div>
    </div>
    <hr class="rule">
    ${kv("رقم الحجز", data.bookingNumber, { num: true, big: true })}
    ${kv("رقم العقد", data.contractNumber, { num: true })}
    ${kv("تاريخ الطباعة", printedAt, { num: true })}
    <hr class="rule dashed">
    ${kv("العميل", data.customerName)}
    ${kv("الهاتف", data.phone, { num: true })}
    <hr class="rule dashed">
    ${kv("الخدمة", data.service)}
    ${kv("تاريخ المناسبة", displayDate(data.eventDate), { num: true })}
    ${kv("وقت المناسبة", data.eventTime, { num: true })}
    ${kv("الموقع", data.location)}
    <hr class="rule">
    <div class="grand"><span>الإجمالي</span><span class="num">${esc(formatCurrency(data.total))}</span></div>
    <div class="payline"><span>المدفوع</span><span class="num">${esc(formatCurrency(data.paid))}</span></div>
    <div class="payline remain"><span>المتبقي</span><span class="num">${esc(formatCurrency(data.remaining))}</span></div>
    ${statusLabel ? `<div class="kv"><span>حالة الدفع</span><b class="v">${esc(statusLabel)}</b></div>` : ""}
    ${clean(data.notes) ? `<hr class="rule dashed"><div class="kv note"><span>ملاحظات</span><b class="v">${esc(data.notes)}</b></div>` : ""}
    <hr class="rule dashed">
    <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
    ${clean(data.companyPhone) ? `<div class="r-sub center num">${esc(data.companyPhone)}</div>` : ""}
  </div>`;

  const extraCss = `
    .booking-receipt .kv { align-items: baseline; }
    .booking-receipt .kv .v { max-width: 62%; overflow-wrap: anywhere; }
    .booking-receipt .kv.note { display: block; }
    .booking-receipt .kv.note .v { display: block; max-width: 100%; text-align: right; margin-top: 2px; }
    .booking-receipt .grand span:first-child,
    .booking-receipt .payline span:first-child { font-weight: 800; }
  `;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>وصل حجز ${esc(data.bookingNumber)}</title><style>${thermalReceiptCss("80mm")}${extraCss}</style></head><body>${body}</body></html>`;
}

/**
 * Booking Center action button: opens the shared print dialog with a single
 * 80mm thermal format (skips the size picker, shows a preview, then prints).
 * The A4 invoice remains its own separate action, so the two paper formats are
 * both available and the A4 output is completely unaffected.
 */
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
  const { print } = usePrint();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={() =>
        print({
          documentLabel: `وصل حجز ${data.bookingNumber}`,
          formats: [{ id: "thermal80", buildHtml: () => buildBookingThermalReceiptHtml(data) }],
        })
      }
    >
      <Receipt className="h-4 w-4" /> وصل حراري 80mm
    </Button>
  );
}
