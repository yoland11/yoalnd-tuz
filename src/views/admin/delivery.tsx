import { useQuery } from "@tanstack/react-query";
import { useListOrders } from "@workspace/api-client-react";
import { MapPin, ExternalLink, Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAdminMe, formatCurrency, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";
import DeliveryProvinces from "./delivery-provinces";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار", confirmed: "مؤكد", processing: "قيد التجهيز",
  shipped: "في الطريق", delivered: "تم التوصيل", cancelled: "ملغي",
};

export default function DeliveryPage() {
  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: orders, isLoading: oLoading } = useListOrders({});

  const deliveryOrders = (orders ?? []).filter(o => o.status !== "delivered" && o.status !== "cancelled");

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold text-foreground">إدارة التوصيل</h1>

      <DeliveryProvinces me={me ?? null} />

      <section className="bg-card rounded-xl border border-border/30 p-6">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Truck className="w-4 h-4 text-primary" /> الطلبات قيد التوصيل ({deliveryOrders.length})</h2>
        {oLoading ? <Skeleton className="h-40 rounded-lg" /> : deliveryOrders.length === 0 ? <EmptyState message="لا توجد طلبات قيد التوصيل" /> : (
          <div className="space-y-3">
            {deliveryOrders.map(o => {
              const area = o.area ?? null;
              const mapsUrl = (o as { mapsUrl?: string | null }).mapsUrl ?? null;
              const fallbackQuery = [o.governorate, area, o.address].filter(Boolean).join(" ");
              const fallbackMaps = fallbackQuery ? `https://www.google.com/maps/search/${encodeURIComponent(fallbackQuery)}` : null;
              const finalMaps = mapsUrl || fallbackMaps;
              return (
                <div key={o.id} className="bg-background/40 rounded-lg p-4 border border-border/20">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-mono text-sm font-bold text-foreground">{o.trackingCode}</p>
                      <p className="text-sm text-foreground">
                        {o.customerName} —{" "}
                        <a href={`tel:${formatIraqiPhone(o.customerPhone)}`} className="text-primary hover:underline">{formatIraqiPhone(o.customerPhone)}</a>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[o.governorate, area].filter(Boolean).join(" • ") || "—"}
                        {o.address ? ` • ${o.address}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">{STATUS_LABELS[o.status] ?? o.status}</span>
                      <span className="text-primary font-bold">{formatCurrency(o.total)}</span>
                      {finalMaps && (
                        <a href={finalMaps} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20">
                          <MapPin className="w-3.5 h-3.5" /> الخارطة <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

