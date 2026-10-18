import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ClipboardCheck, RefreshCw, Search, Truck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyFilters, DailyOperations } from "@/lib/booking-daily-operations";
import { dailyFiltersFromUrl, dailyFiltersToUrl } from "@/lib/booking-daily-operations";
import { adminFetch, apiErrorMessage } from "./_lib";

const labels: Record<string, string> = { kosha: "الكوشات", photography: "التصوير", sound: "الصوتيات", flowers: "الورد", graduation: "التخرج", gifts: "الهدايا", decorations: "الديكور", led: "الشاشات", service: "الخدمات", booked: "محجوز", new: "جديد", pending: "قيد الانتظار", confirmed: "مؤكد", preparing: "قيد التجهيز", ready: "مرحلة التجهيز مكتملة", assets_out: "المعدات بالخارج", event_active: "تنفيذ ميداني", returned: "أُعيدت المعدات", inspection: "قيد الفحص", completed: "مكتمل", delivered: "مسلّم", in_progress: "قيد التنفيذ" };
const selectClass = "min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const defaults: DailyFilters = { period: "today", search: "", category: "all", status: "all", employee: null, vehicle: null, location: "" };
Object.assign(labels,{accepted:"تم قبول المهمة",unassigned:"بانتظار تعيين الفريق",assigned:"الفريق معيّن",warehouse_checkout:"إخراج المستودع",on_the_way:"في الطريق",arrived:"وصل الفريق",installing:"جاري التركيب",event_in_progress:"المناسبة جارية",dismantling:"جاري الفك",returning:"جاري الإرجاع",warehouse_return:"فحص المستودع",crew_assigned:"فريق التصوير معيّن",awaiting_assignment:"بانتظار التعيين",waiting_event:"بانتظار المناسبة",shooting:"التصوير جارٍ",processing_files:"تجهيز الملفات",review_and_edit:"المراجعة والتعديل",printing:"الطباعة",ready_delivery:"جاهز للتسليم"});
const attentionOptions = [["all","كل الحجوزات"],["issues","الأولوية والمتابعة"],["preparation","التجهيز"],["returns","الإرجاع"],["tasks","مهام متأخرة"],["team","تأكيد الفريق"],["transport","النقل"]] as const;
const noOptions:DailyOperations["options"]={categories:[],statuses:[],employees:[],vehicles:[]};
function initialRoomFilters() {
  try { return {filters:dailyFiltersFromUrl(new URLSearchParams(typeof window==="undefined" ? "" : window.location.search)),error:null as string|null}; }
  catch(cause) { return {filters:defaults,error:cause instanceof Error ? cause.message : "مرشحات الرابط غير صحيحة"}; }
}

export function DailyOperationsTab() {
  const [initial] = useState(initialRoomFilters);
  const [filters, setFilters] = useState(initial.filters);
  const [search, setSearch] = useState(initial.filters.search);
  const [location, setLocation] = useState(initial.filters.location);
  const [filterProblem,setFilterProblem]=useState(initial.error);
  const [knownOptions,setKnownOptions]=useState(noOptions);
  useEffect(() => {
    const timer = setTimeout(() => setFilters((prev) => ({ ...prev, search, location })), 300);
    return () => clearTimeout(timer);
  }, [search, location]);
  useEffect(()=>{
    const sync=()=>{const next=initialRoomFilters();setFilters(next.filters);setSearch(next.filters.search);setLocation(next.filters.location);setFilterProblem(next.error);};
    window.addEventListener("popstate",sync);
    return ()=>window.removeEventListener("popstate",sync);
  },[]);
  useEffect(()=>{
    const url=new URL(window.location.href);
    url.search=dailyFiltersToUrl(url.searchParams,filters).toString();
    window.history.replaceState(window.history.state,"",url);
  },[filters]);
  const params = new URLSearchParams({ period: filters.period, category: filters.category, status: filters.status, search: filters.search, location: filters.location, attention:filters.attention || "all" });
  if (filters.employee) params.set("employee", String(filters.employee));
  if (filters.vehicle) params.set("vehicle", String(filters.vehicle));
  const queryString = params.toString();
  const query = useQuery<DailyOperations>({ queryKey: ["admin", "enterprise", "daily-operations", queryString], queryFn: () => adminFetch(`/admin/enterprise/daily-operations?${queryString}`), staleTime: 15_000, refetchInterval: 30_000 });
  useEffect(()=>{
    const incoming=query.data?.options;
    if(!incoming) return;
    setKnownOptions(previous=>({categories:[...new Set([...previous.categories,...incoming.categories])],statuses:[...new Set([...previous.statuses,...incoming.statuses])],employees:[...new Map([...previous.employees,...incoming.employees].map(s=>[s.id,s])).values()],vehicles:[...new Map([...previous.vehicles,...incoming.vehicles].map(v=>[v.id,v])).values()]}));
  },[query.data?.options]);
  const options={...knownOptions,categories:[...new Set([...knownOptions.categories,...(filters.category!=="all" ? [filters.category] : [])])],statuses:[...new Set([...knownOptions.statuses,...(filters.status!=="all" ? [filters.status] : [])])]};
  const update = <K extends keyof DailyFilters>(key: K, value: DailyFilters[K]) => {setFilterProblem(null);setFilters((prev) => ({ ...prev, [key]: value }));};
  const reset=()=>{setFilterProblem(null);setSearch("");setLocation("");setFilters(defaults);};
  return <section dir="rtl" className="space-y-5" aria-label="غرفة عمليات اليوم">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-bold"><CalendarClock className="h-5 w-5 text-primary" />غرفة عمليات اليوم</h2><p className="mt-1 max-w-prose text-sm text-muted-foreground">الحجوزات الأصلية، التجهيزات المعلّقة والخطوة التالية لكل فريق. التوقيت: بغداد.</p></div>
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching} className="min-h-11 gap-2"><RefreshCw className="h-4 w-4" />{query.isFetching ? "جارٍ التحديث" : "تحديث العمليات"}</Button>
    </div>
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap justify-between gap-2"><div className="flex flex-wrap gap-2" role="group" aria-label="فترة العمليات">{([ ["today", "اليوم"], ["tomorrow", "غداً"], ["week", "٧ أيام"], ["recent","آخر 30 يوماً واليوم"] ] as const).map(([value, label]) => <Button key={value} variant={filters.period === value ? "default" : "outline"} className="min-h-11" aria-pressed={filters.period === value} onClick={() => update("period",value)}>{label}</Button>)}</div><Button className="min-h-11" variant="ghost" onClick={reset}>مسح الفلاتر</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-1.5 text-sm"><span>الحجز أو العميل</span><div className="relative"><Search className="pointer-events-none absolute end-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input className="min-h-11 pe-10" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو رقم الحجز" /></div></label>
        <label className="space-y-1.5 text-sm"><span>القسم</span><select aria-label="القسم" className={selectClass} value={filters.category} onChange={(e) => update("category",e.target.value)}><option value="all">كل الأقسام</option>{options.categories.map((c) => <option key={c} value={c}>{labels[c] || c}</option>)}</select></label>
        <label className="space-y-1.5 text-sm"><span>المرحلة التشغيلية المسجّلة</span><select aria-label="المرحلة التشغيلية المسجّلة" className={selectClass} value={filters.status} onChange={(e) => update("status",e.target.value)}><option value="all">كل المراحل</option>{options.statuses.map((s) => <option key={s} value={s}>{labels[s] || s}</option>)}</select></label>
        <label className="space-y-1.5 text-sm"><span>الموظف</span><select aria-label="الموظف" className={selectClass} value={filters.employee || ""} onChange={(e) => update("employee",e.target.value ? Number(e.target.value) : null)}><option value="">كل الموظفين المعيّنين</option>{filters.employee && !options.employees.some(s=>s.id===filters.employee) ? <option value={filters.employee}>الموظف المحدد في الرابط</option> : null}{options.employees.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="space-y-1.5 text-sm"><span>المركبة</span><select aria-label="المركبة" className={selectClass} value={filters.vehicle || ""} onChange={(e) => update("vehicle",e.target.value ? Number(e.target.value) : null)}><option value="">كل المركبات المعيّنة</option>{filters.vehicle && !options.vehicles.some(v=>v.id===filters.vehicle) ? <option value={filters.vehicle}>المركبة المحددة في الرابط</option> : null}{options.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="space-y-1.5 text-sm"><span>الموقع</span><Input className="min-h-11" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="القاعة أو المنطقة" /></label>
      </div>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="نوع المتابعة">{attentionOptions.map(([value,label])=><Button key={value} variant={(filters.attention || "all")===value ? "default" : "outline"} aria-pressed={(filters.attention || "all")===value} className="min-h-11" onClick={()=>update("attention",value)}>{label}</Button>)}</div>
    {filterProblem ? <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm">مرشحات الرابط غير صالحة: {filterProblem}. يمكنك مسح الفلاتر وإعادة اختيارها.</p> : null}
    {query.isError ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"><p className="font-semibold">تعذر تحديث غرفة العمليات</p><p className="mt-1 text-sm">{apiErrorMessage(query.error)}</p><Button className="mt-3 min-h-11" variant="outline" onClick={() => void query.refetch()}>إعادة المحاولة</Button>{query.data ? <p className="mt-2 text-sm">المعروض أدناه آخر قراءة ناجحة، وليس تأكيداً للحالة الحالية.</p> : null}</div> : null}
    {query.isLoading ? <div aria-label="تحميل العمليات" className="space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div> : query.data ? <DailyOperationsResults key={queryString} data={query.data} onAttentionChange={value=>update("attention",value)} /> : null}
  </section>;
}

export function DailyOperationsResults({ data,onAttentionChange }: { data: DailyOperations; onAttentionChange?:(value:DailyFilters["attention"])=>void }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(data.rows.length / 25));
  const currentPage = Math.min(page,pages);
  const rows = data.rows.slice((currentPage-1)*25,currentPage*25);
  return <div dir="rtl" className="space-y-4">
    {data.truncated ? <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">تغطية محدودة: تم تحميل أول 500 حجز ضمن الفترة. الأعداد والمرشحات تخص هذه الحجوزات فقط؛ اختر اليوم أو غداً لتقليل النطاق.</p> : null}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 xl:grid-cols-6">
      {([["حجوزات الفترة",data.summary.bookings,"all"],["تجهيز يحتاج متابعة",data.summary.needsPreparation,"preparation"],["تجهيز كامل بالسجل",data.summary.prepared,null],["تنفيذ ميداني",data.summary.active,null],["حجوزات تنتظر الإرجاع",data.summary.pendingReturns,"returns"],["مهام متأخرة",data.summary.overdueTasks,"tasks"]] as const).map(([label,value,attention]) => <div key={label}><dt className="text-sm text-muted-foreground">{onAttentionChange && attention ? <button type="button" className="min-h-11 text-start underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>onAttentionChange(attention)}>{label}</button> : <span className="inline-flex min-h-11 items-center">{label}</span>}</dt><dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd></div>)}
    </dl>
    {data.summary.alerts>0 ? <section className="rounded-xl border border-border bg-card p-4" aria-label="تنبيهات التشغيل"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-primary" />تنبيهات التشغيل · {data.summary.alerts}</h3>{onAttentionChange ? <Button className="min-h-11" variant="outline" onClick={()=>onAttentionChange("issues")}>عرض حجوزات التنبيهات</Button> : null}</div><ul className="grid gap-2 lg:grid-cols-2">{data.rows.flatMap(b=>b.issues.map((issue,index)=>({key:`${b.key}:${index}`,booking:b,issue}))).slice(0,6).map(({key,booking,issue})=><li key={key}><a className="block min-h-11 break-words rounded-lg bg-muted/40 p-3 text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={issue.href}><strong>{booking.customerName}</strong><span className="block mt-1">{issue.label}</span></a></li>)}</ul></section> : null}
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" /><p className="max-w-prose">فحص التعارض غير مكتمل. نسب الفحوص والتجهيز تعرض السجل الحالي، ولا تؤكد توفر المعدات أو جاهزية التنفيذ. راجع فترة الإشغال، تأكيد الفريق ومتطلبات التنفيذ من الحجز.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>من <bdi dir="ltr">{data.range.from}</bdi> حتى <bdi dir="ltr">{new Date(Date.parse(`${data.range.to}T00:00:00Z`)-86_400_000).toISOString().slice(0,10)}</bdi> · بتوقيت بغداد · {data.rows.length} حجز معروض</span><span>آخر قراءة: <bdi dir="ltr">{new Date(data.generatedAt).toLocaleString("ar-IQ-u-nu-latn",{timeZone:"Asia/Baghdad",dateStyle:"short",timeStyle:"short"})}</bdi></span></div>
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="hidden grid-cols-[1.4fr_1fr_1fr_1.4fr] gap-4 border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold lg:grid"><span>الحجز والمناسبة</span><span>التجهيز والفحوص</span><span>الفريق والنقل</span><span>المتابعة والخطوة التالية</span></div>
      {!rows.length ? <div className="px-4 py-12 text-center"><CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">لا توجد حجوزات مطابقة</h3><p className="mt-2 text-sm text-muted-foreground">جرّب فترة أخرى أو غيّر مرشحات الموظف والقسم والموقع.</p></div> : rows.map((b) => <article key={b.key} className="grid min-w-0 gap-4 border-b border-border p-4 last:border-b-0 lg:grid-cols-[1.4fr_1fr_1fr_1.4fr]" aria-label={`الحجز ${b.number}`}>
        <div className="min-w-0"><a href={b.href} className="break-words font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{b.customerName}</a><p className="mt-1 break-all font-mono text-xs text-muted-foreground"><bdi dir="ltr">{b.number}</bdi></p><p className="mt-2 text-sm"><bdi dir="ltr">{b.eventDate.slice(0,10)} {b.eventTime || ""}</bdi>{!b.eventTime ? " · الوقت غير محدد" : ""}</p><p className="mt-1 break-words text-sm text-muted-foreground">{b.location || "الموقع غير مسجل"} · {labels[b.category] || b.category}</p><span className="mt-2 inline-block rounded-full bg-muted px-2.5 py-1 text-xs">{labels[b.stage] || b.stage}</span></div>
        <div className="text-sm"><p className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" />تجهيز مسجّل: {b.preparation.percentage == null ? "غير مُراجع" : `${b.preparation.percentage}%`}</p><p className="mt-1 text-muted-foreground">{b.preparation.prepared} من {b.preparation.total} عناصر</p><p className="mt-3 font-medium">اكتمال الفحوص: {b.readiness.percentage}%</p><p className="mt-1 text-amber-800 dark:text-amber-300">{b.readiness.status === "not_ready" ? "متطلبات غير مكتملة" : "بحاجة مراجعة"}</p><details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">عرض الفحوص</summary><ul className="space-y-2">{b.readiness.checks.map((c) => <li key={c.id}><a href={c.href} className="inline-block py-1 underline underline-offset-4">{c.label}: {c.state === "pass" ? "مسجّل" : c.state === "fail" ? "غير مكتمل" : "بحاجة مراجعة"}</a><p className="text-muted-foreground">{c.reason}</p></li>)}</ul></details></div>
        <div className="min-w-0 space-y-3 text-sm"><p className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-words">{[b.crewName,...b.staff.map((s) => s.name)].filter(Boolean).join("، ") || "الفريق غير معيّن"}</span></p><p className="flex items-start gap-2"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span>{b.vehicleName || "لا توجد مركبة معيّنة"}</span></p>{b.pendingReturn > 0 || b.returnEvidenceIncomplete ? <a className="inline-block py-1 text-primary underline" href={`${b.href}?tab=assets`}>{b.returnEvidenceIncomplete ? "سجل الإرجاع يحتاج مطابقة" : `${b.pendingReturn} وحدات بانتظار الإرجاع`}</a> : null}</div>
        <div className="min-w-0 text-sm">{b.issues.length ? <ul className="mb-3 space-y-2">{b.issues.map((issue,index) => <li key={`${issue.kind}:${index}`}><a className="inline-flex items-start gap-1.5 text-destructive underline-offset-4 hover:underline" href={issue.href}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{issue.label}</a></li>)}</ul> : <p className="mb-3 flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0" />لا توجد نواقص مؤكدة بالسجل؛ تبقى فحوص للمراجعة.</p>}<a href={b.nextAction.href} className="block break-words py-2 text-primary underline underline-offset-4">{b.nextAction.label}</a><Button asChild variant="outline" className="mt-2 min-h-11 w-full gap-2"><a href={b.href}>فتح الحجز الأصلي<ArrowLeft className="h-4 w-4" /></a></Button></div>
      </article>)}
    </div>
    {pages > 1 ? <nav className="flex items-center justify-between gap-2" aria-label="صفحات الحجوزات"><Button className="min-h-11" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((n) => Math.max(1,n-1))}>السابق</Button><span className="text-sm" aria-live="polite">صفحة {currentPage} من {pages}</span><Button className="min-h-11" variant="outline" disabled={currentPage >= pages} onClick={() => setPage((n) => Math.min(pages,n+1))}>التالي</Button></nav> : null}
  </div>;
}
