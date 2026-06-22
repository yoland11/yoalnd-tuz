import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  BarChart3, Bell, CalendarDays, Camera, Check, ChevronRight, ClipboardList, CloudOff,
  Home, ImagePlus, Loader2, LogOut, MapPin, PackageCheck, Phone, Printer, QrCode, Search,
  Send, User, WalletCards, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatIraqiPhoneInput } from "@/lib/phone";
import { processImageFile } from "@/lib/image-tools";
import { fetchAdminMe, hasPerm, loginAdmin, logoutAdmin, type AdminMe } from "@/views/admin/_lib";
import { countOps, flushQueue, isQueued } from "../offline";
import {
  PHOTO_STAGES, PHOTO_STAGE_LABEL, newClientToken, photographyApi, photoMoney, printTypeLabel,
  readLocalEvent, saveLocalEvent, type PhotographyEvent, type PhotographyOrder, type PhotographyStage,
} from "./lib";

const STATUS_TONE: Record<string, string> = {
  registered: "bg-amber-500/15 text-amber-500",
  editing: "bg-blue-500/15 text-blue-400",
  ready_print: "bg-violet-500/15 text-violet-400",
  ready_pickup: "bg-primary/15 text-primary",
  delivered: "bg-green-500/15 text-green-400",
};

function Spinner() {
  return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
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
    <div className="flex min-h-screen items-center justify-center bg-background p-5" dir="rtl">
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
    <Link href={`/staff/photography/orders/${order.id}`} className="block rounded-xl border border-border/30 bg-card p-3 transition-colors hover:border-primary/40 active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-mono text-sm font-bold text-primary">{order.orderNo}</div><div className="mt-1 font-semibold text-foreground">{order.customerName}</div><div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{order.phone}</div>{!compact && order.event ? <div className="mt-1 text-xs text-muted-foreground">{order.event.eventName || order.event.groomName}</div> : null}</div><span className={`flex-shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${STATUS_TONE[order.status] || "bg-muted text-muted-foreground"}`}>{PHOTO_STAGE_LABEL[order.status] || order.status}</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/20 pt-3 text-xs"><div><span className="text-muted-foreground">المبلغ</span><div className="mt-1 font-semibold">{photoMoney(order.totalAmount)}</div></div><div><span className="text-muted-foreground">المدفوع</span><div className="mt-1 font-semibold text-green-400">{photoMoney(order.paidAmount)}</div></div><div><span className="text-muted-foreground">المتبقي</span><div className="mt-1 font-semibold text-destructive">{photoMoney(order.remainingAmount)}</div></div></div>
      {order.pendingAmount > 0 ? <div className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-500">{photoMoney(order.pendingAmount)} د.ع بانتظار اعتماد المدير</div> : null}
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
    } catch (err: any) { toast({ title: "تعذر بدء المناسبة", description: err?.message, variant: "destructive" }); }
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

function EventsPage() {
  const [rows, setRows] = useState<PhotographyEvent[] | null>(null); const [search, setSearch] = useState("");
  useEffect(() => { const timer = setTimeout(() => photographyApi.events(search).then(setRows).catch(() => setRows([])), search ? 250 : 0); return () => clearTimeout(timer); }, [search]);
  return <div className="space-y-3 p-4"><h1 className="text-lg font-bold">المناسبات</h1><SearchField value={search} onChange={setSearch} placeholder="بحث باسم العريس أو المناسبة..." />{rows === null ? <Loading /> : rows.length ? <div className="space-y-2">{rows.map((event) => <EventCard key={event.id || event.clientToken} event={event} />)}</div> : <Empty text="لا توجد مناسبات" />}</div>;
}

const EMPTY_ORDER = { customerName: "", phone: "", copies: 1, printType: "10x15", totalAmount: "", paidAmount: "", photoNumber: "", notes: "", referenceImage: "" };

function RegistrationPage({ eventRef }: { eventRef: string }) {
  const { toast } = useToast();
  const clientTokenRef = useRef(newClientToken());
  const [event, setEvent] = useState<PhotographyEvent | null>(() => readLocalEvent(eventRef));
  const [form, setForm] = useState(EMPTY_ORDER);
  const [busy, setBusy] = useState(false);
  useEffect(() => { photographyApi.event(eventRef).then((row) => { setEvent(row); saveLocalEvent(row); }).catch(() => {}); }, [eventRef]);
  const total = Number(form.totalAmount) || 0; const paid = Number(form.paidAmount) || 0; const remaining = Math.max(0, total - paid);
  async function image(file: File | null) { if (!file) return; try { const dataUrl = await processImageFile(file, { maxSize: 1400, quality: 0.78 }); setForm((current) => ({ ...current, referenceImage: dataUrl })); } catch { toast({ title: "تعذر تجهيز الصورة", variant: "destructive" }); } }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const result = await photographyApi.createOrder(eventRef, { ...form, clientToken: clientTokenRef.current, totalAmount: total, paidAmount: paid });
      toast({ title: isQueued(result) ? "تم حفظ الطلب دون اتصال" : `تم حفظ الطلب ${result.orderNo}`, description: isQueued(result) ? "سيتم إنشاء الرقم وQR تلقائياً عند المزامنة." : "تم إنشاء QR وبقيت داخل نفس المناسبة." });
      setForm(EMPTY_ORDER);
      clientTokenRef.current = newClientToken();
    } catch (err: any) { toast({ title: "تعذر حفظ الطلب", description: err?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  if (!event) return <Loading />;
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3"><div className="flex items-center gap-2 font-bold"><User className="h-4 w-4 text-primary" />العريس: {event.groomName}</div><div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{event.eventDate}</span>{event.location ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{event.location}</span> : null}</div></div>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-border/30 bg-card p-4">
        <h1 className="font-bold text-foreground">التسجيل السريع</h1>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">اسم الزبون *</span><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">رقم الهاتف *</span><Input dir="ltr" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: formatIraqiPhoneInput(e.target.value) })} placeholder="077xxxxxxxx" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block space-y-1"><span className="text-xs text-muted-foreground">عدد النسخ *</span><Input type="number" min="1" value={form.copies} onChange={(e) => setForm({ ...form, copies: Math.max(1, Number(e.target.value) || 1) })} /></label><label className="block space-y-1"><span className="text-xs text-muted-foreground">رقم الصورة</span><Input value={form.photoNumber} onChange={(e) => setForm({ ...form, photoNumber: e.target.value })} /></label></div>
        <div><span className="mb-2 block text-xs text-muted-foreground">نوع الطباعة *</span><div className="grid grid-cols-2 gap-2">{[["10x15", "10×15"], ["15x20", "15×20"], ["20x30", "20×30"], ["album", "ألبوم"]].map(([value, label]) => <button key={value} type="button" onClick={() => setForm({ ...form, printType: value })} className={`min-h-11 rounded-lg border text-sm ${form.printType === value ? "border-primary bg-primary/10 text-primary" : "border-border/30 bg-background text-foreground"}`}>{label}</button>)}</div></div>
        <div className="grid grid-cols-2 gap-3"><label className="block space-y-1"><span className="text-xs text-muted-foreground">المبلغ *</span><Input type="number" min="1" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} /></label><label className="block space-y-1"><span className="text-xs text-muted-foreground">المدفوع *</span><Input type="number" min="0" max={total || undefined} value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} /></label></div>
        <div className="rounded-lg bg-background p-3"><span className="text-xs text-muted-foreground">المتبقي</span><div className="mt-1 text-lg font-bold text-primary">{photoMoney(remaining)} د.ع</div>{paid > 0 ? <p className="mt-1 text-[11px] text-amber-500">الدفعة تُرسل لاعتماد المدير قبل دخول الصندوق.</p> : null}</div>
        <label className="block space-y-1"><span className="text-xs text-muted-foreground">ملاحظات</span><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <label className="block cursor-pointer rounded-xl border border-dashed border-border/50 bg-background/50 p-3 text-center"><span className="mb-2 block text-xs text-muted-foreground">صورة تعريفية للمجموعة (اختياري)</span>{form.referenceImage ? <img src={form.referenceImage} alt="معاينة المجموعة" className="mx-auto h-36 w-full rounded-lg object-contain" /> : <span className="flex h-24 items-center justify-center"><ImagePlus className="h-6 w-6 text-primary" /></span>}<input type="file" accept="image/*" className="sr-only" onChange={(e) => void image(e.target.files?.[0] ?? null)} /></label>
        <Button className="w-full" disabled={busy || !form.customerName.trim() || !form.phone || total <= 0 || paid > total}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="ml-2 h-4 w-4" /> حفظ الطلب</>}</Button>
      </form>
    </div>
  );
}

function OrdersPage({ delivery = false }: { delivery?: boolean }) {
  const [rows, setRows] = useState<PhotographyOrder[] | null>(null); const [search, setSearch] = useState(""); const [status, setStatus] = useState(delivery ? "ready_pickup" : "");
  const load = useCallback(() => photographyApi.orders(search, status).then(setRows).catch(() => setRows([])), [search, status]);
  useEffect(() => { const timer = setTimeout(load, search ? 250 : 0); return () => clearTimeout(timer); }, [load, search]);
  return <div className="space-y-3 p-4"><div><h1 className="text-lg font-bold">{delivery ? "التسليم" : "طلبات الصور"}</h1>{delivery ? <p className="mt-1 text-xs text-muted-foreground">ابحث برقم الطلب أو الاسم أو الهاتف أو امسح QR بالكاميرا.</p> : null}</div><div className="flex items-stretch gap-2"><div className="min-w-0 flex-1"><SearchField value={search} onChange={setSearch} placeholder={delivery ? "رقم الطلب، الاسم، الهاتف أو رابط QR..." : "بحث بالطلب أو الاسم أو الهاتف..."} /></div>{delivery ? <QrScannerButton onScan={setSearch} /> : null}</div>{!delivery ? <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-lg border border-border/30 bg-card px-3 text-sm"><option value="">كل المراحل</option>{PHOTO_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select> : null}{rows === null ? <Loading /> : rows.length ? <div className="space-y-2">{rows.map((order) => <OrderCard key={order.id} order={order} />)}</div> : <Empty text={delivery ? "لا توجد طلبات جاهزة للاستلام" : "لا توجد طلبات"} />}</div>;
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

function OrderDetailPage({ id }: { id: number }) {
  const { toast } = useToast(); const [order, setOrder] = useState<PhotographyOrder | null>(null); const [collect, setCollect] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(() => photographyApi.order(id).then(setOrder).catch(() => setOrder(null)), [id]);
  useEffect(() => { load(); }, [load]);
  async function status(value: PhotographyStage) { setBusy(true); try { const result = await photographyApi.setStatus(id, value); if (!isQueued(result)) setOrder(result); toast({ title: isQueued(result) ? "تم حفظ التحديث دون اتصال" : "تم تحديث المرحلة" }); } catch (err: any) { toast({ title: "تعذر تحديث المرحلة", description: err?.message, variant: "destructive" }); } finally { setBusy(false); } }
  async function requestPayment() { const amount = Number(collect); if (!amount) return; setBusy(true); try { const result = await photographyApi.collect(id, amount, note); toast({ title: isQueued(result) ? "تم حفظ طلب التحصيل دون اتصال" : "تم إرسال الدفعة للاعتماد" }); setCollect(""); setNote(""); if (!isQueued(result)) load(); } catch (err: any) { toast({ title: "تعذر إرسال الدفعة", description: err?.message, variant: "destructive" }); } finally { setBusy(false); } }
  function printReceipt() {
    if (!order) return; void photographyApi.markPrinted(order.id).catch(() => {});
    const win = window.open("", "_blank", "width=420,height=720"); if (!win) return;
    const qr = order.qr?.dataUrl ? `<img class="qr" src="${order.qr.dataUrl}" alt="QR">` : "";
    win.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>${order.orderNo}</title><style>@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{width:74mm;margin:0;font-family:Arial,sans-serif;color:#000;font-size:12px;font-weight:600}.c{text-align:center}.row{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #000;padding:5px 0}.qr{display:block;width:120px;height:120px;margin:10px auto;image-rendering:pixelated}h1{font-size:18px;margin:4px}p{margin:3px}</style></head><body><div class="c"><h1>AJN</h1><p>وصل طلب تصوير</p><p>${order.orderNo}</p></div>${[["المناسبة", order.event?.eventName || order.event?.groomName], ["الزبون", order.customerName], ["الهاتف", order.phone], ["النسخ", order.copies], ["الطباعة", printTypeLabel(order.printType)], ["المبلغ", photoMoney(order.totalAmount)], ["المدفوع", photoMoney(order.paidAmount)], ["المتبقي", photoMoney(order.remainingAmount)]].map(([a,b]) => `<div class="row"><span>${a}</span><strong>${b ?? "-"}</strong></div>`).join("")}${qr}<div class="c"><p>امسح QR لمتابعة الطلب</p></div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`); win.document.close();
  }
  if (!order) return <Loading />;
  const availableToCollect = Math.max(0, order.remainingAmount - order.pendingAmount);
  return (
    <div className="space-y-4 p-4"><button type="button" onClick={() => window.history.back()} className="inline-flex items-center text-sm text-muted-foreground"><ChevronRight className="ml-1 h-4 w-4" /> رجوع</button><div className="rounded-xl border border-border/30 bg-card p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-mono font-bold text-primary">{order.orderNo}</div><h1 className="mt-1 text-lg font-bold text-foreground">{order.customerName}</h1><p className="mt-1 text-xs text-muted-foreground">{order.event?.eventName || order.event?.groomName}</p></div><button type="button" onClick={printReceipt} className="grid h-11 w-11 place-items-center rounded-lg border border-border/30 text-primary" aria-label="طباعة الوصل"><Printer className="h-5 w-5" /></button></div>{order.referenceImage ? <img src={order.referenceImage} alt="صورة المجموعة" className="mt-4 h-44 w-full rounded-lg object-contain bg-background" /> : null}<div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Info label="الهاتف" value={order.phone} /><Info label="النسخ" value={String(order.copies)} /><Info label="الطباعة" value={printTypeLabel(order.printType)} /><Info label="رقم الصورة" value={order.photoNumber || "-"} /></div></div>
      <div className="rounded-xl border border-border/30 bg-card p-4"><h2 className="mb-3 font-bold">مراحل الطلب</h2><div className="space-y-2">{PHOTO_STAGES.map((item, index) => { const current = PHOTO_STAGES.findIndex((stage) => stage.key === order.status); const done = index <= current; return <button key={item.key} type="button" disabled={busy || item.key === order.status} onClick={() => status(item.key)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-right text-sm ${item.key === order.status ? "border-primary bg-primary/10 text-primary" : done ? "border-green-500/30 bg-green-500/5 text-foreground" : "border-border/30 bg-background text-muted-foreground"}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${done ? "bg-primary text-primary-foreground" : "border border-border"}`}>{done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>{item.label}</button>; })}</div></div>
      <div className="rounded-xl border border-border/30 bg-card p-4"><h2 className="mb-3 font-bold">الدفع</h2><div className="grid grid-cols-3 gap-2"><Info label="المبلغ" value={photoMoney(order.totalAmount)} /><Info label="المدفوع" value={photoMoney(order.paidAmount)} /><Info label="المتبقي" value={photoMoney(order.remainingAmount)} /></div>{order.pendingAmount > 0 ? <div className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-500">{photoMoney(order.pendingAmount)} د.ع قيد اعتماد المدير</div> : null}{availableToCollect > 0 ? <div className="mt-4 space-y-2"><Input type="number" min="1" max={availableToCollect} value={collect} onChange={(e) => setCollect(e.target.value)} placeholder={`استلام دفعة حتى ${photoMoney(availableToCollect)}`} /><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة الدفعة" /><Button className="w-full" onClick={requestPayment} disabled={busy || Number(collect) <= 0 || Number(collect) > availableToCollect}><WalletCards className="ml-2 h-4 w-4" /> استلام دفعة وإرسالها للاعتماد</Button></div> : null}</div>
      {order.qr?.dataUrl ? <div className="rounded-xl border border-border/30 bg-card p-4 text-center"><img src={order.qr.dataUrl} alt="QR الطلب" className="mx-auto h-36 w-36 object-contain" /><p className="mt-2 text-xs text-muted-foreground">QR آمن لتتبع طلب الزبون</p></div> : null}
    </div>
  );
}

function ReportsPage() { const [data, setData] = useState<Awaited<ReturnType<typeof photographyApi.reports>> | null>(null); useEffect(() => { photographyApi.reports().then(setData).catch(() => {}); }, []); if (!data) return <Loading />; return <div className="space-y-4 p-4"><h1 className="text-lg font-bold">تقاريري اليوم</h1><div className="grid grid-cols-2 gap-2"><Stat label="عدد الطلبات" value={data.orders} icon={ClipboardList} /><Stat label="تم التسليم" value={data.delivered} icon={PackageCheck} /><Stat label="قيد التنفيذ" value={data.inProgress} icon={Camera} /><Stat label="المبالغ المستلمة" value={`${photoMoney(data.received)} د.ع`} icon={WalletCards} /></div><div className="rounded-xl border border-border/30 bg-card p-4"><span className="text-sm text-muted-foreground">إجمالي المبالغ المتبقية</span><div className="mt-2 text-2xl font-bold text-destructive">{photoMoney(data.remaining)} د.ع</div></div></div>; }

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
  if (me === undefined) return <Spinner />; if (!me) return <PortalLogin onDone={refreshMe} />; if (!allowed) return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-5 text-center" dir="rtl"><Camera className="h-8 w-8 text-primary" /><p className="text-muted-foreground">حسابك لا يملك صلاحية بوابة المصورين.</p><Button variant="outline" onClick={() => logoutAdmin().then(refreshMe)}>تسجيل الخروج</Button></div>;
  const detail = location.includes("/orders/") || location.includes("/register");
  const tabs = [
    { href: "/staff/photography", label: "الرئيسية", icon: Home, active: location === "/staff/photography" },
    { href: "/staff/photography/events", label: "المناسبات", icon: CalendarDays, active: location === "/staff/photography/events" },
    { href: "/staff/photography/orders", label: "الطلبات", icon: ClipboardList, active: location === "/staff/photography/orders" },
    { href: "/staff/photography/delivery", label: "التسليم", icon: PackageCheck, active: location === "/staff/photography/delivery" },
    { href: "/staff/photography/reports", label: "التقارير", icon: BarChart3, active: location === "/staff/photography/reports" },
    { href: "/staff/photography/notifications", label: "الإشعارات", icon: Bell, active: location === "/staff/photography/notifications", badge: unread },
  ];
  return <div className="min-h-screen bg-background text-foreground" dir="rtl"><header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-border/30 bg-background/95 px-4 py-3 backdrop-blur"><div className="flex min-w-0 items-center gap-2"><Camera className="h-5 w-5 flex-shrink-0 text-primary" /><div className="min-w-0"><div className="truncate text-sm font-bold">بوابة المصورين</div><div className="truncate text-[11px] text-muted-foreground">{me.fullName || me.username}</div></div></div><div className="flex flex-shrink-0 items-center gap-2">{pendingOps > 0 ? <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-bold text-amber-500"><CloudOff className="h-3.5 w-3.5" />{pendingOps}</span> : null}<button type="button" onClick={() => logoutAdmin().then(refreshMe)} aria-label="تسجيل الخروج" className="grid h-10 w-10 place-items-center text-muted-foreground"><LogOut className="h-5 w-5" /></button></div></header><main className="mx-auto max-w-3xl pb-24"><Switch><Route path="/staff/photography/events/:token/register">{(params) => <RegistrationPage eventRef={params.token} />}</Route><Route path="/staff/photography/orders/:id">{(params) => <OrderDetailPage id={Number(params.id)} />}</Route><Route path="/staff/photography/events"><EventsPage /></Route><Route path="/staff/photography/orders"><OrdersPage /></Route><Route path="/staff/photography/delivery"><OrdersPage delivery /></Route><Route path="/staff/photography/reports"><ReportsPage /></Route><Route path="/staff/photography/notifications"><NotificationsPage /></Route><Route path="/staff/photography"><Dashboard me={me} /></Route><Route><Dashboard me={me} /></Route></Switch></main>{!detail ? <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-border/30 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">{tabs.map((tab) => <button key={tab.href} type="button" onClick={() => navigate(tab.href)} className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-[10px] ${tab.active ? "text-primary" : "text-muted-foreground"}`}><tab.icon className="h-5 w-5" /><span className="max-w-full truncate px-1">{tab.label}</span>{tab.badge ? <span className="absolute right-[24%] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">{tab.badge}</span> : null}</button>)}</nav> : null}</div>;
}
