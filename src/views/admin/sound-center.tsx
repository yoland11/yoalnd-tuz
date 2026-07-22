import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, Banknote, Boxes, CalendarDays, ChevronLeft, CircleDollarSign,
  Clock3, Headphones, MapPin, PackageCheck, RefreshCw, Search, Speaker,
  Truck, Users, Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency } from "./_lib";

type SoundProduct = {
  productId: number; name: string; quantity: number; barcode?: string | null;
  serialNumber?: string | null; assetNumber?: string | null; isAsset?: boolean;
};
type SoundAsset = {
  productId: number; name: string; assetNumber: string; barcode?: string | null;
  qr?: string | null; warehouse?: string | null; stage: string; maintenance?: boolean;
};
type SoundBooking = {
  id: number; bookingId: string; source: "service" | "kosha"; sourceType: string;
  sourceReference?: string | null; customer: string; phone: string; eventDate: string;
  startTime: string; endTime: string; location: string; status: string;
  paid: number; remaining: number; total: number; paymentStatus: string;
  products: SoundProduct[]; assets: SoundAsset[];
  team: Array<{ id?: number | null; name: string; role: string }>;
  vehicles: string[]; warehouse: string; warehouseStatus: string; alerts: string[];
  profit: number; detailHref: string;
};
type SoundCenterResponse = {
  data: SoundBooking[];
  summary: { total: number; today: number; pending: number; equipmentOut: number; lateReturns: number; revenue: number; profit: number };
  sources: string[];
};

const STATUS_LABELS: Record<string, string> = {
  booked: "تم الحجز", preparing: "قيد التجهيز", ready: "جاهز", loaded: "تم التحميل",
  on_the_way: "في الطريق", installing: "جاري التنصيب", completed: "مكتمل",
  returned: "تمت الإعادة", cancelled: "ملغي",
};
const SOURCE_LABELS: Record<string, string> = {
  store: "طلب متجر", sales_invoice: "فاتورة مبيعات", rental: "إيجار",
  admin_booking: "حجز إداري", website: "الموقع", mobile: "تطبيق الهاتف",
  asset_reservation: "حجز أصل", warehouse_reservation: "حجز مستودع", manual: "يدوي",
};
const WAREHOUSE_LABELS: Record<string, string> = {
  reserved: "محجوز", picked: "تم التجهيز", loaded: "تم التحميل", out: "خرج من المستودع",
  returned: "تمت الإعادة", inspection: "قيد الفحص", completed: "مكتمل",
};

function statusTone(status: string) {
  if (["ready", "returned", "completed"].includes(status)) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "cancelled") return "border-destructive/25 bg-destructive/10 text-destructive";
  if (["preparing", "loaded", "installing"].includes(status)) return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function StatCard({ label, value, hint, icon: Icon, tone = "text-primary" }: { label: string; value: string | number; hint: string; icon: typeof Speaker; tone?: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>
        <div className={`rounded-lg bg-muted p-2.5 ${tone}`}><Icon className="h-5 w-5" /></div>
      </CardContent>
    </Card>
  );
}

function BookingCard({ booking }: { booking: SoundBooking }) {
  return (
    <Card className="overflow-hidden shadow-sm">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/25 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={booking.detailHref} className="font-bold text-primary hover:underline">{booking.bookingId}</Link>
              <Badge variant="outline">{SOURCE_LABELS[booking.sourceType] ?? booking.sourceType}</Badge>
              <Badge variant="outline" className={statusTone(booking.status)}>{STATUS_LABELS[booking.status] ?? booking.status}</Badge>
              <Badge className="gap-1 bg-violet-600 text-white hover:bg-violet-600"><Speaker className="h-3 w-3" /> صوتيات</Badge>
            </div>
            <p className="mt-2 font-semibold">{booking.customer}</p>
            <p className="text-sm text-muted-foreground" dir="ltr">{booking.phone}</p>
          </div>
          <Button asChild size="sm" variant="outline"><Link href={booking.detailHref}>فتح مساحة التنفيذ <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> {booking.eventDate || "لم يحدد تاريخ المناسبة"} {booking.startTime && <span>· {booking.startTime}</span>}</p>
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {booking.location || "لم يحدد الموقع"}</p>
            <p className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-muted-foreground" /> {booking.warehouse || "المستودع الرئيسي"} · {WAREHOUSE_LABELS[booking.warehouseStatus] ?? booking.warehouseStatus}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">المنتجات والمعدات</p>
            <div className="space-y-1.5">
              {booking.products.slice(0, 3).map((item) => <p key={`${item.productId}-${item.name}`} className="text-sm"><span className="font-medium">{item.name}</span> <span className="text-muted-foreground">× {item.quantity}</span></p>)}
              {!booking.products.length && !booking.assets.length && <p className="text-sm text-muted-foreground">لا توجد تفاصيل عناصر محفوظة.</p>}
              {booking.assets.length > 0 && <p className="text-xs text-violet-600 dark:text-violet-300">{booking.assets.length} أصل مرتبط · المسح متاح داخل مساحة التنفيذ</p>}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">الإجمالي</span><span className="font-semibold">{formatCurrency(booking.total)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">المدفوع</span><span className="text-emerald-600 dark:text-emerald-300">{formatCurrency(booking.paid)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">المتبقي</span><span className="font-semibold text-amber-600 dark:text-amber-300">{formatCurrency(booking.remaining)}</span></div>
            {booking.team.length > 0 && <p className="flex items-center gap-2 pt-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> {booking.team.map((member) => member.name).filter(Boolean).join("، ")}</p>}
          </div>
        </div>
        {booking.alerts.length > 0 && <div className="flex flex-wrap gap-2 border-t bg-destructive/5 px-4 py-2.5">{booking.alerts.map((alert) => <span key={alert} className="flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{alert}</span>)}</div>}
      </CardContent>
    </Card>
  );
}

export default function SoundCenterPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [date, setDate] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (status !== "all") params.set("status", status);
    if (source !== "all") params.set("source", source);
    if (date) params.set("date", date);
    return params.toString();
  }, [search, status, source, date]);
  const query = useQuery<SoundCenterResponse>({
    queryKey: ["admin-sound-center", queryString],
    queryFn: () => adminFetch(`/admin/sound-center${queryString ? `?${queryString}` : ""}`),
  });
  const sync = useMutation({
    mutationFn: () => adminFetch<{ created: number; updated: number; failed: number }>("/admin/sound-center/sync", { method: "POST" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sound-center"] });
      toast({ title: "تمت مزامنة الصوتيات", description: `جديد ${result.created} · محدّث ${result.updated}${result.failed ? ` · تعذر ${result.failed}` : ""}` });
    },
    onError: (error: Error) => toast({ title: "تعذرت المزامنة", description: error.message, variant: "destructive" }),
  });
  useEffect(() => {
    const key = `ajn-sound-center-sync-${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void adminFetch("/admin/sound-center/sync", { method: "POST" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["admin-sound-center"] }))
      .catch(() => {
        // The live creation hooks still keep new records synchronized. A manager can
        // retry a historical backfill from the visible button without blocking the page.
        sessionStorage.removeItem(key);
      });
    // Synchronize historical invoices once per browser session/day; live creates update immediately server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = query.data;
  return (
    <div dir="rtl" className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><div className="rounded-xl bg-violet-500/10 p-2 text-violet-600 dark:text-violet-300"><Headphones className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold">مركز حجوزات الصوتيات</h1><p className="text-sm text-muted-foreground">كل حجوزات ومنتجات ومعدات الصوت في مساحة تشغيل واحدة</p></div></div></div>
        <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={`ml-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />مزامنة المصادر</Button>
      </div>

      {query.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}</div> : data && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="وظائف اليوم" value={data.summary.today} hint={`من أصل ${data.summary.total} حجز`} icon={CalendarDays} tone="text-blue-600" />
        <StatCard label="قيد التنفيذ" value={data.summary.pending} hint="حجوزات غير مغلقة" icon={Clock3} tone="text-amber-600" />
        <StatCard label="معدات خارج المستودع" value={data.summary.equipmentOut} hint="أصول تحتاج متابعة" icon={Truck} tone="text-violet-600" />
        <StatCard label="إرجاعات متأخرة" value={data.summary.lateReturns} hint="تحتاج إجراء" icon={AlertTriangle} tone="text-destructive" />
        <StatCard label="إيراد الصوتيات" value={formatCurrency(data.summary.revenue)} hint={`ربح تقديري ${formatCurrency(data.summary.profit)}`} icon={CircleDollarSign} tone="text-emerald-600" />
      </div>}

      <Card className="shadow-sm"><CardContent className="p-4"><div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_170px]">
        <div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="ابحث بالحجز، العميل، الهاتف، المنتج، الأصل، الباركود أو QR..." /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="كل الحالات" /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={source} onValueChange={setSource}><SelectTrigger><SelectValue placeholder="كل المصادر" /></SelectTrigger><SelectContent><SelectItem value="all">كل المصادر</SelectItem>{(data?.sources ?? []).map((value) => <SelectItem key={value} value={value}>{SOURCE_LABELS[value] ?? value}</SelectItem>)}</SelectContent></Select>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="تاريخ المناسبة" />
      </div></CardContent></Card>

      <Tabs defaultValue="bookings" dir="rtl">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-muted/60 p-1"><TabsTrigger value="bookings">الحجوزات</TabsTrigger><TabsTrigger value="equipment">استخدام المعدات</TabsTrigger><TabsTrigger value="employees">أداء الموظفين</TabsTrigger><TabsTrigger value="financial">الإيرادات والربح</TabsTrigger></TabsList>
        <TabsContent value="bookings" className="mt-4 space-y-3">
          {query.isLoading && Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-52 rounded-xl" />)}
          {query.isError && <Card className="border-destructive/30"><CardContent className="p-6 text-center text-destructive">تعذر تحميل مركز الصوتيات. {(query.error as Error).message}</CardContent></Card>}
          {!query.isLoading && data?.data.map((booking) => <BookingCard key={`${booking.source}-${booking.id}`} booking={booking} />)}
          {!query.isLoading && data?.data.length === 0 && <Card><CardContent className="flex flex-col items-center gap-3 p-12 text-center"><Speaker className="h-10 w-10 text-muted-foreground" /><div><p className="font-semibold">لا توجد حجوزات صوتيات مطابقة.</p><p className="text-sm text-muted-foreground">جرّب إزالة أحد الفلاتر أو مزامنة المصادر.</p></div></CardContent></Card>}
        </TabsContent>
        <TabsContent value="equipment" className="mt-4"><Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Boxes className="h-5 w-5 text-violet-600" /> استخدام المعدات</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data?.data.flatMap((booking) => booking.assets.map((asset) => <div key={`${booking.source}-${booking.id}-${asset.productId}`} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><p className="font-medium">{asset.name}</p><Badge variant="outline">{asset.stage}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{asset.assetNumber} · {asset.warehouse || "المستودع الرئيسي"}</p><p className="mt-2 text-xs text-primary">{booking.bookingId} · {booking.customer}</p></div>))}{!data?.data.some((booking) => booking.assets.length) && <p className="text-sm text-muted-foreground">لا توجد أصول مرتبطة ضمن النتائج الحالية.</p>}</CardContent></Card></TabsContent>
        <TabsContent value="employees" className="mt-4"><Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-5 w-5 text-blue-600" /> فريق التنفيذ</CardTitle></CardHeader><CardContent className="space-y-2">{data?.data.flatMap((booking) => booking.team.map((member, index) => <div key={`${booking.id}-${member.id ?? index}`} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.role || "فريق الصوتيات"}</p></div><Link href={booking.detailHref} className="text-xs text-primary hover:underline">{booking.bookingId}</Link></div>))}{!data?.data.some((booking) => booking.team.length) && <p className="text-sm text-muted-foreground">لم يتم تعيين فريق للحجوزات الحالية.</p>}</CardContent></Card></TabsContent>
        <TabsContent value="financial" className="mt-4"><div className="grid gap-3 sm:grid-cols-2"><StatCard label="الإيراد ضمن النتائج" value={formatCurrency(data?.data.reduce((sum, row) => sum + row.total, 0) ?? 0)} hint="إجمالي حجوزات الصوتيات" icon={Banknote} tone="text-emerald-600" /><StatCard label="الربح التقديري" value={formatCurrency(data?.data.reduce((sum, row) => sum + row.profit, 0) ?? 0)} hint="بعد كلفة المنتجات المتاحة" icon={PackageCheck} tone="text-violet-600" /></div></TabsContent>
      </Tabs>
    </div>
  );
}
