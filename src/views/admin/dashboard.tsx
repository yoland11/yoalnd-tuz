import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, Bell, CalendarDays, CreditCard, ShoppingBag, DollarSign, Package, Users, Clock, XCircle, Truck, Sparkles,
  CalendarPlus, FileText, ImagePlus, MessageCircle, PlusCircle, UserCheck, Activity,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency, formatMoney } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";

type DashboardData = {
  totalOrders: number; activeOrders: number; cancelledOrders: number; deliveredOrders: number;
  serviceOrders: number; totalProducts: number; totalCustomers: number;
  totalRevenue: number; todayRevenue: number;
  monthlyRevenue: number; remainingTotal: number; partialOrders: number; unpaidOrders: number;
  revenueByDay: { day: string; total: number; orders: number }[];
  statusBreakdown: { status: string; count: number }[];
  topProducts: { productId: number; productName: string; qty: number; revenue: number }[];
  topCustomers: { phone: string; name: string; orderCount: number; totalSpent: number }[];
  bookingsByService: { serviceId: number; serviceName: string; count: number }[];
  topCrews: { crewName: string; count: number }[];
  upcomingBookings: { id: number; trackingCode: string | null; customerName: string; serviceName: string; eventDate: string | null; status: string }[];
  lateOrders: { id: number; trackingCode: string; customerName: string; status: string; createdAt: string }[];
  todayTasks: { bookings: number; late: number; paymentFollowups: number; internalTasks?: number };
  adminOperations?: {
    todayTasks: number;
    newMessages: number;
    newNotifications: number;
    todayBookings: number;
    presentStaffNow: number;
    ordersNeedingFollowup: number;
    recentCustomerActivity: { id: number; action: string; entityLabel: string; phone: string; createdAt: string }[];
  };
  dailyCash?: {
    reportDate: string;
    totalSales: number;
    totalExpenses: number;
    expectedCashBalance: number;
    actualCashInDrawer: number | null;
    difference: number | null;
    status: "balanced" | "surplus" | "shortage" | "not_reconciled";
  } | null;
  financialSummary?: {
    todaySales: number;
    todayExpenses: number;
    todayNetTotal: number;
    monthlyExpenses: number;
    cashBalance: number;
    deliveryFeesTotal: number;
  };
  alerts: { key: string; label: string; count: number }[];
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

type KpiCard = { label: string; value: string; icon: typeof Clock; color: string };

// Signature device: a short gold tick marks every section, encoding "this is a distinct group".
function SectionHeader({ icon: Icon, title, hint }: { icon?: typeof Clock; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="h-4 w-1 rounded-full bg-primary" aria-hidden />
      {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint ? <span className="text-xs text-muted-foreground">• {hint}</span> : null}
    </div>
  );
}

// Metric card: the number leads, the label supports — so a row of cards scans as data, not chrome.
function KpiGrid({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-border/30 bg-card p-4 transition-colors hover:border-primary/30">
          <c.icon className={`h-4 w-4 ${c.color}`} />
          <p className="mt-3 text-xl font-bold leading-none text-foreground">{c.value}</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => adminFetch<DashboardData>("/admin/dashboard"),
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
  const { data: recent } = useQuery({
    queryKey: ["admin", "recent-orders"],
    queryFn: () => adminFetch<RecentOrder[]>("/dashboard/recent-orders"),
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground">لوحة التحكم</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const fmtNum = (n: number) => Number(n || 0).toLocaleString("ar-IQ");
  const net = data.financialSummary?.todayNetTotal ?? 0;
  const todaySales = data.financialSummary?.todaySales ?? data.dailyCash?.totalSales ?? 0;
  const todayExpenses = data.financialSummary?.todayExpenses ?? data.dailyCash?.totalExpenses ?? 0;
  const cashBalance = data.financialSummary?.cashBalance ?? data.dailyCash?.expectedCashBalance ?? 0;
  const dateLabel = new Date().toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" });
  const heroStats = [
    { label: "مبيعات اليوم", value: formatCurrency(todaySales), icon: DollarSign, tone: "text-status-success" },
    { label: "مصاريف اليوم", value: formatCurrency(todayExpenses), icon: CreditCard, tone: "text-status-danger" },
    { label: "رصيد الكاش", value: formatCurrency(cashBalance), icon: CreditCard, tone: "text-primary" },
  ];

  const orderCards: KpiCard[] = [
    { label: "إجمالي الطلبات", value: fmtNum(data.totalOrders), icon: ShoppingBag, color: "text-blue-400" },
    { label: "الطلبات النشطة", value: fmtNum(data.activeOrders), icon: Clock, color: "text-yellow-400" },
    { label: "المسلَّمة", value: fmtNum(data.deliveredOrders), icon: Truck, color: "text-status-success" },
    { label: "الملغية", value: fmtNum(data.cancelledOrders), icon: XCircle, color: "text-status-danger" },
    { label: "طلبات الخدمات", value: fmtNum(data.serviceOrders), icon: Sparkles, color: "text-pink-400" },
    { label: "المنتجات", value: fmtNum(data.totalProducts), icon: Package, color: "text-purple-400" },
    { label: "العملاء", value: fmtNum(data.totalCustomers), icon: Users, color: "text-cyan-400" },
  ];
  const cashCards: KpiCard[] = [
    { label: "مبيعات صندوق اليوم", value: formatCurrency(data.dailyCash?.totalSales ?? 0), icon: DollarSign, color: "text-primary" },
    { label: "رصيد الصندوق المتوقع", value: formatCurrency(data.dailyCash?.expectedCashBalance ?? 0), icon: CreditCard, color: "text-status-success" },
    { label: "فرق الجرد", value: data.dailyCash?.difference == null ? "غير مجرود" : formatCurrency(data.dailyCash.difference), icon: CreditCard, color: data.dailyCash?.status === "shortage" ? "text-status-danger" : "text-primary" },
    { label: "توصيل اليوم", value: formatCurrency(data.financialSummary?.deliveryFeesTotal ?? 0), icon: Truck, color: "text-primary" },
  ];
  const monthCards: KpiCard[] = [
    { label: "إيراد الشهر", value: formatCurrency(data.monthlyRevenue ?? 0), icon: DollarSign, color: "text-status-success" },
    { label: "مصاريف الشهر", value: formatCurrency(data.financialSummary?.monthlyExpenses ?? 0), icon: CreditCard, color: "text-status-warning" },
    { label: "المتبقي على الزبائن", value: formatCurrency(data.remainingTotal ?? 0), icon: CreditCard, color: "text-status-warning" },
    { label: "إجمالي الإيرادات", value: formatCurrency(data.totalRevenue), icon: DollarSign, color: "text-primary" },
  ];

  const pieData = data.statusBreakdown.map(s => ({
    name: STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
  }));
  const shortcuts = [
    { label: "مركز القيادة", href: "/admin/command-center", icon: Activity },
    { label: "إنشاء طلب سريع", href: "/admin/orders?create=product", icon: PlusCircle },
    { label: "إنشاء حجز سريع", href: "/admin/orders?create=service", icon: CalendarPlus },
    { label: "إرسال واتساب سريع", href: "/admin/whatsapp", icon: MessageCircle },
    { label: "طباعة فاتورة", href: "/admin/orders", icon: FileText },
    { label: "إضافة منتج", href: "/admin/products", icon: Package },
    { label: "إضافة صورة للمعرض", href: "/admin/gallery", icon: ImagePlus },
  ];
  const todayWorkItems = [
    ...(data.upcomingBookings ?? []).slice(0, 3).map((booking) => ({
      key: `booking-${booking.id}`,
      title: booking.customerName || "حجز",
      meta: `${booking.serviceName || "خدمة"} • ${booking.eventDate || "اليوم"}`,
      href: "/admin/calendar",
      tone: "text-primary",
    })),
    ...(data.lateOrders ?? []).slice(0, 3).map((order) => ({
      key: `late-${order.id}`,
      title: order.customerName || order.trackingCode,
      meta: `طلب متأخر • ${order.trackingCode}`,
      href: "/admin/orders",
      tone: "text-status-warning",
    })),
    ...((data.todayTasks?.paymentFollowups ?? 0) > 0 ? [{
      key: "payment-followups",
      title: "متابعة المدفوعات",
      meta: `${data.todayTasks.paymentFollowups} طلب يحتاج متابعة دفع`,
      href: "/admin/orders",
      tone: "text-status-success",
    }] : []),
  ].slice(0, 7);

  return (
    <div className="space-y-8">
      {/* Hero — the day's headline figure leads, with the brand's gold as a single hairline accent. */}
      <section className="relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-bl from-primary/10 via-card to-card p-6">
        <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-primary/70 to-transparent" aria-hidden />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">لوحة الإدارة</p>
            <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
            <p className="mt-5 text-sm text-muted-foreground">صافي اليوم</p>
            <p className="mt-1 text-4xl font-bold leading-none text-foreground sm:text-5xl">{formatCurrency(net)}</p>
          </div>
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto">
            {heroStats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border/30 bg-background/40 p-3 lg:min-w-[150px]">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><s.icon className="h-3.5 w-3.5" />{s.label}</div>
                <p className={`mt-1.5 text-base font-bold ${s.tone}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2 border-t border-border/30 pt-4">
          {shortcuts.map((item) => (
            <Link key={item.label} href={item.href} className="inline-flex items-center gap-2 rounded-lg border border-border/30 bg-background/50 px-3 py-2 text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary">
              <item.icon className="h-4 w-4 text-primary" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader icon={Activity} title="نبض العمليات" hint="الآن" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "مهامي اليوم", value: data.adminOperations?.todayTasks ?? data.todayTasks?.internalTasks ?? 0, icon: Clock },
            { label: "رسائل جديدة", value: data.adminOperations?.newMessages ?? 0, icon: MessageCircle },
            { label: "إشعارات جديدة", value: data.adminOperations?.newNotifications ?? 0, icon: Bell },
            { label: "حجوزات اليوم", value: data.adminOperations?.todayBookings ?? data.todayTasks?.bookings ?? 0, icon: CalendarDays },
            { label: "حاضرون الآن", value: data.adminOperations?.presentStaffNow ?? 0, icon: UserCheck },
            { label: "تحتاج متابعة", value: data.adminOperations?.ordersNeedingFollowup ?? 0, icon: Activity },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border/30 bg-card p-4 transition-colors hover:border-primary/30">
              <div className="mb-2 flex items-center gap-2 text-primary">
                <item.icon className="h-4 w-4" />
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </div>
              <p className="text-xl font-bold text-foreground">{Number(item.value).toLocaleString("ar-IQ")}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/30 bg-card p-5">
        <SectionHeader icon={Clock} title="قائمة عمل اليوم" />
        {todayWorkItems.length === 0 ? <EmptyState message="لا توجد مهام عاجلة اليوم" /> : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {todayWorkItems.map((item) => (
              <Link key={item.key} href={item.href} className="rounded-lg bg-background/60 border border-border/25 px-3 py-2 text-sm transition-colors hover:border-primary/40">
                <p className={`font-semibold ${item.tone}`}>{item.title}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.meta}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section><SectionHeader icon={ShoppingBag} title="الطلبات والمخزون" /><KpiGrid cards={orderCards} /></section>
      <section><SectionHeader icon={CreditCard} title="الصندوق وتوصيل اليوم" /><KpiGrid cards={cashCards} /></section>
      <section><SectionHeader icon={DollarSign} title="الشهر والإجمالي" /><KpiGrid cards={monthCards} /></section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border/30 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> إشعارات الإدارة
          </h3>
          {!data.alerts || data.alerts.length === 0 ? <EmptyState message="لا توجد تنبيهات حالياً" /> : (
            <ul className="space-y-2">
              {data.alerts.map((alert) => (
                <li key={alert.key} className="flex items-center justify-between rounded-lg bg-background/60 border border-border/25 px-3 py-2 text-sm">
                  <span className="text-foreground">{alert.label}</span>
                  <span className="text-primary font-bold">{alert.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> مهام اليوم
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-xl font-bold text-foreground">{data.todayTasks?.bookings ?? 0}</p>
              <p className="text-[11px] text-muted-foreground mt-1">حجوزات</p>
            </div>
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-xl font-bold text-status-warning">{data.todayTasks?.late ?? 0}</p>
              <p className="text-[11px] text-muted-foreground mt-1">متأخر</p>
            </div>
            <div className="rounded-lg bg-background/60 border border-border/25 p-3">
              <p className="text-xl font-bold text-primary">{data.todayTasks?.paymentFollowups ?? 0}</p>
              <p className="text-[11px] text-muted-foreground mt-1">دفع</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-warning" /> الطلبات المتأخرة
          </h3>
          {!data.lateOrders || data.lateOrders.length === 0 ? <EmptyState message="لا توجد طلبات متأخرة" /> : (
            <ul className="space-y-2 text-sm">
              {data.lateOrders.slice(0, 5).map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground">{order.trackingCode}</span>
                  <span className="text-xs text-muted-foreground truncate">{order.customerName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> آخر نشاط الزبائن
        </h3>
        {!data.adminOperations?.recentCustomerActivity?.length ? <EmptyState message="لا يوجد نشاط حديث" /> : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.adminOperations.recentCustomerActivity.map((item) => (
              <div key={item.id} className="rounded-lg bg-background/60 border border-border/25 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground">{item.entityLabel || item.action}</span>
                  <span className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{item.phone || "زائر"}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">الإيرادات آخر 30 يوم</h3>
          {data.revenueByDay.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="day" stroke="#888" fontSize={11} tickFormatter={d => d.slice(5)} />
                <YAxis stroke="#888" fontSize={11} tickFormatter={(value) => formatMoney(Number(value))} />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> الحجوزات القادمة
          </h3>
          {!data.upcomingBookings || data.upcomingBookings.length === 0 ? <EmptyState message="لا توجد حجوزات قادمة" /> : (
            <div className="space-y-2">
              {data.upcomingBookings.slice(0, 6).map((booking) => (
                <div key={booking.id} className="rounded-lg bg-background/60 border border-border/25 p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground">{booking.customerName}</p>
                    <p className="text-xs text-muted-foreground">{booking.serviceName}</p>
                  </div>
                  <p className="font-mono text-xs text-primary">{booking.eventDate}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">أكثر كادر محجوز</h3>
          {!data.topCrews || data.topCrews.length === 0 ? <EmptyState message="لا توجد حجوزات كادر بعد" /> : (
            <ul className="space-y-2 text-sm">
              {data.topCrews.map((crew, index) => (
                <li key={crew.crewName} className="flex items-center justify-between">
                  <span className="text-foreground"><span className="text-primary font-bold ml-2">#{index + 1}</span>{crew.crewName}</span>
                  <span className="text-primary font-semibold">{crew.count}</span>
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
