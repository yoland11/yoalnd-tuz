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
  Layers3,
  ListChecks,
  Loader2,
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
  Save,
  Send,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Speaker,
  Trash2,
  Users,
  Video,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { printStandaloneDocument } from "@/lib/pdf";
import { shortBookingNumber } from "@/lib/booking-number";
import { formatIraqiPhone } from "@/lib/phone";
import { CustomerQuickAddDialog } from "./customer-quick-add";
import { BookingOperationsWorkspace } from "./booking-operations-workspace";
import { EditServiceOrderModal } from "./orders";
import { EditKoshaBookingModal } from "./koshas";
import { ImageUploadEditor, type ImageEditResult } from "@/components/image-upload-editor";
import { BookingThermalPrintAction } from "@/components/booking-thermal-print";
import { BookingThermalReceiptAction } from "@/components/booking-thermal-receipt";
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

// Kosha catalogue for the unified booking form (same active packages and
// koshas as the public /koshas page, with real prices).
type KoshaCatalogPackage = { id: number; name: string; price: number; mainImage: string | null; features: string[]; badgeText: string | null; isFeatured: boolean };
type KoshaCatalogKosha = { id: number; name: string; price: number; mainImage: string | null; availabilityStatus: string | null };
type KoshaCatalog = { packages: KoshaCatalogPackage[]; koshas: KoshaCatalogKosha[] };
type KoshaPick = { mode: "package" | "custom"; id: number; name: string; price: number };

// Flowers section of the unified booking form: the same catalogue and sections
// as the public bouquet studio (/design, /api/products/designer-catalog).
type FlowerSection = "flowers" | "bridal_bouquets" | "ready_bouquets" | "wrapping" | "ribbons" | "extras";
const FLOWER_SECTIONS: Array<{ key: FlowerSection; label: string }> = [
  { key: "flowers", label: "الورود" },
  { key: "bridal_bouquets", label: "المسكات" },
  { key: "ready_bouquets", label: "الباقات الجاهزة" },
  { key: "wrapping", label: "التغليف" },
  { key: "ribbons", label: "الأشرطة" },
  { key: "extras", label: "إكسسوارات الباقة" },
];
type FlowerCatalogVariant = { id: number; color: string | null; colorHex: string | null; image?: string | null; price: number | null; available?: number; stock: number; isActive?: boolean };
type FlowerCatalogProduct = { id: number; name: string; nameAr: string; price: number; stock: number; designerSection: FlowerSection; images: string[]; variants: FlowerCatalogVariant[] };
type FlowerBookingItem = { key: string; productId: number; variantId: number | null; name: string; variantLabel: string | null; section: FlowerSection; quantity: number; unitPrice: number };
type PhotographyServiceLine = { productId: number; productName: string; unit: string; quantity: number; unitPrice: number; discount: number };

function flowerItemsTotal(items: FlowerBookingItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function flowerItemsSummary(items: FlowerBookingItem[]): string {
  const lines = items.map((item) => `${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} × ${item.quantity}`).join("، ");
  const text = `${lines} · المجموع ${formatCurrency(flowerItemsTotal(items))}`;
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

// Store products picked inside a booking (video packages, giveaways). Like the
// flowers, they are priced into the booking total; stock is handled later from
// the booking's execution workspace, not at creation.
type StoreBookingItem = { key: string; productId: number; variantId: number | null; name: string; variantLabel: string | null; quantity: number; unitPrice: number };
const VIDEO_STORE_HINTS = ["تصوير", "فيديو", "فديو", "video", "photography"];
const GIFT_STORE_HINTS = ["هدايا", "هدية", "هديه", "توزيع", "gift"];

function storeItemsTotal(items: StoreBookingItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function storeItemsSummary(items: StoreBookingItem[]): string {
  const lines = items.map((item) => `${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} × ${item.quantity}`).join("، ");
  const text = `${lines} · المجموع ${formatCurrency(storeItemsTotal(items))}`;
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

/** Store categories whose name matches a hint, plus all of their sub-categories. */
function storeCategoryIds(categories: any[], hints: string[]): Set<number> {
  const label = (category: any) => `${category?.nameAr ?? ""} ${category?.name ?? ""}`.toLowerCase();
  const ids = new Set(categories.filter((category) => hints.some((hint) => label(category).includes(hint))).map((category) => Number(category.id)));
  for (let grew = true; grew;) {
    grew = false;
    for (const category of categories) {
      const parent = Number(category?.parentId ?? category?.parent_id);
      if (parent && ids.has(parent) && !ids.has(Number(category.id))) { ids.add(Number(category.id)); grew = true; }
    }
  }
  return ids;
}

async function fetchFlowerCatalog(): Promise<FlowerCatalogProduct[]> {
  const response = await fetch("/api/products/designer-catalog", { credentials: "include" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "تعذر تحميل منتجات الورد");
  const products = Array.isArray(payload?.products) ? payload.products : [];
  return products.filter((product: any) => FLOWER_SECTIONS.some((section) => section.key === product.designerSection));
}

// Informational only — catalogue availability is not date-specific, so it never blocks a pick.
const KOSHA_AVAILABILITY_NOTE: Record<string, string> = {
  unavailable: "غير متاحة حالياً",
  maintenance: "بالصيانة",
  damaged: "متضررة",
  in_use: "قيد الاستخدام",
  reserved: "محجوزة",
};

function koshaPickLabel(pick: KoshaPick): string {
  const kind = pick.mode === "package" ? "باقة جاهزة" : "كوشة (اختياري)";
  return `${kind}: ${pick.name}${pick.price > 0 ? ` · ${formatCurrency(pick.price)}` : ""}`;
}

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
  serviceItems?: Array<{ id: number; productId: number | null; productName: string; unit: string; quantity: number; unitPrice: number; discount: number; total: number }>;
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
  // Long secret tracking code (QR / links only); kept so staff can still search by it.
  trackingCode?: string | null;
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
    number: shortBookingNumber("service", order.id, order.trackingCode) || `AJN-${String(order.id).padStart(5, "0")}`,
    trackingCode: order.trackingCode ?? null,
    // Prefer the canonical service_orders.customer_id (Phase 1) over the legacy
    // value mirrored into customFields, so the unified customer account resolves
    // to the one real customer.
    customerId: num((order as any).customerId ?? order.customFields?.customerId) || null,
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
    number: shortBookingNumber("kosha", booking.id, booking.trackingCode) || `KB-${String(booking.id).padStart(5, "0")}`,
    trackingCode: booking.trackingCode ?? null,
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

function escapeReportHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type BookingReportType = "summary" | "remaining" | "pending_work" | "upcoming" | "collected" | "completed";

const BOOKING_REPORT_TYPES: Array<{ key: BookingReportType; label: string; hint: string }> = [
  { key: "summary", label: "تقرير شامل", hint: "كل الحجوزات مقسّمة حسب القسم" },
  { key: "remaining", label: "المبالغ المتبقية", hint: "الحجوزات التي عليها مبالغ غير مسددة" },
  { key: "pending_work", label: "الأعمال المتبقية", hint: "حجوزات لم تُنجز بعد (المتأخرة مميّزة)" },
  { key: "upcoming", label: "المناسبات القادمة", hint: "حسب تاريخ المناسبة — افتراضياً 7 أيام" },
  { key: "collected", label: "المبالغ المستلمة", hint: "الحجوزات التي دُفع منها مبلغ" },
  { key: "completed", label: "الحجوزات المنجزة", hint: "المكتملة والمسلّمة" },
];

const REPORT_PENDING_STATUSES = ["new", "pending", "waiting"];
const REPORT_IN_PROGRESS_STATUSES = ["processing", "preparing", "active", "confirmed"];
const REPORT_COMPLETED_STATUSES = ["completed", "delivered", "finished", "returned"];

type BookingReportOptions = {
  type: BookingReportType;
  department: ServiceKey | "all";
  from: string;
  to: string;
  truncated?: boolean;
};

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Event-date window actually applied; "upcoming" defaults to today → +7 days. */
function bookingReportWindow(options: BookingReportOptions): { from: string; to: string } {
  if (options.type === "upcoming")
    return { from: options.from || isoDateOffset(0), to: options.to || isoDateOffset(7) };
  return { from: options.from, to: options.to };
}

function reportDepartmentLabels(booking: UnifiedBooking): string {
  return booking.services
    .map((service) => SERVICE_META.find((meta) => meta.key === service.type)?.short ?? service.type)
    .join("، ");
}

type ReportColumn = {
  label: string;
  cell: (booking: UnifiedBooking) => string;
  money?: keyof Pick<UnifiedBooking, "total" | "paid" | "remaining">;
  remaining?: boolean;
};

// Builds a self-contained printable booking report. Read-only: works on the
// rows it is given (fetched with ?scope=report so nothing is capped) and never
// hides a failure — an empty result is shown as "لا توجد حجوزات مطابقة".
function buildBookingReport(options: BookingReportOptions, all: UnifiedBooking[]): string {
  const today = isoDateOffset(0);
  const { from, to } = bookingReportWindow(options);
  const inDepartment = (booking: UnifiedBooking) =>
    options.department === "all" || booking.services.some((service) => service.type === options.department);
  const inWindow = (booking: UnifiedBooking) => {
    if (!from && !to) return true;
    const date = String(booking.eventDate ?? "");
    if (!date) return false;
    return (!from || date >= from) && (!to || date <= to);
  };
  const scoped = all.filter((booking) => inDepartment(booking) && inWindow(booking));
  const departmentLabel =
    options.department === "all"
      ? "كل الأقسام"
      : SERVICE_META.find((meta) => meta.key === options.department)?.label ?? "";
  const typeLabel = BOOKING_REPORT_TYPES.find((item) => item.key === options.type)?.label ?? "تقرير";
  const byDateAsc = (a: UnifiedBooking, b: UnifiedBooking) =>
    String(a.eventDate || "9999").localeCompare(String(b.eventDate || "9999"));
  const byDateDesc = (a: UnifiedBooking, b: UnifiedBooking) =>
    String(b.eventDate ?? "").localeCompare(String(a.eventDate ?? ""));
  const total = (rows: UnifiedBooking[], key: "total" | "paid" | "remaining") =>
    rows.reduce((sum, booking) => sum + (Number(booking[key]) || 0), 0);
  const notCancelled = (booking: UnifiedBooking) => booking.status !== "cancelled";
  const isLate = (booking: UnifiedBooking) => Boolean(booking.eventDate) && booking.eventDate < today;

  const col = {
    number: { label: "رقم الحجز", cell: (b: UnifiedBooking) => `<span dir="ltr">${escapeReportHtml(b.number)}</span>` },
    customer: { label: "العميل", cell: (b: UnifiedBooking) => escapeReportHtml(b.customerName) },
    phone: { label: "الهاتف", cell: (b: UnifiedBooking) => `<span dir="ltr">${escapeReportHtml(b.phone)}</span>` },
    department: { label: "القسم", cell: (b: UnifiedBooking) => escapeReportHtml(reportDepartmentLabels(b)) },
    date: {
      label: "تاريخ المناسبة",
      cell: (b: UnifiedBooking) =>
        `<span dir="ltr">${escapeReportHtml(b.eventDate || "—")}</span>${options.type === "pending_work" && isLate(b) ? ' <span class="late-tag">متأخر</span>' : ""}`,
    },
    time: { label: "الوقت", cell: (b: UnifiedBooking) => escapeReportHtml(b.eventTime || "—") },
    hall: { label: "القاعة", cell: (b: UnifiedBooking) => escapeReportHtml(b.hall || "—") },
    status: { label: "الحالة", cell: (b: UnifiedBooking) => escapeReportHtml(STATUS_LABELS[b.status] || b.status) },
    readiness: { label: "الجاهزية", cell: (b: UnifiedBooking) => `${getReadiness(b)}%` },
    total: { label: "الإجمالي", money: "total" as const, cell: (b: UnifiedBooking) => formatCurrency(b.total) },
    paid: { label: "المدفوع", money: "paid" as const, cell: (b: UnifiedBooking) => formatCurrency(b.paid) },
    remaining: { label: "المتبقّي", money: "remaining" as const, remaining: true, cell: (b: UnifiedBooking) => formatCurrency(b.remaining) },
  } satisfies Record<string, ReportColumn>;

  const table = (rows: UnifiedBooking[], columns: ReportColumn[], rowClass?: (b: UnifiedBooking) => string) => {
    const head = columns.map((column) => `<th>${column.label}</th>`).join("");
    const bodyRows = rows.length
      ? rows
          .map((booking) => `<tr class="${rowClass?.(booking) ?? ""}">${columns
            .map((column) => `<td class="${column.money ? "num" : ""}${column.remaining ? " rem" : ""}">${column.cell(booking)}</td>`)
            .join("")}</tr>`)
          .join("")
      : `<tr><td colspan="${columns.length}" class="empty">لا توجد حجوزات مطابقة</td></tr>`;
    const firstMoney = columns.findIndex((column) => column.money);
    const foot = firstMoney >= 0 && rows.length
      ? `<tfoot><tr><td colspan="${firstMoney}">الإجمالي (${rows.length})</td>${columns
          .slice(firstMoney)
          .map((column) => `<td class="${column.money ? "num" : ""}${column.remaining ? " rem" : ""}">${column.money ? formatCurrency(total(rows, column.money)) : ""}</td>`)
          .join("")}</tr></tfoot>`
      : "";
    return `<table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody>${foot}</table>`;
  };
  const chip = (label: string, value: string) => `<span>${label}: <b>${value}</b></span>`;

  let chips: string[] = [];
  let body = "";
  if (options.type === "summary") {
    const departments = options.department === "all" ? SERVICE_META : SERVICE_META.filter((meta) => meta.key === options.department);
    const grand = { total: 0, paid: 0, remaining: 0, count: 0 };
    body = departments
      .map((meta) => {
        const rows = scoped.filter((booking) => booking.services.some((service) => service.type === meta.key)).sort(byDateDesc);
        grand.total += total(rows, "total");
        grand.paid += total(rows, "paid");
        grand.remaining += total(rows, "remaining");
        grand.count += rows.length;
        const count = (statuses: string[]) => rows.filter((booking) => statuses.includes(booking.status)).length;
        return `<section class="dept"><h2>${escapeReportHtml(meta.label)}</h2><div class="chips">${[
          chip("الحجوزات", String(rows.length)),
          chip("معلّق", String(count(REPORT_PENDING_STATUSES))),
          chip("جاري", String(count(REPORT_IN_PROGRESS_STATUSES))),
          chip("مكتمل", String(count(REPORT_COMPLETED_STATUSES))),
        ].join("")}</div>${table(rows, [col.number, col.customer, col.phone, col.date, col.status, col.total, col.paid, col.remaining])}</section>`;
      })
      .join("");
    chips = [
      chip("الحجوزات", String(options.department === "all" ? scoped.length : grand.count)),
      chip("الإجمالي", formatCurrency(grand.total)),
      chip("المدفوع", formatCurrency(grand.paid)),
      chip("المتبقّي", formatCurrency(grand.remaining)),
    ];
    if (options.department === "all")
      body += `<p class="note">الحجز متعدد الخدمات يظهر ضمن كل قسم من أقسامه، لذا قد يتجاوز مجموع الأقسام عدد الحجوزات.</p>`;
  } else {
    let rows: UnifiedBooking[] = [];
    let columns: ReportColumn[] = [];
    let rowClass: ((booking: UnifiedBooking) => string) | undefined;
    if (options.type === "remaining") {
      rows = scoped.filter((booking) => notCancelled(booking) && booking.remaining > 0.005).sort(byDateAsc);
      columns = [col.number, col.customer, col.phone, col.department, col.date, col.total, col.paid, col.remaining];
      chips = [chip("الحجوزات", String(rows.length)), chip("مجموع المتبقّي", formatCurrency(total(rows, "remaining")))];
    } else if (options.type === "pending_work") {
      rows = scoped.filter((booking) => notCancelled(booking) && !REPORT_COMPLETED_STATUSES.includes(booking.status)).sort(byDateAsc);
      columns = [col.number, col.customer, col.phone, col.department, col.date, col.time, col.hall, col.status, col.readiness, col.remaining];
      rowClass = (booking) => (isLate(booking) ? "late" : "");
      chips = [
        chip("الحجوزات", String(rows.length)),
        chip("متأخرة", String(rows.filter(isLate).length)),
        chip("مجموع المتبقّي", formatCurrency(total(rows, "remaining"))),
      ];
    } else if (options.type === "upcoming") {
      rows = scoped.filter(notCancelled).sort(byDateAsc);
      columns = [col.date, col.time, col.number, col.customer, col.phone, col.hall, col.department, col.status, col.remaining];
      chips = [chip("المناسبات", String(rows.length)), chip("مجموع المتبقّي", formatCurrency(total(rows, "remaining")))];
    } else if (options.type === "collected") {
      rows = scoped.filter((booking) => booking.paid > 0.005).sort(byDateDesc);
      columns = [col.number, col.customer, col.department, col.date, col.total, col.paid, col.remaining];
      chips = [chip("الحجوزات", String(rows.length)), chip("مجموع المستلم", formatCurrency(total(rows, "paid")))];
    } else {
      rows = scoped.filter((booking) => REPORT_COMPLETED_STATUSES.includes(booking.status)).sort(byDateDesc);
      columns = [col.number, col.customer, col.department, col.date, col.total, col.paid, col.remaining];
      chips = [chip("الحجوزات", String(rows.length)), chip("الإجمالي", formatCurrency(total(rows, "total")))];
    }
    body = table(rows, columns, rowClass);
  }

  const period = from || to
    ? `تاريخ المناسبة: ${from ? `من ${escapeReportHtml(from)}` : ""} ${to ? `إلى ${escapeReportHtml(to)}` : ""}`
    : "كل الفترات";
  const title = `${typeLabel} — ${departmentLabel}`;
  const warning = options.truncated
    ? `<div class="warn">تنبيه: عدد الحجوزات تجاوز حد التقرير (20,000 لكل نوع)، لذلك قد لا تظهر أقدم الحجوزات.</div>`
    : "";

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="color-scheme" content="light">
    <title>${escapeReportHtml(title)}</title>
    <style>
      @page{size:A4;margin:12mm;}
      *{box-sizing:border-box;}
      body{font-family:'Segoe UI',Tahoma,sans-serif;color:#111;background:#fff;margin:0;padding:16px;}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px;}
      .head h1{margin:0;font-size:19px;}
      .head small{color:#555;}
      .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;font-size:12px;}
      .chips span{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:3px 8px;}
      .dept{margin-bottom:22px;}
      .dept h2{font-size:15px;margin:0 0 8px;padding:6px 10px;background:#f3f4f6;border-right:4px solid #111;}
      table{width:100%;border-collapse:collapse;font-size:11.5px;}
      th,td{border:1px solid #e5e7eb;padding:5px 6px;text-align:right;vertical-align:top;}
      thead th{background:#111;color:#fff;font-weight:600;}
      tfoot td{background:#f3f4f6;font-weight:700;}
      .num{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;}
      .rem{color:#b91c1c;}
      .empty{text-align:center;color:#777;padding:12px;}
      tr.late td{background:#fff5f5;}
      .late-tag{display:inline-block;margin-right:4px;padding:0 5px;border-radius:4px;background:#b91c1c;color:#fff;font-size:10px;}
      .warn{margin-bottom:10px;padding:6px 10px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:6px;font-size:12px;}
      .note{margin-top:8px;color:#666;font-size:11px;}
      tr{page-break-inside:avoid;}
      @media print{body{padding:0;}}
    </style></head>
    <body>
      <div class="head">
        <div><h1>${escapeReportHtml(title)}</h1><small>مركز حجوزات AJN · ${period}</small></div>
        <div style="text-align:left"><small>تاريخ التقرير</small><br><b>${escapeReportHtml(new Date().toLocaleString("ar-IQ"))}</b></div>
      </div>
      ${warning}
      <div class="chips">${chips.join("")}</div>
      ${body}
    </body></html>`;
}

// "التقارير" dialog: pick a report type, a department (or all) and an optional
// event-date window, then print. Always fetches the uncapped report dataset.
function BookingReportsDialog({ initialDepartment, onClose }: { initialDepartment: ServiceKey | "all"; onClose: () => void }) {
  const [type, setType] = useState<BookingReportType>("summary");
  const [department, setDepartment] = useState<ServiceKey | "all">(initialDepartment);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const window7 = type === "upcoming" && !from && !to;

  async function print() {
    setBusy(true);
    setError("");
    try {
      const data = await adminFetch<{ rows: any[]; truncated: boolean }>("/admin/booking-center?scope=report");
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(toUnifiedBooking);
      printStandaloneDocument(buildBookingReport({ type, department, from, to, truncated: Boolean(data?.truncated) }, rows));
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>التقارير</DialogTitle>
          <DialogDescription>اختر نوع التقرير والقسم والفترة، ثم اطبعه أو احفظه PDF.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">نوع التقرير</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BOOKING_REPORT_TYPES.map((item) => (
                <Button
                  key={item.key}
                  type="button"
                  onClick={() => setType(item.key)}
                  aria-pressed={type === item.key}
                  variant={type === item.key ? "selected" : "outline"}
                  className="h-auto w-full flex-col items-stretch whitespace-normal rounded-lg p-2.5 text-right"
                >
                  <span className={`block text-sm ${type === item.key ? "font-semibold text-primary" : "font-medium"}`}>{item.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{item.hint}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-department">القسم</Label>
            <select
              id="report-department"
              value={department}
              onChange={(event) => setDepartment(event.target.value as ServiceKey | "all")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">كل الأقسام</option>
              {SERVICE_META.map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label htmlFor="report-from">تاريخ المناسبة من</Label><Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="report-to">إلى</Label><Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">
            {window7 ? "بدون تاريخ: المناسبات القادمة خلال 7 أيام من اليوم." : from || to ? "يُطبَّق على تاريخ المناسبة." : "بدون تاريخ: كل الفترات."}
          </p>
          {error ? <p role="alert" className="text-sm text-destructive">تعذر إنشاء التقرير: {error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>إغلاق</Button>
          <Button type="button" onClick={() => void print()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            طباعة / حفظ PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Maps a /admin/booking-center row to the unified shape used on screen and in
// printed reports (one source of truth for departments/status/amounts).
function toUnifiedBooking(row: any): UnifiedBooking {
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
  } as UnifiedBooking;
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
  const [reportFor, setReportFor] = useState<ServiceKey | "all" | null>(null);
  const centralBookingsQuery = useQuery({ queryKey: ["admin", "booking-center"], queryFn: () => adminFetch<any[]>("/admin/booking-center") });
  // §15 — unresolved damage/penalty flags per booking for the list indicator.
  const penaltyIndicators = useQuery<{ indicators: Record<string, { remaining: number; pendingReview: number; count: number }> }>({
    queryKey: ["admin", "penalty-indicators"],
    queryFn: () => adminFetch("/admin/penalties/indicators"),
    staleTime: 30_000,
  });
  const servicesQuery = useQuery({ queryKey: ["admin", "services", "booking-center"], queryFn: () => adminFetch<AdminService[]>("/admin/services") });
  const customersQuery = useQuery({ queryKey: ["admin", "customers", "booking-center"], queryFn: () => adminFetch<Customer[]>("/admin/customers") });
  const bookings = useMemo(() => (centralBookingsQuery.data ?? []).map(toUnifiedBooking), [centralBookingsQuery.data]);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (serviceFilter !== "all" && !booking.services.some((service) => service.type === serviceFilter)) return false;
      if (!q) return true;
      return [booking.number, booking.trackingCode, booking.customerName, booking.phone, booking.hall, booking.eventDate].join(" ").toLowerCase().includes(q);
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
  const bookingDeleteMutation = useMutation({
    mutationFn: (booking: UnifiedBooking) =>
      adminFetch<{ message: string }>(
        booking.source === "kosha"
          ? `/admin/kosha-bookings/${booking.id}`
          : `/admin/service-orders/${booking.id}`,
        { method: "DELETE" },
      ),
    onSuccess: (result) => {
      refresh();
      toast({ title: result.message || "تم إرسال طلب إلغاء الحجز" });
    },
    onError: (error) =>
      toast({
        title: "تعذر مسح الحجز",
        description: apiErrorMessage(error, "تعذر إلغاء الحجز. حاول مرة أخرى."),
        variant: "destructive",
      }),
  });
  const requestBookingDeletion = (booking: UnifiedBooking) => {
    const confirmed = window.confirm(
      `مسح الحجز ${booking.number || booking.customerName}؟ سيتم إلغاؤه وأرشفته مع الحفاظ على بياناته المالية والتاريخية.`,
    );
    if (confirmed) bookingDeleteMutation.mutate(booking);
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
      {reportFor !== null ? <BookingReportsDialog key={reportFor} initialDepartment={reportFor} onClose={() => setReportFor(null)} /> : null}
      <header className="ajn-booking-hero">
        <div>
          <div className="ajn-kicker"><Sparkles className="h-4 w-4" /> مركز العمليات والمناسبات</div>
          <h1>مركز الحجوزات</h1>
          <p>حجز واحد، عميل واحد، وكل فرق AJN تعمل من مساحة موحّدة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href="/admin/calendar"><CalendarDays className="h-4 w-4" /> التقويم</Link></Button>
          <Button
            variant="outline"
            onClick={() => setReportFor("all")}
            title="تقارير: شامل، المبالغ المتبقية، الأعمال المتبقية، المناسبات القادمة…"
          >
            <Printer className="h-4 w-4" /> التقارير
          </Button>
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
          servicesLoading={servicesQuery.isLoading || servicesQuery.isFetching}
          servicesError={servicesQuery.isError ? apiErrorMessage(servicesQuery.error, "تعذر تحميل قائمة الخدمات") : ""}
          onRetryServices={() => void servicesQuery.refetch()}
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
              {/* Purpose-built service summary card; its rail layout is styled by booking-center.css. */}
              <Button variant="ghost" type="button" onClick={() => setServiceFilter(active ? "all" : card.key)} aria-pressed={active}>
                <span className="ajn-service-icon"><Icon /></span>
                <span><strong>{card.label}</strong><small>{card.total} حجز · اليوم {card.today}</small></span>
              </Button>
              <div className="ajn-service-stats"><span>معلق <b>{card.pending}</b></span><span>جاري <b>{card.inProgress}</b></span><span>مكتمل <b>{card.completed}</b></span></div>
              <div className="ajn-service-revenue"><small>إيراد الشهر</small><Money value={card.revenue} /></div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => showServiceBookings(card.key)}>فتح <ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => setReportFor(card.key)} title={`تقارير قسم ${card.label}`}><Printer className="h-4 w-4" /> تقرير</Button>
              </div>
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
            {filtered.map((booking) => <BookingPreview key={`${booking.source}-${booking.id}`} booking={booking} penalty={penaltyIndicators.data?.indicators?.[`${booking.source === "kosha" ? "kosha_booking" : "service_order"}:${booking.id}`]} onDelete={requestBookingDeletion} deleting={bookingDeleteMutation.isPending && bookingDeleteMutation.variables?.id === booking.id} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function groupAttendeeCount(booking: UnifiedBooking): number {
  const raw = booking.raw as any;
  const ops = booking.source === "kosha" ? raw?.bookingDetails?.bookingOperations : raw?.customFields?.bookingOperations;
  return Array.isArray(ops?.groupAttendees) ? ops.groupAttendees.length : 0;
}

function BookingPreview({ booking, penalty, onDelete, deleting = false }: { booking: UnifiedBooking; penalty?: { remaining: number; pendingReview: number; count: number }; onDelete: (booking: UnifiedBooking) => void; deleting?: boolean }) {
  const readiness = getReadiness(booking);
  const transport = transportationSummary(booking);
  const attendees = groupAttendeeCount(booking);
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
      {penalty ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, borderRadius: 999, border: "1px solid #f59e0b", background: "rgba(245,158,11,.12)", color: "#b45309", padding: "2px 10px", fontSize: 12, fontWeight: 700 }} title="توجد غرامة/تلفيات غير محلولة على هذا الحجز">
          <AlertTriangle style={{ width: 13, height: 13 }} />
          {penalty.remaining > 0 ? `غرامة · ${formatCurrency(penalty.remaining)}` : "مشكلة تلف بانتظار المراجعة"}
        </div>
      ) : null}
      <div className="ajn-preview-services">{booking.services.slice(0, 5).map((service) => { const meta = SERVICE_META.find((item) => item.key === service.type)!; const Icon = meta.icon; return <span key={service.type} title={meta.label}><Icon /><small>{meta.short}</small></span>; })}</div>
      <div className="ajn-preview-progress"><span><i style={{ width: `${readiness}%` }} /></span><small>الجاهزية {readiness}%</small></div>
      <div className="ajn-preview-finance"><div><small>الإجمالي</small><Money value={booking.total} /></div><div><small>المتبقي</small><Money value={booking.remaining} className={booking.remaining > 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600"} /></div></div>
      {transport ? <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Car className="h-3.5 w-3.5 text-amber-600" /><span>{transport}</span></div> : null}
      {attendees > 0 ? <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Camera className="h-3.5 w-3.5 text-primary" /><span>{attendees.toLocaleString("ar-IQ-u-nu-latn")} مشارك · لقطات جماعية</span></div> : null}
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
          <BookingThermalReceiptAction
            data={{
              bookingNumber: booking.number,
              contractNumber: booking.contractNumber || null,
              customerName: booking.customerName,
              phone: booking.phone,
              service: booking.services
                .map((service) => SERVICE_META.find((meta) => meta.key === service.type)?.label ?? service.type)
                .filter(Boolean)
                .join(" · "),
              eventDate: booking.eventDate,
              eventTime: booking.eventTime,
              location: booking.hall,
              total: booking.total,
              paid: booking.paid,
              remaining: booking.remaining,
              paymentStatus: booking.paymentStatus,
              notes: booking.notes ?? null,
            }}
          />
          <Button size="sm" variant="ghost" asChild>
            <Link href={booking.detailHref || `/admin/bookings/${booking.source}/${booking.id}`} aria-label={`فتح مساحة عمل الحجز ${booking.number || booking.customerName}`}>فتح مساحة العمل <ChevronLeft className="h-4 w-4" /></Link>
          </Button>
          {(booking.source === "service" || booking.source === "kosha") ? <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(booking)} disabled={deleting} aria-label={`مسح الحجز ${booking.number || booking.customerName}`}><Trash2 className="h-3.5 w-3.5" />{deleting ? "جارٍ الإلغاء…" : "مسح"}</Button> : null}
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
                <Button variant="ghost"
                  key={customer.id}
                  type="button"
                  onMouseDown={(event) => { event.preventDefault(); onChange(customer); setOpen(false); setQuery(""); }}
                  className="flex w-full items-center justify-between gap-3 border-b border-border/20 px-3 py-2.5 text-right transition-colors last:border-b-0 hover:bg-primary/10"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{customer.fullName || customer.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{formatIraqiPhone(customer.phone)}</span>
                </Button>
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

function UnifiedBookingForm({ services, servicesLoading, servicesError, onRetryServices, customers, onCancel, onCreated }: { services: AdminService[]; servicesLoading: boolean; servicesError: string; onRetryServices: () => void; customers: Customer[]; onCancel: () => void; onCreated: () => void }) {
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
  // A photo session and a video shoot are independent choices; a booking may take one or both.
  const [photoSessionOn, setPhotoSessionOn] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [videoItems, setVideoItems] = useState<StoreBookingItem[]>([]);
  const [giftItems, setGiftItems] = useState<StoreBookingItem[]>([]);
  const [photographyLocation, setPhotographyLocation] = useState<"indoor" | "outdoor">("indoor");
  const [photographyDelivery, setPhotographyDelivery] = useState<"album" | "shots">("shots");
  const [photographyShotsCount, setPhotographyShotsCount] = useState("");
  const [photographyReelsRequested, setPhotographyReelsRequested] = useState(false);
  const [photographyServiceItems, setPhotographyServiceItems] = useState<PhotographyServiceLine[]>([]);
  const [soundItems, setSoundItems] = useState<SoundBookingItem[]>([]);
  const [transportationMode, setTransportationMode] = useState<"ajn" | "customer" | null>(null);
  const [transportationFee, setTransportationFee] = useState("");
  const [koshaMode, setKoshaMode] = useState<"packages" | "custom" | null>(null);
  const [koshaPick, setKoshaPick] = useState<KoshaPick | null>(null);
  const [koshaSearch, setKoshaSearch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [flowerItems, setFlowerItems] = useState<FlowerBookingItem[]>([]);
  const flowersSelected = selected.includes("flowers");
  const flowerCatalogQuery = useQuery({
    queryKey: ["booking-center", "flower-catalog"],
    queryFn: fetchFlowerCatalog,
    enabled: flowersSelected,
    staleTime: 60_000,
  });
  const koshaSelected = selected.includes("kosha");
  const koshaCatalogQuery = useQuery<KoshaCatalog>({
    queryKey: ["admin", "booking-center", "kosha-catalog"],
    queryFn: () => adminFetch("/admin/booking-center/kosha-catalog"),
    enabled: koshaSelected,
    staleTime: 60_000,
  });
  const pickKosha = (pick: KoshaPick) => {
    setKoshaPick(pick);
    // Pre-fill the booking total from the chosen package/kosha only when it is
    // still empty — never overwrite an amount the employee already entered.
    if (pick.price > 0 && num(totalAmount) <= 0) setTotalAmount(String(pick.price));
  };
  const soundSelected = selected.includes("sound");
  const soundProductsQuery = useQuery<any[]>({
    queryKey: ["admin", "products-all", "booking-sound-picker"],
    queryFn: () => adminFetch("/admin/products?limit=2000"),
    enabled: soundSelected,
    staleTime: 30_000,
  });
  const giftsSelected = selected.includes("gifts");
  // Same store catalogue for priced photography services, video products and giveaways.
  const photographyProductsQuery = useQuery<any[]>({
    queryKey: ["admin", "products-all", "booking-photography-services"],
    queryFn: () => adminFetch("/admin/products?limit=2000"),
    enabled: selected.includes("photography") || giftsSelected,
    staleTime: 30_000,
  });
  const categoriesQuery = useQuery<any[]>({
    queryKey: ["admin", "categories", "booking-sound-picker"],
    queryFn: () => adminFetch("/admin/categories"),
    enabled: soundSelected || (selected.includes("photography") && videoOn) || giftsSelected,
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
      photography: "booking-photo-kind-session",
      videoItems: "booking-video-items-search",
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
      if (servicesLoading) failField("serviceId", "قائمة الخدمات ما زالت قيد التحميل. انتظر قليلاً ثم أعد المحاولة.");
      if (servicesError) failField("serviceId", `تعذر تحميل قائمة الخدمات: ${servicesError}`);
      if (!services.length) failField("serviceId", "لا توجد خدمة فعالة في النظام. افتح إدارة الخدمات وأضف أو فعّل خدمة قبل حفظ الحجز.");
      const primary = resolveUnifiedBookingService(selected, services);
      if (!primary) failField("serviceId", "لم يتم العثور على خدمة صالحة لهذا الحجز. تحقق من تفعيل خدمة في إدارة الخدمات.");
      const photographyChosen = selected.includes("photography");
      if (photographyChosen && !photoSessionOn && !videoOn) failField("photography", "اختر جلسة تصوير أو تصوير فيديو (أو كليهما)");
      if (photographyChosen && videoOn && !videoItems.length) failField("videoItems", "اختر منتج تصوير الفيديو من المتجر");
      // النقل بواسطة AJN يبقى ضمن إجمالي الحجز: يُضاف إلى المبلغ الكلي المرسل.
      const transportFee = selected.includes("transportation") && transportationMode === "ajn" ? num(transportationFee) : 0;
      // Chosen flower products are part of the booking total, like AJN transport.
      const flowersTotal = selected.includes("flowers") ? flowerItemsTotal(flowerItems) : 0;
      const videoTotal = photographyChosen && videoOn ? storeItemsTotal(videoItems) : 0;
      const giftsTotal = selected.includes("gifts") ? storeItemsTotal(giftItems) : 0;
      const baseTotal = num(totalAmount) + transportFee + flowersTotal + videoTotal + giftsTotal;
      const photographyKinds = [...(photoSessionOn ? ["photo_session"] : []), ...(videoOn ? ["video"] : [])];
      const photographyNotes = [
        photoSessionOn ? `جلسة تصوير (${photographyLocation === "outdoor" ? "خارجية" : "داخلية"} · ${photographyDelivery === "album" ? "ألبوم" : "لقطات"}${photographyShotsCount ? ` · ${num(photographyShotsCount)} لقطة` : ""})` : "",
        videoOn && videoItems.length ? `تصوير فيديو: ${storeItemsSummary(videoItems)}` : "",
        photographyReelsRequested ? "مع ريلز" : "",
      ].filter(Boolean).join(" | ");
      const serviceLinesTotal = photographyServiceItems.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
      const grandTotal = baseTotal + serviceLinesTotal;
      return adminFetch("/admin/service-orders", {
        method: "POST",
        body: JSON.stringify({
          serviceId: primary.id,
          customerName: selectedCustomer.fullName || selectedCustomer.name,
          phone: selectedCustomer.phone,
          eventDate,
          eventLocation: hallName,
          totalAmount: grandTotal,
          baseTotalAmount: baseTotal,
          serviceItems: photographyServiceItems.map(({ productId, quantity, discount }) => ({ productId, quantity, discount })),
          depositAmount: Math.min(num(depositAmount), grandTotal),
          paymentStatus:
            num(depositAmount) <= 0
              ? "unpaid"
              : num(depositAmount) >= grandTotal && grandTotal > 0
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
            bookingCenterServices: selected.map((type) =>
              type === "transportation"
                ? {
                    type,
                    status: "waiting",
                    amount: transportationMode === "ajn" ? num(transportationFee) : 0,
                    ...(transportationMode === "customer" ? { notes: "النقل من مسؤولية الزبون" } : {}),
                  }
                : type === "kosha" && koshaPick
                  ? { type, status: "waiting", amount: 0, notes: koshaPickLabel(koshaPick) }
                  : type === "flowers" && flowerItems.length
                    ? { type, status: "waiting", amount: flowersTotal, notes: flowerItemsSummary(flowerItems) }
                    : type === "photography"
                      ? { type, status: "waiting", amount: videoTotal, notes: photographyNotes }
                      : type === "gifts" && giftItems.length
                        ? { type, status: "waiting", amount: giftsTotal, notes: storeItemsSummary(giftItems) }
                        : { type, status: "waiting", amount: 0 },
            ),
            ...(selected.includes("flowers") && flowerItems.length
              ? { flowerItems: flowerItems.map(({ key: _key, ...item }) => item) }
              : {}),
            ...(selected.includes("gifts") && giftItems.length
              ? { giftItems: giftItems.map(({ key: _key, ...item }) => item) }
              : {}),
            ...(koshaSelected && koshaPick ? { koshaSelection: koshaPick } : {}),
            ...(selected.includes("transportation") && transportationMode
              ? {
                  transportationMode,
                  transportationFee: transportationMode === "ajn" ? num(transportationFee) : 0,
                }
              : {}),
            ...(selected.includes("sound") && soundItems.length ? { soundItems } : {}),
            ...(photographyChosen
              ? {
                  // Legacy single-kind key kept for existing readers; "both" when the
                  // booking takes a photo session and a video shoot.
                  photographyServiceKind: photoSessionOn && videoOn ? "both" : videoOn ? "video" : "photo_session",
                  photographyKinds,
                  photographyReelsRequested,
                  ...(photoSessionOn
                    ? {
                        photoSessionLocation: photographyLocation,
                        photoSessionDelivery: photographyDelivery,
                        photoShotCount: photographyShotsCount ? num(photographyShotsCount) : null,
                      }
                    : {}),
                  ...(videoOn && videoItems.length ? { videoItems: videoItems.map(({ key: _key, ...item }) => item) } : {}),
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
  // النقل بواسطة AJN جزء من إجمالي الحجز: تُضاف أجرته تلقائياً إلى المبلغ الكلي.
  const transportFeeValue = selected.includes("transportation") && transportationMode === "ajn" ? num(transportationFee) : 0;
  const flowersTotalValue = flowersSelected ? flowerItemsTotal(flowerItems) : 0;
  const videoTotalValue = selected.includes("photography") && videoOn ? storeItemsTotal(videoItems) : 0;
  const giftsTotalValue = giftsSelected ? storeItemsTotal(giftItems) : 0;
  const baseTotalValue = num(totalAmount);
  const photographyServicesTotalValue = photographyServiceItems.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
  const baseBookingTotalValue = baseTotalValue + transportFeeValue + flowersTotalValue + videoTotalValue + giftsTotalValue;
  const totalValue = baseBookingTotalValue + photographyServicesTotalValue;
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
    if (type === "transportation") { setTransportationMode(null); setTransportationFee(""); }
    if (type === "kosha") { setKoshaMode(null); setKoshaPick(null); setKoshaSearch(""); }
    if (type === "flowers") setFlowerItems([]);
    if (type === "photography") { setPhotographyServiceItems([]); setVideoItems([]); }
    if (type === "gifts") setGiftItems([]);
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
        : type === "transportation"
          ? "booking-transportation-settings"
          : type === "kosha"
            ? "booking-kosha-settings"
            : type === "flowers"
              ? "booking-flowers-settings"
              : type === "gifts"
                ? "booking-gifts-items"
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
            <div className="space-y-2"><Label htmlFor="booking-total">المبلغ الأساسي قبل الخدمات الإضافية</Label><Input id="booking-total" inputMode="decimal" aria-invalid={Boolean(fieldErrors.totalAmount)} className={fieldErrors.totalAmount ? "border-destructive" : ""} value={totalAmount} onChange={(event) => { setTotalAmount(event.target.value.replace(/[^0-9.]/g, "")); setFieldErrors((current) => ({ ...current, totalAmount: "" })); }} placeholder="0 د.ع" />{fieldErrors.totalAmount ? <p className="text-xs text-destructive">{fieldErrors.totalAmount}</p> : null}{transportFeeValue > 0 || flowersTotalValue > 0 || videoTotalValue > 0 || giftsTotalValue > 0 || photographyServicesTotalValue > 0 ? <p className="text-xs text-muted-foreground">{transportFeeValue > 0 ? `+ أجرة النقل ${formatCurrency(transportFeeValue)} ` : ""}{flowersTotalValue > 0 ? `+ الورد ${formatCurrency(flowersTotalValue)} ` : ""}{videoTotalValue > 0 ? `+ الفيديو ${formatCurrency(videoTotalValue)} ` : ""}{giftsTotalValue > 0 ? `+ التوزيعات ${formatCurrency(giftsTotalValue)} ` : ""}{photographyServicesTotalValue > 0 ? `+ خدمات التصوير ${formatCurrency(photographyServicesTotalValue)} ` : ""}= الإجمالي <b className="text-foreground">{formatCurrency(totalValue)}</b></p> : null}</div>
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
          {servicesLoading ? <p className="mb-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground" role="status">جارٍ تحميل قائمة الخدمات اللازمة لإنشاء الحجز…</p> : null}
          {servicesError ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><span>تعذر تحميل قائمة الخدمات: {servicesError}</span><Button type="button" variant="outline" size="sm" onClick={onRetryServices}>إعادة المحاولة</Button></div> : null}
          {!servicesLoading && !servicesError && services.length === 0 ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900"><span>لا توجد خدمة مفعّلة حالياً؛ يجب تفعيل خدمة قبل حفظ الحجز.</span><Button type="button" variant="outline" size="sm" asChild><Link href="/admin/services">إدارة الخدمات</Link></Button></div> : null}
          <div><span>الخدمات المطلوبة</span><strong>{selected.length} خدمات محددة</strong></div>
          <div className="grid grid-cols-2 gap-2">{SERVICE_META.map((meta) => { const Icon = meta.icon; const checked = selected.includes(meta.key); return <Button variant="ghost" type="button" key={meta.key} className={checked ? "is-selected" : ""} onClick={() => toggle(meta.key)} aria-pressed={checked}><Icon /><span>{meta.short}</span>{checked && <CheckCircle2 />}</Button>; })}</div>
          {fieldErrors.serviceId ? <p className="text-xs text-destructive">{fieldErrors.serviceId}</p> : null}
          {selected.length ? <section className="mt-4 space-y-2 rounded-xl border border-border/60 bg-background/70 p-3" aria-label="الخدمات المختارة">
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-foreground">الخدمات المختارة</h3><span className="text-xs text-muted-foreground">يمكنك تعديل الإعدادات أو إزالة الخدمة من هذا الحجز</span></div>
            <div className="space-y-1.5">{selected.map((type) => {
              const meta = SERVICE_META.find((item) => item.key === type);
              if (!meta) return null;
              const Icon = meta.icon;
              const hasSettings = type === "photography" || type === "sound" || type === "transportation" || type === "kosha" || type === "flowers" || type === "gifts";
              return <div key={type} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border/45 bg-muted/20 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{meta.short}</span></span>
                <span className="flex shrink-0 items-center gap-1">
                  {hasSettings ? <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => editService(type)}><Pencil className="h-3.5 w-3.5" />تعديل</Button> : null}
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" disabled={selected.length <= 1} title={selected.length <= 1 ? "يلزم اختيار خدمة واحدة على الأقل" : `إزالة ${meta.short} من الحجز`} onClick={() => removeService(type)}><X className="h-3.5 w-3.5" />إزالة</Button>
                </span>
              </div>;
            })}</div>
          </section> : null}
          {koshaSelected ? <KoshaCatalogSection
            mode={koshaMode}
            onMode={(mode) => setKoshaMode((current) => (current === mode ? null : mode))}
            catalog={koshaCatalogQuery.data}
            loading={koshaCatalogQuery.isLoading}
            error={koshaCatalogQuery.isError ? apiErrorMessage(koshaCatalogQuery.error) : ""}
            onRetry={() => void koshaCatalogQuery.refetch()}
            search={koshaSearch}
            onSearch={setKoshaSearch}
            pick={koshaPick}
            onPick={pickKosha}
            onClear={() => setKoshaPick(null)}
            totalAmount={num(totalAmount)}
            onUsePrice={(price) => setTotalAmount(String(price))}
          /> : null}
          {flowersSelected ? <FlowerCatalogSection
            catalog={flowerCatalogQuery.data}
            loading={flowerCatalogQuery.isLoading}
            error={flowerCatalogQuery.isError ? apiErrorMessage(flowerCatalogQuery.error) : ""}
            onRetry={() => void flowerCatalogQuery.refetch()}
            items={flowerItems}
            onChange={setFlowerItems}
          /> : null}
          {photographySelected ? <section id="booking-photography-settings" className="mt-4 space-y-3 rounded-xl border border-rose-200/70 bg-rose-50/45 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
            <div><h3 className="font-semibold text-foreground">تفاصيل التصوير</h3><p className="mt-1 text-xs text-muted-foreground">تُحفظ هذه التفاصيل مع الحجز لتظهر لفريق التصوير.</p></div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="نوع التصوير — يمكن اختيار الاثنين">
              {([
                { key: "session", label: "جلسة تصوير", hint: "داخلية أو خارجية · ألبوم أو لقطات", Icon: Camera, on: photoSessionOn, set: setPhotoSessionOn },
                { key: "video", label: "تصوير فيديو", hint: "تختار منتج الفيديو من المتجر", Icon: Video, on: videoOn, set: setVideoOn },
              ]).map(({ key, label, hint, Icon, on, set }) => <Button key={key} id={`booking-photo-kind-${key}`} type="button" variant="ghost" aria-pressed={on} onClick={() => { set(!on); setFieldErrors((current) => ({ ...current, photography: "", videoItems: "" })); }} className={`h-auto flex-col items-stretch gap-1 whitespace-normal rounded-xl border p-3 text-right ${on ? "border-primary bg-primary/10 text-primary" : "border-border/50 bg-background text-foreground hover:border-primary/40"}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-semibold"><span className="flex items-center gap-1.5"><Icon className="h-4 w-4" />{label}</span>{on ? <CheckCircle2 className="h-4 w-4" /> : null}</span>
                <span className="text-[11px] font-normal leading-4 text-muted-foreground">{hint}</span>
              </Button>)}
            </div>
            {fieldErrors.photography ? <p className="text-xs text-destructive">{fieldErrors.photography}</p> : null}
            {photoSessionOn ? <div className="space-y-2 rounded-lg border border-border/45 bg-background/80 p-3">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Camera className="h-4 w-4 text-primary" />جلسة التصوير</h4>
              <div className="grid grid-cols-2 gap-2"><div className="space-y-1.5"><Label htmlFor="booking-photography-location">المكان</Label><select id="booking-photography-location" value={photographyLocation} onChange={(event) => setPhotographyLocation(event.target.value as "indoor" | "outdoor")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="indoor">داخلي</option><option value="outdoor">خارجي</option></select></div><div className="space-y-1.5"><Label htmlFor="booking-photography-delivery">الطلب</Label><select id="booking-photography-delivery" value={photographyDelivery} onChange={(event) => setPhotographyDelivery(event.target.value as "album" | "shots")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="album">ألبوم</option><option value="shots">لقطات</option></select></div></div>
              <div className="space-y-1.5"><Label htmlFor="booking-photography-shots">عدد اللقطات</Label><Input id="booking-photography-shots" inputMode="numeric" min="1" type="number" value={photographyShotsCount} onChange={(event) => setPhotographyShotsCount(event.target.value.replace(/[^0-9]/g, ""))} placeholder="مثال: 30" /></div>
            </div> : null}
            {videoOn ? <StoreProductPicker
              sectionId="booking-video-items"
              className="space-y-2 rounded-lg border border-border/45 bg-background/80 p-3"
              title="تصوير الفيديو"
              description="اختر منتج الفيديو من المتجر؛ يُضاف سعره تلقائياً إلى المبلغ الكلي."
              icon={Video}
              categoryLabel="قسم التصوير"
              hints={VIDEO_STORE_HINTS}
              products={photographyProductsQuery.data ?? []}
              categories={categoriesQuery.data ?? []}
              loading={photographyProductsQuery.isLoading || categoriesQuery.isLoading}
              error={photographyProductsQuery.isError ? apiErrorMessage(photographyProductsQuery.error, "تعذر تحميل منتجات المتجر") : categoriesQuery.isError ? apiErrorMessage(categoriesQuery.error, "تعذر تحميل أقسام المتجر") : ""}
              onRetry={() => { void photographyProductsQuery.refetch(); void categoriesQuery.refetch(); }}
              items={videoItems}
              onChange={(items) => { setVideoItems(items); setFieldErrors((current) => ({ ...current, videoItems: "" })); }}
              requiredError={fieldErrors.videoItems}
            /> : null}
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/45 bg-background/80 px-3 py-2 text-sm"><span>هل تريد ريلز معها؟</span><input type="checkbox" checked={photographyReelsRequested} onChange={(event) => setPhotographyReelsRequested(event.target.checked)} className="h-4 w-4 accent-rose-600" /><span className="sr-only">طلب ريلز</span></label>
            <PhotographyServiceItemsSelector
              products={photographyProductsQuery.data ?? []}
              loading={photographyProductsQuery.isLoading}
              error={photographyProductsQuery.isError ? apiErrorMessage(photographyProductsQuery.error, "تعذر تحميل خدمات التصوير") : ""}
              items={photographyServiceItems}
              onChange={setPhotographyServiceItems}
            />
          </section> : null}
          {giftsSelected ? <StoreProductPicker
            sectionId="booking-gifts-items"
            className="mt-4 space-y-3 rounded-xl border border-violet-200/70 bg-violet-50/45 p-3 dark:border-violet-900/60 dark:bg-violet-950/20"
            title="الهدايا والتوزيعات"
            description="اختر التوزيعات من منتجات المتجر؛ يُضاف مجموعها تلقائياً إلى المبلغ الكلي."
            icon={Gift}
            categoryLabel="قسم الهدايا"
            hints={GIFT_STORE_HINTS}
            products={photographyProductsQuery.data ?? []}
            categories={categoriesQuery.data ?? []}
            loading={photographyProductsQuery.isLoading || categoriesQuery.isLoading}
            error={photographyProductsQuery.isError ? apiErrorMessage(photographyProductsQuery.error, "تعذر تحميل منتجات المتجر") : categoriesQuery.isError ? apiErrorMessage(categoriesQuery.error, "تعذر تحميل أقسام المتجر") : ""}
            onRetry={() => { void photographyProductsQuery.refetch(); void categoriesQuery.refetch(); }}
            items={giftItems}
            onChange={setGiftItems}
          /> : null}
          {soundSelected ? <SoundItemsSelector products={soundProductsQuery.data ?? []} categories={categoriesQuery.data ?? []} loading={soundProductsQuery.isLoading || categoriesQuery.isLoading} items={soundItems} onChange={setSoundItems} /> : null}
          {selected.includes("transportation") ? <section id="booking-transportation-settings" className="mt-4 space-y-3 rounded-xl border border-amber-200/70 bg-amber-50/45 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
            <div className="flex items-start gap-2"><span className="mt-0.5 text-amber-700"><Car className="h-5 w-5" /></span><div><h3 className="font-semibold text-foreground">خدمة النقل</h3><p className="mt-0.5 text-xs text-muted-foreground">تبقى أجرة النقل جزءاً من الحجز وتُنسب تحليلياً للسيارة بعد تنفيذ دفعة الزبون.</p></div></div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" type="button" onClick={() => setTransportationMode("ajn")} className={`rounded-lg border px-3 py-3 text-center text-sm transition-colors ${transportationMode === "ajn" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border/40 bg-background hover:border-primary/40"}`}>النقل بواسطة AJN</Button>
              <Button variant="ghost" type="button" onClick={() => { setTransportationMode("customer"); setTransportationFee(""); }} className={`rounded-lg border px-3 py-3 text-center text-sm transition-colors ${transportationMode === "customer" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border/40 bg-background hover:border-primary/40"}`}>النقل من مسؤولية الزبون</Button>
            </div>
            {transportationMode === "ajn" ? <div className="space-y-1.5"><Label htmlFor="booking-transport-fee">أجرة النقل</Label><Input id="booking-transport-fee" inputMode="decimal" value={transportationFee} onChange={(event) => setTransportationFee(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 د.ع" /><p className="text-xs text-muted-foreground">تُضاف أجرة النقل تلقائياً إلى المبلغ الكلي للحجز. يمكن تحديد السيارة والسائق لاحقاً من مساحة تنفيذ الحجز.</p></div> : null}
          </section> : null}
          <div className="mt-auto flex gap-2 pt-4"><Button variant="outline" onClick={onCancel} className="flex-1">إلغاء</Button><Button onClick={() => mutation.mutate()} disabled={mutation.isPending || imageUploading || depositTooHigh || servicesLoading || !!servicesError || services.length === 0} className="ajn-rose-button flex-1">{imageUploading ? "جارٍ رفع الصور..." : mutation.isPending ? "جارٍ الحفظ..." : servicesLoading ? "جارٍ تحميل الخدمات..." : "حفظ الحجز"}</Button></div>
        </div>
      </div>
    </section>
  );
}

// Kosha section of the unified booking form: two compact cards mirroring the
// public /koshas choice — "الباقات الجاهزة" (ready packages) and "اختياري"
// (pick any kosha) — sized to match the other service settings panels.
function KoshaCatalogSection({ mode, onMode, catalog, loading, error, onRetry, search, onSearch, pick, onPick, onClear, totalAmount, onUsePrice }: {
  mode: "packages" | "custom" | null;
  onMode: (mode: "packages" | "custom") => void;
  catalog: KoshaCatalog | undefined;
  loading: boolean;
  error: string;
  onRetry: () => void;
  search: string;
  onSearch: (value: string) => void;
  pick: KoshaPick | null;
  onPick: (pick: KoshaPick) => void;
  onClear: () => void;
  totalAmount: number;
  onUsePrice: (price: number) => void;
}) {
  const packages = catalog?.packages ?? [];
  const koshas = catalog?.koshas ?? [];
  const needle = search.trim().toLowerCase();
  const visibleKoshas = needle ? koshas.filter((kosha) => kosha.name.toLowerCase().includes(needle)) : koshas;
  const cards = [
    { key: "packages" as const, label: "الباقات الجاهزة", hint: loading ? "…" : `${packages.length} باقة`, Icon: Layers3 },
    { key: "custom" as const, label: "اختياري", hint: loading ? "…" : `${koshas.length} كوشة`, Icon: SlidersHorizontal },
  ];
  // Image cards in a 3-column grid; the list shows three rows (3×3) and
  // scrolls for more.
  const card = (item: { id: number; name: string; price: number; mainImage: string | null }, sub: string, pickMode: KoshaPick["mode"]) => {
    const active = pick?.mode === pickMode && pick.id === item.id;
    return (
      <Button size="flush" variant="ghost"
        key={`${pickMode}-${item.id}`}
        type="button"
        onClick={() => onPick({ mode: pickMode, id: item.id, name: item.name, price: item.price })}
        aria-pressed={active}
        className={`group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background text-right transition-colors ${active ? "border-primary ring-2 ring-primary/30" : "border-border/40 hover:border-primary/40"}`}
      >
        <span className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
          <img src={item.mainImage || "/images/kosha.png"} alt={item.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" loading="lazy" decoding="async" />
          {active ? <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow"><CheckCircle2 className="h-4 w-4" /></span> : null}
        </span>
        <span className="block min-w-0 space-y-0.5 p-2">
          <span className="block truncate text-xs font-semibold text-foreground">{item.name}</span>
          <span className="block text-[11px] font-bold text-primary">{item.price > 0 ? formatCurrency(item.price) : "حسب الاتفاق"}</span>
          {sub ? <span className="block truncate text-[10px] text-muted-foreground">{sub}</span> : null}
        </span>
      </Button>
    );
  };
  const grid = "grid max-h-[39rem] grid-cols-3 gap-2 overflow-y-auto pe-1";
  return (
    <section id="booking-kosha-settings" className="mt-4 space-y-3 rounded-xl border border-rose-200/70 bg-rose-50/45 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-rose-600"><Crown className="h-5 w-5" /></span>
        <div>
          <h3 className="font-semibold text-foreground">الكوشة</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">اختر باقة جاهزة، أو كوشة بشكل اختياري من كتالوج الكوشات.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ key, label, hint, Icon }) => (
          <Button variant="ghost"
            key={key}
            type="button"
            onClick={() => onMode(key)}
            aria-pressed={mode === key}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-right transition-colors ${mode === key ? "border-primary bg-primary/10" : "border-border/40 bg-background hover:border-primary/40"}`}
          >
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${mode === key ? "bg-primary text-primary-foreground" : "bg-muted text-primary"}`}><Icon className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className={`block truncate text-sm ${mode === key ? "font-semibold text-primary" : "font-medium text-foreground"}`}>{label}</span>
              <span className="block text-[11px] text-muted-foreground">{hint}</span>
            </span>
          </Button>
        ))}
      </div>
      {mode ? (
        error ? (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>تعذر تحميل كتالوج الكوشات: {error}</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onRetry}>إعادة المحاولة</Button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="aspect-[4/5] rounded-lg" />)}</div>
        ) : mode === "packages" ? (
          packages.length ? (
            <div className={grid}>
              {packages.map((item) => card(item, item.badgeText || item.features[0] || "", "package"))}
            </div>
          ) : <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">لا توجد باقات جاهزة مفعّلة حالياً.</p>
        ) : (
          <div className="space-y-2">
            <div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="ابحث باسم الكوشة" className="h-9 pr-9 text-sm" /></div>
            {visibleKoshas.length ? (
              <div className={grid}>
                {visibleKoshas.map((item) => card(item, KOSHA_AVAILABILITY_NOTE[item.availabilityStatus ?? ""] ?? "", "custom"))}
              </div>
            ) : <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">{koshas.length ? "لا توجد كوشة بهذا الاسم." : "لا توجد كوشات مفعّلة حالياً."}</p>}
          </div>
        )
      ) : null}
      {pick ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-background/80 px-3 py-2 text-sm">
          <span className="min-w-0 truncate"><CheckCircle2 className="ml-1 inline h-4 w-4 text-primary" /><b>{koshaPickLabel(pick)}</b></span>
          <span className="flex shrink-0 items-center gap-1">
            {pick.price > 0 && totalAmount !== pick.price ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onUsePrice(pick.price)}>اعتماد السعر كمبلغ كلي</Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={onClear} aria-label="إلغاء اختيار الكوشة"><X className="h-3.5 w-3.5" /></Button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

// Flowers section: the bouquet studio (/design) catalogue inside the booking
// form — section tabs, search, 3-column image cards with colour choice, and the
// chosen items with quantities. Their total is added to the booking total.
function FlowerCatalogSection({ catalog, loading, error, onRetry, items, onChange }: {
  catalog: FlowerCatalogProduct[] | undefined;
  loading: boolean;
  error: string;
  onRetry: () => void;
  items: FlowerBookingItem[];
  onChange: (items: FlowerBookingItem[]) => void;
}) {
  const [section, setSection] = useState<FlowerSection>("flowers");
  const [search, setSearch] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<number, number>>({});
  const products = catalog ?? [];
  const sections = FLOWER_SECTIONS.filter((item) => products.some((product) => product.designerSection === item.key));
  const activeSection = sections.some((item) => item.key === section) ? section : sections[0]?.key ?? section;
  const needle = search.trim().toLowerCase();
  const visible = products.filter((product) =>
    product.designerSection === activeSection &&
    (!needle || `${product.nameAr} ${product.name}`.toLowerCase().includes(needle)),
  );
  const activeVariants = (product: FlowerCatalogProduct) => product.variants.filter((variant) => variant.isActive !== false);
  const chosenVariant = (product: FlowerCatalogProduct) => {
    const variants = activeVariants(product);
    return variants.find((variant) => variant.id === variantChoice[product.id]) ?? variants[0] ?? null;
  };
  const add = (product: FlowerCatalogProduct) => {
    const variant = chosenVariant(product);
    const key = variant ? `v:${variant.id}` : `p:${product.id}`;
    const existing = items.find((item) => item.key === key);
    if (existing) {
      onChange(items.map((item) => (item.key === key ? { ...item, quantity: item.quantity + 1 } : item)));
      return;
    }
    onChange([
      ...items,
      {
        key,
        productId: product.id,
        variantId: variant?.id ?? null,
        name: product.nameAr || product.name,
        variantLabel: variant?.color ?? null,
        section: product.designerSection,
        quantity: 1,
        unitPrice: Number(variant?.price ?? product.price ?? 0),
      },
    ]);
  };
  const setQuantity = (key: string, quantity: number) =>
    onChange(quantity <= 0 ? items.filter((item) => item.key !== key) : items.map((item) => (item.key === key ? { ...item, quantity } : item)));
  const subtotal = flowerItemsTotal(items);

  return (
    <section id="booking-flowers-settings" className="mt-4 space-y-3 rounded-xl border border-rose-200/70 bg-rose-50/45 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-rose-600"><Flower2 className="h-5 w-5" /></span>
          <div>
            <h3 className="font-semibold text-foreground">الورد</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">نفس منتجات استوديو تصميم الباقة. يُضاف مجموع الورد تلقائياً إلى المبلغ الكلي.</p>
          </div>
        </div>
        <a href="/design" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <ExternalLink className="h-3.5 w-3.5" /> فتح الاستوديو
        </a>
      </div>
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>تعذر تحميل منتجات الورد: {error}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onRetry}>إعادة المحاولة</Button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="aspect-[4/5] rounded-lg" />)}</div>
      ) : !products.length ? (
        <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">لا توجد منتجات ورد مفعّلة في استوديو التصميم.</p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {sections.map((item) => {
              const count = products.filter((product) => product.designerSection === item.key).length;
              const active = item.key === activeSection;
              return (
                <Button variant="ghost"
                  key={item.key}
                  type="button"
                  onClick={() => setSection(item.key)}
                  aria-pressed={active}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border/50 bg-background hover:border-primary/40"}`}
                >
                  {item.label} <span className="opacity-70">({count})</span>
                </Button>
              );
            })}
          </div>
          <div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المنتج" className="h-9 pr-9 text-sm" /></div>
          {visible.length ? (
            <div className="grid max-h-[39rem] grid-cols-3 gap-2 overflow-y-auto pe-1">
              {visible.map((product) => {
                const variants = activeVariants(product);
                const variant = chosenVariant(product);
                const price = Number(variant?.price ?? product.price ?? 0);
                const stock = variant ? Number(variant.available ?? variant.stock ?? 0) : Number(product.stock ?? 0);
                const inCart = items.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
                return (
                  <div key={product.id} className={`flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background ${inCart ? "border-primary ring-2 ring-primary/30" : "border-border/40"}`}>
                    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
                      <img src={variant?.image || product.images?.[0] || "/images/kosha.png"} alt={product.nameAr || product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      {inCart ? <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground shadow">× {inCart}</span> : null}
                    </span>
                    <div className="flex flex-1 flex-col gap-1 p-2">
                      <span className="block truncate text-xs font-semibold text-foreground" title={product.nameAr || product.name}>{product.nameAr || product.name}</span>
                      <span className="block text-[11px] font-bold text-primary">{price > 0 ? formatCurrency(price) : "حسب الاتفاق"}</span>
                      {stock <= 0 ? <span className="block text-[10px] text-muted-foreground">غير متوفر بالمخزون حالياً</span> : null}
                      {variants.length > 1 ? (
                        <select
                          value={variant?.id ?? ""}
                          onChange={(event) => setVariantChoice((current) => ({ ...current, [product.id]: Number(event.target.value) }))}
                          className="h-7 w-full rounded-md border border-input bg-background px-1 text-[11px]"
                          aria-label={`لون ${product.nameAr || product.name}`}
                        >
                          {variants.map((option) => <option key={option.id} value={option.id}>{option.color || `نوع ${option.id}`}</option>)}
                        </select>
                      ) : null}
                      <Button type="button" size="sm" variant={inCart ? "default" : "outline"} className="mt-auto h-7 w-full gap-1 px-1 text-[11px]" onClick={() => add(product)}>
                        <Plus className="h-3.5 w-3.5" /> إضافة
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">لا توجد منتجات بهذا الاسم في هذا القسم.</p>}
        </>
      )}
      {items.length ? (
        <div className="space-y-1.5 rounded-lg border border-primary/30 bg-background/80 p-2">
          <div className="flex items-center justify-between text-xs font-semibold"><span>الورد المختار</span><span className="text-primary">{formatCurrency(subtotal)}</span></div>
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{item.name}{item.variantLabel ? ` · ${item.variantLabel}` : ""}</span>
              <span className="flex shrink-0 items-center gap-1">
                <Button size="iconSm" variant="ghost" type="button" onClick={() => setQuantity(item.key, item.quantity - 1)} className="grid h-6 w-6 place-items-center rounded border border-border/60" aria-label={`إنقاص ${item.name}`}>−</Button>
                <span className="w-6 text-center tabular-nums">{item.quantity}</span>
                <Button size="iconSm" variant="ghost" type="button" onClick={() => setQuantity(item.key, item.quantity + 1)} className="grid h-6 w-6 place-items-center rounded border border-border/60" aria-label={`زيادة ${item.name}`}>+</Button>
                <span className="w-20 text-left tabular-nums text-muted-foreground">{formatCurrency(item.unitPrice * item.quantity)}</span>
                <Button variant="ghost" type="button" onClick={() => setQuantity(item.key, 0)} className="text-destructive" aria-label={`إزالة ${item.name}`}><X className="h-3.5 w-3.5" /></Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function StoreProductPicker({ sectionId, className, title, description, icon: Icon, categoryLabel, hints, products, categories, loading, error, onRetry, items, onChange, requiredError }: {
  sectionId: string;
  className: string;
  title: string;
  description: string;
  icon: typeof Gift;
  categoryLabel: string;
  hints: string[];
  products: any[];
  categories: any[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  items: StoreBookingItem[];
  onChange: (items: StoreBookingItem[]) => void;
  requiredError?: string;
}) {
  const [scope, setScope] = useState<"category" | "all">("category");
  const [search, setSearch] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<number, number>>({});
  const categoryIds = useMemo(() => storeCategoryIds(categories, hints), [categories, hints]);
  const storeProducts = useMemo(
    () => products.filter((product) => product?.isActive !== false && !product?.archivedAt && !product?.isAsset && product?.itemType !== "service"),
    [products],
  );
  const inCategory = useMemo(
    () => storeProducts.filter((product) => categoryIds.has(Number(product?.categoryId ?? product?.category_id))),
    [storeProducts, categoryIds],
  );
  const activeScope = scope === "category" && inCategory.length ? "category" : "all";
  const needle = search.trim().toLowerCase();
  const visible = (activeScope === "category" ? inCategory : storeProducts)
    .filter((product) => !needle || [product.nameAr, product.name, product.barcode, product.sku].some((value) => String(value ?? "").toLowerCase().includes(needle)))
    .slice(0, 48);
  const activeVariants = (product: any): any[] => (Array.isArray(product?.variants) ? product.variants : []).filter((variant: any) => variant?.isActive !== false);
  const chosenVariant = (product: any) => {
    const variants = activeVariants(product);
    return variants.find((variant) => Number(variant.id) === variantChoice[Number(product.id)]) ?? variants[0] ?? null;
  };
  const priceOf = (product: any, variant: any) => Number(variant?.price ?? product?.price ?? 0) || 0;
  const add = (product: any) => {
    const variant = chosenVariant(product);
    const key = variant ? `v:${variant.id}` : `p:${product.id}`;
    if (items.some((item) => item.key === key)) {
      onChange(items.map((item) => (item.key === key ? { ...item, quantity: item.quantity + 1 } : item)));
      return;
    }
    onChange([...items, {
      key,
      productId: Number(product.id),
      variantId: variant ? Number(variant.id) : null,
      name: product.nameAr || product.name || `#${product.id}`,
      variantLabel: variant ? String(variant.color || variant.name || variant.sku || "") || null : null,
      quantity: 1,
      unitPrice: priceOf(product, variant),
    }]);
  };
  const setQuantity = (key: string, quantity: number) =>
    onChange(quantity <= 0 ? items.filter((item) => item.key !== key) : items.map((item) => (item.key === key ? { ...item, quantity } : item)));
  const subtotal = storeItemsTotal(items);

  return (
    <div id={sectionId} className={className}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-primary"><Icon className="h-5 w-5" /></span>
        <div><h3 className="font-semibold text-foreground">{title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={`مصدر منتجات ${title}`}>
        <Button type="button" size="sm" variant={activeScope === "category" ? "default" : "outline"} disabled={!inCategory.length} onClick={() => setScope("category")}><ShoppingBag className="h-4 w-4" />{categoryLabel}{inCategory.length ? ` (${inCategory.length})` : ""}</Button>
        <Button type="button" size="sm" variant={activeScope === "all" ? "default" : "outline"} onClick={() => setScope("all")}><Search className="h-4 w-4" />كل المتجر</Button>
      </div>
      {!loading && !error && !inCategory.length ? <p className="text-[11px] text-muted-foreground">لا يوجد قسم «{categoryLabel.replace("قسم ", "")}» بمنتجات في المتجر؛ ابحث في كل المتجر.</p> : null}
      <div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id={`${sectionId}-search`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المنتج أو الباركود" className="h-9 pr-9 text-sm" aria-invalid={Boolean(requiredError)} /></div>
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onRetry}>إعادة المحاولة</Button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="aspect-[4/5] rounded-lg" />)}</div>
      ) : visible.length ? (
        <div className="grid max-h-[26rem] grid-cols-3 gap-2 overflow-y-auto pe-1">
          {visible.map((product) => {
            const variants = activeVariants(product);
            const variant = chosenVariant(product);
            const price = priceOf(product, variant);
            const inCart = items.filter((item) => item.productId === Number(product.id)).reduce((sum, item) => sum + item.quantity, 0);
            const image = variant?.image || product.images?.[0] || product.imageUrl || product.image || "";
            return (
              <div key={product.id} className={`flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background ${inCart ? "border-primary ring-2 ring-primary/30" : "border-border/40"}`}>
                <span className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden bg-muted">
                  {image ? <img src={image} alt={product.nameAr || product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <Icon className="h-6 w-6 text-muted-foreground" />}
                  {inCart ? <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground shadow">× {inCart}</span> : null}
                </span>
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <span className="block truncate text-xs font-semibold text-foreground" title={product.nameAr || product.name}>{product.nameAr || product.name}</span>
                  <span className="block text-[11px] font-bold text-primary">{price > 0 ? formatCurrency(price) : "حسب الاتفاق"}</span>
                  {variants.length > 1 ? (
                    <select
                      value={variant?.id ?? ""}
                      onChange={(event) => setVariantChoice((current) => ({ ...current, [Number(product.id)]: Number(event.target.value) }))}
                      className="h-7 w-full rounded-md border border-input bg-background px-1 text-[11px]"
                      aria-label={`نوع ${product.nameAr || product.name}`}
                    >
                      {variants.map((option) => <option key={option.id} value={option.id}>{option.color || option.name || `نوع ${option.id}`}</option>)}
                    </select>
                  ) : null}
                  <Button type="button" size="sm" variant={inCart ? "default" : "outline"} className="mt-auto h-7 w-full gap-1 px-1 text-[11px]" onClick={() => add(product)}>
                    <Plus className="h-3.5 w-3.5" /> إضافة
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">لا توجد منتجات مطابقة.</p>}
      {items.length ? (
        <div className="space-y-1.5 rounded-lg border border-primary/30 bg-background/80 p-2">
          <div className="flex items-center justify-between text-xs font-semibold"><span>المنتجات المختارة</span><span className="text-primary">{formatCurrency(subtotal)}</span></div>
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{item.name}{item.variantLabel ? ` · ${item.variantLabel}` : ""}</span>
              <span className="flex shrink-0 items-center gap-1">
                <Button size="iconSm" variant="ghost" type="button" onClick={() => setQuantity(item.key, item.quantity - 1)} className="grid h-6 w-6 place-items-center rounded border border-border/60" aria-label={`إنقاص ${item.name}`}>−</Button>
                <span className="w-6 text-center tabular-nums">{item.quantity}</span>
                <Button size="iconSm" variant="ghost" type="button" onClick={() => setQuantity(item.key, item.quantity + 1)} className="grid h-6 w-6 place-items-center rounded border border-border/60" aria-label={`زيادة ${item.name}`}>+</Button>
                <span className="w-20 text-left tabular-nums text-muted-foreground">{formatCurrency(item.unitPrice * item.quantity)}</span>
                <Button variant="ghost" type="button" onClick={() => setQuantity(item.key, 0)} className="text-destructive" aria-label={`إزالة ${item.name}`}><X className="h-3.5 w-3.5" /></Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {requiredError ? <p className="text-xs text-destructive">{requiredError}</p> : null}
    </div>
  );
}

function PhotographyServiceItemsSelector({ products, loading, error, items, onChange }: {
  products: any[];
  loading: boolean;
  error: string;
  items: PhotographyServiceLine[];
  onChange: (items: PhotographyServiceLine[]) => void;
}) {
  const candidates = products.filter((product) => product?.itemType === "service" && product?.isActive !== false && String(product?.serviceUnit ?? "").trim());
  const selected = new Set(items.map((item) => item.productId));
  const add = (product: any) => onChange([...items, {
    productId: Number(product.id),
    productName: product.nameAr || product.name || "خدمة تصوير",
    unit: String(product.serviceUnit).trim(),
    quantity: 1,
    unitPrice: Number(product.price) || 0,
    discount: 0,
  }]);
  const update = (productId: number, patch: Partial<PhotographyServiceLine>) => onChange(items.map((item) => item.productId === productId ? { ...item, ...patch } : item));
  return <div className="space-y-2 rounded-lg border border-border/50 bg-background/75 p-3">
    <div><h4 className="text-sm font-semibold">خدمات التصوير المسعّرة</h4><p className="mt-1 text-xs text-muted-foreground">اختر الخدمات من المنتجات مرة واحدة؛ يُضاف مجموعها تلقائياً لإجمالي الحجز.</p></div>
    {loading ? <p className="text-xs text-muted-foreground">جارٍ تحميل الخدمات…</p> : error ? <p role="alert" className="text-xs text-destructive">{error}</p> : candidates.length ? <div className="flex flex-wrap gap-2">{candidates.filter((product) => !selected.has(Number(product.id))).map((product) => <Button key={product.id} type="button" size="sm" variant="outline" onClick={() => add(product)}><Plus className="h-3.5 w-3.5" />{product.nameAr || product.name} · {formatCurrency(Number(product.price) || 0)} / {product.serviceUnit}</Button>)}</div> : <p className="text-xs text-muted-foreground">لا توجد خدمة فعالة؛ أضف عنصراً من نوع خدمة في إدارة المنتجات.</p>}
    {items.length ? <div className="space-y-2">{items.map((item) => <div key={item.productId} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_6rem_auto] items-center gap-2 rounded-md border border-border/40 p-2 text-sm">
      <div className="min-w-0"><p className="truncate font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} / {item.unit}</p></div>
      <Input aria-label={`كمية ${item.productName}`} type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => update(item.productId, { quantity: Math.max(0.001, Number(event.target.value) || 0.001) })} />
      <Input aria-label={`خصم ${item.productName}`} type="number" min="0" step="1" value={item.discount} onChange={(event) => update(item.productId, { discount: Math.max(0, Number(event.target.value) || 0) })} />
      <span className="text-left font-semibold tabular-nums">{formatCurrency(Math.max(0, item.quantity * item.unitPrice - item.discount))}</span>
      <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label={`حذف ${item.productName}`} onClick={() => onChange(items.filter((current) => current.productId !== item.productId))}><X className="h-4 w-4" /></Button>
      </div>)}</div> : null}
    {items.length ? <div className="flex justify-between border-t border-border/50 pt-2 text-sm"><span>مجموع خدمات التصوير</span><strong className="text-primary">{formatCurrency(items.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0))}</strong></div> : null}
  </div>;
}

function ServiceOrderItemsEditor({ order }: { order: ServiceOrder }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const productsQuery = useQuery<any[]>({ queryKey: ["admin", "products-all", "booking-photography-services"], queryFn: () => adminFetch("/admin/products?limit=2000") });
  const [items, setItems] = useState(() => order.serviceItems ?? []);
  const baseTotalAmount = Math.max(0, num(order.totalAmount) - (order.serviceItems ?? []).reduce((sum, item) => sum + item.total, 0));
  const serviceTotal = items.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unitPrice - item.discount), 0);
  const products = (productsQuery.data ?? []).filter((product) => product?.itemType === "service" && product?.isActive !== false && String(product?.serviceUnit ?? "").trim());
  const save = useMutation({
    mutationFn: () => adminFetch<any>(`/admin/service-orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        baseTotalAmount,
        serviceItems: items.map((item) => ({ productId: item.productId, quantity: item.quantity, discount: item.discount })),
      }),
    }),
    onSuccess: (response) => {
      setItems(response.serviceItems ?? []);
      queryClient.invalidateQueries({ queryKey: ["admin", "booking-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      toast({ title: "تم تحديث خدمات التصوير وإجمالي الحجز" });
    },
    onError: (error: any) => toast({ title: "تعذر حفظ خدمات التصوير", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const addProduct = (product: any) => setItems((current) => [...current, {
    id: -Number(product.id), productId: Number(product.id), productName: product.nameAr || product.name,
    unit: product.serviceUnit, quantity: 1, unitPrice: Number(product.price) || 0, discount: 0, total: Number(product.price) || 0,
  }]);
  return <section className="ajn-panel space-y-3">
    <div className="ajn-panel-title"><div><Camera /><span><small>تفاصيل مفوترة ضمن الحجز</small><h2>خدمات التصوير المسعّرة</h2></span></div></div>
    <p className="text-xs text-muted-foreground">المبلغ الأساسي المحفوظ: {formatCurrency(baseTotalAmount)}. تُضاف الخدمات أدناه إليه مع بقاء سجل الدفع الحالي للحجز.</p>
    {productsQuery.isLoading ? <p className="text-sm text-muted-foreground">جارٍ تحميل الخدمات…</p> : productsQuery.isError ? <p className="text-sm text-destructive">تعذر تحميل كتالوج الخدمات.</p> : <div className="flex flex-wrap gap-2">{products.filter((product) => !items.some((item) => item.productId === Number(product.id))).map((product) => <Button type="button" key={product.id} size="sm" variant="outline" onClick={() => addProduct(product)}><Plus className="h-3.5 w-3.5" />{product.nameAr || product.name} · {formatCurrency(Number(product.price) || 0)} / {product.serviceUnit}</Button>)}</div>}
    {items.map((item, index) => <div key={`${item.productId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_6rem_auto] items-center gap-2 rounded-lg border border-border/40 p-2">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} / {item.unit}</p></div>
      <Input aria-label={`كمية ${item.productName}`} type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => setItems((current) => current.map((line, rowIndex) => rowIndex === index ? { ...line, quantity: Math.max(.001, Number(event.target.value) || .001) } : line))} />
      <Input aria-label={`خصم ${item.productName}`} type="number" min="0" step="1" value={item.discount} onChange={(event) => setItems((current) => current.map((line, rowIndex) => rowIndex === index ? { ...line, discount: Math.max(0, Number(event.target.value) || 0) } : line))} />
      <strong className="text-left text-sm tabular-nums">{formatCurrency(Math.max(0, item.quantity * item.unitPrice - item.discount))}</strong>
      <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label={`حذف ${item.productName}`} onClick={() => setItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X className="h-4 w-4" /></Button>
    </div>)}
    <div className="flex items-center justify-between border-t border-border/50 pt-2"><span>إجمالي الحجز بعد التحديث</span><strong className="text-primary">{formatCurrency(baseTotalAmount + serviceTotal)}</strong></div>
    <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || productsQuery.isError}><Save className="h-4 w-4" />{save.isPending ? "جارٍ الحفظ…" : "حفظ خدمات التصوير"}</Button>
  </section>;
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
    {loading ? <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-center text-xs text-muted-foreground">جارٍ تحميل عناصر الصوت…</div> : candidates.length ? <div className="max-h-44 overflow-y-auto rounded-lg border border-border/40 bg-background/70">{candidates.map((product) => <Button variant="ghost" key={product.id} type="button" className="flex w-full items-center justify-between gap-3 border-b border-border/30 px-3 py-2.5 text-right text-sm last:border-b-0 hover:bg-primary/5" onClick={() => add(product)}><span className="min-w-0 truncate font-medium">{product.nameAr || product.name}</span><span className="shrink-0 text-xs text-primary">إضافة</span></Button>)}</div> : <p className="rounded-lg border border-dashed border-border/40 px-3 py-3 text-center text-xs text-muted-foreground">لا توجد عناصر صوتيات مطابقة في {source === "store" ? "المتجر" : "الأصول"}.</p>}
    {items.length ? <div className="space-y-2 rounded-lg border border-border/40 bg-background/70 p-2"><div className="flex items-center justify-between px-1"><b className="text-xs">العناصر المختارة</b><span className="text-xs text-muted-foreground">{items.length} عناصر</span></div>{items.map((item) => <div key={item.productId} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 rounded-md bg-muted/35 px-2 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-[11px] text-muted-foreground">{item.source === "asset" ? "من الأصول" : "من المتجر"}{item.barcode ? ` · ${item.barcode}` : ""}</p></div><Input type="number" min="1" value={item.quantity} aria-label={`كمية ${item.name}`} onChange={(event) => updateQuantity(item.productId, Number(event.target.value))} /><Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`إزالة ${item.name}`} onClick={() => onChange(items.filter((candidate) => candidate.productId !== item.productId))}><X className="h-4 w-4" /></Button></div>)}</div> : null}
  </section>;
}

export function bookingWorkspacePath(source: "service" | "kosha", id: number) {
  return source === "service" ? `/admin/booking-center/service/${id}` : `/admin/kosha-bookings/${id}`;
}

function BookingWorkspace({ source, id }: { source: "service" | "kosha"; id: number }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "1");
  const activeQuery = useQuery({
    queryKey: ["admin", "booking-workspace", source, id],
    queryFn: () => adminFetch<ServiceOrder | KoshaBooking>(bookingWorkspacePath(source, id)),
  });
  const data = useMemo(() => {
    const record = activeQuery.data;
    if (!record) return null;
    return source === "service"
      ? unify([record as ServiceOrder], [])[0]
      : unify([], [record as KoshaBooking])[0];
  }, [source, activeQuery.data]);
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
              {data.source === "service" && data.services.some((service) => service.type === "photography") ? <ServiceOrderItemsEditor order={data.raw as ServiceOrder} /> : null}
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
