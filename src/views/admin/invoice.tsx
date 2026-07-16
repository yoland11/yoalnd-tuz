import { useEffect, useRef, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { ArrowRight, Download, Printer } from "lucide-react";
import { adminFetch, fetchAdminMe, hasPerm } from "./_lib";
import { formatIraqiPhone } from "@/lib/phone";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { downloadElementPdf } from "@/lib/pdf";
import { luxuryDuplicateInvoiceCss } from "./print-helpers";
import { formatCurrency } from "@/lib/money";

type InvoiceData = any;

const paymentLabels: Record<string, string> = { cash: "نقد", cod: "نقد", transfer: "تحويل بنكي", paid: "مدفوع", card: "بطاقة", pos: "Qi Card" };

export default function Invoice() {
  const [, params] = useRoute("/admin/invoice/:id");
  const type = new URLSearchParams(useSearch()).get("type") === "booking" ? "booking" : "order";
  const id = params?.id ? Number(params.id) : 0;
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await fetchAdminMe();
      if (!alive) return;
      if (!me || !hasPerm(me, "invoices")) { window.location.href = "/admin/login"; return; }
      if (!id) { setLoading(false); return; }
      try { const result = await adminFetch(`/admin/invoices/${id}?type=${type}`); if (alive) setData(result); }
      catch (cause: any) { if (alive) setError(cause?.message ?? String(cause)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id, type]);

  useEffect(() => { if (data) document.title = `فاتورة ${data.trackingCode ?? data.id}`; }, [data]);

  async function downloadPdf() {
    if (!sheetRef.current || !data) return;
    setDownloading(true);
    try { await downloadElementPdf(sheetRef.current, `ajn-invoice-${data.trackingCode ?? data.id}.pdf`, { format: "a4", margin: 0 }); }
    catch (cause) { alert(cause instanceof Error ? cause.message : "تعذر إنشاء ملف PDF."); }
    finally { setDownloading(false); }
  }

  if (loading) return <div className="flex min-h-dvh items-center justify-center text-muted-foreground" dir="rtl">جارٍ تحميل الفاتورة...</div>;
  if (error || !data) return <div className="flex min-h-dvh items-center justify-center text-muted-foreground" dir="rtl">{type === "booking" ? "الحجز غير موجود" : "الطلب غير موجود"}</div>;

  const isBooking = data.kind === "booking";
  const rawItems = isBooking ? [{ id: "booking", productNameAr: data.serviceName ?? "باقة المناسبة", description: data.eventLocation ?? "خدمة مناسبات", quantity: 1, price: Number(data.price ?? 0) }] : data.items ?? [];
  const items = rawItems.slice(0, 4);
  const total = Number(isBooking ? data.price : data.total) || 0;
  const subtotal = isBooking ? total : rawItems.reduce((sum: number, item: any) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0);
  const paid = Number(isBooking ? data.deposit : data.depositAmount) || Math.max(0, total - (Number(data.remainingAmount ?? data.balance) || total));
  const remaining = Number(isBooking ? data.balance : data.remainingAmount) || Math.max(0, total - paid);
  const delivery = isBooking ? 0 : Number(data.deliveryFee) || 0;
  const discount = Math.max(0, subtotal + delivery - total);

  const copy = <LuxuryInvoiceCopy data={data} isBooking={isBooking} items={items} extraItems={Math.max(0, rawItems.length - items.length)} total={total} subtotal={subtotal} paid={paid} remaining={remaining} delivery={delivery} discount={discount} logo={logoSrc(settings)} company={settings?.site_name ?? "مجموعة علي جان نهاد"} />;
  return <div className="min-h-dvh bg-background" dir="rtl">
    <div className="print:hidden sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/30 bg-card/95 px-4 py-3 backdrop-blur"><a href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowRight className="h-4 w-4" /> العودة</a><div className="flex gap-2"><button onClick={downloadPdf} disabled={downloading} className="inline-flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"><Download className="h-4 w-4" /> {downloading ? "جارٍ إنشاء PDF" : "PDF A4"}</button><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Printer className="h-4 w-4" /> طباعة نسختين</button></div></div>
    {data.financiallyReversed && <div className="print:hidden border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm font-semibold text-destructive">تم عكس الأثر المالي لهذه الفاتورة.</div>}
    <div ref={sheetRef} className="luxury-invoice-page">{copy}<div className="luxury-cut"><span className="scissors">✂</span></div>{copy}</div><style>{luxuryDuplicateInvoiceCss()}</style>
  </div>;
}

function LuxuryInvoiceCopy({ data, isBooking, items, extraItems, total, subtotal, paid, remaining, delivery, discount, logo, company }: { data: any; isBooking: boolean; items: any[]; extraItems: number; total: number; subtotal: number; paid: number; remaining: number; delivery: number; discount: number; logo: string; company: string }) {
  const date = data.createdAt ? new Date(data.createdAt) : new Date();
  const eventDate = isBooking ? data.eventDate : "—";
  const address = isBooking ? data.eventLocation : [data.governorate, data.area, data.address].filter(Boolean).join("، ");
  return <article className="luxury-invoice-copy">
    <header className="li-header"><div className="li-meta"><div className="li-kv"><b>رقم الفاتورة</b><span>{data.trackingCode ?? `INV-${data.id}`}</span></div><div className="li-kv"><b>التاريخ</b><span>{date.toLocaleDateString("ar-IQ")}</span></div><div className="li-kv"><b>الوقت</b><span>{date.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</span></div><img className="li-qr" src={data.qr?.dataUrl} alt="QR" /></div><div className="li-brand"><img src={logo} className="li-logo" alt="AJN" /><div className="li-brand-name">AJN GROUP</div><div className="li-brand-ar">{company}</div><div className="li-subtitle">FOR EVENTS</div><div className="li-title">فاتورة <span dir="ltr">/ INVOICE</span></div></div><div className="li-customer"><div className="li-kv"><b>العميل</b><span>{data.customerName || "—"}</span></div><div className="li-kv"><b>الهاتف</b><span dir="ltr">{data.customerPhone ? formatIraqiPhone(data.customerPhone) : "—"}</span></div><div className="li-kv"><b>العنوان</b><span>{address || "—"}</span></div><div className="li-kv"><b>تاريخ المناسبة</b><span>{eventDate || "—"}</span></div><div className="li-kv"><b>قاعة المناسبة</b><span>{isBooking ? data.eventLocation || "—" : "—"}</span></div><div className="li-kv"><b>مندوب المبيعات</b><span>{data.salesRepresentative || "AJN"}</span></div></div></header>
    <section className="li-section"><div className="li-section-title">تفاصيل المنتجات والخدمات</div><table className="li-table"><colgroup><col style={{ width: "5%" }} /><col style={{ width: "22%" }} /><col style={{ width: "25%" }} /><col style={{ width: "8%" }} /><col style={{ width: "13%" }} /><col style={{ width: "12%" }} /><col style={{ width: "15%" }} /></colgroup><thead><tr><th>#</th><th>المنتج</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id ?? index}><td>{index + 1}</td><td>{item.productNameAr ?? item.productName ?? item.name ?? "خدمة"}</td><td>{item.description ?? (isBooking ? "خدمة مناسبات" : "منتج AJN" )}</td><td className="num">{item.quantity ?? 1}</td><td className="num">{formatCurrency(item.price ?? 0)}</td><td className="num">{formatCurrency(0)}</td><td className="num">{formatCurrency(Number(item.price ?? 0) * Number(item.quantity ?? 1))}</td></tr>)}{extraItems > 0 && <tr><td colSpan={7}>+ {extraItems} عناصر إضافية مدرجة في الطلب</td></tr>}</tbody></table></section>
    <section className="li-bottom"><div><div className="li-section-title">طرق الدفع</div><div className="li-payments">{["نقد", "بنك", "Zain Cash", "Qi Card", "MasterCard"].map((method) => <span className="li-chip" key={method}>{method}</span>)}</div><div className="li-notes"><b>ملاحظات:</b> {data.notes || `طريقة الدفع: ${paymentLabels[data.paymentMethod] ?? "حسب الاتفاق"}`}</div><div className="li-sign"><div><b>التوقيع الرقمي</b><div className="li-sign-line">AJN</div></div><div className="li-stamp">AJN<br />OFFICIAL</div></div></div><div className="li-summary"><div className="li-summary-row"><span>المجموع الفرعي</span><b>{formatCurrency(subtotal)}</b></div><div className="li-summary-row"><span>الخصم</span><b>{formatCurrency(discount)}</b></div><div className="li-summary-row"><span>التوصيل</span><b>{formatCurrency(delivery)}</b></div><div className="li-summary-row"><span>المدفوع</span><b>{formatCurrency(paid)}</b></div><div className="li-summary-row"><span>المتبقي</span><b>{formatCurrency(remaining)}</b></div><div className="li-total-card"><span>GRAND TOTAL · الإجمالي</span><b>{formatCurrency(total)}</b></div></div></section>
    <footer className="li-footer"><span>Instagram · Facebook · TikTok</span><span>WhatsApp · {data.customerPhone || "AJN"}</span><span>www.ajn-group.com · info@ajn-group.com</span></footer>
  </article>;
}
