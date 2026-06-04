import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type QrRow = {
  id: number;
  kind: "order" | "service_order" | "invoice";
  label: string | null;
  customerName: string;
  date: string;
  qr: { token: string; scanUrl: string; dataUrl: string; scanCount?: number };
};

const KIND_LABELS: Record<string, string> = {
  order: "طلب متجر",
  service_order: "حجز خدمة",
  invoice: "فاتورة مبيعات",
};

function downloadDataUrl(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${name}.png`;
  link.click();
}

export default function QrOrdersPage() {
  const printRef = useRef<HTMLDivElement | null>(null);
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
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => downloadDataUrl(row.qr.dataUrl, `ajn-qr-${row.kind}-${row.id}`)} className="gap-1">
                  <Download className="w-3.5 h-3.5" /> تحميل
                </Button>
                <Button asChild size="sm" className="gap-1">
                  <a href={row.qr.scanUrl} target="_blank" rel="noreferrer"><QrCode className="w-3.5 h-3.5" /> فتح</a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
