import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Banknote, CalendarDays, CircleDollarSign, ClipboardCheck, RefreshCw, Users, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type ExecutiveData = {
  revenue: { today: number; monthly: number }; cashboxBalance: number; pendingCollections: number; outstandingKoshaBalances: number;
  payrollPending: number; payrollPaid: number; presentToday: number; absentToday: number; outstandingAdvances: number;
  activeBookings: number; lowStock: number; assetsUnderMaintenance: number;
};

const cards = (data: ExecutiveData) => [
  ["إيراد اليوم", formatCurrency(data.revenue?.today ?? 0), "/admin/reports/daily", CircleDollarSign],
  ["إيراد الشهر", formatCurrency(data.revenue?.monthly ?? 0), "/admin/reports", CircleDollarSign],
  ["رصيد الصندوق الرئيسي", formatCurrency(data.cashboxBalance), "/admin/finance/master-cash", WalletCards],
  ["التحصيلات المعلّقة", formatCurrency(data.pendingCollections), "/admin/accounting?tab=receivables", Banknote],
  ["أرصدة الكوشات", formatCurrency(data.outstandingKoshaBalances), "/admin/kosha-collections", CalendarDays],
  ["رواتب بانتظار الصرف", formatCurrency(data.payrollPending), "/admin/hr?tab=payroll&focus=pending", ClipboardCheck],
  ["رواتب مدفوعة", formatCurrency(data.payrollPaid), "/admin/hr?tab=payroll&focus=paid", ClipboardCheck],
  ["الموظفون الحاضرون", Number(data.presentToday ?? 0).toLocaleString("ar-IQ"), "/admin/attendance", Users],
  ["الموظفون الغائبون", Number(data.absentToday ?? 0).toLocaleString("ar-IQ"), "/admin/attendance", Users],
  ["سلف الموظفين", formatCurrency(data.outstandingAdvances), "/admin/employee-advances", Banknote],
  ["الحجوزات النشطة", Number(data.activeBookings ?? 0).toLocaleString("ar-IQ"), "/admin/kosha-bookings", CalendarDays],
  ["المخزون المنخفض", Number(data.lowStock ?? 0).toLocaleString("ar-IQ"), "/admin/inventory-alerts", AlertTriangle],
  ["أصول تحت الصيانة", Number(data.assetsUnderMaintenance ?? 0).toLocaleString("ar-IQ"), "/admin/asset-reports", AlertTriangle],
] as const;

export default function ExecutivePage() {
  const query = useQuery({ queryKey: ["admin", "executive"], queryFn: () => adminFetch<ExecutiveData>("/admin/hr/executive"), staleTime: 30_000, refetchOnWindowFocus: false });
  if (query.isLoading) return <div className="space-y-4" dir="rtl"><Skeleton className="h-20 rounded-xl" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 12 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}</div></div>;
  if (query.isError || !query.data) return <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center" dir="rtl"><p className="font-semibold">تعذر تحميل لوحة القيادة التنفيذية</p><p className="mt-1 text-sm text-muted-foreground">{apiErrorMessage(query.error)}</p><Button className="mt-3" variant="outline" onClick={() => query.refetch()}><RefreshCw className="ms-1 h-4 w-4" />إعادة المحاولة</Button></section>;
  return <div className="space-y-5" dir="rtl"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">لوحة القيادة التنفيذية</h1><p className="mt-1 text-sm text-muted-foreground">مؤشرات الأعمال المهمة فقط، مع ربط مباشر لمصدر كل رقم.</p></div><div className="flex items-center gap-2"><time className="text-xs text-muted-foreground">آخر تحديث: {new Date(query.dataUpdatedAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</time><Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={`ms-1 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />تحديث</Button></div></header><section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{cards(query.data).map(([label, value, href, Icon]) => <Link key={label} href={href} className="min-w-0 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Icon className="h-4 w-4 text-primary" /><p className="mt-3 truncate text-lg font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></Link>)}</section></div>;
}
