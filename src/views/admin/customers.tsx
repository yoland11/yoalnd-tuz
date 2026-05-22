import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, ShoppingBag, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type Customer = {
  id: number; name: string; phone: string; role: string;
  createdAt: string; orderCount: number; totalSpent: number;
};

type CustomerDetail = Customer & {
  orders: { id: number; trackingCode: string; status: string; total: number; createdAt: string }[];
  serviceOrders: { id: number; trackingCode: string | null; status: string; createdAt: string }[];
};

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "customers", search],
    queryFn: () => adminFetch<Customer[]>(`/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["admin", "customer", selectedId],
    queryFn: () => adminFetch<CustomerDetail>(`/admin/customers/${selectedId}`),
    enabled: selectedId !== null,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">العملاء</h1>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم أو هاتف..."
          className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
      </div>

      {isLoading ? <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      : !data || data.length === 0 ? <EmptyState message="لا يوجد عملاء" /> : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-background/50">
              <tr className="text-muted-foreground border-b border-border/30">
                <th className="text-right p-3 font-medium">الاسم</th>
                <th className="text-right p-3 font-medium">الهاتف</th>
                <th className="text-right p-3 font-medium">عدد الطلبات</th>
                <th className="text-right p-3 font-medium">الإنفاق الإجمالي</th>
                <th className="text-right p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {data.map(c => (
                <tr key={c.id} className="hover:bg-background/30 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                  <td className="p-3 text-foreground">{c.name || "—"}</td>
                  <td className="p-3 text-muted-foreground" dir="ltr">{c.phone}</td>
                  <td className="p-3"><span className="text-primary font-semibold">{c.orderCount}</span></td>
                  <td className="p-3 text-primary">{formatCurrency(c.totalSpent)}</td>
                  <td className="p-3 text-xs text-primary">عرض ←</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setSelectedId(null)}>
          <div className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border/30">
              <h3 className="font-bold text-foreground">تفاصيل العميل</h3>
              <button onClick={() => setSelectedId(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            {!detail ? <div className="p-6"><Skeleton className="h-40" /></div> : (
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <Info label="الاسم" value={detail.name || "—"} />
                  <Info label="الهاتف" value={detail.phone} ltr />
                  <Info label="منذ" value={new Date(detail.createdAt).toLocaleDateString("ar-IQ")} />
                  <Info label="النوع" value={detail.role} />
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-primary" /> طلبات المتجر ({detail.orders.length})</h4>
                  {detail.orders.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد طلبات</p> : (
                    <div className="space-y-2">
                      {detail.orders.map(o => (
                        <div key={o.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="font-mono text-xs text-foreground">{o.trackingCode}</p>
                            <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("ar-IQ")}</p>
                          </div>
                          <div className="text-left">
                            <p className="text-primary font-semibold text-sm">{formatCurrency(o.total)}</p>
                            <p className="text-xs text-muted-foreground">{o.status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> حجوزات الخدمات ({detail.serviceOrders.length})</h4>
                  {detail.serviceOrders.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد حجوزات</p> : (
                    <div className="space-y-2">
                      {detail.serviceOrders.map(o => (
                        <div key={o.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="font-mono text-xs text-foreground">{o.trackingCode ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("ar-IQ")}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{o.status}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground ${ltr ? "font-mono" : ""}`} dir={ltr ? "ltr" : undefined}>{value}</p>
    </div>
  );
}
