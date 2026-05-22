import { useEffect, useRef, useState } from "react";
import { useRoute, useSearch } from "wouter";
import { Printer, ArrowRight, Download } from "lucide-react";
import { adminFetch, fetchAdminMe, hasPerm } from "./_lib";

type InvoiceData = any;

const PAYMENT_LABELS_AR: Record<string, string> = {
  cod: "عند الاستلام",
  transfer: "حوالة",
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

  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await fetchAdminMe();
      if (!alive) return;
      if (!me || !hasPerm(me, "invoices")) {
        window.location.href = `${import.meta.env.BASE_URL}admin/login`;
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
      const html2pdf: any = (await import("html2pdf.js")).default;
      const filename = `${data.kind === "booking" ? "booking" : "invoice"}-${data.trackingCode ?? data.id}.pdf`;
      await html2pdf()
        .set({
          margin:       10,
          filename,
          image:        { type: "jpeg", quality: 0.98 },
          html2canvas:  { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(sheetRef.current)
        .save();
    } catch (e) {
      console.error("PDF export failed", e);
      alert("تعذر تحميل PDF");
    } finally {
      setDownloading(false);
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
        <a href={`${import.meta.env.BASE_URL}admin/dashboard`} className="inline-flex items-center gap-2 text-sm text-neutral-300 hover:text-white">
          <ArrowRight className="w-4 h-4" /> العودة للوحة
        </a>
        <div className="flex items-center gap-2">
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
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AJN</h1>
            <p className="text-sm text-neutral-600">مجموعة علي جان — طوزخورماتو</p>
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
        <div className="bg-neutral-50 border-r-4 border-amber-500 px-4 py-2 mb-6">
          <p className="text-xs text-neutral-500">نوع المستند</p>
          <p className="font-bold">{isBooking ? `فاتورة حجز خدمة — ${data.serviceName}` : "فاتورة طلب من المتجر"}</p>
        </div>

        {/* Customer + meta */}
        <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <p className="text-xs text-neutral-500 mb-1">الزبون</p>
            <p className="font-semibold">{data.customerName}</p>
            <p className="text-neutral-700">{data.customerPhone}</p>
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
                      {item.selectedColor && <span className="text-xs text-neutral-500"> — {item.selectedColor}</span>}
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
                    <div className="flex justify-between bg-amber-50 border border-amber-200 px-3 py-2 rounded font-bold">
                      <span>الإجمالي النهائي</span>
                      <span>{total.toLocaleString('en-US')} د.ع</span>
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
        }
      `}</style>
    </div>
  );
}
