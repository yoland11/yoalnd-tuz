import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Printer, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { downloadDataUrl, openQrPrintWindow } from "./print-helpers";

type QrRow = {
  id: number;
  kind: "order" | "service_order" | "invoice";
  label: string | null;
  customerName: string;
  amount?: number;
  status?: string;
  paymentStatus?: string;
  date: string;
  qr: { token: string; targetUrl: string; scanUrl: string; dataUrl: string; scanCount?: number };
};

const KIND_LABELS: Record<string, string> = {
  order: "طلب متجر",
  service_order: "حجز خدمة",
  invoice: "فاتورة مبيعات",
};

const PAYMENT_LABELS: Record<string, string> = {
  paid: "مدفوع",
  partial: "جزئي",
  unpaid: "غير مدفوع",
};

export default function QrOrdersPage() {
  const printRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<QrRow | null>(null);
  const { data, isLoading } = useQuery<QrRow[]>({
    queryKey: ["admin", "qr-orders"],
    queryFn: () => adminFetch("/admin/qr-orders"),
    staleTime: 60_000,
  });

  function printAll() {
    const html = printRef.current?.innerHTML ?? "";
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`
      <html dir="rtl"><head><title>QR</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;direction:rtl}
        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
        .card{border:1px solid #ddd;border-radius:12px;padding:12px;text-align:center;break-inside:avoid}
        img{width:140px;height:140px;object-fit:contain}
        p{margin:4px 0;font-size:12px}
        .no-print{display:none!important}
      </style></head><body><div class="grid">${html}</div></body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">QR الطلبات والفواتير</h1>
          <p className="text-sm text-muted-foreground mt-1">طباعة وتحميل رموز QR الآمنة للتتبع والفواتير.</p>
        </div>
        <Button type="button" variant="outline" onClick={printAll} className="gap-2">
          <Printer className="w-4 h-4" /> طباعة الكل
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-64 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <EmptyState message="لا توجد رموز QR بعد" />
      ) : (
        <div ref={printRef} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.map((row) => (
            <div key={`${row.kind}-${row.id}`} className="card bg-card rounded-xl border border-border/30 p-4 text-center">
              <div className="mx-auto w-36 h-36 rounded-xl bg-white p-2">
                <img src={row.qr.dataUrl} alt="QR" className="w-full h-full object-contain" />
              </div>
              <p className="mt-3 text-xs text-primary font-medium">{KIND_LABELS[row.kind] ?? row.kind}</p>
              <p className="text-sm font-semibold text-foreground font-mono">{row.label ?? `#${row.id}`}</p>
              <p className="text-xs text-muted-foreground truncate">{row.customerName || "بدون اسم"}</p>
              <div className="no-print mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => downloadDataUrl(row.qr.dataUrl, `ajn-qr-${row.kind}-${row.id}.png`)} className="gap-1">
                  <Download className="w-3.5 h-3.5" /> تحميل
                </Button>
                <Button type="button" size="sm" onClick={() => setSelected(row)} className="gap-1">
                  <QrCode className="w-3.5 h-3.5" /> فتح
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <QrDetailsModal row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function QrDetailsModal({ row, onClose }: { row: QrRow; onClose: () => void }) {
  const customerTrackUrl = row.qr.targetUrl || `/track/${row.qr.token}`;

  function printQr() {
    try {
      openQrPrintWindow({
        qrDataUrl: row.qr.dataUrl,
        customerName: row.customerName,
        amount: row.amount,
        title: KIND_LABELS[row.kind] ?? "QR",
        paperSize: "80mm",
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "تعذر طباعة QR");
    }
  }

  function downloadQr() {
    try {
      downloadDataUrl(row.qr.dataUrl, `ajn-qr-${row.kind}-${row.id}.png`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "تعذر تحميل QR");
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="إغلاق" />
      <div className="relative w-full max-w-2xl bg-card border border-border/40 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/30">
          <div>
            <h2 className="text-lg font-bold text-foreground">تفاصيل QR</h2>
            <p className="text-xs text-muted-foreground">هذا العرض للإدارة فقط، أما مسح QR بالكاميرا يفتح تتبع الزبون.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
          <div className="text-center">
            <div className="mx-auto w-52 h-52 rounded-xl bg-white p-3">
              <img src={row.qr.dataUrl} alt="QR" className="w-full h-full object-contain" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">عند المسح بالكاميرا يفتح تتبع الزبون فقط</p>
          </div>

          <div className="space-y-3">
            <DetailRow label="النوع" value={KIND_LABELS[row.kind] ?? row.kind} />
            <DetailRow label="الرقم" value={row.label ?? `#${row.id}`} mono />
            <DetailRow label="العميل" value={row.customerName || "بدون اسم"} />
            <DetailRow label="المبلغ" value={row.amount ? formatCurrency(row.amount) : "—"} />
            <DetailRow label="الحالة" value={row.status || "—"} />
            <DetailRow label="الدفع" value={PAYMENT_LABELS[row.paymentStatus ?? ""] ?? row.paymentStatus ?? "—"} />
            <DetailRow label="التاريخ" value={new Date(row.date).toLocaleString("ar-IQ")} />
            <DetailRow label="التوكن" value={`${row.qr.token.slice(0, 10)}…${row.qr.token.slice(-8)}`} mono />

            <div className="pt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button type="button" onClick={printQr} className="gap-2 bg-primary text-black hover:bg-primary/90">
                <Printer className="w-4 h-4" /> طباعة
              </Button>
              <Button type="button" variant="outline" onClick={downloadQr} className="gap-2">
                <Download className="w-4 h-4" /> تحميل
              </Button>
              <Button asChild type="button" variant="outline" className="gap-2">
                <a href={customerTrackUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4" /> تتبع الزبون
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground text-left break-words ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
    </div>
  );
}
