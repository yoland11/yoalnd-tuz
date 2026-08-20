import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive, Bell, BellRing, CalendarDays, CheckCircle2, ChevronLeft,
  ClipboardCheck, Clock3, Home, Loader2, LogOut, MapPin,
  MessageCircle, PackageSearch, QrCode, ReceiptText, ShieldCheck,
  UserRound, UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/query-client";
import {
  adminFetch, fetchAdminMe, hasPerm, loginAdmin, logoutAdmin,
  type AdminMe,
} from "@/views/admin/_lib";

type Tab = "home" | "tasks" | "bookings" | "notifications" | "account";
type Task = { id: number; title: string; description: string; status: string; priority: string; dueAt: string | null; startAt: string | null; relatedType: string | null; relatedId: number | null };
type Booking = { id: number; source: string; service: string; customer: string; date: string | null; time: string | null; location: string | null; status: string; href: string };
type Notice = { id: number; type: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string };
type Payroll = { id: number; runNo: string | null; period: string | null; status: string | null; paidAt: string | null; baseSalary: number; overtimeAmount: number; bonusAmount: number; penaltyAmount: number; advanceDeduction: number; insuranceAmount: number; grossSalary: number; netSalary: number; receivedAt: string | null; receivedBy: string | null; canAcknowledge: boolean };

const money = new Intl.NumberFormat("ar-IQ", { style: "currency", currency: "IQD", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium" });

function textDate(value: string | null | undefined, withTime = false) {
  if (!value) return "غير محدد";
  const valueDate = new Date(value);
  return Number.isNaN(valueDate.getTime()) ? value : (withTime ? dateTime : dateOnly).format(valueDate);
}

function statusLabel(status: string) {
  return ({ new: "جديدة", in_progress: "قيد التنفيذ", review: "بانتظار المراجعة", completed: "مكتملة", cancelled: "ملغاة", preparing: "تجهيز", ready: "جاهز", active: "نشط" } as Record<string, string>)[status] ?? status;
}

function priorityClass(priority: string) {
  return priority === "urgent" || priority === "high"
    ? "bg-destructive/10 text-destructive"
    : priority === "low" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary";
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><h2 className="text-base font-extrabold text-foreground">{children}</h2>{action}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-7 text-center text-sm text-muted-foreground">{children}</div>;
}

function Failure({ title, error }: { title: string; error: unknown }) {
  const details = error instanceof Error ? error.message.replace(/^HTTP\s+\d+:\s*/, "") : "تعذر جلب البيانات حالياً";
  return <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"><strong>{title}</strong><div className="mt-1">{details}</div></div>;
}

function PortalLogin({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await loginAdmin(username.trim(), password); onDone(); }
    catch (reason: any) { setError(String(reason?.message ?? "تعذر تسجيل الدخول").replace(/^HTTP\s+\d+:\s*/, "")); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-background px-5" dir="rtl">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-6 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><UsersRound className="h-5 w-5" /></span><div><h1 className="font-extrabold">بوابة موظفي AJN</h1><p className="mt-1 text-xs text-muted-foreground">ادخل لمهامك وحجوزاتك ومستحقاتك</p></div></div>
      {error ? <div className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="space-y-3"><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="اسم المستخدم" autoComplete="username" /><Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="كلمة المرور" type="password" autoComplete="current-password" /><Button className="h-11 w-full" disabled={busy || !username || !password}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "تسجيل الدخول"}</Button></div>
    </form>
  </main>;
}

export default function UnifiedStaffPortal() {
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    return value === "tasks" || value === "bookings" || value === "notifications" || value === "account" ? value : "home";
  });
  const { toast } = useToast();
  useEffect(() => { void fetchAdminMe({ force: true }).then(setMe); }, []);
  const dashboard = useQuery({ queryKey: ["staff-portal", "dashboard"], queryFn: () => adminFetch<any>("/staff/portal/dashboard"), enabled: Boolean(me) });
  const bookings = useQuery({ queryKey: ["staff-portal", "bookings"], queryFn: () => adminFetch<{ today: string; data: Booking[] }>("/staff/portal/bookings"), enabled: Boolean(me) });
  const notifications = useQuery({ queryKey: ["staff-portal", "notifications"], queryFn: () => adminFetch<{ data: Notice[] }>("/staff/portal/notifications"), enabled: Boolean(me) });
  const payroll = useQuery({ queryKey: ["staff-portal", "payroll"], queryFn: () => adminFetch<{ data: Payroll[] }>("/staff/portal/payroll"), enabled: Boolean(me) && tab === "account" });
  const tasks = (dashboard.data?.tasks ?? []) as Task[];
  const bookingRows = bookings.data?.data ?? [];
  const unread = (notifications.data?.data ?? []).filter((notice) => !notice.readAt).length;
  const today = dashboard.data?.today ?? "";
  const todayBookings = bookingRows.filter((booking) => booking.date === today);
  const upcomingBookings = bookingRows.filter((booking) => booking.date && booking.date >= today).slice(0, 6);
  const nextTask = tasks.find((task) => ["new", "in_progress"].includes(task.status));

  const taskAction = useMutation({
    mutationFn: async ({ task, action }: { task: Task; action: "start" | "submit" }) => adminFetch(`/admin/tasks/${task.id}/${action === "start" ? "progress" : "submit"}`, { method: "POST", body: JSON.stringify(action === "start" ? { items: [] } : {}) }),
    onSuccess: (_data, input) => { queryClient.invalidateQueries({ queryKey: ["staff-portal", "dashboard"] }); toast({ title: input.action === "start" ? "بدأت المهمة" : "أُرسلت المهمة للمراجعة" }); },
    onError: (error: any) => toast({ variant: "destructive", title: "تعذر تحديث المهمة", description: error?.message }),
  });
  const receipt = useMutation({
    mutationFn: (line: Payroll) => adminFetch(`/staff/portal/payroll/${line.id}/acknowledge`, { method: "POST" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["staff-portal", "payroll"] }); queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] }); toast({ title: "تم تسجيل تأكيد الاستلام" }); },
    onError: (error: any) => toast({ variant: "destructive", title: "تعذر تسجيل الاستلام", description: error?.message }),
  });

  const selectTab = (next: Tab) => { setTab(next); window.history.replaceState(null, "", next === "home" ? "/staff" : `/staff?tab=${next}`); };
  const navigation = useMemo(() => [
    { id: "home" as Tab, label: "الرئيسية", icon: Home }, { id: "tasks" as Tab, label: "مهامي", icon: ClipboardCheck }, { id: "bookings" as Tab, label: "حجوزاتي", icon: CalendarDays }, { id: "notifications" as Tab, label: "الإشعارات", icon: Bell }, { id: "account" as Tab, label: "حسابي", icon: UserRound },
  ], []);

  if (me === undefined) return <div className="grid min-h-dvh place-items-center bg-background"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (!me) return <PortalLogin onDone={() => void fetchAdminMe({ force: true }).then(setMe)} />;

  const account = dashboard.data?.staff;
  return <div className="min-h-dvh bg-muted/35 text-foreground" dir="rtl">
    <aside className="fixed inset-y-0 right-0 z-20 hidden w-64 border-l border-border bg-card p-4 lg:flex lg:flex-col">
      <div className="mb-7 flex items-center gap-3 px-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><UsersRound className="h-5 w-5" /></span><div><div className="font-extrabold">بوابة موظفي AJN</div><div className="text-xs text-muted-foreground">مساحة العمل اليومية</div></div></div>
      <nav className="space-y-1">{navigation.map((item) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-right text-sm font-semibold transition-colors ${tab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon className="h-4 w-4" />{item.label}{item.id === "notifications" && unread ? <span className="mr-auto rounded-full bg-destructive px-2 py-0.5 text-[11px] text-destructive-foreground">{unread}</span> : null}</button>)}</nav>
      <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
        {hasPerm(me, "koshas") ? <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/staff/koshas"><PackageSearch className="h-4 w-4" />بوابة الكوشات</a> : null}
        {hasPerm(me, "photography") ? <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/staff/photography"><QrCode className="h-4 w-4" />بوابة التصوير</a> : null}
        {hasPerm(me, "warehouse_issue") || hasPerm(me, "booking_assets_manage") ? <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/admin/assets"><Archive className="h-4 w-4" />المخزون و QR</a> : null}
        {hasPerm(me, "staff") ? <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/admin/attendance"><Clock3 className="h-4 w-4" />الحضور</a> : null}
        {hasPerm(me, "approvals.view") ? <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/admin/approvals"><ShieldCheck className="h-4 w-4" />الطلبات الإدارية</a> : null}
        {hasPerm(me, "staff") ? <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/admin/hr/performance"><UsersRound className="h-4 w-4" />أدائي</a> : null}
        <a className="mb-3 flex min-h-10 items-center gap-3 hover:text-foreground" href="/admin/messages"><MessageCircle className="h-4 w-4" />الرسائل</a>
      </div>
      <button type="button" onClick={() => void logoutAdmin().then(() => setMe(null))} className="mt-auto flex min-h-11 items-center gap-3 px-3 text-sm font-semibold text-muted-foreground hover:text-destructive"><LogOut className="h-4 w-4" />تسجيل الخروج</button>
    </aside>

    <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 lg:mr-64 lg:px-8 lg:pb-10">
      <header className="mb-6 flex items-start justify-between gap-4"><div><div className="mb-1 text-sm text-muted-foreground">مرحباً، {account?.name ?? me.fullName}</div><h1 className="text-2xl font-black tracking-tight">{tab === "home" ? "ما الذي لدي اليوم؟" : ({ tasks: "مهامي", bookings: "حجوزاتي", notifications: "الإشعارات", account: "حسابي ومستحقاتي" } as Record<string, string>)[tab]}</h1><p className="mt-1 text-sm text-muted-foreground">{account?.jobTitle || account?.department || "بوابة عملك الموحدة"}</p></div><button type="button" onClick={() => selectTab("notifications")} className="relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground"><Bell className="h-5 w-5" />{unread ? <span className="absolute left-1 top-1 h-2.5 w-2.5 rounded-full bg-destructive" /> : null}</button></header>

      {dashboard.isError ? <Failure title="تعذر تحميل مساحة العمل" error={dashboard.error} /> : null}
      {tab === "home" ? <div className="space-y-6">
        <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
          <div className="rounded-2xl bg-primary p-5 text-primary-foreground"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-primary-foreground/75">الخطوة التالية</p><h2 className="mt-2 text-xl font-black">{nextTask?.title ?? todayBookings[0]?.customer ?? "يومك مرتب"}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-primary-foreground/80">{nextTask ? (nextTask.dueAt ? `موعد الإنجاز: ${textDate(nextTask.dueAt, true)}` : "هذه المهمة بانتظار البدء") : todayBookings[0] ? `${todayBookings[0].service} · ${todayBookings[0].location ?? "الموقع سيظهر في التفاصيل"}` : "لا توجد مهمة أو حجز عاجل الآن."}</p></div><CalendarDays className="h-6 w-6 text-primary-foreground/80" /></div>{nextTask ? <Button variant="secondary" className="mt-5 min-h-11" onClick={() => taskAction.mutate({ task: nextTask, action: nextTask.status === "new" ? "start" : "submit" })} disabled={taskAction.isPending}>{taskAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : nextTask.status === "new" ? "ابدأ المهمة" : "إرسال للمراجعة"}</Button> : null}</div>
          <dl className="grid grid-cols-3 divide-x divide-x-reverse divide-border rounded-2xl border border-border bg-card"><div className="p-4"><dt className="text-xs text-muted-foreground">مهام اليوم</dt><dd className="mt-2 text-2xl font-black">{dashboard.data?.summary.todayTasks ?? "—"}</dd></div><div className="p-4"><dt className="text-xs text-muted-foreground">حجوزات اليوم</dt><dd className="mt-2 text-2xl font-black">{bookings.isLoading ? "…" : todayBookings.length}</dd></div><div className="p-4"><dt className="text-xs text-muted-foreground">متأخرة</dt><dd className="mt-2 text-2xl font-black text-destructive">{dashboard.data?.summary.overdueTasks ?? "—"}</dd></div></dl>
        </section>
        <section className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
          <div className="rounded-2xl border border-border bg-card p-5"><SectionTitle action={<button className="text-sm font-bold text-primary" onClick={() => selectTab("tasks")}>كل المهام</button>}>جدول اليوم</SectionTitle><div className="mt-4 divide-y divide-border">{[...tasks.filter((task) => task.dueAt?.slice(0, 10) === today), ...todayBookings.map((booking) => ({ ...booking, kind: "booking" as const }))].slice(0, 8).map((item: any) => <div key={`${item.kind ?? "task"}-${item.id}`} className="flex items-center gap-3 py-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{item.kind === "booking" ? <CalendarDays className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="truncate font-bold">{item.kind === "booking" ? item.customer : item.title}</div><div className="mt-1 text-xs text-muted-foreground">{item.kind === "booking" ? `${item.service} · ${item.time ?? "الوقت يحدد لاحقاً"}` : textDate(item.dueAt, true)}</div></div><span className="text-xs font-semibold text-muted-foreground">{item.kind === "booking" ? statusLabel(item.status) : statusLabel(item.status)}</span></div>)}</div>{!tasks.length && !todayBookings.length ? <Empty>لا توجد مواعيد أو مهام مسجلة اليوم.</Empty> : null}</div>
          <div className="space-y-6"><div className="rounded-2xl border border-border bg-card p-5"><SectionTitle action={<button className="text-sm font-bold text-primary" onClick={() => selectTab("notifications")}>عرض الكل</button>}>إشعارات جديدة</SectionTitle><div className="mt-3 space-y-1">{notifications.isError ? <Failure title="تعذر تحميل الإشعارات" error={notifications.error} /> : (notifications.data?.data ?? []).slice(0, 4).map((notice) => <button key={notice.id} type="button" onClick={() => { if (!notice.readAt) void adminFetch(`/staff/portal/notifications/${notice.id}/read`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] })); if (notice.href) window.location.href = notice.href; }} className={`w-full rounded-lg px-2 py-3 text-right ${notice.readAt ? "text-muted-foreground" : "bg-primary/5 text-foreground"}`}><div className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><div className="truncate text-sm font-bold">{notice.title}</div><div className="mt-1 line-clamp-2 text-xs">{notice.body}</div></div></div></button>)}{!notifications.isLoading && !(notifications.data?.data ?? []).length ? <Empty>لا توجد إشعارات جديدة.</Empty> : null}</div></div>
          <div className="rounded-2xl border border-border bg-card p-5"><SectionTitle>الحضور</SectionTitle><div className="mt-3 flex items-center gap-3 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${dashboard.data?.attendance?.checkOutAt ? "bg-muted-foreground" : "bg-status-success"}`} /><div><div className="font-bold">{dashboard.data?.attendance ? (dashboard.data.attendance.checkOutAt ? "اكتمل دوامك الأخير" : "أنت مسجل حضوراً") : "لا يوجد تسجيل حضور حديث"}</div><div className="mt-1 text-xs text-muted-foreground">{dashboard.data?.attendance ? textDate(dashboard.data.attendance.checkInAt, true) : ""}</div></div></div></div></div>
        </section>
      </div> : null}

      {tab === "tasks" ? <section className="rounded-2xl border border-border bg-card"><div className="border-b border-border p-5"><SectionTitle action={hasPerm(me, "task_create") ? <a className="text-sm font-bold text-primary" href="/admin/tasks">إسناد وإدارة المهام</a> : undefined}>المهام المعيّنة لك</SectionTitle><p className="mt-1 text-sm text-muted-foreground">تُحفظ كل الإجراءات في سجل المهمة الأصلي.</p></div><div className="divide-y divide-border">{tasks.map((task) => <div key={task.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{task.title}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${priorityClass(task.priority)}`}>{task.priority === "urgent" ? "عاجلة" : task.priority === "high" ? "عالية" : task.priority === "low" ? "منخفضة" : "متوسطة"}</span></div>{task.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p> : null}<p className="mt-2 text-xs text-muted-foreground">{task.dueAt ? `موعد الإنجاز: ${textDate(task.dueAt, true)}` : "بدون موعد محدد"}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-muted px-2 py-1 text-xs font-bold text-muted-foreground">{statusLabel(task.status)}</span>{task.status === "new" ? <Button size="sm" onClick={() => taskAction.mutate({ task, action: "start" })} disabled={taskAction.isPending}>ابدأ</Button> : null}{task.status === "in_progress" ? <Button size="sm" onClick={() => taskAction.mutate({ task, action: "submit" })} disabled={taskAction.isPending}>إرسال للمراجعة</Button> : null}</div></div>)}{!tasks.length ? <div className="p-5"><Empty>لا توجد مهام معيّنة لك الآن.</Empty></div> : null}</div></section> : null}

      {tab === "bookings" ? <section className="space-y-4"><div className="rounded-2xl border border-border bg-card p-5"><SectionTitle>الحجوزات المعينة لك</SectionTitle><p className="mt-1 text-sm text-muted-foreground">تُعرض الحجوزات الأصلية فقط؛ فتح التفاصيل ينقلك إلى بوابة الخدمة المناسبة.</p></div>{bookings.isError ? <Failure title="تعذر تحميل الحجوزات" error={bookings.error} /> : null}<div className="grid gap-4 md:grid-cols-2">{upcomingBookings.map((booking) => <a key={`${booking.source}-${booking.id}`} href={booking.href} className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold text-primary">{booking.service}</div><h3 className="mt-1 truncate text-lg font-extrabold">{booking.customer}</h3></div><ChevronLeft className="h-5 w-5 text-muted-foreground" /></div><div className="mt-5 space-y-2 text-sm text-muted-foreground"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{booking.date ?? "غير محدد"}{booking.time ? ` · ${booking.time}` : ""}</div><div className="flex items-center gap-2"><MapPin className="h-4 w-4" />{booking.location ?? "الموقع غير محدد"}</div></div><div className="mt-4 text-xs font-bold text-muted-foreground">{statusLabel(booking.status)}</div></a>)}</div>{!bookings.isLoading && !upcomingBookings.length ? <Empty>لا توجد حجوزات مخصصة لك حالياً.</Empty> : null}</section> : null}

      {tab === "notifications" ? <section className="rounded-2xl border border-border bg-card"><div className="border-b border-border p-5"><SectionTitle>كل الإشعارات</SectionTitle></div><div className="divide-y divide-border">{notifications.isError ? <div className="p-5"><Failure title="تعذر تحميل الإشعارات" error={notifications.error} /></div> : null}{(notifications.data?.data ?? []).map((notice) => <button key={notice.id} type="button" onClick={() => { if (!notice.readAt) void adminFetch(`/staff/portal/notifications/${notice.id}/read`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] })); if (notice.href) window.location.href = notice.href; }} className={`flex w-full gap-3 p-5 text-right hover:bg-muted/35 ${notice.readAt ? "text-muted-foreground" : "bg-primary/5"}`}><Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="font-extrabold">{notice.title}</div><p className="mt-1 text-sm leading-6">{notice.body}</p><div className="mt-2 text-xs">{textDate(notice.createdAt, true)}</div></div></button>)}{!notifications.isLoading && !(notifications.data?.data ?? []).length ? <div className="p-5"><Empty>لا توجد إشعارات.</Empty></div> : null}</div></section> : null}

      {tab === "account" ? <section className="space-y-5"><div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span><div><h2 className="font-extrabold">{account?.name ?? me.fullName}</h2><p className="mt-1 text-sm text-muted-foreground">{account?.jobTitle || account?.department || me.role}</p></div></div></div><div className="rounded-2xl border border-border bg-card p-5"><SectionTitle>راتبي ومستحقاتي</SectionTitle><p className="mt-1 text-sm text-muted-foreground">تظهر لك تفاصيل سجلاتك فقط، بما فيها المكافآت والخصومات وتأكيد الاستلام.</p>{payroll.isError ? <div className="mt-4"><Failure title="تعذر تحميل سجلات الراتب" error={payroll.error} /></div> : null}<div className="mt-4 space-y-3">{(payroll.data?.data ?? []).map((line) => <article key={line.id} className="rounded-xl bg-muted/45 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold">راتب {line.period ?? line.runNo ?? "غير محدد"}</h3><p className="mt-1 text-xs text-muted-foreground">{line.paidAt ? `تم الدفع: ${textDate(line.paidAt, true)}` : "بانتظار تسجيل الدفع"}</p></div><strong className="text-lg text-primary">{money.format(line.netSalary)}</strong></div><dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">الأساسي</dt><dd className="font-bold">{money.format(line.baseSalary)}</dd></div><div><dt className="text-xs text-muted-foreground">المكافآت</dt><dd className="font-bold text-status-success">+ {money.format(line.bonusAmount + line.overtimeAmount)}</dd></div><div><dt className="text-xs text-muted-foreground">الغرامات والخصم</dt><dd className="font-bold text-destructive">− {money.format(line.penaltyAmount + line.advanceDeduction + line.insuranceAmount)}</dd></div><div><dt className="text-xs text-muted-foreground">الإجمالي</dt><dd className="font-bold">{money.format(line.grossSalary)}</dd></div></dl><div className="mt-4">{line.receivedAt ? <div className="flex items-center gap-2 text-sm font-bold text-status-success"><CheckCircle2 className="h-4 w-4" />تم التأكيد بواسطة {line.receivedBy} · {textDate(line.receivedAt, true)}</div> : line.canAcknowledge ? <Button className="min-h-11" onClick={() => receipt.mutate(line)} disabled={receipt.isPending}>{receipt.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ReceiptText className="h-4 w-4" />تم الاستلام</>}</Button> : <span className="text-sm text-muted-foreground">سيظهر زر التأكيد بعد تسجيل دفع الراتب.</span>}</div></article>)}{!payroll.isLoading && !(payroll.data?.data ?? []).length ? <Empty>لا توجد مسيرات راتب ظاهرة لك بعد.</Empty> : null}</div></div></section> : null}
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">{navigation.map((item) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-bold ${tab === item.id ? "text-primary" : "text-muted-foreground"}`}><item.icon className="h-5 w-5" />{item.label}{item.id === "notifications" && unread ? <span className="absolute top-2 h-2 w-2 rounded-full bg-destructive" /> : null}</button>)}</nav>
  </div>;
}
