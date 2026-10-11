import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCopy, ExternalLink, Eye, FileText, Pencil, Plus, Printer, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { GraduationGroupPricingEditor } from "@/components/graduation-group-pricing-editor";
import { apiErrorMessage, formatCurrency } from "@/views/admin/_lib";
import { useToast } from "@/hooks/use-toast";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { GRADUATION_STAGE_LABELS } from "@/lib/graduation";
import { SASH_FONTS, SASH_TYPES } from "@/lib/graduation-student-flow";
import {
  DELIVERY_PHASE_LABELS,
  PAYMENT_PHASE_LABELS,
  PRODUCTION_PHASE_LABELS,
  deliveryPhase,
  paymentPhase,
  productionPhase,
  studentEquipment,
  type DeliveryPhase,
  type PaymentPhase,
  type ProductionPhase,
} from "@/lib/graduation-batches";
import type { GroupWorkspace as Workspace } from "@/server/representative-workspace";
import {
  BRAND, Breadcrumbs, DeliveryBadge, EmptyState, ErrorCard, Metric, PAYMENT_METHOD_LABELS, PaymentBadge, PaymentDialog,
  Progress, ProductionBadge, REQUEST_STATUS_LABELS, StepBadge, downloadCsv, escapeHtml, initials, openThermalPrint,
  optionName, receiptHeaderHtml, repApi, useGraduationConfig, type PaymentTarget,
} from "./shared";

type Student = Workspace["students"][number];
type Posted = Workspace["payments"]["posted"][number];
type Request = Workspace["payments"]["requests"][number];
type Enriched = Student & { pay: PaymentPhase; production: ProductionPhase; deliveryState: DeliveryPhase; equipment: ReturnType<typeof studentEquipment> };

const TABS = [
  ["overview", "نظرة عامة"], ["students", "الطلاب"], ["payments", "الدفعات"], ["orders", "الطلبات"],
  ["measurements", "القياسات"], ["printing", "الطباعة والتطريز"], ["delivery", "التسليم"], ["reports", "التقارير"],
] as const;
type TabKey = (typeof TABS)[number][0];

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة", submitted: "مُرسل", confirmed: "مؤكد", in_production: "قيد التنفيذ", ready: "جاهز", delivered: "مُسلّم", completed: "مكتمل", cancelled: "ملغي",
};
const MEASURE_COLUMNS: Array<[string, string]> = [
  ["height", "الطول"], ["shoulder", "الكتف"], ["chest", "الصدر"], ["waist", "الخصر"], ["sleeveLength", "الكم"],
  ["robeLength", "طول الروب"], ["sashLength", "طول الوشاح"], ["capSize", "القبعة"],
];
const EQUIPMENT_LABELS: Array<[keyof Enriched["equipment"], string]> = [
  ["measurements", "القياسات"], ["gown", "الروب"], ["sash", "الوشاح"], ["cap", "القبعة"],
  ["printing", "الطباعة"], ["embroidery", "التطريز"], ["delivery", "التسليم"],
];
const record = (value: unknown): Record<string, any> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {});
const dateText = (value: unknown) => (value ? new Date(String(value)).toLocaleDateString("ar-IQ-u-nu-latn") : "—");
const stageLabel = (stage: unknown) => GRADUATION_STAGE_LABELS[String(stage) as keyof typeof GRADUATION_STAGE_LABELS] || String(stage || "—");

function initialTab(): TabKey {
  const value = new URLSearchParams(window.location.search).get("tab");
  return (TABS.some(([key]) => key === value) ? value : "overview") as TabKey;
}

export function GroupWorkspace({ groupId }: { groupId: number }) {
  const workspace = useQuery({ queryKey: ["representative", "group", groupId], queryFn: () => repApi<Workspace>(`/groups/${groupId}/workspace`) });
  const config = useGraduationConfig();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [paying, setPaying] = useState<PaymentTarget | null>(null);
  const [viewing, setViewing] = useState<Enriched | null>(null);
  const [editing, setEditing] = useState<Enriched | null>(null);
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();
  const logo = logoSrc(settings);
  const students = useMemo<Enriched[]>(() => (workspace.data?.students ?? []).map((student) => ({
    ...student,
    pay: paymentPhase(student),
    production: productionPhase(student),
    deliveryState: deliveryPhase(student),
    equipment: studentEquipment(student),
  })), [workspace.data]);
  // Keep the active tab visible when it is opened from a link on a narrow screen.
  useEffect(() => {
    document.querySelector("[role=tablist] [data-state=active]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab, workspace.isSuccess]);
  const changeTab = (value: string) => {
    setTab(value as TabKey);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  };
  if (workspace.isPending) return <Skeleton className="h-[640px] rounded-2xl" />;
  if (workspace.isError) return <ErrorCard error={workspace.error} retry={() => void workspace.refetch()} />;
  const { group, stats, payments, permissions } = workspace.data;
  const posted = payments.posted;
  const requests = payments.requests;
  const printStudentStatement = (student: Enriched) => {
    try {
      const rows = posted.filter((payment) => payment.orderId === student.id);
      const lines = rows.map((payment) => `<div class="payline"><span>${escapeHtml(dateText(payment.createdAt))} · ${escapeHtml(payment.receiptNo || "—")}</span><span class="num">${escapeHtml(formatCurrency(payment.amount))}</span></div>`).join("");
      openThermalPrint(`كشف ${student.name}`, `<main class="receipt">${receiptHeaderHtml(logo, "كشف حساب طالب — تجهيزات تخرج", student.studentCode)}
        <div class="kv"><span>الطالب</span><span class="v">${escapeHtml(student.name)}</span></div>
        <div class="kv"><span>المجموعة</span><span class="v">${escapeHtml(group.title)}</span></div>
        <div class="kv"><span>الوجبة</span><span class="v">${escapeHtml(group.batchLabel)}</span></div>
        <hr class="rule"><div class="kv"><span>إجمالي العقد</span><span class="v num">${escapeHtml(formatCurrency(student.total))}</span></div>
        ${lines || `<div class="center">لا توجد دفعات معتمدة بعد</div>`}
        <div class="grand"><span>المتبقي</span><span class="num">${escapeHtml(formatCurrency(student.remaining))}</span></div>
        <div class="kv"><span>المدفوع</span><span class="v num">${escapeHtml(formatCurrency(student.paid))}</span></div>
        <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div></main>`);
    } catch (error) {
      toast({ title: "تعذرت الطباعة", description: apiErrorMessage(error), variant: "destructive" });
    }
  };
  const printPostedReceipt = (payment: Posted) => {
    try {
      const snapshot = record(payment.snapshot);
      openThermalPrint(payment.receiptNo || "وصل", `<main class="receipt">${receiptHeaderHtml(logo, "وصل دفعة تجهيزات تخرج", payment.receiptNo)}
        <div class="kv"><span>الطالب</span><span class="v">${escapeHtml(snapshot.studentName || payment.studentName)}</span></div>
        <div class="kv"><span>كود الطالب</span><span class="v num">${escapeHtml(snapshot.studentCode || payment.studentCode || "—")}</span></div>
        <div class="kv"><span>المجموعة</span><span class="v">${escapeHtml(group.title)}</span></div>
        <div class="kv"><span>التاريخ</span><span class="v num">${escapeHtml(dateText(payment.createdAt))}</span></div>
        <section class="totals"><div class="grand"><span>مبلغ الدفعة</span><span class="num">${escapeHtml(formatCurrency(Number(snapshot.paymentAmount ?? payment.amount)))}</span></div>
        <div class="payline"><span>طريقة الدفع</span><span>${escapeHtml(PAYMENT_METHOD_LABELS[payment.paymentMethod] || payment.paymentMethod)}</span></div></section>
        <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div></main>`);
    } catch (error) {
      toast({ title: "تعذرت طباعة الوصل", description: apiErrorMessage(error), variant: "destructive" });
    }
  };
  const target = (student: Enriched): PaymentTarget => ({ id: student.id, name: student.name, studentCode: student.studentCode, total: student.total, paid: student.paid, remaining: student.remaining });
  const studentActions = {
    view: setViewing,
    pay: permissions.recordPayment ? (student: Enriched) => setPaying(target(student)) : undefined,
    edit: permissions.manageStudents ? setEditing : undefined,
    print: permissions.printReceipts ? printStudentStatement : undefined,
  };
  const academic = [group.university, group.college, group.department].filter(Boolean).join(" › ");
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[
        ...(permissions.admin ? [{ label: "وجبات التخرج", href: "/representative" }] : []),
        { label: group.batchLabel, href: `/representative/batches/${encodeURIComponent(group.batchKey)}` },
        { label: group.title },
      ]} />
      <section className={`${BRAND.card} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{group.groupNo}</p>
            <h2 className="text-xl font-bold">{group.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{academic || "بدون بيانات أكاديمية"} · {group.batchLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">الممثل: {group.representativeName || "—"}{group.deliveryDate ? ` · موعد التسليم ${dateText(group.deliveryDate)}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className={BRAND.button} onClick={() => setAdding(true)}><UserPlus className="ml-1 h-4 w-4" />إضافة طالب</Button>
            {permissions.admin ? <Button asChild variant="outline" className="border-rose-200"><a href="/admin/graduation/orders" title="مركز طلبات التخرج"><ExternalLink className="ml-1 h-4 w-4" />مركز الطلبات</a></Button> : null}
          </div>
        </div>
      </section>
      <Tabs value={tab} onValueChange={changeTab} dir="rtl">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="h-auto w-max gap-1 rounded-xl border border-rose-100 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {TABS.map(([key, label]) => <TabsTrigger key={key} value={key} className="rounded-lg px-3 py-1.5 text-sm data-[state=active]:bg-[#7b1e3a] data-[state=active]:text-white">{label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4"><OverviewTab workspace={workspace.data} students={students} /></TabsContent>
        <TabsContent value="students" className="mt-4"><StudentsTab students={students} actions={studentActions} onAdd={() => setAdding(true)} /></TabsContent>
        <TabsContent value="payments" className="mt-4"><PaymentsTab stats={stats} posted={posted} requests={requests} admin={permissions.admin} canPrint={permissions.printReceipts} onPrint={printPostedReceipt} groupNo={group.groupNo} /></TabsContent>
        <TabsContent value="orders" className="mt-4"><OrdersTab students={students} config={config.data} /></TabsContent>
        <TabsContent value="measurements" className="mt-4"><MeasurementsTab students={students} /></TabsContent>
        <TabsContent value="printing" className="mt-4"><PrintingTab students={students} /></TabsContent>
        <TabsContent value="delivery" className="mt-4"><DeliveryTab students={students} deliveryDate={group.deliveryDate} /></TabsContent>
        <TabsContent value="reports" className="mt-4"><ReportsTab workspace={workspace.data} students={students} canExport={permissions.exportReports} logo={logo} /></TabsContent>
      </Tabs>
      <PaymentDialog student={paying} onClose={() => setPaying(null)} />
      <StudentDetails student={viewing} posted={posted} requests={requests} config={config.data} onClose={() => setViewing(null)} />
      <EditStudentDialog groupId={group.id} student={editing} onClose={() => setEditing(null)} />
      <AddStudentDialog open={adding} joinUrl={group.joinUrl} status={group.status} onClose={() => setAdding(false)} />
    </div>
  );
}

// ------------------------------------------------------------------ overview
function CountRow({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="flex justify-between text-sm"><span className="text-muted-foreground">{label}</span><b className={`tabular-nums ${tone ?? ""}`}>{value}</b></div>;
}

function OverviewTab({ workspace, students }: { workspace: Workspace; students: Enriched[] }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const { group, stats, payments } = workspace;
  const pending = payments.requests.filter((request) => request.status === "pending");
  const active = students.filter((student) => student.production !== "cancelled");
  const measured = (value: string) => active.filter((student) => student.measurementStatus === value).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="الطلاب" value={stats.students} hint={group.expectedStudentCount ? `المتوقع ${group.expectedStudentCount}` : stats.cancelled ? `${stats.cancelled} طلب ملغي غير محسوب` : undefined} />
        <Metric label="قيمة العقود" value={formatCurrency(stats.total)} />
        <Metric label="المدفوع" value={formatCurrency(stats.paid)} tone="green" hint={group.groupCredit ? `رصيد مجموعة غير مخصص ${formatCurrency(group.groupCredit)}` : undefined} />
        <Metric label="المتبقي" value={formatCurrency(stats.remaining)} tone="brand" />
      </div>
      <Card className={BRAND.card}><CardContent className="grid gap-4 p-4 sm:grid-cols-3">
        <Progress label="نسبة التحصيل" value={stats.collectionProgress} />
        <Progress label="تقدم التجهيز" value={stats.productionProgress} tone="sky" />
        <Progress label="تقدم التسليم" value={stats.deliveryProgress} tone="green" />
      </CardContent></Card>
      <div className="grid gap-3 lg:grid-cols-4">
        <Card className={BRAND.card}><CardContent className="space-y-2 p-4"><h3 className="font-semibold">حالة الدفع</h3><CountRow label="مدفوع بالكامل" value={stats.paidFull} tone="text-emerald-600" /><CountRow label="مدفوع جزئياً" value={stats.partial} tone="text-amber-600" /><CountRow label="غير مدفوع" value={stats.unpaid} tone="text-[#7b1e3a]" /></CardContent></Card>
        <Card className={BRAND.card}><CardContent className="space-y-2 p-4"><h3 className="font-semibold">التجهيز</h3>{(["not_started", "in_production", "ready", "delivered"] as const).map((phase) => <CountRow key={phase} label={PRODUCTION_PHASE_LABELS[phase]} value={active.filter((student) => student.production === phase).length} />)}</CardContent></Card>
        <Card className={BRAND.card}><CardContent className="space-y-2 p-4"><h3 className="font-semibold">القياسات</h3><CountRow label="مكتملة" value={measured("complete")} tone="text-emerald-600" /><CountRow label="ناقصة" value={measured("partial")} tone="text-amber-600" /><CountRow label="لم تُدخل" value={measured("none")} /></CardContent></Card>
        <Card className={BRAND.card}><CardContent className="space-y-2 p-4"><h3 className="font-semibold">دفعات بانتظار الاعتماد</h3><CountRow label="عدد الطلبات" value={pending.length} tone="text-amber-600" /><div className="flex justify-between text-sm"><span className="text-muted-foreground">المبلغ</span><b className="tabular-nums">{formatCurrency(pending.reduce((sum, request) => sum + Number(request.amount || 0), 0))}</b></div><p className="text-[11px] text-muted-foreground">لا تُحتسب في المدفوع قبل اعتماد الإدارة.</p></CardContent></Card>
      </div>
      <details className={`${BRAND.card} p-4`}>
        <summary className="cursor-pointer text-sm font-semibold">أسعار الوشاح لهذه المجموعة</summary>
        <div className="mt-4"><GraduationGroupPricingEditor
          key={`${group.id}-${JSON.stringify(group.defaultConfiguration)}`}
          configuration={group.defaultConfiguration || {}}
          endpoint={`/admin/representative/groups/${group.id}/sash-pricing`}
          onSaved={() => {
            void client.invalidateQueries({ queryKey: ["representative"] });
            void client.invalidateQueries({ queryKey: ["admin", "graduation"] });
            void client.invalidateQueries({ queryKey: ["graduation", "group"] });
            toast({ title: "تم حفظ أسعار المجموعة للطلبات الجديدة" });
          }}
        /></div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ students
type StudentActions = { view: (s: Enriched) => void; pay?: (s: Enriched) => void; edit?: (s: Enriched) => void; print?: (s: Enriched) => void };

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: Array<[string, string]> }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="w-full sm:w-44" aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{label}: الكل</SelectItem>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select>;
}

function StudentsTab({ students, actions, onAdd }: { students: Enriched[]; actions: StudentActions; onAdd: () => void }) {
  const [search, setSearch] = useState("");
  const [pay, setPay] = useState("all");
  const [production, setProduction] = useState("all");
  const [delivery, setDelivery] = useState("all");
  const needle = search.trim().toLowerCase();
  const shown = students.filter((student) =>
    (!needle || [student.name, student.phone, student.studentCode, student.orderNo, student.barcode].some((value) => String(value ?? "").toLowerCase().includes(needle))) &&
    (pay === "all" || student.pay === pay) && (production === "all" || student.production === production) && (delivery === "all" || student.deliveryState === delivery));
  return (
    <div className="space-y-3">
      <Card className={BRAND.card}><CardContent className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1"><Search className="absolute right-3 top-2.5 h-4 w-4 text-[#7b1e3a]" /><Input className="border-rose-100 pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم، الهاتف أو الكود" /></div>
        <div className="grid gap-2 sm:grid-cols-3 lg:flex">
          <FilterSelect value={pay} onChange={setPay} label="الدفع" options={Object.entries(PAYMENT_PHASE_LABELS)} />
          <FilterSelect value={production} onChange={setProduction} label="التجهيز" options={Object.entries(PRODUCTION_PHASE_LABELS)} />
          <FilterSelect value={delivery} onChange={setDelivery} label="التسليم" options={Object.entries(DELIVERY_PHASE_LABELS)} />
        </div>
        <Button className={BRAND.button} onClick={onAdd}><Plus className="ml-1 h-4 w-4" />إضافة طالب</Button>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">{shown.length} من {students.length} طالب</p>
      {shown.length ? <>
        <div className={`${BRAND.card} hidden overflow-hidden md:block`}><Table>
          <TableHeader><TableRow className="bg-[#fbeff2]/60 hover:bg-[#fbeff2]/60">{["الطالب", "الهاتف", "الإجمالي", "المدفوع", "المتبقي", "الدفع", "التجهيز", "التسليم", ""].map((head, index) => <TableHead key={index}>{head}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{shown.map((student) => (
            <TableRow key={student.id} className={student.production === "cancelled" ? "opacity-60" : "hover:bg-rose-50/30"}>
              <TableCell><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full bg-[#fbeff2] text-xs font-bold text-[#7b1e3a]">{initials(student.name)}</span><span><b className="block whitespace-nowrap">{student.name}</b><small className="font-mono text-muted-foreground">{student.studentCode}</small></span></div></TableCell>
              <TableCell dir="ltr" className="text-right text-xs">{student.phone}</TableCell>
              <TableCell className="tabular-nums">{formatCurrency(student.total)}</TableCell>
              <TableCell className="tabular-nums text-emerald-700">{formatCurrency(student.paid)}</TableCell>
              <TableCell className={`tabular-nums ${student.remaining ? "font-semibold text-[#7b1e3a]" : ""}`}>{formatCurrency(student.remaining)}</TableCell>
              <TableCell><PaymentBadge value={student.pay} /></TableCell>
              <TableCell><ProductionBadge value={student.production} /></TableCell>
              <TableCell><DeliveryBadge value={student.deliveryState} /></TableCell>
              <TableCell><RowActions student={student} actions={actions} /></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div>
        <div className="grid gap-2 md:hidden">{shown.map((student) => (
          <Card key={student.id} className={`${BRAND.card}`}><CardContent className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2"><div className="min-w-0"><b className="block truncate">{student.name}</b><small className="font-mono text-muted-foreground">{student.studentCode}</small></div><PaymentBadge value={student.pay} /></div>
            <div className="grid grid-cols-3 gap-1 text-center text-[11px]"><span>الإجمالي<b className="block tabular-nums">{formatCurrency(student.total)}</b></span><span>المدفوع<b className="block tabular-nums text-emerald-700">{formatCurrency(student.paid)}</b></span><span>المتبقي<b className="block tabular-nums text-[#7b1e3a]">{formatCurrency(student.remaining)}</b></span></div>
            <div className="flex flex-wrap gap-1"><ProductionBadge value={student.production} /><DeliveryBadge value={student.deliveryState} /></div>
            <RowActions student={student} actions={actions} />
          </CardContent></Card>
        ))}</div>
      </> : <EmptyState text={students.length ? "لا يوجد طالب يطابق البحث أو الفلاتر." : "لا يوجد طلاب في هذه المجموعة بعد."} />}
    </div>
  );
}

function RowActions({ student, actions }: { student: Enriched; actions: StudentActions }) {
  const cancelled = student.production === "cancelled";
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="icon" variant="outline" className="h-8 w-8 border-rose-200 text-[#7b1e3a]" onClick={() => actions.view(student)} aria-label={`عرض ${student.name}`}><Eye className="h-3.5 w-3.5" /></Button>
      {actions.edit && !cancelled ? <Button size="icon" variant="outline" className="h-8 w-8 border-rose-200" onClick={() => actions.edit?.(student)} aria-label={`تعديل ${student.name}`}><Pencil className="h-3.5 w-3.5" /></Button> : null}
      {actions.print ? <Button size="icon" variant="outline" className="h-8 w-8 border-rose-200" onClick={() => actions.print?.(student)} aria-label={`طباعة وصل ${student.name}`}><Printer className="h-3.5 w-3.5" /></Button> : null}
      {actions.pay && !cancelled && student.remaining > 0 ? <Button size="sm" className={`h-8 px-2.5 text-xs ${BRAND.button}`} onClick={() => actions.pay?.(student)}><Plus className="ml-1 h-3.5 w-3.5" />دفعة</Button> : null}
    </div>
  );
}

function StudentDetails({ student, posted, requests, config, onClose }: { student: Enriched | null; posted: Posted[]; requests: Request[]; config: ReturnType<typeof useGraduationConfig>["data"]; onClose: () => void }) {
  const text = record(student?.customText);
  const payments = student ? posted.filter((payment) => payment.orderId === student.id) : [];
  const pending = student ? requests.filter((request) => Number(request.graduation_order_id) === student.id && request.status === "pending") : [];
  return (
    <Dialog open={Boolean(student)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>تفاصيل الطالب</DialogTitle></DialogHeader>
        {student ? <div className="space-y-4 text-sm">
          <div className="flex items-center gap-3 rounded-xl bg-[#fbeff2]/60 p-3"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#7b1e3a] text-sm font-bold text-white">{initials(student.name)}</span><div><b>{student.name}</b><p className="text-xs text-muted-foreground">{student.studentCode} · <span dir="ltr">{student.phone}</span></p></div></div>
          <div className="grid grid-cols-3 gap-2 text-center"><span className="rounded-lg border p-2">الإجمالي<b className="block tabular-nums">{formatCurrency(student.total)}</b></span><span className="rounded-lg border p-2">المدفوع<b className="block tabular-nums text-emerald-700">{formatCurrency(student.paid)}</b></span><span className="rounded-lg border p-2">المتبقي<b className="block tabular-nums text-[#7b1e3a]">{formatCurrency(student.remaining)}</b></span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <p><span className="text-muted-foreground">الباقة: </span>{optionName(config?.packages, student.packageKey)}</p>
            <p><span className="text-muted-foreground">نوع الروب: </span>{optionName(config?.styles, student.styleKey)}</p>
            <p><span className="text-muted-foreground">مرحلة التجهيز: </span>{stageLabel(student.productionStage)}</p>
            <p><span className="text-muted-foreground">الاسم على الوشاح: </span>{text.text || "—"}</p>
          </div>
          <div><h4 className="mb-2 font-semibold">تجهيزات الطالب</h4><div className="grid gap-2 sm:grid-cols-2">{EQUIPMENT_LABELS.map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg border border-rose-100 px-3 py-2"><span>{label}</span><StepBadge value={student.equipment[key]} /></div>)}</div></div>
          <div><h4 className="mb-2 font-semibold">الدفعات المعتمدة</h4>{payments.length ? <ul className="divide-y rounded-lg border">{payments.map((payment) => <li key={payment.id} className="flex justify-between p-2"><span>{dateText(payment.createdAt)} · {payment.receiptNo || "—"}</span><b className="tabular-nums">{formatCurrency(payment.amount)}</b></li>)}</ul> : <p className="text-xs text-muted-foreground">لا توجد دفعات معتمدة.</p>}</div>
          {pending.length ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{pending.length} دفعة بانتظار اعتماد الإدارة بمجموع {formatCurrency(pending.reduce((sum, request) => sum + Number(request.amount || 0), 0))}</p> : null}
          {student.notes ? <p className="rounded-lg border p-2 text-xs"><b>ملاحظات: </b>{student.notes}</p> : null}
          <a href={student.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#7b1e3a] hover:underline"><ExternalLink className="h-3.5 w-3.5" />صفحة تتبع الطالب</a>
        </div> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditStudentDialog({ groupId, student, onClose }: { groupId: number; student: Enriched | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  if (student && loadedFor !== student.id) { setLoadedFor(student.id); setName(student.name); setNotes(student.notes || ""); }
  const save = useMutation({
    mutationFn: () => repApi(`/groups/${groupId}/students/${student?.id}`, { method: "PATCH", body: JSON.stringify({ customerName: name.trim(), notes: notes.trim() || null }) }),
    onSuccess: () => { toast({ title: "تم حفظ بيانات الطالب" }); void qc.invalidateQueries({ queryKey: ["representative"] }); setLoadedFor(null); onClose(); },
    onError: (error) => toast({ title: "تعذر حفظ بيانات الطالب", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={Boolean(student)} onOpenChange={(open) => { if (!open) { setLoadedFor(null); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>تعديل بيانات الطالب</DialogTitle><DialogDescription>يُحفظ التعديل في سجل الطالب. تعديل الهاتف أو الطلب نفسه يتم من الإدارة.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="edit-student-name">الاسم الكامل</Label><Input id="edit-student-name" className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div><Label htmlFor="edit-student-notes">ملاحظات</Label><Textarea id="edit-student-notes" className="mt-1.5" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button className={BRAND.button} disabled={name.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "جارٍ الحفظ…" : "حفظ"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStudentDialog({ open, joinUrl, status, onClose }: { open: boolean; joinUrl: string; status: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const absolute = typeof window === "undefined" ? joinUrl : `${window.location.origin}${joinUrl}`;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setCopied(false); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>إضافة طالب إلى المجموعة</DialogTitle><DialogDescription>يُسجَّل الطالب عبر رابط المجموعة نفسه، فيحصل على نفس إعدادات المجموعة وأسعارها وقياساتها.</DialogDescription></DialogHeader>
        {status !== "open" ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">التسجيل في هذه المجموعة مغلق حالياً.</p> : null}
        <div className="rounded-xl border border-rose-100 bg-[#fbeff2]/40 p-3 text-xs" dir="ltr">{absolute}</div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button className={BRAND.button} asChild><a href={joinUrl} target="_blank" rel="noreferrer"><ExternalLink className="ml-1 h-4 w-4" />فتح نموذج التسجيل</a></Button>
          <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(absolute); setCopied(true); }}>{copied ? <Check className="ml-1 h-4 w-4" /> : <ClipboardCopy className="ml-1 h-4 w-4" />}{copied ? "تم النسخ" : "نسخ الرابط"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ payments
function PaymentsTab({ stats, posted, requests, admin, canPrint, onPrint, groupNo }: { stats: Workspace["stats"]; posted: Posted[]; requests: Request[]; admin: boolean; canPrint: boolean; onPrint: (payment: Posted) => void; groupNo: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pending = requests.filter((request) => request.status === "pending");
  const decide = useMutation({
    mutationFn: ({ id, action, note }: { id: number; action: "approve" | "reject"; note?: string }) =>
      repApi(`/payments/${id}/${action}`, { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
    onSuccess: (_data, variables) => { toast({ title: variables.action === "approve" ? "تم اعتماد الدفعة وإصدار الوصل" : "تم رفض الدفعة" }); void qc.invalidateQueries({ queryKey: ["representative"] }); },
    onError: (error) => toast({ title: "تعذر تنفيذ الإجراء", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="قيمة العقود" value={formatCurrency(stats.total)} />
        <Metric label="المدفوع المعتمد" value={formatCurrency(stats.paid)} tone="green" />
        <Metric label="المتبقي" value={formatCurrency(stats.remaining)} tone="brand" />
        <Metric label="بانتظار الاعتماد" value={formatCurrency(pending.reduce((sum, request) => sum + Number(request.amount || 0), 0))} tone="amber" hint={`${pending.length} طلب`} />
      </div>
      <section className="space-y-2">
        <h3 className="font-bold">طلبات الدفع المسجلة من الممثل</h3>
        {requests.length ? <div className={`${BRAND.card} overflow-x-auto`}><Table>
          <TableHeader><TableRow className="bg-[#fbeff2]/60 hover:bg-[#fbeff2]/60">{["الطالب", "المبلغ", "الطريقة", "المرجع", "الممثل", "التاريخ", "الحالة", ""].map((head, index) => <TableHead key={index}>{head}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell><b>{request.studentName}</b><small className="block text-muted-foreground">{request.studentCode}</small></TableCell>
              <TableCell className="tabular-nums">{formatCurrency(Number(request.amount))}</TableCell>
              <TableCell>{PAYMENT_METHOD_LABELS[request.payment_method] || request.payment_method}</TableCell>
              <TableCell className="text-xs">{request.receipt_number || "—"}</TableCell>
              <TableCell className="text-xs">{request.representative_name}</TableCell>
              <TableCell className="text-xs">{dateText(request.created_at)}</TableCell>
              <TableCell><span className="text-xs font-medium">{REQUEST_STATUS_LABELS[request.status] || request.status}</span>{request.rejection_note ? <small className="block text-muted-foreground">{request.rejection_note}</small> : null}</TableCell>
              <TableCell>{admin && request.status === "pending" ? <div className="flex gap-1">
                <Button size="sm" className="h-8 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700" disabled={decide.isPending} onClick={() => { if (window.confirm(`اعتماد دفعة ${request.studentName} بمبلغ ${formatCurrency(Number(request.amount))}؟ ستُضاف إلى رصيد الطالب ويُصدر وصل.`)) decide.mutate({ id: Number(request.id), action: "approve" }); }}><Check className="ml-1 h-3.5 w-3.5" />اعتماد</Button>
                <Button size="sm" variant="outline" className="h-8 px-2 text-xs text-destructive" disabled={decide.isPending} onClick={() => { const note = window.prompt("سبب الرفض")?.trim(); if (note) decide.mutate({ id: Number(request.id), action: "reject", note }); }}><X className="ml-1 h-3.5 w-3.5" />رفض</Button>
              </div> : null}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div> : <EmptyState text="لا توجد طلبات دفع لهذه المجموعة." />}
      </section>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">كشف الدفعات المعتمدة</h3><Button size="sm" variant="outline" className="border-rose-200" disabled={!posted.length} onClick={() => downloadCsv(`group-${groupNo}-payments.csv`, ["التاريخ", "الطالب", "الكود", "المبلغ", "الطريقة", "رقم الوصل", "المستلم"], posted.map((payment) => [dateText(payment.createdAt), payment.studentName, payment.studentCode, payment.amount, PAYMENT_METHOD_LABELS[payment.paymentMethod] || payment.paymentMethod, payment.receiptNo || "", payment.receivedBy]))}>CSV</Button></div>
        {posted.length ? <div className={`${BRAND.card} overflow-x-auto`}><Table>
          <TableHeader><TableRow className="bg-[#fbeff2]/60 hover:bg-[#fbeff2]/60">{["التاريخ", "الطالب", "المبلغ", "الطريقة", "رقم الوصل", "المستلم", ""].map((head, index) => <TableHead key={index}>{head}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{posted.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="text-xs">{dateText(payment.createdAt)}</TableCell>
              <TableCell><b>{payment.studentName}</b><small className="block text-muted-foreground">{payment.studentCode}</small></TableCell>
              <TableCell className="tabular-nums text-emerald-700">{formatCurrency(payment.amount)}</TableCell>
              <TableCell>{PAYMENT_METHOD_LABELS[payment.paymentMethod] || payment.paymentMethod}</TableCell>
              <TableCell className="font-mono text-xs">{payment.receiptNo || "—"}</TableCell>
              <TableCell className="text-xs">{payment.receivedBy || "—"}</TableCell>
              <TableCell>{canPrint && payment.receiptNo ? <Button size="sm" variant="outline" className="h-8 border-rose-200 text-xs" onClick={() => onPrint(payment)}><Printer className="ml-1 h-3.5 w-3.5" />الوصل</Button> : null}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div> : <EmptyState text="لا توجد دفعات معتمدة بعد." />}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ orders / measurements / printing / delivery
function SimpleTable({ head, children }: { head: string[]; children: ReactNode }) {
  return <div className={`${BRAND.card} overflow-x-auto`}><Table><TableHeader><TableRow className="bg-[#fbeff2]/60 hover:bg-[#fbeff2]/60">{head.map((item, index) => <TableHead key={index} className="whitespace-nowrap">{item}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></Table></div>;
}

function OrdersTab({ students, config }: { students: Enriched[]; config: ReturnType<typeof useGraduationConfig>["data"] }) {
  if (!students.length) return <EmptyState text="لا توجد طلبات في هذه المجموعة." />;
  return (
    <SimpleTable head={["رقم الطلب", "الطالب", "الباقة", "نوع الروب", "القماش", "الإضافات", "الإجمالي", "حالة الطلب", "مرحلة التجهيز", "التاريخ"]}>
      {students.map((student) => (
        <TableRow key={student.id} className={student.production === "cancelled" ? "opacity-60" : ""}>
          <TableCell className="font-mono text-xs">{student.orderNo}{student.receiptNo ? <small className="block text-muted-foreground">{student.receiptNo}</small> : null}</TableCell>
          <TableCell className="whitespace-nowrap font-medium">{student.name}</TableCell>
          <TableCell>{optionName(config?.packages, student.packageKey)}</TableCell>
          <TableCell>{optionName(config?.styles, student.styleKey)}</TableCell>
          <TableCell>{record(student.fabric).name || optionName(config?.fabrics, record(student.fabric).key)}</TableCell>
          <TableCell className="max-w-48 text-xs">{student.accessories.map((key: string) => optionName(config?.accessories, key)).join("، ") || "—"}</TableCell>
          <TableCell className="tabular-nums">{formatCurrency(student.total)}</TableCell>
          <TableCell className="text-xs">{ORDER_STATUS_LABELS[student.status] || student.status}</TableCell>
          <TableCell className="text-xs">{stageLabel(student.productionStage)}</TableCell>
          <TableCell className="text-xs">{dateText(student.createdAt)}</TableCell>
        </TableRow>
      ))}
    </SimpleTable>
  );
}

function MeasurementsTab({ students }: { students: Enriched[] }) {
  const [filter, setFilter] = useState("all");
  const shown = students.filter((student) => student.production !== "cancelled" && (filter === "all" || (filter === "incomplete" ? student.measurementStatus !== "complete" : student.measurementStatus === "complete")));
  const label = { complete: "مكتملة", partial: "ناقصة", none: "لم تُدخل" } as Record<string, string>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{[["all", "الكل"], ["incomplete", "غير مكتملة"], ["complete", "مكتملة"]].map(([key, text]) => <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} className={filter === key ? BRAND.button : "border-rose-200"} onClick={() => setFilter(key)}>{text}</Button>)}</div>
      {shown.length ? <SimpleTable head={["الطالب", "الحالة", ...MEASURE_COLUMNS.map(([, text]) => text), "المقاس الجاهز"]}>
        {shown.map((student) => { const m = record(student.measurements); return (
          <TableRow key={student.id}>
            <TableCell className="whitespace-nowrap font-medium">{student.name}</TableCell>
            <TableCell><StepBadge value={student.measurementStatus === "complete" ? "done" : student.measurementStatus === "partial" ? "active" : "pending"} /><span className="sr-only">{label[student.measurementStatus]}</span></TableCell>
            {MEASURE_COLUMNS.map(([key]) => <TableCell key={key} className="tabular-nums text-xs">{m[key] ? String(m[key]) : "—"}</TableCell>)}
            <TableCell className="text-xs">{m.readySize || m.suggestedSize || "—"}</TableCell>
          </TableRow>); })}
      </SimpleTable> : <EmptyState text="لا يوجد طلاب ضمن هذا الفلتر." />}
    </div>
  );
}

function PrintingTab({ students }: { students: Enriched[] }) {
  const active = students.filter((student) => student.production !== "cancelled");
  if (!active.length) return <EmptyState text="لا يوجد طلاب في هذه المجموعة." />;
  return (
    <SimpleTable head={["الطالب", "الاسم على الوشاح", "نوع الوشاح", "لون الوشاح", "لون التطريز", "الخط", "الطباعة", "التطريز"]}>
      {active.map((student) => { const text = record(student.customText); const colors = record(student.colors); const sashColor = text.sashColor || colors.sash; const thread = text.embroideryColor || colors.embroidery; return (
        <TableRow key={student.id}>
          <TableCell className="whitespace-nowrap font-medium">{student.name}</TableCell>
          <TableCell className="font-semibold text-[#7b1e3a]">{text.text || "—"}</TableCell>
          <TableCell>{SASH_TYPES.find((type) => type.key === text.sashType)?.label || "—"}</TableCell>
          <TableCell>{sashColor ? <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded border" style={{ background: String(sashColor) }} /><span dir="ltr" className="text-xs">{String(sashColor)}</span></span> : "—"}</TableCell>
          <TableCell>{thread ? <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded border" style={{ background: String(thread) }} /><span dir="ltr" className="text-xs">{String(thread)}</span></span> : "—"}</TableCell>
          <TableCell className="text-xs">{SASH_FONTS.find((font) => font.key === text.font)?.label || text.font || "—"}</TableCell>
          <TableCell><StepBadge value={student.equipment.printing} /></TableCell>
          <TableCell><StepBadge value={student.equipment.embroidery} /></TableCell>
        </TableRow>); })}
    </SimpleTable>
  );
}

function DeliveryTab({ students, deliveryDate }: { students: Enriched[]; deliveryDate: string | null }) {
  const [filter, setFilter] = useState("all");
  const active = students.filter((student) => student.production !== "cancelled");
  const shown = active.filter((student) => filter === "all" || student.deliveryState === filter);
  const delivered = active.filter((student) => student.deliveryState === "delivered").length;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="تم التسليم" value={`${delivered} / ${active.length}`} tone="green" />
        <Metric label="جاهز للتسليم" value={active.filter((student) => student.production === "ready").length} />
        <Metric label="موعد تسليم المجموعة" value={dateText(deliveryDate)} />
      </div>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant={filter === "all" ? "default" : "outline"} className={filter === "all" ? BRAND.button : "border-rose-200"} onClick={() => setFilter("all")}>الكل</Button>{Object.entries(DELIVERY_PHASE_LABELS).map(([key, text]) => <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} className={filter === key ? BRAND.button : "border-rose-200"} onClick={() => setFilter(key)}>{text}</Button>)}</div>
      {shown.length ? <SimpleTable head={["الطالب", "التجهيز", "التسليم", "الروب", "الوشاح", "القبعة", "المتبقي", "استلمه", "تاريخ التسليم"]}>
        {shown.map((student) => { const delivery = record(student.delivery); return (
          <TableRow key={student.id}>
            <TableCell className="whitespace-nowrap font-medium">{student.name}</TableCell>
            <TableCell><ProductionBadge value={student.production} /></TableCell>
            <TableCell><DeliveryBadge value={student.deliveryState} /></TableCell>
            <TableCell><StepBadge value={student.equipment.gown} /></TableCell>
            <TableCell><StepBadge value={student.equipment.sash} /></TableCell>
            <TableCell><StepBadge value={student.equipment.cap} /></TableCell>
            <TableCell className={`tabular-nums ${student.remaining ? "text-[#7b1e3a]" : ""}`}>{formatCurrency(student.remaining)}</TableCell>
            <TableCell className="text-xs">{delivery.receivedBy || "—"}</TableCell>
            <TableCell className="text-xs">{dateText(student.deliveredAt || delivery.deliveredAt)}</TableCell>
          </TableRow>); })}
      </SimpleTable> : <EmptyState text="لا يوجد طلاب ضمن هذا الفلتر." />}
    </div>
  );
}

// ------------------------------------------------------------------ reports
type ReportKind = "students" | "payments" | "unpaid" | "partial" | "production" | "delivery";
const REPORTS: Array<{ key: ReportKind; title: string; description: string }> = [
  { key: "students", title: "قائمة الطلاب", description: "كل طلاب المجموعة مع أرصدتهم وحالاتهم." },
  { key: "payments", title: "كشف الدفعات", description: "الدفعات المعتمدة مع أرقام الوصولات." },
  { key: "unpaid", title: "الطلاب غير المدفوعين", description: "من لم يدفع أي مبلغ بعد." },
  { key: "partial", title: "الطلاب المدفوعين جزئياً", description: "من بقي عليه رصيد." },
  { key: "production", title: "حالة التجهيز", description: "مرحلة تجهيز كل طالب وتجهيزاته." },
  { key: "delivery", title: "حالة التسليم", description: "من استلم ومن ينتظر التسليم." },
];

function ReportsTab({ workspace, students, canExport, logo }: { workspace: Workspace; students: Enriched[]; canExport: boolean; logo: string }) {
  const { toast } = useToast();
  const { group, stats } = workspace;
  const active = students.filter((student) => student.production !== "cancelled");
  const meta = [{ label: "المجموعة", value: `${group.title} (${group.groupNo})` }, { label: "الوجبة", value: group.batchLabel }, { label: "الجامعة", value: [group.university, group.college, group.department].filter(Boolean).join(" › ") || "—" }];
  const studentColumns = (extra: ReportColumn<Enriched>[] = []): ReportColumn<Enriched>[] => [
    { key: "studentCode", header: "الكود", width: 10, kind: "code" },
    { key: "name", header: "الطالب", width: 18, priority: "high" },
    { key: "phone", header: "الهاتف", width: 11, kind: "code", priority: "medium" },
    ...extra,
  ];
  const build = (kind: ReportKind) => {
    const money = (key: "total" | "paid" | "remaining", header: string): ReportColumn<Enriched> => ({ key, header, width: 11, kind: "money" });
    const sum = (rows: Enriched[], key: "total" | "paid" | "remaining") => formatCurrency(rows.reduce((total, row) => total + row[key], 0));
    if (kind === "payments") {
      const rows = workspace.payments.posted;
      return { title: "كشف الدفعات", rows, columns: [
        { key: "createdAt", header: "التاريخ", width: 10, kind: "date", value: (row: Posted) => dateText(row.createdAt) },
        { key: "studentName", header: "الطالب", width: 18 },
        { key: "receiptNo", header: "رقم الوصل", width: 13, kind: "code" },
        { key: "paymentMethod", header: "الطريقة", width: 9, value: (row: Posted) => PAYMENT_METHOD_LABELS[row.paymentMethod] || row.paymentMethod },
        { key: "receivedBy", header: "المستلم", width: 12 },
        { key: "amount", header: "المبلغ", width: 11, kind: "money" },
      ] as ReportColumn<Posted>[], totals: [{ key: "amount", text: formatCurrency(rows.reduce((total, row) => total + row.amount, 0)) }],
        csv: { head: ["التاريخ", "الطالب", "الكود", "رقم الوصل", "الطريقة", "المستلم", "المبلغ"], lines: rows.map((row) => [dateText(row.createdAt), row.studentName, row.studentCode, row.receiptNo || "", PAYMENT_METHOD_LABELS[row.paymentMethod] || row.paymentMethod, row.receivedBy, row.amount]) } };
    }
    const rows = kind === "unpaid" ? active.filter((student) => student.pay === "unpaid") : kind === "partial" ? active.filter((student) => student.pay === "partial") : kind === "students" ? students : active;
    const title = REPORTS.find((report) => report.key === kind)!.title;
    const columns = kind === "production"
      ? studentColumns([{ key: "stage", header: "مرحلة التجهيز", width: 13, value: (row) => stageLabel(row.productionStage) }, { key: "production", header: "الحالة", width: 11, value: (row) => PRODUCTION_PHASE_LABELS[row.production] }, { key: "measurementStatus", header: "القياسات", width: 9, value: (row) => ({ complete: "مكتملة", partial: "ناقصة", none: "لم تُدخل" } as Record<string, string>)[row.measurementStatus] }])
      : kind === "delivery"
        ? studentColumns([{ key: "deliveryState", header: "التسليم", width: 13, value: (row) => DELIVERY_PHASE_LABELS[row.deliveryState] }, { key: "deliveredAt", header: "تاريخ التسليم", width: 11, kind: "date", value: (row) => dateText(row.deliveredAt) }, money("remaining", "المتبقي")])
        : studentColumns([money("total", "الإجمالي"), money("paid", "المدفوع"), money("remaining", "المتبقي"), { key: "pay", header: "حالة الدفع", width: 10, value: (row) => PAYMENT_PHASE_LABELS[row.pay] }]);
    const financial = !["production", "delivery"].includes(kind);
    return { title, rows, columns, totals: financial ? [{ key: "total", text: sum(rows, "total") }, { key: "paid", text: sum(rows, "paid") }, { key: "remaining", text: sum(rows, "remaining") }] : kind === "delivery" ? [{ key: "remaining", text: sum(rows, "remaining") }] : [],
      csv: { head: ["الكود", "الطالب", "الهاتف", "الإجمالي", "المدفوع", "المتبقي", "حالة الدفع", "التجهيز", "التسليم"], lines: rows.map((row) => [row.studentCode, row.name, row.phone, row.total, row.paid, row.remaining, PAYMENT_PHASE_LABELS[row.pay], stageLabel(row.productionStage), DELIVERY_PHASE_LABELS[row.deliveryState]]) } };
  };
  const run = async (kind: ReportKind, mode: "print" | "download") => {
    const report = build(kind);
    try {
      await exportReport<any>({
        options: {
          title: `${report.title} — ${group.title}`, orientation: "landscape", logoUrl: logo, meta,
          summary: [{ label: "الطلاب", value: String(stats.students) }, { label: "العقود", value: formatCurrency(stats.total) }, { label: "المدفوع", value: formatCurrency(stats.paid), tone: "positive" }, { label: "المتبقي", value: formatCurrency(stats.remaining), tone: "negative" }],
          totalsLabel: report.totals.length ? "الإجمالي" : undefined, totals: report.totals, emptyText: "لا توجد بيانات لهذا التقرير", footerNote: `${group.batchLabel} · بوابة ممثلي التخرج · نظام AJN`,
        },
        columns: report.columns as ReportColumn<any>[], rows: report.rows as any[], filename: `group-${group.groupNo}-${kind}.pdf`, mode,
      });
    } catch (error) {
      toast({ title: "تعذر إنشاء التقرير", description: apiErrorMessage(error), variant: "destructive" });
    }
  };
  if (!canExport) return <EmptyState text="لا تملك صلاحية تصدير التقارير." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {REPORTS.map((report) => (
        <Card key={report.key} className={BRAND.card}><CardContent className="flex h-full flex-col gap-3 p-4">
          <div><FileText className={`mb-2 h-6 w-6 ${BRAND.text}`} /><h3 className="font-bold">{report.title}</h3><p className="mt-1 text-xs text-muted-foreground">{report.description}</p></div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button size="sm" className={BRAND.button} onClick={() => void run(report.key, "print")}><Printer className="ml-1 h-3.5 w-3.5" />طباعة</Button>
            <Button size="sm" variant="outline" className="border-rose-200" onClick={() => void run(report.key, "download")}>PDF</Button>
            <Button size="sm" variant="outline" className="border-rose-200" onClick={() => { const csv = build(report.key).csv; downloadCsv(`group-${group.groupNo}-${report.key}.csv`, csv.head, csv.lines); }}>CSV</Button>
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}
