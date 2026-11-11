import { Button } from "@/components/ui/button";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRoute, useSearch } from "wouter";
import { ArrowRight, Building2, CalendarCheck, CalendarDays, CircleCheck, Clock3, CreditCard, Download, FileText, Hash, Heart, Hourglass, Loader2, Mail, MapPin, Phone, Printer, ScrollText, ShieldCheck, Star, Truck, User, UserRound, Users, type LucideIcon, Layers } from "lucide-react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { toast } from "sonner";
import { adminFetch, fetchAdminMe, hasPerm } from "./_lib";
import { formatIraqiPhone } from "@/lib/phone";
import { handleDefaultLogoError, logoSrc, usePublicSettings, type PublicSettings } from "@/lib/public-settings";
import { downloadElementPdf } from "@/lib/pdf";
import { shortBookingNumber } from "@/lib/booking-number";
import { luxuryWeddingInvoiceCss, printDocumentWhenImagesReady } from "./print-helpers";
import { formatCurrency } from "@/lib/money";

type InvoiceData = Record<string, any>;
type InvoiceItem = {
  id?: string | number; name: string; category: string; description: string; color: string; quantity: number; unitPrice: number; discount: number; subtotal: number;
  /** Section the line prints under (services, products, assets…). */
  group?: string;
  /** Part of the booking without its own price; `includedLabel` says where its money is. */
  included?: boolean; includedLabel?: string;
};

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (...values: unknown[]) => values.map((value) => String(value ?? "").trim()).find(Boolean) || "—";
const dateText = (value: unknown) => {
  const raw = String(value ?? "").trim(); if (!raw) return "—";
  const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("ar-IQ-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
};
const timeText = (value: unknown) => {
  const raw = String(value ?? "").trim(); if (!raw) return "—";
  const parsed = new Date(raw); return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleTimeString("ar-IQ-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
};

export default function Invoice() {
  const [, params] = useRoute("/admin/invoice/:id");
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const requestedType = searchParams.get("type");
  const type = requestedType === "kosha" ? "kosha" : requestedType === "booking" ? "booking" : "order";
  const autoPrint = searchParams.get("print") === "1";
  const autoDownload = searchParams.get("pdf") === "1";
  const id = params?.id ? Number(params.id) : 0;
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [websiteQr, setWebsiteQr] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);
  const autoPrintStarted = useRef(false);
  const autoDownloadStarted = useRef(false);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await fetchAdminMe();
      if (!alive) return;
      if (!me || !hasPerm(me, type === "kosha" ? "orders" : "invoices")) { window.location.href = "/admin/login"; return; }
      if (!id) { setLoading(false); return; }
      try { const result = await adminFetch(`/admin/invoices/${id}?type=${type}`); if (alive) setData(result as InvoiceData); }
      catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id, type]);

  // Short, readable booking number for bookings (store orders keep their code).
  const displayNumber = data
    ? type === "kosha"
      ? shortBookingNumber("kosha", data.id, data.trackingCode)
      : type === "booking"
        ? shortBookingNumber("service", data.id, data.trackingCode)
        : ""
    : "";
  useEffect(() => { if (data) document.title = `فاتورة ${displayNumber || data.trackingCode || data.id}`; }, [data, displayNumber]);
  useEffect(() => {
    let active = true;
    const target = settings?.website || (typeof window !== "undefined" ? window.location.origin : "");
    if (!target) return;
    QRCode.toDataURL(target, { width: 220, margin: 1, color: { dark: "#2a0710", light: "#ffffff" } }).then((value) => { if (active) setWebsiteQr(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [settings?.website]);

  const model = useMemo(() => data ? invoiceModel(data) : null, [data]);
  const pdfSheet = () => sheetRef.current?.querySelector<HTMLElement>(".wedding-invoice-bleed") ?? sheetRef.current;

  useEffect(() => {
    if (!autoPrint || !data || !model || !sheetRef.current || autoPrintStarted.current) return;
    autoPrintStarted.current = true;
    const timer = window.setTimeout(() => void printDocumentWhenImagesReady(sheetRef.current || document), 120);
    return () => window.clearTimeout(timer);
  }, [autoPrint, data, model]);

  useEffect(() => {
    if (!autoDownload || !data || !model || !sheetRef.current || autoDownloadStarted.current) return;
    autoDownloadStarted.current = true;
    const timer = window.setTimeout(() => void downloadPdf(), 180);
    return () => window.clearTimeout(timer);
  }, [autoDownload, data, model]);

  async function downloadPdf() {
    const sheet = pdfSheet();
    if (!sheet || !data) return;
    setDownloading(true);
    try { await downloadElementPdf(sheet, `ajn-event-invoice-${displayNumber || data.trackingCode || data.id}.pdf`, { format: [216, 303], margin: 0, scale: 3.125, pagebreakMode: ["css", "legacy"] }); toast.success("تم حفظ ملف PDF كاملاً"); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "تعذر إنشاء ملف PDF"); }
    finally { setDownloading(false); }
  }

  if (loading) return <div className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground" dir="rtl"><Loader2 className="h-5 w-5 animate-spin" />جارٍ تحميل الفاتورة…</div>;
  if (error || !data || !model) return <div className="flex min-h-dvh items-center justify-center text-muted-foreground" dir="rtl">{error || (type === "kosha" ? "حجز الكوشة غير موجود" : type === "booking" ? "الحجز غير موجود" : "الطلب غير موجود")}</div>;

  return <div className="min-h-dvh bg-background" dir="rtl">
    <div className="print:hidden sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 bg-card/95 px-4 py-3 backdrop-blur">
      <a href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowRight className="h-4 w-4" />العودة</a>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" />A4 + نزف 3 مم · جودة 300 DPI</div>
      <div className="flex gap-2"><Button variant="ghost" onClick={downloadPdf} disabled={downloading} className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{downloading ? "جارٍ إنشاء PDF" : "PDF للطباعة"}</Button><Button variant="ghost" onClick={() => printDocumentWhenImagesReady(sheetRef.current || document)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Printer className="h-4 w-4" />طباعة الفاتورة</Button></div>
    </div>
    {data.financiallyReversed && <div className="print:hidden border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm font-semibold text-destructive">تم عكس الأثر المالي لهذه الفاتورة.</div>}
    <div className="wedding-invoice-stage"><div ref={sheetRef}><WeddingInvoice data={data} model={model} settings={settings} websiteQr={websiteQr} displayNumber={displayNumber} /></div></div>
    <style>{luxuryWeddingInvoiceCss()}</style>
  </div>;
}

function invoiceModel(data: InvoiceData) {
  const booking = data.kind === "booking" || data.kind === "kosha";
  const cf = booking && data.customFields && typeof data.customFields === "object" ? data.customFields : {};
  const raw = booking
    ? Array.isArray(data.items) && data.items.length
      ? data.items
      : [{ id: data.id, productNameAr: data.serviceName, category: data.serviceType, description: data.serviceDescription || data.eventLocation, selectedColor: cf.color, quantity: 1, price: n(data.price), discount: n(cf.serviceDiscount) }]
    : Array.isArray(data.items) ? data.items : [];
  const items: InvoiceItem[] = raw.map((item: any, index: number) => {
    const quantity = Math.max(1, n(item.quantity) || 1), unitPrice = n(item.price), discount = n(item.discountAmount ?? item.discount);
    const included = item.included === true;
    return { id: item.id ?? index, name: text(item.productNameAr, item.productName, item.name, "خدمة مناسبات"), category: text(item.category, booking ? data.serviceType : data.serviceType, "فعاليات"), description: text(item.description, item.customization, booking && !item.group ? data.serviceDescription : ""), color: text(item.selectedColor, item.color), quantity, unitPrice: included ? 0 : unitPrice, discount: included ? 0 : discount, subtotal: included ? 0 : Math.max(0, unitPrice * quantity - discount), group: typeof item.group === "string" ? item.group : undefined, included, includedLabel: included ? text(item.includedLabel, "ضمن الحجز") : undefined };
  });
  const grouped = new Set(items.map((item) => item.group).filter(Boolean)).size > 1;
  const itemSubtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const total = n(booking ? data.price : data.total);
  const delivery = n(booking ? cf.deliveryFee : data.deliveryFee);
  const additional = n(cf.additionalCharges ?? data.additionalCharges);
  const storedDiscount = n(data.couponDiscountAmount) + n(data.loyaltyDiscountAmount) + n(cf.discount);
  // Service bookings send their own summary (Σ lines − discount = the booking total).
  const summary = data.invoiceSummary && typeof data.invoiceSummary === "object" ? data.invoiceSummary : null;
  const discount = summary ? n(summary.discount) : storedDiscount || Math.max(0, itemSubtotal + delivery + additional - total);
  const subtotal = summary ? n(summary.subtotal) : n(cf.subtotal) || itemSubtotal || Math.max(0, total + discount - delivery - additional);
  const paid = n(booking ? data.deposit : data.depositAmount);
  const storedRemaining = booking ? data.balance : data.remainingAmount;
  const remaining = storedRemaining === null || storedRemaining === undefined ? Math.max(0, total - paid) : n(storedRemaining);
  return { booking, cf, items, grouped, subtotal, discount, delivery, additional, paid, remaining, total };
}

function WeddingInvoice({ data, model, settings, websiteQr, displayNumber }: { data: InvoiceData; model: ReturnType<typeof invoiceModel>; settings: PublicSettings; websiteQr: string; displayNumber?: string }) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const code = text(data.trackingCode, `INV-${data.id}`);
  // Bookings print their short number in the barcode and under it (no scanner
  // looks invoices up by the long code); store orders keep their tracking code.
  const barcodeValue = displayNumber || code;
  const cf = model.cf;
  const created = data.createdAt ? new Date(data.createdAt) : new Date();
  const customerAddress = text(data.customerAddress, [data.governorate, data.area, data.address].filter(Boolean).join("، "), cf.address);
  const province = text(data.governorate, cf.province, cf.governorate);
  const city = text(data.customerCity, data.area, cf.city);
  const salesRepresentative = text(cf.salesRepresentative, data.salesRepresentative, data.createdByName);
  const company = settings?.site_name || "مجموعة علي جان نهاد";
  const companyPhone = settings?.phone || settings?.whatsapp || "—";
  const social = settings?.social_links || { instagram: "", facebook: "", whatsapp: "", tiktok: "" };

  useEffect(() => {
    if (!barcodeRef.current || barcodeValue === "—") return;
    try { JsBarcode(barcodeRef.current, barcodeValue, { format: "CODE128", height: 40, width: 1.4, margin: 0, displayValue: false, background: "transparent", lineColor: "#1c080d" }); }
    catch { barcodeRef.current.replaceChildren(); }
  }, [barcodeValue]);


  return <article className="wedding-invoice-bleed" dir="rtl">
    {(["tl", "tr", "bl", "br"] as const).map((corner) => <i key={corner} className={`wi-crop ${corner}`} />)}
    <div className="wedding-invoice">
      {/* Burgundy and ivory roses in all four corners; the header adds a burgundy-and-gold ribbon. */}
      <img src={HERO_RIBBONS} alt="" className="wi-hero-ribbons" />
      {(["tr", "tl"] as const).map((corner) => <img key={corner} src="/images/invoice/ajn-rose-corner-burgundy.png" alt="" className={`wi-floral ${corner} hero`} />)}
      {(["br", "bl"] as const).map((corner) => <img key={corner} src="/images/invoice/ajn-rose-corner-burgundy.png" alt="" className={`wi-floral ${corner}`} />)}
      <div className="wi-sparkles" />
      <div className="wi-content">
        <InvoiceHero data={data} cf={cf} booking={model.booking} paid={model.paid} remaining={model.remaining} settings={settings} invoiceNumber={displayNumber || code} created={created} customerAddress={customerAddress} province={province} salesRepresentative={salesRepresentative} websiteQr={websiteQr} barcodeRef={barcodeRef} barcodeValue={barcodeValue} />

        <section className="wi-section"><div className="wi-section-heading">الخدمات والتفاصيل · SERVICES</div><table className="wi-items"><colgroup><col style={{ width: "4%" }} /><col style={{ width: "16%" }} /><col style={{ width: "11%" }} /><col style={{ width: "22%" }} /><col style={{ width: "9%" }} /><col style={{ width: "6%" }} /><col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>#</th><th>الخدمة<br />Service</th><th>الفئة<br />Category</th><th>الوصف<br />Description</th><th>اللون<br />Color</th><th>الكمية<br />Qty</th><th>سعر الوحدة<br />Unit Price</th><th>الخصم<br />Discount</th><th>الإجمالي<br />Subtotal</th></tr></thead><tbody>{model.items.map((item, index) => <Fragment key={item.id ?? index}>{model.grouped && item.group && item.group !== model.items[index - 1]?.group ? <tr className="wi-group"><td colSpan={9}>{item.group}</td></tr> : null}<tr className={item.included ? "is-included" : undefined}><td>{index + 1}</td><td className="service">{item.name}</td><td>{item.category}</td><td className="description">{item.description}</td><td>{item.color}</td><td className="num">{item.quantity}</td>{item.included ? <><td className="included">—</td><td className="included">—</td><td className="included">{item.includedLabel}</td></> : <><td className="num">{formatCurrency(item.unitPrice)}</td><td className="num">{formatCurrency(item.discount)}</td><td className="num">{formatCurrency(item.subtotal)}</td></>}</tr></Fragment>)}</tbody></table></section>

        <section className="wi-totals-card">
          <div className="wi-section-heading">ملخص الحساب · TOTALS</div>
          <div className="wi-totals-layout">
            <div className="wi-summary-grid"><SummaryCell label="المجموع الفرعي" english="Subtotal" value={model.subtotal} /><SummaryCell label="الخصم" english="Discount" value={model.discount} /><SummaryCell label="التوصيل" english="Delivery" value={model.delivery} /><SummaryCell label="إضافات أخرى" english="Additional" value={model.additional} /><SummaryCell label="المدفوع" english="Paid" value={model.paid} /><SummaryCell label="المتبقي" english="Remaining" value={model.remaining} emphasis /></div>
            <div className="wi-grand"><span>الإجمالي الكلي · GRAND TOTAL</span><b>{formatCurrency(model.total)}</b></div>
          </div>
        </section>

        <section className="wi-signatures"><Signature label="توقيع العميل" value={cf.customerSignatureName} /><Signature label="مندوب المبيعات" value={salesRepresentative} /><Signature label="المحاسب" value={cf.accountantName} /><Signature label="اعتماد الفاتورة" value={cf.invoiceApproverName} /><Signature label="المدير الرئيسي" value={cf.managerName ?? data.managerName} /><div className="wi-signature"><div className="wi-stamp">AJN<br />OFFICIAL</div><span>الختم الرسمي</span></div></section>
        <footer className="wi-footer"><div className="wi-footer-main"><span>{settings?.website || "www.ajn-group.com"}</span><span>{settings?.email || "info@ajn-group.com"}</span><span>Instagram {shortSocial(social.instagram)}</span><span>Facebook {shortSocial(social.facebook)}</span><span>TikTok {shortSocial(social.tiktok)}</span><span>WhatsApp {settings?.whatsapp || companyPhone}</span><span>{companyPhone}</span></div><div className="wi-footer-address">{text(settings?.address, settings?.city)}</div>{websiteQr && <img className="wi-website-qr" src={websiteQr} alt="Website QR" />}</footer>
      </div>
    </div>
  </article>;
}

const svgImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s*\n\s*/g, ""))}`;
const HERO_RIBBONS = svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="2100" height="400" viewBox="0 0 2100 400" preserveAspectRatio="none">
  <defs>
    <linearGradient id="rb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3f0914"/><stop offset=".5" stop-color="#7a1a2f"/><stop offset="1" stop-color="#9b2c42"/></linearGradient>
    <linearGradient id="rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c7128"/><stop offset=".62" stop-color="#e9cd86"/><stop offset="1" stop-color="#e9cd86" stop-opacity="0"/></linearGradient>
  </defs>
  <g id="half">
    <path d="M0 268C250 236 520 150 900 112C560 168 280 252 0 312Z" fill="url(#rb)"/>
    <path d="M0 236C260 196 540 118 940 96" fill="none" stroke="url(#rg)" stroke-width="3.6"/>
    <path d="M0 334C270 280 540 190 900 138" fill="none" stroke="url(#rg)" stroke-width="1.8"/>
  </g>
  <use href="#half" transform="translate(2100 0) scale(-1 1)"/>
</svg>`);
const HERO_RULE = svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="340" height="20" viewBox="0 0 340 20">
  <defs><linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="#b8893a" stop-opacity="0"/><stop offset="1" stop-color="#b8893a"/></linearGradient><linearGradient id="r" x1="1" x2="0"><stop offset="0" stop-color="#b8893a" stop-opacity="0"/><stop offset="1" stop-color="#b8893a"/></linearGradient></defs>
  <path d="M0 10H150" stroke="url(#l)" stroke-width="1.6"/><path d="M190 10H340" stroke="url(#r)" stroke-width="1.6"/>
  <circle cx="154" cy="10" r="2.2" fill="#b8893a"/><circle cx="186" cy="10" r="2.2" fill="#b8893a"/>
  <path d="M170 2l8 8-8 8-8-8z" fill="#b8893a"/><path d="M170 6l4 4-4 4-4-4z" fill="#fff6e3"/>
</svg>`);
const HERO_FLOURISH = svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60" viewBox="0 0 400 60">
  <g id="s" fill="none" stroke="#b8893a" stroke-linecap="round">
    <path d="M184 30C160 10 128 10 112 26C100 38 112 52 126 44C136 38 128 26 118 32" stroke-width="2.4"/>
    <path d="M112 26C84 46 46 42 12 30" stroke-width="1.6" stroke-opacity=".8"/>
    <path d="M150 40C138 52 118 54 100 48" stroke-width="1.2" stroke-opacity=".6"/>
  </g>
  <use href="#s" transform="translate(400 0) scale(-1 1)"/>
  <path d="M200 20l10 10-10 10-10-10z" fill="#6b1426" stroke="#b8893a" stroke-width="2"/>
</svg>`);
const HERO_BANNER = svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="125" viewBox="0 0 500 125">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f2338"/><stop offset=".55" stop-color="#6b1426"/><stop offset="1" stop-color="#4a0b18"/></linearGradient>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a0f1f"/><stop offset="1" stop-color="#3a0812"/></linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c7128"/><stop offset=".5" stop-color="#f1d796"/><stop offset="1" stop-color="#9c7128"/></linearGradient>
  </defs>
  <path d="M62 34H6l24 32-24 32h56z" fill="url(#t)" stroke="url(#g)" stroke-width="3"/>
  <path d="M438 34h56l-24 32 24 32h-56z" fill="url(#t)" stroke="url(#g)" stroke-width="3"/>
  <path d="M62 98l22 14V98z" fill="#2c050d"/><path d="M438 98l-22 14V98z" fill="#2c050d"/>
  <path d="M84 14Q250-2 416 14V112Q250 96 84 112Z" fill="url(#b)" stroke="url(#g)" stroke-width="3.2"/>
  <path d="M92 22Q250 7 408 22" fill="none" stroke="#e3c47e" stroke-opacity=".55" stroke-width="1.4"/>
  <path d="M92 104Q250 89 408 104" fill="none" stroke="#e3c47e" stroke-opacity=".55" stroke-width="1.4"/>
</svg>`);

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "نقداً", cod: "الدفع عند الاستلام", transfer: "تحويل", bank_transfer: "تحويل مصرفي", bank: "تحويل مصرفي",
  card: "بطاقة", pos: "بطاقة", zaincash: "زين كاش", zain_cash: "زين كاش", qi: "كي كارد", qicard: "كي كارد", qi_card: "كي كارد",
  installment: "أقساط", installments: "أقساط", wallet: "محفظة إلكترونية", mixed: "مختلط", credit: "آجل", deferred: "آجل",
};
const has = (value: unknown) => String(value ?? "").trim() !== "" && String(value ?? "").trim() !== "—";
const pad2 = (value: number) => String(value).padStart(2, "0");
/** 2026/11/07 — date-only values stay as written; timestamps use the local day. */
const slashDate = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const day = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return `${day[1]}/${day[2]}/${day[3]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : `${parsed.getFullYear()}/${pad2(parsed.getMonth() + 1)}/${pad2(parsed.getDate())}`;
};
/** "19:00" → "7:00 م"; anything else is printed as saved. */
const clockText = (value: unknown) => {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "ص" : "م"}`;
};
const rentalDays = (days: number) => (days === 1 ? "يوم واحد" : days === 2 ? "يومان" : days <= 10 ? `${days} أيام` : `${days} يوماً`);

type HeroRow = { key: string; icon: LucideIcon; label: string; value: ReactNode; ltr?: boolean };

function invoiceStatus(data: InvoiceData, paid: number, remaining: number): { label: string; tone: "paid" | "partial" | "unpaid" | "void" } {
  if (data.financiallyReversed) return { label: "معكوسة مالياً", tone: "void" };
  if (String(data.status ?? "") === "cancelled") return { label: "ملغاة", tone: "void" };
  const status = String(data.paymentStatus ?? "");
  if (status === "paid" || (status !== "partial" && status !== "unpaid" && remaining <= 0 && paid > 0)) return { label: "مدفوعة", tone: "paid" };
  if (status === "partial" || (paid > 0 && remaining > 0)) return { label: "مدفوعة جزئياً", tone: "partial" };
  return { label: "غير مدفوعة", tone: "unpaid" };
}

/** The invoice's upper section: brand in the centre, customer (right) and invoice (left) panels. */
function InvoiceHero({ data, cf, booking, paid, remaining, settings, invoiceNumber, created, customerAddress, province, salesRepresentative, websiteQr, barcodeRef, barcodeValue }: {
  data: InvoiceData; cf: Record<string, any>; booking: boolean; paid: number; remaining: number; settings: PublicSettings; invoiceNumber: string; created: Date;
  customerAddress: string; province: string; salesRepresentative: string; websiteQr: string; barcodeRef: RefObject<SVGSVGElement | null>; barcodeValue: string;
}) {
  const brand = settings?.receipt_brand;
  const companyName = (brand?.name || settings?.site_name || "مجموعة علي جان نهاد").trim();
  const tagline = (brand?.tagline ?? "لتنظيم كافة المناسبات").trim();
  const rental = data.rental && typeof data.rental === "object" ? data.rental as { startDate?: string | null; endDate?: string | null; days?: number | null } : null;
  const serviceType = rental ? "إيجار معدات" : booking ? text(cf.eventType, data.serviceName, data.serviceType) : text(data.serviceType, "طلب متجر");
  const eventDate = cf.eventDate ?? data.eventDate;
  const eventTime = cf.eventTime ?? data.eventTime;
  const hall = cf.hallName ?? cf.venueName ?? (booking ? data.eventLocation : "");
  const address = has(customerAddress) ? customerAddress : has(province) ? province : "";
  const transport = cf.transportationLabel ? (cf.transportationVehicle ? `${cf.transportationLabel} · ${cf.transportationVehicle}` : cf.transportationLabel) : "";
  const method = String(data.paymentMethod ?? cf.paymentMethod ?? "").trim();
  const status = invoiceStatus(data, paid, remaining);
  const customerRows: HeroRow[] = [
    { key: "name", icon: User, label: "اسم العميل", value: text(data.customerName) },
    { key: "phone", icon: Phone, label: "رقم الهاتف", value: text(data.customerPhone), ltr: true },
    ...(has(cf.alternativePhone) ? [{ key: "alt", icon: Phone, label: "هاتف آخر", value: String(cf.alternativePhone), ltr: true }] : []),
    { key: "service", icon: Layers, label: "نوع الخدمة", value: serviceType },
    ...(rental
      ? [
          ...(Number(rental.days) > 0 ? [{ key: "days", icon: Hourglass, label: "مدة الإيجار", value: rentalDays(Number(rental.days)) }] : []),
          ...(has(rental.startDate) ? [{ key: "start", icon: CalendarDays, label: "تاريخ بداية الإيجار", value: slashDate(rental.startDate), ltr: true }] : []),
          ...(has(rental.endDate) ? [{ key: "end", icon: CalendarCheck, label: "تاريخ نهاية الإيجار", value: slashDate(rental.endDate), ltr: true }] : []),
        ]
      : [
          ...(has(eventDate) ? [{ key: "date", icon: CalendarDays, label: "تاريخ المناسبة", value: slashDate(eventDate), ltr: true }] : []),
          ...(has(eventTime) ? [{ key: "time", icon: Clock3, label: "وقت المناسبة", value: clockText(eventTime) }] : []),
        ]),
    ...(has(cf.brideName) ? [{ key: "bride", icon: Heart, label: "اسم العروس", value: String(cf.brideName) }] : []),
    ...(has(hall) ? [{ key: "hall", icon: Building2, label: "قاعة المناسبة", value: String(hall) }] : []),
    ...(has(address) ? [{ key: "address", icon: MapPin, label: "العنوان", value: address }] : []),
    ...(has(data.customerEmail ?? cf.email) ? [{ key: "email", icon: Mail, label: "البريد الإلكتروني", value: String(data.customerEmail ?? cf.email), ltr: true }] : []),
    ...(has(transport) ? [{ key: "transport", icon: Truck, label: "خدمة النقل", value: String(transport) }] : []),
    { key: "employee", icon: UserRound, label: "اسم الموظف", value: salesRepresentative },
    ...(has(cf.managerName ?? data.managerName) ? [{ key: "manager", icon: Users, label: "المدير الرئيسي", value: String(cf.managerName ?? data.managerName) }] : []),
  ];
  const bookingNumber = cf.bookingNumber || (booking ? data.trackingCode : "");
  const branch = cf.branchName ?? cf.branch ?? settings?.city;
  const invoiceRows: HeroRow[] = [
    { key: "number", icon: FileText, label: "رقم الفاتورة", value: invoiceNumber, ltr: true },
    ...(has(bookingNumber) && String(bookingNumber) !== invoiceNumber && booking ? [{ key: "booking", icon: Hash, label: "رقم الحجز", value: String(bookingNumber), ltr: true }] : []),
    ...(has(cf.contractNumber ?? cf.contractNo) ? [{ key: "contract", icon: ScrollText, label: "رقم العقد", value: String(cf.contractNumber ?? cf.contractNo), ltr: true }] : []),
    { key: "date", icon: CalendarDays, label: "تاريخ الفاتورة", value: slashDate(created.toISOString()), ltr: true },
    { key: "time", icon: Clock3, label: "وقت الإصدار", value: timeText(created.toISOString()) },
    { key: "method", icon: CreditCard, label: "طريقة الدفع", value: method ? PAYMENT_METHOD_LABELS[method.toLowerCase()] ?? method : "—" },
    { key: "status", icon: Star, label: "حالة الفاتورة", value: <span className={`wi-hp-status is-${status.tone}`}><CircleCheck aria-hidden="true" color={status.tone === "paid" ? "#3d0a15" : status.tone === "unpaid" ? "#6b1426" : "#fff3dc"} strokeWidth={2.2} />{status.label}</span> },
    ...(has(branch) ? [{ key: "branch", icon: Building2, label: "الفرع", value: String(branch) }] : []),
    ...(has(data.createdByName) && data.createdByName !== salesRepresentative ? [{ key: "creator", icon: UserRound, label: "أنشأها", value: String(data.createdByName) }] : []),
  ];
  const qr = data.qr?.dataUrl || websiteQr;
  return <header className="wi-hero">
    <section className="wi-hp customer" aria-label="معلومات العميل">
      <h2 className="wi-hp-title"><User aria-hidden="true" color="#f3dca4" strokeWidth={1.9} /><span>معلومات العميل</span><i>/</i><small>CUSTOMER INFORMATION</small></h2>
      <HeroRows rows={customerRows} />
    </section>
    <div className="wi-hero-brand">
      <div className="wi-medal"><div className="wi-medal-ring"><div className="wi-medal-in"><img src={logoSrc(settings)} alt="AJN" onError={handleDefaultLogoError} /></div></div></div>
      <div className="wi-hero-name">{companyName}</div>
      <div className="wi-hero-group">AJN GROUP</div>
      <img className="wi-hero-rule" src={HERO_RULE} alt="" />
      {tagline ? <div className="wi-hero-tagline"><span>{tagline}</span></div> : null}
      <div className="wi-hero-banner"><img src={HERO_BANNER} alt="" /><b>فاتورة</b></div>
      <div className="wi-hero-invoice">INVOICE</div>
      <img className="wi-hero-flourish" src={HERO_FLOURISH} alt="" />
    </div>
    <section className="wi-hp details" aria-label="معلومات الفاتورة">
      <h2 className="wi-hp-title"><FileText aria-hidden="true" color="#f3dca4" strokeWidth={1.9} /><span>معلومات الفاتورة</span><i>/</i><small>INVOICE DETAILS</small></h2>
      <HeroRows rows={invoiceRows} />
      <div className="wi-hp-codes">
        <div className="wi-hp-qr">{qr ? <img src={qr} alt="QR" /> : null}<span>{data.qr?.dataUrl ? "امسح للتحقق" : "موقعنا"}</span></div>
        <div className="wi-hp-code"><div className="wi-hp-barcode"><svg ref={barcodeRef} /></div><b>{barcodeValue}</b></div>
      </div>
    </section>
  </header>;
}

function HeroRows({ rows }: { rows: HeroRow[] }) {
  return <dl className="wi-hp-rows">{rows.map(({ key, icon: Icon, label, value, ltr }) => <div key={key} className="wi-hp-row"><dt><Icon aria-hidden="true" color="#7a1d32" strokeWidth={1.7} />{label}</dt><dd className={ltr ? "ltr" : undefined}>{typeof value === "string" ? text(value) : value}</dd></div>)}</dl>;
}

function SummaryCell({ label, english, value, emphasis = false }: { label: string; english: string; value: number; emphasis?: boolean }) { return <div className={`wi-summary-cell${emphasis ? " remaining" : ""}`}><span>{label}<small>{english}</small></span><b>{formatCurrency(value)}</b></div>; }
function Signature({ label, value }: { label: string; value: unknown }) { return <div className="wi-signature"><div className="line">{String(value ?? "").trim()}</div><span>{label}</span></div>; }
function shortSocial(value: string) { if (!value) return ""; try { const url = new URL(value); return url.pathname.replace(/^\//, "") || url.hostname; } catch { return value; } }
