import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  Archive, Ban, BarChart3, Bell, Boxes, CalendarDays, Camera, Check, ChevronRight, ClipboardList, CloudOff,
  Home, ImagePlus, Loader2, LogOut, MapPin, PackageCheck, Pencil, Phone, Plus, Printer, QrCode, ScanLine, Search,
  Send, Trash2, Undo2, Upload, User, Users, WalletCards, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatIraqiPhoneInput } from "@/lib/phone";
import { processImageFile } from "@/lib/image-tools";
import { apiErrorMessage, apiErrorStatus, fetchAdminMe, hasPerm, loginAdmin, logoutAdmin, type AdminMe } from "@/views/admin/_lib";
import { thermalReceiptCss, printWhenImagesReadyScript } from "@/views/admin/print-helpers";
import { formatCurrency } from "@/lib/money";
import { countOps, flushQueue, isQueued } from "../offline";
import {
  PHOTO_STAGES, PHOTO_STAGE_LABEL, newClientToken, photographyApi, photoMoney,
  readLocalEvent, saveLocalEvent, type PhotographyAsset, type PhotographyEvent, type PhotographyEventDetail,
  type PhotographyOrder, type PhotographyPrice, type PhotographyStage,
} from "./lib";
import { LiveScanner } from "../live-scanner";

const isPhotoManager = (me: AdminMe | null | undefined) => !!me && (me.role === "admin" || me.role === "manager");
const phoneDisplay = (phone: string | null | undefined) => (phone && phone.trim() ? phone : "غير مسجل");

const STATUS_TONE: Record<string, string> = {
  registered: "bg-status-warning/15 text-status-warning",
  editing: "bg-accent/15 text-accent",
  ready_print: "bg-accent/15 text-accent",
  ready_pickup: "bg-primary/15 text-primary",
  delivered: "bg-status-success/15 text-status-success",
};

const PAYMENT_TONE: Record<string, string> = {
  "مدفوع": "bg-status-success/15 text-status-success",
  "بانتظار الاعتماد": "bg-status-warning/15 text-status-warning",
  "مدفوع جزئياً": "bg-accent/15 text-accent",
  "غير مدفوع": "bg-destructive/15 text-destructive",
};

function PaymentBadge({ order }: { order: PhotographyOrder }) {
  const label = order.paymentLabel || (order.paymentStatus === "paid" ? "مدفوع" : "غير مدفوع");
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${PAYMENT_TONE[label] || "bg-muted text-muted-foreground"}`}>{label}</span>;
}

function Spinner() {
  return <div className="flex min-h-dvh items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
}

function PortalLogin({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await loginAdmin(username.trim(), password); onDone(); }
    catch (err: any) { setError(String(err?.message ?? "بيانات الدخول غير صحيحة").replace(/^HTTP\s+\d+:\s*/, "")); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-5" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border/40 bg-card p-5">
        <div className="text-center"><span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-xl bg-primary/10 text-primary"><Camera className="h-7 w-7" /></span><h1 className="text-xl font-bold text-foreground">بوابة المصورين</h1><p className="mt-1 text-sm text-muted-foreground">سجّل الدخول لإدارة مناسباتك</p></div>
        {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="اسم المستخدم" autoComplete="username" />
        <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="كلمة المرور" autoComplete="current-password" />
        <Button className="w-full" disabled={busy || !username || !password}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "دخول"}</Button>
      </form>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Camera }) {
  return <div className="rounded-xl border border-border/30 bg-card p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{label}</span><Icon className="h-4 w-4 text-primary" /></div><div className="mt-2 text-xl font-bold text-foreground">{value}</div></div>;
}

function EventCard({ event }: { event: PhotographyEvent }) {
  return (
    <Link href={`/staff/photography/events/${event.clientToken}/register`} className="block rounded-xl border border-border/30 bg-card p-3 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold text-foreground">{event.eventName || `مناسبة ${event.groomName}`}</div><div className="mt-1 text-xs text-muted-foreground">العريس: {event.groomName}</div>{event.location ? <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{event.location}</div> : null}</div><div className="text-left"><div className="text-xs font-semibold text-primary">{event.eventDate}</div><div className="mt-1 text-[11px] text-muted-foreground">{event.orderCount} طلب</div></div></div>
    </Link>
  );
}

function OrderCard({ order, compact = false }: { order: PhotographyOrder; compact?: boolean }) {
  return (
    <Link href={`/staff/photography/orders/${order.id}`} className={`block rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 active:scale-[0.99] ${order.cancelledAt ? "border-destructive/40 opacity-70" : "border-border/30"}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-mono text-sm font-bold text-primary">{order.orderNo}</div><div className="mt-1 font-semibold text-foreground">{order.customerName}</div><div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{phoneDisplay(order.phone)}</div>{!compact && order.event ? <div className="mt-1 text-xs text-muted-foreground">{order.event.eventName || order.event.groomName}</div> : null}</div><div className="flex flex-shrink-0 flex-col items-end gap-1">{order.cancelledAt ? <span className="rounded-full bg-destructive/15 px-2 py-1 text-[11px] font-bold text-destructive">ملغى</span> : <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${STATUS_TONE[order.status] || "bg-muted text-muted-foreground"}`}>{PHOTO_STAGE_LABEL[order.status] || order.status}</span>}<PaymentBadge order={order} /></div></div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/20 pt-3 text-xs"><div><span className="text-muted-foreground">المبلغ</span><div className="mt-1 font-semibold">{formatCurrency(order.totalAmount)}</div></div><div><span className="text-muted-foreground">المدفوع</span><div className="mt-1 font-semibold text-status-success">{formatCurrency(order.paidAmount)}</div></div><div><span className="text-muted-foreground">المتبقي</span><div className="mt-1 font-semibold text-destructive">{formatCurrency(order.remainingAmount)}</div></div></div>
      {order.pendingAmount > 0 ? <div className="mt-2 rounded-lg bg-status-warning/10 px-2 py-1 text-xs text-status-warning">{photoMoney(order.pendingAmount)} د.ع بانتظار اعتماد المدير</div> : null}
    </Link>
  );
}

function EventForm({ me }: { me: AdminMe }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const clientTokenRef = useRef(newClientToken());
  const [photographers, setPhotographers] = useState<Array<{ id: number; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ groomName: "", eventName: "", eventDate: new Date().toISOString().slice(0, 10), location: "", assignedStaffId: me.id });
  useEffect(() => { photographyApi.photographers().then((rows) => { setPhotographers(rows); if (rows.length === 1) setForm((current) => ({ ...current, assignedStaffId: rows[0].id })); }).catch(() => {}); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.groomName.trim() || !form.eventDate) return;
    setBusy(true);
    const clientToken = clientTokenRef.current;
    const localEvent = { ...form, clientToken, id: 0, assignedStaffName: photographers.find((item) => item.id === form.assignedStaffId)?.name || me.fullName || me.username, status: "active", orderCount: 0, createdAt: new Date().toISOString() } as PhotographyEvent;
    saveLocalEvent(localEvent);
    try {
      const result = await photographyApi.createEvent({ ...form, clientToken });
      if (!isQueued(result)) saveLocalEvent(result);
      toast({ title: isQueued(result) ? "تم حفظ المناسبة دون اتصال" : "تم بدء المناسبة", description: isQueued(result) ? "ستتم مزامنتها عند عودة الإنترنت." : "يمكنك الآن تسجيل طلبات الصور بسرعة." });
      navigate(`/staff/photography/events/${clientToken}/register`);
    } catch (err: any) { toast({ title: "تعذر بدء المناسبة", description: apiErrorMessage(err), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border/30 bg-card p-4">
      <div><h2 className="font-bold text-foreground">إنشاء مناسبة جديدة</h2><p className="mt-1 text-xs text-muted-foreground">ابدأ المناسبة ثم سجّل طلبات الزبائن من شاشة واحدة.</p></div>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">اسم العريس *</span><Input value={form.groomName} onChange={(event) => setForm({ ...form, groomName: event.target.value })} /></label>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">اسم المناسبة</span><Input value={form.eventName} onChange={(event) => setForm({ ...form, eventName: event.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1"><span className="text-xs text-muted-foreground">التاريخ *</span><Input type="date" value={form.eventDate} onChange={(event) => setForm({ ...form, eventDate: event.target.value })} /></label><label className="block space-y-1"><span className="text-xs text-muted-foreground">الموقع</span><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label></div>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">المصور المسؤول</span><select value={form.assignedStaffId} onChange={(event) => setForm({ ...form, assignedStaffId: Number(event.target.value) })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{photographers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Button className="w-full" disabled={busy || !form.groomName.trim() || !form.eventDate}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Camera className="ml-2 h-4 w-4" /> بدء المناسبة</>}</Button>
    </form>
  );
}

function Dashboard({ me }: { me: AdminMe }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof photographyApi.dashboard>> | null>(null);
  useEffect(() => { photographyApi.dashboard().then(setData).catch(() => {}); }, []);
  return <div className="space-y-5 p-4"><EventForm me={me} />{data ? <><div className="grid grid-cols-2 gap-2"><Stat label="مناسبات اليوم" value={data.counts.events} icon={CalendarDays} /><Stat label="طلبات اليوم" value={data.counts.orders} icon={ClipboardList} /><Stat label="جاهز للاستلام" value={data.counts.ready} icon={PackageCheck} /><Stat label="تم التسليم" value={data.counts.delivered} icon={Check} /></div>{data.recentOrders.length ? <section><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold">آخر الطلبات</h2><Link href="/staff/photography/orders" className="text-xs text-primary">عرض الكل</Link></div><div className="space-y-2">{data.recentOrders.slice(0, 3).map((order) => <OrderCard key={order.id} order={order} compact />)}</div></section> : null}</> : <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>}</div>;
}

function PhotographerFilter({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const [photographers, setPhotographers] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => { photographyApi.photographers().then(setPhotographers).catch(() => {}); }, []);
  if (photographers.length <= 1) return null;
  return <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-card px-3"><Users className="h-4 w-4 flex-shrink-0 text-muted-foreground" /><select value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-h-11 w-full bg-transparent text-sm outline-none"><option value={0}>كل المصورين</option>{photographers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>;
}

function EventsPage({ me }: { me: AdminMe }) {
  const manager = isPhotoManager(me);
  const [rows, setRows] = useState<PhotographyEvent[] | null>(null); const [search, setSearch] = useState(""); const [photographerId, setPhotographerId] = useState(0);
  useEffect(() => { const timer = setTimeout(() => photographyApi.events(search, { photographerId: photographerId || undefined }).then(setRows).catch(() => setRows([])), search ? 250 : 0); return () => clearTimeout(timer); }, [search, photographerId]);
  return <div className="space-y-3 p-4"><h1 className="text-lg font-bold">المناسبات</h1><SearchField value={search} onChange={setSearch} placeholder="بحث باسم العريس أو المناسبة..." />{manager ? <PhotographerFilter value={photographerId} onChange={setPhotographerId} /> : null}{rows === null ? <Loading /> : rows.length ? <div className="space-y-2">{rows.map((event) => <EventCard key={event.id || event.clientToken} event={event} />)}</div> : <Empty text="لا توجد مناسبات" />}</div>;
}

const DEFAULT_PRICES: PhotographyPrice[] = [
  { id: "p3000", amount: 3000 }, { id: "p4000", amount: 4000 }, { id: "p5000", amount: 5000 }, { id: "p10000", amount: 10000 },
];

const EMPTY_ORDER = { customerName: "", phone: "", copies: 1, notes: "", referenceImage: "" };

function SummaryStat({ label, value, tone = "text-foreground" }: { label: string; value: number | string; tone?: string }) {
  return <div className="rounded-lg border border-border/30 bg-card p-2 text-center"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`mt-1 text-base font-bold ${tone}`}>{value}</div></div>;
}

// Manager-only inline controls for an event: edit fields, archive/unarchive, delete (when empty).
function EventManagerBar({ event, onChanged }: { event: PhotographyEvent; onChanged: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photographers, setPhotographers] = useState<Array<{ id: number; name: string }>>([]);
  const [form, setForm] = useState({ groomName: event.groomName, eventName: event.eventName ?? "", eventDate: event.eventDate, location: event.location ?? "", assignedStaffId: 0 });
  useEffect(() => { if (open && !photographers.length) photographyApi.photographers().then(setPhotographers).catch(() => {}); }, [open, photographers.length]);
  async function save() {
    setBusy(true);
    try {
      await photographyApi.updateEvent(event.clientToken, { groomName: form.groomName, eventName: form.eventName, eventDate: form.eventDate, location: form.location, assignedStaffId: form.assignedStaffId || undefined });
      toast({ title: "تم تحديث المناسبة" }); setOpen(false); onChanged();
    } catch (err: any) { toast({ title: "تعذر التحديث", description: apiErrorMessage(err), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!window.confirm(event.status === "archived" ? "إلغاء أرشفة هذه المناسبة؟" : "أرشفة هذه المناسبة؟")) return;
    setBusy(true);
    try { await photographyApi.archiveEvent(event.clientToken); toast({ title: event.status === "archived" ? "تم إلغاء الأرشفة" : "تمت الأرشفة" }); onChanged(); }
    catch (err: any) { toast({ title: "تعذر التنفيذ", description: apiErrorMessage(err), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm("حذف هذه المناسبة نهائياً؟ لا يمكن التراجع.")) return;
    setBusy(true);
    try { await photographyApi.deleteEvent(event.clientToken); toast({ title: "تم حذف المناسبة" }); navigate("/staff/photography/events"); }
    catch (err: any) { toast({ title: "تعذر الحذف", description: apiErrorMessage(err), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-border/30 bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ml-auto text-[11px] font-semibold text-muted-foreground">أدوات المدير</span>
        <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1 rounded-lg border border-border/40 px-3 py-2 text-xs font-semibold"><Pencil className="h-3.5 w-3.5" /> تعديل</button>
        <button type="button" onClick={archive} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-status-warning/40 px-3 py-2 text-xs font-semibold text-status-warning"><Archive className="h-3.5 w-3.5" /> {event.status === "archived" ? "إلغاء الأرشفة" : "أرشفة"}</button>
        <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
      </div>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-border/20 pt-3">
          <label className="block space-y-1"><span className="text-xs text-muted-foreground">اسم العريس</span><Input value={form.groomName} onChange={(e) => setForm({ ...form, groomName: e.target.value })} /></label>
          <label className="block space-y-1"><span className="text-xs text-muted-foreground">اسم المناسبة</span><Input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1"><span className="text-xs text-muted-foreground">التاريخ</span><Input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} /></label><label className="block space-y-1"><span className="text-xs text-muted-foreground">الموقع</span><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label></div>
          <label className="block space-y-1"><span className="text-xs text-muted-foreground">إعادة تعيين المصور</span><select value={form.assignedStaffId} onChange={(e) => setForm({ ...form, assignedStaffId: Number(e.target.value) })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value={0}>— بدون تغيير ({event.assignedStaffName}) —</option>{photographers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <Button className="w-full" onClick={save} disabled={busy || !form.groomName.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ التعديلات"}</Button>
        </div>
      ) : null}
    </div>
  );
}

function RegistrationPage({ eventRef, me }: { eventRef: string; me: AdminMe }) {
  const { toast } = useToast();
  const manager = isPhotoManager(me);
  const clientTokenRef = useRef(newClientToken());
  const [detail, setDetail] = useState<PhotographyEventDetail | null>(null);
  const [prices, setPrices] = useState<PhotographyPrice[]>(DEFAULT_PRICES);
  const [form, setForm] = useState(EMPTY_ORDER);
  const [unitPrice, setUnitPrice] = useState(0);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const localEvent = readLocalEvent(eventRef);
  const loadDetail = useCallback(() => photographyApi.event(eventRef).then((row) => { setDetail(row); saveLocalEvent(row); }).catch(() => {}), [eventRef]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => { photographyApi.prices().then((rows) => { if (rows.length) setPrices(rows); }).catch(() => {}); }, []);
  useEffect(() => { setUnitPrice((current) => current || prices[0]?.amount || 0); }, [prices]);
  const event = detail ?? localEvent;
  const copies = Number(form.copies) || 0;
  const total = unitPrice * copies;
  async function image(file: File | null) { if (!file) return; try { const dataUrl = await processImageFile(file, { maxSize: 1400, quality: 0.78 }); setForm((current) => ({ ...current, referenceImage: dataUrl })); } catch { toast({ title: "تعذر تجهيز الصورة", variant: "destructive" }); } }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName.trim() || unitPrice <= 0 || copies < 1) return;
    setBusy(true);
    try {
      // Upload any locally-created (offline-queued) event to the server BEFORE creating its orders,
      // so the eventRef (clientToken) resolves to a real event and the POST doesn't 404.
      if (typeof navigator !== "undefined" && navigator.onLine) { try { await flushQueue(); } catch { /* best effort */ } }
      const result = await photographyApi.createOrder(eventRef, { customerName: form.customerName, phone: form.phone, copies, unitPrice, paid, notes: form.notes, referenceImage: form.referenceImage, clientToken: clientTokenRef.current });
      toast({ title: isQueued(result) ? "تم حفظ الطلب دون اتصال" : `تم حفظ الطلب ${result.orderNo}`, description: isQueued(result) ? "سيتم إنشاء الرقم وQR تلقائياً عند المزامنة." : "بقيت داخل نفس المناسبة لتسجيل المزيد." });
      setForm(EMPTY_ORDER); setPaid(false);
      clientTokenRef.current = newClientToken();
      if (!isQueued(result)) loadDetail();
    } catch (err: any) { toast({ title: "تعذر حفظ الطلب", description: apiErrorMessage(err), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  if (!event) return <Loading />;
  const summary = detail?.summary;
  const orders = detail?.orders ?? [];
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2 font-bold"><User className="h-4 w-4 flex-shrink-0 text-primary" /><span className="truncate">{event.eventName || `مناسبة ${event.groomName}`}</span></div>{event.status === "archived" ? <span className="flex-shrink-0 rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-bold text-status-warning">مؤرشفة</span> : null}</div>
        <div className="mt-1 text-xs text-muted-foreground">العريس: {event.groomName} • المصور: {event.assignedStaffName}</div>
        <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{event.eventDate}</span>{event.location ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{event.location}</span> : null}</div>
      </div>
      {manager ? <EventManagerBar event={event} onChanged={loadDetail} /> : null}
      {summary ? (
        <div className="grid grid-cols-3 gap-2">
          <SummaryStat label="الطلبات" value={summary.orders} />
          <SummaryStat label="إجمالي الصور" value={summary.copies} />
          <SummaryStat label="إجمالي المبالغ" value={formatCurrency(summary.total)} />
          <SummaryStat label="مدفوعة" value={summary.paidCount} tone="text-status-success" />
          <SummaryStat label="غير مدفوعة" value={summary.unpaidCount} tone="text-destructive" />
          <SummaryStat label="المتبقي" value={formatCurrency(summary.remaining)} tone="text-destructive" />
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-border/30 bg-card p-4">
        <h1 className="font-bold text-foreground">التسجيل السريع</h1>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">اسم الزبون *</span><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">رقم الهاتف (اختياري)</span><Input dir="ltr" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: formatIraqiPhoneInput(e.target.value) })} placeholder="077xxxxxxxx" /></label>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">عدد النسخ *</span><Input type="number" min="1" value={form.copies} onChange={(e) => setForm({ ...form, copies: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <div><span className="mb-2 block text-xs text-muted-foreground">اختيار السعر *</span><div className="grid grid-cols-2 gap-2">{prices.map((item) => <button key={item.id} type="button" onClick={() => setUnitPrice(item.amount)} className={`min-h-11 rounded-lg border text-sm font-semibold ${unitPrice === item.amount ? "border-primary bg-primary/10 text-primary" : "border-border/30 bg-background text-foreground"}`}>{photoMoney(item.amount)} د.ع</button>)}</div></div>
        <div><span className="mb-2 block text-xs text-muted-foreground">حالة الدفع *</span><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setPaid(true)} className={`min-h-11 rounded-lg border text-sm font-bold ${paid ? "border-status-success bg-status-success/10 text-status-success" : "border-border/30 bg-background text-foreground"}`}>مدفوع</button><button type="button" onClick={() => setPaid(false)} className={`min-h-11 rounded-lg border text-sm font-bold ${!paid ? "border-primary bg-primary/10 text-primary" : "border-border/30 bg-background text-foreground"}`}>غير مدفوع</button></div></div>
        <div className="rounded-lg bg-background p-3"><span className="text-xs text-muted-foreground">المبلغ الكلي ({photoMoney(unitPrice)} × {copies})</span><div className="mt-1 text-2xl font-bold text-primary">{photoMoney(total)} د.ع</div>{paid ? <p className="mt-1 text-[11px] text-status-warning">سيُرسل كامل المبلغ لاعتماد المدير قبل دخوله الصندوق.</p> : <p className="mt-1 text-[11px] text-muted-foreground">يبقى المبلغ مستحقاً ويمكن تحصيله لاحقاً من شاشة التسليم.</p>}</div>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">ملاحظات</span><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <label className="block cursor-pointer rounded-xl border border-dashed border-border/50 bg-background/50 p-3 text-center"><span className="mb-2 block text-xs text-muted-foreground">صورة تعريفية للمجموعة (اختياري)</span>{form.referenceImage ? <img src={form.referenceImage} alt="معاينة المجموعة" className="mx-auto h-36 w-full rounded-lg object-contain" /> : <span className="flex h-24 items-center justify-center"><ImagePlus className="h-6 w-6 text-primary" /></span>}<input type="file" accept="image/*" className="sr-only" onChange={(e) => void image(e.target.files?.[0] ?? null)} /></label>
        <Button className="w-full" disabled={busy || !form.customerName.trim() || unitPrice <= 0 || copies < 1}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="ml-2 h-4 w-4" /> حفظ الطلب</>}</Button>
      </form>
      <section className="space-y-2">
        <h2 className="text-sm font-bold">طلبات هذه المناسبة{summary ? ` (${summary.orders})` : ""}</h2>
        {orders.length ? <div className="space-y-2">{orders.map((order) => <OrderCard key={order.id} order={order} compact />)}</div> : <Empty text="لا توجد طلبات بعد داخل هذه المناسبة" />}
      </section>
    </div>
  );
}

function OrdersPage({ delivery = false, me }: { delivery?: boolean; me: AdminMe }) {
  const manager = isPhotoManager(me);
  const [rows, setRows] = useState<PhotographyOrder[] | null>(null); const [search, setSearch] = useState(""); const [status, setStatus] = useState(delivery ? "ready_pickup" : ""); const [photographerId, setPhotographerId] = useState(0);
  const load = useCallback(() => photographyApi.orders(search, status, { photographerId: photographerId || undefined }).then(setRows).catch(() => setRows([])), [search, status, photographerId]);
  useEffect(() => { const timer = setTimeout(load, search ? 250 : 0); return () => clearTimeout(timer); }, [load, search]);
  return <div className="space-y-3 p-4"><div><h1 className="text-lg font-bold">{delivery ? "التسليم" : "طلبات الصور"}</h1>{delivery ? <p className="mt-1 text-xs text-muted-foreground">ابحث برقم الطلب أو الاسم أو الهاتف أو امسح QR بالكاميرا.</p> : null}</div><div className="flex items-stretch gap-2"><div className="min-w-0 flex-1"><SearchField value={search} onChange={setSearch} placeholder={delivery ? "رقم الطلب، الاسم، الهاتف أو رابط QR..." : "بحث بالطلب أو الاسم أو الهاتف..."} /></div>{delivery ? <QrScannerButton onScan={setSearch} /> : null}</div>{manager ? <PhotographerFilter value={photographerId} onChange={setPhotographerId} /> : null}{!delivery ? <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-lg border border-border/30 bg-card px-3 text-sm"><option value="">كل المراحل</option>{PHOTO_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select> : null}{rows === null ? <Loading /> : rows.length ? <div className="space-y-2">{rows.map((order) => <OrderCard key={order.id} order={order} />)}</div> : <Empty text={delivery ? "لا توجد طلبات جاهزة للاستلام" : "لا توجد طلبات"} />}</div>;
}

function QrScannerButton({ onScan }: { onScan: (value: string) => void }) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setOpen(false);
  }, []);

  useEffect(() => close, [close]);

  async function start() {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: "المسح غير مدعوم على هذا الجهاز", description: "يمكنك لصق رابط QR أو رقم الطلب داخل البحث.", variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setOpen(true);
      window.setTimeout(async () => {
        const video = videoRef.current;
        if (!video) return close();
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        timerRef.current = window.setInterval(async () => {
          try {
            const results = await detector.detect(video);
            const value = String(results?.[0]?.rawValue ?? "").trim();
            if (value) { onScan(value); close(); }
          } catch { /* keep scanning until the user closes it */ }
        }, 450);
      }, 50);
    } catch {
      close();
      toast({ title: "تعذر فتح الكاميرا", description: "تحقق من صلاحية الكاميرا ثم حاول مرة أخرى.", variant: "destructive" });
    }
  }

  return <><button type="button" onClick={start} className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-border/30 bg-card text-primary" aria-label="مسح QR بالكاميرا"><QrCode className="h-5 w-5" /></button>{open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="ماسح QR"><div className="w-full max-w-sm rounded-xl border border-border/40 bg-card p-3"><div className="mb-3 flex items-center justify-between"><div><div className="font-bold">مسح QR</div><div className="text-xs text-muted-foreground">وجّه الكاميرا نحو رمز الطلب</div></div><button type="button" onClick={close} className="grid h-10 w-10 place-items-center text-muted-foreground" aria-label="إغلاق"><X className="h-5 w-5" /></button></div><video ref={videoRef} muted playsInline className="aspect-square w-full rounded-lg bg-black object-cover" /></div></div> : null}</>;
}

function OrderDetailPage({ id, me }: { id: number; me: AdminMe }) {
  const { toast } = useToast(); const manager = isPhotoManager(me); const [order, setOrder] = useState<PhotographyOrder | null>(null); const [collect, setCollect] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(() => photographyApi.order(id).then(setOrder).catch(() => setOrder(null)), [id]);
  useEffect(() => { load(); }, [load]);
  async function status(value: PhotographyStage) { setBusy(true); try { const result = await photographyApi.setStatus(id, value); if (!isQueued(result)) setOrder(result); toast({ title: isQueued(result) ? "تم حفظ التحديث دون اتصال" : "تم تحديث المرحلة" }); } catch (err: any) { toast({ title: "تعذر تحديث المرحلة", description: apiErrorMessage(err), variant: "destructive" }); } finally { setBusy(false); } }
  async function requestPayment() { const amount = Number(collect); if (!amount) return; setBusy(true); try { const result = await photographyApi.collect(id, amount, note); toast({ title: isQueued(result) ? "تم حفظ طلب التحصيل دون اتصال" : "تم إرسال الدفعة للاعتماد" }); setCollect(""); setNote(""); if (!isQueued(result)) load(); } catch (err: any) { toast({ title: "تعذر إرسال الدفعة", description: apiErrorMessage(err), variant: "destructive" }); } finally { setBusy(false); } }
  async function cancelOrder() {
    if (!order) return;
    if (!window.confirm(`إلغاء الطلب ${order.orderNo}؟`)) return;
    setBusy(true);
    try {
      const result = await photographyApi.cancelOrder(order.id);
      setOrder(result);
      toast({ title: "تم إلغاء الطلب" });
    } catch (err) {
      // 409 = the order still has approved/pending money. Don't dump "HTTP 409" on the user —
      // explain the cause and hand them a one-click route to reverse the cash entry first.
      if (apiErrorStatus(err) === 409) {
        toast({
          variant: "destructive",
          title: "لا يمكن إلغاء الطلب",
          description: apiErrorMessage(err),
          action: <ToastAction altText="الذهاب إلى الصندوق الرئيسي" onClick={() => { window.location.href = "/admin/finance/master-cash"; }}>الصندوق الرئيسي</ToastAction>,
        });
      } else {
        toast({ title: "تعذر إلغاء الطلب", description: apiErrorMessage(err), variant: "destructive" });
      }
    } finally { setBusy(false); }
  }
  function printReceipt() {
    if (!order) return; void photographyApi.markPrinted(order.id).catch(() => {});
    const win = window.open("", "_blank", "width=420,height=720"); if (!win) return;
    const date = new Date(order.createdAt).toLocaleDateString("ar-IQ");
    const rows = [
      ["المناسبة", order.event?.eventName || order.event?.groomName || "-"],
      ["الزبون", order.customerName],
      ["الهاتف", phoneDisplay(order.phone)],
      ["النسخ", String(order.copies)],
      ["سعر النسخة", `${photoMoney(order.unitPrice)} د.ع`],
    ].map(([k, v]) => `<div class="kv"><span>${k}</span><span class="v num">${v ?? "-"}</span></div>`).join("");
    const qrBlock = order.qr?.dataUrl ? `<div class="qr"><img src="${order.qr.dataUrl}" alt="QR"><div class="cap">امسح لمتابعة الطلب</div></div>` : "";
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${order.orderNo}</title>
      <style>${thermalReceiptCss("80mm")}</style></head><body>
      <div class="receipt">
        <div class="r-head">
          <div class="r-company">مجموعة علي جان نهاد</div>
          <div class="r-sub">وصل طلب تصوير</div>
          <div class="r-sub num">${order.orderNo} · ${date}</div>
        </div>
        <hr class="rule">
        ${rows}
        <hr class="rule dashed">
        <div class="totals">
          <div class="grand"><span>الإجمالي</span><span class="num">${photoMoney(order.totalAmount)} د.ع</span></div>
          <div class="payline"><span>المدفوع</span><span class="num">${photoMoney(order.paidAmount)} د.ع</span></div>
          <div class="payline remain"><span>المتبقي</span><span class="num">${photoMoney(order.remainingAmount)} د.ع</span></div>
        </div>
        ${qrBlock}
        <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
      </div>
      ${printWhenImagesReadyScript()}
    </body></html>`); win.document.close();
  }
  if (!order) return <Loading />;
  const availableToCollect = Math.max(0, order.remainingAmount - order.pendingAmount);
  const cancelled = !!order.cancelledAt;
  return (
    <div className="space-y-4 p-4"><button type="button" onClick={() => window.history.back()} className="inline-flex items-center text-sm text-muted-foreground"><ChevronRight className="ml-1 h-4 w-4" /> رجوع</button>{cancelled ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm font-bold text-destructive">تم إلغاء هذا الطلب — للعرض والتدقيق فقط.</div> : null}<div className="rounded-xl border border-border/30 bg-card p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-mono font-bold text-primary">{order.orderNo}</div><h1 className="mt-1 text-lg font-bold text-foreground">{order.customerName}</h1><p className="mt-1 text-xs text-muted-foreground">{order.event?.eventName || order.event?.groomName}</p><div className="mt-2"><PaymentBadge order={order} /></div></div><button type="button" onClick={printReceipt} className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-border/30 text-primary" aria-label="طباعة الوصل"><Printer className="h-5 w-5" /></button></div>{order.referenceImage ? <img src={order.referenceImage} alt="صورة المجموعة" className="mt-4 h-44 w-full rounded-lg object-contain bg-background" /> : null}<div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Info label="الهاتف" value={phoneDisplay(order.phone)} /><Info label="النسخ" value={String(order.copies)} /><Info label="سعر النسخة" value={`${photoMoney(order.unitPrice)} د.ع`} /><Info label="الإجمالي" value={`${photoMoney(order.totalAmount)} د.ع`} /></div></div>
      <div className="rounded-xl border border-border/30 bg-card p-4"><h2 className="mb-3 font-bold">مراحل الطلب</h2><div className="space-y-2">{PHOTO_STAGES.map((item, index) => { const current = PHOTO_STAGES.findIndex((stage) => stage.key === order.status); const done = index <= current; return <button key={item.key} type="button" disabled={busy || cancelled || item.key === order.status} onClick={() => status(item.key)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-right text-sm disabled:opacity-60 ${item.key === order.status ? "border-primary bg-primary/10 text-primary" : done ? "border-status-success/30 bg-status-success/5 text-foreground" : "border-border/30 bg-background text-muted-foreground"}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${done ? "bg-primary text-primary-foreground" : "border border-border"}`}>{done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>{item.label}</button>; })}</div></div>
      <div className="rounded-xl border border-border/30 bg-card p-4"><h2 className="mb-3 font-bold">الدفع</h2><div className="grid grid-cols-3 gap-2"><Info label="المبلغ" value={formatCurrency(order.totalAmount)} /><Info label="المدفوع" value={formatCurrency(order.paidAmount)} /><Info label="المتبقي" value={formatCurrency(order.remainingAmount)} /></div>{order.pendingAmount > 0 ? <div className="mt-3 rounded-lg bg-status-warning/10 p-2 text-xs text-status-warning">{formatCurrency(order.pendingAmount)} قيد اعتماد المدير</div> : null}{!cancelled && availableToCollect > 0 ? <div className="mt-4 space-y-2"><Input type="number" min="1" max={availableToCollect} value={collect} onChange={(e) => setCollect(e.target.value)} placeholder={`استلام دفعة حتى ${formatCurrency(availableToCollect)}`} /><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة الدفعة" /><Button className="w-full" onClick={requestPayment} disabled={busy || Number(collect) <= 0 || Number(collect) > availableToCollect}><WalletCards className="ml-2 h-4 w-4" /> استلام دفعة وإرسالها للاعتماد</Button></div> : null}</div>
      <AssetsSection orderId={order.id} cancelled={cancelled} />
      {manager && !cancelled ? (
        <div className="space-y-2">
          {order.paidAmount > 0 || order.pendingAmount > 0 ? (
            <div className="rounded-xl border border-status-warning/40 bg-status-warning/5 p-3 text-xs text-status-warning">
              لإلغاء هذا الطلب يجب أولاً عكس الحركة المالية لدفعاته من الصندوق الرئيسي.
              <a href="/admin/finance/master-cash" className="mt-1 flex items-center gap-1 font-bold text-primary">الذهاب إلى الصندوق الرئيسي لعكس الحركة <ChevronRight className="h-3 w-3" /></a>
            </div>
          ) : null}
          <button type="button" onClick={cancelOrder} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm font-bold text-destructive"><Ban className="h-4 w-4" /> إلغاء الطلب (مدير)</button>
        </div>
      ) : null}
      {order.qr?.dataUrl ? <div className="rounded-xl border border-border/30 bg-card p-4 text-center"><img src={order.qr.dataUrl} alt="QR الطلب" className="mx-auto h-36 w-36 object-contain" /><p className="mt-2 text-xs text-muted-foreground">QR آمن لتتبع طلب الزبون</p></div> : null}
    </div>
  );
}

const ASSET_STATUS_LABEL: Record<string, string> = {
  active: "متاح", checked_out: "مُخرَج بعهدة", maintenance: "صيانة", lost: "مفقود", retired: "خارج الخدمة", locked: "مقفل",
};

function AssetsSection({ orderId, cancelled }: { orderId: number; cancelled: boolean }) {
  const { toast } = useToast();
  const [assets, setAssets] = useState<PhotographyAsset[] | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ productId: number; name: string; barcode: string | null; assetCode: string; imageUrl: string | null }>>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState<{ asset: PhotographyAsset; problem: "none" | "broken" | "lost"; note: string; cost: string; approval: boolean } | null>(null);
  const load = useCallback(() => photographyApi.assets(orderId).then((r) => setAssets(r.assets)).catch(() => setAssets([])), [orderId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => { photographyApi.searchAssets(q).then((r) => { if (alive) setResults(r.products); }).catch(() => {}); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [search]);

  async function op(payload: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try { await photographyApi.assetOp(orderId, payload); toast({ title: okMsg }); await load(); return true; }
    catch (err: any) { toast({ title: "تعذّر التنفيذ", description: apiErrorMessage(err), variant: "destructive" }); return false; }
    finally { setBusy(false); }
  }
  const linkProduct = (productId: number) => { void op({ mode: "link", productId }, "تم ربط الأصل").then((ok) => { if (ok) { setSearch(""); setResults([]); } }); };
  const scanLink = (code: string) => { void op({ mode: "link", code }, "تم ربط الأصل بالمسح"); };
  const checkout = (a: PhotographyAsset) => op({ mode: "checkout", productId: a.productId }, "تم إخراج الأصل");
  async function confirmReturn() {
    if (!ret) return;
    const ok = await op({ mode: "return", productId: ret.asset.productId, problem: ret.problem, note: ret.note || undefined, cost: ret.problem === "broken" ? Number(ret.cost) || 0 : undefined, managerApproval: ret.problem === "lost" ? ret.approval : undefined }, "تم استلام الأصل");
    if (ok) setRet(null);
  }

  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <div className="mb-3 flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" /><h2 className="font-bold">أصول ومعدات الطلب</h2>{assets ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{assets.length}</span> : null}</div>

      {!cancelled ? (
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/30 bg-background px-3"><Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن أصل بالاسم أو الباركود..." className="min-h-11 w-full bg-transparent text-sm outline-none" /></div>
            <button type="button" onClick={() => setScanning((s) => !s)} className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border ${scanning ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-muted-foreground"}`} aria-label="مسح QR"><ScanLine className="h-5 w-5" /></button>
          </div>
          {scanning ? <div className="overflow-hidden rounded-lg border border-border/30"><LiveScanner active={scanning} onDetect={scanLink} /></div> : null}
          {results.length ? (
            <div className="space-y-1 rounded-lg border border-border/30 bg-background p-1">
              {results.map((r) => (
                <button key={r.productId} type="button" disabled={busy} onClick={() => linkProduct(r.productId)} className="flex w-full items-center gap-2 rounded-md p-2 text-right text-sm hover:bg-primary/5 disabled:opacity-60">
                  {r.imageUrl ? <img src={r.imageUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" /> : <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded bg-muted"><Boxes className="h-4 w-4 text-muted-foreground" /></span>}
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.assetCode}</span>
                  <Plus className="h-4 w-4 flex-shrink-0 text-primary" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {assets === null ? <div className="py-4 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>
        : assets.length === 0 ? <Empty text="لا توجد أصول مرتبطة بهذا الطلب" />
        : (
          <div className="space-y-2">
            {assets.map((a) => (
              <div key={a.productId} className="rounded-lg border border-border/30 bg-background p-3">
                <div className="flex items-center gap-2">
                  {a.imageUrl ? <img src={a.imageUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" /> : <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded bg-muted"><Boxes className="h-5 w-5 text-muted-foreground" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{a.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"><span className="font-mono">{a.assetCode}</span>{a.warehouse ? <span>· {a.warehouse}</span> : null}<span>· صحة {a.health}%</span></div>
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${a.checkedOut ? "bg-status-warning/15 text-status-warning" : "bg-status-success/15 text-status-success"}`}>{ASSET_STATUS_LABEL[a.status] ?? a.status}</span>
                </div>
                {!cancelled ? (
                  <div className="mt-2 flex items-center gap-2">
                    {a.checkedOut
                      ? <button type="button" disabled={busy} onClick={() => setRet({ asset: a, problem: "none", note: "", cost: "", approval: false })} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2 py-2 text-xs font-bold text-primary disabled:opacity-60"><Undo2 className="h-4 w-4" /> استلام</button>
                      : <button type="button" disabled={busy} onClick={() => checkout(a)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-2 py-2 text-xs font-bold text-accent disabled:opacity-60"><Upload className="h-4 w-4" /> إخراج</button>}
                    <button type="button" disabled={busy || a.checkedOut} onClick={() => { if (window.confirm("إزالة ربط هذا الأصل؟")) void op({ mode: "unlink", productId: a.productId }, "تم إزالة الربط"); }} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-destructive/30 text-destructive disabled:opacity-40" aria-label="إزالة الربط"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

      {ret ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setRet(null)}>
          <div className="w-full max-w-md rounded-t-2xl border border-border/30 bg-card p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">استلام الأصل — {ret.asset.name}</h3><button type="button" onClick={() => setRet(null)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground"><X className="h-4 w-4" /></button></div>
            <div className="grid grid-cols-3 gap-2">
              {([["none", "سليم"], ["broken", "كسر"], ["lost", "فقدان"]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setRet({ ...ret, problem: key })} className={`rounded-lg border py-2 text-sm font-bold ${ret.problem === key ? (key === "none" ? "border-status-success bg-status-success/10 text-status-success" : key === "broken" ? "border-status-warning bg-status-warning/10 text-status-warning" : "border-destructive bg-destructive/10 text-destructive") : "border-border/30 text-muted-foreground"}`}>{label}</button>
              ))}
            </div>
            {ret.problem !== "none" ? <Textarea rows={2} className="mt-3" value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} placeholder="ملاحظة (اختياري)" /> : null}
            {ret.problem === "broken" ? <Input type="number" min="0" className="mt-2" value={ret.cost} onChange={(e) => setRet({ ...ret, cost: e.target.value })} placeholder="تكلفة الإصلاح التقديرية (اختياري)" /> : null}
            {ret.problem === "lost" ? <label className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive"><input type="checkbox" checked={ret.approval} onChange={(e) => setRet({ ...ret, approval: e.target.checked })} /> أؤكد اعتماد المدير على تسجيل الفقدان</label> : null}
            <Button className="mt-4 w-full" disabled={busy || (ret.problem === "lost" && !ret.approval)} onClick={confirmReturn}>{busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <PackageCheck className="ml-2 h-4 w-4" />} تأكيد الاستلام</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportsPage({ me }: { me: AdminMe }) {
  const manager = isPhotoManager(me);
  const [data, setData] = useState<Awaited<ReturnType<typeof photographyApi.reports>> | null>(null);
  const [photographerId, setPhotographerId] = useState(0);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  useEffect(() => { setData(null); photographyApi.reports({ photographerId: photographerId || undefined, from: from || undefined, to: to || undefined }).then(setData).catch(() => {}); }, [photographerId, from, to]);
  const ranged = !!(from || to);
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">{manager ? "تقارير التصوير" : "تقاريري"}</h1>
      {manager ? (
        <div className="space-y-2 rounded-xl border border-border/30 bg-card p-3">
          <PhotographerFilter value={photographerId} onChange={setPhotographerId} />
          <div className="grid grid-cols-2 gap-2"><label className="space-y-1 text-xs text-muted-foreground">من<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">إلى<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
        </div>
      ) : null}
      {!data ? <Loading /> : (
        <>
          <p className="text-xs text-muted-foreground">{ranged ? "ضمن النطاق المحدد" : "إحصائيات اليوم"}</p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="المناسبات" value={data.events} icon={CalendarDays} />
            <Stat label="عدد الطلبات" value={data.orders} icon={ClipboardList} />
            <Stat label="مدفوعة" value={data.paidCount} icon={WalletCards} />
            <Stat label="غير مدفوعة" value={data.unpaidCount} icon={Camera} />
            <Stat label="تم التسليم" value={data.delivered} icon={PackageCheck} />
            <Stat label="قيد التنفيذ" value={data.inProgress} icon={Camera} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border/30 bg-card p-4"><span className="text-xs text-muted-foreground">المبالغ المستلمة</span><div className="mt-2 text-xl font-bold text-status-success">{photoMoney(data.received)} د.ع</div></div>
            <div className="rounded-xl border border-border/30 bg-card p-4"><span className="text-xs text-muted-foreground">المبالغ المتبقية</span><div className="mt-2 text-xl font-bold text-destructive">{photoMoney(data.remaining)} د.ع</div></div>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationsPage() { const [rows, setRows] = useState<Awaited<ReturnType<typeof photographyApi.notifications>> | null>(null); const load = useCallback(() => photographyApi.notifications().then(setRows).catch(() => setRows([])), []); useEffect(() => { load(); }, [load]); async function readAll() { await photographyApi.markAllRead().catch(() => {}); load(); } return <div className="space-y-3 p-4"><div className="flex items-center justify-between"><h1 className="text-lg font-bold">الإشعارات</h1><button type="button" onClick={readAll} className="text-sm text-primary">تعليم الكل كمقروء</button></div>{rows === null ? <Loading /> : rows.length ? <div className="space-y-2">{rows.map((item) => <div key={item.id} className={`rounded-xl border p-3 ${item.readAt ? "border-border/30 bg-card" : "border-primary/40 bg-primary/5"}`}><div className="font-bold text-foreground">{item.title}</div>{item.body ? <div className="mt-1 text-sm text-muted-foreground">{item.body}</div> : null}<div className="mt-2 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ar-IQ")}</div></div>)}</div> : <Empty text="لا توجد إشعارات" />}</div>; }

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-card px-3"><Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-h-11 w-full bg-transparent text-sm outline-none" /></div>; }
function Loading() { return <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">{text}</div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-background p-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div></div>; }

export default function PhotographyStaffPortal() {
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined); const [unread, setUnread] = useState(0); const [pendingOps, setPendingOps] = useState(0); const [location, navigate] = useLocation(); const knownNotifications = useRef(new Set<number>());
  const refreshMe = useCallback(() => { fetchAdminMe({ force: true }).then(setMe); }, []);
  useEffect(() => { refreshMe(); }, [refreshMe]);
  const allowed = !!me && hasPerm(me, "photography");
  useEffect(() => { if (!allowed) return; let active = true; async function poll() { try { const rows = await photographyApi.notifications(); if (!active) return; setUnread(rows.filter((item) => !item.readAt).length); for (const item of rows) { if (!knownNotifications.current.has(item.id)) { knownNotifications.current.add(item.id); if (!item.readAt && knownNotifications.current.size > rows.length && "Notification" in window && Notification.permission === "granted") new Notification(item.title, { body: item.body }); } } } catch { /* polling is best effort */ } } poll(); const timer = setInterval(poll, 30000); if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); return () => { active = false; clearInterval(timer); }; }, [allowed]);
  useEffect(() => { if (!allowed) return; const update = () => countOps().then(setPendingOps).catch(() => {}); const online = () => flushQueue().then(update); update(); flushQueue().then(update); window.addEventListener("online", online); window.addEventListener("ajn-queue-changed", update); return () => { window.removeEventListener("online", online); window.removeEventListener("ajn-queue-changed", update); }; }, [allowed]);
  if (me === undefined) return <Spinner />; if (!me) return <PortalLogin onDone={refreshMe} />; if (!allowed) return <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-5 text-center" dir="rtl"><Camera className="h-8 w-8 text-primary" /><p className="text-muted-foreground">حسابك لا يملك صلاحية بوابة المصورين.</p><Button variant="outline" onClick={() => logoutAdmin().then(refreshMe)}>تسجيل الخروج</Button></div>;
  const tabs = [
    { href: "/staff/photography", label: "الرئيسية", icon: Home, active: location === "/staff/photography" },
    { href: "/staff/photography/events", label: "المناسبات", icon: CalendarDays, active: location === "/staff/photography/events" },
    { href: "/staff/photography/orders", label: "الطلبات", icon: ClipboardList, active: location === "/staff/photography/orders" },
    { href: "/staff/photography/delivery", label: "التسليم", icon: PackageCheck, active: location === "/staff/photography/delivery" },
    { href: "/staff/photography/reports", label: "التقارير", icon: BarChart3, active: location === "/staff/photography/reports" },
    { href: "/staff/photography/notifications", label: "الإشعارات", icon: Bell, active: location === "/staff/photography/notifications", badge: unread },
  ];
  return <div className="min-h-dvh bg-background text-foreground" dir="rtl"><header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-border/30 bg-background/95 px-4 py-3 backdrop-blur"><div className="flex min-w-0 items-center gap-2"><Camera className="h-5 w-5 flex-shrink-0 text-primary" /><div className="min-w-0"><div className="truncate text-sm font-bold text-foreground">{me.fullName || me.username}</div><div className="truncate text-[11px] text-muted-foreground">بوابة المصورين{isPhotoManager(me) ? " • مدير" : ""}</div></div></div><div className="flex flex-shrink-0 items-center gap-2">{pendingOps > 0 ? <span className="flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-1 text-[11px] font-bold text-status-warning"><CloudOff className="h-3.5 w-3.5" />{pendingOps}</span> : null}<button type="button" onClick={() => logoutAdmin().then(refreshMe)} aria-label="تسجيل الخروج" className="grid h-10 w-10 place-items-center text-muted-foreground"><LogOut className="h-5 w-5" /></button></div></header><main className="mx-auto max-w-3xl pb-24"><Switch><Route path="/staff/photography/events/:token/register">{(params) => <RegistrationPage eventRef={params.token} me={me} />}</Route><Route path="/staff/photography/orders/:id">{(params) => <OrderDetailPage id={Number(params.id)} me={me} />}</Route><Route path="/staff/photography/events"><EventsPage me={me} /></Route><Route path="/staff/photography/orders"><OrdersPage me={me} /></Route><Route path="/staff/photography/delivery"><OrdersPage delivery me={me} /></Route><Route path="/staff/photography/reports"><ReportsPage me={me} /></Route><Route path="/staff/photography/notifications"><NotificationsPage /></Route><Route path="/staff/photography"><Dashboard me={me} /></Route><Route><Dashboard me={me} /></Route></Switch></main><nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border/30 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">{tabs.map((tab) => <button key={tab.href} type="button" onClick={() => navigate(tab.href)} aria-current={tab.active ? "page" : undefined} className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] transition-colors ${tab.active ? "font-bold text-primary" : "text-muted-foreground"}`}>{tab.active ? <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" /> : null}<tab.icon className={`h-5 w-5 transition-transform ${tab.active ? "scale-110" : ""}`} /><span className="max-w-full truncate px-1">{tab.label}</span>{tab.badge ? <span className="absolute right-[24%] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white">{tab.badge}</span> : null}</button>)}</nav></div>;
}
