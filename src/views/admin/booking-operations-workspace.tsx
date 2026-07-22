import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArchiveRestore,
  Banknote,
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
  PackageCheck,
  PackageOpen,
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
import { adminFetch, formatCurrency } from "./_lib";
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
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function toneFor(value: string) {
  if (["completed", "paid", "active", "returned", "ready", "consumed"].includes(value)) return "success";
  if (["damaged", "missing", "lost", "cancelled", "shortage"].includes(value)) return "danger";
  if (["preparing", "reserved", "picked", "pending", "inspection", "maintenance"].includes(value)) return "warning";
  if (["out", "loaded", "assets_out", "event_active"].includes(value)) return "info";
  return "neutral";
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

export function BookingOperationsWorkspace({ booking }: { booking: BookingOperationsBooking }) {
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

  return <div className="ajn-booking-operations" dir="rtl">
    <div className="ajn-op-back"><Button variant="ghost" asChild><Link href="/admin/bookings"><ChevronLeft className="h-4 w-4" /> مركز الحجوزات</Link></Button><span>مساحة تشغيل موحدة · البيانات من وحدات AJN الأصلية</span></div>

    <header className="ajn-op-sticky">
      <div className="ajn-op-header-main">
        <div className="ajn-op-identity"><span className="ajn-op-mark"><Sparkles /></span><div><small className="ajn-op-page-label">تفاصيل الحجز</small><div className="ajn-op-title"><h1>{booking.number}</h1><OperationStatus value={overview.data?.bookingStage ?? booking.status} /></div><p><UserRound /> {booking.customerName} <span>·</span> {booking.phone}</p></div></div>
        <div className="ajn-op-facts">
          <span><CalendarDays /><b>{readableDate(booking.eventDate)}</b><small>{booking.eventTime || "الوقت غير محدد"}</small></span>
          <span><MapPin /><b>{booking.hall || "الموقع غير محدد"}</b><small>{booking.services.map((service) => service.type).slice(0, 2).join(" · ") || "حجز مناسبة"}</small></span>
          <span><Building2 /><b>{department}</b><small>القسم</small></span>
          <span><Users /><b>{responsibleTeam}</b><small>الفريق المسؤول</small></span>
          <span><CircleDollarSign /><b>{booking.paymentStatus || "غير مكتمل"}</b><small>حالة الدفع</small></span>
          <span><Warehouse /><b>{STAGE_LABELS[overview.data?.warehouseStage ?? "reserved"]}</b><small>حالة المستودع</small></span>
        </div>
        <div className="ajn-op-header-actions"><Button className="ajn-op-primary" asChild><Link href={paymentUrl}><Banknote /> استلام دفعة</Link></Button><Button variant="outline" asChild><Link href={invoiceUrl}><ReceiptText /> إصدار فاتورة</Link></Button><Button variant="outline" onClick={() => window.print()}><Printer /> طباعة العقد</Button><DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="المزيد"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="ajn-op-more-menu"><DropdownMenuItem onSelect={() => changeTab("documents")}><FileText /> مستندات الحجز</DropdownMenuItem><DropdownMenuItem onSelect={() => changeTab("activity")}><History /> سجل النشاط</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => changeTab("finance")}><CircleDollarSign /> الملخص المالي</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </div>
    </header>

    <section className="ajn-op-workflows">
      <WorkflowRail title="مسار الحجز" icon={CalendarDays} steps={BOOKING_STEPS} current={overview.data?.bookingStage ?? "booked"} onStep={(stage, label) => setConfirm({ kind: "booking", stage, label })} />
      <WorkflowRail title="مسار المستودع" icon={Warehouse} steps={WAREHOUSE_STEPS} current={overview.data?.warehouseStage ?? "reserved"} onStep={(stage, label) => setConfirm({ kind: "warehouse", stage, label })} />
    </section>

    {overview.data?.alerts?.length ? <button className="ajn-op-alert" onClick={() => changeTab(overview.data!.alerts[0].tab)}><TriangleAlert /><strong>{overview.data.alerts[0].title}</strong><span>{overview.data.alerts.length > 1 ? `و${overview.data.alerts.length - 1} تنبيهات أخرى` : "فتح التفاصيل"}</span><ChevronLeft /></button> : <div className="ajn-op-all-clear"><CheckCircle2 /><span>لا توجد تنبيهات تشغيلية حرجة لهذا الحجز</span></div>}

    <OperationsSummary data={overview.data} booking={booking} onTab={changeTab} />

    <section className="ajn-op-quickbar"><DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button className="ajn-op-add-item"><Plus /> إضافة عنصر <ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="ajn-op-add-menu"><DropdownMenuItem onSelect={() => changeTab("products")}><span className="is-store"><ShoppingBag /></span><span><b>إضافة منتج من المتجر</b><small>اختر المنتجات والمتغيرات واحجز الكمية من المخزون.</small></span><ChevronLeft /></DropdownMenuItem><DropdownMenuItem onSelect={() => changeTab("assets")}><span className="is-asset"><PackageCheck /></span><span><b>إضافة أصل من الأصول</b><small>اربط المعدات وتحقق من التوفر وحالة الأصل.</small></span><ChevronLeft /></DropdownMenuItem></DropdownMenuContent></DropdownMenu><div>{nextBooking && <Button variant="outline" onClick={() => setConfirm({ kind: "booking", stage: nextBooking[0], label: nextBooking[1] })}><Check /> {nextBooking[1]}</Button>}{nextWarehouse && <Button variant="outline" onClick={() => setConfirm({ kind: "warehouse", stage: nextWarehouse[0], label: nextWarehouse[1] })}><QrCode /> {nextWarehouse[1]}</Button>}<Button variant="outline" onClick={() => changeTab("tasks")}><ListChecks /> إنشاء مهمة</Button><Button variant="outline" onClick={() => changeTab("documents")}><FileText /> رفع مستند</Button></div></section>

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
    <section><div className="ajn-op-side-title"><Sparkles /><h2>إجراءات سريعة</h2></div><div className="ajn-op-side-actions"><Button className="ajn-op-primary" asChild><Link href={paymentUrl}><Banknote /> استلام دفعة</Link></Button><Button variant="outline" asChild><Link href={invoiceUrl}><ReceiptText /> إصدار فاتورة</Link></Button><Button variant="outline" onClick={() => onTab("tasks")}><ListChecks /> إنشاء مهمة</Button><Button variant="outline" onClick={() => onTab("documents")}><FileText /> المستندات</Button></div></section>
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
    <QueryState loading={assets.isLoading} error={assets.error} empty={!assets.data?.assets.length}><div className="ajn-op-table-wrap"><table className="ajn-op-table ajn-op-assets-table"><thead><tr><th>الأصل</th><th>الفئة</th><th>QR</th><th>المستودع</th><th>الكمية</th><th>المتاح</th><th>المحجوز</th><th>الخارج</th><th>المرتجع</th><th>الصحة</th><th>القيمة الحالية</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{assets.data?.assets.map((row) => <tr key={row.productId}><td><b>{row.name}</b><small>{row.assetCode}{row.serialNumber ? ` · ${row.serialNumber}` : ""}</small></td><td>أصل تشغيلي</td><td><span className="ajn-op-qr-cell"><QrCode /> {row.qrToken ? "مسجل" : "—"}</span></td><td>{row.warehouse || row.location || "المستودع الرئيسي"}</td><td>{row.quantity}</td><td>{row.available}</td><td>{row.reserved}</td><td>{row.out}</td><td>{row.returned}</td><td><span className={row.healthScore < 60 ? "ajn-op-health is-low" : "ajn-op-health"}>{row.healthScore}%</span></td><td>{money(row.currentValue)}</td><td><OperationStatus value={row.stage} /></td><td><div className="ajn-op-table-actions">{row.stage === "linked" && <Button size="sm" onClick={() => act(row, "reserve")}>حجز</Button>}{row.stage === "reserved" && <Button size="sm" onClick={() => act(row, "pick")}><Barcode /> تجهيز</Button>}{row.stage === "picked" && <Button size="sm" onClick={() => act(row, "checkout")}><QrCode /> إخراج</Button>}{row.stage === "out" && <Button size="sm" onClick={() => { setReturning(row); setReturnForm({ problem: "none", description: "", estimatedCost: "", usageHours: "", managerApproval: false }); }}><RotateCcw /> إرجاع</Button>}{row.stage === "returned" && <Button size="sm" onClick={() => mutation.mutate({ mode: "inspect", productId: row.productId, quantity: row.quantity, usageHours: Number(returnForm.usageHours || 0), problem: row.problem || "none" })}><ClipboardCheck /> فحص</Button>}<DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`المزيد للأصل ${row.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/admin/products?focus=${row.productId}`}><PackageCheck /> جواز الأصل</Link></DropdownMenuItem>{!row.out && <DropdownMenuItem onSelect={() => act(row, "unlink")} className="text-destructive"><RotateCcw /> إزالة من الحجز</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div></td></tr>)}</tbody></table></div></QueryState>
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

function FinanceTab({ base, queryKey, booking, invoiceUrl, paymentUrl }: { base: string; queryKey: unknown[]; booking: BookingOperationsBooking; invoiceUrl: string; paymentUrl: string }) {
  const query = useQuery<any>({ queryKey: [...queryKey, "finance"], queryFn: () => adminFetch(`${base}/finance`) });
  const data = query.data;
  const assetRental = Number(booking.raw?.assetRentalAmount ?? booking.raw?.equipmentRentalAmount ?? 0);
  const discount = Number(booking.raw?.discountAmount ?? booking.raw?.discount ?? 0);
  const summary = [["إجمالي الحجز", data?.finalAmount ?? booking.total], ["المنتجات", data?.productCharges ?? 0], ["تأجير الأصول", assetRental], ["الخصم", discount], ["المدفوع", data?.paid ?? booking.paid], ["المتبقي", data?.remaining ?? booking.remaining], ["الربح التقديري", data?.estimatedProfit ?? 0]];
  return <div className="ajn-op-tab-panel"><div className="ajn-op-section-head"><div><CircleDollarSign /><span><small>الصندوق والحسابات وكشف العميل</small><h2>الملخص المالي</h2></span></div><div className="ajn-op-actions"><Button variant="outline" asChild><Link href={invoiceUrl}><Printer /> الفاتورة</Link></Button><Button className="ajn-op-primary" asChild><Link href={paymentUrl}><Banknote /> استلام دفعة</Link></Button></div></div><QueryState loading={query.isLoading} error={query.error}><div className="ajn-op-finance-layout"><section className="ajn-op-finance-summary">{summary.map(([label, value]) => <div key={String(label)}><span>{label}</span><b>{money(Number(value))}</b></div>)}</section><section className="ajn-op-ledger"><h3><Landmark /> العمليات والقيود المرتبطة</h3>{data?.transactions?.length ? data.transactions.map((row: any) => <div key={row.id}><span><b>{row.transactionNo || `#${row.id}`}</b><small>{readableDate(row.transactionTime)} · {row.paymentMethod || "—"}</small></span><strong>{money(Number(row.amount))}</strong><OperationStatus value={row.approvalStatus} /></div>) : <div className="ajn-op-empty compact"><ReceiptText /><h3>لا توجد عملية مالية منشورة</h3><p>تظهر هنا العمليات المرتبطة بالحجز من الصندوق الرئيسي من دون إنشاء قيد مكرر.</p></div>}</section></div></QueryState></div>;
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
  return <div className="ajn-op-timeline">{rows.map((row) => <article key={row.id}><i /><time>{new Date(row.createdAt).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><div><strong>{row.title}</strong><p>{row.body || row.type}</p><small>{row.actorName || "النظام"}</small></div></article>)}</div>;
}
