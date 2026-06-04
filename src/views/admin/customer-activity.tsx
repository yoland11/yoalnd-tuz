import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";

type ActivityRow = {
  id: number;
  customerId: number | null;
  sessionId: string;
  phone: string;
  action: string;
  entityType: string;
  entityId: number | null;
  entityLabel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  visit: "زيارة",
  product_open: "فتح منتج",
  category_open: "فتح قسم",
  add_cart: "إضافة للسلة",
  remove_cart: "إزالة من السلة",
  checkout: "الدفع",
  order_cancel: "إلغاء طلب",
  message_sent: "إرسال رسالة",
  coupon_apply: "استخدام كوبون",
  track_page: "فتح التتبع",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CustomerActivityPage() {
  const [filters, setFilters] = useState({ action: "", from: "", to: "", search: "" });
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params.toString();
  }, [filters.action, filters.from, filters.to]);

  const { data, isLoading } = useQuery<ActivityRow[]>({
    queryKey: ["admin", "customer-activity", queryString],
    queryFn: () => adminFetch(`/admin/customer-activity${queryString ? `?${queryString}` : ""}`),
    staleTime: 20_000,
  });

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const list = data ?? [];
    if (!q) return list;
    return list.filter((row) =>
      row.phone.includes(q) ||
      row.sessionId.toLowerCase().includes(q) ||
      row.action.toLowerCase().includes(q) ||
      row.entityLabel.toLowerCase().includes(q)
    );
  }, [data, filters.search]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">سجل نشاط الزبائن</h1>
          <p className="text-sm text-muted-foreground mt-1">متابعة تفاعل الزبون مع المتجر والتتبع والرسائل بدون حفظ بيانات حساسة.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-muted-foreground">
          <Activity className="w-4 h-4 text-primary" />
          {rows.length.toLocaleString("ar-IQ")} نشاط
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="بحث بالهاتف أو الجلسة أو العنصر..."
              className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الأنشطة</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
        </div>
        <Button type="button" variant="outline" onClick={() => setFilters({ action: "", from: "", to: "", search: "" })} className="gap-2">
          <Filter className="w-4 h-4" /> إعادة التصفية
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد نشاط مطابق" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">الوقت</th>
                  <th className="text-right p-3 font-medium">النشاط</th>
                  <th className="text-right p-3 font-medium">الزبون</th>
                  <th className="text-right p-3 font-medium">العنصر</th>
                  <th className="text-right p-3 font-medium">الجلسة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs">{ACTION_LABELS[row.action] ?? row.action}</span>
                    </td>
                    <td className="p-3 text-foreground whitespace-nowrap">{formatIraqiPhone(row.phone) || row.phone || `زبون #${row.customerId ?? "—"}`}</td>
                    <td className="p-3 text-muted-foreground">{row.entityLabel || row.entityType || "—"}</td>
                    <td className="p-3 text-muted-foreground font-mono text-xs">{row.sessionId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
