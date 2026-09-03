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
  FileDown,
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
  Pencil,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Speaker,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { formatIraqiPhone } from "@/lib/phone";
import { CustomerQuickAddDialog } from "./customer-quick-add";
import { BookingOperationsWorkspace } from "./booking-operations-workspace";
import { EditServiceOrderModal } from "./orders";
import { EditKoshaBookingModal } from "./koshas";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { BookingThermalPrintAction } from "@/components/booking-thermal-print";
import {
  bookingPhotoKey,
  bookingPhotoPreview,
  bookingPhotosFromFields,
  fieldsWithBookingPhotos,
  type BookingPhoto,
} from "@/lib/booking-photos";
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

type SoundItemSource = "store" | "asset";
type SoundBookingItem = {
  productId: number;
  name: string;
  quantity: number;
  barcode?: string | null;
  isAsset: boolean;
  source: SoundItemSource;
};

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
  // A null mode is intentional for legacy bookings: do not guess who supplied transport.
  transportationMode?: "ajn" | "customer" | null;
  transportationFee?: number;
  transportationVehicleId?: number | null;
  transportationVehicleName?: string | null;
  transportationVehiclePlate?: string | null;
  transportationDriverId?: number | null;
  transportationDriverName?: string | null;
  transportationNotes?: string | null;
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
  assignedStaff?: Array<{ id: number; name: string }>;
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

function resolveUnifiedBookingService(
  selected: ServiceKey[],
  services: AdminService[],
) {
  const activeServices = services.filter((service) => service.isActive);
  for (const type of selected) {
    const meta = SERVICE_META.find((item) => item.key === type);
    if (!meta) continue;
    const exact = activeServices.find((service) => {
      const value = `${service.type} ${service.name} ${service.nameAr}`.toLowerCase();
      return [meta.key, meta.short, meta.label, ...meta.aliases].some((alias) =>
        value.includes(alias.toLowerCase()),
      );
    });
    if (exact) return exact;
  }
  // The current database may not yet have a dedicated row for Sound, LED,
  // Flowers or Transport. Keep one unified booking by using the existing
  // generic execution/setup service and stamp the real departments below.
  return (
    activeServices.find((service) =>
      /setup|execution|event|تجهيز|تنفيذ|مناسبات/i.test(
        `${service.type} ${service.name} ${service.nameAr}`,
      ),
    ) ?? activeServices[0]
  );
}

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

const SOUND_CATALOG_HINTS = [
  "sound", "audio", "speaker", "mixer", "microphone", "mic", "dj", "amplifier", "subwoofer", "rcf",
  "صوت", "سماع", "سبيكر", "مكسر", "ميكسر", "ميكرفون", "مايك", "دي جي", "مضخم",
];

function soundCatalogProduct(product: any, categories: any[]) {
  const category = categories.find((item) => Number(item.id) === Number(product?.categoryId ?? product?.category_id));
  const value = [product?.nameAr, product?.name, product?.category, product?.categoryName, category?.nameAr, category?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return SOUND_CATALOG_HINTS.some((hint) => value.includes(hint));
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
  const koshas: UnifiedBooking[] = koshaBookings.map((booking) => {
    const transportationFee = booking.transportationMode === "ajn"
      ? Math.max(0, num(booking.transportationFee))
      : 0;
    const bookingTotal = num(booking.totalAmount);
    // Transportation remains in the same booking total, but is surfaced as a
    // distinct operational service. This never creates another booking or sale.
    const services: BookingService[] = [
      {
        type: "kosha",
        status: normalizeServiceStatus(booking.executionStage || booking.status),
        amount: Math.max(0, bookingTotal - transportationFee),
      },
      ...(booking.transportationMode === "ajn" && transportationFee > 0
        ? [{ type: "transportation" as const, status: normalizeServiceStatus(booking.executionStage || booking.status), amount: transportationFee, notes: booking.transportationVehicleName || booking.transportationNotes || undefined }]
        : []),
    ];
    return {
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
    total: bookingTotal,
    paid: num(booking.paidAmount),
    remaining: num(booking.remainingAmount),
    paymentStatus: booking.paymentStatus || "unpaid",
    services,
    notes: booking.notes || "",
    contractNumber: String(booking.bookingDetails?.contractNumber ?? ""),
    createdAt: booking.createdAt,
    raw: booking,
  };
  });
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

function transportationSummary(booking: UnifiedBooking) {
  if (booking.source !== "kosha") return null;
  const raw = booking.raw as KoshaBooking & { transportationMode?: string | null; transportationFee?: number | string | null };
  if (raw.transportationMode === "customer") return "النقل: من مسؤولية الزبون";
  if (raw.transportationMode === "ajn") return `النقل: بواسطة AJN — ${formatCurrency(num(raw.transportationFee))}`;
  return null;
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
  const openCreateBooking = () => {
    setShowCreate(true);
    window.requestAnimationFrame(() =>
      document.getElementById("booking-create-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  };
  const showServiceBookings = (service: ServiceKey) => {
    setServiceFilter(service);
    window.requestAnimationFrame(() =>
      document.getElementById("booking-list")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
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
          <Button
            className="ajn-rose-button"
            onClick={openCreateBooking}
            aria-controls="booking-create-form"
            aria-expanded={showCreate}
          >
            <Plus className="h-4 w-4" /> حجز موحّد جديد
          </Button>
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
              <Button variant="ghost" size="sm" onClick={() => showServiceBookings(card.key)}>فتح <ChevronLeft className="h-4 w-4" /></Button>
            </article>
          );
        })}
        <article className="ajn-service-card ajn-more-service">
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><span className="ajn-service-icon"><MoreHorizontal /></span><strong>المزيد من الخدمات</strong><Button variant="outline" size="sm" asChild><Link href="/admin/services">إدارة الخدمات</Link></Button></div>
        </article>
      </section>

      <section id="booking-list" className="ajn-booking-list-panel" tabIndex={-1}>
        <div className="ajn-section-heading">
          <div><span>العمل الجاري</span><h2>{serviceFilter === "all" ? "كل الحجوزات" : SERVICE_META.find((item) => item.key === serviceFilter)?.label}</h2></div>
          <div className="relative w-full sm:w-80"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-10" placeholder="رقم الحجز، العميل، الهاتف أو القاعة" /></div>
        </div>
        {centralBookingsQuery.isLoading ? (
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-48 rounded-xl" />)}</div>
        ) : centralBookingsQuery.isError ? (
          <div className="ajn-empty" role="alert">
            <AlertTriangle />
            <h3>تعذر تحميل الحجوزات</h3>
            <p>تعذر الاتصال بسجل الحجوزات. لم يتم استبدال الخطأ بحالة «لا توجد حجوزات».</p>
            <Button type="button" variant="outline" onClick={() => centralBookingsQuery.refetch()}>إعادة المحاولة</Button>
          </div>
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
  const transport = transportationSummary(booking);
  const editHref = booking.source === "service" || booking.source === "kosha"
    ? `/admin/bookings/${booking.source}/${booking.id}?edit=1`
    : booking.source === "store"
      ? `/admin/orders?editOrder=${booking.id}`
      : booking.detailHref || `/admin/bookings/${booking.source}/${booking.id}`;
  const pdfHref = `/admin/invoice/${booking.id}?type=${booking.source === "kosha" ? "kosha" : "booking"}&pdf=1`;
  return (
    <article className="ajn-booking-preview">
      <div className="flex items-start justify-between gap-3">
        <div><small>{booking.number}</small><h3>{booking.customerName}</h3><p>{booking.eventDate || "الموعد غير محدد"} {booking.eventTime && `· ${booking.eventTime}`}</p></div>
        <StatusBadge status={booking.status} />
      </div>
      <div className="ajn-preview-services">{booking.services.slice(0, 5).map((service) => { const meta = SERVICE_META.find((item) => item.key === service.type)!; const Icon = meta.icon; return <span key={service.type} title={meta.label}><Icon /><small>{meta.short}</small></span>; })}</div>
      <div className="ajn-preview-progress"><span><i style={{ width: `${readiness}%` }} /></span><small>الجاهزية {readiness}%</small></div>
      <div className="ajn-preview-finance"><div><small>الإجمالي</small><Money value={booking.total} /></div><div><small>المتبقي</small><Money value={booking.remaining} className={booking.remaining > 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600"} /></div></div>
      {transport ? <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Car className="h-3.5 w-3.5 text-amber-600" /><span>{transport}</span></div> : null}
      {booking.assignedStaff?.length ? <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5 text-primary" /><span className="truncate">{booking.assignedStaff.map((staff) => staff.name).join("، ")}</span></div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{booking.hall || "الموقع غير محدد"}</span></span>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button size="sm" variant="outline" asChild>
            <Link href={editHref} aria-label={`تعديل الحجز ${booking.number || booking.customerName}`}><Pencil className="h-3.5 w-3.5" /> تعديل الحجز</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={pdfHref} target="_blank" rel="noopener noreferrer" aria-label={`حفظ PDF للحجز ${booking.number || booking.customerName}`}><FileDown className="h-3.5 w-3.5" /> حفظ PDF</Link>
          </Button>
          <BookingThermalPrintAction booking={booking} />
          <Button size="sm" variant="ghost" asChild>
            <Link href={booking.detailHref || `/admin/bookings/${booking.source}/${booking.id}`} aria-label={`فتح مساحة عمل الحجز ${booking.number || booking.customerName}`}>فتح مساحة العمل <ChevronLeft className="h-4 w-4" /></Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Searchable customer selector with an inline "add new customer" dialog. */
function BookingCustomerSelector({ value, onChange, error }: { value: Customer | null; onChange: (customer: Customer | null) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const results = useQuery({
    queryKey: ["admin", "customers", "booking-search", query.trim()],
    queryFn: () => adminFetch<Customer[]>(`/admin/customers?search=${encodeURIComponent(query.trim())}`),
    enabled: open && query.trim().length >= 2,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="space-y-2">
        <Label>العميل *</Label>
        <div className={`flex items-center justify-between rounded-lg border bg-background px-3 py-2 ${error ? "border-destructive" : "border-border/40"}`}>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{value.fullName || value.name}</p>
            <p className="text-xs text-muted-foreground" dir="ltr">{formatIraqiPhone(value.phone)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>تغيير</Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="booking-customer-search">العميل *</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="booking-customer-search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="ابحث بالاسم أو رقم الهاتف"
          autoComplete="off"
          aria-invalid={Boolean(error)}
          className={`w-full rounded-lg border bg-background px-3 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${error ? "border-destructive" : "border-border/40"}`}
        />
        {open && query.trim().length >= 2 ? (
          <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border/40 bg-card shadow-xl">
            {results.isFetching ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">جارٍ البحث…</div>
            ) : !results.data?.length ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">لا يوجد عميل مطابق — أضِف عميلاً جديداً</div>
            ) : (
              results.data.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onMouseDown={(event) => { event.preventDefault(); onChange(customer); setOpen(false); setQuery(""); }}
                  className="flex w-full items-center justify-between gap-3 border-b border-border/20 px-3 py-2.5 text-right transition-colors last:border-b-0 hover:bg-primary/10"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{customer.fullName || customer.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{formatIraqiPhone(customer.phone)}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4" /> إضافة عميل جديد
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <CustomerQuickAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultPhone={query}
        onCreated={(customer) => { onChange({ id: customer.id, name: customer.name, fullName: customer.fullName, phone: customer.phone }); setAddOpen(false); }}
      />
    </div>
  );
}

function UnifiedBookingForm({ services, customers, onCancel, onCreated }: { services: AdminService[]; customers: Customer[]; onCancel: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [hallName, setHallName] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [bookingPhotos, setBookingPhotos] = useState<BookingPhoto[]>([]);
  const [replacePhotoIndex, setReplacePhotoIndex] = useState<number | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<ServiceKey[]>(["kosha"]);
  const [photographyType, setPhotographyType] = useState<"video" | "photo_session">("photo_session");
  const [photographyLocation, setPhotographyLocation] = useState<"indoor" | "outdoor">("indoor");
  const [photographyDelivery, setPhotographyDelivery] = useState<"album" | "shots">("shots");
  const [photographyShotsCount, setPhotographyShotsCount] = useState("");
  const [photographyReelsRequested, setPhotographyReelsRequested] = useState(false);
  const [soundItems, setSoundItems] = useState<SoundBookingItem[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const soundSelected = selected.includes("sound");
  const soundProductsQuery = useQuery<any[]>({
    queryKey: ["admin", "products-all", "booking-sound-picker"],
    queryFn: () => adminFetch("/admin/products?limit=2000"),
    enabled: soundSelected,
    staleTime: 30_000,
  });
  const categoriesQuery = useQuery<any[]>({
    queryKey: ["admin", "categories", "booking-sound-picker"],
    queryFn: () => adminFetch("/admin/categories"),
    enabled: soundSelected,
    staleTime: 5 * 60_000,
  });
  const focusField = (field: string) => {
    const fieldId: Record<string, string> = {
      customer: "booking-customer-search",
      phone: "booking-customer-search",
      eventDate: "booking-date",
      totalAmount: "booking-total",
      depositAmount: "booking-deposit",
      serviceId: "booking-service-picker",
    };
    window.requestAnimationFrame(() =>
      document.getElementById(fieldId[field] ?? "booking-date")?.focus(),
    );
  };
  const failField = (field: string, message: string): never => {
    setFieldErrors({ [field]: message });
    focusField(field);
    throw new Error(message);
  };
  const mutation = useMutation({
    mutationFn: async () => {
      setFieldErrors({});
      const selectedCustomer = customer;
      if (!selectedCustomer) {
        setFieldErrors({ customer: "اختر العميل أولاً" });
        focusField("customer");
        throw new Error("اختر العميل أولاً");
      }
      if (!eventDate) failField("eventDate", "حدد تاريخ المناسبة");
      if (!selected.length) failField("serviceId", "اختر خدمة واحدة على الأقل");
      const primary = resolveUnifiedBookingService(selected, services);
      if (!primary) failField("serviceId", "لا توجد خدمة فعالة. أضف خدمة من إدارة الخدمات أولاً.");
      return adminFetch("/admin/service-orders", {
        method: "POST",
        body: JSON.stringify({
          serviceId: primary.id,
          customerName: selectedCustomer.fullName || selectedCustomer.name,
          phone: selectedCustomer.phone,
          eventDate,
          eventLocation: hallName,
          totalAmount: num(totalAmount),
          depositAmount: Math.min(num(depositAmount), num(totalAmount)),
          paymentStatus:
            num(depositAmount) <= 0
              ? "unpaid"
              : num(depositAmount) >= num(totalAmount) && num(totalAmount) > 0
                ? "paid"
                : "partial",
          notes,
          customFields: {
            bookingCenterVersion: 1,
            customerId: selectedCustomer.id,
            eventTime,
            hallName,
            mapUrl,
            contractNumber,
            ...fieldsWithBookingPhotos({}, bookingPhotos),
            departments: selected,
            bookingCenterServices: selected.map((type) => ({ type, status: "waiting", amount: 0 })),
            ...(selected.includes("sound") && soundItems.length ? { soundItems } : {}),
            ...(selected.includes("photography")
              ? {
                  photographyServiceKind: photographyType,
                  photographyReelsRequested,
                  ...(photographyType === "photo_session"
                    ? {
                        photoSessionLocation: photographyLocation,
                        photoSessionDelivery: photographyDelivery,
                        photoShotCount: photographyShotsCount ? num(photographyShotsCount) : null,
                      }
                    : {}),
                }
              : {}),
          },
        }),
      });
    },
    onSuccess: onCreated,
    onError: (error: any) => {
      const returnedErrors = error?.fieldErrors;
      if (returnedErrors && typeof returnedErrors === "object" && Object.keys(returnedErrors).length) {
        setFieldErrors(returnedErrors);
        focusField(Object.keys(returnedErrors)[0]);
      }
      toast({ title: "تعذر حفظ الحجز", description: apiErrorMessage(error, "تحقق من البيانات وحاول مرة أخرى."), variant: "destructive" });
    },
  });
  const totalValue = num(totalAmount);
  const depositValue = num(depositAmount);
  const depositTooHigh = depositValue > totalValue;
  const remainingValue = Math.max(
    0,
    totalValue - Math.min(depositValue, totalValue),
  );
  const paymentStatusLabel =
    depositValue <= 0
      ? "غير مدفوع"
      : remainingValue <= 0 && totalValue > 0
        ? "مدفوع بالكامل"
        : "مدفوع جزئياً";
  const removeService = (type: ServiceKey) => {
    if (selected.length <= 1) {
      toast({ title: "يلزم اختيار خدمة واحدة على الأقل", description: "لا يمكن إزالة آخر خدمة من الحجز.", variant: "destructive" });
      return;
    }
    setSelected((current) => current.filter((item) => item !== type));
    if (type === "sound") setSoundItems([]);
  };
  const toggle = (type: ServiceKey) => {
    if (selected.includes(type)) {
      removeService(type);
      return;
    }
    setSelected((current) => [...current, type]);
  };
  const editService = (type: ServiceKey) => {
    const targetId = type === "photography"
      ? "booking-photography-settings"
      : type === "sound"
        ? "booking-sound-items"
        : "booking-service-picker";
    window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const photographySelected = selected.includes("photography");
  return (
    <section id="booking-create-form" className="ajn-unified-form" tabIndex={-1}>
      <div className="ajn-section-heading"><div><span>إدخال سريع</span><h2>إنشاء حجز متعدد الخدمات</h2><p>لن تُنشأ فاتورة أو حركة صندوق حتى تنفيذ الإجراء من وحدته المالية الحالية.</p></div><Button variant="ghost" onClick={onCancel}>إغلاق</Button></div>
      <div className="grid gap-4 p-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <BookingCustomerSelector value={customer} onChange={setCustomer} error={fieldErrors.customer || fieldErrors.phone} />
            <div className="space-y-2"><Label htmlFor="booking-contract">رقم العقد</Label><Input id="booking-contract" value={contractNumber} onChange={(event) => setContractNumber(event.target.value)} placeholder="يُترك فارغاً عند عدم وجود عقد" /></div>
            <div className="space-y-2"><Label htmlFor="booking-date">تاريخ المناسبة *</Label><Input id="booking-date" type="date" aria-invalid={Boolean(fieldErrors.eventDate)} className={fieldErrors.eventDate ? "border-destructive" : ""} value={eventDate} onChange={(event) => { setEventDate(event.target.value); setFieldErrors((current) => ({ ...current, eventDate: "" })); }} />{fieldErrors.eventDate ? <p className="text-xs text-destructive">{fieldErrors.eventDate}</p> : null}</div>
            <div className="space-y-2"><Label htmlFor="booking-time">وقت المناسبة</Label><Input id="booking-time" type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="booking-hall">القاعة / الموقع</Label><Input id="booking-hall" value={hallName} onChange={(event) => setHallName(event.target.value)} placeholder="اسم القاعة والعنوان" /></div>
            <div className="space-y-2"><Label htmlFor="booking-map">رابط Google Maps</Label><Input id="booking-map" dir="ltr" value={mapUrl} onChange={(event) => setMapUrl(event.target.value)} placeholder="https://maps.google.com/..." /></div>
            <div className="space-y-2"><Label htmlFor="booking-total">المبلغ الكلي</Label><Input id="booking-total" inputMode="decimal" aria-invalid={Boolean(fieldErrors.totalAmount)} className={fieldErrors.totalAmount ? "border-destructive" : ""} value={totalAmount} onChange={(event) => { setTotalAmount(event.target.value.replace(/[^0-9.]/g, "")); setFieldErrors((current) => ({ ...current, totalAmount: "" })); }} placeholder="0 د.ع" />{fieldErrors.totalAmount ? <p className="text-xs text-destructive">{fieldErrors.totalAmount}</p> : null}</div>
            <div className="space-y-2"><Label htmlFor="booking-deposit">العربون</Label><Input id="booking-deposit" inputMode="decimal" aria-invalid={depositTooHigh} className={depositTooHigh ? "border-destructive" : ""} value={depositAmount} onChange={(event) => setDepositAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 د.ع" />{depositTooHigh ? <p className="text-xs text-destructive">لا يمكن أن يتجاوز العربون المبلغ الكلي.</p> : null}</div>
            <div className="space-y-2"><Label htmlFor="booking-remaining">المتبقي</Label><Input id="booking-remaining" value={formatCurrency(remainingValue)} readOnly className="bg-muted/35 tabular-nums" dir="ltr" /><p className="text-xs font-medium text-primary">{paymentStatusLabel}</p></div>
          </div>
          <div className="space-y-2 rounded-xl border border-border/30 bg-background/35 p-3">
            <div><Label>إرفاق صور الحجز (اختياري)</Label><p className="mt-1 text-xs text-muted-foreground">اختر عدة صور من المعرض أو التقط صورة بالكاميرا. تُحفظ روابط الصور ضمن سجل الحجز نفسه.</p></div>
            {bookingPhotos.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{bookingPhotos.map((photo, index) => <div key={bookingPhotoKey(photo)} className="overflow-hidden rounded-lg border border-border/30 bg-background"><img src={bookingPhotoPreview(photo)} alt={`صورة الحجز ${index + 1}`} className="aspect-square w-full object-cover" /><div className="grid grid-cols-2 gap-1 p-1"><Button type="button" variant="ghost" size="sm" onClick={() => setReplacePhotoIndex(index)}>استبدال</Button><Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setBookingPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}>حذف</Button></div></div>)}</div> : <div className="rounded-lg border border-dashed border-border/30 p-5 text-center text-xs text-muted-foreground">لم تُرفق صور بعد</div>}
            <ImageUploadEditor
              kind="attachment"
              multiple={replacePhotoIndex == null}
              showCameraAction
              label={replacePhotoIndex == null ? "اختيار صور من المعرض" : "اختيار بديل للصورة المحددة"}
              onUploadStateChange={setImageUploading}
              onComplete={(results: ImageEditResult[]) => {
                const uploaded = results.flatMap((result) => {
                  const metadata = result.metadata as ImageEditResult["metadata"] & Record<string, string | undefined>;
                  const url = metadata.originalUrl || metadata.largeUrl || metadata.mediumUrl;
                  return url ? [{ url, thumbnailUrl: metadata.thumbnailUrl || null, mediumUrl: metadata.mediumUrl || null, largeUrl: metadata.largeUrl || null, checksum: metadata.checksum || null, addedAt: new Date().toISOString() }] : [];
                });
                if (!uploaded.length) return;
                setBookingPhotos((current) => replacePhotoIndex == null ? [...current, ...uploaded] : current.map((photo, index) => index === replacePhotoIndex ? uploaded[0] : photo));
                setReplacePhotoIndex(null);
              }}
            />
            {replacePhotoIndex != null ? <Button type="button" variant="ghost" size="sm" onClick={() => setReplacePhotoIndex(null)}>إلغاء الاستبدال</Button> : null}
          </div>
          <div className="space-y-2"><Label htmlFor="booking-notes">ملاحظات</Label><Textarea id="booking-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="تفاصيل خاصة بالمناسبة أو العميل" /></div>
        </div>
        <div id="booking-service-picker" tabIndex={-1} className={`ajn-service-picker ${fieldErrors.serviceId ? "ring-1 ring-destructive" : ""}`}>
          <div><span>الخدمات المطلوبة</span><strong>{selected.length} خدمات محددة</strong></div>
          <div className="grid grid-cols-2 gap-2">{SERVICE_META.map((meta) => { const Icon = meta.icon; const checked = selected.includes(meta.key); return <button type="button" key={meta.key} className={checked ? "is-selected" : ""} onClick={() => toggle(meta.key)} aria-pressed={checked}><Icon /><span>{meta.short}</span>{checked && <CheckCircle2 />}</button>; })}</div>
          {fieldErrors.serviceId ? <p className="text-xs text-destructive">{fieldErrors.serviceId}</p> : null}
          {selected.length ? <section className="mt-4 space-y-2 rounded-xl border border-border/60 bg-background/70 p-3" aria-label="الخدمات المختارة">
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-foreground">الخدمات المختارة</h3><span className="text-xs text-muted-foreground">يمكنك تعديل الإعدادات أو إزالة الخدمة من هذا الحجز</span></div>
            <div className="space-y-1.5">{selected.map((type) => {
              const meta = SERVICE_META.find((item) => item.key === type);
              if (!meta) return null;
              const Icon = meta.icon;
              const hasSettings = type === "photography" || type === "sound";
              return <div key={type} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border/45 bg-muted/20 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{meta.short}</span></span>
                <span className="flex shrink-0 items-center gap-1">
                  {hasSettings ? <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => editService(type)}><Pencil className="h-3.5 w-3.5" />تعديل</Button> : null}
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" disabled={selected.length <= 1} title={selected.length <= 1 ? "يلزم اختيار خدمة واحدة على الأقل" : `إزالة ${meta.short} من الحجز`} onClick={() => removeService(type)}><X className="h-3.5 w-3.5" />إزالة</Button>
                </span>
              </div>;
            })}</div>
          </section> : null}
          {photographySelected ? <section id="booking-photography-settings" className="mt-4 space-y-3 rounded-xl border border-rose-200/70 bg-rose-50/45 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
            <div><h3 className="font-semibold text-foreground">تفاصيل التصوير</h3><p className="mt-1 text-xs text-muted-foreground">تُحفظ هذه التفاصيل مع الحجز لتظهر لفريق التصوير.</p></div>
            <div className="space-y-1.5"><Label htmlFor="booking-photography-type">نوع التصوير</Label><select id="booking-photography-type" value={photographyType} onChange={(event) => setPhotographyType(event.target.value as "video" | "photo_session")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="video">تصوير فيديو</option><option value="photo_session">جلسة تصوير</option></select></div>
            {photographyType === "photo_session" ? <>
              <div className="grid grid-cols-2 gap-2"><div className="space-y-1.5"><Label htmlFor="booking-photography-location">المكان</Label><select id="booking-photography-location" value={photographyLocation} onChange={(event) => setPhotographyLocation(event.target.value as "indoor" | "outdoor")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="indoor">داخلي</option><option value="outdoor">خارجي</option></select></div><div className="space-y-1.5"><Label htmlFor="booking-photography-delivery">الطلب</Label><select id="booking-photography-delivery" value={photographyDelivery} onChange={(event) => setPhotographyDelivery(event.target.value as "album" | "shots")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="album">ألبوم</option><option value="shots">لقطات</option></select></div></div>
              <div className="space-y-1.5"><Label htmlFor="booking-photography-shots">عدد اللقطات</Label><Input id="booking-photography-shots" inputMode="numeric" min="1" type="number" value={photographyShotsCount} onChange={(event) => setPhotographyShotsCount(event.target.value.replace(/[^0-9]/g, ""))} placeholder="مثال: 30" /></div>
            </> : null}
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/45 bg-background/80 px-3 py-2 text-sm"><span>هل تريد ريلز معها؟</span><input type="checkbox" checked={photographyReelsRequested} onChange={(event) => setPhotographyReelsRequested(event.target.checked)} className="h-4 w-4 accent-rose-600" /><span className="sr-only">طلب ريلز</span></label>
          </section> : null}
          {soundSelected ? <SoundItemsSelector products={soundProductsQuery.data ?? []} categories={categoriesQuery.data ?? []} loading={soundProductsQuery.isLoading || categoriesQuery.isLoading} items={soundItems} onChange={setSoundItems} /> : null}
          <div className="mt-auto flex gap-2 pt-4"><Button variant="outline" onClick={onCancel} className="flex-1">إلغاء</Button><Button onClick={() => mutation.mutate()} disabled={mutation.isPending || imageUploading || depositTooHigh} className="ajn-rose-button flex-1">{imageUploading ? "جارٍ رفع الصور..." : mutation.isPending ? "جارٍ الحفظ..." : "حفظ الحجز"}</Button></div>
        </div>
      </div>
    </section>
  );
}

function SoundItemsSelector({ products, categories, loading, items, onChange }: { products: any[]; categories: any[]; loading: boolean; items: SoundBookingItem[]; onChange: (items: SoundBookingItem[]) => void }) {
  const [source, setSource] = useState<SoundItemSource>("store");
  const [search, setSearch] = useState("");
  const selectedIds = useMemo(() => new Set(items.map((item) => item.productId)), [items]);
  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products
      .filter((product) => product?.isActive !== false && !product?.archivedAt)
      .filter((product) => Boolean(product?.isAsset) === (source === "asset"))
      .filter((product) => soundCatalogProduct(product, categories))
      .filter((product) => !selectedIds.has(Number(product.id)))
      .filter((product) => !query || [product.nameAr, product.name, product.barcode].some((value) => String(value ?? "").toLowerCase().includes(query)))
      .slice(0, 8);
  }, [categories, products, search, selectedIds, source]);
  const add = (product: any) => onChange([...items, {
    productId: Number(product.id),
    name: product.nameAr || product.name || `#${product.id}`,
    quantity: 1,
    barcode: product.barcode ?? null,
    isAsset: Boolean(product.isAsset),
    source,
  }]);
  const updateQuantity = (productId: number, quantity: number) => onChange(items.map((item) => item.productId === productId ? { ...item, quantity: Math.max(1, Math.floor(quantity) || 1) } : item));
  return <section id="booking-sound-items" className="mt-4 space-y-3 rounded-xl border border-amber-200/70 bg-amber-50/45 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
    <div><h3 className="flex items-center gap-2 font-semibold text-foreground"><Speaker className="h-4 w-4 text-amber-700" />تجهيزات الصوت</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">اختر معدات الصوت من المتجر أو من الأصول. لا يتم إخراج الأصل أو حجز المخزون من هذه الخطوة؛ يتم ذلك لاحقاً من مساحة تنفيذ الحجز.</p></div>
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="مصدر تجهيزات الصوت">
      <Button type="button" size="sm" variant={source === "store" ? "default" : "outline"} className="justify-start" onClick={() => setSource("store")}><ShoppingBag className="h-4 w-4" />إضافة من المتجر</Button>
      <Button type="button" size="sm" variant={source === "asset" ? "default" : "outline"} className="justify-start" onClick={() => setSource("asset")}><Boxes className="h-4 w-4" />إضافة من الأصول</Button>
    </div>
    <div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder={source === "store" ? "ابحث في منتجات الصوت…" : "ابحث في أصول الصوت…"} /></div>
    {loading ? <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-center text-xs text-muted-foreground">جارٍ تحميل عناصر الصوت…</div> : candidates.length ? <div className="max-h-44 overflow-y-auto rounded-lg border border-border/40 bg-background/70">{candidates.map((product) => <button key={product.id} type="button" className="flex w-full items-center justify-between gap-3 border-b border-border/30 px-3 py-2.5 text-right text-sm last:border-b-0 hover:bg-primary/5" onClick={() => add(product)}><span className="min-w-0 truncate font-medium">{product.nameAr || product.name}</span><span className="shrink-0 text-xs text-primary">إضافة</span></button>)}</div> : <p className="rounded-lg border border-dashed border-border/40 px-3 py-3 text-center text-xs text-muted-foreground">لا توجد عناصر صوتيات مطابقة في {source === "store" ? "المتجر" : "الأصول"}.</p>}
    {items.length ? <div className="space-y-2 rounded-lg border border-border/40 bg-background/70 p-2"><div className="flex items-center justify-between px-1"><b className="text-xs">العناصر المختارة</b><span className="text-xs text-muted-foreground">{items.length} عناصر</span></div>{items.map((item) => <div key={item.productId} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 rounded-md bg-muted/35 px-2 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-[11px] text-muted-foreground">{item.source === "asset" ? "من الأصول" : "من المتجر"}{item.barcode ? ` · ${item.barcode}` : ""}</p></div><Input type="number" min="1" value={item.quantity} aria-label={`كمية ${item.name}`} onChange={(event) => updateQuantity(item.productId, Number(event.target.value))} /><Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`إزالة ${item.name}`} onClick={() => onChange(items.filter((candidate) => candidate.productId !== item.productId))}><X className="h-4 w-4" /></Button></div>)}</div> : null}
  </section>;
}

function BookingWorkspace({ source, id }: { source: "service" | "kosha"; id: number }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "1");
  const serviceOrdersQuery = useQuery({ queryKey: ["admin", "booking-workspace", "service-orders"], queryFn: () => adminFetch<ServiceOrder[]>("/admin/service-orders?limit=250"), enabled: source === "service" });
  const koshaQuery = useQuery({ queryKey: ["admin", "booking-workspace", "kosha"], queryFn: () => adminFetch<KoshaBooking[]>("/admin/kosha-bookings?search=&status="), enabled: source === "kosha" });
  const activeQuery = source === "service" ? serviceOrdersQuery : koshaQuery;
  const data = useMemo(() => unify(serviceOrdersQuery.data ?? [], koshaQuery.data ?? []).find((booking) => booking.source === source && booking.id === id), [source, id, serviceOrdersQuery.data, koshaQuery.data]);
  if (activeQuery.isLoading) return <div className="space-y-4"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-[520px] rounded-2xl" /></div>;
  if (activeQuery.isError) return <div className="ajn-empty" role="alert"><AlertTriangle /><h2>تعذر فتح الحجز</h2><p>حدث خطأ أثناء تحميل بيانات الحجز. لم يتم اعتبار هذا الخطأ حجزاً غير موجود.</p><div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="outline" onClick={() => activeQuery.refetch()}>إعادة المحاولة</Button><Button asChild><Link href="/admin/bookings">العودة إلى مركز الحجوزات</Link></Button></div></div>;
  if (!data) return <div className="ajn-empty"><AlertTriangle /><h2>الحجز غير موجود</h2><p>قد يكون مؤرشفاً أو لم تعد لديك صلاحية عرضه.</p><Button asChild><Link href="/admin/bookings">العودة إلى مركز الحجوزات</Link></Button></div>;
  const closeEditor = () => {
    setEditing(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };
  const saved = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "booking-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
    closeEditor();
  };
  return <>
    <BookingOperationsWorkspace booking={data as any} onEdit={() => setEditing(true)} />
    {editing && source === "service" ? <EditServiceOrderModal order={data.raw as any} onClose={closeEditor} onSaved={saved} /> : null}
    {editing && source === "kosha" ? <EditKoshaBookingModal booking={data.raw as any} onClose={closeEditor} onSaved={saved} /> : null}
  </>;
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
        <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> واتساب</a></Button>{data.mapUrl && <Button variant="outline" asChild><a href={data.mapUrl} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" /> الخريطة</a></Button>}<Button variant="outline" asChild><Link href={`${invoiceUrl}&pdf=1`}><FileDown className="h-4 w-4" /> حفظ الحجز PDF</Link></Button><BookingThermalPrintAction booking={data} /><Button className="ajn-rose-button" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : `/admin/orders?serviceOrder=${id}`}><Banknote className="h-4 w-4" /> استلام دفعة</Link></Button></div>
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
            <TabsContent value="attachments"><BookingAttachmentsPanel data={data} /></TabsContent>
            <TabsContent value="timeline"><section className="ajn-panel"><div className="ajn-panel-title"><div><Clock3 /><span><small>السجل التشغيلي</small><h2>التايم لاين المباشر</h2></span></div></div><TimelineRows history={history} data={data} /></section></TabsContent>
            <TabsContent value="notes"><section className="ajn-panel"><div className="ajn-panel-title"><div><ReceiptText /><span><small>معلومات إضافية</small><h2>ملاحظات الحجز</h2></span></div></div><p className="min-h-40 whitespace-pre-wrap p-5 text-sm leading-8 text-muted-foreground">{data.notes || "لا توجد ملاحظات مسجلة لهذا الحجز."}</p></section></TabsContent>
          </Tabs>
        </main>
        <aside className="ajn-workspace-aside">
          <section className="ajn-finance-card"><div><span>الملخص المالي</span><Badge variant="outline">{data.paymentStatus === "paid" ? "مدفوع بالكامل" : data.paymentStatus === "partial" ? "مدفوع جزئياً" : "غير مدفوع"}</Badge></div><dl><dt>المبلغ الكلي <dd><Money value={data.total} /></dd></dt><dt>العربون <dd><Money value={data.paid} /></dd></dt><dt className="is-remaining">المتبقي <dd><Money value={data.remaining} /></dd></dt></dl><Button className="ajn-rose-button w-full" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : `/admin/orders?serviceOrder=${id}`}><Banknote className="h-4 w-4" /> استلام دفعة</Link></Button></section>
          <section className="ajn-side-panel"><h3>إجراءات سريعة</h3><div className="ajn-quick-actions"><Button variant="ghost" asChild><Link href={invoiceUrl}><Printer /> طباعة الفاتورة</Link></Button><BookingThermalPrintAction booking={data} variant="ghost" className="w-full justify-start" /><Button variant="ghost" asChild><Link href="/admin/documents"><ReceiptText /> طباعة العقد</Link></Button><Button variant="ghost" asChild><Link href="/admin/qr-orders"><QrCode /> إنشاء QR</Link></Button><Button variant="ghost" asChild><Link href="/admin/tasks"><Users /> إسناد موظفين</Link></Button><Button variant="ghost" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : "/admin/reserved-stock"}><Warehouse /> حجز مستودع</Link></Button><Button variant="ghost" asChild><Link href="/admin/invitations"><Send /> دعوة إلكترونية</Link></Button><Button variant="ghost" asChild><Link href={data.customerId ? `/admin/customers?customer=${data.customerId}` : `/admin/customers?search=${encodeURIComponent(data.phone)}`}><ExternalLink /> فتح العميل</Link></Button></div></section>
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
  return <section className="ajn-panel"><div className="ajn-panel-title"><div><CircleDollarSign /><span><small>التحصيل والفواتير</small><h2>اللوحة المالية</h2></span></div><Button variant="outline" asChild><Link href={invoiceUrl}><Printer className="h-4 w-4" /> فتح الفاتورة</Link></Button></div><div className="ajn-financial-grid">{[{ label: "المبلغ الكلي", value: data.total }, { label: "العربون", value: data.paid }, { label: "المتبقي", value: data.remaining }].map((item) => <div key={item.label}><small>{item.label}</small><Money value={item.value} /></div>)}</div><p className="mt-3 text-xs font-semibold text-primary">حالة الدفع: {data.paymentStatus === "paid" ? "مدفوع بالكامل" : data.paymentStatus === "partial" ? "مدفوع جزئياً" : "غير مدفوع"}</p>{finance?.payments?.length ? <TimelineRows history={finance.payments} data={data} /> : <div className="ajn-inline-note"><ReceiptText /> تُدار سندات القبض وجدول الدفعات من النظام المالي الحالي وترتبط برقم الحجز نفسه.</div>}</section>;
}

function WarehousePanel({ source, id, reservations }: { source: "service" | "kosha"; id: number; reservations: any[] }) {
  return <section className="ajn-panel"><div className="ajn-panel-title"><div><Warehouse /><span><small>الحجز والتسليم والإرجاع</small><h2>المستودع والمعدات</h2></span></div><Button variant="outline" asChild><Link href={source === "kosha" ? `/admin/kosha-bookings?booking=${id}` : "/admin/reserved-stock"}>فتح المستودع <ExternalLink className="h-4 w-4" /></Link></Button></div>{reservations.length ? <div className="ajn-reservation-list">{reservations.map((item) => <div key={item.id}><span><Boxes /><b>{item.productName}</b><small>{item.variantLabel || item.barcode || "مادة محجوزة"}</small></span><strong>{num(item.quantity)} ×</strong><StatusBadge status={item.status} /></div>)}</div> : <div className="ajn-empty compact"><Boxes /><h3>لا توجد مواد محجوزة بعد</h3><p>استخدم وحدة المستودع الحالية لحجز المعدات وتسليمها وإرجاعها.</p></div>}</section>;
}

function EmployeesPanel({ data }: { data: UnifiedBooking }) {
  const raw: any = data.raw;
  const names = [raw.primaryEmployeeName, raw.assistantEmployeeName, raw.customFields?.crewName].filter(Boolean);
  return <section className="ajn-panel"><div className="ajn-panel-title"><div><Users /><span><small>الفرق والمهام</small><h2>الموظفون المكلّفون</h2></span></div><Button variant="outline" asChild><Link href="/admin/tasks">فتح مهام الموظفين</Link></Button></div>{names.length ? <div className="ajn-team-list">{names.map((name: string, index: number) => <div key={`${name}-${index}`}><span>{String(name).slice(0, 1)}</span><div><strong>{name}</strong><small>{index === 0 ? "المسؤول الرئيسي" : "عضو فريق"}</small></div><StatusBadge status="ready" /></div>)}</div> : <div className="ajn-empty compact"><Users /><h3>لم يتم إسناد فريق بعد</h3><p>أسند فرق الكوشة والتصوير والورد والصوت والنقل من نظام الموظفين والمهام.</p></div>}</section>;
}

function BookingAttachmentsPanel({ data }: { data: UnifiedBooking }) {
  const raw = data.raw as ServiceOrder;
  const photos = bookingPhotosFromFields(raw.customFields);

  return (
    <section className="ajn-panel">
      <div className="ajn-panel-title"><div><PackageCheck /><span><small>الصور والمستندات</small><h2>مرفقات الحجز</h2></span></div></div>
      {photos.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo, index) => (
            <a key={bookingPhotoKey(photo)} href={photo.largeUrl || photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border/30 bg-background/50 p-1.5">
              <img src={bookingPhotoPreview(photo)} alt={`صورة الحجز ${data.number} - ${index + 1}`} className="aspect-square w-full rounded-lg object-cover" />
            </a>
          ))}
        </div>
      ) : (
        <div className="ajn-empty compact"><PackageCheck /><h3>لا توجد صور مرفقة</h3><p>يمكن إرفاق الصور عند إنشاء الحجز أو تعديله.</p></div>
      )}
      <div className="mt-3"><Button variant="outline" asChild><Link href="/admin/documents">فتح مركز المستندات</Link></Button></div>
    </section>
  );
}

function EmptyTab({ icon: Icon, title, text, action, href }: { icon: typeof ListChecks; title: string; text: string; action: string; href: string }) {
  return <section className="ajn-panel"><div className="ajn-empty compact"><Icon /><h3>{title}</h3><p>{text}</p><Button variant="outline" asChild><Link href={href}>{action}</Link></Button></div></section>;
}
