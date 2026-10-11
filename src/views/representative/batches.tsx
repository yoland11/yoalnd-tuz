import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Building2, FileText, GraduationCap, Layers3, Link2, Plus, Printer, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage, formatCurrency } from "@/views/admin/_lib";
import { useToast } from "@/hooks/use-toast";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { UNASSIGNED_BATCH, batchLabel, isValidBatchKey, normalizeBatchKey } from "@/lib/graduation-batches";
import type { BatchesOverview } from "@/server/representative-workspace";
import { BRAND, Breadcrumbs, EmptyState, ErrorCard, Metric, Progress, downloadCsv, repApi } from "./shared";

type Overview = BatchesOverview;
type GroupCardData = Overview["groups"][number];
type BatchSummary = Overview["batches"][number];

export function useBatchesOverview() {
  return useQuery({ queryKey: ["representative", "batches"], queryFn: () => repApi<Overview>("/batches") });
}

const batchHref = (key: string) => `/representative/batches/${encodeURIComponent(key)}`;
export const groupHref = (id: number) => `/representative/groups/${id}`;

function BatchStatsGrid({ stats, groups }: { stats: Overview["batches"][number]["stats"]; groups: number }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="المجموعات" value={groups} />
        <Metric label="الطلاب" value={stats.students} />
        <Metric label="إجمالي العقود" value={formatCurrency(stats.total)} />
        <Metric label="إجمالي المدفوع" value={formatCurrency(stats.paid)} tone="green" />
        <Metric label="الأرصدة المتبقية" value={formatCurrency(stats.remaining)} tone="brand" />
      </div>
      <Card className={`${BRAND.card}`}><CardContent className="grid gap-4 p-4 sm:grid-cols-3">
        <Progress label="نسبة التحصيل" value={stats.collectionProgress} />
        <Progress label="تقدم التجهيز" value={stats.productionProgress} tone="sky" />
        <Progress label="تقدم التسليم" value={stats.deliveryProgress} tone="green" />
      </CardContent></Card>
    </div>
  );
}

function CreateBatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const normalized = normalizeBatchKey(key);
  const valid = isValidBatchKey(normalized);
  const save = useMutation({
    mutationFn: () => repApi<{ batch: { key: string; label: string } }>("/batches", { method: "POST", body: JSON.stringify({ key: normalized, title }) }),
    onSuccess: (data) => {
      toast({ title: `تم إنشاء ${data.batch.label}` });
      void qc.invalidateQueries({ queryKey: ["representative", "batches"] });
      setKey(""); setTitle(""); onClose();
    },
    onError: (error) => toast({ title: "تعذر إنشاء الوجبة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>إنشاء وجبة تخرج جديدة</DialogTitle><DialogDescription>الوجبة تجمع مجموعات سنة تخرج واحدة. تُربط المجموعات بها عبر «سنة التخرج» عند إنشاء المجموعة.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="batch-key">سنة الوجبة *</Label><Input id="batch-key" dir="ltr" className="mt-1.5 text-right" value={key} onChange={(event) => setKey(event.target.value)} placeholder="2027 أو 2026-2027" aria-invalid={Boolean(key) && !valid} />{key && !valid ? <p className="mt-1 text-xs text-destructive">اكتب السنة بصيغة 2027 أو 2026-2027</p> : null}</div>
          <div><Label htmlFor="batch-title">اسم مخصص (اختياري)</Label><Input id="batch-title" className="mt-1.5" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={valid ? batchLabel(normalized) : "وجبة 2027"} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button className={BRAND.button} disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "جارٍ الإنشاء…" : "إنشاء الوجبة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignBatchDialog({ group, batches, onClose }: { group: GroupCardData | null; batches: BatchSummary[]; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const options = batches.filter((batch) => batch.key !== UNASSIGNED_BATCH && isValidBatchKey(batch.key));
  const save = useMutation({
    mutationFn: () => repApi(`/groups/${group?.id}/batch`, { method: "PATCH", body: JSON.stringify({ key, confirm: true }) }),
    onSuccess: () => {
      toast({ title: `تم ربط المجموعة بـ ${batchLabel(key)}` });
      void qc.invalidateQueries({ queryKey: ["representative"] });
      setKey(""); setConfirmed(false); onClose();
    },
    onError: (error) => toast({ title: "تعذر ربط المجموعة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <Dialog open={Boolean(group)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>ربط مجموعة بوجبة تخرج</DialogTitle><DialogDescription>لا يخمّن النظام الوجبة من اسم المجموعة. اختر الوجبة الصحيحة بعد التحقق؛ لا يمكن تغييرها من البوابة بعد الحفظ.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-100 bg-[#fbeff2]/50 p-3 text-sm"><b>{group?.title}</b><p className="text-xs text-muted-foreground">{group?.groupNo} · {[group?.university, group?.college, group?.department].filter(Boolean).join(" · ") || "بدون بيانات أكاديمية"}</p></div>
          {options.length ? <Select value={key} onValueChange={setKey}><SelectTrigger><SelectValue placeholder="اختر الوجبة" /></SelectTrigger><SelectContent>{options.map((batch) => <SelectItem key={batch.key} value={batch.key}>{batch.label}</SelectItem>)}</SelectContent></Select>
            : <p className="text-sm text-muted-foreground">أنشئ وجبة أولاً من صفحة وجبات التخرج.</p>}
          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />أؤكد أنني تحققت من أن هذه المجموعة تتبع {key ? batchLabel(key) : "الوجبة المختارة"}.</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button className={BRAND.button} disabled={!key || !confirmed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "جارٍ الحفظ…" : "ربط المجموعة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupCard({ group, onAssign }: { group: GroupCardData; onAssign?: (group: GroupCardData) => void }) {
  const s = group.stats;
  return (
    <Card className={`${BRAND.card} flex flex-col`}>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-muted-foreground">{group.groupNo}</p>
            <h3 className="truncate text-base font-bold" title={group.title}>{group.title}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{[group.university, group.college, group.department].filter(Boolean).join(" › ") || "بدون بيانات أكاديمية"}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#fbeff2] px-2 py-0.5 text-[11px] font-semibold text-[#7b1e3a]">{batchLabel(group.batchKey)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <span className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">الطلاب<b className="block text-sm tabular-nums">{s.students}{group.expectedStudentCount ? ` / ${group.expectedStudentCount}` : ""}</b></span>
          <span className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">قيمة العقود<b className="block text-sm tabular-nums">{formatCurrency(s.total)}</b></span>
          <span className="rounded-lg bg-emerald-50/60 p-2 dark:bg-slate-800">المدفوع<b className="block text-sm tabular-nums text-emerald-700">{formatCurrency(s.paid)}</b></span>
          <span className="rounded-lg bg-rose-50/60 p-2 dark:bg-slate-800">المتبقي<b className="block text-sm tabular-nums text-[#7b1e3a]">{formatCurrency(s.remaining)}</b></span>
        </div>
        <div className="space-y-2">
          <Progress label="التجهيز" value={s.productionProgress} tone="sky" />
          <Progress label="التسليم" value={s.deliveryProgress} tone="green" />
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          <Button asChild className={`${BRAND.button} flex-1`}><Link href={groupHref(group.id)}>إدارة المجموعة</Link></Button>
          {onAssign ? <Button variant="outline" className="border-amber-300 text-amber-800" onClick={() => onAssign(group)}><Link2 className="ml-1 h-4 w-4" />ربط بوجبة</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}

async function printBatchReport(label: string, groups: GroupCardData[], logo: string, mode: "print" | "download") {
  const columns: ReportColumn<GroupCardData>[] = [
    { key: "groupNo", header: "رقم المجموعة", width: 11, kind: "code" },
    { key: "title", header: "المجموعة", width: 16, priority: "high" },
    { key: "academic", header: "الجامعة / الكلية / القسم", width: 22, value: (row) => [row.university, row.college, row.department].filter(Boolean).join(" › ") },
    { key: "students", header: "الطلاب", width: 7, kind: "number", value: (row) => row.stats.students },
    { key: "total", header: "العقود", width: 11, kind: "money", value: (row) => row.stats.total },
    { key: "paid", header: "المدفوع", width: 11, kind: "money", value: (row) => row.stats.paid },
    { key: "remaining", header: "المتبقي", width: 11, kind: "money", value: (row) => row.stats.remaining },
    { key: "production", header: "التجهيز", width: 7, kind: "number", value: (row) => `${row.stats.productionProgress}%` },
    { key: "delivery", header: "التسليم", width: 7, kind: "number", value: (row) => `${row.stats.deliveryProgress}%` },
  ];
  const sum = (pick: (row: GroupCardData) => number) => groups.reduce((total, row) => total + pick(row), 0);
  await exportReport({
    options: {
      title: `تقرير ${label}`,
      orientation: "landscape",
      logoUrl: logo,
      summary: [
        { label: "المجموعات", value: String(groups.length) },
        { label: "الطلاب", value: String(sum((row) => row.stats.students)) },
        { label: "إجمالي العقود", value: formatCurrency(sum((row) => row.stats.total)) },
        { label: "المتبقي", value: formatCurrency(sum((row) => row.stats.remaining)), tone: "negative" },
      ],
      totalsLabel: "الإجمالي",
      totals: [
        { key: "total", text: formatCurrency(sum((row) => row.stats.total)) },
        { key: "paid", text: formatCurrency(sum((row) => row.stats.paid)) },
        { key: "remaining", text: formatCurrency(sum((row) => row.stats.remaining)) },
      ],
      footerNote: "بوابة ممثلي التخرج · نظام AJN",
    },
    columns,
    rows: groups,
    filename: `graduation-batch-report.pdf`,
    mode,
  });
}

/** Administrator landing page: all batches, global totals, comparison and cross-batch search. */
export function BatchesHome() {
  const overview = useBatchesOverview();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const needle = search.trim().toLowerCase();
  const matches = useMemo(() => (overview.data?.groups ?? []).filter((group) => needle && [group.title, group.groupNo, group.university, group.college, group.department, group.representativeName]
    .some((value) => String(value ?? "").toLowerCase().includes(needle))).slice(0, 30), [overview.data, needle]);
  if (overview.isPending) return <Skeleton className="h-[620px] rounded-2xl" />;
  if (overview.isError) return <ErrorCard error={overview.error} retry={() => void overview.refetch()} />;
  const data = overview.data;
  const unassigned = data.batches.find((batch) => batch.key === UNASSIGNED_BATCH);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><Breadcrumbs items={[{ label: "وجبات التخرج" }]} /><h2 className="mt-1 text-xl font-bold">وجبات التخرج</h2><p className="text-sm text-muted-foreground">كل وجبة مستقلة بمجموعاتها وطلابها ودفعاتها وتقاريرها.</p></div>
        {data.kind === "admin" ? <Button className={BRAND.button} onClick={() => setCreating(true)}><Plus className="ml-1 h-4 w-4" />إنشاء وجبة جديدة</Button> : null}
      </div>
      {data.global ? <section aria-label="الإحصائيات العامة" className="space-y-2"><h3 className="text-sm font-semibold text-muted-foreground">الإحصائيات العامة لكل الوجبات</h3><BatchStatsGrid stats={data.global} groups={data.groups.length} /></section> : null}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-bold"><Layers3 className={`h-5 w-5 ${BRAND.text}`} />اختر وجبة التخرج</h3>
        {data.batches.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.batches.map((batch) => (
          <button key={batch.key} type="button" onClick={() => navigate(batchHref(batch.key))} className={`${BRAND.card} p-4 text-right transition hover:-translate-y-0.5 hover:border-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7b1e3a] ${batch.key === UNASSIGNED_BATCH ? "border-amber-200 bg-amber-50/40" : ""}`}>
            <div className="flex items-center justify-between gap-2"><b className="text-lg">{batch.label}</b><GraduationCap className={`h-5 w-5 ${BRAND.text}`} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{batch.groups} مجموعات · {batch.stats.students} طالب{batch.universities ? ` · ${batch.universities} جامعات` : ""}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]"><span>العقود<b className="block text-xs tabular-nums">{formatCurrency(batch.stats.total)}</b></span><span>المدفوع<b className="block text-xs tabular-nums text-emerald-700">{formatCurrency(batch.stats.paid)}</b></span><span>المتبقي<b className="block text-xs tabular-nums text-[#7b1e3a]">{formatCurrency(batch.stats.remaining)}</b></span></div>
            <div className="mt-3 space-y-1.5"><Progress label="التجهيز" value={batch.stats.productionProgress} tone="sky" /><Progress label="التسليم" value={batch.stats.deliveryProgress} tone="green" /></div>
          </button>
        ))}</div> : <EmptyState text="لا توجد وجبات بعد. أنشئ وجبة جديدة أو أنشئ مجموعة بسنة تخرج." />}
        {unassigned?.groups ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{unassigned.groups} مجموعات لا تحمل سنة تخرج. افتح «بدون وجبة محددة» واربط كل مجموعة بوجبتها بعد التحقق — لا يخمّن النظام الوجبة من اسم المجموعة.</p> : null}
      </section>
      {data.batches.length > 1 ? <section className="space-y-2">
        <h3 className="font-bold">مقارنة الأداء المالي بين الوجبات</h3>
        <div className={`${BRAND.card} overflow-x-auto`}><Table><TableHeader><TableRow className="bg-[#fbeff2]/60 hover:bg-[#fbeff2]/60">{["الوجبة", "المجموعات", "الطلاب", "العقود", "المدفوع", "المتبقي", "التحصيل", "التجهيز", "التسليم"].map((head) => <TableHead key={head}>{head}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{data.batches.map((batch) => <TableRow key={batch.key} className="cursor-pointer" onClick={() => navigate(batchHref(batch.key))}><TableCell className="font-semibold">{batch.label}</TableCell><TableCell>{batch.groups}</TableCell><TableCell>{batch.stats.students}</TableCell><TableCell className="tabular-nums">{formatCurrency(batch.stats.total)}</TableCell><TableCell className="tabular-nums text-emerald-700">{formatCurrency(batch.stats.paid)}</TableCell><TableCell className="tabular-nums text-[#7b1e3a]">{formatCurrency(batch.stats.remaining)}</TableCell><TableCell>{batch.stats.collectionProgress}%</TableCell><TableCell>{batch.stats.productionProgress}%</TableCell><TableCell>{batch.stats.deliveryProgress}%</TableCell></TableRow>)}</TableBody></Table></div>
      </section> : null}
      {data.kind === "admin" ? <section className="space-y-2">
        <h3 className="font-bold">بحث في كل الوجبات</h3>
        <div className="relative"><Search className="absolute right-3 top-2.5 h-4 w-4 text-[#7b1e3a]" /><Input className="border-rose-100 pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المجموعة، رقمها، الجامعة، الكلية، القسم أو الممثل" /></div>
        {needle ? matches.length ? <div className={`${BRAND.card} divide-y divide-rose-50`}>{matches.map((group) => <Link key={group.id} href={groupHref(group.id)} className="flex items-center justify-between gap-3 p-3 hover:bg-rose-50/40"><span className="min-w-0"><b className="block truncate text-sm">{group.title}</b><small className="text-muted-foreground">{group.groupNo} · {[group.university, group.college, group.department].filter(Boolean).join(" › ")}</small></span><span className="shrink-0 rounded-full bg-[#fbeff2] px-2 py-0.5 text-[11px] font-semibold text-[#7b1e3a]">{batchLabel(group.batchKey)}</span></Link>)}</div> : <EmptyState text="لا توجد مجموعة مطابقة." /> : null}
      </section> : null}
      <CreateBatchDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

/** One batch: its statistics and its groups only, organised by university › college › department. */
export function BatchDashboard({ batchKey }: { batchKey: string }) {
  const overview = useBatchesOverview();
  const { data: settings } = usePublicSettings();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [university, setUniversity] = useState("all");
  const [college, setCollege] = useState("all");
  const [department, setDepartment] = useState("all");
  const [assigning, setAssigning] = useState<GroupCardData | null>(null);
  const batchGroups = useMemo(() => (overview.data?.groups ?? []).filter((group) => group.batchKey === batchKey), [overview.data, batchKey]);
  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  const universities = distinct(batchGroups.map((group) => group.university));
  const colleges = distinct(batchGroups.filter((group) => university === "all" || group.university === university).map((group) => group.college));
  const departments = distinct(batchGroups.filter((group) => (university === "all" || group.university === university) && (college === "all" || group.college === college)).map((group) => group.department));
  const needle = search.trim().toLowerCase();
  const shown = batchGroups.filter((group) =>
    (university === "all" || group.university === university) &&
    (college === "all" || group.college === college) &&
    (department === "all" || group.department === department) &&
    (!needle || [group.title, group.groupNo, group.representativeName].some((value) => String(value ?? "").toLowerCase().includes(needle))));
  const byUniversity = useMemo(() => {
    const map = new Map<string, GroupCardData[]>();
    for (const group of [...shown].sort((a, b) => `${a.college} ${a.department} ${a.title}`.localeCompare(`${b.college} ${b.department} ${b.title}`, "ar"))) {
      const key = group.university || "جامعة غير محددة";
      map.set(key, [...(map.get(key) ?? []), group]);
    }
    return [...map.entries()];
  }, [shown]);
  if (overview.isPending) return <Skeleton className="h-[620px] rounded-2xl" />;
  if (overview.isError) return <ErrorCard error={overview.error} retry={() => void overview.refetch()} />;
  const data = overview.data;
  const batch = data.batches.find((item) => item.key === batchKey);
  if (!batch) return <div className="space-y-3"><Breadcrumbs items={[{ label: "وجبات التخرج", href: "/representative" }, { label: batchLabel(batchKey) }]} /><EmptyState text="الوجبة غير موجودة أو غير متاحة لحسابك." /></div>;
  const isAdmin = data.kind === "admin";
  const report = async (mode: "print" | "download") => {
    try { await printBatchReport(batch.label, shown, logoSrc(settings), mode); }
    catch (error) { toast({ title: "تعذر إنشاء التقرير", description: apiErrorMessage(error), variant: "destructive" }); }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Breadcrumbs items={[...(isAdmin ? [{ label: "وجبات التخرج", href: "/representative" }] : []), { label: batch.label }]} />
          <h2 className="mt-1 text-xl font-bold">{batch.label}</h2>
          <p className="text-sm text-muted-foreground">إحصائيات ومجموعات هذه الوجبة فقط.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.batches.length > 1 ? <Select value={batchKey} onValueChange={(key) => navigate(batchHref(key))}><SelectTrigger className="w-48" aria-label="اختر وجبة التخرج"><SelectValue placeholder="اختر وجبة التخرج" /></SelectTrigger><SelectContent>{data.batches.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select> : null}
          <Button variant="outline" className="border-rose-200" onClick={() => void report("print")} disabled={!shown.length}><Printer className="ml-1 h-4 w-4" />طباعة تقرير الوجبة</Button>
          <Button variant="outline" className="border-rose-200" onClick={() => void report("download")} disabled={!shown.length}><FileText className="ml-1 h-4 w-4" />PDF</Button>
          <Button variant="outline" className="border-rose-200" disabled={!shown.length} onClick={() => downloadCsv(`batch-${batchKey}.csv`, ["المجموعة", "رقمها", "الجامعة", "الكلية", "القسم", "الطلاب", "العقود", "المدفوع", "المتبقي", "التجهيز %", "التسليم %"], shown.map((group) => [group.title, group.groupNo, group.university, group.college, group.department, group.stats.students, group.stats.total, group.stats.paid, group.stats.remaining, group.stats.productionProgress, group.stats.deliveryProgress]))}>CSV</Button>
          {isAdmin && batchKey !== UNASSIGNED_BATCH ? <Button asChild className={BRAND.button}><a href="/admin/graduation/groups" title={`عند إنشاء المجموعة اكتب سنة التخرج ${batchKey}`}><Plus className="ml-1 h-4 w-4" />مجموعة جديدة</a></Button> : null}
        </div>
      </div>
      <BatchStatsGrid stats={batch.stats} groups={batch.groups} />
      {batchKey === UNASSIGNED_BATCH ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">هذه المجموعات لا تحمل سنة تخرج. اربط كل مجموعة بوجبتها الصحيحة بعد التحقق؛ يُحفظ الربط في سجل المجموعة.</p> : null}
      <Card className={BRAND.card}><CardContent className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative"><Search className="absolute right-3 top-2.5 h-4 w-4 text-[#7b1e3a]" /><Input className="border-rose-100 pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المجموعة أو رقمها" /></div>
        <Select value={university} onValueChange={(value) => { setUniversity(value); setCollege("all"); setDepartment("all"); }}><SelectTrigger aria-label="الجامعة"><Building2 className="ml-1 h-4 w-4 text-muted-foreground" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الجامعات</SelectItem>{universities.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={college} onValueChange={(value) => { setCollege(value); setDepartment("all"); }}><SelectTrigger aria-label="الكلية"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الكليات</SelectItem>{colleges.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={department} onValueChange={setDepartment}><SelectTrigger aria-label="القسم"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الأقسام</SelectItem>{departments.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      </CardContent></Card>
      {byUniversity.length ? byUniversity.map(([name, groups]) => (
        <section key={name} className="space-y-3">
          <h3 className="flex items-center gap-2 font-bold"><Building2 className={`h-4 w-4 ${BRAND.text}`} />{name}<span className="text-xs font-normal text-muted-foreground">({groups.length} مجموعات)</span></h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{groups.map((group) => <GroupCard key={group.id} group={group} onAssign={isAdmin && batchKey === UNASSIGNED_BATCH ? setAssigning : undefined} />)}</div>
        </section>
      )) : <EmptyState text={batchGroups.length ? "لا توجد مجموعة تطابق الفلاتر." : "لا توجد مجموعات في هذه الوجبة بعد."} />}
      <AssignBatchDialog group={assigning} batches={data.batches} onClose={() => setAssigning(null)} />
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Users className="h-3.5 w-3.5" />الأرقام محسوبة من طلبات طلاب كل مجموعة؛ الطلبات الملغاة لا تدخل في الإجماليات.</p>
    </div>
  );
}
