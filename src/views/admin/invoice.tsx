import { useEffect, useRef, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { Printer, ArrowRight, Download, QrCode } from "lucide-react";
import { adminFetch, fetchAdminMe, hasPerm } from "./_lib";
import { formatIraqiPhone } from "@/lib/phone";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { SelectedColorLabel } from "@/components/product-colors";
import { downloadElementPdf } from "@/lib/pdf";
import { downloadDataUrl, openQrPrintWindow } from "./print-helpers";

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
      const filename = `${data.kind === "booking" ? "booking" : "invoice"}-${data.trackingCode ?? data.id}.pdf`;
      await downloadElementPdf(sheetRef.current, filename);
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

  return (
    <div className="invoice-page min-h-screen bg-white text-black" dir="rtl">
      {/* Toolbar (hidden on print/PDF) */}
      <div className="print:hidden bg-neutral-900 text-white p-3 flex items-center justify-between sticky top-0 z-10">
        <a href="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-neutral-300 hover:text-white">
          <ArrowRight className="w-4 h-4" /> العودة للوحة
        </a>
        <div className="flex items-center gap-2">
          <button
            onClick={printQrOnly}
            className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors"
          >
            <QrCode className="w-4 h-4" /> طباعة QR
          </button>
          <button
            onClick={downloadQrImage}
            className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors"
          >
            <Download className="w-4 h-4" /> تحميل QR
          </button>
          <button
            onClick={downloadPdf}
            disabled={downloading}
            className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors disabled:opacity-60"
          >
            <Download className="w-4 h-4" /> {downloading ? "جاري التحميل..." : "تحميل PDF"}
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 bg-amber-400 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-300 transition-colors"
          >
            <Printer className="w-4 h-4" /> طباعة
          </button>
        </div>
      </div>

      <div ref={sheetRef} className="invoice-sheet max-w-3xl mx-auto p-8 print:p-6 bg-white text-black">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-amber-500 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={96} height={56} decoding="async" className="h-14 w-24 object-contain" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{settings?.site_name ?? "AJN"}</h1>
              <p className="text-sm text-neutral-600">{settings?.address || "مجموعة علي جان — طوزخورماتو"}</p>
            </div>
          </div>
          <div className="text-left">
            <p className="text-xs text-neutral-500">{isBooking ? "رقم الحجز" : "رقم الفاتورة"}</p>
            <p className="text-xl font-mono font-bold">{data.trackingCode ?? "—"}</p>
            <p className="text-xs text-neutral-500 mt-1">
              {new Date(data.createdAt).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Title strip */}
        <div className="bg-amber-50/60 border border-amber-200 rounded px-4 py-2 mb-6">
          <p className="text-xs text-neutral-500">نوع المستند</p>
          <p className="font-bold">{isBooking ? `فاتورة حجز خدمة — ${data.serviceName}` : "فاتورة طلب من المتجر"}</p>
        </div>

        {/* Customer + meta */}
        <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <p className="text-xs text-neutral-500 mb-1">الزبون</p>
            <p className="font-semibold">{data.customerName}</p>
            <p className="text-neutral-700">{formatIraqiPhone(data.customerPhone)}</p>
          </div>
          {isBooking ? (
            <div>
              <p className="text-xs text-neutral-500 mb-1">تفاصيل المناسبة</p>
              <p className="font-semibold">{data.eventDate ?? "—"}</p>
              <p className="text-neutral-700">{data.eventLocation ?? ""}</p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-neutral-500 mb-1">عنوان التوصيل</p>
              <p className="font-semibold">
                {data.governorate ?? "—"}{data.area ? ` — ${data.area}` : ""}
              </p>
              <p className="text-neutral-700">{data.address ?? ""}</p>
              <p className="text-xs text-neutral-500 mt-2">
                طريقة الدفع: <span className="text-neutral-800 font-medium">{PAYMENT_LABELS_AR[data.paymentMethod ?? "cod"] ?? "—"}</span>
              </p>
            </div>
          )}
        </div>

        {isBooking ? (
          <>
            {/* Booking summary table */}
            <table className="w-full text-sm mb-6 border-collapse">
              <thead>
                <tr className="bg-neutral-100 text-right">
                  <th className="border border-neutral-300 px-3 py-2 font-medium">الخدمة</th>
                  <th className="border border-neutral-300 px-3 py-2 font-medium w-40 text-center">تاريخ المناسبة</th>
                  <th className="border border-neutral-300 px-3 py-2 font-medium w-32 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-neutral-300 px-3 py-2">{data.serviceName}</td>
                  <td className="border border-neutral-300 px-3 py-2 text-center">{data.eventDate ?? "—"}</td>
                  <td className="border border-neutral-300 px-3 py-2 text-center">{data.status}</td>
                </tr>
              </tbody>
            </table>

            {/* Booking totals */}
            <div className="flex justify-end mb-8">
              <div className="w-72 space-y-2 text-sm">
                <div className="flex justify-between border-b border-neutral-200 pb-2">
                  <span className="text-neutral-600">السعر المتفق عليه</span>
                  <span>{data.price > 0 ? `${Number(data.price).toLocaleString('en-US')} د.ع` : "—"}</span>
                </div>
                <div className="flex justify-between border-b border-neutral-200 pb-2">
                  <span className="text-neutral-600">العربون المدفوع</span>
                  <span>{data.deposit > 0 ? `${Number(data.deposit).toLocaleString('en-US')} د.ع` : "—"}</span>
                </div>
                <div className="flex justify-between border-b border-neutral-200 pb-2">
                  <span className="text-neutral-600">حالة الدفع</span>
                  <span>{PAYMENT_STATUS_AR[data.paymentStatus ?? "unpaid"] ?? "غير مدفوع"}</span>
                </div>
                <div className="flex justify-between bg-amber-50 border border-amber-200 px-3 py-2 rounded font-bold">
                  <span>المتبقي</span>
                  <span>{data.price > 0 ? `${Number(data.balance).toLocaleString('en-US')} د.ع` : "—"}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Items */}
            <table className="w-full text-sm mb-6 border-collapse">
              <thead>
                <tr className="bg-neutral-100 text-right">
                  <th className="border border-neutral-300 px-3 py-2 font-medium">المنتج</th>
                  <th className="border border-neutral-300 px-3 py-2 font-medium w-16 text-center">الكمية</th>
                  <th className="border border-neutral-300 px-3 py-2 font-medium w-28 text-center">السعر</th>
                  <th className="border border-neutral-300 px-3 py-2 font-medium w-28 text-center">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {data.items?.map((item: any) => (
                  <tr key={item.id}>
                    <td className="border border-neutral-300 px-3 py-2">
                      {item.productNameAr || item.productName}
                      <SelectedColorLabel
                        color={item.selectedColorData}
                        fallback={item.selectedColor}
                        className="mr-2 inline-flex text-xs text-neutral-500"
                      />
                    </td>
                    <td className="border border-neutral-300 px-3 py-2 text-center">{item.quantity}</td>
                    <td className="border border-neutral-300 px-3 py-2 text-center">{Number(item.price).toLocaleString('en-US')}</td>
                    <td className="border border-neutral-300 px-3 py-2 text-center">{(item.price * item.quantity).toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Order totals */}
            {(() => {
              const subtotal = (data.items ?? []).reduce((s: number, i: any) => s + i.price * i.quantity, 0);
              const deliveryFee = Number(data.deliveryFee ?? 0);
              const total = Number(data.total);
              return (
                <div className="flex justify-end mb-8">
                  <div className="w-72 space-y-2 text-sm">
                    <div className="flex justify-between border-b border-neutral-200 pb-2">
                      <span className="text-neutral-600">المجموع</span>
                      <span>{subtotal.toLocaleString('en-US')} د.ع</span>
                    </div>
                    <div className="flex justify-between border-b border-neutral-200 pb-2">
                      <span className="text-neutral-600">رسوم التوصيل</span>
                      <span>{deliveryFee.toLocaleString('en-US')} د.ع</span>
                    </div>
                    <div className="flex justify-between border-b border-neutral-200 pb-2">
                      <span className="text-neutral-600">العربون</span>
                      <span>{Number(data.depositAmount ?? 0).toLocaleString('en-US')} د.ع</span>
                    </div>
                    <div className="flex justify-between border-b border-neutral-200 pb-2">
                      <span className="text-neutral-600">حالة الدفع</span>
                      <span>{PAYMENT_STATUS_AR[data.paymentStatus ?? "unpaid"] ?? "غير مدفوع"}</span>
                    </div>
                    <div className="flex justify-between bg-amber-50 border border-amber-200 px-3 py-2 rounded font-bold">
                      <span>المتبقي</span>
                      <span>{Number(data.remainingAmount ?? total).toLocaleString('en-US')} د.ع</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {data.notes && (
          <div className="mb-6 p-3 bg-neutral-50 border border-neutral-200 rounded text-sm">
            <p className="text-xs text-neutral-500 mb-1">ملاحظات</p>
            <p>{data.notes}</p>
          </div>
        )}

        {data.qr?.dataUrl && (
          <div className="mb-6 text-center">
            <img
              src={data.qr.dataUrl}
              alt="QR"
              className="qr-code mx-auto h-[120px] w-[120px] object-contain"
              width={120}
              height={120}
              decoding="async"
            />
            <p className="text-xs text-neutral-500 mt-2">امسح الرمز لفتح التتبع</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t-2 border-amber-500 pt-4 mt-8 text-center text-xs text-neutral-600">
          <p>شكراً لاختياركم مجموعة علي جان</p>
          <p className="mt-1">للاستفسار: 07701234567</p>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .invoice-sheet, .invoice-sheet * {
            color: #000 !important;
            text-shadow: none !important;
            box-shadow: none !important;
          }
          .invoice-sheet table,
          .invoice-sheet th,
          .invoice-sheet td {
            border-color: #000 !important;
          }
          .invoice-sheet th,
          .invoice-sheet .font-bold,
          .invoice-sheet .font-semibold {
            font-weight: 700 !important;
          }
          img.qr-code {
            display: block !important;
            width: 120px !important;
            height: 120px !important;
            image-rendering: pixelated;
          }
        }
      `}</style>
    </div>
  );
}
