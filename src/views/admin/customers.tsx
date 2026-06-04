import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Search, X, ShoppingBag, Sparkles, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";
import { useToast } from "@/hooks/use-toast";

type Customer = {
  id: number; name: string; phone: string; role: string;
  createdAt: string; orderCount: number; totalSpent: number;
  rewardPoints?: number; rewardLevelLabel?: string;
};

type CustomerDetail = Customer & {
  orders: { id: number; trackingCode: string; status: string; total: number; createdAt: string }[];
  serviceOrders: { id: number; trackingCode: string | null; status: string; createdAt: string }[];
  activity?: { id: number; action: string; entityLabel: string; entityType: string; createdAt: string }[];
};

const ACTIVITY_LABELS: Record<string, string> = {
  visit: "زيارة",
  product_open: "فتح منتج",
  category_open: "فتح قسم",
  add_cart: "إضافة للسلة",
  remove_cart: "إزالة من السلة",
  checkout: "الدفع",
  message_sent: "إرسال رسالة",
  track_page: "فتح التتبع",
};

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsNote, setPointsNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "customers", search],
    queryFn: () => adminFetch<Customer[]>(`/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["admin", "customer", selectedId],
    queryFn: () => adminFetch<CustomerDetail>(`/admin/customers/${selectedId}`),
    enabled: selectedId !== null,
  });
  const updateRewards = useMutation({
    mutationFn: (body: { pointsDelta: number; note: string }) =>
      adminFetch(`/admin/customers/${selectedId}/rewards`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "customer", selectedId] });
      setPointsDelta("");
      setPointsNote("");
      toast({ title: "تم تحديث نقاط الزبون" });
    },
    onError: (err: any) => toast({ title: "تعذر تحديث النقاط", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">العملاء</h1>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(formatIraqiPhoneInput(e.target.value) || e.target.value)}
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
                <th className="text-right p-3 font-medium">النقاط</th>
                <th className="text-right p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {data.map(c => (
                <tr key={c.id} className="hover:bg-background/30 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                  <td className="p-3 text-foreground">{c.name || "—"}</td>
                  <td className="p-3 text-muted-foreground" dir="ltr">{formatIraqiPhone(c.phone)}</td>
                  <td className="p-3"><span className="text-primary font-semibold">{c.orderCount}</span></td>
                  <td className="p-3 text-primary">{formatCurrency(c.totalSpent)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{(c.rewardPoints ?? 0).toLocaleString("ar-IQ")} نقطة</td>
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
                  <Info label="الهاتف" value={formatIraqiPhone(detail.phone)} ltr />
                  <Info label="منذ" value={new Date(detail.createdAt).toLocaleDateString("ar-IQ")} />
                  <Info label="النوع" value={detail.role} />
                  <Info label="المستوى" value={`${detail.rewardLevelLabel ?? "برونزي"} · ${(detail.rewardPoints ?? 0).toLocaleString("ar-IQ")} نقطة`} />
                </div>

                <div className="rounded-xl bg-background/40 border border-border/25 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-primary" /> إدارة النقاط
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-2">
                    <input
                      value={pointsDelta}
                      onChange={(e) => setPointsDelta(e.target.value.replace(/[^\d-]/g, ""))}
                      inputMode="numeric"
                      placeholder="+50"
                      className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                    <input
                      value={pointsNote}
                      onChange={(e) => setPointsNote(e.target.value)}
                      placeholder="سبب التعديل"
                      className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                    <button
                      type="button"
                      disabled={updateRewards.isPending || !Number(pointsDelta)}
                      onClick={() => updateRewards.mutate({ pointsDelta: Number(pointsDelta), note: pointsNote || "تعديل من الإدارة" })}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20 disabled:opacity-60"
                    >
                      حفظ
                    </button>
                  </div>
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

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> سجل النشاط</h4>
                  {!detail.activity?.length ? <p className="text-xs text-muted-foreground">لا يوجد نشاط حديث</p> : (
                    <div className="space-y-2">
                      {detail.activity.slice(0, 8).map((item) => (
                        <div key={item.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="text-sm text-foreground">{item.entityLabel || item.entityType || ACTIVITY_LABELS[item.action] || item.action}</p>
                            <p className="text-xs text-muted-foreground">{ACTIVITY_LABELS[item.action] || item.action}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
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
