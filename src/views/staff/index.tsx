import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Armchair, Bell, Home, LogOut, MapPin, Phone, ClipboardList, BarChart3, CheckCircle2, XCircle, Loader2, Search, ShieldCheck, CloudOff } from "lucide-react";
import { fetchAdminMe, loginAdmin, logoutAdmin, hasPerm, type AdminMe } from "@/views/admin/_lib";
import { BUCKET_LABEL, STAGE_LABEL, money, staffApi, type Bucket, type CrewBooking } from "./lib";
import { countOps, flushQueue } from "./offline";
import StaffBookingDetail from "./booking-detail";

const STAGE_BADGE: Record<string, string> = {
  preparing: "bg-amber-500/15 text-amber-600",
  out_of_warehouse: "bg-blue-500/15 text-blue-600",
  on_the_way: "bg-indigo-500/15 text-indigo-600",
  executing: "bg-purple-500/15 text-purple-600",
  executed: "bg-teal-500/15 text-teal-600",
  delivered: "bg-green-600/15 text-green-700 dark:text-green-400",
};

function Spinner() {
  return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
}

function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await loginAdmin(u.trim(), p); onDone(); }
    catch (e: any) { setErr(e?.message ?? "بيانات الدخول غير صحيحة"); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Armchair className="h-7 w-7 text-primary" /></div>
          <h1 className="text-lg font-bold">بوابة كادر الكوشات</h1>
          <p className="text-sm text-muted-foreground">سجّل الدخول للمتابعة</p>
        </div>
        {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        <input value={u} onChange={(e) => setU(e.target.value)} placeholder="اسم المستخدم" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" autoComplete="username" />
        <input value={p} onChange={(e) => setP(e.target.value)} type="password" placeholder="كلمة المرور" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" autoComplete="current-password" />
        <button disabled={busy || !u || !p} className="w-full rounded-lg bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "دخول"}
        </button>
      </form>
    </div>
  );
}

function BookingCard({ b }: { b: CrewBooking }) {
  return (
    <Link href={`/staff/koshas/booking/${b.id}`} className="block rounded-xl border border-border bg-card p-3 active:scale-[0.99]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-bold"><Armchair className="h-4 w-4 text-primary" />{b.koshaName || "كوشة"}</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{b.customerName} · {b.phone}</div>
          {(b.hallLocation || b.cityArea || b.area) && <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{[b.area, b.cityArea, b.hallLocation].filter(Boolean).join(" — ")}</div>}
          {b.eventDate && <div className="mt-0.5 text-xs text-muted-foreground">{b.eventDate} {b.eventTime}</div>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${STAGE_BADGE[b.executionStage] ?? "bg-muted"}`}>{STAGE_LABEL[b.executionStage]}</span>
      </div>
      {b.remainingAmount > 0 && <div className="mt-2 text-xs font-medium text-destructive">متبقٍ: {money(b.remainingAmount)} د.ع</div>}
    </Link>
  );
}

function Dashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof staffApi.dashboard>> | null>(null);
  const [, nav] = useLocation();
  useEffect(() => { staffApi.dashboard().then(setData).catch(() => {}); }, []);
  if (!data) return <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>;
  const order: Bucket[] = ["today", "tomorrow", "upcoming", "late", "completed"];
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2">
        {order.map((bk) => (
          <button key={bk} onClick={() => nav(`/staff/koshas/list/${bk}`)} className="rounded-xl border border-border bg-card p-3 text-right">
            <div className="text-2xl font-extrabold text-primary">{data.counts[bk] ?? 0}</div>
            <div className="text-sm text-muted-foreground">{BUCKET_LABEL[bk]}</div>
          </button>
        ))}
      </div>
      {data.todayBookings.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold">حجوزات اليوم</h2>
          <div className="space-y-2">{data.todayBookings.map((b) => <BookingCard key={b.id} b={b} />)}</div>
        </section>
      )}
      {data.tomorrowBookings.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold">حجوزات الغد</h2>
          <div className="space-y-2">{data.tomorrowBookings.map((b) => <BookingCard key={b.id} b={b} />)}</div>
        </section>
      )}
      {data.todayBookings.length === 0 && data.tomorrowBookings.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد حجوزات اليوم أو غدًا</div>
      )}
    </div>
  );
}

function BookingsList({ bucket }: { bucket: Bucket | "all" }) {
  const [rows, setRows] = useState<CrewBooking[] | null>(null);
  const [search, setSearch] = useState("");
  const load = useCallback(() => { staffApi.bookings(bucket, search).then(setRows).catch(() => setRows([])); }, [bucket, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-bold">{bucket === "all" ? "كل الحجوزات" : BUCKET_LABEL[bucket as Bucket]}</h1>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف..." className="w-full bg-transparent py-2 text-sm outline-none" />
      </div>
      {!rows ? <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>
        : rows.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد حجوزات</div>
        : <div className="space-y-2">{rows.map((b) => <BookingCard key={b.id} b={b} />)}</div>}
    </div>
  );
}

function Notifications() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof staffApi.notifications>> | null>(null);
  const load = useCallback(() => staffApi.notifications().then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  async function readAll() { await staffApi.markAllRead().catch(() => {}); load(); }
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">الإشعارات</h1>
        <button onClick={readAll} className="text-sm text-primary">تعليم الكل كمقروء</button>
      </div>
      {!rows ? <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>
        : rows.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد إشعارات</div>
        : <div className="space-y-2">{rows.map((n) => (
            <div key={n.id} className={`rounded-xl border p-3 ${n.isRead ? "border-border bg-card" : "border-primary/40 bg-primary/5"}`}>
              <div className="font-bold">{n.title}</div>
              {n.body && <div className="text-sm text-muted-foreground">{n.body}</div>}
              <div className="mt-1 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("ar-IQ")}</div>
            </div>
          ))}</div>}
    </div>
  );
}

function Reports() {
  const [r, setR] = useState<Awaited<ReturnType<typeof staffApi.reportMe>> | null>(null);
  useEffect(() => { staffApi.reportMe().then(setR).catch(() => {}); }, []);
  if (!r) return <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>;
  const cards = [
    ["كوشات منفّذة", r.executed], ["كوشات مسلّمة", r.delivered],
    ["حالات كسر", r.breakage], ["حالات فقدان", r.loss],
  ];
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">تقاريري</h1>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-border bg-card p-3">
            <div className="text-2xl font-extrabold text-primary">{v as number}</div>
            <div className="text-sm text-muted-foreground">{l as string}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="text-sm text-muted-foreground">المبالغ المُحصّلة (المعتمدة)</div>
        <div className="text-2xl font-extrabold text-green-600">{money(r.collected)} د.ع</div>
        <div className="text-xs text-muted-foreground">{r.collectedCount} عملية تحصيل</div>
      </div>
    </div>
  );
}

function Approvals() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof staffApi.paymentRequests>> | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => staffApi.paymentRequests("pending").then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  async function act(id: number, kind: "approve" | "reject") {
    setBusy(id);
    try { kind === "approve" ? await staffApi.approve(id) : await staffApi.reject(id); await load(); }
    finally { setBusy(null); }
  }
  return (
    <div className="space-y-3 p-4">
      <h1 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5 text-primary" /> طلبات التحصيل</h1>
      {!rows ? <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>
        : rows.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد طلبات بانتظار الموافقة</div>
        : <div className="space-y-2">{rows.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="font-bold">{money(p.amount)} د.ع</div>
                <div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("ar-IQ")}</div>
              </div>
              <div className="text-sm text-muted-foreground">{p.staffName} · {p.booking?.customerName ?? "—"}</div>
              {p.note && <div className="mt-0.5 text-sm">{p.note}</div>}
              <div className="mt-2 flex gap-2">
                <button disabled={busy === p.id} onClick={() => act(p.id, "approve")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-sm font-bold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" /> موافقة</button>
                <button disabled={busy === p.id} onClick={() => act(p.id, "reject")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-destructive/40 py-2 text-sm font-bold text-destructive disabled:opacity-60"><XCircle className="h-4 w-4" /> رفض</button>
              </div>
            </div>
          ))}</div>}
    </div>
  );
}

export default function StaffPortal() {
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const [unread, setUnread] = useState(0);
  const [pendingOps, setPendingOps] = useState(0);
  const [location, nav] = useLocation();
  const lastNotifIds = useRef<Set<number>>(new Set());

  const refreshMe = useCallback(() => { fetchAdminMe({ force: true }).then(setMe); }, []);
  useEffect(() => { refreshMe(); }, [refreshMe]);

  const canStaff = !!me && hasPerm(me, "koshas");
  const isManager = !!me && (hasPerm(me, "accounting") || hasPerm(me, "bookings") || me.role === "admin");
  const allowed = canStaff || isManager;

  // Poll notifications (push-like) + fire a browser notification for new items.
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    async function poll() {
      try {
        const rows = await staffApi.notifications();
        if (!alive) return;
        setUnread(rows.filter((n) => !n.isRead).length);
        for (const n of rows) {
          if (!lastNotifIds.current.has(n.id)) {
            lastNotifIds.current.add(n.id);
            if (!n.isRead && lastNotifIds.current.size > rows.length && "Notification" in window && Notification.permission === "granted") {
              try { new Notification(n.title, { body: n.body ?? "" }); } catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore */ }
    }
    poll();
    const t = setInterval(poll, 30000);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    return () => { alive = false; clearInterval(t); };
  }, [allowed]);

  // Offline write-queue: flush on mount + when connectivity returns; track pending count.
  useEffect(() => {
    if (!allowed) return;
    const update = () => countOps().then(setPendingOps).catch(() => {});
    const onOnline = () => flushQueue().then(() => update());
    update();
    flushQueue().then(() => update());
    window.addEventListener("online", onOnline);
    window.addEventListener("ajn-queue-changed", update);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("ajn-queue-changed", update); };
  }, [allowed]);

  if (me === undefined) return <Spinner />;
  if (!me) return <Login onDone={refreshMe} />;
  if (!allowed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">حسابك لا يملك صلاحية الوصول لبوابة الكوشات.</p>
        <button onClick={() => logoutAdmin().then(refreshMe)} className="rounded-lg border border-border px-4 py-2 text-sm">تسجيل الخروج</button>
      </div>
    );
  }

  const onDetail = /^\/staff\/koshas\/booking\//.test(location);
  const tabs = [
    canStaff && { href: "/staff/koshas", label: "الرئيسية", icon: Home, match: location === "/staff/koshas" },
    canStaff && { href: "/staff/koshas/list/all", label: "الحجوزات", icon: ClipboardList, match: location.startsWith("/staff/koshas/list") },
    canStaff && { href: "/staff/koshas/reports", label: "تقاريري", icon: BarChart3, match: location === "/staff/koshas/reports" },
    { href: "/staff/koshas/notifications", label: "الإشعارات", icon: Bell, match: location === "/staff/koshas/notifications", badge: unread },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: any; match: boolean; badge?: number }>;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Armchair className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-bold leading-none">كادر الكوشات</div>
            <div className="text-[11px] text-muted-foreground">{me.fullName || me.username}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {pendingOps > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-bold text-amber-600"><CloudOff className="h-3.5 w-3.5" /> {pendingOps} بانتظار الرفع</span>
          )}
          <button onClick={() => logoutAdmin().then(refreshMe)} aria-label="خروج" className="text-muted-foreground"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>

      <main className="pb-20">
        <Switch>
          <Route path="/staff/koshas/booking/:id">{(p) => <StaffBookingDetail id={Number(p.id)} onBack={() => window.history.back()} />}</Route>
          <Route path="/staff/koshas/list/:bucket">{(p) => <BookingsList bucket={(p.bucket as Bucket | "all") ?? "all"} />}</Route>
          <Route path="/staff/koshas/list"><BookingsList bucket="all" /></Route>
          <Route path="/staff/koshas/notifications"><Notifications /></Route>
          <Route path="/staff/koshas/reports"><Reports /></Route>
          <Route path="/staff/koshas"><Dashboard /></Route>
          <Route><Dashboard /></Route>
        </Switch>
      </main>

      {!onDetail && (
        <nav className="fixed bottom-0 inset-x-0 z-20 flex items-center justify-around border-t border-border bg-background/95 backdrop-blur">
          {tabs.map((t) => (
            <button key={t.href} onClick={() => nav(t.href)} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${t.match ? "text-primary" : "text-muted-foreground"}`}>
              <t.icon className="h-5 w-5" />
              {t.label}
              {!!t.badge && t.badge > 0 && <span className="absolute top-1 right-[28%] flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">{t.badge}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
