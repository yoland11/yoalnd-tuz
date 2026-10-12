import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ClipboardList,
  ExternalLink,
  FilterX,
  LayoutGrid,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Table2,
  UserX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/employee-select";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { useToast } from "@/hooks/use-toast";
import {
  PRODUCTION_KINDS,
  PRODUCTION_STATUSES,
  PRODUCTION_STATUS_LABELS,
  PRODUCTION_TABS,
  PRODUCTION_KIND_LABELS,
  allowedTransitions,
  isOverdue,
  type ProductionKind,
  type ProductionProgress,
  type ProductionStatus,
} from "@/lib/photography-production";
import { adminFetch } from "./_lib";
import {
  KindBadge,
  PRODUCTION_API,
  PRODUCTION_QUERY_KEY,
  ProductionItemDialog,
  ProductionOrderDialog,
  ProgressBar,
  STATUS_TONES,
  StatusBadge,
  errorText,
  readableDay,
  shortDay,
  useProductionStaff,
  useUpdateProductionItem,
  type ProductionBookingRef,
  type ProductionItem,
  type ProductionPermissions,
} from "./photography-production-shared";

/**
 * مركز إنتاج التصوير — manager view of every production work item.
 * Filters, counts and pagination are computed on the server; status moves are
 * validated there too (the board only offers the moves the server accepts).
 */

type Summary = {
  bookings: { total: number; complete: number; incomplete: number };
  items: { total: number; remaining: number; inProgress: number; waitingFiles: number; completed: number; overdue: number; dueToday: number; unassigned: number };
};

type ListMeta = { summary: Summary; page: number; pageSize: number; total: number; today: string; scope: "mine" | "all"; permissions: ProductionPermissions; meId: number };
type BoardResponse = ListMeta & { items: Array<ProductionItem & { booking: ProductionBookingRef }> };
type BookingRow = {
  booking: ProductionBookingRef;
  items: Array<Pick<ProductionItem, "id" | "kind" | "status" | "dueDate" | "assigneeStaffId" | "assigneeName">>;
  nextDue: string | null;
  assignees: string[];
  progress: ProductionProgress;
};
type TableResponse = ListMeta & { rows: BookingRow[] };

type Filters = {
  q: string;
  assignee: string;
  status: string;
  completion: string;
  quick: string;
  eventFrom: string;
  eventTo: string;
  dueFrom: string;
  dueTo: string;
  mine: boolean;
  booking: string;
};

const EMPTY_FILTERS: Filters = { q: "", assignee: "", status: "", completion: "", quick: "", eventFrom: "", eventTo: "", dueFrom: "", dueTo: "", mine: false, booking: "" };

const QUICK_FILTERS: Array<{ key: string; label: string; icon: typeof AlertTriangle }> = [
  { key: "overdue", label: "المتأخرة", icon: AlertTriangle },
  { key: "due_today", label: "تسليم اليوم", icon: CalendarClock },
  { key: "waiting_files", label: "بانتظار الملفات", icon: Loader2 },
  { key: "unassigned", label: "غير مسندة", icon: UserX },
];

function readInitial() {
  if (typeof window === "undefined") return { tab: "all", view: "board" as const, filters: EMPTY_FILTERS };
  const params = new URLSearchParams(window.location.search);
  const tab = PRODUCTION_TABS.some((entry) => entry.key === params.get("tab")) ? String(params.get("tab")) : "all";
  const view = params.get("view") === "table" ? ("table" as const) : ("board" as const);
  return { tab, view, filters: { ...EMPTY_FILTERS, booking: /^\d+$/.test(params.get("booking") ?? "") ? String(params.get("booking")) : "", q: params.get("q") ?? "" } };
}

function SummaryCard({ label, value, tone = "", active, onClick }: { label: string; value: number; tone?: string; active?: boolean; onClick?: () => void }) {
  const body = <><div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{label}</div></>;
  return onClick ? (
    <Button type="button" variant="ghost" size="flush" onClick={onClick} aria-pressed={active} className={`h-auto whitespace-normal font-normal leading-normal max-md:min-h-0 block w-full rounded-xl border bg-card p-3 text-start transition hover:bg-card hover:border-primary/40 ${active ? "border-primary ring-1 ring-primary/30" : "border-border/50"}`}>{body}</Button>
  ) : <div className="rounded-xl border border-border/50 bg-card p-3">{body}</div>;
}

export default function PhotographyProductionPage() {
  const initial = useMemo(readInitial, []);
  const [tab, setTab] = useState(initial.tab);
  const [view, setView] = useState<"board" | "table">(initial.view);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [search, setSearch] = useState(initial.filters.q);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ProductionItem | null>(null);
  const [orderBooking, setOrderBooking] = useState<number | null>(null);
  const [showDates, setShowDates] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search.trim() ? current : { ...current, q: search.trim() })), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [tab, view, filters]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string) => (value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    set("tab", tab === "all" ? "" : tab);
    set("view", view === "board" ? "" : view);
    set("booking", filters.booking);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [tab, view, filters.booking]);

  const params = useMemo(() => {
    const query = new URLSearchParams({ tab, page: String(page) });
    if (filters.q) query.set("q", filters.q);
    if (filters.assignee) query.set("assignee", filters.assignee);
    if (filters.status) query.set("status", filters.status);
    if (filters.completion) query.set("completion", filters.completion);
    if (filters.quick) query.set("quick", filters.quick);
    if (filters.eventFrom) query.set("eventFrom", filters.eventFrom);
    if (filters.eventTo) query.set("eventTo", filters.eventTo);
    if (filters.dueFrom) query.set("dueFrom", filters.dueFrom);
    if (filters.dueTo) query.set("dueTo", filters.dueTo);
    if (filters.mine) query.set("mine", "1");
    if (filters.booking) query.set("booking", filters.booking);
    return query.toString();
  }, [tab, page, filters]);

  const list = useQuery<BoardResponse | TableResponse>({
    queryKey: [...PRODUCTION_QUERY_KEY, view, params],
    queryFn: () => adminFetch(`${PRODUCTION_API}/${view === "board" ? "board" : "bookings"}?${params}`),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const permissions = data?.permissions ?? { canManage: false, canOrder: false, canViewAll: false };
  const staff = useProductionStaff(permissions.canOrder);
  const today = data?.today ?? "";
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "q" && Boolean(value)).length + (filters.q ? 1 : 0);
  const patch = (next: Partial<Filters>) => setFilters((current) => ({ ...current, ...next }));
  const employees = (staff.data?.staff ?? []).map((employee) => ({ ...employee, fullName: employee.name }));
  const datesActive = Boolean(filters.eventFrom || filters.eventTo || filters.dueFrom || filters.dueTo);

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Clapperboard className="h-5 w-5" /></span>
          <div>
            <h1 className="text-xl font-bold">مركز إنتاج التصوير</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">متابعة الفيديو والصور والألبومات والطباعة لكل حجز تصوير — مرتبط بمركز الحجوزات ولا يؤثر على الحسابات.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => list.refetch()} disabled={list.isFetching}><RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} /> تحديث</Button>
          <Button variant="outline" size="sm" asChild><Link href="/admin/bookings"><ExternalLink className="h-4 w-4" /> مركز الحجوزات</Link></Button>
        </div>
      </header>

      {list.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{errorText(list.error)}</span>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>إعادة المحاولة</Button>
        </div>
      ) : null}

      {data ? (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" aria-label="ملخص الإنتاج">
          <div className="rounded-2xl border bg-muted/20 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold"><ClipboardList className="h-4 w-4" /> الحجوزات</h2>
            <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
              <SummaryCard label="في الإنتاج" value={data.summary.bookings.total} />
              <SummaryCard label="الإنتاج مكتمل" value={data.summary.bookings.complete} tone="text-emerald-600" active={filters.completion === "complete"} onClick={() => patch({ completion: filters.completion === "complete" ? "" : "complete" })} />
              <SummaryCard label="غير مكتمل" value={data.summary.bookings.incomplete} tone="text-amber-600" active={filters.completion === "incomplete"} onClick={() => patch({ completion: filters.completion === "incomplete" ? "" : "incomplete" })} />
            </div>
          </div>
          <div className="rounded-2xl border bg-muted/20 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold"><ListChecks className="h-4 w-4" /> الأعمال</h2>
            <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 sm:grid-cols-[repeat(6,minmax(0,1fr))]">
              <SummaryCard label="الإجمالي" value={data.summary.items.total} active={!filters.status && !filters.quick} onClick={() => patch({ status: "", quick: "" })} />
              <SummaryCard label="مكتملة" value={data.summary.items.completed} tone="text-emerald-600" active={filters.status === "completed"} onClick={() => patch({ status: filters.status === "completed" ? "" : "completed", quick: "" })} />
              <SummaryCard label="قيد العمل" value={data.summary.items.inProgress} tone="text-sky-600" active={filters.status === "in_progress"} onClick={() => patch({ status: filters.status === "in_progress" ? "" : "in_progress", quick: "" })} />
              <SummaryCard label="متبقية" value={data.summary.items.remaining} active={filters.status === "remaining"} onClick={() => patch({ status: filters.status === "remaining" ? "" : "remaining", quick: "" })} />
              <SummaryCard label="بانتظار الملفات" value={data.summary.items.waitingFiles} tone="text-amber-600" active={filters.status === "waiting_files"} onClick={() => patch({ status: filters.status === "waiting_files" ? "" : "waiting_files", quick: "" })} />
              <SummaryCard label="متأخرة" value={data.summary.items.overdue} tone="text-rose-600" active={filters.quick === "overdue"} onClick={() => patch({ quick: filters.quick === "overdue" ? "" : "overdue", status: "" })} />
            </div>
          </div>
        </section>
      ) : list.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-3"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl lg:col-span-2" /></div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={setTab} dir="rtl">
          <TabsList className="h-auto flex-wrap">
            {PRODUCTION_TABS.map((entry) => <TabsTrigger key={entry.key} value={entry.key}>{entry.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="طريقة العرض">
          <Button size="sm" variant={view === "board" ? "secondary" : "ghost"} onClick={() => setView("board")} aria-pressed={view === "board"}><LayoutGrid className="h-4 w-4" /> كانبان</Button>
          <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")} aria-pressed={view === "table"}><Table2 className="h-4 w-4" /> جدول</Button>
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border bg-card p-3" aria-label="البحث والفلاتر">
        <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الحجز أو اسم الزبون أو الهاتف" className="ps-9" aria-label="بحث" />
          </div>
          {permissions.canViewAll ? (
            <EmployeeSelect employees={employees} value={filters.assignee === "unassigned" ? "" : filters.assignee} onValueChange={(value) => patch({ assignee: value })} emptyLabel="كل الموظفين" placeholder={staff.isLoading ? "جارٍ التحميل..." : "الموظف"} aria-label="فلترة حسب الموظف" />
          ) : <div className="flex items-center rounded-md border px-3 text-sm text-muted-foreground">أعمالي فقط</div>}
          <Select value={filters.status || "all"} onValueChange={(value) => patch({ status: value === "all" ? "" : value, quick: "" })} dir="rtl">
            <SelectTrigger aria-label="الحالة"><SelectValue placeholder="الحالة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {PRODUCTION_STATUSES.map((status) => <SelectItem key={status} value={status}>{PRODUCTION_STATUS_LABELS[status]}</SelectItem>)}
              <SelectItem value="overdue">متأخر</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.completion || "all"} onValueChange={(value) => patch({ completion: value === "all" ? "" : value })} dir="rtl">
            <SelectTrigger aria-label="اكتمال الحجز"><SelectValue placeholder="اكتمال الحجز" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحجوزات</SelectItem>
              <SelectItem value="incomplete">الإنتاج غير مكتمل</SelectItem>
              <SelectItem value="complete">الإنتاج مكتمل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showDates ? <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          <div className="space-y-1"><Label className="text-xs" htmlFor="event-from">المناسبة من</Label><Input id="event-from" type="date" value={filters.eventFrom} onChange={(event) => patch({ eventFrom: event.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="event-to">المناسبة إلى</Label><Input id="event-to" type="date" value={filters.eventTo} onChange={(event) => patch({ eventTo: event.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="due-from">التسليم من</Label><Input id="due-from" type="date" value={filters.dueFrom} onChange={(event) => patch({ dueFrom: event.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="due-to">التسليم إلى</Label><Input id="due-to" type="date" value={filters.dueTo} onChange={(event) => patch({ dueTo: event.target.value })} /></div>
        </div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={showDates || datesActive ? "secondary" : "outline"} className="rounded-full" aria-expanded={showDates} onClick={() => setShowDates((value) => !value)}><CalendarClock className="h-3.5 w-3.5" /> التواريخ{datesActive ? " •" : ""}</Button>
          {QUICK_FILTERS.filter(({ key }) => permissions.canViewAll || key !== "unassigned").map(({ key, label, icon: Icon }) => (
            <Button key={key} size="sm" variant={filters.quick === key ? "default" : "outline"} className="rounded-full" aria-pressed={filters.quick === key} onClick={() => patch({ quick: filters.quick === key ? "" : key, status: "" })}><Icon className="h-3.5 w-3.5" /> {label}</Button>
          ))}
          {permissions.canViewAll ? (
            <Button size="sm" variant={filters.mine ? "default" : "outline"} className="rounded-full" aria-pressed={filters.mine} onClick={() => patch({ mine: !filters.mine })}>أعمالي</Button>
          ) : null}
          {filters.booking ? (
            <Badge variant="secondary" className="gap-1 rounded-full py-1">حجز رقم {filters.booking}<Button type="button" variant="ghost" size="flush" className="h-auto rounded-full max-md:min-h-0 [&_svg]:size-3.5" aria-label="إزالة فلتر الحجز" onClick={() => patch({ booking: "" })}><X /></Button></Badge>
          ) : null}
          {activeFilterCount ? (
            <Button size="sm" variant="ghost" onClick={() => { setFilters(EMPTY_FILTERS); setSearch(""); }}><FilterX className="h-4 w-4" /> مسح الفلاتر ({activeFilterCount})</Button>
          ) : null}
        </div>
      </section>

      {list.isLoading && !data ? (
        <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}</div>
      ) : data && view === "board" && "items" in data ? (
        <Board data={data} onOpen={setSelected} />
      ) : data && view === "table" && "rows" in data ? (
        <BookingTable data={data} onOpen={setSelected} onOrder={setOrderBooking} onFilterBooking={(id) => patch({ booking: String(id) })} />
      ) : null}

      {data && data.total > data.pageSize ? (
        <nav className="flex items-center justify-center gap-3" aria-label="الصفحات">
          <Button size="sm" variant="outline" disabled={page <= 1 || list.isFetching} onClick={() => setPage((value) => value - 1)}><ChevronRight className="h-4 w-4" /> السابق</Button>
          <span className="text-sm tabular-nums">صفحة {page} من {pages} · {data.total} {view === "board" ? "عمل" : "حجز"}</span>
          <Button size="sm" variant="outline" disabled={page >= pages || list.isFetching} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft className="h-4 w-4" /></Button>
        </nav>
      ) : null}

      <ProductionItemDialog item={selected} today={today} permissions={permissions} meId={data?.meId ?? null} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} />
      {orderBooking ? <ProductionOrderDialog bookingId={orderBooking} open={Boolean(orderBooking)} onOpenChange={(open) => !open && setOrderBooking(null)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ board

function Board({ data, onOpen }: { data: BoardResponse; onOpen: (item: ProductionItem) => void }) {
  const { toast } = useToast();
  const update = useUpdateProductionItem();
  const [dragging, setDragging] = useState<ProductionItem | null>(null);
  const [over, setOver] = useState<ProductionStatus | null>(null);
  const grouped = useMemo(() => {
    const map = new Map<ProductionStatus, BoardResponse["items"]>(PRODUCTION_STATUSES.map((status) => [status, []]));
    for (const item of data.items) map.get(item.status)?.push(item);
    return map;
  }, [data.items]);
  const canMove = (item: ProductionItem) => data.permissions.canManage || item.assigneeStaffId === data.meId;
  const move = (item: ProductionItem, to: ProductionStatus) => {
    if (item.status === to) return;
    if (!canMove(item)) return toast({ title: "لا يمكنك تغيير حالة عمل غير مسند إليك", variant: "destructive" });
    if (item.status === "completed") return onOpen(item); // reopening needs a written reason
    if (!allowedTransitions(item.status).includes(to))
      return toast({ title: `لا يمكن النقل من «${PRODUCTION_STATUS_LABELS[item.status]}» إلى «${PRODUCTION_STATUS_LABELS[to]}»`, variant: "destructive" });
    update.mutate({ id: item.id, patch: { status: to, expectedStatus: item.status } });
  };

  if (!data.items.length)
    return <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">لا توجد أعمال إنتاج مطابقة للفلاتر الحالية.</div>;
  return (
    <div className="-mx-4 snap-x overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
      <div className="grid auto-cols-[82vw] grid-flow-col gap-3 sm:auto-cols-[340px] lg:grid-flow-row lg:grid-cols-[repeat(4,minmax(0,1fr))]">
        {PRODUCTION_STATUSES.map((status) => {
          const items = grouped.get(status) ?? [];
          return (
            <section
              key={status}
              aria-label={PRODUCTION_STATUS_LABELS[status]}
              onDragOver={(event) => { if (dragging) { event.preventDefault(); setOver(status); } }}
              onDragLeave={() => setOver((current) => (current === status ? null : current))}
              onDrop={(event) => { event.preventDefault(); setOver(null); if (dragging) move(dragging, status); setDragging(null); }}
              className={`flex min-h-64 snap-start flex-col rounded-2xl border bg-muted/20 p-2 transition ${over === status ? "border-primary bg-primary/5" : ""}`}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <Badge variant="outline" className={STATUS_TONES[status]}>{PRODUCTION_STATUS_LABELS[status]}</Badge>
                <span className="text-xs font-bold tabular-nums text-muted-foreground">{items.length}</span>
              </header>
              <div className="space-y-2">
                {items.map((item) => (
                  <article
                    key={item.id}
                    draggable={canMove(item)}
                    onDragStart={() => setDragging(item)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={`rounded-xl border bg-card p-3 shadow-sm ${isOverdue(item, data.today) ? "border-rose-300 dark:border-rose-900" : ""} ${canMove(item) ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <Button type="button" variant="ghost" size="flush" className="h-auto whitespace-normal font-normal leading-normal max-md:min-h-0 block w-full space-y-2 text-start hover:bg-transparent [&_svg]:size-3.5" onClick={() => onOpen(item)}>
                      <div className="flex items-center justify-between gap-2">
                        <KindBadge kind={item.kind} />
                        <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">{item.booking.number}</span>
                      </div>
                      <div className="text-sm font-bold leading-snug">{item.booking.customerName || "زبون"}</div>
                      <div className="text-xs text-muted-foreground">{item.booking.eventType || "تصوير"} · {readableDay(item.booking.eventDate)}</div>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs">
                        {item.assigneeName ? <EmployeeAvatar name={item.assigneeName} photoUrl={item.assigneePhotoUrl ?? null} size={32} /> : <UserX className="h-4 w-4 text-muted-foreground" />}
                        <span className="truncate">{item.assigneeName || "غير مسند"}</span>
                      </div>
                      <div className={`flex items-center gap-1 text-xs ${isOverdue(item, data.today) ? "font-bold text-rose-600" : "text-muted-foreground"}`}><CalendarClock className="h-3.5 w-3.5" />التسليم: {item.dueDate ? readableDay(item.dueDate) : "بدون موعد"}</div>
                      {isOverdue(item, data.today) ? <StatusBadge status={item.status} dueDate={item.dueDate} today={data.today} /> : null}
                    </Button>
                    {canMove(item) ? (
                      <Select
                        value={item.status}
                        onValueChange={(value) => move(item, value as ProductionStatus)}
                        disabled={update.isPending}
                        dir="rtl"
                      >
                        <SelectTrigger className="mt-2 h-8 text-xs" aria-label="تغيير الحالة"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={item.status}>{PRODUCTION_STATUS_LABELS[item.status]}</SelectItem>
                          {(item.status === "completed" ? (data.permissions.canManage ? (["in_progress"] as ProductionStatus[]) : []) : allowedTransitions(item.status)).map((to) => (
                            <SelectItem key={to} value={to}>{item.status === "completed" ? "إعادة فتح…" : PRODUCTION_STATUS_LABELS[to]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ table

function KindCell({ row, kind, today, onOpen }: { row: BookingRow; kind: ProductionKind; today: string; onOpen: (item: ProductionItem) => void }) {
  const item = row.items.find((entry) => entry.kind === kind);
  if (!item) return <span className="text-muted-foreground">-</span>;
  return (
    <Button type="button" variant="ghost" size="flush" className="h-auto rounded-md font-normal max-md:min-h-0 [&_svg]:size-3" onClick={() => onOpen({ ...item, bookingId: row.booking.id, booking: row.booking })} aria-label={`${PRODUCTION_KIND_LABELS[kind]}: ${PRODUCTION_STATUS_LABELS[item.status]}`}>
      <StatusBadge status={item.status} dueDate={item.dueDate} today={today} stacked />
    </Button>
  );
}

function BookingTable({ data, onOpen, onOrder, onFilterBooking }: { data: TableResponse; onOpen: (item: ProductionItem) => void; onOrder: (bookingId: number) => void; onFilterBooking: (bookingId: number) => void }) {
  if (!data.rows.length)
    return <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">لا توجد حجوزات مطابقة للفلاتر الحالية.</div>;
  const remainingText = (row: BookingRow) => (row.progress.remainingKinds.length ? row.progress.remainingKinds.map((kind) => PRODUCTION_KIND_LABELS[kind]).join("، ") : "لا شيء");
  const actions = (row: BookingRow) => (
    <div className="flex gap-0.5">
      {data.permissions.canViewAll ? <Button size="icon" variant="ghost" className="h-8 w-8" asChild><Link href={`/admin/bookings/service/${row.booking.id}`} aria-label="تفاصيل الحجز" title="تفاصيل الحجز"><ExternalLink className="h-4 w-4" /></Link></Button> : null}
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="عرض أعمال الحجز" title="عرض أعمال الحجز" onClick={() => onFilterBooking(row.booking.id)}><ListChecks className="h-4 w-4" /></Button>
      {data.permissions.canOrder && row.items.length < PRODUCTION_KINDS.length ? <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="إضافة عمل إنتاج" title="إضافة عمل إنتاج" onClick={() => onOrder(row.booking.id)}><Send className="h-4 w-4" /></Button> : null}
    </div>
  );
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border lg:block">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-bold">
              <th>رقم الحجز</th><th>الزبون</th><th>المناسبة</th><th>الموظف</th>
              <th>فيديو</th><th>صور</th><th>ألبوم</th><th>طباعة</th>
              <th>الإنجاز</th><th>المتبقي</th><th>التسليم</th><th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.booking.id} className="border-t align-middle [&>td]:px-2 [&>td]:py-2">
                <td className="whitespace-nowrap font-mono" dir="ltr">{row.booking.number}</td>
                <td className="min-w-24"><div className="text-sm font-bold">{row.booking.customerName || "—"}</div><div className="text-muted-foreground" dir="ltr">{row.booking.phone}</div></td>
                <td className="whitespace-nowrap"><div>{row.booking.eventType || "تصوير"}</div><div className="text-muted-foreground">{readableDay(row.booking.eventDate)}</div></td>
                <td className="min-w-24 max-w-36">{row.assignees.length ? row.assignees.join("، ") : <span className="text-muted-foreground">غير مسند</span>}</td>
                {PRODUCTION_KINDS.map((kind) => <td key={kind}><KindCell row={row} kind={kind} today={data.today} onOpen={onOpen} /></td>)}
                <td><ProgressBar percent={row.progress.percent} complete={row.progress.complete} /><div className="mt-1 text-[11px] text-muted-foreground">{row.progress.label}</div></td>
                <td className="max-w-24">{remainingText(row)}</td>
                <td className={`whitespace-nowrap ${row.nextDue && row.nextDue < data.today ? "font-bold text-rose-600" : ""}`}>{row.nextDue ? shortDay(row.nextDue) : row.progress.complete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : "—"}</td>
                <td>{actions(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {data.rows.map((row) => (
          <article key={row.booking.id} className="space-y-3 rounded-2xl border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold">{row.booking.customerName || "—"}</div>
                <div className="text-xs text-muted-foreground"><span className="font-mono" dir="ltr">{row.booking.number}</span> · {row.booking.eventType || "تصوير"} · {readableDay(row.booking.eventDate)}</div>
              </div>
              <Badge variant="outline" className={row.progress.complete ? STATUS_TONES.completed : STATUS_TONES.in_progress}>{row.progress.label}</Badge>
            </div>
            <ProgressBar percent={row.progress.percent} complete={row.progress.complete} />
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 text-xs">
              {PRODUCTION_KINDS.map((kind) => (
                <div key={kind} className="flex items-center justify-between gap-1 rounded-lg bg-muted/30 p-2">
                  <span className="font-bold">{PRODUCTION_KIND_LABELS[kind]}</span>
                  <KindCell row={row} kind={kind} today={data.today} onOpen={onOpen} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>الموظف: {row.assignees.join("، ") || "غير مسند"}</span>
              <span className={row.nextDue && row.nextDue < data.today ? "font-bold text-rose-600" : ""}>التسليم: {readableDay(row.nextDue)}</span>
            </div>
            <div className="text-xs">المتبقي: {remainingText(row)}</div>
            {actions(row)}
          </article>
        ))}
      </div>
    </>
  );
}
