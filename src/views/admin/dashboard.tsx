import { useQuery } from "@tanstack/react-query";
import {
  ShoppingBag, DollarSign, Package, Users, Clock, XCircle, Truck, Sparkles,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";

type DashboardData = {
  totalOrders: number; activeOrders: number; cancelledOrders: number; deliveredOrders: number;
  serviceOrders: number; totalProducts: number; totalCustomers: number;
  totalRevenue: number; todayRevenue: number;
  revenueByDay: { day: string; total: number; orders: number }[];
  statusBreakdown: { status: string; count: number }[];
  topProducts: { productId: number; productName: string; qty: number; revenue: number }[];
  topCustomers: { phone: string; name: string; orderCount: number; totalSpent: number }[];
  bookingsByService: { serviceId: number; serviceName: string; count: number }[];
};

type RecentOrder = {
  id: number; trackingCode: string; customerName: string; status: string; total: number; createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار", confirmed: "مؤكد", processing: "قيد التجهيز",
  shipped: "في الطريق", delivered: "تم التوصيل", cancelled: "ملغي",
  completed: "مكتمل",
};

const PIE_COLORS = ["#C9A84C", "#E5C77B", "#8B7355", "#4A4A4A", "#6B5A3E", "#A88B4F"];

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => adminFetch<DashboardData>("/admin/dashboard"),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });
  const { data: recent } = useQuery({
    queryKey: ["admin", "recent-orders"],
    queryFn: () => adminFetch<RecentOrder[]>("/dashboard/recent-orders"),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">لوحة التحكم</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const cards = [
    { label: "إجمالي الطلبات", value: data.totalOrders, icon: ShoppingBag, color: "text-blue-400" },
    { label: "الطلبات النشطة", value: data.activeOrders, icon: Clock, color: "text-yellow-400" },
    { label: "المسلَّمة", value: data.deliveredOrders, icon: Truck, color: "text-green-400" },
    { label: "الملغية", value: data.cancelledOrders, icon: XCircle, color: "text-red-400" },
    { label: "طلبات الخدمات", value: data.serviceOrders, icon: Sparkles, color: "text-pink-400" },
    { label: "المنتجات", value: data.totalProducts, icon: Package, color: "text-purple-400" },
    { label: "العملاء", value: data.totalCustomers, icon: Users, color: "text-cyan-400" },
    { label: "الإيرادات", value: formatCurrency(data.totalRevenue), icon: DollarSign, color: "text-primary" },
  ];

  const pieData = data.statusBreakdown.map(s => ({
    name: STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">لوحة التحكم</h1>
        <p className="text-sm text-muted-foreground">إيرادات اليوم: <span className="text-primary font-semibold">{formatCurrency(data.todayRevenue)}</span></p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-card rounded-xl border border-border/30 p-5">
            <div className={`flex items-center gap-2 mb-3 ${c.color}`}>
              <c.icon className="w-5 h-5" />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">الإيرادات آخر 30 يوم</h3>
          {data.revenueByDay.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="day" stroke="#888" fontSize={11} tickFormatter={d => d.slice(5)} />
                <YAxis stroke="#888" fontSize={11} />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #C9A84C", borderRadius: 8 }} />
                <Line type="monotone" dataKey="total" stroke="#C9A84C" strokeWidth={2} dot={{ fill: "#C9A84C" }} name="الإيرادات" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">توزيع حالات الطلبات</h3>
          {pieData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #C9A84C", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">أكثر المنتجات مبيعاً</h3>
          {!data.topProducts || data.topProducts.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2 text-sm">
              {data.topProducts.map((p, i) => (
                <li key={p.productId} className="flex items-center justify-between gap-2">
                  <span className="text-foreground truncate"><span className="text-primary font-bold ml-2">#{i + 1}</span>{p.productName || `#${p.productId}`}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{p.qty} • <span className="text-primary">{formatCurrency(p.revenue)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">أفضل الزبائن</h3>
          {!data.topCustomers || data.topCustomers.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2 text-sm">
              {data.topCustomers.map((c, i) => (
                <li key={c.phone} className="flex items-center justify-between gap-2">
                  <span className="text-foreground truncate"><span className="text-primary font-bold ml-2">#{i + 1}</span>{c.name || formatIraqiPhone(c.phone)}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{c.orderCount} • <span className="text-primary">{formatCurrency(c.totalSpent)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">الحجوزات حسب الخدمة</h3>
          {!data.bookingsByService || data.bookingsByService.length === 0 ? <EmptyState /> : (
            <ul className="space-y-2 text-sm">
              {data.bookingsByService.map(s => (
                <li key={s.serviceId} className="flex items-center justify-between">
                  <span className="text-foreground">{s.serviceName || `#${s.serviceId}`}</span>
                  <span className="text-primary font-semibold">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">أحدث الطلبات</h3>
        {!recent || recent.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right pb-3 font-medium">رمز التتبع</th>
                  <th className="text-right pb-3 font-medium">الزبون</th>
                  <th className="text-right pb-3 font-medium">الإجمالي</th>
                  <th className="text-right pb-3 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {recent.slice(0, 8).map(o => (
                  <tr key={o.id}>
                    <td className="py-3 font-mono text-xs text-foreground">{o.trackingCode}</td>
                    <td className="py-3 text-foreground">{o.customerName}</td>
                    <td className="py-3 text-primary font-medium">{formatCurrency(o.total)}</td>
                    <td className="py-3">
                      <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                        {STATUS_LABELS[o.status] ?? o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
