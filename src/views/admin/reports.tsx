"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { FileText, TrendingUp, Package, DollarSign, ShoppingBag, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

type ReportTab = "sales" | "purchases" | "products" | "profit" | "accounts";

const CHART_COLORS = ["#C9A84C", "#d4b96c", "#a07c30", "#e8d08c", "#6b5520"];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("sales");
  const TABS: { id: ReportTab; label: string; icon: any }[] = [
    { id: "sales", label: "تقارير المبيعات", icon: ShoppingBag },
    { id: "purchases", label: "تقارير المشتريات", icon: Package },
    { id: "profit", label: "تقارير الأرباح", icon: TrendingUp },
    { id: "products", label: "تقارير المواد", icon: Package },
    { id: "accounts", label: "تقارير الحسابات", icon: DollarSign },
  ];
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">التقارير</h1>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border/30">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors
                ${active ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>
      {tab === "sales" && <SalesReportTab />}
      {tab === "purchases" && <PurchasesReportTab />}
      {tab === "profit" && <ProfitReportTab />}
      {tab === "products" && <ProductsReportTab />}
      {tab === "accounts" && <AccountsReportTab />}
    </div>
  );
}

// ────── Date Filter ──────
function DateFilter({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const inp = "bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";
  const setRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inp} w-36`} dir="ltr" />
      <span className="text-muted-foreground text-sm">إلى</span>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inp} w-36`} dir="ltr" />
      <div className="flex gap-1">
        {[{ label: "اليوم", days: 0 }, { label: "7 أيام", days: 7 }, { label: "30 يوم", days: 30 }, { label: "90 يوم", days: 90 }].map(r => (
          <button key={r.label} onClick={() => r.days === 0 ? (setFrom(todayStr()), setTo(todayStr())) : setRange(r.days)}
            className="px-2 py-1 text-xs rounded-lg bg-card border border-border/30 hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ────── Stats Grid ──────
function StatsGrid({ stats }: { stats: { label: string; value: string; sub?: string; gold?: boolean; green?: boolean; red?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s, i) => (
        <div key={i} className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
          <p className={`font-bold text-xl ${s.gold ? "text-primary" : s.green ? "text-green-400" : s.red ? "text-red-400" : "text-foreground"}`}>{s.value}</p>
          {s.sub && <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ────── Sales Report ──────
function SalesReportTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());

  const { data, isLoading } = useQuery<any>({
    queryKey: ["reports", "sales", from, to],
    queryFn: () => adminFetch<any>(`/admin/reports/sales?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <DateFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {isLoading ? <Skeleton className="h-64" /> : !data ? null : (
        <>
          <StatsGrid stats={[
            { label: "إجمالي الفواتير", value: String(data.totalInvoices ?? 0) },
            { label: "إجمالي المبيعات", value: formatCurrency(data.totalRevenue ?? 0), gold: true },
            { label: "المدفوع", value: formatCurrency(data.totalPaid ?? 0), green: true },
            { label: "غير المسدّد", value: formatCurrency(data.totalUnpaid ?? 0), red: true },
          ]} />
          {data.byDay?.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 p-4">
              <h3 className="font-semibold text-foreground mb-4">المبيعات اليومية</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.byDay} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [formatCurrency(v), "المبيعات"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.3)", borderRadius: 8 }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.byPaymentStatus?.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-card rounded-xl border border-border/30 p-4">
                <h3 className="font-semibold text-foreground mb-4">توزيع حالات الدفع</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={data.byPaymentStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {data.byPaymentStatus.map((_: any, idx: number) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {data.topProducts?.length > 0 && (
                <div className="bg-card rounded-xl border border-border/30 p-4">
                  <h3 className="font-semibold text-foreground mb-3">أكثر المنتجات مبيعاً</h3>
                  <div className="space-y-2">
                    {data.topProducts.slice(0, 8).map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{p.productNameAr || p.productName}</span>
                        <span className="text-primary font-semibold">{p.totalQty} قطعة</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {data.invoices?.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
              <div className="p-4 border-b border-border/20 flex items-center justify-between">
                <h3 className="font-semibold text-foreground">الفواتير ({data.invoices.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-background/50">
                    <tr className="text-muted-foreground border-b border-border/20">
                      <th className="text-right p-3">رقم الفاتورة</th>
                      <th className="text-right p-3">التاريخ</th>
                      <th className="text-right p-3">الزبون</th>
                      <th className="text-right p-3">الإجمالي</th>
                      <th className="text-right p-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {data.invoices.slice(0, 50).map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-background/30">
                        <td className="p-3 font-mono text-primary">{inv.invoiceNo}</td>
                        <td className="p-3 text-muted-foreground">{inv.date}</td>
                        <td className="p-3">{inv.customerName || "—"}</td>
                        <td className="p-3 font-semibold">{formatCurrency(inv.total)}</td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${inv.paymentStatus === "paid" ? "bg-green-500/10 text-green-400" : inv.paymentStatus === "partial" ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400"}`}>
                            {inv.paymentStatus === "paid" ? "مدفوع" : inv.paymentStatus === "partial" ? "جزئي" : "غير مدفوع"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────── Purchases Report ──────
function PurchasesReportTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());

  const { data, isLoading } = useQuery<any>({
    queryKey: ["reports", "purchases", from, to],
    queryFn: () => adminFetch<any>(`/admin/reports/purchases?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <DateFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {isLoading ? <Skeleton className="h-64" /> : !data ? null : (
        <>
          <StatsGrid stats={[
            { label: "إجمالي المشتريات", value: String(data.totalPurchases ?? 0) },
            { label: "إجمالي التكاليف", value: formatCurrency(data.totalCost ?? 0), gold: true },
            { label: "المدفوع", value: formatCurrency(data.totalPaid ?? 0), green: true },
            { label: "المتبقي", value: formatCurrency(data.totalRemaining ?? 0), red: true },
          ]} />
          {data.byDay?.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 p-4">
              <h3 className="font-semibold text-foreground mb-4">المشتريات اليومية</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.byDay} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [formatCurrency(v), "المشتريات"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.3)", borderRadius: 8 }} />
                  <Bar dataKey="total" fill="#a07c30" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────── Profit Report ──────
function ProfitReportTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());

  const { data, isLoading } = useQuery<any>({
    queryKey: ["reports", "profit", from, to],
    queryFn: () => adminFetch<any>(`/admin/reports/profit?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <DateFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {isLoading ? <Skeleton className="h-64" /> : !data ? null : (
        <>
          <StatsGrid stats={[
            { label: "إجمالي المبيعات", value: formatCurrency(data.totalRevenue ?? 0), gold: true },
            { label: "إجمالي المصاريف", value: formatCurrency(data.totalExpenses ?? 0), red: true },
            { label: "صافي الأرباح", value: formatCurrency(data.netProfit ?? 0), green: data.netProfit >= 0, red: data.netProfit < 0 },
            { label: "هامش الربح", value: `${data.margin ?? 0}%` },
          ]} />
          {data.byMonth?.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 p-4">
              <h3 className="font-semibold text-foreground mb-4">الأرباح الشهرية</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                  <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [formatCurrency(v), ""]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.3)", borderRadius: 8 }} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="المبيعات" />
                  <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} dot={false} name="المصاريف" />
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────── Products Report ──────
function ProductsReportTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());

  const { data, isLoading } = useQuery<any>({
    queryKey: ["reports", "products", from, to],
    queryFn: () => adminFetch<any>(`/admin/reports/products?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <DateFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {isLoading ? <Skeleton className="h-64" /> : !data ? null : (
        <>
          <StatsGrid stats={[
            { label: "إجمالي المنتجات", value: String(data.totalProducts ?? 0) },
            { label: "نفاد المخزون", value: String(data.outOfStock ?? 0), red: true },
            { label: "منخفض المخزون", value: String(data.lowStock ?? 0), gold: true },
            { label: "إجمالي قيمة المخزون", value: formatCurrency(data.stockValue ?? 0), gold: true },
          ]} />
          {data.products?.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
              <div className="p-3 border-b border-border/20">
                <h3 className="font-semibold text-foreground">حركة المنتجات</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-background/50">
                    <tr className="text-muted-foreground border-b border-border/20">
                      <th className="text-right p-3">المنتج</th>
                      <th className="text-right p-3">المخزون</th>
                      <th className="text-right p-3">المباع</th>
                      <th className="text-right p-3">الإيراد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {data.products.slice(0, 50).map((p: any) => (
                      <tr key={p.id} className="hover:bg-background/30">
                        <td className="p-3">{p.nameAr}</td>
                        <td className="p-3"><span className={p.stock === 0 ? "text-red-400" : p.stock < 5 ? "text-yellow-400" : "text-green-400"}>{p.stock}</span></td>
                        <td className="p-3">{p.sold ?? 0}</td>
                        <td className="p-3 text-primary">{formatCurrency(p.revenue ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────── Accounts Report ──────
function AccountsReportTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());

  const { data, isLoading } = useQuery<any>({
    queryKey: ["reports", "accounts", from, to],
    queryFn: () => adminFetch<any>(`/admin/reports/accounts?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <DateFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {isLoading ? <Skeleton className="h-64" /> : !data ? null : (
        <>
          <StatsGrid stats={[
            { label: "إجمالي القبض", value: formatCurrency(data.totalReceipts ?? 0), green: true },
            { label: "إجمالي الصرف", value: formatCurrency(data.totalPayments ?? 0), red: true },
            { label: "إجمالي المصاريف", value: formatCurrency(data.totalExpenses ?? 0), red: true },
            { label: "الرصيد الصافي", value: formatCurrency(data.balance ?? 0), gold: data.balance >= 0, red: data.balance < 0 },
          ]} />
          {data.receiptsByDay?.length > 0 && (
            <div className="bg-card rounded-xl border border-border/30 p-4">
              <h3 className="font-semibold text-foreground mb-4">حركة الحسابات اليومية</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.receiptsByDay} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.3)", borderRadius: 8 }} />
                  <Bar dataKey="receipts" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="قبض" />
                  <Bar dataKey="payments" fill="#ef4444" radius={[4, 4, 0, 0]} name="صرف" />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
