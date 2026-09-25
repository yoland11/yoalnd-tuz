import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArchiveRestore,
  Banknote,
  Camera,
  Barcode,
  Building2,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  History,
  Landmark,
  ListChecks,
  Loader2,
  MapPin,
  MoreHorizontal,
  MessageCircle,
  PackageCheck,
  PackageOpen,
  Pencil,
  Percent,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  TriangleAlert,
  Trash2,
  Truck,
  UserRound,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, compressImageFile, formatCurrency } from "./_lib";
import { BookingThermalPrintAction } from "@/components/booking-thermal-print";
import { BookingThermalReceiptAction } from "@/components/booking-thermal-receipt";
import { AccountSummaryCard } from "./payment-collection";
import { CustomerFinancialSummary } from "./customer-financial-summary";
import "./booking-operations-workspace.css";

export type BookingOperationsBooking = {
  source: "service" | "kosha";
  id: number;
  number: string;
  customerId?: number | null;
  customerName: string;
  phone: string;
  eventDate: string;
  eventTime: string;
  hall: string;
  status: string;
  total: number;
  paid: number;
  remaining: number;
  paymentStatus: string;
  services: Array<{ type: string; status: string; amount?: number; notes?: string }>;
  notes?: string;
  raw: any;
};

type OverviewData = {
  readiness: number;
  bookingStage: string;
  warehouseStage: string;
  warehouseHistory: Array<{ stage: string; employeeName: string; at: string; scannedCode?: string | null; note?: string | null }>;
  counts: { products: number; assets: number; tasks: number; completedTasks: number; documents: number; alerts: number };
  readinessParts: Record<string, number>;
  alerts: Array<{ type: string; severity: "high" | "medium" | "low"; title: string; tab: string }>;
  recentActivity: TimelineRow[];
};

type ProductLine = {
  id: number;
  productId: number;
  variantId: number | null;
  productName: string;
  variantLabel: string | null;
  color: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  warehouseId?: number | null;
  note?: string | null;
  status: string;
  available: number;
  reserved: number;
  barcode?: string | null;
};

type CatalogItem = {
  id: number;
  name: string;
  barcode?: string | null;
  price: number;
  category?: string | null;
  isRental: boolean;
  isAsset: boolean;
  profileStatus?: string | null;
  totalStock: number;
  reserved: number;
  available: number;
  variants: Array<{ id: number; color?: string | null; size?: string | null; available: number; reserved: number; stock: number }>;
};

type AssetRow = {
  productId: number;
  name: string;
  assetCode: string;
  serialNumber?: string | null;
  barcode?: string | null;
  qrToken?: string | null;
  warehouse?: string | null;
  location?: string | null;
  quantity: number;
  available: number;
  reserved: number;
  out: number;
  returned: number;
  responsibleStaffName?: string | null;
  checkoutAt?: string | null;
  returnedAt?: string | null;
  damaged: number;
  missing: number;
  stage: string;
  status: string;
  usageCount: number;
  usageHours: number;
  healthScore: number;
  purchaseValue: number;
  currentValue: number;
  depreciationAmount: number;
  remainingValue: number;
  depreciationMethod: string;
  automaticDepreciation: boolean;
  lastBooking?: string | null;
  lastCustomer?: string | null;
  lastInspection?: string | null;
  nextMaintenanceDate?: string | null;
  maintenanceRequired: boolean;
  problem: string;
  description?: string | null;
  estimatedCost: number;
};

type TimelineRow = { id: number; type: string; title: string; body?: string | null; actorName?: string; createdAt: string; metadata?: Record<string, any> };
type AssignableStaff = { id: number; name: string; role?: string | null; department?: string | null };
type StaffAssignmentData = { types: string[]; assignedStaff: AssignableStaff[]; eligibleStaff: AssignableStaff[] };
type BranchData = {
  data: Array<{ id: number; name: string; code?: string | null; isActive?: boolean }>;
  assignments: Array<{ branchId: number; entityType: string; entityId: number }>;
};

const BOOKING_STEPS = [
  ["booked", "تم الحجز"],
  ["preparing", "قيد التجهيز"],
  ["ready", "جاهز للخروج"],
  ["assets_out", "خرجت المعدات"],
  ["event_active", "المناسبة جارية"],
  ["returned", "تمت العودة"],
  ["inspection", "فحص المعدات"],
  ["completed", "مغلق"],
] as const;

const WAREHOUSE_STEPS = [
  ["reserved", "محجوز"],
  ["picked", "تم التجهيز"],
  ["loaded", "تم التحميل"],
  ["out", "خرج من المستودع"],
  ["returned", "تمت الإعادة"],
  ["inspection", "قيد الفحص"],
  ["completed", "مكتمل"],
] as const;

const TAB_LABELS: Array<[string, string, typeof Boxes]> = [
  ["overview", "نظرة عامة", Gauge],
  ["products", "المنتجات", ShoppingBag],
  ["assets", "الأصول", PackageCheck],
  ["warehouse", "المستودع", Warehouse],
  ["depreciation", "الإهلاك", ArchiveRestore],
  ["inventory", "حركات المخزون", Boxes],
  ["finance", "الملخص المالي", CircleDollarSign],
  ["tasks", "المهام", ListChecks],
  ["documents", "المستندات", FileText],
  ["activity", "النشاط والتايملاين", History],
];

const STAGE_LABELS: Record<string, string> = Object.fromEntries([...BOOKING_STEPS, ...WAREHOUSE_STEPS]);
const ASSET_STAGE_LABELS: Record<string, string> = { linked: "مضاف", reserved: "محجوز", picked: "مجهز", out: "خارج المستودع", returned: "مرتجع", inspection: "قيد الفحص", completed: "مكتمل" };

function money(value: number) {
  return <span className="tabular-nums">{formatCurrency(Number(value || 0))}</span>;
}

function readableDate(value?: string | null) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString("ar-IQ-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });
}

function toneFor(value: string) {
  if (["completed", "paid", "active", "returned", "ready", "consumed", "executed"].includes(value)) return "success";
  if (["damaged", "missing", "lost", "cancelled", "shortage", "rejected"].includes(value)) return "danger";
  if (["preparing", "reserved", "picked", "pending", "inspection", "maintenance", "reversed", "draft"].includes(value)) return "warning";
  if (["out", "loaded", "assets_out", "event_active"].includes(value)) return "info";
  return "neutral";
}

// Financial-approval status/type labels for the unified booking ledger.
const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  executed: "معتمد ومنفّذ",
  rejected: "مرفوض",
  reversed: "معكوس",
  cancelled: "ملغي",
};

function ledgerTypeLabel(row: any): string {
  if (row?.reversalReason || row?.reversedTransactionId || String(row?.transactionType ?? "").includes("reversal"))
    return "عكس / تصحيح";
  if (row?.direction === "revenue") return row?.sourceEvent === "payment" ? "دفعة / قبض" : "قبض";
  return "صرف";
}

function OperationStatus({ value, label }: { value: string; label?: string }) {
  return <span className={`ajn-op-status is-${toneFor(value)}`}>{label ?? STAGE_LABELS[value] ?? ASSET_STAGE_LABELS[value] ?? value}</span>;
}

function QueryState({ loading, error, empty, children }: { loading: boolean; error?: unknown; empty?: boolean; children: React.ReactNode }) {
  if (loading) return <div className="ajn-op-skeleton"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>;
  if (error) return <div className="ajn-op-empty"><ShieldAlert /><h3>تعذر تحميل البيانات</h3><p>{(error as Error)?.message || "تحقق من الاتصال ثم أعد المحاولة."}</p></div>;
  if (empty) return <div className="ajn-op-empty"><PackageOpen /><h3>لا توجد بيانات مرتبطة بعد</h3><p>أضف أول سجل من الإجراءات المتاحة في هذا التبويب.</p></div>;
  return <>{children}</>;
}

function ConfirmAction({ open, title, description, actionLabel, busy, danger, onOpenChange, onConfirm }: { open: boolean; title: string; description: string; actionLabel: string; busy?: boolean; danger?: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>الرجوع</AlertDialogCancel><AlertDialogAction className={danger ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "ajn-op-primary"} disabled={busy} onClick={(event) => { event.preventDefault(); onConfirm(); }}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{actionLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function StaffAssignmentControl({ base, queryKey, booking }: { base: string; queryKey: unknown[]; booking: BookingOperationsBooking }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const query = useQuery<StaffAssignmentData>({ queryKey: [...queryKey, "staff-assignment"], queryFn: () => adminFetch(`${base}/staff-assignment`) });
  useEffect(() => {
    if (open) setSelected(query.data?.assignedStaff.map((staff) => staff.id) ?? []);
  }, [open, query.data]);
  const mutation = useMutation({
    mutationFn: () => adminFetch(`${base}/staff-assignment`, { method: "PATCH", body: JSON.stringify({ assignedStaffIds: selected }) }),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "booking-workspace"] });
      toast({ title: "تم تحديث فريق الحجز", description: "سيظهر الحجز فوراً للموظفين المعيّنين." });
    },
    onError: (error: any) => toast({ title: "تعذر تحديث فريق الحجز", description: error?.message, variant: "destructive" }),
  });
  const assigned = query.data?.assignedStaff ?? [];
  const toggle = (staffId: number) => setSelected((current) => current.includes(staffId) ? current.filter((id) => id !== staffId) : [...current, staffId]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button variant="outline" className="ajn-op-assign-trigger" onClick={() => setOpen(true)} disabled={query.isLoading}>
      <Users /> {assigned.length ? assigned.map((staff) => staff.name).join("، ") : "تعيين الموظفين"}
    </Button>
    <DialogContent dir="rtl" className="ajn-op-staff-dialog">
      <DialogHeader><DialogTitle>تعيين فريق الحجز</DialogTitle><DialogDescription>اختر موظفاً واحداً أو أكثر من المخولين لخدمات هذا الحجز. لا ينشئ التعيين مهاماً مكررة.</DialogDescription></DialogHeader>
      <div className="ajn-op-assignment-context">{booking.services.map((service) => service.type).join(" · ")} <span>·</span> {booking.number}</div>
      <div className="ajn-op-staff-picker" aria-label="الموظفون المخولون">
        {query.isLoading ? <Skeleton className="h-28" /> : query.data?.eligibleStaff.length ? query.data.eligibleStaff.map((staff) => {
          const checked = selected.includes(staff.id);
          return <label key={staff.id} className={checked ? "is-selected" : ""}>
            <input type="checkbox" checked={checked} onChange={() => toggle(staff.id)} />
            <span><b>{staff.name}</b><small>{[staff.role, staff.department].filter(Boolean).join(" · ") || "موظف مخول"}</small></span>
            <CheckCircle2 aria-hidden="true" />
          </label>;
        }) : <div className="ajn-op-empty compact"><Users /><h3>لا يوجد موظف مخول لهذه الخدمة</h3><p>راجع قسم الموظف وصلاحياته ثم أعد المحاولة.</p></div>}
      </div>
      <DialogFooter className="ajn-op-dialog-actions"><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="ajn-op-primary" disabled={mutation.isPending || query.isLoading} onClick={() => mutation.mutate()}>{mutation.isPending ? "جارٍ الحفظ..." : selected.length ? `حفظ ${selected.length} موظف` : "إزالة كل الموظفين"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function BookingBranchControl({ booking }: { booking: BookingOperationsBooking }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const entityType = booking.source === "kosha" ? "kosha_booking" : "service_order";
  const query = useQuery<BranchData>({
    queryKey: ["admin", "enterprise", "branches", entityType, booking.id],
    queryFn: () => adminFetch("/admin/enterprise/branches"),
  });
  const current = query.data?.assignments.find((row) => row.entityType === entityType && row.entityId === booking.id);
  const [branchId, setBranchId] = useState("");
  useEffect(() => {
    if (open) setBranchId(current?.branchId ? String(current.branchId) : "");
  }, [open, current?.branchId]);
  const mutation = useMutation({
    mutationFn: () => adminFetch("/admin/enterprise/branches/assign", {
      method: "POST",
      body: JSON.stringify({ branchId: Number(branchId), entityType, entityId: booking.id }),
    }),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "enterprise", "branches"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      toast({ title: "تم تحديث فرع الحجز" });
    },
    onError: (error: any) => toast({ title: "تعذر تحديث الفرع", description: error?.message, variant: "destructive" }),
  });
  const currentBranch = query.data?.data.find((row) => row.id === current?.branchId);
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button variant="outline" onClick={() => setOpen(true)} disabled={query.isLoading || Boolean(query.error)}><Building2 /> {currentBranch?.name || "تحديد الفرع"}</Button>
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>فرع الحجز</DialogTitle><DialogDescription>يرتبط الفرع بالحجز نفسه دون نسخ السجل أو تغيير رقمه.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="booking-branch">الفرع</Label><select id="booking-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">اختر الفرع</option>{query.data?.data.filter((branch) => branch.isActive !== false || branch.id === current?.branchId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` · ${branch.code}` : ""}</option>)}</select></div>
      <DialogFooter className="ajn-op-dialog-actions"><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="ajn-op-primary" disabled={!branchId || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "جارٍ الحفظ..." : "حفظ الفرع"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function BookingOperationsWorkspace({ booking, onEdit }: { booking: BookingOperationsBooking; onEdit?: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const base = `/admin/booking-operations/${booking.source}/${booking.id}`;
  const key = ["admin", "booking-operations", booking.source, booking.id];
  const [tab, setTab] = useState("overview");
  const [confirm, setConfirm] = useState<{ kind: "booking" | "warehouse"; stage: string; label: string } | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (value && TAB_LABELS.some(([id]) => id === value)) setTab(value);
  }, []);

  const changeTab = (value: string) => {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  const overview = useQuery<OverviewData>({ queryKey: [...key, "overview"], queryFn: () => adminFetch(`${base}/overview`) });
  const transportation = useQuery<{ transportation: { mode: "ajn" | "customer" | null; fee: number } | null }>({ queryKey: [...key, "transportation"], queryFn: () => adminFetch(`${base}/transportation`) });
  const setTransportation = useMutation({
    mutationFn: (payload: { mode: "ajn" | "customer" | null; fee: number }) => adminFetch(`${base}/transportation`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [...key, "transportation"] }); queryClient.invalidateQueries({ queryKey: [...key, "overview"] }); toast({ title: "تم تحديث خدمة النقل" }); },
    onError: (error: any) => toast({ title: "تعذر تحديث خدمة النقل", description: error?.message, variant: "destructive" }),
  });
  const workflow = useMutation({
    mutationFn: ({ kind, stage }: { kind: "booking" | "warehouse"; stage: string }) => adminFetch(`${base}/${kind === "booking" ? "workflow" : "warehouse"}`, { method: "PATCH", body: JSON.stringify({ stage, confirmation: true }) }),
    onSuccess: (_, input) => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["admin", "booking-workspace"] });
      toast({ title: input.kind === "booking" ? "تم تحديث مسار الحجز" : "تم تحديث مسار المستودع" });
    },
    onError: (error: any) => toast({ title: "تعذر تنفيذ الإجراء", description: error?.message, variant: "destructive" }),
  });

  const invoiceUrl = `/admin/invoice/${booking.id}?type=${booking.source === "kosha" ? "kosha" : "booking"}`;
  const paymentUrl = booking.source === "kosha" ? `/admin/kosha-bookings?booking=${booking.id}` : `/admin/orders?serviceOrder=${booking.id}`;
  const nextBooking = nextStep(BOOKING_STEPS, overview.data?.bookingStage);
  const nextWarehouse = nextStep(WAREHOUSE_STEPS, overview.data?.warehouseStage);
  const department = booking.raw?.departmentName || booking.raw?.department || booking.services[0]?.type || "تنظيم المناسبات";
  const responsibleTeam = booking.raw?.teamName || booking.raw?.assignedTeam || booking.raw?.assignedStaffName || "فريق العمليات";
  const whatsappNumber = String(booking.phone || "").replace(/\D/g, "").replace(/^0/, "964");
  const transportationMode = transportation.data?.transportation?.mode ?? (booking.source === "kosha" ? booking.raw?.transportationMode : null) ?? null;
  const transportationFee = Number(transportation.data?.transportation?.fee ?? (booking.source === "kosha" ? booking.raw?.transportationFee : 0) ?? 0);
  const transportationLabel = transportationMode === "ajn"
    ? `النقل بواسطة AJN${transportationFee > 0 ? ` — ${formatCurrency(transportationFee)}` : ""}`
    : transportationMode === "customer" ? "النقل من مسؤولية الزبون" : null;

  // Read-only projection of the booking's authoritative values for the dedicated
  // 80mm thermal receipt. No recomputation — total/paid/remaining/status are used
  // exactly as the booking-operations source provides them.
  const thermalReceiptData = {
    bookingNumber: booking.number,
    contractNumber:
      booking.raw?.customFields?.contractNumber ??
      booking.raw?.contractNumber ??
      booking.raw?.customFields?.contractNo ??
      null,
    customerName: booking.customerName,
    phone: booking.phone,
    service: booking.services.map((service) => service.type).filter(Boolean).join(" · "),
    eventDate: booking.eventDate,
    eventTime: booking.eventTime,
    location: booking.hall,
    total: booking.total,
    paid: booking.paid,
    remaining: booking.remaining,
    paymentStatus: booking.paymentStatus,
    notes: booking.notes ?? null,
  };

  return <div className="ajn-booking-operations" dir="rtl">
    <div className="ajn-op-back"><Button variant="ghost" asChild><Link href="/admin/bookings"><ChevronLeft className="h-4 w-4" /> مركز الحجوزات</Link></Button><span>مساحة تشغيل موحدة · البيانات من وحدات AJN الأصلية</span></div>

    <header className="ajn-op-sticky">
      <div className="ajn-op-header-main">
        <div className="ajn-op-identity"><span className="ajn-op-mark"><Sparkles /></span><div><small className="ajn-op-page-label">تفاصيل الحجز</small><div className="ajn-op-title"><h1>تفاصيل الحجز</h1><OperationStatus value={overview.data?.bookingStage ?? booking.status} /><Badge variant="outline">{department}</Badge></div><p><b>{booking.number}</b><span>·</span><UserRound /> {booking.customerName}</p></div></div>
        <div className="ajn-op-facts">
          <span><CalendarDays /><b>{readableDate(booking.eventDate)}</b><small>{booking.eventTime || "الوقت غير محدد"}</small></span>
          <span><MapPin /><b>{booking.hall || "الموقع غير محدد"}</b><small>{booking.services.map((service) => service.type).slice(0, 2).join(" · ") || "حجز مناسبة"}</small></span>
          {transportationLabel ? <span><Truck /><b>{transportationLabel}</b><small>خدمة النقل</small></span> : null}
          <span><Building2 /><b>{department}</b><small>القسم</small></span>
          <span><Users /><b>{responsibleTeam}</b><small>الفريق المسؤول</small></span>
          <span><CircleDollarSign /><b>{booking.paymentStatus || "غير مكتمل"}</b><small>حالة الدفع</small></span>
          <span><Warehouse /><b>{STAGE_LABELS[overview.data?.warehouseStage ?? "reserved"]}</b><small>حالة المستودع</small></span>
        </div>
        <div className="ajn-op-header-actions">{onEdit ? <Button variant="outline" onClick={onEdit}><Pencil /> تعديل</Button> : null}<Button variant="outline" onClick={() => window.print()}><Printer /> طباعة</Button><BookingThermalPrintAction booking={booking} /><BookingThermalReceiptAction data={thermalReceiptData} /><PreparationListAction base={base} booking={booking} />{whatsappNumber ? <Button variant="outline" onClick={() => window.open(`https://wa.me/${whatsappNumber}`, "_blank", "noopener,noreferrer")}><MessageCircle /> إرسال</Button> : null}<Button className="ajn-op-primary" onClick={() => changeTab("finance")}><Banknote /> تسجيل دفعة</Button><BookingBranchControl booking={booking} /><StaffAssignmentControl base={base} queryKey={key} booking={booking} /><DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="المزيد"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="ajn-op-more-menu"><DropdownMenuItem asChild><Link href={invoiceUrl}><ReceiptText /> إصدار فاتورة</Link></DropdownMenuItem><DropdownMenuItem onSelect={() => changeTab("documents")}><FileText /> مستندات الحجز</DropdownMenuItem><DropdownMenuItem onSelect={() => changeTab("activity")}><History /> سجل النشاط</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => changeTab("finance")}><CircleDollarSign /> الملخص المالي</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </div>
    </header>

    <BookingFinancialCards booking={booking} onFinance={() => changeTab("finance")} />

    <section className="ajn-op-workflows">
      <WorkflowRail title="مسار الحجز" icon={CalendarDays} steps={BOOKING_STEPS} current={overview.data?.bookingStage ?? "booked"} onStep={(stage, label) => setConfirm({ kind: "booking", stage, label })} />
      <WorkflowRail title="مسار المستودع" icon={Warehouse} steps={WAREHOUSE_STEPS} current={overview.data?.warehouseStage ?? "reserved"} onStep={(stage, label) => setConfirm({ kind: "warehouse", stage, label })} />
    </section>

    {overview.data?.alerts?.length ? <button className="ajn-op-alert" onClick={() => changeTab(overview.data!.alerts[0].tab)}><TriangleAlert /><strong>{overview.data.alerts[0].title}</strong><span>{overview.data.alerts.length > 1 ? `و${overview.data.alerts.length - 1} تنبيهات أخرى` : "فتح التفاصيل"}</span><ChevronLeft /></button> : <div className="ajn-op-all-clear"><CheckCircle2 /><span>لا توجد تنبيهات تشغيلية حرجة لهذا الحجز</span></div>}

    <OperationsSummary data={overview.data} booking={booking} onTab={changeTab} />

    <section className="ajn-op-quickbar"><DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button className="ajn-op-add-item"><Plus /> إضافة عنصر <ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="ajn-op-add-menu"><DropdownMenuItem onSelect={() => changeTab("products")}><span className="is-store"><ShoppingBag /></span><span><b>إضافة منتج من المتجر</b><small>اختر المنتجات والمتغيرات واحجز الكمية من المخزون.</small></span><ChevronLeft /></DropdownMenuItem><DropdownMenuItem onSelect={() => changeTab("assets")}><span className="is-asset"><PackageCheck /></span><span><b>إضافة أصل من الأصول</b><small>اربط المعدات وتحقق من التوفر وحالة الأصل.</small></span><ChevronLeft /></DropdownMenuItem><DropdownMenuItem onSelect={() => { window.requestAnimationFrame(() => document.getElementById("ajn-transport-card")?.scrollIntoView({ behavior: "smooth", block: "center" })); }}><span className="is-asset"><Truck /></span><span><b>إضافة خدمة نقل</b><small>حدّد النقل بواسطة AJN أو من مسؤولية الزبون لهذا الحجز.</small></span><ChevronLeft /></DropdownMenuItem></DropdownMenuContent></DropdownMenu><div>{nextBooking && <Button variant="outline" onClick={() => setConfirm({ kind: "booking", stage: nextBooking[0], label: nextBooking[1] })}><Check /> {nextBooking[1]}</Button>}{nextWarehouse && <Button variant="outline" onClick={() => setConfirm({ kind: "warehouse", stage: nextWarehouse[0], label: nextWarehouse[1] })}><QrCode /> {nextWarehouse[1]}</Button>}<Button variant="outline" onClick={() => changeTab("tasks")}><ListChecks /> إنشاء مهمة</Button><Button variant="outline" onClick={() => changeTab("documents")}><FileText /> رفع مستند</Button></div></section>

    <TransportationCard mode={transportationMode as any} fee={transportationFee} busy={setTransportation.isPending} onSave={(mode, fee) => setTransportation.mutate({ mode, fee })} />

    <div className="ajn-op-workspace-grid"><main><Tabs value={tab} onValueChange={changeTab} className="ajn-op-tabs">
      <TabsList>{TAB_LABELS.map(([value, label, Icon]) => <TabsTrigger key={value} value={value}><Icon /> {label}{overview.data && value in overview.data.counts && <em>{(overview.data.counts as any)[value]}</em>}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview"><OverviewTab data={overview.data} loading={overview.isLoading} error={overview.error} booking={booking} onTab={changeTab} /></TabsContent>
      <TabsContent value="products"><ProductsTab base={base} queryKey={key} /></TabsContent>
      <TabsContent value="assets"><AssetsTab base={base} queryKey={key} /></TabsContent>
      <TabsContent value="warehouse"><WarehouseTab base={base} queryKey={key} overview={overview.data} onStage={(stage, label) => setConfirm({ kind: "warehouse", stage, label })} /></TabsContent>
      <TabsContent value="depreciation"><DepreciationTab base={base} queryKey={key} /></TabsContent>
      <TabsContent value="inventory"><InventoryTab base={base} queryKey={key} /></TabsContent>
      <TabsContent value="finance"><FinanceTab base={base} queryKey={key} booking={booking} invoiceUrl={invoiceUrl} paymentUrl={paymentUrl} /></TabsContent>
      <TabsContent value="tasks"><TasksTab base={base} queryKey={key} entityType={booking.source === "kosha" ? "kosha_booking" : "service_order"} entityId={booking.id} /></TabsContent>
      <TabsContent value="documents"><DocumentsTab base={base} queryKey={key} entityType={booking.source === "kosha" ? "kosha_booking" : "service_order"} entityId={booking.id} /></TabsContent>
      <TabsContent value="activity"><ActivityTab base={base} queryKey={key} /></TabsContent>
    </Tabs></main><BookingSidebar booking={booking} data={overview.data} invoiceUrl={invoiceUrl} paymentUrl={paymentUrl} onTab={changeTab} department={department} responsibleTeam={responsibleTeam} /></div>

    <section className="ajn-op-bottom-timeline"><div className="ajn-op-section-head"><div><History /><span><small>الأثر الكامل للحجز</small><h2>التسلسل الزمني</h2></span></div><Button variant="ghost" size="sm" onClick={() => changeTab("activity")}>عرض كل النشاط <ChevronLeft /></Button></div><Timeline rows={overview.data?.recentActivity ?? []} /></section>

    <ConfirmAction open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)} title={confirm?.kind === "booking" ? `نقل الحجز إلى «${confirm?.label}»؟` : `نقل المستودع إلى «${confirm?.label}»؟`} description={confirm?.kind === "booking" ? "سيتحقق النظام من المخزون والأصول والمهام والحالة المالية، ثم يسجل المستخدم والوقت في السجل والتايملاين." : "قد يؤدي هذا الإجراء إلى صرف المخزون أو التحقق من إرجاع الأصول حسب المرحلة المختارة."} actionLabel={confirm?.label ?? "تأكيد"} danger={confirm?.stage === "cancelled"} busy={workflow.isPending} onConfirm={() => confirm && workflow.mutate({ kind: confirm.kind, stage: confirm.stage })} />
  </div>;
}

function BookingFinancialCards({ booking, onFinance }: { booking: BookingOperationsBooking; onFinance: () => void }) {
  const progress = booking.total > 0 ? Math.max(0, Math.min(100, Math.round((booking.paid / booking.total) * 100))) : 0;
  const status = booking.paymentStatus || (booking.remaining <= 0 ? "مدفوع بالكامل" : booking.paid > 0 ? "مدفوع جزئياً" : "غير مدفوع");
  const cards = [
    ["إجمالي الحجز", money(booking.total), ReceiptText, "neutral"],
    ["المدفوع", money(booking.paid), CheckCircle2, "positive"],
    ["المتبقي", money(booking.remaining), Banknote, booking.remaining > 0 ? "negative" : "positive"],
    ["تاريخ المناسبة", readableDate(booking.eventDate), CalendarDays, "neutral"],
  ] as const;
  return <section className="ajn-op-financial-cards" aria-label="ملخص الحجز المالي">{cards.map(([label, value, Icon, tone]) => <button type="button" key={label} className={`is-${tone}`} onClick={onFinance}><span><Icon /></span><div><small>{label}</small><strong>{value}</strong></div></button>)}<button type="button" className="ajn-op-payment-card" onClick={onFinance}><span><CircleDollarSign /></span><div><small>حالة الدفع</small><strong>{status}</strong><i><em style={{ width: `${progress}%` }} /></i></div><b>{progress}%</b></button></section>;
}

function TransportationCard({ mode, fee, busy, onSave }: { mode: "ajn" | "customer" | null; fee: number; busy: boolean; onSave: (mode: "ajn" | "customer" | null, fee: number) => void }) {
  const [m, setM] = useState<"ajn" | "customer" | null>(mode);
  const [f, setF] = useState(fee ? String(fee) : "");
  useEffect(() => { setM(mode); setF(fee ? String(fee) : ""); }, [mode, fee]);
  const btn = (active: boolean) => `rounded-lg border px-3 py-3 text-center text-sm transition-colors ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border/40 bg-background hover:border-primary/40"}`;
  return (
    <section id="ajn-transport-card" className="rounded-2xl border border-border/40 bg-card p-4" dir="rtl">
      <div className="mb-1 flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /><h2 className="text-sm font-bold text-foreground">خدمة النقل</h2></div>
      <p className="mb-3 text-xs text-muted-foreground">تُسجَّل تشغيلياً على الحجز ولا تغيّر إجماليه أو حالته المالية.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setM("ajn")} className={btn(m === "ajn")}>النقل بواسطة AJN</button>
        <button type="button" onClick={() => { setM("customer"); setF(""); }} className={btn(m === "customer")}>النقل من مسؤولية الزبون</button>
      </div>
      {m === "ajn" ? (
        <div className="mt-3 space-y-1">
          <label className="text-xs text-muted-foreground">أجرة النقل (للعلم)</label>
          <input inputMode="decimal" value={f} onChange={(e) => setF(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 د.ع" className="w-full rounded-md border border-border/40 bg-background px-3 py-2 text-sm sm:max-w-xs" />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !m} onClick={() => onSave(m, m === "ajn" ? Number(f) || 0 : 0)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} حفظ خدمة النقل</Button>
        {mode ? <Button size="sm" variant="ghost" disabled={busy} className="text-destructive" onClick={() => onSave(null, 0)}>إزالة</Button> : null}
      </div>
    </section>
  );
}

function OperationsSummary({ data, booking, onTab }: { data?: OverviewData; booking: BookingOperationsBooking; onTab: (tab: string) => void }) {
  const parts = data?.readinessParts ?? {};
  const warehouseReady = data?.warehouseStage === "completed" ? 100 : data?.warehouseStage === "reserved" ? 20 : data?.warehouseStage === "out" ? 80 : 60;
  const items = [
    { label: "جاهزية المنتجات", value: `${parts.products ?? 0}%`, tone: "green", icon: ShoppingBag, tab: "products" },
    { label: "جاهزية الأصول", value: `${parts.assets ?? 0}%`, tone: "purple", icon: PackageCheck, tab: "assets" },
    { label: "جاهزية المستودع", value: `${warehouseReady}%`, tone: "blue", icon: Warehouse, tab: "warehouse" },
    { label: "حالة الدفع", value: booking.paymentStatus || (booking.remaining <= 0 ? "مكتمل" : "جزئي"), tone: booking.remaining <= 0 ? "green" : "amber", icon: CircleDollarSign, tab: "finance" },
    { label: "الرصيد المتبقي", value: formatCurrency(booking.remaining), tone: booking.remaining > 0 ? "amber" : "green", icon: Banknote, tab: "finance" },
    { label: "التنبيهات", value: String(data?.counts.alerts ?? 0), tone: data?.counts.alerts ? "red" : "green", icon: TriangleAlert, tab: data?.alerts[0]?.tab || "overview" },
  ];
  return <section className="ajn-op-command-summary" aria-label="ملخص عمليات الحجز">{items.map(({ label, value, tone, icon: Icon, tab }) => <button key={label} type="button" className={`is-${tone}`} onClick={() => onTab(tab)}><span><Icon /></span><div><small>{label}</small><strong>{value}</strong></div><ChevronLeft /></button>)}</section>;
}

function BookingSidebar({ booking, data, invoiceUrl, paymentUrl, onTab, department, responsibleTeam }: { booking: BookingOperationsBooking; data?: OverviewData; invoiceUrl: string; paymentUrl: string; onTab: (tab: string) => void; department: string; responsibleTeam: string }) {
  return <aside className="ajn-op-sidebar" aria-label="ملخص الحجز الجانبي">
    <section><div className="ajn-op-side-title"><UserRound /><h2>معلومات العميل</h2></div><dl><div><dt>العميل</dt><dd>{booking.customerName}</dd></div><div><dt>رقم الهاتف</dt><dd dir="ltr">{booking.phone || "—"}</dd></div><div><dt>رقم الحجز</dt><dd>{booking.number}</dd></div></dl></section>
    <section><div className="ajn-op-side-title"><CalendarDays /><h2>معلومات الحجز</h2></div><dl><div><dt>التاريخ</dt><dd>{readableDate(booking.eventDate)}</dd></div><div><dt>الموقع</dt><dd>{booking.hall || "غير محدد"}</dd></div><div><dt>القسم</dt><dd>{department}</dd></div><div><dt>الفريق</dt><dd>{responsibleTeam}</dd></div></dl></section>
    <section className="ajn-op-side-finance"><div className="ajn-op-side-title"><CircleDollarSign /><h2>ملخص مالي سريع</h2></div><div><span>إجمالي الحجز</span><b>{money(booking.total)}</b></div><div><span>المدفوع</span><b className="is-positive">{money(booking.paid)}</b></div><div><span>المتبقي</span><b className={booking.remaining > 0 ? "is-negative" : "is-positive"}>{money(booking.remaining)}</b></div><button type="button" onClick={() => onTab("finance")}>فتح التفاصيل المالية <ChevronLeft /></button></section>
    <section><div className="ajn-op-side-title"><Sparkles /><h2>إجراءات سريعة</h2></div><div className="ajn-op-side-actions"><Button className="ajn-op-primary" onClick={() => onTab("finance")}><Banknote /> تسجيل دفعة</Button><Button variant="outline" asChild><Link href={invoiceUrl}><ReceiptText /> إصدار فاتورة</Link></Button><BookingThermalPrintAction booking={booking} className="w-full" /><Button variant="outline" onClick={() => onTab("tasks")}><ListChecks /> إنشاء مهمة</Button><Button variant="outline" onClick={() => onTab("documents")}><FileText /> المستندات</Button></div></section>
    <div className="ajn-op-side-readiness"><ReadinessRing value={data?.readiness ?? 0} /><div><small>الجاهزية الشاملة</small><b>{data?.readiness ?? 0}%</b><span>تُحسب من المخزون والأصول والمهام والمالية.</span></div></div>
  </aside>;
}

function nextStep(steps: ReadonlyArray<readonly [string, string]>, current?: string) {
  const index = Math.max(0, steps.findIndex(([value]) => value === current));
  return steps[index + 1] ?? null;
}

function WorkflowRail({ title, icon: Icon, steps, current, onStep }: { title: string; icon: typeof Warehouse; steps: ReadonlyArray<readonly [string, string]>; current: string; onStep: (stage: string, label: string) => void }) {
  const currentIndex = Math.max(0, steps.findIndex(([value]) => value === current));
  return <div className="ajn-op-flow"><div className="ajn-op-flow-title"><Icon /><strong>{title}</strong><OperationStatus value={current} /></div><div className="ajn-op-flow-steps">{steps.map(([value, label], index) => <button key={value} type="button" className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""} onClick={() => onStep(value, label)} aria-current={index === currentIndex ? "step" : undefined}><i>{index < currentIndex ? <Check /> : index + 1}</i><span>{label}</span></button>)}</div></div>;
}

function OverviewTab({ data, loading, error, booking, onTab }: { data?: OverviewData; loading: boolean; error?: unknown; booking: BookingOperationsBooking; onTab: (tab: string) => void }) {
  const parts = data?.readinessParts ?? {};
  const rows = [
    ["products", "جاهزية المنتجات", parts.products ?? 0, ShoppingBag],
    ["assets", "جاهزية الأصول", parts.assets ?? 0, PackageCheck],
    ["warehouse", "جاهزية المستودع", data?.warehouseStage === "completed" ? 100 : data?.warehouseStage === "reserved" ? 25 : 65, Warehouse],
    ["finance", "المتطلبات المالية", parts.finance ?? 0, CircleDollarSign],
    ["tasks", "تقدم المهام", parts.tasks ?? 0, ListChecks],
    ["documents", "مستندات الحجز", parts.documents ?? 0, FileText],
  ] as const;
  return <QueryState loading={loading} error={error}><div className="ajn-op-overview"><section className="ajn-op-readiness"><div className="ajn-op-section-head"><div><Gauge /><span><small>الحالة التشغيلية</small><h2>جاهزية الحجز</h2></span></div><ReadinessRing value={data?.readiness ?? 0} /></div><div className="ajn-op-readiness-rows">{rows.map(([tab, label, value, Icon]) => <button key={tab} onClick={() => onTab(tab)}><Icon /><span><strong>{label}</strong><i><em style={{ width: `${value}%` }} /></i></span><b>{value}%</b><ChevronLeft /></button>)}</div></section><section className="ajn-op-timeline-panel"><div className="ajn-op-section-head"><div><Clock3 /><span><small>آخر التحديثات</small><h2>السجل الزمني</h2></span></div><Button variant="ghost" size="sm" onClick={() => onTab("activity")}>عرض الكل</Button></div><Timeline rows={data?.recentActivity ?? []} /></section><section className="ajn-op-summary-strip"><div><span>إجمالي الحجز</span><b>{money(booking.total)}</b></div><div><span>المدفوع</span><b className="is-positive">{money(booking.paid)}</b></div><div><span>المتبقي</span><b className="is-negative">{money(booking.remaining)}</b></div><div><span>المهام</span><b>{data?.counts.completedTasks ?? 0} / {data?.counts.tasks ?? 0}</b></div><div><span>المستندات</span><b>{data?.counts.documents ?? 0}</b></div></section></div></QueryState>;
}

function ReadinessRing({ value }: { value: number }) {
  return <div className="ajn-op-ring" style={{ "--op-progress": `${Math.max(0, Math.min(100, value)) * 3.6}deg` } as React.CSSProperties}><span><strong>{value}%</strong><small>جاهز</small></span></div>;
}

function ProductsTab({ base, queryKey }: { base: string; queryKey: unknown[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ProductLine[] | null>(null);
  const products = useQuery<{ items: ProductLine[]; subtotal: number; stage: string }>({ queryKey: [...queryKey, "products"], queryFn: () => adminFetch(`${base}/products`) });
  const catalog = useQuery<{ data: CatalogItem[] }>({ queryKey: [...queryKey, "catalog", search], queryFn: () => adminFetch(`${base}/catalog?q=${encodeURIComponent(search)}`) });
  useEffect(() => { if (products.data && draft === null) setDraft(products.data.items); }, [products.data, draft]);
  const lines = draft ?? products.data?.items ?? [];
  const save = useMutation({ mutationFn: () => adminFetch(`${base}/products`, { method: "PUT", body: JSON.stringify({ items: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, warehouseId: line.warehouseId ?? null, note: line.note ?? null })) }) }), onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast({ title: "تم حجز منتجات الحجز" }); }, onError: (error: any) => toast({ title: "تعذر حجز المنتجات", description: error?.message, variant: "destructive" }) });
  const action = useMutation({ mutationFn: (name: string) => adminFetch(`${base}/products`, { method: "POST", body: JSON.stringify({ action: name }) }), onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast({ title: "تم تحديث حركة المنتجات" }); }, onError: (error: any) => toast({ title: "تعذر تحديث المنتجات", description: error?.message, variant: "destructive" }) });
  const add = (item: CatalogItem) => {
    if (lines.some((line) => line.productId === item.id && line.variantId == null)) return;
    setDraft([...lines, { id: -Date.now(), productId: item.id, variantId: null, productName: item.name, variantLabel: null, color: null, quantity: 1, unitPrice: item.price, discount: 0, total: item.price, status: "draft", available: item.available, reserved: item.reserved, barcode: item.barcode }]);
  };
  const update = (index: number, patch: Partial<ProductLine>) => setDraft(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  return <div className="ajn-op-tab-panel ajn-op-products-panel">
    <div className="ajn-op-section-head"><div><ShoppingBag /><span><small>المتجر والمخزون</small><h2>منتجات الحجز</h2></span></div><div className="ajn-op-actions"><OperationStatus value={products.data?.stage ?? "draft"} /><Button className="ajn-op-import" onClick={() => document.getElementById("booking-product-search")?.focus()}><ShoppingBag /> استيراد من المتجر</Button><Button variant="outline" onClick={() => action.mutate("release")} disabled={action.isPending || !lines.length}><RotateCcw /> تحرير الحجز</Button><Button className="ajn-op-primary" onClick={() => save.mutate()} disabled={save.isPending || !lines.length}>{save.isPending ? <Loader2 className="animate-spin" /> : <Check />} حفظ وحجز المخزون</Button></div></div>
    <div className="ajn-op-picker"><Search /><Input id="booking-product-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المنتج أو الباركود" /><div className="ajn-op-picker-results">{catalog.data?.data?.slice(0, 8).map((item) => <button key={item.id} type="button" onClick={() => add(item)} disabled={item.available <= 0}><span><b>{item.name}</b><small>{item.barcode || item.category || "منتج متجر"}</small></span><span><strong>{item.available}</strong><small>متاح</small></span><Plus /></button>)}</div></div>
    <QueryState loading={products.isLoading} error={products.error} empty={!lines.length}><div className="ajn-op-table-wrap"><table className="ajn-op-table ajn-op-products-table"><thead><tr><th>المنتج</th><th>الفئة</th><th>المتغير</th><th>اللون</th><th>المتاح</th><th>المحجوز</th><th>المطلوب</th><th>المجهز</th><th>المسلّم</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th><th>الحالة</th><th aria-label="إزالة" /></tr></thead><tbody>{lines.map((line, index) => { const item = catalog.data?.data.find((entry) => entry.id === line.productId); const prepared = line.status === "consumed" ? line.quantity : 0; return <tr key={`${line.productId}:${line.variantId ?? 0}:${line.id}`}><td><b>{line.productName}</b><small>{line.barcode}</small></td><td>{item?.category || "متجر AJN"}</td><td><select value={line.variantId ?? ""} onChange={(event) => { const variantId = event.target.value ? Number(event.target.value) : null; const variant = item?.variants.find((entry) => entry.id === variantId); update(index, { variantId, variantLabel: variant ? [variant.color, variant.size].filter(Boolean).join(" / ") : null, color: variant?.color ?? null, available: variant?.available ?? item?.available ?? line.available }); }}><option value="">بدون متغير</option>{item?.variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.color, variant.size].filter(Boolean).join(" / ")} · متاح {variant.available}</option>)}</select></td><td>{line.color || "—"}</td><td className={line.quantity > line.available ? "is-danger" : ""}>{line.available}</td><td>{line.reserved}</td><td><Input type="number" min={1} value={line.quantity} onChange={(event) => update(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} /></td><td>{prepared}</td><td>{prepared}</td><td><Input type="number" min={0} value={line.unitPrice} onChange={(event) => update(index, { unitPrice: Math.max(0, Number(event.target.value) || 0) })} /></td><td><Input type="number" min={0} value={line.discount} onChange={(event) => update(index, { discount: Math.max(0, Number(event.target.value) || 0) })} /></td><td>{money(Math.max(0, line.unitPrice * line.quantity - line.discount))}</td><td><OperationStatus value={line.status} /></td><td><Button variant="ghost" size="icon" aria-label={`إزالة ${line.productName}`} onClick={() => setDraft(lines.filter((_, lineIndex) => lineIndex !== index))}>×</Button></td></tr>; })}</tbody><tfoot><tr><td colSpan={11}>إجمالي منتجات الحجز</td><td>{money(lines.reduce((sum, line) => sum + Math.max(0, line.unitPrice * line.quantity - line.discount), 0))}</td><td colSpan={2} /></tr></tfoot></table></div></QueryState>
  </div>;
}

type CustodyPreviewAsset = { groupId: number; groupName: string; employeeId: number; employeeName: string; productId: number; name: string; assetCode: string; condition: string; available: boolean; reason?: string | null; conflictBooking?: string | null };

function FixedCustodyPanel({ base, queryKey }: { base: string; queryKey: unknown[] }) {
  const qc = useQueryClient(); const { toast } = useToast(); const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const staff = useQuery<Array<{ id: number; fullName?: string; username?: string }>>({ queryKey: ["admin", "staff"], queryFn: () => adminFetch("/admin/staff"), staleTime: 300000 });
  const preview = useQuery<{ employeeIds: number[]; assets: CustodyPreviewAsset[]; reservations: any[] }>({ queryKey: [...queryKey, "fixed-custody", employeeIds.join(",")], queryFn: () => adminFetch(`${base}/custody${employeeIds.length ? `?employeeIds=${employeeIds.join(",")}` : ""}`) });
  useEffect(() => { if (!employeeIds.length && preview.data?.employeeIds?.length) setEmployeeIds(preview.data.employeeIds); }, [employeeIds.length, preview.data?.employeeIds]);
  const action = useMutation({ mutationFn: (payload: any) => adminFetch(`${base}/custody`, { method: "POST", body: JSON.stringify(payload) }), onSuccess: (_, payload) => { qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: [...queryKey, "fixed-custody"] }); toast({ title: payload.action === "reserve" ? "تم حجز المعدات المتاحة للعهدة" : "تم تحديث موظفي العهدة" }); }, onError: (error: any) => toast({ title: "تعذر تنفيذ عملية العهدة", description: error?.message, variant: "destructive" }) });
  const grouped = useMemo(() => { const map = new Map<string, CustodyPreviewAsset[]>(); for (const a of preview.data?.assets ?? []) { const list = map.get(a.employeeName) ?? []; list.push(a); map.set(a.employeeName, list); } return [...map.entries()]; }, [preview.data]);
  const toggle = (id: number) => setEmployeeIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  return <section className="mb-4 rounded-xl border border-primary/25 bg-primary/[0.035] p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2 font-bold"><UserRound className="h-4 w-4 text-primary" /> معدات عهدة الموظفين</div><p className="mt-1 text-xs text-muted-foreground">لا يُحجز أي أصل قبل حفظ الحجز أدناه.</p></div><Badge variant="outline">{preview.data?.assets.length ?? 0} أصل</Badge></div><div className="mb-3 flex flex-wrap gap-2">{staff.data?.map((s) => <button key={s.id} type="button" onClick={() => toggle(s.id)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${employeeIds.includes(s.id) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>{s.fullName || s.username}</button>)}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ action: "set-employees", employeeIds })}>حفظ الموظفين ومعاينة المعدات</Button><Button size="sm" disabled={action.isPending || !preview.data?.assets.length} onClick={() => action.mutate({ action: "reserve", employeeIds })}><PackageCheck className="h-4 w-4" /> حفظ وحجز المعدات المتاحة</Button>{preview.data?.reservations?.length ? <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ action: "release" })}>تحرير الحجز</Button> : null}</div>{preview.isLoading ? <Skeleton className="mt-3 h-16" /> : grouped.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{grouped.map(([employee, assets]) => <div key={employee} className="rounded-lg border border-border/40 bg-background/60 p-3"><p className="mb-2 text-sm font-bold">{employee}</p>{assets.map((a) => <div key={a.productId} className="flex items-center justify-between gap-2 border-t border-border/25 py-2 text-xs"><span><b className="text-sm">{a.name}</b><small className="mr-2 font-mono text-muted-foreground">{a.assetCode}</small></span><span className={a.available ? "text-emerald-600" : "text-destructive"}>{a.available ? "متاح" : a.conflictBooking || a.reason || "المعدة غير متاحة"}</span></div>)}</div>)}</div> : employeeIds.length ? <p className="mt-3 text-sm text-muted-foreground">لا توجد مجموعة عهدة نشطة للموظفين المحددين.</p> : null}</section>;
}

function AssetsTab({ base, queryKey }: { base: string; queryKey: unknown[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [returning, setReturning] = useState<AssetRow | null>(null);
  const [returnForm, setReturnForm] = useState({ problem: "none", description: "", estimatedCost: "", usageHours: "", managerApproval: false });
  const assets = useQuery<{ assets: AssetRow[] }>({ queryKey: [...queryKey, "assets"], queryFn: () => adminFetch(`${base}/assets`) });
  const catalog = useQuery<{ data: CatalogItem[] }>({ queryKey: [...queryKey, "asset-catalog", search], queryFn: () => adminFetch(`${base}/catalog?q=${encodeURIComponent(search)}`) });
  const mutation = useMutation({ mutationFn: (input: Record<string, any>) => adminFetch(`${base}/assets`, { method: "POST", body: JSON.stringify({ ...input, confirmation: true }) }), onSuccess: () => { setReturning(null); queryClient.invalidateQueries({ queryKey }); toast({ title: "تم تحديث الأصل" }); }, onError: (error: any) => toast({ title: "تعذر تحديث الأصل", description: error?.message, variant: "destructive" }) });
  const act = (row: AssetRow, mode: string) => mutation.mutate({ mode, productId: row.productId, quantity: row.quantity });
  return <div className="ajn-op-tab-panel ajn-op-assets-panel">
    <div className="ajn-op-section-head"><div><PackageCheck /><span><small>دورة حياة الأصل</small><h2>أصول الحجز</h2></span></div><div className="ajn-op-actions"><Badge variant="outline">{assets.data?.assets.length ?? 0} أصل</Badge><Button className="ajn-op-import is-asset" onClick={() => document.getElementById("booking-asset-search")?.focus()}><PackageCheck /> إضافة أصل</Button><Button variant="outline" asChild><Link href="/admin/assets">فتح إدارة الأصول</Link></Button></div></div>
    <FixedCustodyPanel base={base} queryKey={queryKey} />
    <div className="ajn-op-picker"><Search /><Input id="booking-asset-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن أصل بالاسم أو الباركود" /><div className="ajn-op-picker-results">{catalog.data?.data.filter((item) => item.isAsset).slice(0, 8).map((item) => <button key={item.id} type="button" onClick={() => mutation.mutate({ mode: "link", productId: item.id, quantity: 1 })} disabled={mutation.isPending || ["maintenance", "lost", "retired", "locked", "sold", "disposed"].includes(String(item.profileStatus))}><span><b>{item.name}</b><small>{item.barcode || "أصل تشغيلي"}</small></span><span><strong>{item.available}</strong><small>متاح</small></span><Plus /></button>)}</div></div>
    <QueryState loading={assets.isLoading} error={assets.error} empty={!assets.data?.assets.length}><div className="ajn-op-table-wrap"><table className="ajn-op-table ajn-op-assets-table"><thead><tr><th>الأصل</th><th>QR</th><th>الموظف المسؤول</th><th>وقت التسليم</th><th>وقت الإرجاع</th><th>المستودع</th><th>الكمية</th><th>المتاح</th><th>المحجوز</th><th>الخارج</th><th>المرتجع</th><th>الصحة</th><th>القيمة الحالية</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{assets.data?.assets.map((row) => <tr key={row.productId}><td><b>{row.name}</b><small>{row.assetCode}{row.serialNumber ? ` · ${row.serialNumber}` : ""}</small></td><td><span className="ajn-op-qr-cell"><QrCode /> {row.qrToken ? "مسجل" : "—"}</span></td><td>{row.responsibleStaffName ? <b>عهدة {row.responsibleStaffName}</b> : "—"}</td><td className="whitespace-nowrap">{row.checkoutAt ? readableDate(row.checkoutAt) : "—"}</td><td className="whitespace-nowrap">{row.returnedAt ? readableDate(row.returnedAt) : "—"}</td><td>{row.warehouse || row.location || "المستودع الرئيسي"}</td><td>{row.quantity}</td><td>{row.available}</td><td>{row.reserved}</td><td>{row.out}</td><td>{row.returned}</td><td><span className={row.healthScore < 60 ? "ajn-op-health is-low" : "ajn-op-health"}>{row.healthScore}%</span></td><td>{money(row.currentValue)}</td><td><OperationStatus value={row.stage} /></td><td><div className="ajn-op-table-actions">{row.stage === "linked" && <Button size="sm" onClick={() => act(row, "reserve")}>حجز</Button>}{row.stage === "reserved" && <Button size="sm" onClick={() => act(row, "pick")}><Barcode /> تجهيز</Button>}{row.stage === "picked" && <Button size="sm" onClick={() => act(row, "checkout")}><QrCode /> إخراج</Button>}{row.stage === "out" && <Button size="sm" onClick={() => { setReturning(row); setReturnForm({ problem: "none", description: "", estimatedCost: "", usageHours: "", managerApproval: false }); }}><RotateCcw /> إرجاع</Button>}{row.stage === "returned" && <Button size="sm" onClick={() => mutation.mutate({ mode: "inspect", productId: row.productId, quantity: row.quantity, usageHours: Number(returnForm.usageHours || 0), problem: row.problem || "none" })}><ClipboardCheck /> فحص</Button>}<DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`المزيد للأصل ${row.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/admin/products?focus=${row.productId}`}><PackageCheck /> جواز الأصل</Link></DropdownMenuItem>{!row.out && <DropdownMenuItem onSelect={() => act(row, "unlink")} className="text-destructive"><RotateCcw /> إزالة من الحجز</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div></td></tr>)}</tbody></table></div></QueryState>
    {returning && <section className="ajn-op-return-panel"><div><RotateCcw /><span><small>فحص الإرجاع</small><h3>{returning.name}</h3></span><Button variant="ghost" onClick={() => setReturning(null)}>إغلاق</Button></div><div className="ajn-op-return-grid"><div><Label htmlFor="asset-problem">هل يوجد تلف أو نقص؟</Label><select id="asset-problem" value={returnForm.problem} onChange={(event) => setReturnForm({ ...returnForm, problem: event.target.value })}><option value="none">لا، الأصل سليم</option><option value="damaged">نعم، يوجد تلف</option><option value="missing">نعم، يوجد نقص / فقدان</option></select></div><div><Label htmlFor="asset-hours">ساعات الاستخدام</Label><Input id="asset-hours" type="number" min={0} value={returnForm.usageHours} onChange={(event) => setReturnForm({ ...returnForm, usageHours: event.target.value })} /></div>{returnForm.problem !== "none" && <><div className="sm:col-span-2"><Label htmlFor="asset-description">وصف الحالة *</Label><Textarea id="asset-description" value={returnForm.description} onChange={(event) => setReturnForm({ ...returnForm, description: event.target.value })} placeholder="اكتب تفاصيل التلف أو الجزء المفقود" /></div><div><Label htmlFor="asset-cost">التكلفة التقديرية</Label><Input id="asset-cost" type="number" min={0} value={returnForm.estimatedCost} onChange={(event) => setReturnForm({ ...returnForm, estimatedCost: event.target.value })} /></div>{returnForm.problem === "missing" && <label className="ajn-op-check"><input type="checkbox" checked={returnForm.managerApproval} onChange={(event) => setReturnForm({ ...returnForm, managerApproval: event.target.checked })} /> اعتماد المدير على تسجيل النقص</label>}</>}</div><Button className="ajn-op-primary" disabled={mutation.isPending || (returnForm.problem !== "none" && !returnForm.description.trim())} onClick={() => mutation.mutate({ mode: "return", productId: returning.productId, quantity: returning.quantity, problem: returnForm.problem, description: returnForm.description, estimatedCost: Number(returnForm.estimatedCost || 0), managerApproval: returnForm.managerApproval })}>تأكيد الإرجاع وإرسال الأصل للفحص</Button></section>}
  </div>;
}

function WarehouseTab({ base, queryKey, overview, onStage }: { base: string; queryKey: unknown[]; overview?: OverviewData; onStage: (stage: string, label: string) => void }) {
  const assets = useQuery<{ assets: AssetRow[] }>({ queryKey: [...queryKey, "warehouse-assets"], queryFn: () => adminFetch(`${base}/assets`) });
  const products = useQuery<{ items: ProductLine[] }>({ queryKey: [...queryKey, "warehouse-products"], queryFn: () => adminFetch(`${base}/products`) });
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><Warehouse /><span><small>التجهيز والخروج والإرجاع</small><h2>عمليات المستودع</h2></span></div><Button variant="outline" asChild><Link href="/admin/warehouse"><Warehouse /> فتح المستودع الرئيسي</Link></Button></div><WorkflowRail title="حركة الحجز داخل المستودع" icon={Warehouse} steps={WAREHOUSE_STEPS} current={overview?.warehouseStage ?? "reserved"} onStep={onStage} /><div className="ajn-op-warehouse-columns"><section><h3><ShoppingBag /> المنتجات المحجوزة <Badge variant="outline">{products.data?.items.length ?? 0}</Badge></h3>{products.data?.items.map((item) => <div key={item.id}><span><b>{item.productName}</b><small>{item.variantLabel || item.barcode || "بدون متغير"}</small></span><strong>{item.quantity}</strong><OperationStatus value={item.status} /></div>)}</section><section><h3><PackageCheck /> الأصول والمعدات <Badge variant="outline">{assets.data?.assets.length ?? 0}</Badge></h3>{assets.data?.assets.map((item) => <div key={item.productId}><span><b>{item.name}</b><small>{item.assetCode}</small></span><strong>{item.quantity}</strong><OperationStatus value={item.stage} /></div>)}</section></div><section className="ajn-op-scan"><QrCode /><div><h3>المسح والتوقيع</h3><p>استخدم شاشة حركة الأصل لمسح QR أو الباركود، وسيُحفظ الموظف والتاريخ والوقت داخل سجل الحجز.</p></div><Button variant="outline" asChild><Link href="/admin/asset-movements">فتح شاشة المسح</Link></Button></section><div className="ajn-op-print-actions"><Button variant="outline" onClick={() => window.print()}><Printer /> قائمة التجهيز</Button><Button variant="outline" onClick={() => window.print()}><Printer /> قائمة التحميل</Button><Button variant="outline" onClick={() => window.print()}><Printer /> قائمة الإرجاع</Button><Button variant="outline" onClick={() => window.print()}><Printer /> قائمة الفحص</Button></div></div>;
}

function DepreciationTab({ base, queryKey }: { base: string; queryKey: unknown[] }) {
  const query = useQuery<{ assets: AssetRow[] }>({ queryKey: [...queryKey, "depreciation"], queryFn: () => adminFetch(`${base}/depreciation`) });
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><ArchiveRestore /><span><small>الأثر التشغيلي فقط</small><h2>إهلاك واستخدام الأصول</h2></span></div><div className="ajn-op-safe-note"><ShieldAlert /> الحجز لا ينشر قيد إهلاك تلقائياً</div></div><QueryState loading={query.isLoading} error={query.error} empty={!query.data?.assets.length}><div className="ajn-op-table-wrap"><table className="ajn-op-table"><thead><tr><th>الأصل</th><th>طريقة الإهلاك</th><th>قيمة الشراء</th><th>القيمة الحالية</th><th>الإهلاك</th><th>الاستخدامات</th><th>الساعات</th><th>الصحة</th><th>آخر عميل</th><th>الصيانة</th></tr></thead><tbody>{query.data?.assets.map((row) => <tr key={row.productId}><td><b>{row.name}</b><small>{row.assetCode}</small></td><td>{row.depreciationMethod}{row.automaticDepreciation ? <Badge>تلقائي</Badge> : <Badge variant="outline">يدوي</Badge>}</td><td>{money(row.purchaseValue)}</td><td>{money(row.currentValue)}</td><td>{money(row.depreciationAmount)}</td><td>{row.usageCount}</td><td>{row.usageHours}</td><td><span className={row.healthScore < 60 ? "is-danger" : "is-positive"}>{row.healthScore}%</span></td><td>{row.lastCustomer || "—"}</td><td>{row.maintenanceRequired ? <OperationStatus value="maintenance" label="مطلوبة" /> : readableDate(row.nextMaintenanceDate)}</td></tr>)}</tbody></table></div></QueryState></div>;
}

function InventoryTab({ base, queryKey }: { base: string; queryKey: unknown[] }) {
  const query = useQuery<{ data: any[] }>({ queryKey: [...queryKey, "inventory"], queryFn: () => adminFetch(`${base}/inventory`) });
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><Boxes /><span><small>سجل المخزون الأصلي</small><h2>حركات المخزون</h2></span></div><Button variant="outline" asChild><Link href="/admin/inventory">فتح المخزون</Link></Button></div><QueryState loading={query.isLoading} error={query.error} empty={!query.data?.data.length}><div className="ajn-op-table-wrap"><table className="ajn-op-table"><thead><tr><th>رقم الحركة</th><th>التاريخ والوقت</th><th>المنتج</th><th>الكمية</th><th>الاتجاه</th><th>السبب</th><th>الموظف</th></tr></thead><tbody>{query.data?.data.map((row) => <tr key={row.id}><td>#{row.id}</td><td>{readableDate(row.createdAt)}</td><td>#{row.productId ?? "—"}</td><td className={Number(row.quantityChange) < 0 ? "is-danger" : "is-positive"}>{Number(row.quantityChange) > 0 ? "+" : ""}{row.quantityChange}</td><td>{Number(row.quantityChange) < 0 ? "صرف" : "إرجاع"}</td><td>{row.reason}</td><td>{row.createdByName || "النظام"}</td></tr>)}</tbody></table></div></QueryState></div>;
}

// Portal/department labels for the preparation sheet — mirror booking-center's
// SERVICE_META keys so each booking service maps to a readable Arabic section.
const PREP_DEPARTMENT_LABELS: Record<string, string> = {
  kosha: "قسم الكوشة",
  photography: "قسم التصوير",
  sound: "قسم الصوتيات",
  flowers: "قسم الورد",
  gifts: "قسم الهدايا والتوزيعات",
  graduation: "قسم التخرج",
  led: "قسم شاشات LED",
  transportation: "قسم النقل",
  decorations: "قسم الديكورات",
};
const PREP_SERVICE_STATUS_LABELS: Record<string, string> = {
  waiting: "بالانتظار",
  pending: "بالانتظار",
  in_progress: "قيد التنفيذ",
  processing: "قيد التجهيز",
  preparing: "قيد التجهيز",
  ready: "جاهز",
  done: "منجز",
  completed: "مكتمل",
  delivered: "مُسلّم",
  cancelled: "ملغي",
};
const prepDepartmentLabel = (key: string) => PREP_DEPARTMENT_LABELS[key] ?? key;

// Consolidated, printable preparation (picking) sheet: every product/material +
// asset the crew must gather for the booking, with quantities and check boxes.
// When `department` is set, the header + service summary are scoped to that
// portal (e.g. الكوشة / المصوّرين); the materials and assets tables stay complete
// so the crew always sees the full pick list for the booking.
function buildPreparationListHtml(
  booking: BookingOperationsBooking,
  products: any[],
  assets: any[],
  department: { key: string; label: string } | null = null,
): string {
  const esc = (value: unknown) =>
    String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
  const iqd = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? `${Math.round(n).toLocaleString("en-US")} د.ع` : "—";
  };
  const services = Array.isArray(booking.services) ? booking.services : [];
  const summaryRows = (department ? services.filter((s) => s.type === department.key) : services)
    .map((s) => {
      const label = prepDepartmentLabel(s.type);
      const status = PREP_SERVICE_STATUS_LABELS[String(s.status ?? "")] ?? s.status ?? "—";
      return `<tr><td>${esc(label)}</td><td>${esc(status)}</td><td class="num">${esc(iqd(s.amount))}</td><td>${esc(s.notes ?? "")}</td></tr>`;
    })
    .join("");
  const summarySection = `<h2>ملخص الخدمة${department ? ` — ${esc(department.label)}` : ""}</h2><table><thead><tr><th>القسم / الخدمة</th><th>الحالة</th><th class="num">المبلغ</th><th>ملاحظات</th></tr></thead><tbody>${summaryRows || `<tr><td colspan="4" class="empty">${department ? "لا توجد تفاصيل خدمة مسجّلة لهذا القسم" : "لا توجد خدمات مسجّلة"}</td></tr>`}</tbody></table>`;
  const productRows = products
    .filter((item) => item?.status !== "released")
    .map((item) => {
      const variant = item.variantLabel || item.color || "";
      return `<tr><td class="chk">☐</td><td>${esc(item.productName)}${variant ? ` <small>(${esc(variant)})</small>` : ""}</td><td class="num">${esc(item.quantity)}</td><td class="num">${item.status === "consumed" ? esc(item.quantity) : ""}</td><td>${esc(item.barcode ?? "")}</td><td></td></tr>`;
    })
    .join("");
  const assetRows = assets
    .map(
      (item) =>
        `<tr><td class="chk">☐</td><td>${esc(item.name)}${item.serialNumber ? ` <small>(${esc(item.serialNumber)})</small>` : ""}</td><td class="num">${esc(item.quantity ?? 1)}</td><td>${esc(item.assetCode ?? "")}</td><td class="num">${item.qrToken ? "QR" : "—"}</td><td></td></tr>`,
    )
    .join("");
  const empty = (cols: number, label: string) => `<tr><td colspan="${cols}" class="empty">${label}</td></tr>`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>قائمة تجهيز ${department ? `${esc(department.label)} · ` : ""}${esc(booking.number)}</title><style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Cairo, Tahoma, Arial, sans-serif; color: #000; direction: rtl; font-size: 12px; margin: 0; }
    h1 { font-size: 20px; margin: 0; }
    .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
    .meta { font-size: 12px; line-height: 1.9; }
    .meta b { font-weight: 700; }
    h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #000; padding-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 5px 6px; text-align: right; vertical-align: top; }
    th { background: #f2f2f2; font-weight: 800; }
    .chk { width: 30px; text-align: center; font-size: 15px; }
    .num { text-align: center; width: 74px; }
    .empty { text-align: center; padding: 12px; }
    .sign { display: flex; justify-content: space-between; gap: 30px; margin-top: 34px; }
    .sign div { border-top: 1px dashed #000; padding-top: 6px; width: 30%; text-align: center; }
    .dept-badge { display: inline-block; margin-top: 6px; border: 1.5px solid #000; border-radius: 6px; padding: 3px 12px; font-weight: 800; font-size: 13px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
    <div class="head">
      <div><h1>AJN — قائمة التجهيز</h1><div class="meta">مجموعة علي جان نهاد · لتنظيم المناسبات</div><div class="dept-badge">${department ? esc(department.label) : "كل الأقسام"}</div></div>
      <div class="meta">
        <div><b>رقم الحجز:</b> ${esc(booking.number)}</div>
        <div><b>العميل:</b> ${esc(booking.customerName)}</div>
        <div><b>الهاتف:</b> ${esc(booking.phone)}</div>
        <div><b>تاريخ المناسبة:</b> ${esc(booking.eventDate)} ${esc(booking.eventTime ?? "")}</div>
        <div><b>الموقع:</b> ${esc(booking.hall ?? "")}</div>
      </div>
    </div>
    ${summarySection}
    <h2>المنتجات والمواد</h2>
    <table><thead><tr><th class="chk">✓</th><th>المادة / المنتج</th><th class="num">المطلوب</th><th class="num">المُجهّز</th><th>الباركود</th><th>ملاحظة</th></tr></thead><tbody>${productRows || empty(6, "لا توجد منتجات أو مواد مرتبطة بالحجز")}</tbody></table>
    <h2>الأصول والمعدات</h2>
    <table><thead><tr><th class="chk">✓</th><th>الأصل</th><th class="num">الكمية</th><th>الرقم</th><th class="num">QR</th><th>ملاحظة</th></tr></thead><tbody>${assetRows || empty(6, "لا توجد أصول أو معدات مرتبطة بالحجز")}</tbody></table>
    <div class="sign"><div>جهّز بواسطة</div><div>التوقيع</div><div>التاريخ</div></div>
    <script>window.onload=function(){setTimeout(function(){window.print();},200);};</script>
  </body></html>`;
}

function PreparationListAction({ base, booking }: { base: string; booking: BookingOperationsBooking }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  // The portals/departments actually on this booking (deduplicated), each mapped
  // to a readable Arabic label. "كل الأقسام" always prints the full sheet.
  const departments = Array.from(
    new Map(
      (Array.isArray(booking.services) ? booking.services : [])
        .filter((service) => service?.type)
        .map((service) => [service.type, { key: service.type, label: prepDepartmentLabel(service.type) }]),
    ).values(),
  );
  const printFor = async (department: { key: string; label: string } | null) => {
    // Open the print window synchronously (inside the click gesture) so pop-up
    // blockers don't stop it, then fill it once the data loads.
    const popup = window.open("", "_blank", "width=900,height=800");
    if (!popup) {
      toast({ title: "تعذر فتح نافذة الطباعة", description: "اسمح بالنوافذ المنبثقة ثم حاول مجدداً.", variant: "destructive" });
      return;
    }
    popup.document.write(
      `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>قائمة التجهيز</title></head><body style="font-family:Cairo,Tahoma,Arial,sans-serif;direction:rtl;padding:24px;color:#111">جارٍ تحضير قائمة التجهيز…</body></html>`,
    );
    setLoading(true);
    try {
      const [productsRes, assetsRes] = await Promise.all([
        adminFetch<any>(`${base}/products`).catch(() => null),
        adminFetch<any>(`${base}/assets`).catch(() => null),
      ]);
      const products: any[] = productsRes?.items ?? [];
      const assets: any[] = assetsRes?.assets ?? [];
      popup.document.open();
      popup.document.write(buildPreparationListHtml(booking, products, assets, department));
      popup.document.close();
    } catch (error: any) {
      popup.close();
      toast({ title: "تعذر إنشاء قائمة التجهيز", description: error?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={loading}>
          <ClipboardCheck /> {loading ? "جارٍ التجهيز…" : "قائمة التجهيز"} <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => printFor(null)}><ClipboardCheck /> كل الأقسام</DropdownMenuItem>
        {departments.length > 0 ? <DropdownMenuSeparator /> : null}
        {departments.map((department) => (
          <DropdownMenuItem key={department.key} onSelect={() => printFor(department)}>
            {department.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BookingDiscountControl({ base, currentDiscount, onChanged }: { base: string; currentDiscount: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(currentDiscount || ""));
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () =>
      adminFetch(`${base}/discount`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount || 0), reason: reason.trim() || null }),
      }),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      onChanged();
      toast({ title: "تم تحديث خصم الحجز" });
    },
    onError: (error: any) =>
      toast({ title: "تعذر تحديث الخصم", description: error?.message, variant: "destructive" }),
  });
  return (
    <div className="mt-3 rounded-xl border border-border/30 bg-background/40 p-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Percent className="h-4 w-4 text-primary" /> خصم الحجز
          {currentDiscount > 0 ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{money(currentDiscount)}</span>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => { setAmount(String(currentDiscount || "")); setOpen((value) => !value); }}>
          {currentDiscount > 0 ? "تعديل الخصم" : "إضافة خصم"}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
          <label className="grid gap-1 text-xs"><span className="text-muted-foreground">مبلغ الخصم</span><Input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="grid gap-1 text-xs"><span className="text-muted-foreground">السبب (اختياري)</span><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب الخصم" /></label>
          <div className="flex items-end"><Button size="sm" disabled={save.isPending || Number(amount || 0) < 0} onClick={() => save.mutate()}>{save.isPending ? "جارٍ الحفظ…" : "حفظ الخصم"}</Button></div>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">الخصم يقلّل الإجمالي المستحق للحجز ويعيد حساب المتبقي؛ لا يحرّك أي مبلغ من الصندوق الرئيسي.</p>
    </div>
  );
}

// ── Booking Damage & Penalty UI ───────────────────────────────────────────────
const PENALTY_DAMAGE_OPTIONS: Array<[string, string]> = [
  ["break", "كسر"],
  ["loss", "فقدان"],
  ["damage", "تلف"],
  ["shortage", "نقص"],
  ["not_returned", "عدم إرجاع"],
  ["other", "ضرر آخر"],
];
const PENALTY_CONDITION_OPTIONS: Array<[string, string]> = [
  ["broken", "مكسور"],
  ["damaged", "تالف"],
  ["lost", "مفقود"],
  ["shortage", "ناقص"],
  ["unusable", "غير صالح للاستخدام"],
];
const PENALTY_METHOD_OPTIONS: Array<[string, string]> = [
  ["cash", "نقداً"],
  ["transfer", "تحويل"],
  ["card", "بطاقة"],
];
const PENALTY_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_review: { label: "قيد المراجعة", color: "#92400e", bg: "#fef3c7" },
  unpaid: { label: "غير مدفوعة", color: "#991b1b", bg: "#fee2e2" },
  partly_paid: { label: "مدفوعة جزئياً", color: "#92400e", bg: "#fef3c7" },
  paid: { label: "مدفوعة بالكامل", color: "#065f46", bg: "#d1fae5" },
  cancelled: { label: "ملغاة", color: "#6b7280", bg: "#f3f4f6" },
  none: { label: "لا توجد غرامات", color: "#6b7280", bg: "#f3f4f6" },
};
const penaltyDamageLabelClient = (value: string) => PENALTY_DAMAGE_OPTIONS.find(([key]) => key === value)?.[1] ?? value;
function PenaltyBadge({ status }: { status: string }) {
  const meta = PENALTY_STATUS_META[status] ?? PENALTY_STATUS_META.none;
  return <span style={{ display: "inline-block", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700, color: meta.color, background: meta.bg }}>{meta.label}</span>;
}

function BookingPenaltiesSection({ base, booking, queryKey, onChanged }: { base: string; booking: BookingOperationsBooking; queryKey: unknown[]; onChanged: () => void }) {
  const query = useQuery<any>({ queryKey: [...queryKey, "penalties"], queryFn: () => adminFetch(`${base}/penalties`) });
  const data = query.data;
  const penalties: any[] = data?.penalties ?? [];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [paying, setPaying] = useState<any | null>(null);
  const [details, setDetails] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const refresh = () => { void query.refetch(); onChanged(); };
  const bookingRemaining = Number(booking.remaining ?? 0);
  const penaltyRemaining = Number(data?.remaining ?? 0);
  return (
    <section className="ajn-op-penalties mt-4">
      <div className="ajn-op-section-head">
        <div><TriangleAlert /><span><small>أضرار وتلفيات — منفصلة تماماً عن إجمالي الحجز</small><h2>الغرامات والتلفيات</h2></span></div>
        <div className="ajn-op-actions"><Button className="ajn-op-primary" onClick={() => setAdding(true)}><Plus /> إضافة غرامة</Button></div>
      </div>
      <QueryState loading={query.isLoading} error={query.error}>
        <section className="ajn-op-finance-summary">
          <div><span>إجمالي الغرامات</span><b>{formatCurrency(Number(data?.penaltyTotal ?? 0))}</b></div>
          <div><span>المدفوع</span><b>{formatCurrency(Number(data?.paid ?? 0))}</b></div>
          <div><span>المتبقي</span><b>{formatCurrency(penaltyRemaining)}</b></div>
          <div><span>الحالة</span><b><PenaltyBadge status={data?.status ?? "none"} /></b></div>
        </section>
        <section className="ajn-op-finance-summary" style={{ marginTop: 8 }}>
          <div><span>رصيد الحجز</span><b>{formatCurrency(bookingRemaining)}</b></div>
          <div><span>رصيد الغرامات</span><b>{formatCurrency(penaltyRemaining)}</b></div>
          <div style={{ borderColor: "#b45309" }}><span>إجمالي المستحق على العميل</span><b>{formatCurrency(bookingRemaining + penaltyRemaining)}</b></div>
        </section>
        {!penalties.length ? (
          <p style={{ textAlign: "center", color: "#6b7280", padding: "18px 0" }}>لا توجد غرامات على هذا الحجز.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {penalties.map((penalty) => (
              <div key={penalty.id} style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 14, padding: 12, background: "var(--card, #fff)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><TriangleAlert style={{ width: 16, height: 16, color: "#b45309" }} /> {penaltyDamageLabelClient(penalty.damageType)} — {penalty.itemLabel}</div>
                  <PenaltyBadge status={penalty.displayStatus} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 8, marginTop: 10 }}>
                  <div><small style={{ color: "#6b7280" }}>الكمية</small><div style={{ fontWeight: 700 }}>{penalty.quantity}</div></div>
                  <div><small style={{ color: "#6b7280" }}>الغرامة</small><div style={{ fontWeight: 700 }}>{formatCurrency(penalty.penaltyAmount)}</div></div>
                  <div><small style={{ color: "#6b7280" }}>المدفوع</small><div style={{ fontWeight: 700 }}>{formatCurrency(penalty.paid)}</div></div>
                  <div><small style={{ color: "#6b7280" }}>المتبقي</small><div style={{ fontWeight: 700 }}>{formatCurrency(penalty.remaining)}</div></div>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "#6b7280", flexWrap: "wrap" }}>
                  <span dir="ltr">{penalty.penaltyNo}</span>
                  {penalty.evidenceCount > 0 ? <span><Camera style={{ width: 13, height: 13, display: "inline" }} /> {penalty.evidenceCount} صور</span> : null}
                  <span>سجّلها: {penalty.createdByName || "—"}</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <Button variant="outline" size="sm" onClick={() => setDetails(penalty)}>التفاصيل</Button>
                  {penalty.status === "approved" && penalty.remaining > 0 ? <Button size="sm" onClick={() => setPaying(penalty)}><Banknote /> تسديد</Button> : null}
                  {penalty.status !== "cancelled" && penalty.paid <= 0 ? <Button variant="outline" size="sm" onClick={() => setEditing(penalty)}>تعديل</Button> : null}
                  {penalty.status !== "cancelled" && penalty.paid <= 0 ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelling(penalty)}>إلغاء</Button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </QueryState>
      {adding ? <PenaltyFormDialog base={base} booking={booking} penalty={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} /> : null}
      {editing ? <PenaltyFormDialog base={base} booking={booking} penalty={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
      {paying ? <PenaltyPayDialog base={base} penalty={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); refresh(); }} /> : null}
      {details ? <PenaltyDetailsDialog base={base} penalty={details} onClose={() => setDetails(null)} onChanged={refresh} /> : null}
      {cancelling ? <PenaltyCancelDialog base={base} penalty={cancelling} onClose={() => setCancelling(null)} onCancelled={() => { setCancelling(null); refresh(); }} /> : null}
    </section>
  );
}

function EvidencePicker({ evidence, onChange }: { evidence: string[]; onChange: (next: string[]) => void }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {evidence.map((src, index) => (
          <div key={index} style={{ position: "relative", width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
            <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button type="button" onClick={() => onChange(evidence.filter((_, i) => i !== index))} style={{ position: "absolute", top: 2, left: 2, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", lineHeight: 1, padding: 2 }} aria-label="حذف الصورة"><Trash2 style={{ width: 12, height: 12 }} /></button>
          </div>
        ))}
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "#2563eb" }}>
        <Camera style={{ width: 16, height: 16 }} /> إضافة صور
        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          const next = [...evidence];
          for (const file of files) {
            if (next.length >= 20) break;
            try { next.push(await compressImageFile(file, 1400, 0.8)); } catch { /* ignore a single bad image */ }
          }
          onChange(next);
          event.target.value = "";
        }} />
      </label>
    </div>
  );
}

function PenaltyFormDialog({ base, booking, penalty, onClose, onSaved }: { base: string; booking: BookingOperationsBooking; penalty: any | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isEdit = Boolean(penalty);
  const products = useQuery<any>({ queryKey: [base, "penalty-products"], queryFn: () => adminFetch(`${base}/products`).catch(() => null) });
  const assets = useQuery<any>({ queryKey: [base, "penalty-assets"], queryFn: () => adminFetch(`${base}/assets`).catch(() => null) });
  const items: Array<{ label: string; productId: number | null; unit: number }> = [
    ...((products.data?.items ?? []) as any[]).filter((i) => i?.status !== "released").map((i) => ({ label: i.productName, productId: Number(i.productId) || null, unit: Number(i.unitPrice ?? 0) })),
    ...((assets.data?.assets ?? []) as any[]).map((a) => ({ label: a.name, productId: Number(a.productId) || null, unit: Number(a.currentValue ?? a.purchaseValue ?? 0) })),
  ];
  const [damageType, setDamageType] = useState<string>(penalty?.damageType ?? "damage");
  const [itemLabel, setItemLabel] = useState<string>(penalty?.itemLabel ?? "");
  const [productId, setProductId] = useState<number | null>(penalty?.productId ?? null);
  const [itemCondition, setItemCondition] = useState<string>(penalty?.itemCondition ?? "");
  const [quantity, setQuantity] = useState<string>(String(penalty?.quantity ?? 1));
  const [unitValue, setUnitValue] = useState<string>(String(penalty?.unitValue ?? 0));
  const [penaltyAmount, setPenaltyAmount] = useState<string>(String(penalty?.penaltyAmount ?? 0));
  const [reason, setReason] = useState<string>(penalty?.reason ?? "");
  const [notes, setNotes] = useState<string>(penalty?.notes ?? "");
  const [evidence, setEvidence] = useState<string[]>(Array.isArray(penalty?.evidence) ? penalty.evidence : []);
  const [reduceStock, setReduceStock] = useState(false);
  const suggested = Math.max(0, (Number(unitValue) || 0) * (Number(quantity) || 0));
  const canReduceStock = !isEdit && productId != null && ["loss", "break", "not_returned", "damage"].includes(damageType);
  const mutation = useMutation({
    mutationFn: () => {
      const payload = { damageType, itemLabel: itemLabel.trim(), productId, itemCondition: itemCondition || null, quantity: Number(quantity) || 1, unitValue: Number(unitValue) || 0, penaltyAmount: Number(penaltyAmount) || 0, reason: reason.trim(), notes: notes.trim() || null, evidence };
      return isEdit
        ? adminFetch(`${base}/penalties/${penalty.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, editReason: "تعديل الغرامة" }) })
        : adminFetch(`${base}/penalties`, { method: "POST", body: JSON.stringify({ ...payload, reduceStock: canReduceStock && reduceStock }) });
    },
    onSuccess: () => { toast({ title: isEdit ? "تم تعديل الغرامة" : "تم تسجيل الغرامة" }); onSaved(); },
    onError: (error: any) => toast({ title: "تعذّر الحفظ", description: error?.message, variant: "destructive" }),
  });
  const valid = itemLabel.trim() && reason.trim() && Number(penaltyAmount) >= 0;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل الغرامة" : "إضافة غرامة على الحجز"}</DialogTitle><DialogDescription>لا تُضاف الغرامة إلى إجمالي الحجز — تُسجَّل كمستحق منفصل.</DialogDescription></DialogHeader>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div><Label>نوع الحالة *</Label><select value={damageType} onChange={(e) => setDamageType(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">{PENALTY_DAMAGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><Label>حالة العنصر</Label><select value={itemCondition} onChange={(e) => setItemCondition(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"><option value="">—</option>{PENALTY_CONDITION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          <div>
            <Label>العنصر *</Label>
            {items.length ? (
              <select value={productId != null && items.some((i) => i.productId === productId && i.label === itemLabel) ? `${productId}::${itemLabel}` : ""} onChange={(e) => { const found = items.find((i) => `${i.productId}::${i.label}` === e.target.value); if (found) { setItemLabel(found.label); setProductId(found.productId); if (!Number(unitValue)) setUnitValue(String(found.unit)); } }} className="mb-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">
                <option value="">اختر من عناصر الحجز أو اكتب يدوياً…</option>
                {items.map((item, index) => <option key={index} value={`${item.productId}::${item.label}`}>{item.label}{item.unit ? ` — ${formatCurrency(item.unit)}` : ""}</option>)}
              </select>
            ) : null}
            <Input value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} placeholder="اسم العنصر (كرسي، سماعة، قطعة ديكور…)" />
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div><Label>الكمية *</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
            <div><Label>قيمة العنصر (للوحدة)</Label><Input type="number" min={0} value={unitValue} onChange={(e) => setUnitValue(e.target.value)} /></div>
          </div>
          <div>
            <Label>قيمة الغرامة *</Label>
            <Input type="number" min={0} value={penaltyAmount} onChange={(e) => setPenaltyAmount(e.target.value)} />
            {suggested > 0 ? <button type="button" onClick={() => setPenaltyAmount(String(suggested))} style={{ marginTop: 4, fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}>القيمة المقترحة: {formatCurrency(suggested)} (قيمة العنصر × الكمية) — اضغط للاستخدام</button> : null}
          </div>
          <div><Label>سبب الغرامة *</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب فرض الغرامة" /></div>
          <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات إضافية (اختياري)" /></div>
          <div><Label>صور / مرفقات</Label><EvidencePicker evidence={evidence} onChange={setEvidence} /></div>
          {canReduceStock ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={reduceStock} onChange={(e) => setReduceStock(e.target.checked)} />
              خصم الكمية من المخزون بحركة تلف/فقدان موثّقة (مرتبطة بهذا الحجز والغرامة)
            </label>
          ) : null}
        </div>
        <DialogFooter className="ajn-op-dialog-actions"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button className="ajn-op-primary" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "جارٍ الحفظ…" : isEdit ? "حفظ التعديل" : "تسجيل الغرامة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PenaltyPayDialog({ base, penalty, onClose, onPaid }: { base: string; penalty: any; onClose: () => void; onPaid: () => void }) {
  const { toast } = useToast();
  const remaining = Number(penalty.remaining ?? Math.max(0, Number(penalty.penaltyAmount) - Number(penalty.paid ?? 0)));
  const [amount, setAmount] = useState<string>(String(remaining));
  const [method, setMethod] = useState<string>("cash");
  const [note, setNote] = useState<string>("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const value = Number(amount) || 0;
  const overpay = value > remaining + 0.001;
  const mutation = useMutation({
    mutationFn: () => adminFetch(`${base}/penalties/${penalty.id}/pay`, { method: "POST", body: JSON.stringify({ amount: value, paymentMethod: method, note: note.trim() || null, evidence }) }),
    onSuccess: (result: any) => { toast({ title: result?.executed ? "تم تسجيل التسديد ومسّ الصندوق" : "تم إنشاء طلب التسديد بانتظار اعتماد المدير الرئيسي" }); onPaid(); },
    onError: (error: any) => toast({ title: "تعذّر التسديد", description: error?.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>تسديد غرامة — {penalty.penaltyNo}</DialogTitle></DialogHeader>
        <section className="ajn-op-finance-summary"><div><span>إجمالي الغرامة</span><b>{formatCurrency(Number(penalty.penaltyAmount))}</b></div><div><span>المدفوع</span><b>{formatCurrency(Number(penalty.paid ?? 0))}</b></div><div><span>المتبقي</span><b>{formatCurrency(remaining)}</b></div></section>
        <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
          <div><Label>مبلغ التسديد *</Label><Input type="number" min={0} max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} />{overpay ? <small style={{ color: "#b91c1c" }}>المبلغ يتجاوز المتبقّي</small> : null}</div>
          <div><Label>طريقة الدفع</Label><select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm">{PENALTY_METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><Label>ملاحظة</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" /></div>
          <div><Label>مرفقات الإيصال</Label><EvidencePicker evidence={evidence} onChange={setEvidence} /></div>
        </div>
        <DialogFooter className="ajn-op-dialog-actions"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button className="ajn-op-primary" disabled={mutation.isPending || value <= 0 || overpay} onClick={() => mutation.mutate()}>{mutation.isPending ? "جارٍ التسديد…" : "تأكيد التسديد"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PenaltyCancelDialog({ base, penalty, onClose, onCancelled }: { base: string; penalty: any; onClose: () => void; onCancelled: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => adminFetch(`${base}/penalties/${penalty.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: () => { toast({ title: "تم إلغاء الغرامة" }); onCancelled(); },
    onError: (error: any) => toast({ title: "تعذّر الإلغاء", description: error?.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>إلغاء الغرامة — {penalty.penaltyNo}</DialogTitle><DialogDescription>لا يُحذف السجل؛ تُوسم كملغاة مع حفظ السبب.</DialogDescription></DialogHeader>
        <div><Label>سبب الإلغاء *</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اكتب سبب الإلغاء" /></div>
        <DialogFooter className="ajn-op-dialog-actions"><Button variant="outline" onClick={onClose}>تراجع</Button><Button variant="destructive" disabled={mutation.isPending || reason.trim().length < 3} onClick={() => mutation.mutate()}>تأكيد الإلغاء</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PenaltyDetailsDialog({ base, penalty, onClose, onChanged }: { base: string; penalty: any; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const detail = useQuery<any>({ queryKey: [base, "penalty", penalty.id], queryFn: () => adminFetch(`${base}/penalties/${penalty.id}`) });
  const payments = useQuery<any>({ queryKey: [base, "penalty", penalty.id, "payments"], queryFn: () => adminFetch(`${base}/penalties/${penalty.id}/payments`) });
  const row = detail.data ?? penalty;
  const review = useMutation({
    mutationFn: (action: "approve" | "reject") => adminFetch(`${base}/penalties/${penalty.id}/review`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: () => { toast({ title: "تم تحديث البلاغ" }); onChanged(); onClose(); },
    onError: (error: any) => toast({ title: "تعذّرت المراجعة", description: error?.message, variant: "destructive" }),
  });
  const reverse = useMutation({
    mutationFn: (transactionId: number) => { const reason = window.prompt("سبب عكس التسديد:") ?? ""; if (reason.trim().length < 3) throw new Error("سبب العكس مطلوب"); return adminFetch(`${base}/penalties/${penalty.id}/reverse`, { method: "POST", body: JSON.stringify({ transactionId, reason: reason.trim() }) }); },
    onSuccess: () => { toast({ title: "تم عكس التسديد" }); void detail.refetch(); void payments.refetch(); onChanged(); },
    onError: (error: any) => toast({ title: "تعذّر العكس", description: error?.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>تفاصيل الغرامة — {row.penaltyNo}</DialogTitle></DialogHeader>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b>{penaltyDamageLabelClient(row.damageType)} — {row.itemLabel}</b><PenaltyBadge status={row.displayStatus} /></div>
          <section className="ajn-op-finance-summary"><div><span>الكمية</span><b>{row.quantity}</b></div><div><span>قيمة الغرامة</span><b>{formatCurrency(Number(row.penaltyAmount))}</b></div><div><span>المدفوع</span><b>{formatCurrency(Number(row.paid ?? 0))}</b></div><div><span>المتبقي</span><b>{formatCurrency(Number(row.remaining ?? 0))}</b></div></section>
          {row.reason ? <div><small style={{ color: "#6b7280" }}>السبب</small><div>{row.reason}</div></div> : null}
          {row.notes ? <div><small style={{ color: "#6b7280" }}>ملاحظات</small><div>{row.notes}</div></div> : null}
          <div style={{ fontSize: 12, color: "#6b7280" }}>سجّلها: {row.createdByName || "—"}{row.reviewedByName ? ` · راجعها: ${row.reviewedByName}` : ""}{row.createdAt ? ` · ${new Date(row.createdAt).toLocaleString("ar-IQ-u-nu-latn")}` : ""}</div>
          {Array.isArray(row.evidence) && row.evidence.length ? (
            <div><small style={{ color: "#6b7280" }}>الأدلّة ({row.evidence.length})</small><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>{row.evidence.map((src: string, index: number) => <a key={index} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} /></a>)}</div></div>
          ) : null}
          {row.status === "pending_review" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}><Button size="sm" disabled={review.isPending} onClick={() => review.mutate("approve")}>اعتماد الغرامة</Button><Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate("reject")}>رفض البلاغ</Button></div>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <small style={{ color: "#6b7280" }}>سجل التسديدات</small>
            <QueryState loading={payments.isLoading} error={payments.error} empty={!payments.data?.payments?.length}>
              <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                {(payments.data?.payments ?? []).map((tx: any) => (
                  <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", fontSize: 13 }}>
                    <span dir="ltr">{tx.transactionNo}</span>
                    <span style={{ fontWeight: 700, color: tx.isReversal ? "#b91c1c" : "#065f46" }}>{tx.isReversal ? "−" : "+"}{formatCurrency(Math.abs(tx.amount))}</span>
                    <span style={{ color: "#6b7280" }}>{tx.status === "executed" ? "منفّذة" : tx.status === "pending" ? "بانتظار الاعتماد" : tx.status}</span>
                    {tx.status === "executed" && !tx.isReversal ? <Button size="sm" variant="ghost" className="text-destructive" disabled={reverse.isPending} onClick={() => reverse.mutate(tx.id)}><RotateCcw style={{ width: 14, height: 14 }} /> عكس</Button> : <span />}
                  </div>
                ))}
              </div>
            </QueryState>
          </div>
        </div>
        <DialogFooter className="ajn-op-dialog-actions"><Button variant="outline" onClick={onClose}>إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinanceTab({ base, queryKey, booking, invoiceUrl }: { base: string; queryKey: unknown[]; booking: BookingOperationsBooking; invoiceUrl: string; paymentUrl?: string }) {
  const queryClient = useQueryClient();
  const query = useQuery<any>({ queryKey: [...queryKey, "finance"], queryFn: () => adminFetch(`${base}/finance`) });
  const data = query.data;
  const assetRental = Number(booking.raw?.assetRentalAmount ?? booking.raw?.equipmentRentalAmount ?? 0);
  const pricing = (booking.source === "kosha" ? booking.raw?.bookingDetails : booking.raw?.customFields)?.pricing;
  const discount = Number(pricing?.discountAmount ?? booking.raw?.discountAmount ?? booking.raw?.discount ?? 0);
  const summary = [["إجمالي الحجز", data?.finalAmount ?? booking.total], ["المنتجات", data?.productCharges ?? 0], ["تأجير الأصول", assetRental], ["الخصم", discount], ["المدفوع", data?.paid ?? booking.paid], ["المتبقي", data?.remaining ?? booking.remaining], ["الربح التقديري", data?.estimatedProfit ?? 0]];
  // One booking = one payment source. The inline collector posts an
  // approval-first receipt against it — no duplicate ledger, no navigating away.
  const sourceType = booking.source === "kosha" ? "kosha_booking" : "service_order";
  const refetchFinance = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: [...queryKey, "finance"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "booking-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "customer-account"] });
  };
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><CircleDollarSign /><span><small>مصدر واحد للحقيقة المالية · هذا الحجز وحساب العميل</small><h2>الملخص المالي</h2></span></div><div className="ajn-op-actions"><Button variant="outline" asChild><Link href={invoiceUrl}><Printer /> الفاتورة</Link></Button></div></div>
    {/* 1) Booking summary + inline approval-first "تسجيل دفعة". */}
    <h3 className="mb-2 mt-1 text-sm font-bold text-foreground">ملخص هذا الحجز</h3>
    <AccountSummaryCard sourceType={sourceType} sourceId={booking.id} total={booking.total} paid={booking.paid} remaining={booking.remaining} paymentStatus={booking.paymentStatus} onCollected={refetchFinance} />
    {/* Booking-level discount — reduces the net total; reconciles remaining. */}
    <BookingDiscountControl base={base} currentDiscount={discount} onChanged={refetchFinance} />
    {/* 2) Customer-wide account — deliberately distinct from the booking balance. */}
    <div className="mt-4"><CustomerFinancialSummary customerId={booking.customerId} /></div>
    {/* 2b) Damage & penalties — a SEPARATE due, never folded into the booking total. */}
    <BookingPenaltiesSection base={base} booking={booking} queryKey={queryKey} onChanged={refetchFinance} />
    <QueryState loading={query.isLoading} error={query.error}>
      {/* 3) Booking financial breakdown. */}
      <section className="ajn-op-finance-summary mt-4">{summary.map(([label, value]) => <div key={String(label)}><span>{label}</span><b>{money(Number(value))}</b></div>)}</section>
      {/* 4) Movement log — one row per canonical financial_transaction of this booking. */}
      <section className="ajn-op-ledger mt-4">
        <h3><Landmark /> سجل الحركات المالية</h3>
        {data?.transactions?.length ? (
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full min-w-[720px] text-right text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>{["النوع", "المرجع", "المبلغ", "الحالة", "التاريخ", "الصندوق", "أنشأ الطلب", "اعتمد"].map((head) => <th key={head} className="p-2 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody>
                {data.transactions.map((row: any) => <tr key={row.id} className="border-t border-border/20">
                  <td className="p-2 font-semibold">{ledgerTypeLabel(row)}</td>
                  <td className="p-2 tabular-nums" dir="ltr">{row.transactionNo || row.referenceNo || `#${row.id}`}</td>
                  <td className="p-2">{money(Number(row.amount))}</td>
                  <td className="p-2"><OperationStatus value={row.approvalStatus} label={FINANCIAL_STATUS_LABELS[row.approvalStatus] ?? row.approvalStatus} /></td>
                  <td className="p-2">{readableDate(row.transactionTime)}</td>
                  <td className="p-2">الصندوق الرئيسي</td>
                  <td className="p-2">{row.requestedByName || "—"}</td>
                  <td className="p-2">{row.approvedByName || row.executedByName || "—"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        ) : <div className="ajn-op-empty compact"><ReceiptText /><h3>لا توجد عملية مالية منشورة</h3><p>تظهر هنا كل حركات هذا الحجز من الصندوق الرئيسي — دفعات وقبض وعكوسات — من دون إنشاء قيد مكرر.</p></div>}
      </section>
    </QueryState></div>;
}

function TasksTab({ base, queryKey, entityType, entityId }: { base: string; queryKey: unknown[]; entityType: string; entityId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", staffId: "", dueAt: "", priority: "medium" });
  const query = useQuery<{ data: any[] }>({ queryKey: [...queryKey, "tasks"], queryFn: () => adminFetch(`${base}/tasks`) });
  const mutation = useMutation({ mutationFn: () => adminFetch("/admin/tasks", { method: "POST", body: JSON.stringify({ title: form.title, description: form.description || undefined, assignedStaffIds: [Number(form.staffId)], dueAt: form.dueAt || undefined, priority: form.priority, relatedType: entityType, relatedId: entityId, taskType: "other" }) }), onSuccess: () => { setShowForm(false); setForm({ title: "", description: "", staffId: "", dueAt: "", priority: "medium" }); queryClient.invalidateQueries({ queryKey }); toast({ title: "تم إنشاء مهمة مرتبطة بالحجز" }); }, onError: (error: any) => toast({ title: "تعذر إنشاء المهمة", description: error?.message, variant: "destructive" }) });
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><ListChecks /><span><small>الموظفون والتنفيذ</small><h2>مهام الحجز</h2></span></div><div className="ajn-op-actions"><Button variant="outline" asChild><Link href="/admin/tasks">فتح مركز المهام</Link></Button><Button className="ajn-op-primary" onClick={() => setShowForm(!showForm)}><Plus /> إنشاء مهمة</Button></div></div>{showForm && <section className="ajn-op-inline-form"><div><Label htmlFor="task-title">عنوان المهمة *</Label><Input id="task-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="مثال: تجهيز باقات الورد" /></div><div><Label htmlFor="task-staff">رقم الموظف *</Label><Input id="task-staff" inputMode="numeric" value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value.replace(/\D/g, "") })} /></div><div><Label htmlFor="task-due">موعد الإنجاز</Label><Input id="task-due" type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></div><div><Label htmlFor="task-priority">الأولوية</Label><select id="task-priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></div><div className="sm:col-span-2"><Label htmlFor="task-desc">الوصف</Label><Textarea id="task-desc" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div><Button className="ajn-op-primary" disabled={!form.title.trim() || !form.staffId || mutation.isPending} onClick={() => mutation.mutate()}>حفظ المهمة</Button></section>}<QueryState loading={query.isLoading} error={query.error} empty={!query.data?.data.length}><div className="ajn-op-task-list">{query.data?.data.map((row) => <article key={row.id}><span className="ajn-op-task-check">{row.status === "completed" ? <Check /> : <Clock3 />}</span><div><div><h3>{row.title}</h3><OperationStatus value={row.status} /></div><p>{row.description || "لا يوجد وصف"}</p><small>{row.taskNo || `#${row.id}`} · الاستحقاق {readableDate(row.dueAt)}</small></div><Badge variant="outline">{row.priority}</Badge></article>)}</div></QueryState></div>;
}

function DocumentsTab({ base, queryKey, entityType, entityId }: { base: string; queryKey: unknown[]; entityType: string; entityId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", fileUrl: "", documentType: "file" });
  const query = useQuery<{ data: any[] }>({ queryKey: [...queryKey, "documents"], queryFn: () => adminFetch(`${base}/documents`) });
  const mutation = useMutation({ mutationFn: () => adminFetch("/admin/documents", { method: "POST", body: JSON.stringify({ entityType, entityId, title: form.title, fileUrl: form.fileUrl, documentType: form.documentType }) }), onSuccess: () => { setForm({ title: "", fileUrl: "", documentType: "file" }); queryClient.invalidateQueries({ queryKey }); toast({ title: "تم ربط المستند بالحجز" }); }, onError: (error: any) => toast({ title: "تعذر ربط المستند", description: error?.message, variant: "destructive" }) });
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><FileText /><span><small>العقود والصور والإيصالات</small><h2>مستندات الحجز</h2></span></div><Button variant="outline" asChild><Link href="/admin/documents">فتح مركز المستندات</Link></Button></div><section className="ajn-op-document-form"><div><Label htmlFor="doc-title">اسم المستند</Label><Input id="doc-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="عقد الحجز" /></div><div><Label htmlFor="doc-url">رابط الملف المحمي</Label><Input id="doc-url" dir="ltr" value={form.fileUrl} onChange={(event) => setForm({ ...form, fileUrl: event.target.value })} placeholder="رابط الملف من التخزين الحالي" /></div><div><Label htmlFor="doc-type">نوع المستند</Label><select id="doc-type" value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value })}><option value="contract">عقد</option><option value="invoice">فاتورة</option><option value="receipt">وصل</option><option value="photo">صورة تنفيذ</option><option value="damage_photo">صورة تلف</option><option value="file">ملف آخر</option></select></div><Button className="ajn-op-primary" disabled={!form.title.trim() || !form.fileUrl.trim() || mutation.isPending} onClick={() => mutation.mutate()}><Plus /> ربط المستند</Button></section><QueryState loading={query.isLoading} error={query.error} empty={!query.data?.data.length}><div className="ajn-op-document-list">{query.data?.data.map((row) => <a key={row.id} href={row.fileUrl} target="_blank" rel="noreferrer"><span><FileText /><div><b>{row.title}</b><small>{row.documentType} · {readableDate(row.createdAt)}</small></div></span><ChevronLeft /></a>)}</div></QueryState></div>;
}

function ActivityTab({ base, queryKey }: { base: string; queryKey: unknown[] }) {
  const query = useQuery<{ timeline: TimelineRow[]; audit: any[] }>({ queryKey: [...queryKey, "activity"], queryFn: () => adminFetch(`${base}/activity`) });
  return <div className="ajn-op-activity-layout"><section className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><History /><span><small>السجل المقروء</small><h2>تايملاين الحجز</h2></span></div></div><QueryState loading={query.isLoading} error={query.error} empty={!query.data?.timeline.length}><Timeline rows={query.data?.timeline ?? []} /></QueryState></section><section className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><ShieldAlert /><span><small>الامتثال والتغييرات</small><h2>سجل التدقيق</h2></span></div></div><QueryState loading={query.isLoading} error={query.error} empty={!query.data?.audit.length}><div className="ajn-op-audit-list">{query.data?.audit.map((row) => <article key={row.id}><span><b>{row.action}</b><small>{row.userName || "النظام"} · {readableDate(row.createdAt)}</small></span><code>#{row.id}</code></article>)}</div></QueryState></section></div>;
}

function Timeline({ rows }: { rows: TimelineRow[] }) {
  if (!rows.length) return <div className="ajn-op-empty compact"><History /><h3>لا يوجد نشاط بعد</h3><p>ستظهر هنا عمليات المنتجات والأصول والمستودع والمالية.</p></div>;
  return <div className="ajn-op-timeline">{rows.map((row) => <article key={row.id}><i /><time>{new Date(row.createdAt).toLocaleString("ar-IQ-u-nu-latn", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><div><strong>{row.title}</strong><p>{row.body || row.type}</p><small>{row.actorName || "النظام"}</small></div></article>)}</div>;
}
