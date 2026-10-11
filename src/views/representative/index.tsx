import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, Route, Switch, useLocation, useParams } from "wouter";
import {
  FileText,
  GraduationCap,
  Layers3,
  LogOut,
  Printer,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  apiErrorMessage,
  apiErrorStatus,
  adminFetch,
  fetchAdminMe,
  formatCurrency,
  hasPerm,
  logoutAdmin,
  type AdminMe,
} from "@/views/admin/_lib";
import { useToast } from "@/hooks/use-toast";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import {
  printWhenImagesReadyScript,
  thermalReceiptCss,
} from "@/views/admin/print-helpers";
import { BatchDashboard, BatchesHome, useBatchesOverview } from "./batches";
import { GroupWorkspace } from "./workspace";
import { BRAND, Breadcrumbs, EmptyState, ErrorCard } from "./shared";

const api = <T,>(path: string, init?: RequestInit) =>
  adminFetch<T>(`/admin/representative${path}`, init);
type PortalScope =
  | { kind: "admin"; group: null }
  | { kind: "group"; group: { id: number; title: string; groupNo: string } };
const paymentLabels: Record<string, string> = {
  unpaid: "غير مدفوع",
  partial: "مدفوع جزئياً",
  paid: "مدفوع بالكامل",
};
const useScope = () =>
  useQuery({
    queryKey: ["representative", "scope"],
    queryFn: () => api<PortalScope>("/scope"),
    retry: false,
  });

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "ط"
  );
}
function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function PaymentBadge({ value }: { value: string }) {
  const tone =
    value === "paid"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : value === "partial"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-rose-50 text-rose-600 ring-rose-100";
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${tone}`}
    >
      {paymentLabels[value] || value}
    </span>
  );
}

function PortalGate({ children }: { children: React.ReactNode }) {
  const me = useQuery({
    queryKey: ["representative", "me"],
    queryFn: async () => {
      try {
        return (await adminFetch<{ user: AdminMe }>("/admin/auth/me")).user;
      } catch (error) {
        if (apiErrorStatus(error) === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
  const scope = useQuery({
    queryKey: ["representative", "scope"],
    queryFn: () => api<PortalScope>("/scope"),
    enabled: Boolean(me.data && hasPerm(me.data, "representative.portal.access")),
    retry: false,
  });
  if (me.isPending)
    return (
      <div className="min-h-dvh p-6" dir="rtl">
        <Skeleton className="mx-auto h-96 max-w-7xl" />
      </div>
    );
  if (me.isError) return <PortalAccessError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data) return <Redirect to="/representative/login" />;
  if (!hasPerm(me.data, "representative.portal.access"))
    return (
      <main
        className="grid min-h-dvh place-items-center bg-muted p-6"
        dir="rtl"
      >
        <Card className="max-w-md">
          <CardContent className="p-7 text-center">
            <GraduationCap className="mx-auto mb-3 h-10 w-10 text-primary" />
            <h1 className="text-xl font-bold">بوابة الممثلين</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              تواصل مع الإدارة لمنح حسابك صلاحية الدخول إلى البوابة.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  if (scope.isPending) return <div className="min-h-dvh p-6" dir="rtl"><Skeleton className="mx-auto h-96 max-w-7xl" /></div>;
  if (scope.isError) return <PortalAccessError error={scope.error} retry={() => void scope.refetch()} />;
  return <Shell user={me.data} scope={scope.data}>{children}</Shell>;
}

function PortalAccessError({ error, retry }: { error: unknown; retry: () => void }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  return <main className="grid min-h-dvh place-items-center bg-[#fff8fa] p-5" dir="rtl">
    <Card className="w-full max-w-md border-rose-100"><CardContent className="space-y-3 p-7 text-center">
      <GraduationCap className="mx-auto h-9 w-9 text-[#b85c65]" />
      <h1 className="text-lg font-bold">تعذر فتح بوابة الممثلين</h1>
      <p role="alert" className="text-sm text-slate-600">{apiErrorMessage(error)}</p>
      <p className="text-xs text-slate-500">إذا كان التعيين مفقوداً أو مكرراً، اطلب من الإدارة تصحيحه.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={retry}>إعادة المحاولة</Button>
        <Button variant="outline" disabled={loggingOut} onClick={async () => {
          setLoggingOut(true);
          try {
            await logoutAdmin();
            queryClient.removeQueries({ queryKey: ["representative"] });
            navigate("/representative/login");
          } catch (cause) {
            toast({ title: "تعذر تسجيل الخروج", description: apiErrorMessage(cause), variant: "destructive" });
            setLoggingOut(false);
          }
        }}>تسجيل الخروج / تبديل الحساب</Button>
      </div>
    </CardContent></Card>
  </main>;
}

function Shell({
  user,
  scope,
  children,
}: {
  user: AdminMe;
  scope: PortalScope;
  children: React.ReactNode;
}) {
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const home = scope.kind === "group" ? `/representative/groups/${scope.group.id}` : "/representative";
  const nav = [
    { href: home, label: scope.kind === "group" ? "مجموعتي" : "وجبات التخرج", icon: Layers3, active: location === "/representative" || location.startsWith("/representative/batches") || location.startsWith("/representative/groups") },
    { href: scope.kind === "group" ? `${home}?tab=students` : "/representative", label: "الطلاب", icon: Users, active: false, mobileOnly: true },
    { href: "/representative/payments", label: "المدفوعات والعهدة", short: "المدفوعات", icon: WalletCards, active: location.startsWith("/representative/payments") },
    { href: "/representative/reports", label: "التقارير", icon: FileText, active: location.startsWith("/representative/reports") },
    ...(scope.kind === "admin" ? [{ href: "/representative/assignments", label: "تعيين الممثلين", icon: UserRoundCheck, active: location.startsWith("/representative/assignments") }] : []),
  ];
  return (
    <div
      className="representative-v2 min-h-dvh bg-[#fffafb] text-slate-800 dark:bg-slate-950 dark:text-slate-100"
      dir="rtl"
    >
      <header className="sticky top-0 z-20 border-b border-rose-100/80 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex h-[68px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={home} className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#7b1e3a] text-white shadow-sm">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-bold">بوابة ممثلي التخرج</h1>
              <p className="max-w-[180px] truncate text-xs text-muted-foreground sm:max-w-none">
                {scope.kind === "admin" ? "كل وجبات ومجموعات التخرج" : scope.group.title}
              </p>
            </div>
          </Link>
          <nav aria-label="أقسام البوابة" className="hidden items-center gap-1 md:flex">
            {nav.filter((item) => !item.mobileOnly).map((item) => (
              <Link key={item.href + item.label} href={item.href} aria-current={item.active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${item.active ? "bg-[#fbeff2] font-semibold text-[#7b1e3a]" : "text-slate-600 hover:bg-rose-50/60"}`}>
                <item.icon className="h-4 w-4" />{item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden text-left text-xs sm:block">
              <b>{user.fullName || user.username}</b>
              <p className="text-muted-foreground">{scope.kind === "admin" ? "مدير النظام" : "ممثل المجموعة"}</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#fbeff2] text-xs font-bold text-[#7b1e3a]">
              {initials(user.fullName || user.username)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="تسجيل الخروج"
              onClick={async () => {
                await logoutAdmin();
                queryClient.removeQueries({ queryKey: ["representative"] });
                navigate("/representative/login");
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-5 pb-24 sm:px-6">
        {children}
      </main>
      <nav aria-label="التنقل السريع" className="fixed inset-x-0 bottom-0 z-30 border-t border-rose-100 bg-white px-3 py-2 shadow-[0_-6px_20px_rgba(123,30,58,.08)] md:hidden dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto grid w-full max-w-md grid-cols-4">
          {nav.slice(0, 4).map((item) => (
            <Link key={item.href + item.label} href={item.href}
              className={`grid place-items-center gap-1 py-1 text-[11px] ${item.active ? "font-semibold text-[#7b1e3a]" : ""}`}>
              <item.icon className="h-4 w-4" />
              {"short" in item && item.short ? item.short : item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** Administrators start at the batches page; a representative goes straight to their group. */
function Home() {
  const scope = useScope();
  if (scope.isPending) return <Skeleton className="h-[620px] rounded-2xl" />;
  if (scope.isError) return <ErrorCard error={scope.error} retry={() => void scope.refetch()} />;
  if (scope.data.kind === "group") return <Redirect to={`/representative/groups/${scope.data.group.id}`} />;
  return <BatchesHome />;
}

function StudentsRedirect() {
  const scope = useScope();
  if (scope.isPending) return <Skeleton className="h-72 rounded-2xl" />;
  if (scope.data?.kind === "group") return <Redirect to={`/representative/groups/${scope.data.group.id}?tab=students`} />;
  return <Redirect to="/representative" />;
}

function BatchRoute() {
  const params = useParams<{ key: string }>();
  return <BatchDashboard batchKey={decodeURIComponent(params.key || "")} />;
}

function GroupRoute() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return <EmptyState text="رقم المجموعة غير صحيح." />;
  return <GroupWorkspace key={id} groupId={id} />;
}

function Payments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["representative", "me"],
    queryFn: () => fetchAdminMe({ force: true }),
  });
  const { data: settings } = usePublicSettings();
  const [amount, setAmount] = useState("");
  const [printingId, setPrintingId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ["representative", "payments"],
    queryFn: () => api<any>("/payments"),
  });
  const handover = useMutation({
    mutationFn: () =>
      api("/custody", { method: "POST", body: JSON.stringify({ amount }) }),
    onSuccess: () => {
      toast({ title: "تم إرسال طلب تسليم العهدة للإدارة" });
      setAmount("");
      qc.invalidateQueries({ queryKey: ["representative"] });
    },
    onError: (error) =>
      toast({
        title: "تعذر إرسال الطلب",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const canPrint = Boolean(
    me.data && hasPerm(me.data, "representative.receipts.print"),
  );
  async function printReceipt(item: any) {
    setPrintingId(Number(item.id));
    try {
      const { receipt } = await api<any>(`/payments/${item.id}/receipt`);
      const snapshot = receipt.snapshot || {};
      const popup = window.open("", "_blank", "width=520,height=760");
      if (!popup) throw new Error("تعذر فتح نافذة الطباعة");
      const markup = `<main class="receipt"><header class="r-head"><img class="r-logo" src="${escapeHtml(logoSrc(settings))}" alt="AJN"><div class="r-company">مجموعة علي جان نهاد</div><div class="r-sub">وصل دفعة تجهيزات تخرج</div><div class="r-sub num">${escapeHtml(receipt.receiptNo)}</div></header><hr class="rule">
        <div class="kv"><span>الطالب</span><span class="v">${escapeHtml(snapshot.studentName || receipt.studentName)}</span></div>
        <div class="kv"><span>كود الطالب</span><span class="v num">${escapeHtml(snapshot.studentCode || receipt.studentCode)}</span></div>
        <div class="kv"><span>المجموعة</span><span class="v">${escapeHtml(receipt.groupTitle || "—")}</span></div>
        <section class="totals"><div class="grand"><span>مبلغ الدفعة</span><span class="num">${escapeHtml(formatCurrency(Number(snapshot.paymentAmount ?? receipt.amount)))}</span></div><div class="payline"><span>طريقة الدفع</span><span>${escapeHtml(snapshot.paymentMethod || receipt.payment_method)}</span></div></section>
        <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div></main>`;
      popup.document.write(
        `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(receipt.receiptNo)}</title><style>${thermalReceiptCss("80mm")}</style></head><body>${markup}${printWhenImagesReadyScript()}</body></html>`,
      );
      popup.document.close();
    } catch (error) {
      toast({
        title: "تعذرت طباعة الوصل",
        description: apiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setPrintingId(null);
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">سجل المدفوعات</h2>
        <p className="text-sm text-muted-foreground">
          كل دفعة محفوظة كسجل مستقل.
        </p>
      </div>
      <Card className="border-rose-100 dark:border-slate-800">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-56 flex-1">
            <Label>تسليم مبلغ للإدارة</Label>
            <Input
              className="mt-1.5"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="المبلغ المسلّم"
            />
          </div>
          <Button
            className="bg-[#e91e63] hover:bg-[#d81b60]"
            onClick={() => handover.mutate()}
            disabled={!Number(amount) || handover.isPending}
          >
            إرسال طلب التسليم
          </Button>
        </CardContent>
      </Card>
      <Card className="border-rose-100 dark:border-slate-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطالب</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الطريقة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead className="text-left">الإجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ) : (
                  list.data?.items?.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <b>{item.studentName}</b>
                        <small className="block text-muted-foreground">
                          {item.studentCode}
                        </small>
                      </TableCell>
                      <TableCell>
                        {formatCurrency(Number(item.amount))}
                      </TableCell>
                      <TableCell>{item.payment_method}</TableCell>
                      <TableCell>
                        <PaymentBadge
                          value={
                            item.status === "approved"
                              ? "paid"
                              : item.status === "pending"
                                ? "partial"
                                : "unpaid"
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {new Date(item.created_at).toLocaleDateString("ar-IQ-u-nu-latn")}
                      </TableCell>
                      <TableCell className="text-left">
                        {canPrint &&
                        item.status === "approved" &&
                        item.receiptNo ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => printReceipt(item)}
                            disabled={printingId === Number(item.id)}
                          >
                            <Printer className="ml-1 h-3.5 w-3.5" />
                            {printingId === Number(item.id)
                              ? "جارٍ التحميل…"
                              : "طباعة الوصل"}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Reports are always produced per batch or per group, never as one mixed list. */
function Reports() {
  const scope = useScope();
  const overview = useBatchesOverview();
  if (scope.isPending || overview.isPending) return <Skeleton className="h-72 rounded-2xl" />;
  if (scope.data?.kind === "group") return <Redirect to={`/representative/groups/${scope.data.group.id}?tab=reports`} />;
  if (overview.isError) return <ErrorCard error={overview.error} retry={() => void overview.refetch()} />;
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "وجبات التخرج", href: "/representative" }, { label: "التقارير" }]} />
      <div>
        <h2 className="text-xl font-bold">التقارير</h2>
        <p className="text-sm text-muted-foreground">اختر الوجبة لتقرير المجموعات، أو افتح مجموعة لتقارير طلابها ودفعاتها وتجهيزها وتسليمها.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {overview.data.batches.map((batch) => (
          <Card key={batch.key} className={BRAND.card}>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div>
                <FileText className={`mb-2 h-6 w-6 ${BRAND.text}`} />
                <h3 className="font-bold">{batch.label}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{batch.groups} مجموعات · {batch.stats.students} طالب · المتبقي {formatCurrency(batch.stats.remaining)}</p>
              </div>
              <Button asChild className={`${BRAND.button} mt-auto`}>
                <Link href={`/representative/batches/${encodeURIComponent(batch.key)}`}><Printer className="ml-1 h-4 w-4" />تقرير الوجبة ومجموعاتها</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {!overview.data.batches.length ? <EmptyState text="لا توجد وجبات بعد." /> : null}
    </div>
  );
}

function Assignments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["representative", "assignments"],
    queryFn: () => api<any>("/assignments"),
  });
  const [staffId, setStaffId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [resolveAmbiguous, setResolveAmbiguous] = useState(false);
  const activeAssignments = (q.data?.items ?? []).filter((item: any) =>
    item.isActive && String(item.staffId) === staffId);
  const needsCorrection = activeAssignments.length > 1;
  const save = useMutation({
    mutationFn: () =>
      api("/assignments", {
        method: "POST",
        body: JSON.stringify({ staffId, groupId, resolveAmbiguous }),
      }),
    onSuccess: () => {
      toast({ title: "تم تعيين ممثل المجموعة" });
      setStaffId("");
      setGroupId("");
      setResolveAmbiguous(false);
      qc.invalidateQueries({ queryKey: ["representative", "assignments"] });
    },
    onError: (error) =>
      toast({
        title: "تعذر الحفظ",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <PortalAccessError error={q.error} retry={() => void q.refetch()} />;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">تعيين ممثلي المجموعات</h2>
        <p className="text-sm text-muted-foreground">
          اربط حساب موظف واحداً بمجموعة فعّالة واحدة. تُنشأ بيانات الدخول من إدارة الموظفين.
        </p>
      </div>
      <Card className="border-rose-100 dark:border-slate-800">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <Select value={staffId} onValueChange={(value) => { setStaffId(value); setResolveAmbiguous(false); }}>
            <SelectTrigger>
              <SelectValue placeholder="اختر ممثلاً" />
            </SelectTrigger>
            <SelectContent>
              {q.data?.staff?.map((staff: any) => (
                <SelectItem key={staff.id} value={String(staff.id)}>
                  {staff.fullName || staff.username} ({staff.username})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger>
              <SelectValue placeholder="اختر المجموعة" />
            </SelectTrigger>
            <SelectContent>
              {q.data?.groups?.map((group: any) => (
                <SelectItem key={group.id} value={String(group.id)}>
                  {group.groupNo} — {group.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="bg-[#e91e63] hover:bg-[#d81b60]"
            onClick={() => save.mutate()}
            disabled={!staffId || !groupId || save.isPending || (needsCorrection && !resolveAmbiguous)}
          >
            <UserRoundCheck className="ml-2 h-4 w-4" />
            تعيين
          </Button>
          {staffId && <p className="text-xs text-muted-foreground sm:col-span-3">
            {activeAssignments.length === 0 ? "لا توجد مجموعة نشطة لهذا الحساب." :
              `المجموعة الحالية: ${activeAssignments.map((item: any) => `${item.groupNo} — ${item.groupTitle}`).join("، ")}`}
          </p>}
          {needsCorrection && <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-3">
            <input type="checkbox" checked={resolveAmbiguous} onChange={(event) => setResolveAmbiguous(event.target.checked)}
              className="mt-0.5" />
            أؤكد تصحيح التعيين المكرر إلى المجموعة المختارة. إذا سُجّلت دفعات أو عهدة، سيرفض النظام التغيير حفاظاً على السجل المالي.
          </label>}
        </CardContent>
      </Card>
      <Card className="border-rose-100 dark:border-slate-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الممثل</TableHead>
                <TableHead>المجموعة</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.items?.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.representativeName || item.representativeUsername}
                  </TableCell>
                  <TableCell>
                    {item.groupNo} — {item.groupTitle}
                  </TableCell>
                  <TableCell>{item.isActive ? "مفعّل" : "موقوف"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RepresentativePortal() {
  return (
    <PortalGate>
      <Switch>
        <Route path="/representative/batches/:key" component={BatchRoute} />
        <Route path="/representative/groups/:id" component={GroupRoute} />
        <Route path="/representative/students" component={StudentsRedirect} />
        <Route path="/representative/payments" component={Payments} />
        <Route path="/representative/reports" component={Reports} />
        <Route path="/representative/assignments" component={Assignments} />
        <Route component={Home} />
      </Switch>
    </PortalGate>
  );
}
