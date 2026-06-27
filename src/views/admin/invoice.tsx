import { useEffect, useRef, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { Printer, ArrowRight, Download, QrCode } from "lucide-react";
import { adminFetch, fetchAdminMe, hasPerm } from "./_lib";
import { formatIraqiPhone } from "@/lib/phone";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { SelectedColorLabel } from "@/components/product-colors";
import { downloadElementPdf } from "@/lib/pdf";
import { downloadDataUrl, openQrPrintWindow } from "./print-helpers";
import { formatCurrency, formatMoney } from "@/lib/money";

type InvoiceData = any;

const PAYMENT_LABELS_AR: Record<string, string> = {
  cod: "عند الاستلام",
  transfer: "حوالة",
  paid: "مدفوع",
};
const PAYMENT_STATUS_AR: Record<string, string> = {
  unpaid: "غير مدفوع",
  partial: "جزئي",
  paid: "مدفوع",
};

export default function Invoice() {
  const [, params] = useRoute("/admin/invoice/:id");
  const search = useSearch();
  const type = new URLSearchParams(search).get("type") === "booking" ? "booking" : "order";
  const id = params?.id ? parseInt(params.id) : 0;
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [thermalSize, setThermalSize] = useState<"58mm" | "80mm">("80mm");
  const sheetRef = useRef<HTMLDivElement>(null);
  const { data: settings } = usePublicSettings();

  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await fetchAdminMe();
      if (!alive) return;
      if (!me || !hasPerm(me, "invoices")) {
        window.location.href = "/admin/login";
        return;
      }
      if (!id) { setLoading(false); return; }
      try {
        const res = await adminFetch(`/admin/invoices/${id}?type=${type}`);
        if (alive) setData(res);
      } catch (e: any) {
        if (alive) setError(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, type]);

  useEffect(() => {
    if (!data) { document.title = "فاتورة"; return; }
    const prefix = data.kind === "booking" ? "فاتورة حجز" : "فاتورة";
    document.title = `${prefix} ${data.trackingCode ?? ""}`.trim();
  }, [data]);

  async function downloadPdf() {
    if (!sheetRef.current || !data) return;
    setDownloading(true);
    try {
      const el = sheetRef.current;
      // Thermal-width PDF (80mm) with height tracking the content — no A4 whitespace.
      const heightMm = Math.max(120, Math.round((el.offsetHeight * 25.4) / 96) + 6);
      const filename = `${data.kind === "booking" ? "booking" : "invoice"}-${data.trackingCode ?? data.id}.pdf`;
      await downloadElementPdf(el, filename, { format: [80, heightMm], margin: 2 });
    } catch (e) {
      alert(e instanceof Error ? e.message : "تعذر تحميل PDF، جرّب الطباعة أو إعادة المحاولة.");
    } finally {
      setDownloading(false);
    }
  }

  function invoiceAmount() {
    if (!data) return 0;
    return data.kind === "booking" ? Number(data.price ?? 0) : Number(data.total ?? 0);
  }

  function printQrOnly() {
    if (!data) return;
    try {
      openQrPrintWindow({
        qrDataUrl: data.qr?.dataUrl,
        customerName: data.customerName,
        amount: invoiceAmount(),
        title: data.kind === "booking" ? "QR الحجز" : "QR الطلب",
        paperSize: "80mm",
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "تعذر طباعة QR");
    }
  }

  function downloadQrImage() {
    if (!data) return;
    try {
      downloadDataUrl(data.qr?.dataUrl, `qr-${data.trackingCode ?? data.id}.png`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "تعذر تحميل QR");
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground" dir="rtl">جاري التحميل...</div>;
  }
  if (error || !data) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground" dir="rtl">{type === "booking" ? "الحجز غير موجود" : "الطلب غير موجود"}</div>;
  }

  const isBooking = data.kind === "booking";
  const subtotal = (data.items ?? []).reduce((s: number, i: any) => s + i.price * i.quantity, 0);

  return (
    <div className="inv-thermal-wrap" dir="rtl">
      {/* Toolbar (hidden on print/PDF) */}
      <div className="print:hidden bg-neutral-900 text-white p-3 flex items-center justify-between sticky top-0 z-10">
        <a href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-neutral-300 hover:text-white">
          <ArrowRight className="w-4 h-4" /> العودة للوحة
        </a>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-white/20" aria-label="حجم الطابعة الحرارية">
            {(["58mm", "80mm"] as const).map((size) => (
              <button key={size} onClick={() => setThermalSize(size)} className={`px-3 py-2 text-xs font-medium ${thermalSize === size ? "bg-amber-400 text-black" : "bg-neutral-900 text-neutral-200"}`}>{size}</button>
            ))}
          </div>
          <button onClick={printQrOnly} className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors">
            <QrCode className="w-4 h-4" /> طباعة QR
          </button>
          <button onClick={downloadQrImage} className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors">
            <Download className="w-4 h-4" /> تحميل QR
          </button>
          <button onClick={downloadPdf} disabled={downloading} className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors disabled:opacity-60">
            <Download className="w-4 h-4" /> {downloading ? "جاري التحميل..." : "تحميل PDF"}
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 bg-amber-400 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-300 transition-colors">
            <Printer className="w-4 h-4" /> طباعة
          </button>
        </div>
      </div>

      {data.financiallyReversed && (
        <div className="print:hidden border-y border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm font-semibold text-destructive">
          تم عكس الأثر المالي لهذا {isBooking ? "الحجز" : "الطلب"} — لا يُحتسب ضمن الإيرادات الصافية
        </div>
      )}

      {/* ===== Thermal receipt sheet (80mm) ===== */}
      <div ref={sheetRef} className="inv-sheet">
        <div className="ih-head">
          <img src={logoSrc(settings)} alt="" className="ih-logo" decoding="async" />
          <div className="ih-co">{settings?.site_name ?? "مجموعة علي جان"}</div>
          <div className="ih-sub">{settings?.address || "طوزخورماتو — العراق"}</div>
        </div>

        <hr className="ih-rule" />
        <div className="ih-kv"><span>{isBooking ? "رقم الحجز" : "رقم الفاتورة"}</span><span className="v big num">{data.trackingCode ?? "—"}</span></div>
        <div className="ih-kv"><span>التاريخ</span><span className="v num">{new Date(data.createdAt).toLocaleDateString("ar-IQ", { year: "numeric", month: "long", day: "numeric" })}</span></div>
        <div className="ih-kv"><span>نوع المستند</span><span className="v">{isBooking ? "فاتورة حجز خدمة" : "فاتورة طلب من المتجر"}</span></div>

        <hr className="ih-rule" />
        <div className="ih-kv"><span>الزبون</span><span className="v">{data.customerName || "—"}</span></div>
        {data.customerPhone && <div className="ih-kv"><span>الهاتف</span><span className="v num">{formatIraqiPhone(data.customerPhone)}</span></div>}
        {isBooking ? (
          <>
            <div className="ih-kv"><span>الخدمة</span><span className="v">{data.serviceName ?? "—"}</span></div>
            <div className="ih-kv"><span>تاريخ المناسبة</span><span className="v">{data.eventDate ?? "—"}</span></div>
            {data.eventLocation && <div className="ih-kv"><span>الموقع</span><span className="v">{data.eventLocation}</span></div>}
          </>
        ) : (
          <>
            <div className="ih-kv"><span>عنوان التوصيل</span><span className="v">{data.governorate ?? "—"}{data.area ? ` — ${data.area}` : ""}</span></div>
            {data.address && <div className="ih-kv"><span>العنوان</span><span className="v">{data.address}</span></div>}
            <div className="ih-kv"><span>طريقة الدفع</span><span className="v">{PAYMENT_LABELS_AR[data.paymentMethod ?? "cod"] ?? "—"}</span></div>
          </>
        )}

        {!isBooking && (
          <>
            <hr className="ih-rule" />
            <table className="ih-items">
              <thead><tr><th className="nm">المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {data.items?.map((item: any) => (
                  <tr key={item.id}>
                    <td className="nm">
                      {item.productNameAr || item.productName}
                      <SelectedColorLabel color={item.selectedColorData} fallback={item.selectedColor} className="mr-1 inline-flex" />
                    </td>
                    <td className="c num">{item.quantity}</td>
                    <td className="c num">{formatMoney(item.price)}</td>
                    <td className="l num">{formatMoney(item.price * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <hr className="ih-rule" />
        {isBooking ? (
          <>
            <div className="ih-row"><span>السعر المتفق عليه</span><span className="num">{data.price > 0 ? formatCurrency(data.price) : "—"}</span></div>
            <div className="ih-row"><span>العربون المدفوع</span><span className="num">{data.deposit > 0 ? formatCurrency(data.deposit) : "—"}</span></div>
            <div className="ih-row"><span>حالة الدفع</span><span>{PAYMENT_STATUS_AR[data.paymentStatus ?? "unpaid"] ?? "غير مدفوع"}</span></div>
            <div className="ih-grand"><span>الإجمالي</span><span className="num">{formatCurrency(data.price)}</span></div>
            <div className="ih-pay rm"><span>المتبقي</span><span className="num">{formatCurrency(data.balance)}</span></div>
          </>
        ) : (
          <>
            <div className="ih-row"><span>المجموع</span><span className="num">{formatCurrency(subtotal)}</span></div>
            <div className="ih-row"><span>رسوم التوصيل</span><span className="num">{formatCurrency(data.deliveryFee)}</span></div>
            {Number(data.depositAmount) > 0 && <div className="ih-row"><span>العربون</span><span className="num">{formatCurrency(data.depositAmount)}</span></div>}
            <div className="ih-row"><span>حالة الدفع</span><span>{PAYMENT_STATUS_AR[data.paymentStatus ?? "unpaid"] ?? "غير مدفوع"}</span></div>
            <div className="ih-grand"><span>الإجمالي</span><span className="num">{formatCurrency(data.total)}</span></div>
            <div className="ih-pay rm"><span>المتبقي</span><span className="num">{formatCurrency(data.remainingAmount ?? data.total)}</span></div>
          </>
        )}

        {data.notes && (
          <>
            <hr className="ih-rule dashed" />
            <div className="ih-notes"><span>ملاحظات: </span>{data.notes}</div>
          </>
        )}

        {data.qr?.dataUrl && (
          <div className="ih-qr">
            <img src={data.qr.dataUrl} alt="QR" width={160} height={160} decoding="async" />
            <div className="cap">امسح الرمز لمتابعة {isBooking ? "الحجز" : "الطلب"}</div>
          </div>
        )}

        <hr className="ih-rule" />
        <div className="ih-thanks">شكراً لاختياركم مجموعة علي جان</div>
      </div>

      <style>{`
        .inv-thermal-wrap { min-height: 100vh; background: #5b5e63; }
        .inv-sheet {
          width: ${thermalSize === "58mm" ? "219px" : "302px"};
          margin: 0 auto;
          background: #fff;
          color: #000;
          font-family: Cairo, Tajawal, Tahoma, Arial, sans-serif;
          font-weight: 600;
          font-size: ${thermalSize === "58mm" ? "11px" : "13px"};
          line-height: 1.3;
          padding: 14px 16px;
        }
        .inv-sheet * { color: #000 !important; }
        .inv-sheet .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
        .ih-head { text-align: center; margin-bottom: 4px; }
        .ih-logo { height: 46px; width: auto; max-width: 68%; object-fit: contain; display: block; margin: 0 auto 4px; filter: grayscale(1) contrast(1.45); }
        .ih-co { font-size: 1.55em; font-weight: 900; line-height: 1.12; }
        .ih-sub { font-size: 0.9em; font-weight: 600; }
        .ih-rule { border: 0; border-top: 1.5px solid #000; margin: 5px 0; }
        .ih-rule.dashed { border-top: 1.5px dashed #000; }
        .ih-kv { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; font-weight: 700; }
        .ih-kv .v { font-weight: 800; text-align: left; }
        .ih-kv .v.big { font-size: 1.12em; }
        .ih-items { width: 100%; border-collapse: collapse; margin: 3px 0; }
        .ih-items th { font-weight: 900; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px; text-align: center; }
        .ih-items th.nm, .ih-items td.nm { text-align: right; }
        .ih-items td { padding: 3px; border-bottom: 1px solid #000; font-weight: 700; vertical-align: top; }
        .ih-items td.nm { font-weight: 800; }
        .ih-items td.c { text-align: center; }
        .ih-items td.l { text-align: left; }
        .ih-row { display: flex; justify-content: space-between; gap: 10px; font-weight: 700; margin: 2px 0; }
        .ih-grand { display: flex; justify-content: space-between; align-items: center; border: 2.5px solid #000; padding: 4px 6px; margin: 5px 0; font-size: 1.32em; font-weight: 900; }
        .ih-pay { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.08em; margin: 2px 0; }
        .ih-pay.rm { font-size: 1.18em; border: 1.5px solid #000; padding: 2px 5px; margin-top: 3px; }
        .ih-qr { text-align: center; margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
        .ih-qr img { width: ${thermalSize === "58mm" ? "132px" : "160px"}; height: ${thermalSize === "58mm" ? "132px" : "160px"}; image-rendering: pixelated; object-fit: contain; display: block; margin: 0 auto 3px; }
        .ih-qr .cap { font-weight: 700; font-size: 0.88em; }
        .ih-thanks { text-align: center; font-weight: 800; font-size: 1.05em; margin-top: 6px; }
        .ih-notes { margin-top: 4px; font-weight: 700; }

        @media print {
          @page { size: ${thermalSize} auto; margin: 0; }
          html, body { background: #fff !important; }
          .inv-thermal-wrap { background: #fff !important; min-height: 0 !important; }
          .inv-sheet {
            width: 100% !important;
            margin: 0 !important;
            padding: 2.5mm 3mm !important;
            box-shadow: none !important;
          }
          .inv-sheet * { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
