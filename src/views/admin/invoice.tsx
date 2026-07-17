import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { ArrowRight, Download, Loader2, Printer, ShieldCheck } from "lucide-react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { toast } from "sonner";
import { adminFetch, fetchAdminMe, hasPerm } from "./_lib";
import { formatIraqiPhone } from "@/lib/phone";
import { logoSrc, usePublicSettings, type PublicSettings } from "@/lib/public-settings";
import { downloadElementPdf } from "@/lib/pdf";
import { luxuryWeddingInvoiceCss, printDocumentWhenImagesReady } from "./print-helpers";
import { formatCurrency } from "@/lib/money";

type InvoiceData = Record<string, any>;
type InvoiceItem = { id?: string | number; name: string; category: string; description: string; color: string; quantity: number; unitPrice: number; discount: number; subtotal: number };

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (...values: unknown[]) => values.map((value) => String(value ?? "").trim()).find(Boolean) || "—";
const dateText = (value: unknown) => {
  const raw = String(value ?? "").trim(); if (!raw) return "—";
  const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("ar-IQ", { year: "numeric", month: "2-digit", day: "2-digit" });
};
const timeText = (value: unknown) => {
  const raw = String(value ?? "").trim(); if (!raw) return "—";
  const parsed = new Date(raw); return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
};
const statusLabels: Record<string, string> = { paid: "مدفوع", partially_paid: "مدفوع جزئياً", partial: "مدفوع جزئياً", unpaid: "غير مدفوع", pending: "قيد الانتظار", reversed: "معكوس" };
const paymentKey = (value: unknown) => ({ cod: "cash", cash: "cash", paid: "cash", card: "visa", visa: "visa", mastercard: "mastercard", pos: "qi", qi_card: "qi", qi: "qi", zain_cash: "zain", zain: "zain", bank: "bank", transfer: "bank", installment: "installment" } as Record<string, string>)[String(value ?? "").toLowerCase()] || "cash";

export default function Invoice() {
  const [, params] = useRoute("/admin/invoice/:id");
  const type = new URLSearchParams(useSearch()).get("type") === "booking" ? "booking" : "order";
  const id = params?.id ? Number(params.id) : 0;
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [websiteQr, setWebsiteQr] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await fetchAdminMe();
      if (!alive) return;
      if (!me || !hasPerm(me, "invoices")) { window.location.href = "/admin/login"; return; }
      if (!id) { setLoading(false); return; }
      try { const result = await adminFetch(`/admin/invoices/${id}?type=${type}`); if (alive) setData(result as InvoiceData); }
      catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id, type]);

  useEffect(() => { if (data) document.title = `فاتورة ${data.trackingCode ?? data.id}`; }, [data]);
  useEffect(() => {
    let active = true;
    const target = settings?.website || (typeof window !== "undefined" ? window.location.origin : "");
    if (!target) return;
    QRCode.toDataURL(target, { width: 220, margin: 1, color: { dark: "#733647", light: "#fffaf3" } }).then((value) => { if (active) setWebsiteQr(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [settings?.website]);

  const model = useMemo(() => data ? invoiceModel(data) : null, [data]);

  async function downloadPdf() {
    if (!sheetRef.current || !data) return;
    setDownloading(true);
    try { await downloadElementPdf(sheetRef.current, `ajn-event-invoice-${data.trackingCode ?? data.id}.pdf`, { format: [216, 303], margin: 0, scale: 3.125, pagebreakMode: ["css", "legacy"] }); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "تعذر إنشاء ملف PDF"); }
    finally { setDownloading(false); }
  }

  if (loading) return <div className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground" dir="rtl"><Loader2 className="h-5 w-5 animate-spin" />جارٍ تحميل الفاتورة…</div>;
  if (error || !data || !model) return <div className="flex min-h-dvh items-center justify-center text-muted-foreground" dir="rtl">{error || (type === "booking" ? "الحجز غير موجود" : "الطلب غير موجود")}</div>;

  return <div className="min-h-dvh bg-background" dir="rtl">
    <div className="print:hidden sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 bg-card/95 px-4 py-3 backdrop-blur">
      <a href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowRight className="h-4 w-4" />العودة</a>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" />A4 + نزف 3 مم · جودة 300 DPI</div>
      <div className="flex gap-2"><button onClick={downloadPdf} disabled={downloading} className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{downloading ? "جارٍ إنشاء PDF" : "PDF للطباعة"}</button><button onClick={() => printDocumentWhenImagesReady(sheetRef.current || document)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Printer className="h-4 w-4" />طباعة الفاتورة</button></div>
    </div>
    {data.financiallyReversed && <div className="print:hidden border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm font-semibold text-destructive">تم عكس الأثر المالي لهذه الفاتورة.</div>}
    <div className="wedding-invoice-stage"><div ref={sheetRef}><WeddingInvoice data={data} model={model} settings={settings} websiteQr={websiteQr} /></div></div>
    <style>{luxuryWeddingInvoiceCss()}</style>
  </div>;
}

function invoiceModel(data: InvoiceData) {
  const booking = data.kind === "booking";
  const cf = booking && data.customFields && typeof data.customFields === "object" ? data.customFields : {};
  const raw = booking ? [{ id: data.id, productNameAr: data.serviceName, category: data.serviceType, description: data.serviceDescription || data.eventLocation, selectedColor: cf.color, quantity: 1, price: n(data.price), discount: n(cf.serviceDiscount) }] : Array.isArray(data.items) ? data.items : [];
  const items: InvoiceItem[] = raw.map((item: any, index: number) => {
    const quantity = Math.max(1, n(item.quantity) || 1), unitPrice = n(item.price), discount = n(item.discountAmount ?? item.discount);
    return { id: item.id ?? index, name: text(item.productNameAr, item.productName, item.name, "خدمة مناسبات"), category: text(item.category, booking ? data.serviceType : data.serviceType, "فعاليات"), description: text(item.description, item.customization, booking ? data.serviceDescription : ""), color: text(item.selectedColor, item.color), quantity, unitPrice, discount, subtotal: Math.max(0, unitPrice * quantity - discount) };
  });
  const itemSubtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const total = n(booking ? data.price : data.total);
  const delivery = n(booking ? cf.deliveryFee : data.deliveryFee);
  const additional = n(cf.additionalCharges ?? data.additionalCharges);
  const storedDiscount = n(data.couponDiscountAmount) + n(data.loyaltyDiscountAmount) + n(cf.discount);
  const discount = storedDiscount || Math.max(0, itemSubtotal + delivery + additional - total);
  const subtotal = n(cf.subtotal) || itemSubtotal || Math.max(0, total + discount - delivery - additional);
  const paid = n(booking ? data.deposit : data.depositAmount);
  const storedRemaining = booking ? data.balance : data.remainingAmount;
  const remaining = storedRemaining === null || storedRemaining === undefined ? Math.max(0, total - paid) : n(storedRemaining);
  return { booking, cf, items, subtotal, discount, delivery, additional, paid, remaining, total };
}

function WeddingInvoice({ data, model, settings, websiteQr }: { data: InvoiceData; model: ReturnType<typeof invoiceModel>; settings: PublicSettings; websiteQr: string }) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const code = text(data.trackingCode, `INV-${data.id}`);
  const cf = model.cf;
  const created = data.createdAt ? new Date(data.createdAt) : new Date();
  const payment = paymentKey(data.paymentMethod ?? cf.paymentMethod);
  const paymentStatus = statusLabels[String(data.paymentStatus ?? "unpaid")] || text(data.paymentStatus);
  const customerAddress = text(data.customerAddress, [data.governorate, data.area, data.address].filter(Boolean).join("، "), cf.address);
  const province = text(data.governorate, cf.province, cf.governorate);
  const city = text(data.customerCity, data.area, cf.city);
  const salesRepresentative = text(cf.salesRepresentative, data.salesRepresentative, data.createdByName);
  const company = settings?.site_name || "مجموعة علي جان نهاد";
  const companyPhone = settings?.phone || settings?.whatsapp || "—";
  const social = settings?.social_links || { instagram: "", facebook: "", whatsapp: "", tiktok: "" };

  useEffect(() => {
    if (!barcodeRef.current || code === "—") return;
    try { JsBarcode(barcodeRef.current, code, { format: "CODE128", height: 36, width: 1.25, margin: 0, displayValue: false, background: "transparent", lineColor: "#733647" }); }
    catch { barcodeRef.current.replaceChildren(); }
  }, [code]);

  const paymentMethods = [["cash", "⌑", "Cash"], ["visa", "V", "Visa"], ["mastercard", "●", "MasterCard"], ["qi", "Q", "Qi Card"], ["zain", "Z", "Zain Cash"], ["bank", "▤", "Bank Transfer"], ["installment", "≋", "Installment"]];
  const info = (label: string, value: unknown, wide = false) => <div className={`wi-field${wide ? " wide" : ""}`}><span>{label}</span><b>{text(value)}</b></div>;

  return <article className="wedding-invoice-bleed" dir="rtl">
    {(["tl", "tr", "bl", "br"] as const).map((corner) => <i key={corner} className={`wi-crop ${corner}`} />)}
    <div className="wedding-invoice">
      {(["tr", "tl", "br", "bl"] as const).map((corner) => <img key={corner} src="/images/invoice/ajn-rose-corner.png" alt="" className={`wi-floral ${corner}`} />)}
      <div className="wi-sparkles" />
      <div className="wi-content">
        <header className="wi-brand"><span className="wi-crown">♛</span><img src={logoSrc(settings)} alt="AJN" className="wi-logo" /><div className="wi-company-en">AJN GROUP</div><div className="wi-company-ar">{company}</div><div className="wi-for-events">FOR EVENTS</div><div className="wi-title"><small>EVENT INVOICE</small>فاتورة</div></header>

        <section className="wi-top">
          <div className="wi-panel"><div className="wi-panel-title">معلومات العميل · CUSTOMER INFORMATION</div><div className="wi-info-grid">{info("اسم العميل", data.customerName, true)}{info("اسم العريس", cf.groomName)}{info("اسم العروس", cf.brideName)}{info("رقم الهاتف", data.customerPhone)}{info("هاتف بديل", cf.alternativePhone ?? cf.altPhone)}{info("المحافظة", province)}{info("المدينة", city)}{info("العنوان", customerAddress, true)}{info("اسم القاعة", cf.hallName ?? cf.venueName ?? (model.booking ? data.eventLocation : ""), true)}{info("نوع المناسبة", cf.eventType ?? data.serviceName ?? data.serviceType)}{info("تاريخ المناسبة", cf.eventDate ?? data.eventDate)}{info("وقت المناسبة", cf.eventTime ?? data.eventTime)}{info("مندوب المبيعات", salesRepresentative, true)}</div></div>
          <div className="wi-top-spacer" />
          <div className="wi-panel"><div className="wi-panel-title">بيانات الفاتورة · INVOICE DETAILS</div><div className="wi-info-grid">{info("رقم الفاتورة", code, true)}{info("رقم العقد", cf.contractNumber ?? cf.contractNo)}{info("رقم الحجز", cf.bookingNumber ?? (model.booking ? data.trackingCode : ""))}{info("التاريخ", dateText(created))}{info("الوقت", timeText(created))}{info("أنشأها", data.createdByName)}{info("الفرع", cf.branchName ?? cf.branch ?? settings?.city, true)}</div><div className="wi-codes"><div><img className="wi-qr" src={data.qr?.dataUrl || websiteQr} alt="QR verification" /><span className="wi-code-caption">Scan to verify booking</span></div><div><div className="wi-barcode"><svg ref={barcodeRef} /></div><div className="wi-readable">{code}</div></div></div></div>
        </section>

        <section className="wi-section"><div className="wi-section-heading">الخدمات والتفاصيل · SERVICES</div><table className="wi-items"><colgroup><col style={{ width: "4%" }} /><col style={{ width: "16%" }} /><col style={{ width: "11%" }} /><col style={{ width: "22%" }} /><col style={{ width: "9%" }} /><col style={{ width: "6%" }} /><col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>#</th><th>الخدمة<br />Service</th><th>الفئة<br />Category</th><th>الوصف<br />Description</th><th>اللون<br />Color</th><th>الكمية<br />Qty</th><th>سعر الوحدة<br />Unit Price</th><th>الخصم<br />Discount</th><th>الإجمالي<br />Subtotal</th></tr></thead><tbody>{model.items.map((item, index) => <tr key={item.id ?? index}><td>{index + 1}</td><td className="service">{item.name}</td><td>{item.category}</td><td className="description">{item.description}</td><td>{item.color}</td><td className="num">{item.quantity}</td><td className="num">{formatCurrency(item.unitPrice)}</td><td className="num">{formatCurrency(item.discount)}</td><td className="num">{formatCurrency(item.subtotal)}</td></tr>)}</tbody></table></section>

        <section className="wi-bottom">
          <div className="wi-bottom-panel"><div className="wi-section-heading">ملخص الحساب · TOTALS</div><SummaryRow label="المجموع الفرعي · Subtotal" value={model.subtotal} /><SummaryRow label="الخصم · Discount" value={model.discount} /><SummaryRow label="التوصيل · Delivery" value={model.delivery} /><SummaryRow label="رسوم إضافية · Additional" value={model.additional} /><SummaryRow label="المدفوع · Paid" value={model.paid} /><SummaryRow label="المتبقي · Remaining" value={model.remaining} emphasis /><div className="wi-grand"><span>GRAND TOTAL · الإجمالي النهائي</span><b>{formatCurrency(model.total)}</b></div></div>
          <div className="wi-bottom-panel"><div className="wi-section-heading">الملاحظات · NOTES</div><Note label="ملاحظات خاصة · Special Notes" value={cf.specialNotes ?? data.notes} /><Note label="ملاحظات التسليم · Delivery Notes" value={cf.deliveryNotes} /><Note label="ملاحظات العميل · Customer Notes" value={cf.customerNotes} /><Note label="الشروط والأحكام · Terms & Conditions" value={cf.termsAndConditions ?? "تخضع الخدمات للمواصفات والتواريخ المعتمدة في العقد، ويُرجى الاحتفاظ بهذه الفاتورة للمراجعة."} /></div>
          <div className="wi-bottom-panel"><div className="wi-section-heading">طرق الدفع · PAYMENT METHODS</div><div className="wi-payments">{paymentMethods.map(([key, icon, label]) => <span key={key} className={`wi-payment${payment === key ? " active" : ""}`}><i>{icon}</i>{label}</span>)}</div><div className="wi-pay-state"><div><span>Paid · المدفوع</span><b>{formatCurrency(model.paid)}</b></div><div><span>Remaining · المتبقي</span><b>{formatCurrency(model.remaining)}</b></div><div><span>Payment Status</span><b>{paymentStatus}</b></div><div><span>Due Date</span><b>{dateText(data.dueDate)}</b></div></div></div>
        </section>

        <section className="wi-signatures"><Signature label="توقيع العميل" value={cf.customerSignatureName} /><Signature label="مندوب المبيعات" value={salesRepresentative} /><Signature label="المحاسب" value={cf.accountantName} /><Signature label="اعتماد المدير" value={cf.managerName} /><div className="wi-signature"><div className="wi-stamp">AJN<br />OFFICIAL</div><span>الختم الرسمي</span></div></section>
        <footer className="wi-footer"><div className="wi-footer-main"><span>{settings?.website || "www.ajn-group.com"}</span><span>{settings?.email || "info@ajn-group.com"}</span><span>Instagram {shortSocial(social.instagram)}</span><span>Facebook {shortSocial(social.facebook)}</span><span>TikTok {shortSocial(social.tiktok)}</span><span>WhatsApp {settings?.whatsapp || companyPhone}</span><span>{companyPhone}</span></div><div className="wi-footer-address">{text(settings?.address, settings?.city)}</div>{websiteQr && <img className="wi-website-qr" src={websiteQr} alt="Website QR" />}</footer>
      </div>
    </div>
  </article>;
}

function SummaryRow({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) { return <div className={`wi-summary-row${emphasis ? " remaining" : ""}`}><span>{label}</span><b>{formatCurrency(value)}</b></div>; }
function Note({ label, value }: { label: string; value: unknown }) { return <div className="wi-note-block"><b>{label}</b><p>{text(value)}</p></div>; }
function Signature({ label, value }: { label: string; value: unknown }) { return <div className="wi-signature"><div className="line">{String(value ?? "").trim()}</div><span>{label}</span></div>; }
function shortSocial(value: string) { if (!value) return ""; try { const url = new URL(value); return url.pathname.replace(/^\//, "") || url.hostname; } catch { return value; } }
