import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Archive, Bell, BellRing, CalendarDays, CheckCircle2, ChevronLeft,
  ClipboardCheck, Clock3, Home, Loader2, LogOut, MapPin,
  MessageCircle, PackageSearch, QrCode, ReceiptText, ShieldCheck,
  UserRound, UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TaskFileList, TaskFilePicker, TaskPhotoGallery, TaskPhotoPicker, type TaskFile, type TaskPhoto } from "@/components/task-photo-gallery";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/query-client";
import {
  adminFetch, apiErrorMessage, apiErrorStatus, fetchAdminMe, hasPerm,
  isSessionDecision, loginAdmin, logoutAdmin,
  type AdminMe,
} from "@/views/admin/_lib";

type Tab = "home" | "tasks" | "bookings" | "notifications" | "account";
type Task = {
  id: number; taskNo?: string | null; title: string; description: string; status: string; priority: string; dueAt: string | null; startAt: string | null;
  relatedType: string | null; relatedId: number | null; department?: string | null; location?: string | null; notes?: string; completionNotes?: string; submittedAt?: string | null; completedAt?: string | null;
  managerPhotos?: TaskPhoto[]; employeePhotos?: TaskPhoto[]; employeeFiles?: TaskFile[];
  checklistItems?: Array<{ id: number; title: string; requiredQuantity: number; completedQuantity: number }>;
  comments?: Array<{ id: number; body: string; createdAt: string; staff?: { fullName?: string; username?: string } | null }>;
  timeline?: Array<{ id: number; title: string; body?: string | null; createdAt: string; actorName?: string | null; metadata?: Record<string, unknown> }>;
  completionPercent?: number;
};
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
  return ({ new: "جديدة", accepted: "تم استلام المهمة", in_progress: "جاري العمل", review: "بانتظار اعتماد المدير", completed: "مكتملة", cancelled: "ملغاة", preparing: "تجهيز", ready: "جاهز", active: "نشط" } as Record<string, string>)[status] ?? status;
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

function Failure({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  const details = error instanceof Error ? error.message.replace(/^HTTP\s+\d+:\s*/, "") : "تعذر جلب البيانات حالياً";
  const requestId = typeof error === "object" && error && "requestId" in error ? String((error as { requestId?: string }).requestId ?? "") : "";
  return <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"><strong>{title}</strong><div className="mt-1">{details}</div>{requestId ? <div className="mt-2 font-mono text-[11px] text-destructive/80" dir="ltr">Request ID: {requestId}</div> : null}{onRetry ? <Button type="button" size="sm" variant="outline" className="mt-3 min-h-10 border-destructive/30 bg-background text-destructive hover:text-destructive" onClick={onRetry}>إعادة المحاولة</Button> : null}</div>;
}

function WorkspaceSkeleton() {
  return <div className="space-y-4" aria-label="جاري تحميل مساحة العمل"><div className="h-32 animate-pulse rounded-2xl bg-muted" /><div className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-muted" />)}</div></div>;
}

function PortalLogin({ onDone }: { onDone: (user: AdminMe) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const user = await loginAdmin(username.trim(), password);
      onDone(user);
    }
    catch (reason: unknown) {
      if (isSessionDecision(reason) && typeof window !== "undefined" && window.confirm(reason.message)) {
        try {
          const user = await loginAdmin(username.trim(), password, { forceReplace: true });
          onDone(user);
        } catch (retryReason: unknown) {
          setError(apiErrorMessage(retryReason, "تعذر تسجيل الدخول"));
        }
      } else if (!isSessionDecision(reason)) {
        setError(apiErrorMessage(reason, "بيانات الدخول غير صحيحة"));
      }
    }
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
  const [, navigate] = useLocation();
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    return value === "tasks" || value === "bookings" || value === "notifications" || value === "account" ? value : "home";
  });
  const { toast } = useToast();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void fetchAdminMe({ force: true }).then((user) => {
      if (!active) return;
      setMe(user);
      const onLoginRoute = window.location.pathname === "/staff/login";
      if (user && onLoginRoute) navigate("/staff", { replace: true });
      if (!user && !onLoginRoute) navigate("/staff/login", { replace: true });
    });
    return () => { active = false; };
  }, [navigate]);
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
  const nextTask = tasks.find((task) => ["new", "accepted", "in_progress"].includes(task.status));
  const sessionError = dashboard.error ?? bookings.error ?? notifications.error ?? payroll.error;

  useEffect(() => {
    if (apiErrorStatus(sessionError) !== 401) return;
    void logoutAdmin().finally(() => {
      setMe(null);
      navigate("/staff/login", { replace: true });
    });
  }, [navigate, sessionError]);

  const taskAction = useMutation({
    mutationFn: async ({ task, statusAction }: { task: Task; statusAction: "accept" | "start" }) => adminFetch(`/admin/tasks/${task.id}/progress`, { method: "POST", body: JSON.stringify({ items: [], statusAction }) }),
    onSuccess: (_data, variables) => { queryClient.invalidateQueries({ queryKey: ["staff-portal", "dashboard"] }); toast({ title: variables.statusAction === "accept" ? "تم استلام المهمة" : "بدأ العمل بالمهمة" }); },
    onError: (error: any) => toast({ variant: "destructive", title: "تعذر تحديث المهمة", description: error?.message }),
  });
  const receipt = useMutation({
    mutationFn: (line: Payroll) => adminFetch(`/staff/portal/payroll/${line.id}/acknowledge`, { method: "POST" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["staff-portal", "payroll"] }); queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] }); toast({ title: "تم تسجيل تأكيد الاستلام" }); },
    onError: (error: any) => toast({ variant: "destructive", title: "تعذر تسجيل الاستلام", description: error?.message }),
  });
  const signOut = async () => {
    await logoutAdmin();
    setMe(null);
    navigate("/staff/login", { replace: true });
  };

  const selectTab = (next: Tab) => { setTab(next); window.history.replaceState(null, "", next === "home" ? "/staff" : `/staff?tab=${next}`); };
  const navigation = useMemo(() => [
    { id: "home" as Tab, label: "الرئيسية", icon: Home }, { id: "tasks" as Tab, label: "مهامي", icon: ClipboardCheck }, { id: "bookings" as Tab, label: "حجوزاتي", icon: CalendarDays }, { id: "notifications" as Tab, label: "الإشعارات", icon: Bell }, { id: "account" as Tab, label: "حسابي", icon: UserRound },
  ], []);

  if (me === undefined) return <div className="grid min-h-dvh place-items-center bg-background"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (!me) return <PortalLogin onDone={(user) => { setMe(user); navigate("/staff", { replace: true }); }} />;

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
      <button type="button" onClick={() => void signOut()} className="mt-auto flex min-h-11 items-center gap-3 px-3 text-sm font-semibold text-muted-foreground hover:text-destructive"><LogOut className="h-4 w-4" />تسجيل الخروج</button>
    </aside>

    <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 lg:mr-64 lg:px-8 lg:pb-10">
      <header className="mb-6 flex items-start justify-between gap-4"><div><div className="mb-1 text-sm text-muted-foreground">مرحباً، {account?.name ?? me.fullName}</div><h1 className="text-2xl font-black tracking-tight">{tab === "home" ? "ما الذي لدي اليوم؟" : ({ tasks: "مهامي", bookings: "حجوزاتي", notifications: "الإشعارات", account: "حسابي ومستحقاتي" } as Record<string, string>)[tab]}</h1><p className="mt-1 text-sm text-muted-foreground">{account?.jobTitle || account?.department || "بوابة عملك الموحدة"}</p></div><button type="button" onClick={() => selectTab("notifications")} className="relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground"><Bell className="h-5 w-5" />{unread ? <span className="absolute left-1 top-1 h-2.5 w-2.5 rounded-full bg-destructive" /> : null}</button></header>

      {dashboard.isError ? <Failure title="تعذر تحميل مساحة العمل" error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : null}
      {tab === "home" && dashboard.isLoading ? <WorkspaceSkeleton /> : null}
      {tab === "home" && !dashboard.isLoading ? <div className="space-y-6">
        <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
          <div className="rounded-2xl bg-primary p-5 text-primary-foreground"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-primary-foreground/75">الخطوة التالية</p><h2 className="mt-2 text-xl font-black">{nextTask?.title ?? todayBookings[0]?.customer ?? "يومك مرتب"}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-primary-foreground/80">{nextTask ? (nextTask.dueAt ? `موعد الإنجاز: ${textDate(nextTask.dueAt, true)}` : "هذه المهمة بانتظار البدء") : todayBookings[0] ? `${todayBookings[0].service} · ${todayBookings[0].location ?? "الموقع سيظهر في التفاصيل"}` : "لا توجد مهمة أو حجز عاجل الآن."}</p></div><CalendarDays className="h-6 w-6 text-primary-foreground/80" /></div>{nextTask ? <Button variant="secondary" className="mt-5 min-h-11" onClick={() => nextTask.status === "new" ? taskAction.mutate({ task: nextTask, statusAction: "accept" }) : nextTask.status === "accepted" ? taskAction.mutate({ task: nextTask, statusAction: "start" }) : setSelectedTaskId(nextTask.id)} disabled={taskAction.isPending}>{taskAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : nextTask.status === "new" ? "استلام المهمة" : nextTask.status === "accepted" ? "بدء العمل" : "فتح تفاصيل المهمة"}</Button> : null}</div>
          <dl className="grid grid-cols-3 divide-x divide-x-reverse divide-border rounded-2xl border border-border bg-card"><div className="p-4"><dt className="text-xs text-muted-foreground">مهام اليوم</dt><dd className="mt-2 text-2xl font-black">{dashboard.data?.summary.todayTasks ?? "—"}</dd></div><div className="p-4"><dt className="text-xs text-muted-foreground">حجوزات اليوم</dt><dd className="mt-2 text-2xl font-black">{bookings.isLoading ? "…" : todayBookings.length}</dd></div><div className="p-4"><dt className="text-xs text-muted-foreground">متأخرة</dt><dd className="mt-2 text-2xl font-black text-destructive">{dashboard.data?.summary.overdueTasks ?? "—"}</dd></div></dl>
        </section>
        <section className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
          <div className="rounded-2xl border border-border bg-card p-5"><SectionTitle action={<button className="text-sm font-bold text-primary" onClick={() => selectTab("tasks")}>كل المهام</button>}>جدول اليوم</SectionTitle><div className="mt-4 divide-y divide-border">{[...tasks.filter((task) => task.dueAt?.slice(0, 10) === today), ...todayBookings.map((booking) => ({ ...booking, kind: "booking" as const }))].slice(0, 8).map((item: any) => <div key={`${item.kind ?? "task"}-${item.id}`} className="flex items-center gap-3 py-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{item.kind === "booking" ? <CalendarDays className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="truncate font-bold">{item.kind === "booking" ? item.customer : item.title}</div><div className="mt-1 text-xs text-muted-foreground">{item.kind === "booking" ? `${item.service} · ${item.time ?? "الوقت يحدد لاحقاً"}` : textDate(item.dueAt, true)}</div></div><span className="text-xs font-semibold text-muted-foreground">{item.kind === "booking" ? statusLabel(item.status) : statusLabel(item.status)}</span></div>)}</div>{!tasks.length && !todayBookings.length ? <Empty>لا توجد مواعيد أو مهام مسجلة اليوم.</Empty> : null}</div>
          <div className="space-y-6"><div className="rounded-2xl border border-border bg-card p-5"><SectionTitle action={<button className="text-sm font-bold text-primary" onClick={() => selectTab("notifications")}>عرض الكل</button>}>إشعارات جديدة</SectionTitle><div className="mt-3 space-y-1">{notifications.isError ? <Failure title="تعذر تحميل الإشعارات" error={notifications.error} onRetry={() => void notifications.refetch()} /> : (notifications.data?.data ?? []).slice(0, 4).map((notice) => <button key={notice.id} type="button" onClick={() => { if (!notice.readAt) void adminFetch(`/staff/portal/notifications/${notice.id}/read`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] })); if (notice.href) window.location.href = notice.href; }} className={`w-full rounded-lg px-2 py-3 text-right ${notice.readAt ? "text-muted-foreground" : "bg-primary/5 text-foreground"}`}><div className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><div className="truncate text-sm font-bold">{notice.title}</div><div className="mt-1 line-clamp-2 text-xs">{notice.body}</div></div></div></button>)}{notifications.isSuccess && !(notifications.data?.data ?? []).length ? <Empty>لا توجد إشعارات جديدة.</Empty> : null}</div></div>
          <div className="rounded-2xl border border-border bg-card p-5"><SectionTitle>الحضور</SectionTitle><div className="mt-3 flex items-center gap-3 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${dashboard.data?.attendance?.checkOutAt ? "bg-muted-foreground" : "bg-status-success"}`} /><div><div className="font-bold">{dashboard.data?.attendance ? (dashboard.data.attendance.checkOutAt ? "اكتمل دوامك الأخير" : "أنت مسجل حضوراً") : "لا يوجد تسجيل حضور حديث"}</div><div className="mt-1 text-xs text-muted-foreground">{dashboard.data?.attendance ? textDate(dashboard.data.attendance.checkInAt, true) : ""}</div></div></div></div></div>
        </section>
      </div> : null}

      {tab === "tasks" && dashboard.isLoading ? <WorkspaceSkeleton /> : null}
      {tab === "tasks" && dashboard.isError ? <Failure title="تعذر تحميل المهام المعيّنة" error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : null}
      {tab === "tasks" && dashboard.isSuccess ? <section className="rounded-2xl border border-border bg-card"><div className="border-b border-border p-5"><SectionTitle action={hasPerm(me, "task_create") ? <a className="text-sm font-bold text-primary" href="/admin/tasks">إسناد وإدارة المهام</a> : undefined}>المهام المعيّنة لك</SectionTitle><p className="mt-1 text-sm text-muted-foreground">تُحفظ كل الإجراءات في سجل المهمة الأصلي.</p></div><div className="divide-y divide-border">{tasks.map((task) => <div key={task.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{task.title}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${priorityClass(task.priority)}`}>{task.priority === "urgent" ? "عاجلة" : task.priority === "high" ? "عالية" : task.priority === "low" ? "منخفضة" : "متوسطة"}</span></div>{task.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p> : null}<p className="mt-2 text-xs text-muted-foreground">{task.dueAt ? `موعد الإنجاز: ${textDate(task.dueAt, true)}` : "بدون موعد محدد"}</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-muted px-2 py-1 text-xs font-bold text-muted-foreground">{statusLabel(task.status)}</span>{task.status === "new" ? <Button size="sm" className="min-h-10" onClick={() => taskAction.mutate({ task, statusAction: "accept" })} disabled={taskAction.isPending}>استلام</Button> : null}{task.status === "accepted" ? <Button size="sm" className="min-h-10" onClick={() => taskAction.mutate({ task, statusAction: "start" })} disabled={taskAction.isPending}>بدء العمل</Button> : null}<Button size="sm" variant="outline" className="min-h-10" onClick={() => setSelectedTaskId(task.id)}>التفاصيل</Button></div></div>)}{!tasks.length ? <div className="p-5"><Empty>لا توجد مهام معينة لك الآن.</Empty></div> : null}</div></section> : null}

      {tab === "bookings" ? <section className="space-y-4"><div className="rounded-2xl border border-border bg-card p-5"><SectionTitle>الحجوزات المعينة لك</SectionTitle><p className="mt-1 text-sm text-muted-foreground">تُعرض الحجوزات الأصلية فقط؛ فتح التفاصيل ينقلك إلى بوابة الخدمة المناسبة.</p></div>{bookings.isLoading ? <WorkspaceSkeleton /> : null}{bookings.isError ? <Failure title="تعذر تحميل الحجوزات" error={bookings.error} onRetry={() => void bookings.refetch()} /> : null}<div className="grid gap-4 md:grid-cols-2">{upcomingBookings.map((booking) => <a key={`${booking.source}-${booking.id}`} href={booking.href} className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold text-primary">{booking.service}</div><h3 className="mt-1 truncate text-lg font-extrabold">{booking.customer}</h3></div><ChevronLeft className="h-5 w-5 text-muted-foreground" /></div><div className="mt-5 space-y-2 text-sm text-muted-foreground"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{booking.date ?? "غير محدد"}{booking.time ? ` · ${booking.time}` : ""}</div><div className="flex items-center gap-2"><MapPin className="h-4 w-4" />{booking.location ?? "الموقع غير محدد"}</div></div><div className="mt-4 text-xs font-bold text-muted-foreground">{statusLabel(booking.status)}</div></a>)}</div>{bookings.isSuccess && !upcomingBookings.length ? <Empty>لا توجد حجوزات مخصصة لك حالياً.</Empty> : null}</section> : null}

      {tab === "notifications" ? <section className="rounded-2xl border border-border bg-card"><div className="border-b border-border p-5"><SectionTitle>كل الإشعارات</SectionTitle></div><div className="divide-y divide-border">{notifications.isLoading ? <div className="p-5"><WorkspaceSkeleton /></div> : null}{notifications.isError ? <div className="p-5"><Failure title="تعذر تحميل الإشعارات" error={notifications.error} onRetry={() => void notifications.refetch()} /></div> : null}{(notifications.data?.data ?? []).map((notice) => <button key={notice.id} type="button" onClick={() => { if (!notice.readAt) void adminFetch(`/staff/portal/notifications/${notice.id}/read`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] })); if (notice.href) window.location.href = notice.href; }} className={`flex w-full gap-3 p-5 text-right hover:bg-muted/35 ${notice.readAt ? "text-muted-foreground" : "bg-primary/5"}`}><Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="font-extrabold">{notice.title}</div><p className="mt-1 text-sm leading-6">{notice.body}</p><div className="mt-2 text-xs">{textDate(notice.createdAt, true)}</div></div></button>)}{notifications.isSuccess && !(notifications.data?.data ?? []).length ? <div className="p-5"><Empty>لا توجد إشعارات.</Empty></div> : null}</div></section> : null}

      {tab === "account" ? <section className="space-y-5"><div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span><div><h2 className="font-extrabold">{account?.name ?? me.fullName}</h2><p className="mt-1 text-sm text-muted-foreground">{account?.jobTitle || account?.department || me.role}</p></div></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">الرقم الوظيفي</dt><dd className="mt-1 font-bold">#{account?.id ?? me.id}</dd></div><div><dt className="text-xs text-muted-foreground">القسم</dt><dd className="mt-1 font-bold">{account?.department || "عام"}</dd></div><div><dt className="text-xs text-muted-foreground">الدور</dt><dd className="mt-1 font-bold">{account?.role ?? me.role}</dd></div><div><dt className="text-xs text-muted-foreground">الصلاحيات</dt><dd className="mt-1 font-bold">{(account?.permissions ?? me.permissions).length}</dd></div></dl><Button type="button" variant="outline" className="mt-5 min-h-11 w-full lg:hidden" onClick={() => void signOut()}><LogOut className="h-4 w-4" />تسجيل الخروج</Button></div><div className="rounded-2xl border border-border bg-card p-5"><SectionTitle>راتبي ومستحقاتي</SectionTitle><p className="mt-1 text-sm text-muted-foreground">تظهر لك تفاصيل سجلاتك فقط، بما فيها المكافآت والخصومات وتأكيد الاستلام.</p>{payroll.isError ? <div className="mt-4"><Failure title="تعذر تحميل سجلات الراتب" error={payroll.error} /></div> : null}<div className="mt-4 space-y-3">{(payroll.data?.data ?? []).map((line) => <article key={line.id} className="rounded-xl bg-muted/45 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold">راتب {line.period ?? line.runNo ?? "غير محدد"}</h3><p className="mt-1 text-xs text-muted-foreground">{line.paidAt ? `تم الدفع: ${textDate(line.paidAt, true)}` : "بانتظار تسجيل الدفع"}</p></div><strong className="text-lg text-primary">{money.format(line.netSalary)}</strong></div><dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">الأساسي</dt><dd className="font-bold">{money.format(line.baseSalary)}</dd></div><div><dt className="text-xs text-muted-foreground">المكافآت</dt><dd className="font-bold text-status-success">+ {money.format(line.bonusAmount + line.overtimeAmount)}</dd></div><div><dt className="text-xs text-muted-foreground">الغرامات والخصم</dt><dd className="font-bold text-destructive">− {money.format(line.penaltyAmount + line.advanceDeduction + line.insuranceAmount)}</dd></div><div><dt className="text-xs text-muted-foreground">الإجمالي</dt><dd className="font-bold">{money.format(line.grossSalary)}</dd></div></dl><div className="mt-4">{line.receivedAt ? <div className="flex items-center gap-2 text-sm font-bold text-status-success"><CheckCircle2 className="h-4 w-4" />تم التأكيد بواسطة {line.receivedBy} · {textDate(line.receivedAt, true)}</div> : line.canAcknowledge ? <Button className="min-h-11" onClick={() => receipt.mutate(line)} disabled={receipt.isPending}>{receipt.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ReceiptText className="h-4 w-4" />تم الاستلام</>}</Button> : <span className="text-sm text-muted-foreground">سيظهر زر التأكيد بعد تسجيل دفع الراتب.</span>}</div></article>)}{!payroll.isLoading && !(payroll.data?.data ?? []).length ? <Empty>لا توجد مسيرات راتب ظاهرة لك بعد.</Empty> : null}</div></div></section> : null}
      <StaffTaskDialog taskId={selectedTaskId} open={selectedTaskId !== null} onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }} />
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">{navigation.map((item) => <button key={item.id} type="button" onClick={() => selectTab(item.id)} className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-bold ${tab === item.id ? "text-primary" : "text-muted-foreground"}`}><item.icon className="h-5 w-5" />{item.label}{item.id === "notifications" && unread ? <span className="absolute top-2 h-2 w-2 rounded-full bg-destructive" /> : null}</button>)}</nav>
  </div>;
}

function StaffTaskDialog({ taskId, open, onOpenChange }: { taskId: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const detail = useQuery<Task>({
    queryKey: ["staff-portal", "task", taskId],
    queryFn: () => adminFetch(`/admin/tasks/${taskId}`),
    enabled: open && Boolean(taskId),
  });
  const [photos, setPhotos] = useState<TaskPhoto[]>([]);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [progressNote, setProgressNote] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [completionPercent, setCompletionPercent] = useState(0);
  const [items, setItems] = useState<Array<{ id: number; title: string; requiredQuantity: number; completedQuantity: number }>>([]);
  useEffect(() => {
    setPhotos([]);
    setFiles([]);
    setProgressNote("");
    setCompletionNotes("");
    setCompletionPercent(0);
    setItems([]);
  }, [taskId]);
  useEffect(() => {
    if (!detail.data) return;
    setItems(detail.data.checklistItems ?? []);
    setCompletionNotes(detail.data.completionNotes ?? "");
    setCompletionPercent(detail.data.completionPercent ?? 0);
  }, [detail.data]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["staff-portal", "task", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["staff-portal", "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["staff-portal", "notifications"] }),
    ]);
  };
  const transition = useMutation({
    mutationFn: (statusAction: "accept" | "start") => adminFetch(`/admin/tasks/${taskId}/progress`, { method: "POST", body: JSON.stringify({ items: [], statusAction }) }),
    onSuccess: async (_data, statusAction) => { await refresh(); toast({ title: statusAction === "accept" ? "تم استلام المهمة" : "بدأ العمل بالمهمة" }); },
    onError: (error: any) => toast({ title: "تعذر تحديث حالة المهمة", description: error?.message, variant: "destructive" }),
  });
  const saveProgress = useMutation({
    mutationFn: async () => {
      await adminFetch(`/admin/tasks/${taskId}/progress`, { method: "POST", body: JSON.stringify({ items: items.map((item) => ({ id: item.id, completedQuantity: Number(item.completedQuantity) })), progressPercent: completionPercent }) });
      if (photos.length || files.length || progressNote.trim()) await adminFetch(`/admin/tasks/${taskId}/photos`, { method: "POST", body: JSON.stringify({ photos, files, progressNote }) });
    },
    onSuccess: async () => { setPhotos([]); setFiles([]); setProgressNote(""); await refresh(); toast({ title: "تم حفظ تقدم المهمة" }); },
    onError: (error: any) => toast({ title: "تعذر حفظ التقدم", description: error?.message, variant: "destructive" }),
  });
  const complete = useMutation({
    mutationFn: async () => {
      await adminFetch(`/admin/tasks/${taskId}/progress`, { method: "POST", body: JSON.stringify({ items: items.map((item) => ({ id: item.id, completedQuantity: Number(item.completedQuantity) })), progressPercent: 100 }) });
      return adminFetch(`/admin/tasks/${taskId}/complete`, { method: "POST", body: JSON.stringify({ photos, files, completionNotes }) });
    },
    onSuccess: async () => { setPhotos([]); setFiles([]); await refresh(); toast({ title: "تم تأكيد الإنجاز وإرسال المهمة للمراجعة" }); },
    onError: (error: any) => toast({ title: "تعذر تأكيد الإنجاز", description: error?.message, variant: "destructive" }),
  });
  const removePhoto = useMutation({
    mutationFn: (photoId: number) => adminFetch(`/admin/tasks/${taskId}/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: async () => { await refresh(); toast({ title: "تم حذف مرفق الإنجاز" }); },
    onError: (error: any) => toast({ title: "تعذر حذف المرفق", description: error?.message, variant: "destructive" }),
  });
  const task = detail.data;
  const locked = !task || ["review", "completed", "cancelled"].includes(task.status);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent dir="rtl" className="max-w-3xl gap-0 p-0">
      <DialogHeader className="border-b border-border px-5 py-4 text-right">
        <DialogTitle>{task?.title || "تفاصيل المهمة"}</DialogTitle>
        <DialogDescription>{task?.taskNo || (taskId ? `المهمة #${taskId}` : "")}</DialogDescription>
      </DialogHeader>
      {detail.isLoading ? <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-36 animate-pulse rounded-lg bg-muted" /></div> : detail.isError ? <div className="p-5"><Failure title="تعذر تحميل تفاصيل المهمة" error={detail.error} onRetry={() => void detail.refetch()} /></div> : task ? <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${priorityClass(task.priority)}`}>{task.priority === "urgent" ? "عاجلة" : task.priority === "high" ? "عالية" : task.priority === "low" ? "منخفضة" : "متوسطة"}</span><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{statusLabel(task.status)}</span>{task.status === "new" ? <Button type="button" size="sm" className="min-h-10" disabled={transition.isPending} onClick={() => transition.mutate("accept")}>استلام المهمة</Button> : null}{task.status === "accepted" ? <Button type="button" size="sm" className="min-h-10" disabled={transition.isPending} onClick={() => transition.mutate("start")}>بدء العمل</Button> : null}</div>
        <section className="space-y-3"><p className="text-sm leading-7 text-foreground">{task.description || "لا يوجد وصف إضافي."}</p><dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/35 p-3 text-sm"><div><dt className="text-xs text-muted-foreground">وقت البدء</dt><dd className="mt-1 font-bold">{textDate(task.startAt, true)}</dd></div><div><dt className="text-xs text-muted-foreground">الموعد النهائي</dt><dd className="mt-1 font-bold">{textDate(task.dueAt, true)}</dd></div><div><dt className="text-xs text-muted-foreground">القسم</dt><dd className="mt-1 font-bold">{task.department || "غير محدد"}</dd></div><div><dt className="text-xs text-muted-foreground">الموقع</dt><dd className="mt-1 font-bold">{task.location || "غير محدد"}</dd></div></dl>{task.notes ? <div className="rounded-lg border-r-4 border-primary bg-primary/5 p-3 text-sm"><strong>تعليمات المدير:</strong> {task.notes}</div> : null}</section>
        <section className="space-y-3"><h3 className="text-sm font-extrabold">صور وتوضيحات من المدير</h3><TaskPhotoGallery photos={task.managerPhotos ?? []} emptyText="لم يرفق المدير صوراً لهذه المهمة" /></section>
        {items.length ? <section className="space-y-2"><h3 className="text-sm font-extrabold">تقدم قائمة التنفيذ</h3>{items.map((item, index) => <label key={item.id} className="flex min-h-12 items-center gap-3 rounded-lg border border-border p-3"><span className="min-w-0 flex-1 text-sm font-bold">{item.title}</span><input disabled={locked} type="number" min="0" max={item.requiredQuantity} value={item.completedQuantity} onChange={(event) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, completedQuantity: Math.min(current.requiredQuantity, Math.max(0, Number(event.target.value))) } : current))} className="h-11 w-24 rounded-lg border bg-background px-2 text-center text-sm" /><span className="text-xs text-muted-foreground">/ {item.requiredQuantity}</span></label>)}</section> : null}
        <section className="space-y-3"><h3 className="text-sm font-extrabold">صور إنجاز الموظف</h3>{(task.employeePhotos ?? []).length ? <div className="space-y-3"><TaskPhotoGallery photos={task.employeePhotos ?? []} />{!locked ? <div className="flex flex-wrap gap-2">{(task.employeePhotos ?? []).filter((photo) => photo.id).map((photo, index) => <Button key={photo.id} type="button" size="sm" variant="outline" className="min-h-10 text-destructive hover:text-destructive" disabled={removePhoto.isPending} onClick={() => photo.id && removePhoto.mutate(photo.id)}>حذف صورة {index + 1}</Button>)}</div> : null}</div> : <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">لم تتم إضافة صور إنجاز بعد</p>}</section>
        <section className="space-y-3"><h3 className="text-sm font-extrabold">فيديوهات ومستندات الإنجاز</h3><TaskFileList files={task.employeeFiles ?? []} onRemove={!locked ? (file) => file.id && removePhoto.mutate(file.id) : undefined} removing={removePhoto.isPending} /></section>
        {!locked ? <>
          <TaskPhotoPicker photos={photos} onChange={setPhotos} label="صور إنجاز المهمة (اختياري)" description="يمكن التقاط عدة صور أو اختيارها من المعرض. الصور اختيارية ولا تمنع إكمال المهمة." />
          <TaskFilePicker files={files} onChange={setFiles} />
          <section className="space-y-3 rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-3"><label htmlFor="task-progress-percent" className="text-sm font-extrabold">نسبة الإنجاز</label><output htmlFor="task-progress-percent" className="text-sm font-black text-primary">{completionPercent}%</output></div><input id="task-progress-percent" type="range" min="0" max="100" step="5" value={completionPercent} onChange={(event) => setCompletionPercent(Number(event.target.value))} className="min-h-11 w-full accent-primary" /><label htmlFor="task-progress-note" className="text-sm font-extrabold">ملاحظة تقدم (اختياري)</label><textarea id="task-progress-note" value={progressNote} onChange={(event) => setProgressNote(event.target.value)} rows={2} className="w-full rounded-lg border bg-background p-3 text-sm" placeholder="ما الذي تم إنجازه حتى الآن؟" /><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={saveProgress.isPending} onClick={() => saveProgress.mutate()}>{saveProgress.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ التقدم"}</Button></section>
          <section className="space-y-3 rounded-xl border-2 border-primary/25 bg-primary/5 p-4"><div><h3 className="text-base font-extrabold">تم إنجاز المهمة</h3><p className="mt-1 text-xs text-muted-foreground">صور إنجاز المهمة وملاحظاتها اختيارية.</p></div><label className="space-y-2"><span className="text-sm font-bold">ملاحظات الإنجاز (اختياري)</span><textarea value={completionNotes} onChange={(event) => setCompletionNotes(event.target.value)} rows={3} className="w-full rounded-lg border bg-background p-3 text-sm" /></label><Button type="button" className="min-h-12 w-full gap-2" disabled={complete.isPending} onClick={() => complete.mutate()}>{complete.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4" />تأكيد الإنجاز</>}</Button></section>
        </> : null}
        {(task.submittedAt || task.completedAt || task.completionNotes) ? <div className="rounded-lg bg-primary/5 p-3 text-sm">{task.submittedAt ? <p><strong>وقت إرسال الإنجاز:</strong> {textDate(task.submittedAt, true)}</p> : null}{task.completedAt ? <p className="mt-1"><strong>وقت الاعتماد:</strong> {textDate(task.completedAt, true)}</p> : null}{task.completionNotes ? <p className="mt-2"><strong>ملاحظات الإنجاز:</strong> {task.completionNotes}</p> : null}</div> : null}
        {(task.comments?.length ?? 0) > 0 ? <section><h3 className="mb-2 text-sm font-extrabold">ملاحظات وتحديثات المهمة</h3><div className="space-y-2">{task.comments?.map((comment) => <div key={comment.id} className="rounded-lg bg-muted/40 p-3 text-sm"><b>{comment.staff?.fullName || comment.staff?.username || "الموظف"}</b><p className="mt-1 leading-6">{comment.body}</p><time className="mt-1 block text-xs text-muted-foreground">{textDate(comment.createdAt, true)}</time></div>)}</div></section> : null}
        {(task.timeline?.length ?? 0) > 0 ? <section><h3 className="mb-2 text-sm font-extrabold">سجل تنفيذ المهمة</h3><div className="space-y-2">{task.timeline?.map((entry) => <div key={entry.id} className="rounded-lg bg-muted/35 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><b>{entry.title}</b>{entry.metadata?.status ? <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{statusLabel(String(entry.metadata.status))}</span> : null}</div>{entry.body ? <p className="mt-1 leading-6">{entry.body}</p> : null}<p className="mt-1 text-xs text-muted-foreground">{entry.actorName || "النظام"} · {textDate(entry.createdAt, true)}</p></div>)}</div></section> : null}
      </div> : null}
    </DialogContent>
  </Dialog>;
}
