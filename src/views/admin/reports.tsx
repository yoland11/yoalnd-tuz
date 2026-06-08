import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, ShoppingBag, Package, DollarSign,
  BarChart3, PieChart, Calendar, ArrowUp, ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, formatCurrency } from "./_lib";

// ── Types ──────────────────────────────────────────────────────────────────
type SalesSummary = {
  totalSales: number; totalPurchases: number; totalOrders: number;
  totalDelivery?: number; totalOrderGross?: number;
  grossProfit: number; netProfit: number;
  salesCount: number; purchasesCount: number; ordersCount: number;
};
type DailySale = { date: string; revenue: number; cost: number; profit: number; count: number };
type ProductSale = {
  productId: number; productName: string;
  totalQty: number; totalRevenue: number; totalCost: number; profit: number;
};

const TABS = [
  { id: "summary",  label: "ملخص عام",      icon: BarChart3 },
  { id: "daily",    label: "مبيعات يومية",   icon: Calendar },
  { id: "products", label: "أفضل المنتجات",  icon: Package },
];

const THIS_MONTH_FROM = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const [tab, setTab] = useState("summary");
  const [from, setFrom] = useState(THIS_MONTH_FROM);
  const [to, setTo] = useState(TODAY);

  const params = `from=${from}&to=${to}`;

  const { data: summary, isLoading: loadingSummary } = useQuery<SalesSummary>({
    queryKey: ["admin", "reports", "summary", from, to],
    queryFn: () => adminFetch(`/admin/reports/sales-summary?${params}`),
    enabled: tab === "summary",
  });

  const { data: dailyRaw = [], isLoading: loadingDaily } = useQuery<DailySale[]>({
    queryKey: ["admin", "reports", "daily", from, to],
    queryFn: () => adminFetch(`/admin/reports/sales-by-day?${params}`),
    enabled: tab === "daily",
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery<ProductSale[]>({
    queryKey: ["admin", "reports", "products", from, to],
    queryFn: () => adminFetch(`/admin/reports/sales-by-product?${params}`),
    enabled: tab === "products",
  });

  // Bar chart max
  const maxRevenue = useMemo(() => Math.max(...dailyRaw.map(d => d.revenue), 1), [dailyRaw]);

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">التقارير المالية</h1>
        <p className="text-sm text-muted-foreground">تحليل المبيعات والأرباح</p>
      </div>

      {/* Date Range */}
      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border/40 p-4 items-end">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">من تاريخ</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">إلى تاريخ</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-2">
          {[
            { label: "هذا الشهر", from: THIS_MONTH_FROM, to: TODAY },
            { label: "آخر 7 أيام", from: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to: TODAY },
            { label: "هذا العام", from: `${new Date().getFullYear()}-01-01`, to: TODAY },
          ].map(p => (
            <Button key={p.label} variant="outline" size="sm"
              onClick={() => { setFrom(p.from); setTo(p.to); }}
              className="text-xs"
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/20 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary Tab */}
      {tab === "summary" && (
        <div className="space-y-4">
          {loadingSummary
            ? <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}</div>
            : summary && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <StatCard
                      label="إجمالي المبيعات"
                      value={formatCurrency(summary.totalSales)}
                      sub={`${summary.salesCount} فاتورة`}
                      icon={TrendingUp} color="text-emerald-400" bg="bg-emerald-500/10"
                    />
                    <StatCard
                      label="إجمالي المشتريات"
                      value={formatCurrency(summary.totalPurchases)}
                      sub={`${summary.purchasesCount} فاتورة`}
                      icon={TrendingDown} color="text-red-400" bg="bg-red-500/10"
                    />
                    <StatCard
                      label="إيرادات الطلبات"
                      value={formatCurrency(summary.totalOrders)}
                      sub="بدون التوصيل"
                      icon={ShoppingBag} color="text-blue-400" bg="bg-blue-500/10"
                    />
                    <StatCard
                      label="إجمالي التوصيل"
                      value={formatCurrency(summary.totalDelivery ?? 0)}
                      sub="مبلغ مستقل عن الصندوق"
                      icon={Package} color="text-amber-300" bg="bg-amber-500/10"
                    />
                    <StatCard
                      label="إجمالي الطلبات"
                      value={formatCurrency(summary.totalOrderGross ?? summary.totalOrders)}
                      sub={`${summary.ordersCount} طلب شامل التوصيل`}
                      icon={ShoppingBag} color="text-blue-300" bg="bg-blue-500/10"
                    />
                    <StatCard
                      label="إجمالي الإيرادات"
                      value={formatCurrency(summary.totalSales + summary.totalOrders)}
                      sub="مبيعات + طلبات"
                      icon={DollarSign} color="text-primary" bg="bg-primary/10"
                    />
                    <StatCard
                      label="الربح الإجمالي"
                      value={formatCurrency(summary.grossProfit)}
                      sub="قبل المصاريف"
                      icon={summary.grossProfit >= 0 ? ArrowUp : ArrowDown}
                      color={summary.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"}
                      bg={summary.grossProfit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}
                    />
                    <StatCard
                      label="الربح الصافي"
                      value={formatCurrency(summary.netProfit)}
                      sub="بعد كل المصاريف"
                      icon={summary.netProfit >= 0 ? ArrowUp : ArrowDown}
                      color={summary.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}
                      bg={summary.netProfit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}
                    />
                  </div>

                  {/* Profit margin */}
                  {(summary.totalSales + summary.totalOrders) > 0 && (
                    <div className="bg-card rounded-xl border border-border/40 p-4">
                      <h3 className="font-semibold text-sm mb-3">هامش الربح</h3>
                      <div className="space-y-3">
                        {[
                          {
                            label: "هامش الربح الإجمالي",
                            value: (summary.totalSales + summary.totalOrders) > 0
                              ? (summary.grossProfit / (summary.totalSales + summary.totalOrders) * 100).toFixed(1)
                              : "0",
                            color: "bg-emerald-500",
                          },
                          {
                            label: "هامش الربح الصافي",
                            value: (summary.totalSales + summary.totalOrders) > 0
                              ? (summary.netProfit / (summary.totalSales + summary.totalOrders) * 100).toFixed(1)
                              : "0",
                            color: "bg-primary",
                          },
                        ].map(m => (
                          <div key={m.label}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-muted-foreground">{m.label}</span>
                              <span className="font-medium">{m.value}%</span>
                            </div>
                            <div className="w-full bg-muted/30 rounded-full h-2">
                              <div
                                className={`${m.color} h-2 rounded-full transition-all`}
                                style={{ width: `${Math.min(100, Math.max(0, parseFloat(m.value)))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
          }
        </div>
      )}

      {/* Daily Tab */}
      {tab === "daily" && (
        <div className="space-y-4">
          {loadingDaily
            ? <SkeletonCard />
            : dailyRaw.length === 0
              ? <EmptyMsg msg="لا توجد مبيعات في هذه الفترة" />
              : (
                  <>
                    {/* Bar chart */}
                    <div className="bg-card rounded-xl border border-border/40 p-4">
                      <h3 className="font-semibold text-sm mb-4">مخطط المبيعات اليومية</h3>
                      <div className="flex items-end gap-1 h-40 overflow-x-auto pb-2">
                        {dailyRaw.map(d => (
                          <div key={d.date} className="flex flex-col items-center gap-1 min-w-[32px] flex-1">
                            <div className="relative w-full flex flex-col-reverse gap-0.5" style={{ height: "120px" }}>
                              <div
                                className="w-full bg-primary/70 rounded-t transition-all"
                                style={{ height: `${(d.revenue / maxRevenue * 100)}%` }}
                                title={`إيراد: ${formatCurrency(d.revenue)}`}
                              />
                            </div>
                            <span className="text-[9px] text-muted-foreground">{d.date.slice(5)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Table */}
                    <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/30 text-muted-foreground text-xs">
                              <th className="px-4 py-3 text-right">التاريخ</th>
                              <th className="px-4 py-3 text-center">عدد الفواتير</th>
                              <th className="px-4 py-3 text-center">الإيرادات</th>
                              <th className="px-4 py-3 text-center">التكلفة</th>
                              <th className="px-4 py-3 text-center">الربح</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {dailyRaw.map(d => (
                              <tr key={d.date} className="hover:bg-muted/10">
                                <td className="px-4 py-3 font-medium">{d.date}</td>
                                <td className="px-4 py-3 text-center text-muted-foreground">{d.count}</td>
                                <td className="px-4 py-3 text-center text-emerald-400 font-medium">{formatCurrency(d.revenue)}</td>
                                <td className="px-4 py-3 text-center text-red-400">{formatCurrency(d.cost)}</td>
                                <td className={`px-4 py-3 text-center font-bold ${d.profit >= 0 ? "text-primary" : "text-red-400"}`}>
                                  {formatCurrency(d.profit)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-muted/20 font-bold text-sm">
                              <td className="px-4 py-3">الإجمالي</td>
                              <td className="px-4 py-3 text-center">{dailyRaw.reduce((s, d) => s + d.count, 0)}</td>
                              <td className="px-4 py-3 text-center text-emerald-400">
                                {formatCurrency(dailyRaw.reduce((s, d) => s + d.revenue, 0))}
                              </td>
                              <td className="px-4 py-3 text-center text-red-400">
                                {formatCurrency(dailyRaw.reduce((s, d) => s + d.cost, 0))}
                              </td>
                              <td className="px-4 py-3 text-center text-primary">
                                {formatCurrency(dailyRaw.reduce((s, d) => s + d.profit, 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </>
                )
          }
        </div>
      )}

      {/* Products Tab */}
      {tab === "products" && (
        <div>
          {loadingProducts
            ? <SkeletonCard />
            : products.length === 0
              ? <EmptyMsg msg="لا توجد بيانات في هذه الفترة" />
              : (
                  <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 text-muted-foreground text-xs">
                            <th className="px-4 py-3 text-right">#</th>
                            <th className="px-4 py-3 text-right">المنتج</th>
                            <th className="px-4 py-3 text-center">الكمية</th>
                            <th className="px-4 py-3 text-center">الإيرادات</th>
                            <th className="px-4 py-3 text-center">التكلفة</th>
                            <th className="px-4 py-3 text-center">الربح</th>
                            <th className="px-4 py-3 text-center">هامش %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                          {products.map((p, i) => {
                            const margin = p.totalRevenue > 0
                              ? (p.profit / p.totalRevenue * 100).toFixed(1)
                              : "0";
                            return (
                              <tr key={p.productId ?? i} className="hover:bg-muted/10">
                                <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                                <td className="px-4 py-3 font-medium">{p.productName}</td>
                                <td className="px-4 py-3 text-center">{p.totalQty}</td>
                                <td className="px-4 py-3 text-center text-emerald-400 font-medium">
                                  {formatCurrency(p.totalRevenue)}
                                </td>
                                <td className="px-4 py-3 text-center text-red-400">
                                  {formatCurrency(p.totalCost)}
                                </td>
                                <td className={`px-4 py-3 text-center font-bold ${p.profit >= 0 ? "text-primary" : "text-red-400"}`}>
                                  {formatCurrency(p.profit)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <div className="flex items-center gap-2 justify-center">
                                    <span className="text-xs font-medium">{margin}%</span>
                                    <div className="w-16 bg-muted/30 rounded-full h-1.5">
                                      <div
                                        className={`h-1.5 rounded-full ${parseFloat(margin) >= 0 ? "bg-primary" : "bg-red-500"}`}
                                        style={{ width: `${Math.min(100, Math.max(0, Math.abs(parseFloat(margin))))}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
          }
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color, bg }: {
  label: string; value: string; sub?: string;
  icon: any; color: string; bg: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border/40 p-4 flex items-start gap-3">
      <div className={`${bg} ${color} p-2.5 rounded-lg shrink-0`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${color} truncate`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card rounded-xl border border-border/40 p-4 animate-pulse">
      <div className="h-4 bg-muted/30 rounded w-1/3 mb-3" />
      <div className="h-8 bg-muted/30 rounded w-1/2" />
    </div>
  );
}

function EmptyMsg({ msg }: { msg: string }) {
  return (
    <div className="bg-card rounded-xl border border-border/40 py-16 text-center text-muted-foreground text-sm">
      {msg}
    </div>
  );
}
