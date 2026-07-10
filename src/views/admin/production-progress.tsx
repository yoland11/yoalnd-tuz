import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Factory } from "lucide-react";
import { adminFetch, formatCurrency } from "./_lib";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  preparing: "التحضير",
  in_production: "قيد الإنتاج",
  quality_check: "فحص الجودة",
  ready: "جاهز",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

type LinkedOrder = {
  id: number;
  orderNo: string;
  status: string;
  items: Array<{ name: string; quantity: number }>;
  totalCost: number;
  expectedProfit: number;
};

// Reusable read-only panel that shows production orders linked to any booking/order and their
// live manufacturing status. Reuses GET /admin/production?bookingType=&bookingId=.
export function ProductionProgressPanel({ bookingType, bookingId }: { bookingType: string; bookingId: number }) {
  const { data: orders = [], isLoading } = useQuery<LinkedOrder[]>({
    queryKey: ["admin", "production-progress", bookingType, bookingId],
    queryFn: () => adminFetch(`/admin/production?bookingType=${encodeURIComponent(bookingType)}&bookingId=${bookingId}`),
    enabled: Boolean(bookingType && bookingId),
  });

  return (
    <div className="rounded-xl border border-border/30 bg-background/40 p-3" dir="rtl">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Factory className="w-4 h-4 text-primary" /> تقدّم الإنتاج
        </h4>
        <Link href="/admin/production" className="text-[11px] text-primary hover:underline">أوامر الإنتاج ←</Link>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">جارٍ التحميل…</p>
      ) : orders.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا توجد أوامر إنتاج مرتبطة بهذا الحجز.</p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="rounded-lg border border-border/25 bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{o.orderNo}</span>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  {STATUS_LABELS[o.status] ?? o.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {o.items.map((it) => `${it.name} ×${it.quantity}`).join(" · ")}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                التكلفة {formatCurrency(o.totalCost)} · الربح {formatCurrency(o.expectedProfit)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
