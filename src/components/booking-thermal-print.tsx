import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bookingThermalLabelCss, printWhenImagesReadyScript } from "@/views/admin/print-helpers";

type BookingLike = {
  id?: number;
  number?: string | null;
  customerName?: string | null;
  phone?: string | null;
  eventDate?: string | null;
  raw?: unknown;
};

export type BookingThermalData = {
  bookingNumber: string;
  coupleName: string;
  eventDate: string;
  phone: string;
  bookingId?: number;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const escapeHtml = (value: unknown) => text(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

function storedValue(raw: any, keys: string[]) {
  const sources = [raw, raw?.bookingDetails, raw?.booking_details, raw?.customFields, raw?.custom_fields];
  for (const source of sources) for (const key of keys) if (text(source?.[key])) return text(source[key]);
  return "";
}

function eventDate(value: unknown) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]} / ${match[2]} / ${match[1]}` : text(value) || "غير محدد";
}

export function bookingThermalData(booking: BookingLike): BookingThermalData {
  const raw = booking.raw as any;
  const groom = storedValue(raw, ["groomName", "groom_name", "groom", "groomFullName", "husbandName"]);
  const bride = storedValue(raw, ["brideName", "bride_name", "bride", "brideFullName", "wifeName"]);
  const availableName = [groom, bride].filter(Boolean).join(" & ") || text(booking.customerName) || storedValue(raw, ["customerName", "customer_name", "name"]) || "غير مسجل";
  return {
    bookingId: booking.id,
    bookingNumber: text(booking.number) || storedValue(raw, ["trackingCode", "tracking_code", "invoiceNo", "invoice_no"]) || "غير مسجل",
    coupleName: availableName,
    eventDate: eventDate(booking.eventDate || storedValue(raw, ["eventDate", "event_date", "occasionDate", "occasion_date"])),
    phone: text(booking.phone) || storedValue(raw, ["phone", "primaryPhone", "primary_phone"]) || "غير مسجل",
  };
}

export function bookingThermalPrintHtml(data: BookingThermalData, paperSize: "58mm" | "80mm") {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ملصق ${escapeHtml(data.bookingNumber)}</title><style>${bookingThermalLabelCss(paperSize)}</style></head><body><main class="receipt booking-label" data-booking-id="${escapeHtml(data.bookingId)}"><header class="r-head"><div class="r-company">AJN</div><div class="label-title">ملصق الحجز</div></header><hr class="rule"><div class="kv"><span>رقم الفاتورة</span><b class="v booking-no num">${escapeHtml(data.bookingNumber)}</b></div><div class="kv"><span>اسم العرسان</span><b class="v couple">${escapeHtml(data.coupleName)}</b></div><div class="kv"><span>تاريخ المناسبة</span><b class="v event-date num">${escapeHtml(data.eventDate)}</b></div><div class="kv"><span>رقم الهاتف</span><b class="v phone num">${escapeHtml(data.phone)}</b></div><hr class="rule dashed"></main>${printWhenImagesReadyScript()}</body></html>`;
}

function ThermalPreview({ data, paperSize }: { data: BookingThermalData; paperSize: "58mm" | "80mm" }) {
  return <div className="mx-auto w-full rounded-md border border-black bg-white p-3 text-black shadow-sm" style={{ maxWidth: paperSize === "58mm" ? "58mm" : "80mm", fontFamily: "Cairo, Tahoma, Arial, sans-serif" }} dir="rtl"><div className="text-center"><b className="text-xl tracking-[0.12em]">AJN</b><p className="m-0 text-xs font-bold">ملصق الحجز</p></div><hr className="my-2 border-black" /><div className="space-y-2 text-xs font-bold"><div><span className="block text-[10px]">رقم الفاتورة</span><b dir="ltr" className="block text-right">{data.bookingNumber}</b></div><div><span className="block text-[10px]">اسم العرسان</span><b className="block text-sm leading-5">{data.coupleName}</b></div><div><span className="block text-[10px]">تاريخ المناسبة</span><b dir="ltr" className="block text-right">{data.eventDate}</b></div><div><span className="block text-[10px]">رقم الهاتف</span><b dir="ltr" className="block text-right">{data.phone}</b></div></div><hr className="my-2 border-dashed border-black" /></div>;
}

export function BookingThermalPrintAction({ booking, size = "sm", variant = "outline", className }: { booking: BookingLike; size?: ButtonProps["size"]; variant?: ButtonProps["variant"]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [paperSize, setPaperSize] = useState<"58mm" | "80mm">("58mm");
  const data = useMemo(() => bookingThermalData(booking), [booking]);
  const print = () => {
    const popup = window.open("", "_blank", "popup,width=420,height=620");
    if (!popup) { window.alert("تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى."); return; }
    popup.document.write(bookingThermalPrintHtml(data, paperSize));
    popup.document.close();
  };
  return <><Button type="button" size={size} variant={variant} className={className} onClick={() => setOpen(true)}><Printer className="h-4 w-4" /> طباعة ملصق</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>معاينة طباعة الحجز</DialogTitle><DialogDescription>ملصق تعريفي فقط؛ لا يتضمن أسعاراً أو دفعات.</DialogDescription></DialogHeader><div className="flex justify-center gap-2" role="group" aria-label="مقاس ورق الطباعة"><Button type="button" size="sm" variant={paperSize === "58mm" ? "default" : "outline"} onClick={() => setPaperSize("58mm")}>58mm</Button><Button type="button" size="sm" variant={paperSize === "80mm" ? "default" : "outline"} onClick={() => setPaperSize("80mm")}>80mm</Button></div><div className="max-h-[52dvh] overflow-auto rounded-lg bg-muted/40 p-5"><ThermalPreview data={data} paperSize={paperSize} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button type="button" onClick={print}><Printer className="h-4 w-4" /> طباعة</Button></DialogFooter></DialogContent></Dialog></>;
}
