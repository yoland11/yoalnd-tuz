import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, Car, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, FileText, Gauge, Loader2, PenLine, Plus, Printer, Route, TriangleAlert, UsersRound, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import VehiclePartnership from "./vehicle-partnership";
import VehiclePartnerPanel, { monthLabel, partnerQueryKey } from "./vehicle-partner-panel";
import { TransportReceiptAction } from "@/components/transport-receipt-dialog";
import { lastDayOfMonth, nextMonth } from "@/lib/vehicle-partner-share";
const transportMoney=(value:number|null|undefined)=>value==null?"غير موزّع":formatCurrency(value);

type Stats = { tripCount: number; transportationRevenue: number|null; vehicleExpenses: number; netProfit: number|null };
type Vehicle = { id: number; name: string; plateNumber: string; manufacturer?: string | null; model?: string | null; manufactureYear?: number | null; color?: string | null; vehicleType?: string | null; vin?: string | null; defaultDriverId?: number | null; odometerKm: number; purchaseDate?: string | null; purchasePrice: number; imageUrl?: string | null; status: string; notes?: string | null; isActive: boolean; stats: Stats };
type Driver = { id: number; fullName?: string | null; username?: string | null; isActive?: boolean };
type Financial = { summary: Stats & { categories: Record<string, number>; allocatedTransportationRevenue?: number; unallocatedBookings?: number }; trips: Array<{ source?: "kosha" | "service"; bookingId: number; bookingNo: string; customerName: string; eventDate?: string | null; driverName?: string | null; transportationFee: number|null; executedTransportationRevenue: number|null; tripExpense: number; tripProfit: number|null; operations?: Array<{id:string;sequence:number;destination:string|null;driverName:string|null}>; paymentStatus?: string | null }>; expenses: Array<{ id: number; date: string; expenseType?: string; expenseTypeLabel: string; amount: number; effectiveAmount: number; source?: "kosha" | "service"; bookingId?: number | null; bookingNo?: string | null; cashbox: string; status: string; description?: string | null }> };
type Detail = { vehicle: Vehicle & { defaultDriverName?: string | null }; maintenance: Array<{ id: number; maintenanceType: string; maintenanceDate: string; odometerKm?: number | null; cost: number; workshopVendor?: string | null; description?: string | null; nextMaintenanceDate?: string | null; nextMaintenanceOdometer?: number | null }>; odometerHistory: Array<{ id: number; previousKm: number; newKm: number; source: string; note?: string | null; createdAt: string }> };

const statusLabel: Record<string, string> = { available: "متاحة", outside: "في مهمة", maintenance: "في صيانة", inactive: "متوقفة" };
const typeLabel: Record<string, string> = { car: "سيارة", pickup: "بيك أب", van: "فان", truck: "شاحنة", transport: "مركبة نقل", other: "أخرى" };
const maintenanceLabel: Record<string, string> = { oil_change: "تغيير زيت", filters: "فلاتر", tires: "إطارات", brakes: "فرامل", battery: "بطارية", general: "صيانة عامة", other: "أخرى" };
/** Same codes and labels as the server's vehicle expense types; the common ones first. */
export const vehicleExpenseTypes = [["fuel", "وقود"], ["driver_wage", "أجرة سائق"], ["repair", "تصليح"], ["maintenance", "صيانة"], ["oil_change", "تبديل زيت"], ["tires", "إطارات"], ["spare_parts", "قطع غيار"], ["washing", "غسيل"], ["fees_parking", "رسوم / مواقف"], ["insurance", "تأمين"], ["registration", "تسجيل / ترخيص"], ["other", "مصروف آخر"]] as const;
const expenseStatus: Record<string, { label: string; tone: string }> = {
  executed: { label: "منفذ", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
  pending: { label: "بانتظار الموافقة", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  partially_reversed: { label: "معكوس جزئياً", tone: "bg-muted text-foreground" },
  reversed: { label: "معكوس", tone: "bg-muted text-muted-foreground" },
  rejected: { label: "مرفوض", tone: "bg-muted text-muted-foreground" },
  cancelled: { label: "ملغي", tone: "bg-muted text-muted-foreground" },
};

const blankVehicle = () => ({ name: "", plateNumber: "", manufacturer: "", model: "", manufactureYear: "", color: "", vehicleType: "car", defaultDriverId: "", odometerKm: "0", purchaseDate: "", purchasePrice: "0", imageUrl: "", notes: "", status: "available" });
function uid(prefix: string) { return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function baghdadToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}
function previousMonth(month: string) { const [year, mm] = month.split("-").map(Number); return mm === 1 ? `${year - 1}-12` : `${year}-${String(mm - 1).padStart(2, "0")}`; }

function Shell({ children }: { children: React.ReactNode }) { return <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">{children}</div>; }
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <section className={`rounded-2xl border border-border/40 bg-card p-4 shadow-sm ${className}`}>{children}</section>; }
function Stat({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) { return <div className="rounded-xl border border-border/30 bg-background/55 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</p></div>; }

const vehicleDailyTabs = [
  { value: "trips", label: "الرحلات", icon: Route },
  { value: "expenses", label: "المصاريف", icon: CircleDollarSign },
  { value: "partner", label: "الشريك والأرباح", icon: UsersRound },
] as const;
const vehicleAdvancedTabs = [
  { value: "overview", label: "بيانات السيارة", icon: Car },
  { value: "maintenance", label: "الصيانة", icon: Wrench },
  { value: "history", label: "سجل العداد", icon: FileText },
  { value: "partnership", label: "المحاسبة التفصيلية", icon: ClipboardList },
] as const;
type VehicleTab = typeof vehicleDailyTabs[number]["value"] | typeof vehicleAdvancedTabs[number]["value"];

export function initialVehicleTab(search: string): VehicleTab {
  const tab = new URLSearchParams(search).get("tab");
  return [...vehicleDailyTabs, ...vehicleAdvancedTabs].find(item => item.value === tab)?.value ?? "trips";
}

export function vehicleTabHref(path: string, search: string, tab: VehicleTab) {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return `${path}?${params.toString()}`;
}

/** Daily views first; the rest under «المزيد». The older detailed partnership
 * accounting appears only for a vehicle that has it, or when a link asks for it. */
export function VehicleAccountNavigation({ tab, onChange, detailedAccounting = false }: { tab: VehicleTab; onChange: (tab: VehicleTab) => void; detailedAccounting?: boolean }) {
  const renderTab = ({ value, label, icon: Icon }: typeof vehicleDailyTabs[number] | typeof vehicleAdvancedTabs[number]) => (
    <Button key={value} variant={tab === value ? "default" : "ghost"} aria-pressed={tab === value} className="min-h-10 flex-1 gap-2 px-3 sm:flex-none" onClick={() => onChange(value)}>
      <Icon className="hidden h-4 w-4 sm:block" />{label}
    </Button>
  );
  const advanced = vehicleAdvancedTabs.filter(item => item.value !== "partnership" || detailedAccounting || tab === "partnership");
  return <div className="flex flex-wrap items-start gap-2">
    <nav aria-label="التنقل اليومي للمركبة" className="flex w-full gap-1 rounded-xl bg-muted/50 p-1 sm:w-auto">{vehicleDailyTabs.map(renderTab)}</nav>
    <details open={advanced.some(item => item.value === tab) || undefined} className="group">
      <summary className="flex min-h-12 w-fit cursor-pointer list-none items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">المزيد<ChevronLeft className="ms-1 h-4 w-4 transition-transform group-open:-rotate-90" /></summary>
      <nav aria-label="تفاصيل المركبة المتقدمة" className="mt-1 flex flex-wrap gap-1">{advanced.map(renderTab)}</nav>
    </details>
  </div>;
}

export default function VehiclesPage() {
  const [location] = useLocation();
  const id = useMemo(() => { const match = location.match(/^\/admin\/vehicles\/(\d+)/); return match ? Number(match[1]) : null; }, [location]);
  return id ? <VehicleDetail key={id} vehicleId={id} /> : <VehiclesList />;
}

function VehiclesList() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [query, setQuery] = useState(""); const [status, setStatus] = useState(""); const [dialog, setDialog] = useState(false); const [editing, setEditing] = useState<Vehicle | null>(null); const [form, setForm] = useState(blankVehicle());
  const vehicles = useQuery<{ data: Vehicle[] }>({ queryKey: ["admin", "vehicles"], queryFn: () => adminFetch("/admin/enterprise/vehicles") });
  const drivers = useQuery<Driver[]>({ queryKey: ["admin", "vehicle-drivers"], queryFn: () => adminFetch("/admin/staff") });
  const save = useMutation({ mutationFn: () => adminFetch(editing ? `/admin/enterprise/vehicles/${editing.id}` : "/admin/enterprise/vehicles", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...form, manufactureYear: form.manufactureYear ? Number(form.manufactureYear) : null, defaultDriverId: form.defaultDriverId ? Number(form.defaultDriverId) : null, odometerKm: Number(form.odometerKm || 0), purchasePrice: Number(form.purchasePrice || 0), purchaseDate: form.purchaseDate || null, imageUrl: form.imageUrl || null }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "vehicles"] }); setDialog(false); toast({ title: editing ? "تم تحديث السيارة" : "تمت إضافة السيارة" }); }, onError: (error) => toast({ title: "تعذر حفظ السيارة", description: apiErrorMessage(error), variant: "destructive" }) });
  const rows = (vehicles.data?.data ?? []).filter((row) => (!query || `${row.name} ${row.plateNumber} ${row.model ?? ""}`.toLowerCase().includes(query.toLowerCase())) && (!status || row.status === status));
  const open = (vehicle?: Vehicle) => { setEditing(vehicle ?? null); setForm(vehicle ? { name: vehicle.name, plateNumber: vehicle.plateNumber, manufacturer: vehicle.manufacturer ?? "", model: vehicle.model ?? "", manufactureYear: vehicle.manufactureYear ? String(vehicle.manufactureYear) : "", color: vehicle.color ?? "", vehicleType: vehicle.vehicleType ?? "car", defaultDriverId: vehicle.defaultDriverId ? String(vehicle.defaultDriverId) : "", odometerKm: String(vehicle.odometerKm ?? 0), purchaseDate: vehicle.purchaseDate?.slice(0, 10) ?? "", purchasePrice: String(vehicle.purchasePrice ?? 0), imageUrl: vehicle.imageUrl ?? "", notes: vehicle.notes ?? "", status: vehicle.status } : blankVehicle()); setDialog(true); };
  return <Shell><header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-primary">إدارة وتشغيل</p><h1 className="text-2xl font-bold">المركبات</h1><p className="mt-1 text-sm text-muted-foreground">رحلات كل سيارة ومصاريفها وأرباحها.</p></div><Button className="gap-2" onClick={() => open()}><Plus className="h-4 w-4" />إضافة سيارة</Button></header><Card><div className="grid gap-2 sm:grid-cols-3"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو رقم اللوحة أو الموديل" /><select aria-label="حالة السيارة" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Link href="/admin/command-center?tab=vehicle-profitability" className="inline-flex h-10 items-center justify-center rounded-md border border-border/50 px-3 text-sm font-medium hover:border-primary/50">تقرير المركبات</Link></div></Card><UnassignedTransport />{vehicles.isLoading ? <Card>جاري تحميل المركبات…</Card> : vehicles.isError ? <Card><p role="alert" className="text-sm text-destructive">تعذر تحميل المركبات: {apiErrorMessage(vehicles.error)}</p><Button variant="outline" className="mt-3" onClick={() => void vehicles.refetch()}>إعادة المحاولة</Button></Card> : !rows.length ? <Card><div className="py-12 text-center text-muted-foreground">لا توجد مركبات مطابقة. أضف أول سيارة لبدء تتبع الرحلات والمصاريف.</div></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((vehicle) => <Card key={vehicle.id} className="space-y-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3">{vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Car className="h-6 w-6" /></span>}<div className="min-w-0"><h2 className="truncate font-bold">{vehicle.name}</h2><p className="mt-1 text-xs text-muted-foreground">{vehicle.plateNumber} · {vehicle.model || typeLabel[vehicle.vehicleType ?? ""] || "—"}</p></div></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{statusLabel[vehicle.status] ?? vehicle.status}</span></div><div className="grid grid-cols-3 gap-2"><Stat label="الرحلات" value={vehicle.stats.tripCount} /><Stat label="دخل النقل" value={transportMoney(vehicle.stats.transportationRevenue)} /><Stat label="الصافي" value={transportMoney(vehicle.stats.netProfit)} tone={vehicle.stats.netProfit != null && vehicle.stats.netProfit < 0 ? "text-destructive" : "text-primary"} /></div><div className="flex flex-wrap gap-2"><Link href={`/admin/vehicles/${vehicle.id}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"><Car className="h-4 w-4" />عرض</Link><Button variant="outline" size="sm" className="gap-2" onClick={() => open(vehicle)}><PenLine className="h-4 w-4" />تعديل</Button><Link href={`/admin/vehicles/${vehicle.id}?tab=partner`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border/50 px-3 text-sm"><UsersRound className="h-4 w-4" />الشريك والأرباح</Link></div></Card>)}</div>}<VehicleDialog open={dialog} onOpenChange={setDialog} form={form} setForm={setForm} editing={editing} pending={save.isPending} onSave={() => save.mutate()} drivers={drivers.data ?? []} /></Shell>;
}

type UnassignedTrip = { source: "kosha" | "service"; bookingId: number; bookingNo: string; customerName: string; eventDate?: string | null; fee: number; inTotal: boolean };

/** AJN transport saved without a vehicle reaches no vehicle's accounts; each row opens its booking's «خدمة النقل». */
function UnassignedTransport() {
  const [showAll, setShowAll] = useState(false);
  const query = useQuery<{ data: UnassignedTrip[]; truncated: boolean }>({ queryKey: ["admin", "vehicles", "unassigned-transport"], queryFn: () => adminFetch("/admin/enterprise/vehicles/unassigned-transport") });
  if (query.isError) return <Card className="flex flex-wrap items-center justify-between gap-3"><p role="alert" className="text-sm">تعذر تحميل حجوزات النقل بدون سيارة: {apiErrorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>إعادة المحاولة</Button></Card>;
  const rows = query.data?.data ?? [];
  if (!rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, 6);
  return <Card>
    <h2 className="font-bold">نقل بدون سيارة <span className="font-normal tabular-nums text-muted-foreground">({rows.length}{query.data?.truncated ? "+" : ""})</span></h2>
    <p className="mt-1 max-w-prose text-sm text-muted-foreground">أجرة هذه الحجوزات لا تُحسب لأي سيارة. افتح الحجز واختر السيارة من «خدمة النقل».</p>
    <ul className="mt-3 divide-y divide-border/40">{shown.map((row) => <li key={`${row.source}-${row.bookingId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.customerName || "—"}</p>
        <p className="mt-0.5 text-xs text-muted-foreground"><bdi>{row.bookingNo}</bdi> · <bdi dir="ltr">{row.eventDate?.slice(0, 10) || "بدون تاريخ"}</bdi> · {row.source === "kosha" ? "كوشة" : "خدمة"}</p>
        {!row.inTotal ? <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">تُضاف الأجرة إلى مبلغ الحجز عند اختيار السيارة</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tabular-nums">{formatCurrency(row.fee)}</span>
        <Link href={`/admin/bookings/${row.source}/${row.bookingId}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border/50 px-3 text-sm font-medium hover:border-primary/50"><Car className="h-4 w-4" />اختيار السيارة</Link>
      </div>
    </li>)}</ul>
    {rows.length > 6 ? <Button variant="ghost" size="sm" className="mt-1" onClick={() => setShowAll((value) => !value)}>{showAll ? "عرض أقل" : `عرض الكل (${rows.length})`}</Button> : null}
  </Card>;
}

function VehicleDialog({ open, onOpenChange, form, setForm, editing, pending, onSave, drivers }: { open: boolean; onOpenChange: (open: boolean) => void; form: ReturnType<typeof blankVehicle>; setForm: (form: ReturnType<typeof blankVehicle>) => void; editing: Vehicle | null; pending: boolean; onSave: () => void; drivers: Driver[] }) { const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value }); return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent dir="rtl" className="max-h-[92dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "تعديل السيارة" : "إضافة سيارة"}</DialogTitle><DialogDescription>بيانات السيارة لا تغيّر أي رحلة أو حركة مالية سابقة.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{([['name','اسم السيارة *'],['plateNumber','رقم اللوحة *'],['manufacturer','الشركة المصنعة'],['model','الموديل'],['manufactureYear','سنة الصنع'],['color','لون السيارة'],['odometerKm','العداد الحالي KM'],['purchaseDate','تاريخ الشراء'],['purchasePrice','سعر الشراء'],['imageUrl','رابط صورة السيارة']] as const).map(([key,label]) => <label key={key} className="text-sm"><span className="text-muted-foreground">{label}</span><Input className="mt-1" type={key === 'purchaseDate' ? 'date' : ['manufactureYear','odometerKm','purchasePrice'].includes(key) ? 'number' : key === 'imageUrl' ? 'url' : 'text'} min={['manufactureYear','odometerKm','purchasePrice'].includes(key) ? '0' : undefined} value={form[key]} onChange={(e) => set(key, e.target.value)} /></label>)}<label className="text-sm"><span className="text-muted-foreground">نوع المركبة</span><select value={form.vehicleType} onChange={(e) => set('vehicleType', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3">{Object.entries(typeLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm"><span className="text-muted-foreground">السائق الافتراضي</span><select value={form.defaultDriverId} onChange={(e) => set('defaultDriverId', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"><option value="">بدون تحديد</option>{drivers.filter((driver) => driver.isActive !== false).map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName || driver.username || `#${driver.id}`}</option>)}</select></label><label className="text-sm"><span className="text-muted-foreground">الحالة</span><select value={form.status} onChange={(e) => set('status', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3">{Object.entries(statusLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="sm:col-span-2 text-sm"><span className="text-muted-foreground">ملاحظات</span><Textarea className="mt-1" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label></div><DialogFooter className="gap-2 sm:justify-start"><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button disabled={pending || !form.name.trim() || !form.plateNumber.trim()} onClick={onSave}>{pending && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}حفظ السيارة</Button></DialogFooter></DialogContent></Dialog> }

/** A month, or every month when null. Months read as numbers, like the date picker. */
export function MonthSwitcher({ month, thisMonth, onChange }: { month: string | null; thisMonth: string; onChange: (month: string | null) => void }) {
  const shown = month ?? thisMonth;
  return <div className="flex flex-wrap items-center gap-2" role="group" aria-label="فترة الحساب">
    <div className="flex items-center rounded-xl border border-border/60 bg-card">
      <Button variant="ghost" size="icon" aria-label="الشهر السابق" onClick={() => onChange(previousMonth(shown))}><ChevronRight className="h-4 w-4" /></Button>
      <span className="min-w-[6.5rem] text-center text-sm font-semibold tabular-nums">{month ? <bdi dir="ltr">{monthLabel(month)}</bdi> : "كل الفترات"}</span>
      <Button variant="ghost" size="icon" aria-label="الشهر التالي" disabled={month != null && month >= thisMonth} onClick={() => onChange(month ? nextMonth(month) : thisMonth)}><ChevronLeft className="h-4 w-4" /></Button>
    </div>
    {month !== thisMonth ? <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>هذا الشهر</Button> : null}
    {month != null ? <Button variant="ghost" size="sm" onClick={() => onChange(null)}>كل الفترات</Button> : null}
  </div>;
}

function VehicleDetail({ vehicleId }: { vehicleId: number }) {
  const { toast } = useToast(); const qc = useQueryClient(); const [location, setLocation] = useLocation(); const search = useSearch();
  const thisMonth = baghdadToday().slice(0, 7);
  const [tab, setTab] = useState<VehicleTab>(() => initialVehicleTab(search));
  const [month, setMonth] = useState<string | null>(() => { const value = new URLSearchParams(search).get("month"); return value === "all" ? null : value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : thisMonth; });
  const [maintenanceOpen, setMaintenanceOpen] = useState(false); const [expenseOpen, setExpenseOpen] = useState(false); const [odometer, setOdometer] = useState("");
  useEffect(() => { setTab(initialVehicleTab(search)); }, [search]);
  const selectTab = (next: VehicleTab) => { setTab(next); setLocation(vehicleTabHref(location, search, next), { replace: true }); };
  const selectMonth = (next: string | null) => { setMonth(next); const params = new URLSearchParams(search); params.set("month", next ?? "all"); setLocation(`${location}?${params}`, { replace: true }); };
  const range = month ? { from: `${month}-01`, to: lastDayOfMonth(month) } : null;
  const detail = useQuery<Detail>({ queryKey: ["admin", "vehicle", vehicleId, "detail"], queryFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicleId}/details`) });
  const financial = useQuery<Financial>({ queryKey: ["admin", "vehicle", vehicleId, "financial", month ?? "all"], queryFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicleId}/financial${range ? `?${new URLSearchParams(range)}` : ""}`), placeholderData: (previous) => previous });
  // Only to know whether to offer the older detailed partnership screen.
  const detailed = useQuery<{ partnership: unknown | null }>({ queryKey: ["vehicle-partnership", vehicleId, "setup"], queryFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicleId}/partnership`), staleTime: 60_000, retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "vehicle", vehicleId] }); qc.invalidateQueries({ queryKey: ["admin", "vehicles"] }); qc.invalidateQueries({ queryKey: ["admin", "enterprise", "vehicle-financial"] }); };
  const updateOdometer = useMutation({ mutationFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicleId}/odometer`, { method: "POST", body: JSON.stringify({ newKm: Number(odometer), note: "تحديث يدوي" }) }), onSuccess: () => { setOdometer(""); refresh(); toast({ title: "تم تحديث العداد وحفظ السجل" }); }, onError: (e) => toast({ title: "تعذر تحديث العداد", description: apiErrorMessage(e), variant: "destructive" }) });
  const vehicle = detail.data?.vehicle; const summary = financial.data?.summary;
  const readFailure = (detail.isError || financial.isError) ? <Card><p role="alert" className="text-sm text-destructive">تعذر تحميل حساب السيارة: {apiErrorMessage(detail.error ?? financial.error)}</p><Button variant="outline" className="mt-3" onClick={() => { void detail.refetch(); void financial.refetch(); }}>إعادة المحاولة</Button></Card> : null;
  if (detail.isLoading || financial.isLoading) return <Shell><Card>جاري تحميل بيانات السيارة…</Card></Shell>; if ((detail.isError && !detail.data) || (financial.isError && !financial.data)) return <Shell>{readFailure}</Shell>; if (!vehicle) return <Shell><Card>تعذر العثور على السيارة.</Card></Shell>;
  const unallocated = summary?.unallocatedBookings ?? 0;
  const income = summary?.transportationRevenue ?? summary?.allocatedTransportationRevenue ?? null;
  const net = income == null ? null : income - (summary?.vehicleExpenses ?? 0);
  return <Shell>{readFailure}
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">{vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Car className="h-7 w-7" /></span>}
        <div className="min-w-0"><Button variant="ghost" size="sm" className="-ms-2 mb-0.5 h-7 gap-1 px-2 text-muted-foreground" onClick={() => setLocation("/admin/vehicles")}><ArrowRight className="h-4 w-4" />المركبات</Button><h1 className="break-words text-2xl font-bold">{vehicle.name}</h1><p className="mt-0.5 text-sm text-muted-foreground"><bdi dir="ltr">{vehicle.plateNumber}</bdi> · {vehicle.model || typeLabel[vehicle.vehicleType ?? ""] || "—"} · {vehicle.defaultDriverName || "بدون سائق ثابت"}</p></div>
      </div>
      <div className="flex gap-2"><Button variant="ghost" size="icon" aria-label="طباعة الكشف" title="طباعة الكشف" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button><Button className="gap-2" onClick={() => setExpenseOpen(true)}><Plus className="h-4 w-4" />إضافة مصروف</Button></div>
    </header>

    <section aria-label="حساب الفترة" className="space-y-3">
      <MonthSwitcher month={month} thisMonth={thisMonth} onChange={selectMonth} />
      <dl className={`grid grid-cols-[repeat(2,minmax(0,1fr))] gap-px overflow-hidden rounded-2xl border border-border/50 bg-border/50 sm:grid-cols-4 ${financial.isFetching ? "opacity-70" : ""}`}>
        <div className="bg-card p-3 sm:p-4"><dt className="text-xs text-muted-foreground">الرحلات</dt><dd className="mt-1 text-lg font-bold tabular-nums">{summary?.tripCount ?? 0}</dd></div>
        <div className="bg-card p-3 sm:p-4"><dt className="text-xs text-muted-foreground">دخل النقل</dt><dd className="mt-1 text-lg font-bold tabular-nums">{income == null ? "—" : formatCurrency(income)}</dd></div>
        <div className="bg-card p-3 sm:p-4"><dt className="text-xs text-muted-foreground">المصاريف</dt><dd className="mt-1 text-lg font-bold tabular-nums">{formatCurrency(summary?.vehicleExpenses ?? 0)}</dd></div>
        <div className="bg-card p-3 sm:p-4"><dt className="text-xs text-muted-foreground">الصافي</dt><dd className={`mt-1 text-lg font-bold tabular-nums ${net != null && net < 0 ? "text-destructive" : "text-primary"}`}>{net == null ? "—" : formatCurrency(net)}</dd></div>
      </dl>
      {unallocated ? <p className="flex items-start gap-2 text-xs leading-5 text-amber-800 dark:text-amber-300"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{unallocated} حجز بأجرة كلية لعدة سيارات ما محسوب بدخل هذه السيارة. افتح الحجز وحدد أجرة كل رحلة.</p> : null}
    </section>

    <VehicleAccountNavigation tab={tab} onChange={selectTab} detailedAccounting={Boolean(detailed.data?.partnership)} />
    {tab === "overview" && <div className="grid gap-4 lg:grid-cols-2"><Card><h2 className="font-bold">بيانات المركبة</h2><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><dt className="text-muted-foreground">الشركة/الموديل</dt><dd>{vehicle.manufacturer || "—"} {vehicle.model || ""}</dd><dt className="text-muted-foreground">اللون</dt><dd>{vehicle.color || "—"}</dd><dt className="text-muted-foreground">تاريخ الشراء</dt><dd>{vehicle.purchaseDate?.slice(0,10) || "—"}</dd><dt className="text-muted-foreground">قيمة الشراء</dt><dd>{formatCurrency(vehicle.purchasePrice)}</dd><dt className="text-muted-foreground">الحالة</dt><dd>{statusLabel[vehicle.status] ?? vehicle.status}</dd><dt className="text-muted-foreground">العداد</dt><dd className="tabular-nums">{Number(vehicle.odometerKm ?? 0).toLocaleString("ar-IQ-u-nu-latn")} كم</dd></dl>{vehicle.notes && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">{vehicle.notes}</p>}</Card><Card><h2 className="font-bold">تحديث العداد</h2><p className="mt-1 text-xs text-muted-foreground">يحفظ كل تحديث كسجل مستقل ولا يسمح بتقليل القراءة.</p><div className="mt-4 flex gap-2"><Input type="number" min="0" placeholder="قراءة العداد الجديدة" value={odometer} onChange={(e) => setOdometer(e.target.value)} /><Button disabled={!odometer || updateOdometer.isPending} onClick={() => updateOdometer.mutate()}><Gauge className="ms-2 h-4 w-4" />حفظ</Button></div></Card></div>}
    {tab === "trips" && <VehicleTrips rows={financial.data?.trips ?? []} />}
    {tab === "expenses" && <Expenses rows={financial.data?.expenses ?? []} onAdd={() => setExpenseOpen(true)} />}
    {tab === "partner" && <VehiclePartnerPanel vehicleId={vehicleId} vehicleName={vehicle.name} />}
    {tab === "maintenance" && <Maintenance vehicleId={vehicleId} rows={detail.data?.maintenance ?? []} open={maintenanceOpen} setOpen={setMaintenanceOpen} refresh={refresh} />}
    {tab === "history" && <Card><h2 className="font-bold">سجل العداد</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[600px] text-right text-sm"><thead className="border-b text-muted-foreground"><tr><th className="p-2">التاريخ</th><th>السابق</th><th>الجديد</th><th>الفرق</th><th>المصدر</th><th>ملاحظة</th></tr></thead><tbody>{(detail.data?.odometerHistory ?? []).map((row) => <tr key={row.id} className="border-b border-border/20"><td className="p-2">{new Date(row.createdAt).toLocaleDateString("ar-IQ-u-nu-latn")}</td><td>{row.previousKm}</td><td>{row.newKm}</td><td>{row.newKm-row.previousKm}</td><td>{row.source}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div></Card>}
    {tab === "partnership" && <VehiclePartnership vehicleId={vehicleId} />}
    {expenseOpen ? <VehicleExpenseDialog vehicleId={vehicleId} trips={financial.data?.trips ?? []} onClose={() => setExpenseOpen(false)} onSaved={() => { refresh(); qc.invalidateQueries({ queryKey: partnerQueryKey(vehicleId) }); }} /> : null}
  </Shell>;
}

/** One vehicle expense request; it leaves the main cash box only after approval. */
function VehicleExpenseDialog({ vehicleId, trips, onClose, onSaved }: { vehicleId: number; trips: Financial["trips"]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ expenseType: "fuel", amount: "", expenseDate: baghdadToday(), paymentMethod: "cash", booking: "", description: "" });
  const [key, setKey] = useState(() => uid("vehicle-expense"));
  const set = (field: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [field]: value })); setKey(uid("vehicle-expense")); };
  const save = useMutation({
    mutationFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicleId}/expenses`, { method: "POST", body: JSON.stringify({
      expenseType: form.expenseType, amount: Number(form.amount), expenseDate: form.expenseDate, paymentMethod: form.paymentMethod,
      bookingId: form.booking.startsWith("kosha:") ? Number(form.booking.slice(6)) : null,
      serviceOrderId: form.booking.startsWith("service:") ? Number(form.booking.slice(8)) : null,
      description: form.description.trim() || null, attachments: [], idempotencyKey: key,
    }) }),
    onSuccess: () => { onSaved(); onClose(); toast({ title: "انرسل المصروف للموافقة", description: "ينحسب على السيارة وينخصم من الصندوق بعد الموافقة." }); },
    onError: (error) => toast({ title: "تعذر تسجيل المصروف", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const field = "mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm";
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent dir="rtl" className="max-h-[92dvh] max-w-md overflow-y-auto">
      <DialogHeader><DialogTitle>إضافة مصروف للسيارة</DialogTitle><DialogDescription>بانزين، أجرة سائق، تصليح أو أي مصروف ثاني.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <fieldset disabled={save.isPending} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm"><span>نوع المصروف</span><select className={field} value={form.expenseType} onChange={(event) => set("expenseType", event.target.value)}>{vehicleExpenseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm"><span>المبلغ — د.ع</span><Input className="mt-1.5" required inputMode="decimal" dir="ltr" value={form.amount} onChange={(event) => set("amount", event.target.value.replace(/[^0-9.]/g, ""))} /></label>
            <label className="text-sm"><span>التاريخ</span><Input className="mt-1.5" type="date" required value={form.expenseDate} onChange={(event) => set("expenseDate", event.target.value)} /></label>
            <label className="text-sm"><span>الدفع</span><select className={field} value={form.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value)}><option value="cash">نقدي</option><option value="transfer">تحويل</option><option value="pos">بطاقة</option></select></label>
          </div>
          {trips.length ? <label className="block text-sm"><span>لحجز معيّن (اختياري)</span><select className={field} value={form.booking} onChange={(event) => set("booking", event.target.value)}><option value="">مصروف عام للسيارة</option>{trips.map((trip) => <option key={`${trip.source ?? "kosha"}-${trip.bookingId}`} value={`${trip.source ?? "kosha"}:${trip.bookingId}`}>{trip.bookingNo} · {trip.customerName}</option>)}</select></label> : null}
          <label className="block text-sm"><span>ملاحظة (اختياري)</span><Textarea className="mt-1.5" rows={2} maxLength={2000} value={form.description} onChange={(event) => set("description", event.target.value)} /></label>
        </fieldset>
        <DialogFooter className="gap-2 sm:justify-start"><Button type="submit" disabled={save.isPending || !(Number(form.amount) > 0) || !form.expenseDate} className="gap-2">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}إرسال للموافقة</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>إلغاء</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function VehicleTrips({ rows }: { rows: Financial["trips"] }) {
  return <Card className="p-0">
    {rows.length ? <ul className="divide-y divide-border/40">{rows.map(row => <li key={`${row.source ?? "kosha"}-${row.bookingId}`}><article aria-label={`رحلة الحجز ${row.bookingNo}`} className="min-w-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{row.customerName}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground"><Link href={`/admin/bookings/${row.source ?? "kosha"}/${row.bookingId}?tab=transport`} className="font-medium text-primary hover:underline"><bdi>{row.bookingNo}</bdi></Link> · <bdi dir="ltr">{row.eventDate?.slice(0,10) || "بدون تاريخ"}</bdi> · {row.driverName || "بدون سائق"}</p>
        </div>
        <p className="text-base font-bold tabular-nums">{transportMoney(row.transportationFee)}</p>
      </div>
      {row.transportationFee == null ? <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">أجرة كلية لعدة سيارات؛ حدد أجرة كل رحلة من الحجز حتى تنحسب لهذه السيارة.</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">{row.operations?.length ? row.operations.map(trip => <TransportReceiptAction key={trip.id} reference={{source:row.source ?? "kosha",id:row.bookingId,tripId:trip.id}} label={`وصل رحلة ${trip.sequence}${trip.destination ? ` · ${trip.destination}` : ""}`}/>) : <TransportReceiptAction reference={{source:row.source ?? "kosha",id:row.bookingId}}/>}</div>
    </article></li>)}</ul> : <p className="py-10 text-center text-sm text-muted-foreground">ما اكو رحلات بهذه الفترة.</p>}
  </Card>;
}

function Expenses({ rows, onAdd }: { rows: Financial["expenses"]; onAdd: () => void }) {
  return <Card className="p-0">
    {rows.length ? <ul className="divide-y divide-border/40">{rows.map((row) => { const status = expenseStatus[row.status] ?? { label: row.status, tone: "bg-muted text-foreground" }; return <li key={row.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4">
      <div className="min-w-0">
        <p className="font-semibold">{row.expenseTypeLabel}<span className={`ms-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span></p>
        <p className="mt-0.5 text-xs text-muted-foreground"><bdi dir="ltr">{row.date.slice(0,10)}</bdi>{row.bookingId ? <> · <Link href={`/admin/bookings/${row.source ?? "kosha"}/${row.bookingId}`} className="text-primary hover:underline"><bdi>{row.bookingNo}</bdi></Link></> : null}{row.description ? ` · ${row.description}` : ""}</p>
      </div>
      <p className={`font-bold tabular-nums ${row.effectiveAmount ? "" : "text-muted-foreground"}`}>{formatCurrency(row.amount)}</p>
    </li>; })}</ul> : <div className="py-10 text-center"><p className="text-sm text-muted-foreground">ما اكو مصاريف بهذه الفترة.</p><Button variant="outline" className="mt-3 gap-2" onClick={onAdd}><Plus className="h-4 w-4" />إضافة مصروف</Button></div>}
  </Card>;
}
function Maintenance({ vehicleId, rows, open, setOpen, refresh }: { vehicleId: number; rows: Detail["maintenance"]; open: boolean; setOpen: (v: boolean) => void; refresh: () => void }) { const { toast } = useToast(); const [form,setForm]=useState({maintenanceType:"oil_change",maintenanceDate:new Date().toISOString().slice(0,10),odometerKm:"",cost:"0",workshopVendor:"",description:"",nextMaintenanceDate:"",nextMaintenanceOdometer:""}); const create=useMutation({mutationFn:()=>adminFetch(`/admin/enterprise/vehicles/${vehicleId}/maintenance`,{method:"POST",body:JSON.stringify({...form,odometerKm:form.odometerKm?Number(form.odometerKm):null,cost:Number(form.cost||0),nextMaintenanceDate:form.nextMaintenanceDate||null,nextMaintenanceOdometer:form.nextMaintenanceOdometer?Number(form.nextMaintenanceOdometer):null})}),onSuccess:()=>{setOpen(false);refresh();toast({title:"تم تسجيل الصيانة"})},onError:(e)=>toast({title:"تعذر تسجيل الصيانة",description:apiErrorMessage(e),variant:"destructive"})}); return <><Card><div className="flex justify-between gap-3"><div><h2 className="font-bold">الصيانة</h2><p className="mt-1 text-xs text-muted-foreground">تكلفة الصيانة هنا سجل تشغيلي؛ إنشاء مصروف مالي يتم من «إضافة مصروف سيارة» لمنع التكرار.</p></div><Button className="gap-2" onClick={()=>setOpen(true)}><Plus className="h-4 w-4"/>تسجيل صيانة</Button></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-right text-sm"><thead className="border-b text-muted-foreground"><tr><th className="p-2">التاريخ</th><th>النوع</th><th>العداد</th><th>التكلفة المسجلة</th><th>الورشة</th><th>الصيانة القادمة</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id} className="border-b border-border/20"><td className="p-2">{row.maintenanceDate}</td><td>{maintenanceLabel[row.maintenanceType]||row.maintenanceType}</td><td>{row.odometerKm??"—"}</td><td>{formatCurrency(row.cost)}</td><td>{row.workshopVendor||"—"}</td><td>{row.nextMaintenanceDate||row.nextMaintenanceOdometer||"—"}</td></tr>)}{!rows.length&&<tr><td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد سجلات صيانة.</td></tr>}</tbody></table></div></Card><Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl"><DialogHeader><DialogTitle>تسجيل صيانة</DialogTitle><DialogDescription>للدفع الفعلي من الصندوق، أضف مصروف سيارة منفصلاً.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">نوع الصيانة<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" value={form.maintenanceType} onChange={e=>setForm({...form,maintenanceType:e.target.value})}>{Object.entries(maintenanceLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>{([['maintenanceDate','التاريخ'],['odometerKm','العداد'],['cost','التكلفة المسجلة'],['workshopVendor','الورشة'],['nextMaintenanceDate','تاريخ الصيانة القادمة'],['nextMaintenanceOdometer','عداد الصيانة القادمة']] as const).map(([key,label])=><label key={key} className="text-sm">{label}<Input className="mt-1" type={key.includes('Date')||key==='maintenanceDate'?'date':['odometerKm','cost','nextMaintenanceOdometer'].includes(key)?'number':'text'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<label className="sm:col-span-2 text-sm">الوصف<Textarea className="mt-1" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label></div><DialogFooter className="gap-2 sm:justify-start"><Button variant="outline" onClick={()=>setOpen(false)}>إلغاء</Button><Button disabled={create.isPending} onClick={()=>create.mutate()}>حفظ الصيانة</Button></DialogFooter></DialogContent></Dialog></> }
