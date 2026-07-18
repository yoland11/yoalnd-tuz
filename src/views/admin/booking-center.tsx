import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Boxes,
  CalendarDays,
  Camera,
  Car,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  Crown,
  ExternalLink,
  Flower2,
  Gift,
  GraduationCap,
  ListChecks,
  MapPin,
  MessageCircle,
  MonitorPlay,
  MoreHorizontal,
  PackageCheck,
  PartyPopper,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Send,
  Sparkles,
  Speaker,
  Users,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatCurrency } from "./_lib";
import { BookingOperationsWorkspace } from "./booking-operations-workspace";
import "./booking-center.css";

type ServiceKey =
  | "kosha"
  | "photography"
  | "sound"
  | "flowers"
  | "gifts"
  | "graduation"
  | "led"
  | "transportation"
  | "decorations";

type ServiceStatus =
  | "waiting"
  | "preparing"
  | "ready"
  | "dispatched"
  | "installed"
  | "running"
  | "finished"
  | "returned"
  | "cancelled";

type BookingService = {
  type: ServiceKey;
  status: ServiceStatus;
  amount?: number;
  notes?: string;
};

type ServiceOrder = {
  id: number;
  trackingCode: string | null;
  serviceId: number;
  serviceName: string;
  serviceType: string | null;
  customerName: string;
  phone: string;
  eventDate: string | null;
  eventLocation: string | null;
  notes: string | null;
  status: string;
  totalAmount?: number;
  depositAmount?: number;
  remainingAmount?: number;
  paymentStatus?: string;
  customFields?: Record<string, any>;
  createdAt: string;
};

type KoshaBooking = {
  id: number;
  trackingCode?: string | null;
  customerId?: number | null;
  customerName: string;
  phone: string;
  eventDate?: string | null;
  eventTime?: string | null;
  hallLocation?: string | null;
  province?: string | null;
  area?: string | null;
  koshaName?: string | null;
  packageName?: string | null;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  paymentStatus?: string;
  status: string;
  executionStage?: string;
  bookingDetails?: Record<string, any>;
  notes?: string | null;
  createdAt?: string;
};

type AdminService = { id: number; name: string; nameAr: string; type: string; isActive: boolean };
type Customer = { id: number; name: string; fullName?: string | null; phone: string; city?: string | null };

type UnifiedBooking = {
  source: "service" | "kosha" | "store" | "graduation" | "photography" | "rental";
  id: number;
  number: string;
  customerId?: number | null;
  customerName: string;
  phone: string;
  eventDate: string;
  eventTime: string;
  hall: string;
  mapUrl?: string;
  status: string;
  total: number;
  paid: number;
  remaining: number;
  paymentStatus: string;
  services: BookingService[];
  notes?: string;
  contractNumber?: string;
  createdAt?: string;
  bookingSource?: string;
  detailHref?: string;
  raw: ServiceOrder | KoshaBooking;
};

const SERVICE_META: Array<{
  key: ServiceKey;
  label: string;
  short: string;
  icon: typeof Crown;
  aliases: string[];
  accent: string;
}> = [
  { key: "kosha", label: "حجوزات الكوشات", short: "الكوشة", icon: Crown, aliases: ["kosha", "stage"], accent: "rose" },
  { key: "photography", label: "التصوير", short: "التصوير", icon: Camera, aliases: ["photo", "photography", "camera"], accent: "plum" },
  { key: "sound", label: "الصوتيات", short: "الصوت", icon: Speaker, aliases: ["sound", "audio", "speaker"], accent: "gold" },
  { key: "flowers", label: "الورد", short: "الورد", icon: Flower2, aliases: ["flower", "floral"], accent: "rose" },
  { key: "gifts", label: "الهدايا والتوزيعات", short: "التوزيعات", icon: Gift, aliases: ["gift", "distribution"], accent: "plum" },
  { key: "graduation", label: "التخرج", short: "التخرج", icon: GraduationCap, aliases: ["graduation"], accent: "gold" },
  { key: "led", label: "شاشات LED", short: "الشاشات", icon: MonitorPlay, aliases: ["led", "screen"], accent: "plum" },
  { key: "transportation", label: "النقل", short: "النقل", icon: Car, aliases: ["transport", "vehicle", "delivery"], accent: "gold" },
  { key: "decorations", label: "الديكورات", short: "الديكور", icon: PartyPopper, aliases: ["decor", "decoration"], accent: "rose" },
];

const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  pending: "بانتظار التأكيد",
  confirmed: "مؤكد",
  active: "نشط",
  processing: "قيد التجهيز",
  preparing: "قيد التجهيز",
  ready: "جاهز",
  dispatched: "تم الإرسال",
  shipped: "في الطريق",
  installed: "تم التركيب",
  running: "قيد التنفيذ",
  completed: "مكتمل",
  delivered: "تم التسليم",
  finished: "منتهٍ",
  returned: "تم الإرجاع",
  cancelled: "ملغي",
  waiting: "بانتظار البدء",
  in_progress: "قيد التنفيذ",
};

const SERVICE_STATUS_VALUES: ServiceStatus[] = ["waiting", "preparing", "ready", "dispatched", "installed", "running", "finished", "returned", "cancelled"];

function normalizeServiceStatus(value: unknown): ServiceStatus {
  const status = String(value ?? "");
  if (SERVICE_STATUS_VALUES.includes(status as ServiceStatus)) return status as ServiceStatus;
  if (["completed", "delivered"].includes(status)) return "finished";
  if (["confirmed", "processing", "active", "in_progress"].includes(status)) return "preparing";
  return "waiting";
}

const STATUS_TONE: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-300",
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-300",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-300",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-300",
  cancelled: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
  processing: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/35 dark:text-amber-300",
  preparing: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/35 dark:text-amber-300",
  pending: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/35 dark:text-rose-300",
  waiting: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/35 dark:text-rose-300",
};

function num(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function serviceKey(value: unknown): ServiceKey {
  const normalized = String(value ?? "").toLowerCase();
  return SERVICE_META.find((item) => item.aliases.some((alias) => normalized.includes(alias)))?.key ?? "decorations";
}

function bookingServices(order: ServiceOrder): BookingService[] {
  const stored = order.customFields?.bookingCenterServices;
  if (Array.isArray(stored) && stored.length) {
    return stored
      .filter((item) => item && SERVICE_META.some((meta) => meta.key === item.type))
      .map((item) => ({ type: item.type, status: item.status || "waiting", amount: num(item.amount), notes: item.notes }));
  }
  return [{ type: serviceKey(order.serviceType), status: normalizeServiceStatus(order.status), amount: num(order.totalAmount) }];
}

function unify(serviceOrders: ServiceOrder[], koshaBookings: KoshaBooking[]): UnifiedBooking[] {
  const services: UnifiedBooking[] = serviceOrders.map((order) => ({
    source: "service",
    id: order.id,
    number: order.trackingCode || `AJN-${String(order.id).padStart(5, "0")}`,
    customerId: num(order.customFields?.customerId) || null,
    customerName: order.customerName,
    phone: order.phone,
    eventDate: dateOnly(order.eventDate),
    eventTime: String(order.customFields?.eventTime ?? ""),
    hall: String(order.customFields?.hallName ?? order.eventLocation ?? ""),
    mapUrl: String(order.customFields?.mapUrl ?? ""),
    status: order.status,
    total: num(order.totalAmount),
    paid: num(order.depositAmount),
    remaining: num(order.remainingAmount),
    paymentStatus: order.paymentStatus || "unpaid",
    services: bookingServices(order),
    notes: order.notes || "",
    contractNumber: String(order.customFields?.contractNumber ?? ""),
    createdAt: order.createdAt,
    raw: order,
  }));
  const koshas: UnifiedBooking[] = koshaBookings.map((booking) => ({
    source: "kosha",
    id: booking.id,
    number: booking.trackingCode || `KB-${String(booking.id).padStart(5, "0")}`,
    customerId: booking.customerId,
    customerName: booking.customerName,
    phone: booking.phone,
    eventDate: dateOnly(booking.eventDate),
    eventTime: booking.eventTime || "",
    hall: booking.hallLocation || [booking.province, booking.area].filter(Boolean).join(" / "),
    mapUrl: String(booking.bookingDetails?.mapUrl ?? booking.bookingDetails?.googleMap ?? ""),
    status: booking.status,
    total: num(booking.totalAmount),
    paid: num(booking.paidAmount),
    remaining: num(booking.remainingAmount),
    paymentStatus: booking.paymentStatus || "unpaid",
    services: [{ type: "kosha", status: normalizeServiceStatus(booking.executionStage || booking.status), amount: num(booking.totalAmount) }],
    notes: booking.notes || "",
    contractNumber: String(booking.bookingDetails?.contractNumber ?? ""),
    createdAt: booking.createdAt,
    raw: booking,
  }));
  return [...services, ...koshas].sort((a, b) => String(b.createdAt ?? b.eventDate).localeCompare(String(a.createdAt ?? a.eventDate)));
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={`font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}>{STATUS_LABELS[status] ?? status}</Badge>;
}

function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatCurrency(value)}</span>;
}

function ReadinessRing({ value, label = "جاهزية الحجز" }: { value: number; label?: string }) {
  const safe = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="ajn-readiness-ring" style={{ "--progress": `${safe * 3.6}deg` } as React.CSSProperties}>
      <div className="ajn-readiness-ring__inside">
        <strong>{safe}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function getReadiness(booking: UnifiedBooking) {
  const statusPoints: Record<string, number> = { waiting: 18, pending: 24, preparing: 50, processing: 50, ready: 82, dispatched: 86, installed: 92, running: 94, finished: 100, completed: 100, delivered: 100, returned: 100, confirmed: 65 };
  const serviceScore = booking.services.length
    ? booking.services.reduce((sum, service) => sum + (statusPoints[service.status] ?? 30), 0) / booking.services.length
    : 25;
  const paymentScore = booking.remaining <= 0 ? 100 : booking.total > 0 ? Math.max(15, (booking.paid / booking.total) * 100) : 40;
  const contract = booking.contractNumber ? 100 : 35;
  return Math.round(serviceScore * 0.55 + paymentScore * 0.3 + contract * 0.15);
}

export default function BookingCenterPage() {
  const [location] = useLocation();
  const detailMatch = location.match(/^\/admin\/bookings\/(service|kosha)\/(\d+)/);
  if (detailMatch) return <BookingWorkspace source={detailMatch[1] as "service" | "kosha"} id={Number(detailMatch[2])} />;
  return <BookingDashboard />;
}

function BookingDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<ServiceKey | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const centralBookingsQuery = useQuery({ queryKey: ["admin", "booking-center"], queryFn: () => adminFetch<any[]>("/admin/booking-center") });
  const servicesQuery = useQuery({ queryKey: ["admin", "services", "booking-center"], queryFn: () => adminFetch<AdminService[]>("/admin/services") });
  const customersQuery = useQuery({ queryKey: ["admin", "customers", "booking-center"], queryFn: () => adminFetch<Customer[]>("/admin/customers") });
  const bookings = useMemo(() => (centralBookingsQuery.data ?? []).map((row) => {
    const departments = Array.isArray(row.departments)
      ? row.departments.filter((type: unknown): type is ServiceKey =>
          SERVICE_META.some((meta) => meta.key === type),
        )
      : [];
    return {
      ...row,
      services: (departments.length ? departments : (["decorations"] as ServiceKey[])).map((type: ServiceKey) => ({
        type,
        status: normalizeServiceStatus(row.status),
        amount: num(row.total),
      })),
      raw: row,
    };
  }) as UnifiedBooking[], [centralBookingsQuery.data]);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (serviceFilter !== "all" && !booking.services.some((service) => service.type === serviceFilter)) return false;
      if (!q) return true;
      return [booking.number, booking.customerName, booking.phone, booking.hall, booking.eventDate].join(" ").toLowerCase().includes(q);
    });
  }, [bookings, search, serviceFilter]);
  const cards = SERVICE_META.map((meta) => {
    const rows = bookings.filter((booking) => booking.services.some((service) => service.type === meta.key));
    const inProgress = rows.filter((booking) => ["processing", "preparing", "active", "confirmed"].includes(booking.status)).length;
    return {
      ...meta,
      total: rows.length,
      today: rows.filter((booking) => booking.eventDate === today).length,
      pending: rows.filter((booking) => ["new", "pending", "waiting"].includes(booking.status)).length,
      inProgress,
      completed: rows.filter((booking) => ["completed", "delivered", "finished", "returned"].includes(booking.status)).length,
      revenue: rows.filter((booking) => booking.eventDate.startsWith(month)).reduce((sum, booking) => sum + booking.total, 0),
    };
  });
  const topMetrics = [
    { label: "حجوزات اليوم", value: bookings.filter((booking) => booking.eventDate === today).length, icon: CalendarDays, tone: "rose" },
    { label: "المناسبات القادمة", value: bookings.filter((booking) => booking.eventDate >= today && !["cancelled", "completed", "returned"].includes(booking.status)).length, icon: Sparkles, tone: "plum" },
    { label: "دفعات معلّقة", value: bookings.filter((booking) => booking.remaining > 0 && booking.status !== "cancelled").length, icon: CircleDollarSign, tone: "gold" },
    { label: "جاهزة اليوم", value: bookings.filter((booking) => booking.eventDate === today && getReadiness(booking) >= 80).length, icon: PackageCheck, tone: "green" },
    { label: "إيراد الشهر", value: formatCurrency(bookings.filter((booking) => booking.eventDate.startsWith(month)).reduce((sum, booking) => sum + booking.total, 0)), icon: Banknote, tone: "gold" },
  ];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "service-orders"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] });
  };

  return (
    <div className="ajn-booking-center" dir="rtl">
      <header className="ajn-booking-hero">
        <div>
          <div className="ajn-kicker"><Sparkles className="h-4 w-4" /> مركز العمليات والمناسبات</div>
          <h1>مركز الحجوزات</h1>
          <p>حجز واحد، عميل واحد، وكل فرق AJN تعمل من مساحة موحّدة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href="/admin/calendar"><CalendarDays className="h-4 w-4" /> التقويم</Link></Button>
          <Button className="ajn-rose-button" onClick={() => setShowCreate((value) => !value)}><Plus className="h-4 w-4" /> حجز موحّد جديد</Button>
        </div>
      </header>

      <section className="ajn-booking-metrics" aria-label="ملخص الحجوزات">
        {topMetrics.map((item) => {
          const Icon = item.icon;
          return <div key={item.label} className={`ajn-metric ajn-tone-${item.tone}`}><span><Icon className="h-5 w-5" /></span><div><small>{item.label}</small><strong>{item.value}</strong></div></div>;
        })}
      </section>

      {showCreate && (
        <UnifiedBookingForm
          services={servicesQuery.data ?? []}
          customers={customersQuery.data ?? []}
          onCancel={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); toast({ title: "تم إنشاء الحجز الموحد بنجاح", description: "تم حفظ العميل والخدمات ضمن رقم حجز واحد." }); }}
        />
      )}

      <section className="ajn-service-rail" aria-label="خدمات الحجوزات">
        {cards.map((card) => {
          const Icon = card.icon;
          const active = serviceFilter === card.key;
          return (
            <article key={card.key} className={`ajn-service-card ajn-service-${card.accent} ${active ? "is-active" : ""}`}>
              <button type="button" onClick={() => setServiceFilter(active ? "all" : card.key)} aria-pressed={active}>
                <span className="ajn-service-icon"><Icon /></span>
                <span><strong>{card.label}</strong><small>{card.total} حجز · اليوم {card.today}</small></span>
              </button>
              <div className="ajn-service-stats"><span>معلق <b>{card.pending}</b></span><span>جاري <b>{card.inProgress}</b></span><span>مكتمل <b>{card.completed}</b></span></div>
              <div className="ajn-service-revenue"><small>إيراد الشهر</small><Money value={card.revenue} /></div>
              <Button variant="ghost" size="sm" onClick={() => setServiceFilter(card.key)}>فتح <ChevronLeft className="h-4 w-4" /></Button>
            </article>
          );
        })}
        <article className="ajn-service-card ajn-more-service">
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><span className="ajn-service-icon"><MoreHorizontal /></span><strong>المزيد من الخدمات</strong><Button variant="outline" size="sm" asChild><Link href="/admin/services">إدارة الخدمات</Link></Button></div>
        </article>
      </section>

      <section className="ajn-booking-list-panel">
        <div className="ajn-section-heading">
          <div><span>العمل الجاري</span><h2>{serviceFilter === "all" ? "كل الحجوزات" : SERVICE_META.find((item) => item.key === serviceFilter)?.label}</h2></div>
          <div className="relative w-full sm:w-80"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-10" placeholder="رقم الحجز، العميل، الهاتف أو القاعة" /></div>
        </div>
        {centralBookingsQuery.isLoading ? (
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-48 rounded-xl" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="ajn-empty"><CalendarDays /><h3>لا توجد حجوزات مطابقة</h3><p>غيّر البحث أو أنشئ أول حجز موحّد لهذه الخدمة.</p></div>
        ) : (
          <div className="ajn-booking-grid">
            {filtered.map((booking) => <BookingPreview key={`${booking.source}-${booking.id}`} booking={booking} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function BookingPreview({ booking }: { booking: UnifiedBooking }) {
  const readiness = getReadiness(booking);
  return (
    <article className="ajn-booking-preview">
      <div className="flex items-start justify-between gap-3">
        <div><small>{booking.number}</small><h3>{booking.customerName}</h3><p>{booking.eventDate || "الموعد غير محدد"} {booking.eventTime && `· ${booking.eventTime}`}</p></div>
        <StatusBadge status={booking.status} />
      </div>
      <div className="ajn-preview-services">{booking.services.slice(0, 5).map((service) => { const meta = SERVICE_META.find((item) => item.key === service.type)!; const Icon = meta.icon; return <span key={service.type} title={meta.label}><Icon /><small>{meta.short}</small></span>; })}</div>
      <div className="ajn-preview-progress"><span><i style={{ width: `${readiness}%` }} /></span><small>الجاهزية {readiness}%</small></div>
      <div className="ajn-preview-finance"><div><small>الإجمالي</small><Money value={booking.total} /></div><div><small>المتبقي</small><Money value={booking.remaining} className={booking.remaining > 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600"} /></div></div>
      <div className="flex items-center justify-between border-t border-border/60 pt-3"><span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{booking.hall || "الموقع غير محدد"}</span><Button size="sm" variant="ghost" asChild><Link href={booking.detailHref || `/admin/bookings/${booking.source}/${booking.id}`}>فتح مساحة العمل <ChevronLeft className="h-4 w-4" /></Link></Button></div>
    </article>
  );
}

function UnifiedBookingForm({ services, customers, onCancel, onCreated }: { services: AdminService[]; customers: Customer[]; onCancel: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [hallName, setHallName] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<ServiceKey[]>(["kosha"]);
  const mutation = useMutation({
    mutationFn: async () => {
      const customer = customers.find((item) => String(item.id) === customerId);
      if (!customer) throw new Error("اختر العميل أولاً");
      if (!eventDate) throw new Error("حدد تاريخ المناسبة");
      if (!selected.length) throw new Error("اختر خدمة واحدة على الأقل");
      const primaryMeta = SERVICE_META.find((item) => item.key === selected[0]);
      const primary = services.find((service) => primaryMeta?.aliases.some((alias) => service.type.toLowerCase().includes(alias))) ?? services.find((service) => service.isActive);
      if (!primary) throw new Error("لا توجد خدمة فعالة. أضف خدمة من إدارة الخدمات أولاً.");
      return adminFetch("/admin/service-orders", {
        method: "POST",
        body: JSON.stringify({
          serviceId: primary.id,
          customerName: customer.fullName || customer.name,
          phone: customer.phone,
          eventDate,
          eventLocation: hallName,
          totalAmount: num(totalAmount),
          depositAmount: 0,
          paymentStatus: "unpaid",
          notes,
          customFields: {
            bookingCenterVersion: 1,
            customerId: customer.id,
            eventTime,
            hallName,
            mapUrl,
            contractNumber,
            bookingCenterServices: selected.map((type) => ({ type, status: "waiting", amount: 0 })),
          },
        }),
      });
    },
    onSuccess: onCreated,
    onError: (error: any) => toast({ title: "تعذر حفظ الحجز", description: error?.message || "تحقق من البيانات وحاول مرة أخرى.", variant: "destructive" }),
  });
  const toggle = (type: ServiceKey) => setSelected((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  return (
    <section className="ajn-unified-form">
      <div className="ajn-section-heading"><div><span>إدخال سريع</span><h2>إنشاء حجز متعدد الخدمات</h2><p>لن تُنشأ فاتورة أو حركة صندوق حتى تنفيذ الإجراء من وحدته المالية الحالية.</p></div><Button variant="ghost" onClick={onCancel}>إغلاق</Button></div>
      <div className="grid gap-4 p-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="booking-customer">العميل *</Label><select id="booking-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="ajn-native-select"><option value="">اختر العميل</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.fullName} — {customer.phone}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="booking-contract">رقم العقد</Label><Input id="booking-contract" value={contractNumber} onChange={(event) => setContractNumber(event.target.value)} placeholder="يُترك فارغاً عند عدم وجود عقد" /></div>
            <div className="space-y-2"><Label htmlFor="booking-date">تاريخ المناسبة *</Label><Input id="booking-date" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="booking-time">وقت المناسبة</Label><Input id="booking-time" type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="booking-hall">القاعة / الموقع</Label><Input id="booking-hall" value={hallName} onChange={(event) => setHallName(event.target.value)} placeholder="اسم القاعة والعنوان" /></div>
            <div className="space-y-2"><Label htmlFor="booking-map">رابط Google Maps</Label><Input id="booking-map" dir="ltr" value={mapUrl} onChange={(event) => setMapUrl(event.target.value)} placeholder="https://maps.google.com/..." /></div>
            <div className="space-y-2"><Label htmlFor="booking-total">إجمالي الحجز</Label><Input id="booking-total" inputMode="numeric" value={totalAmount} onChange={(event) => setTotalAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 د.ع" /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="booking-notes">ملاحظات</Label><Textarea id="booking-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="تفاصيل خاصة بالمناسبة أو العميل" /></div>
        </div>
        <div className="ajn-service-picker">
          <div><span>الخدمات المطلوبة</span><strong>{selected.length} خدمات محددة</strong></div>
          <div className="grid grid-cols-2 gap-2">{SERVICE_META.map((meta) => { const Icon = meta.icon; const checked = selected.includes(meta.key); return <button type="button" key={meta.key} className={checked ? "is-selected" : ""} onClick={() => toggle(meta.key)} aria-pressed={checked}><Icon /><span>{meta.short}</span>{checked && <CheckCircle2 />}</button>; })}</div>
          <div className="mt-auto flex gap-2 pt-4"><Button variant="outline" onClick={onCancel} className="flex-1">إلغاء</Button><Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="ajn-rose-button flex-1">{mutation.isPending ? "جارٍ الحفظ..." : "حفظ الحجز"}</Button></div>
        </div>
      </div>
    </section>
  );
}

function BookingWorkspace({ source, id }: { source: "service" | "kosha"; id: number }) {
  const serviceOrdersQuery = useQuery({ queryKey: ["admin", "booking-workspace", "service-orders"], queryFn: () => adminFetch<ServiceOrder[]>("/admin/service-orders?limit=250"), enabled: source === "service" });
  const koshaQuery = useQuery({ queryKey: ["admin", "booking-workspace", "kosha"], queryFn: () => adminFetch<KoshaBooking[]>("/admin/kosha-bookings?search=&status="), enabled: source === "kosha" });
  const data = useMemo(() => unify(serviceOrdersQuery.data ?? [], koshaQuery.data ?? []).find((booking) => booking.source === source && booking.id === id), [source, id, serviceOrdersQuery.data, koshaQuery.data]);
  if (serviceOrdersQuery.isLoading || koshaQuery.isLoading) return <div className="space-y-4"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-[520px] rounded-2xl" /></div>;
  if (!data) return <div className="ajn-empty"><AlertTriangle /><h2>الحجز غير موجود</h2><p>قد يكون مؤرشفاً أو لم تعد لديك صلاحية عرضه.</p><Button asChild><Link href="/admin/bookings">العودة إلى مركز الحجوزات</Link></Button></div>;
  return <BookingOperationsWorkspace booking={data as any} />;
}

function LegacyBookingWorkspace({ source, id }: { source: "service" | "kosha"; id: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const serviceOrdersQuery = useQuery({ queryKey: ["admin", "booking-workspace", "service-orders"], queryFn: () => adminFetch<ServiceOrder[]>("/admin/service-orders?limit=250"), enabled: source === "service" });
  const koshaQuery = useQuery({ queryKey: ["admin", "booking-workspace", "kosha"], queryFn: () => adminFetch<KoshaBooking[]>("/admin/kosha-bookings?search=&status="), enabled: source === "kosha" });
  const data = useMemo(() => unify(serviceOrdersQuery.data ?? [], koshaQuery.data ?? []).find((booking) => booking.source === source && booking.id === id), [source, id, serviceOrdersQuery.data, koshaQuery.data]);
  const historyQuery = useQuery({ queryKey: ["admin", "booking-workspace", source, id, "history"], queryFn: () => source === "service" ? adminFetch<any[]>(`/admin/service-orders/${id}/history`) : adminFetch<any>(`/admin/kosha-bookings/${id}/finance`), enabled: Boolean(data) });
  const reservationsQuery = useQuery({ queryKey: ["admin", "booking-workspace", source, id, "reservations"], queryFn: () => adminFetch<any>(`/admin/kosha-bookings/${id}/reservations`), enabled: Boolean(data) && source === "kosha" });
  const updateService = useMutation({
    mutationFn: ({ type, status }: { type: ServiceKey; status: ServiceStatus }) => {
      if (!data || source !== "service") throw new Error("تحديث حالات الخدمات متاح للحجوزات الموحدة الجديدة");
      const raw = data.raw as ServiceOrder;
      const current = bookingServices(raw).map((service) => service.type === type ? { ...service, status } : service);
      const allDone = current.every((service) => ["finished", "returned", "cancelled"].includes(service.status));
      return adminFetch(`/admin/service-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: allDone ? "completed" : "processing", customFields: { ...(raw.customFields ?? {}), bookingCenterServices: current } }) });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin", "booking-workspace"] }); queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] }); toast({ title: "تم تحديث حالة الخدمة" }); },
    onError: (error: any) => toast({ title: "تعذر تحديث الخدمة", description: error?.message, variant: "destructive" }),
  });

  if (serviceOrdersQuery.isLoading || koshaQuery.isLoading) return <div className="space-y-4"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-[520px] rounded-2xl" /></div>;
  if (!data) return <div className="ajn-empty"><AlertTriangle /><h2>الحجز غير موجود</h2><p>قد يكون مؤرشفاً أو لم تعد لديك صلاحية عرضه.</p><Button asChild><Link href="/admin/bookings">العودة إلى مركز الحجوزات</Link></Button></div>;

  const readiness = getReadiness(data);
  const finance: any = source === "kosha" && historyQuery.data && !Array.isArray(historyQuery.data) ? historyQuery.data : null;
  const history = Array.isArray(historyQuery.data) ? historyQuery.data : finance?.payments ?? finance?.collections ?? [];
  const reservations = reservationsQuery.data?.items ?? [];
  const whatsapp = `https://wa.me/${String(data.phone).replace(/\D/g, "")}`;
  const invoiceUrl = `/admin/invoice/${data.id}?type=${source === "kosha" ? "kosha" : "booking"}`;
  const readinessParts = [
    { label: "الدفع", value: data.remaining <= 0 ? 100 : data.total ? Math.round((data.paid / data.total) * 100) : 20 },
    { label: "المستودع", value: reservations.length ? 85 : source === "kosha" ? 35 : 55 },
    { label: "الموظفون", value: data.services.some((service) => ["ready", "installed", "running", "finished"].includes(service.status)) ? 85 : 45 },
    { label: "المعدات", value: reservations.length ? 90 : 50 },
    { label: "النقل", value: data.services.some((service) => service.type === "transportation") ? 55 : 100 },
    { label: "العقد", value: data.contractNumber ? 100 : 35 },
  ];
  const recommendations = [
    data.remaining > 0 ? `يوجد مبلغ ${formatCurrency(data.remaining)} متبقٍ على العميل قبل المناسبة.` : null,
    !data.contractNumber ? "لم يُسجل رقم عقد لهذا الحجز بعد." : null,
    data.services.some((service) => service.status === "waiting") ? "توجد خدمات ما زالت بانتظار بدء التجهيز." : null,
    source === "kosha" && reservations.length === 0 ? "لم يتم حجز مواد أو معدات من المستودع لهذا الحجز." : null,
  ].filter(Boolean) as string[];

  return (
    <div className="ajn-booking-center ajn-booking-workspace" dir="rtl">
      <div className="ajn-workspace-back"><Button variant="ghost" asChild><Link href="/admin/bookings"><ArrowLeft className="h-4 w-4 rotate-180" /> مركز الحجوزات</Link></Button><span>{source === "kosha" ? "حجز كوشة قديم — متوافق" : "حجز موحّد"}</span></div>
      <header className="ajn-workspace-header">
        <div className="ajn-workspace-identity">
          <span className="ajn-workspace-crown"><Crown /></span>
          <div><div className="flex flex-wrap items-center gap-2"><h1>{data.number}</h1><StatusBadge status={data.status} /></div><p>{data.customerName} · {data.phone}</p></div>
        </div>
        <div className="ajn-workspace-facts"><span><CalendarDays /> <b>{data.eventDate || "غير محدد"}</b><small>{data.eventTime}</small></span><span><MapPin /> <b>{data.hall || "الموقع غير محدد"}</b></span><span><CircleDollarSign /> <b className="text-rose-600 dark:text-rose-300"><Money value={data.remaining} /></b><small>المبلغ المتبقي</small></span></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> واتساب</a></Button>{data.mapUrl && <Button variant="outline" asChild><a href={data.mapUrl} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" /> الخريطة</a></Button>}<Button className="ajn-rose-button" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : `/admin/orders?serviceOrder=${id}`}><Banknote className="h-4 w-4" /> استلام دفعة</Link></Button></div>
      </header>

      <div className="ajn-workspace-layout">
        <main>
          <Tabs defaultValue="summary" className="ajn-workspace-tabs">
            <TabsList>
              <TabsTrigger value="summary">الملخص</TabsTrigger>
              {data.services.map((service) => <TabsTrigger key={service.type} value={service.type}>{SERVICE_META.find((item) => item.key === service.type)?.short}</TabsTrigger>)}
              <TabsTrigger value="warehouse">المستودع</TabsTrigger><TabsTrigger value="employees">الموظفون</TabsTrigger><TabsTrigger value="payments">المدفوعات</TabsTrigger><TabsTrigger value="invoices">الفواتير</TabsTrigger><TabsTrigger value="tasks">المهام</TabsTrigger><TabsTrigger value="attachments">المرفقات</TabsTrigger><TabsTrigger value="timeline">التايم لاين</TabsTrigger><TabsTrigger value="notes">الملاحظات</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="space-y-4">
              <section className="ajn-readiness-panel">
                <ReadinessRing value={readiness} />
                <div className="ajn-readiness-details"><div><span>حالة التنفيذ</span><h2>{readiness >= 80 ? "الحجز قريب من الجاهزية" : readiness >= 55 ? "التجهيز يسير وفق الخطة" : "الحجز يحتاج متابعة"}</h2><p>النسبة محسوبة من الدفع، الخدمات، العقد، الموظفين والمستودع.</p></div><div className="ajn-readiness-bars">{readinessParts.map((item) => <div key={item.label}><span>{item.label}<b>{item.value}%</b></span><i><em style={{ width: `${Math.min(100, item.value)}%` }} /></i></div>)}</div></div>
              </section>
              <section className="ajn-panel"><div className="ajn-panel-title"><div><Sparkles /><span><small>الخدمات</small><h2>الخدمات المطلوبة في هذا الحجز</h2></span></div></div><div className="ajn-selected-services">{data.services.map((service) => <ServiceWorkspaceCard key={service.type} service={service} editable={source === "service"} onStatus={(status) => updateService.mutate({ type: service.type, status })} />)}</div></section>
              <section className="ajn-panel"><div className="ajn-panel-title"><div><Clock3 /><span><small>مباشر</small><h2>آخر أحداث الحجز</h2></span></div><Button variant="ghost" onClick={() => document.querySelector('[data-state="inactive"][value="timeline"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))}>عرض الكل</Button></div><TimelineRows history={history} data={data} compact /></section>
            </TabsContent>
            {data.services.map((service) => <TabsContent key={service.type} value={service.type}><section className="ajn-panel"><ServiceDetail service={service} booking={data} editable={source === "service"} onStatus={(status) => updateService.mutate({ type: service.type, status })} /></section></TabsContent>)}
            <TabsContent value="warehouse"><WarehousePanel source={source} id={id} reservations={reservations} /></TabsContent>
            <TabsContent value="employees"><EmployeesPanel data={data} /></TabsContent>
            <TabsContent value="payments"><FinancialPanel data={data} finance={finance} invoiceUrl={invoiceUrl} /></TabsContent>
            <TabsContent value="invoices"><EmptyTab icon={ReceiptText} title="فواتير الحجز" text="تُنشأ الفاتورة من سجل الحجز الواحد وتعرض العميل والخدمات والإجمالي والمدفوع والمتبقي." action="فتح فاتورة الحجز" href={invoiceUrl} /></TabsContent>
            <TabsContent value="tasks"><EmptyTab icon={ListChecks} title="مهام الحجز" text="تظهر مهام الفرق المرتبطة بالحجز في مركز المهام الحالي." action="فتح مركز المهام" href="/admin/tasks" /></TabsContent>
            <TabsContent value="attachments"><EmptyTab icon={PackageCheck} title="مرفقات الحجز" text="تُحفظ العقود والصور والموافقات في مركز المستندات الحالي مع الإبقاء على رقم الحجز مرجعاً موحداً." action="فتح مركز المستندات" href="/admin/documents" /></TabsContent>
            <TabsContent value="timeline"><section className="ajn-panel"><div className="ajn-panel-title"><div><Clock3 /><span><small>السجل التشغيلي</small><h2>التايم لاين المباشر</h2></span></div></div><TimelineRows history={history} data={data} /></section></TabsContent>
            <TabsContent value="notes"><section className="ajn-panel"><div className="ajn-panel-title"><div><ReceiptText /><span><small>معلومات إضافية</small><h2>ملاحظات الحجز</h2></span></div></div><p className="min-h-40 whitespace-pre-wrap p-5 text-sm leading-8 text-muted-foreground">{data.notes || "لا توجد ملاحظات مسجلة لهذا الحجز."}</p></section></TabsContent>
          </Tabs>
        </main>
        <aside className="ajn-workspace-aside">
          <section className="ajn-finance-card"><div><span>الملخص المالي</span><Badge variant="outline">{data.paymentStatus === "paid" ? "مدفوع" : data.paymentStatus === "partial" ? "مدفوع جزئياً" : "غير مدفوع"}</Badge></div><dl><dt>الإجمالي <dd><Money value={data.total} /></dd></dt><dt>المدفوع <dd><Money value={data.paid} /></dd></dt><dt className="is-remaining">المتبقي <dd><Money value={data.remaining} /></dd></dt></dl><Button className="ajn-rose-button w-full" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : `/admin/orders?serviceOrder=${id}`}><Banknote className="h-4 w-4" /> استلام دفعة</Link></Button></section>
          <section className="ajn-side-panel"><h3>إجراءات سريعة</h3><div className="ajn-quick-actions"><Button variant="ghost" asChild><Link href={invoiceUrl}><Printer /> طباعة الفاتورة</Link></Button><Button variant="ghost" asChild><Link href="/admin/documents"><ReceiptText /> طباعة العقد</Link></Button><Button variant="ghost" asChild><Link href="/admin/qr-orders"><QrCode /> إنشاء QR</Link></Button><Button variant="ghost" asChild><Link href="/admin/tasks"><Users /> إسناد موظفين</Link></Button><Button variant="ghost" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : "/admin/reserved-stock"}><Warehouse /> حجز مستودع</Link></Button><Button variant="ghost" asChild><Link href="/admin/invitations"><Send /> دعوة إلكترونية</Link></Button><Button variant="ghost" asChild><Link href={data.customerId ? `/admin/customers?customer=${data.customerId}` : `/admin/customers?search=${encodeURIComponent(data.phone)}`}><ExternalLink /> فتح العميل</Link></Button></div></section>
          <section className="ajn-ai-panel"><div><Sparkles /><span><small>مساعد العمليات</small><h3>توصيات ذكية</h3></span></div>{recommendations.length ? <ul>{recommendations.map((item) => <li key={item}><AlertTriangle />{item}</li>)}</ul> : <p><CheckCircle2 /> لا توجد مخاطر مباشرة مسجلة لهذا الحجز.</p>}</section>
        </aside>
      </div>
    </div>
  );
}

function ServiceWorkspaceCard({ service, editable, onStatus }: { service: BookingService; editable: boolean; onStatus: (status: ServiceStatus) => void }) {
  const meta = SERVICE_META.find((item) => item.key === service.type)!;
  const Icon = meta.icon;
  return <article><span className={`ajn-service-icon ajn-service-${meta.accent}`}><Icon /></span><div><h3>{meta.label}</h3><StatusBadge status={service.status} /><small>{service.amount ? formatCurrency(service.amount) : "ضمن إجمالي الحجز"}</small></div>{editable && <select value={service.status} onChange={(event) => onStatus(event.target.value as ServiceStatus)} className="ajn-mini-select" aria-label={`حالة ${meta.label}`}>{SERVICE_STATUS_VALUES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select>}</article>;
}

function ServiceDetail({ service, booking, editable, onStatus }: { service: BookingService; booking: UnifiedBooking; editable: boolean; onStatus: (status: ServiceStatus) => void }) {
  const meta = SERVICE_META.find((item) => item.key === service.type)!;
  const Icon = meta.icon;
  return <div className="ajn-service-detail"><span className={`ajn-service-detail-icon ajn-service-${meta.accent}`}><Icon /></span><div><small>خدمة ضمن الحجز {booking.number}</small><h2>{meta.label}</h2><p>{service.notes || "كل تفاصيل هذه الخدمة محفوظة ضمن سجل الحجز الموحد، ويمكن للفرق متابعة حالتها من هنا."}</p><div className="flex flex-wrap gap-2 pt-3"><StatusBadge status={service.status} />{editable && <select value={service.status} onChange={(event) => onStatus(event.target.value as ServiceStatus)} className="ajn-native-select w-52">{SERVICE_STATUS_VALUES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select>}</div></div></div>;
}

function TimelineRows({ history, data, compact = false }: { history: any[]; data: UnifiedBooking; compact?: boolean }) {
  const fallback = [{ status: "created", notes: "تم إنشاء الحجز", createdAt: data.createdAt || data.eventDate }];
  const rows = (history.length ? history : fallback).slice(0, compact ? 4 : 20);
  return <div className="ajn-timeline">{rows.map((item, index) => <div key={`${item.id ?? item.createdAt}-${index}`}><i /><time>{dateOnly(item.createdAt ?? item.date ?? item.transactionDate)}</time><span><strong>{item.receiptNumber || item.transactionNo || STATUS_LABELS[item.status] || item.title || "تحديث الحجز"}</strong><small>{item.notes || item.source || item.type || "سجل تشغيلي"}</small></span>{num(item.amount) > 0 && <Money value={num(item.amount)} />}</div>)}</div>;
}

function FinancialPanel({ data, finance, invoiceUrl }: { data: UnifiedBooking; finance: any; invoiceUrl: string }) {
  return <section className="ajn-panel"><div className="ajn-panel-title"><div><CircleDollarSign /><span><small>التحصيل والفواتير</small><h2>اللوحة المالية</h2></span></div><Button variant="outline" asChild><Link href={invoiceUrl}><Printer className="h-4 w-4" /> فتح الفاتورة</Link></Button></div><div className="ajn-financial-grid">{[{ label: "إجمالي الحجز", value: data.total }, { label: "المدفوع", value: data.paid }, { label: "المتبقي", value: data.remaining }].map((item) => <div key={item.label}><small>{item.label}</small><Money value={item.value} /></div>)}</div>{finance?.payments?.length ? <TimelineRows history={finance.payments} data={data} /> : <div className="ajn-inline-note"><ReceiptText /> تُدار سندات القبض وجدول الدفعات من النظام المالي الحالي وترتبط برقم الحجز نفسه.</div>}</section>;
}

function WarehousePanel({ source, id, reservations }: { source: "service" | "kosha"; id: number; reservations: any[] }) {
  return <section className="ajn-panel"><div className="ajn-panel-title"><div><Warehouse /><span><small>الحجز والتسليم والإرجاع</small><h2>المستودع والمعدات</h2></span></div><Button variant="outline" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : "/admin/reserved-stock"}>فتح المستودع <ExternalLink className="h-4 w-4" /></Link></Button></div>{reservations.length ? <div className="ajn-reservation-list">{reservations.map((item) => <div key={item.id}><span><Boxes /><b>{item.productName}</b><small>{item.variantLabel || item.barcode || "مادة محجوزة"}</small></span><strong>{num(item.quantity)} ×</strong><StatusBadge status={item.status} /></div>)}</div> : <div className="ajn-empty compact"><Boxes /><h3>لا توجد مواد محجوزة بعد</h3><p>استخدم وحدة المستودع الحالية لحجز المعدات وتسليمها وإرجاعها.</p></div>}</section>;
}

function EmployeesPanel({ data }: { data: UnifiedBooking }) {
  const raw: any = data.raw;
  const names = [raw.primaryEmployeeName, raw.assistantEmployeeName, raw.customFields?.crewName].filter(Boolean);
  return <section className="ajn-panel"><div className="ajn-panel-title"><div><Users /><span><small>الفرق والمهام</small><h2>الموظفون المكلّفون</h2></span></div><Button variant="outline" asChild><Link href="/admin/tasks">فتح مهام الموظفين</Link></Button></div>{names.length ? <div className="ajn-team-list">{names.map((name: string, index: number) => <div key={`${name}-${index}`}><span>{String(name).slice(0, 1)}</span><div><strong>{name}</strong><small>{index === 0 ? "المسؤول الرئيسي" : "عضو فريق"}</small></div><StatusBadge status="ready" /></div>)}</div> : <div className="ajn-empty compact"><Users /><h3>لم يتم إسناد فريق بعد</h3><p>أسند فرق الكوشة والتصوير والورد والصوت والنقل من نظام الموظفين والمهام.</p></div>}</section>;
}

function EmptyTab({ icon: Icon, title, text, action, href }: { icon: typeof ListChecks; title: string; text: string; action: string; href: string }) {
  return <section className="ajn-panel"><div className="ajn-empty compact"><Icon /><h3>{title}</h3><p>{text}</p><Button variant="outline" asChild><Link href={href}>{action}</Link></Button></div></section>;
}
