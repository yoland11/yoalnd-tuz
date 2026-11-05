import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, CalendarCheck, Clock3, Copy, Download, ExternalLink, Fingerprint, Loader2, LogOut, MapPin, Pencil, Plus, Printer, QrCode, RefreshCw, Search, Settings2, SlidersHorizontal, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceSettingsPanel } from "@/components/attendance-settings-panel";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { useToast } from "@/hooks/use-toast";
import { ATTENDANCE_METHODS, ATTENDANCE_METHOD_LABELS, CORRECTION_TYPES, DAY_LABELS, DAY_STATUS_LABELS, LOCATION_KIND_LABELS, SHIFT_KIND_LABELS, addDays, baghdadDate, baghdadTime } from "@/lib/attendance-rules";
import { adminFetch, apiErrorMessage } from "./_lib";
import { exportReport, type ReportColumn } from "@/lib/pdf-report";
import { attendanceTimestamp } from "@/lib/attendance-client";

type Capabilities = { canManage: boolean; canApprove: boolean; canManagePolicy: boolean; canViewLocation: boolean };
type LocationRow = { id: number; name: string; kind: string; address: string | null; latitude: number | null; longitude: number | null; radiusMeters: number; maxAccuracyMeters: number; requiredMethod: string; warehouseId: number | null; warehouseName: string | null; isActive: boolean };
type StaffOption = { id: number; fullName: string; department: string | null };
type Policy = Record<string, any>;
type Options = { locations: LocationRow[]; staff: StaffOption[]; capabilities: Capabilities; policy: Policy };
type DashboardRow = { staffId: number; name: string; department: string | null; photoUrl?: string | null; locationName: string | null; shiftStartMs: number | null; shiftEndMs: number | null; checkInMs: number | null; checkOutMs: number | null; workedMinutes: number; method: string | null; status: string; statusLabel: string; isLate: boolean; missingCheckOut: boolean; bookingSource: string | null; bookingId: number | null };
type Dashboard = { date: string; serverTime?: number; summary: { total: number; presentNow: number; late: number; absent: number; out: number; mission: number; onLeave: number; scheduled: number }; rows: DashboardRow[]; departments: string[]; locations: Array<{ id: number; name: string }> };
type RecordRow = { id: number; name: string; department: string | null; checkInMs: number | null; checkOutMs: number | null; status: string; method: string | null; workedMinutes: number; overtimeApprovedMinutes: number | null; locationName: string | null; shiftTitle: string | null; bookingSource: string | null; bookingId: number | null; evidence?: Array<{ event: string; method: string; distance: number | null; accuracy: number | null }> };
type ShiftRow = { shiftId: number; staffId: number; staffName: string | null; date: string; startMs: number; endMs: number; kind: string; title: string | null; locationName: string | null; requiredMethod: string | null; bookingSource: string | null; bookingId: number | null; payAmount: number | null };
type Kiosk = { id: number; name: string; locationName: string; isActive: boolean; lastSeenAt: string | null };
type Correction = { id: number; name: string; department: string | null; workDate: string; requestType: string; checkInMs: number | null; checkOutMs: number | null; reason: string; status: string; reviewedByName: string; reviewNote: string | null; hasAttachment: boolean };
type ReportRow = { staffId: number; name: string; department: string | null; scheduledDays: number; presentDays: number; absentDays: number; paidLeaveDays: number; unpaidLeaveDays: number; workedHours: number; lateArrivals: number; lateMinutes: number; earlyLeaveMinutes: number; overtimeHours: number; missingCheckOut: number; eventShifts: number; eventAttended: number; proposedDeductions: number };

const number = (value: number) => Number(value ?? 0).toLocaleString("ar-IQ-u-nu-latn", { maximumFractionDigits: 2 });
const hours = (minutes: number) => `${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`;
const control = "h-10 min-w-0 rounded-lg border border-border bg-background px-2 text-sm";
const th = "whitespace-nowrap border-b border-border/60 bg-muted/40 p-2.5 text-xs font-semibold text-muted-foreground";
const td = "border-b border-border/30 p-2.5 align-middle";
const STATUS_TONE: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  late: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  absent: "bg-destructive/10 text-destructive",
  out: "bg-muted text-foreground",
  mission: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  leave: "bg-violet-500/10 text-violet-800 dark:text-violet-300",
};
const CORRECTION_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "بانتظار الموافقة", cls: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  approved: { label: "تمت الموافقة", cls: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  rejected: { label: "مرفوض", cls: "bg-destructive/10 text-destructive" },
};
const methodLabel = (value: string | null) => (value ? (ATTENDANCE_METHOD_LABELS as Record<string, string>)[value] ?? (value === "self" ? "تسجيل مباشر" : value) : "—");

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{apiErrorMessage(error, "تعذّر تحميل البيانات")} <Button type="button" variant="outline" size="sm" className="ms-2" onClick={retry}>إعادة المحاولة</Button></div>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</p>;
}
function TableShell({ children, wide = 760 }: { children: ReactNode; wide?: number }) {
  return <div className="overflow-x-auto rounded-xl border border-[#f4d6da] bg-card dark:border-border"><table style={{ minWidth: wide }} className="w-full text-right text-sm">{children}</table></div>;
}
function Stat({ label, value, note, icon: Icon, tone = "text-primary" }: { label: string; value: number; note?: string; icon: typeof Users; tone?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[#f4d6da] bg-card p-3.5 dark:border-border">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden /><span className="min-w-0 leading-tight">{label}</span></div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{number(value)}</p>
      {note ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function DashboardTab({ options, onSettings }: { options: Options; onSettings: (staffId: number, name: string) => void }) {
  const [filters, setFilters] = useState({ date: baghdadDate(), search: "", department: "", locationId: "", status: "", method: "" });
  const [expandedFilters, setExpandedFilters] = useState(false);
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const dashboard = useQuery<Dashboard>({ queryKey: ["admin", "attendance", "dashboard", params.toString()], queryFn: () => adminFetch(`/admin/attendance/dashboard?${params}`), refetchInterval: 60_000 });
  const set = (patch: Partial<typeof filters>) => setFilters((current) => ({ ...current, ...patch }));
  const summary = dashboard.data?.summary;
  return (
    <div className="space-y-4">
      {dashboard.isError ? <Failed error={dashboard.error} retry={() => void dashboard.refetch()} /> : summary ? (
        <div className="grid gap-3 [grid-template-columns:repeat(2,minmax(0,1fr))] lg:[grid-template-columns:repeat(6,minmax(0,1fr))]">
          <Stat icon={Users} label="إجمالي الموظفين" value={summary.total} note={`مجدول اليوم ${number(summary.scheduled)}`} />
          <Stat icon={UserCheck} label="الحاضرون الآن" value={summary.presentNow} tone="text-emerald-600" />
          <Stat icon={Clock3} label="المتأخرون" value={summary.late} tone="text-amber-600" />
          <Stat icon={UserX} label="الغائبون" value={summary.absent} tone="text-destructive" note="من لديهم وردية بدأت فقط" />
          <Stat icon={LogOut} label="المنصرفون" value={summary.out} />
          <Stat icon={Briefcase} label="في مهمة خارجية" value={summary.mission} tone="text-sky-600" />
        </div>
      ) : <div className="grid gap-3 [grid-template-columns:repeat(2,minmax(0,1fr))] lg:[grid-template-columns:repeat(6,minmax(0,1fr))]">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div>}
      <div className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">التاريخ<Input type="date" className="w-40" value={filters.date} onChange={(event) => set({ date: event.target.value })} /></label>
        <Button type="button" variant={filters.date === baghdadDate() ? "secondary" : "ghost"} className="min-h-10" onClick={() => set({ date: baghdadDate() })}>اليوم</Button>
        <Button type="button" variant={filters.date === addDays(baghdadDate(), -1) ? "secondary" : "ghost"} className="min-h-10" onClick={() => set({ date: addDays(baghdadDate(), -1) })}>أمس</Button>
        <div className="relative min-w-40 flex-1 basis-60"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden /><Input type="search" aria-label="ابحث عن موظف" placeholder="ابحث باسم الموظف…" className="ps-9" value={filters.search} onChange={(event) => set({ search: event.target.value })} /></div>
        <select aria-label="الحالة" className={`${control} min-h-10`} value={filters.status} onChange={(event) => set({ status: event.target.value })}><option value="">كل الحالات</option>{Object.entries(DAY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <Button type="button" variant="outline" className="min-h-10" aria-expanded={expandedFilters} aria-controls="attendance-daily-filters" onClick={() => setExpandedFilters(current => !current)}><SlidersHorizontal className="h-4 w-4" aria-hidden />تصفية إضافية{[filters.department, filters.locationId, filters.method].filter(Boolean).length ? <span className="rounded-full bg-primary/10 px-1.5 text-primary">{[filters.department, filters.locationId, filters.method].filter(Boolean).length}</span> : null}</Button>
        <Button type="button" variant="ghost" className="min-h-10" aria-label="تحديث الحضور" disabled={dashboard.isFetching} onClick={() => void dashboard.refetch()}><RefreshCw className={`h-4 w-4 ${dashboard.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />تحديث</Button>
      </div>
      {expandedFilters ? <div id="attendance-daily-filters" className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select aria-label="القسم" className={control} value={filters.department} onChange={(event) => set({ department: event.target.value })}><option value="">كل الأقسام</option>{(dashboard.data?.departments ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="موقع العمل" className={control} value={filters.locationId} onChange={(event) => set({ locationId: event.target.value })}><option value="">كل المواقع</option>{(dashboard.data?.locations ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select aria-label="طريقة التحقق" className={control} value={filters.method} onChange={(event) => set({ method: event.target.value })}><option value="">كل الطرق</option>{ATTENDANCE_METHODS.filter((value) => value !== "any").map((value) => <option key={value} value={value}>{ATTENDANCE_METHOD_LABELS[value]}</option>)}</select>
        <Button type="button" variant="link" onClick={() => set({ department: "", locationId: "", method: "", status: "", search: "" })}>مسح التصفية</Button>
      </div> : null}
      {dashboard.data && !dashboard.isError ? <p className="text-xs text-muted-foreground">{number(dashboard.data.rows.length)} موظف في العرض{dashboard.data.serverTime != null ? ` · آخر تحديث ${baghdadTime(dashboard.data.serverTime)} بتوقيت بغداد` : ""}</p> : null}
      </div>
      {dashboard.isPending ? <Skeleton className="h-48 w-full" /> : dashboard.isError ? null : !dashboard.data.rows.length ? <Empty>لا يوجد موظفون يطابقون التصفية.</Empty> : (
        <>
        <ul aria-label="حضور الموظفين" className="space-y-3 md:hidden">
          {dashboard.data.rows.map(row => <li key={row.staffId} className="rounded-xl border border-[#f4d6da] bg-card p-4 dark:border-border">
            <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2.5"><EmployeeAvatar name={row.name} photoUrl={row.photoUrl} size={40} /><div className="min-w-0"><h3 className="break-words text-sm font-bold">{row.name}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{row.department ?? "القسم غير محدد"}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[row.status] ?? "bg-muted text-muted-foreground"}`}>{row.statusLabel}</span></div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">الحضور</dt><dd className="mt-1 font-semibold tabular-nums">{baghdadTime(row.checkInMs)}</dd></div><div><dt className="text-xs text-muted-foreground">الانصراف</dt><dd className="mt-1 font-semibold tabular-nums">{baghdadTime(row.checkOutMs)}</dd></div><div><dt className="text-xs text-muted-foreground">الساعات المسجلة</dt><dd className="mt-1 font-semibold tabular-nums">{row.checkInMs != null ? hours(row.workedMinutes) : "—"}</dd></div></dl>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground"><p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="break-words">{row.locationName ?? "الموقع غير محدد"}</span></p><p>الوردية: {row.shiftStartMs != null ? <bdi dir="ltr">{baghdadTime(row.shiftStartMs)}–{baghdadTime(row.shiftEndMs)}</bdi> : "غير محددة"} · {methodLabel(row.method)}</p></div>
            {row.isLate || row.missingCheckOut ? <p className="mt-3 text-xs font-semibold text-amber-800 dark:text-amber-300">{[row.isLate ? "حضور متأخر" : "", row.missingCheckOut ? "تسجيل انصراف مفقود" : ""].filter(Boolean).join(" · ")}</p> : null}
            {row.bookingId || options.capabilities.canManage ? <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-2">{row.bookingId ? <Button type="button" size="sm" variant="ghost" className="min-h-11" asChild><a href={`/admin/bookings/${row.bookingSource}/${row.bookingId}`}><ExternalLink className="h-4 w-4" aria-hidden />الحجز</a></Button> : null}{options.capabilities.canManage ? <Button type="button" variant="ghost" size="sm" className="min-h-11" aria-label={`إعدادات ${row.name}`} onClick={() => onSettings(row.staffId, row.name)}><Settings2 className="h-4 w-4" aria-hidden />إعدادات الموظف</Button> : null}</div> : null}
          </li>)}
        </ul>
        <div className="hidden md:block">
        <TableShell wide={820}>
          <thead><tr>{["الموظف والقسم", "موقع العمل", "الوردية", "الحضور", "الانصراف", "الساعات", "الطريقة", "الحالة", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
          <tbody>{dashboard.data.rows.map((row) => (
            <tr key={row.staffId}>
              <td className={`${td} font-medium`}><div className="flex items-center gap-2.5"><EmployeeAvatar name={row.name} photoUrl={row.photoUrl} size={32} /><div><span>{row.name}</span><span className="block text-xs font-normal text-muted-foreground">{row.department ?? "—"}</span></div></div></td>
              <td className={`${td} text-xs`}>{row.locationName ?? "—"}</td>
              <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{row.shiftStartMs != null ? <bdi dir="ltr">{baghdadTime(row.shiftStartMs)}–{baghdadTime(row.shiftEndMs)}</bdi> : "—"}</td>
              <td className={`${td} tabular-nums`}>{baghdadTime(row.checkInMs)}{row.isLate ? <span className="ms-1 text-[11px] text-amber-700 dark:text-amber-300">متأخر</span> : null}</td>
              <td className={`${td} tabular-nums`}>{baghdadTime(row.checkOutMs)}{row.missingCheckOut ? <span className="ms-1 text-[11px] text-destructive">مفقود</span> : null}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{row.checkInMs != null ? hours(row.workedMinutes) : "—"}</td>
              <td className={`${td} text-xs`}>{methodLabel(row.method)}</td>
              <td className={td}><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[row.status] ?? "bg-muted text-muted-foreground"}`}>{row.statusLabel}</span></td>
              <td className={td}>
                <div className="flex flex-wrap gap-1">
                  {row.bookingId ? <Button type="button" size="sm" variant="ghost" asChild><a href={`/admin/bookings/${row.bookingSource}/${row.bookingId}`}><ExternalLink className="h-3.5 w-3.5" />الحجز</a></Button> : null}
                  {options.capabilities.canManage ? <Button type="button" size="sm" variant="ghost" aria-label={`إعدادات ${row.name}`} onClick={() => onSettings(row.staffId, row.name)}><Settings2 className="h-3.5 w-3.5" /></Button> : null}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </TableShell>
        </div>
        </>
      )}
    </div>
  );
}

function RecordsTab({ options }: { options: Options }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ from: addDays(baghdadDate(), -6), to: baghdadDate(), staffId: "", locationId: "", method: "" });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page: String(page), pageSize: "50" });
  const rows = useQuery<{ data: RecordRow[]; page: number; totalPages: number }>({ queryKey: ["admin", "attendance", "records", params.toString()], queryFn: () => adminFetch(`/admin/attendance/records?${params}`) });
  const set = (patch: Partial<typeof filters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const overtime = useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number }) => adminFetch<{ protectedRuns: unknown[] }>(`/admin/attendance/records/${id}/overtime`, { method: "POST", body: JSON.stringify({ minutes }) }),
    onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] }); toast({ title: "تم اعتماد الإضافي", description: result.protectedRuns.length ? "يخص دورة رواتب منتهية؛ تسويته بملحق رواتب." : undefined }); },
    onError: (error) => toast({ title: "تعذّر اعتماد الإضافي", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">من<Input type="date" className="w-40" value={filters.from} onChange={(event) => set({ from: event.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs font-medium">إلى<Input type="date" className="w-40" value={filters.to} onChange={(event) => set({ to: event.target.value })} /></label>
        <select aria-label="الموظف" className={control} value={filters.staffId} onChange={(event) => set({ staffId: event.target.value })}><option value="">كل الموظفين</option>{options.staff.map((row) => <option key={row.id} value={row.id}>{row.fullName}</option>)}</select>
        <select aria-label="موقع العمل" className={control} value={filters.locationId} onChange={(event) => set({ locationId: event.target.value })}><option value="">كل المواقع</option>{options.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select aria-label="طريقة التحقق" className={control} value={filters.method} onChange={(event) => set({ method: event.target.value })}><option value="">كل الطرق</option>{ATTENDANCE_METHODS.filter((value) => value !== "any").map((value) => <option key={value} value={value}>{ATTENDANCE_METHOD_LABELS[value]}</option>)}</select>
      </div>
      {rows.isError ? <Failed error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <Skeleton className="h-48 w-full" /> : !rows.data.data.length ? <Empty>لا توجد سجلات في هذه الفترة.</Empty> : (
        <>
          <TableShell wide={1000}>
            <thead><tr>{["الموظف", "التاريخ", "الحضور", "الانصراف", "الساعات", "الطريقة", "الموقع", "المسافة", "الوردية", "الإضافي المعتمد"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
            <tbody>{rows.data.data.map((row) => {
              const distance = row.evidence?.find((entry) => entry.event === "check_in")?.distance;
              return (
                <tr key={row.id}>
                  <td className={`${td} font-medium`}>{row.name}</td>
                  <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{row.checkInMs ? baghdadDate(row.checkInMs) : "—"}</td>
                  <td className={`${td} tabular-nums`}>{baghdadTime(row.checkInMs)}</td>
                  <td className={`${td} tabular-nums`}>{row.checkOutMs ? baghdadTime(row.checkOutMs) : <span className="text-xs text-amber-700 dark:text-amber-300">بدون انصراف</span>}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{row.workedMinutes ? hours(row.workedMinutes) : "—"}</td>
                  <td className={`${td} text-xs`}>{methodLabel(row.method)}</td>
                  <td className={`${td} text-xs`}>{row.locationName ?? "—"}</td>
                  <td className={`${td} text-xs tabular-nums`}>{options.capabilities.canViewLocation && distance != null ? `${Math.round(Number(distance))} م` : "—"}</td>
                  <td className={`${td} text-xs`}>{row.bookingId ? <a className="text-primary underline underline-offset-2" href={`/admin/bookings/${row.bookingSource}/${row.bookingId}`}>حجز #{row.bookingId}</a> : row.shiftTitle ?? "—"}</td>
                  <td className={td}>
                    {options.capabilities.canApprove && options.policy.overtimeRequiresApproval ? (
                      <Input type="number" min={0} max={1440} aria-label={`إضافي ${row.name} بالدقائق`} className="h-9 w-24" defaultValue={row.overtimeApprovedMinutes ?? ""} placeholder="دقيقة" onBlur={(event) => { if (event.target.value !== "" && Number(event.target.value) !== row.overtimeApprovedMinutes) overtime.mutate({ id: row.id, minutes: Number(event.target.value) }); }} />
                    ) : <span className="text-xs tabular-nums">{row.overtimeApprovedMinutes ?? "—"}</span>}
                  </td>
                </tr>
              );
            })}</tbody>
          </TableShell>
          {rows.data.totalPages > 1 ? <div className="flex items-center justify-center gap-2 text-sm"><Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button><span className="tabular-nums text-muted-foreground">{page} / {rows.data.totalPages}</span><Button type="button" size="sm" variant="outline" disabled={page >= rows.data.totalPages} onClick={() => setPage(page + 1)}>التالي</Button></div> : null}
        </>
      )}
    </div>
  );
}

const BLANK_SHIFT = { staffId: "", from: baghdadDate(), to: baghdadDate(), start: "09:00", end: "17:00", kind: "rotating", locationId: "", requiredMethod: "", graceMinutes: "", title: "", days: [] as string[] };

function ShiftsTab({ options }: { options: Options }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(BLANK_SHIFT);
  const [range, setRange] = useState({ from: baghdadDate(), to: addDays(baghdadDate(), 30), staffId: "" });
  const params = new URLSearchParams(Object.entries(range).filter(([, value]) => value));
  const shifts = useQuery<{ data: ShiftRow[] }>({ queryKey: ["admin", "attendance", "shifts", params.toString()], queryFn: () => adminFetch(`/admin/attendance/shifts?${params}`) });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] });
  const save = useMutation({
    mutationFn: () => adminFetch<{ created: number[] }>("/admin/attendance/shifts", { method: "POST", body: JSON.stringify({ ...form, staffId: Number(form.staffId) }) }),
    onSuccess: (result) => { toast({ title: `أضيفت ${result.created.length} وردية` }); invalidate(); },
    onError: (error) => toast({ title: "تعذّر حفظ الوردية", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/attendance/shifts/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "أُلغيت الوردية" }); invalidate(); },
    onError: (error) => toast({ title: "تعذّر إلغاء الوردية", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const pay = useMutation({
    mutationFn: (id: number) => adminFetch<{ created: boolean; duplicate: boolean }>(`/admin/attendance/shifts/${id}/approve-pay`, { method: "POST" }),
    onSuccess: (result) => { toast({ title: result.duplicate ? "اعتُمد هذا الأجر مسبقاً" : "اعتُمد أجر المناسبة", description: result.duplicate ? undefined : "يظهر في حوافز الموظف لإضافته لدورة الرواتب." }); invalidate(); },
    onError: (error) => toast({ title: "تعذّر اعتماد الأجر", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const canManage = options.capabilities.canManage;
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      {canManage ? (
        <form className="space-y-3 rounded-2xl border border-[#f4d6da] bg-card p-4 dark:border-border" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <h3 className="font-bold">إضافة وردية</h3>
          <label className="block text-xs font-medium">الموظف<select required className={`${control} mt-1 w-full`} value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}><option value="">اختر الموظف</option>{options.staff.map((row) => <option key={row.id} value={row.id}>{row.fullName}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
            <label className="block text-xs font-medium">من تاريخ<Input type="date" className="mt-1" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} /></label>
            <label className="block text-xs font-medium">إلى تاريخ<Input type="date" className="mt-1" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} /></label>
            <label className="block text-xs font-medium">البداية<Input type="time" dir="ltr" className="mt-1" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label>
            <label className="block text-xs font-medium">النهاية<Input type="time" dir="ltr" className="mt-1" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
          </div>
          <p className="text-[11px] text-muted-foreground">نهاية قبل البداية تعني وردية تعبر منتصف الليل.</p>
          <div className="text-xs font-medium">الأيام (اختياري)
            <div className="mt-1 flex flex-wrap gap-2">{Object.entries(DAY_LABELS).map(([key, label]) => (
              <label key={key} className="flex min-h-8 items-center gap-1 font-normal"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.days.includes(key)} onChange={(event) => setForm({ ...form, days: event.target.checked ? [...form.days, key] : form.days.filter((value) => value !== key) })} />{label}</label>
            ))}</div>
          </div>
          <label className="block text-xs font-medium">النوع<select className={`${control} mt-1 w-full`} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{["rotating", "fixed", "flexible", "part_time", "overnight"].map((value) => <option key={value} value={value}>{SHIFT_KIND_LABELS[value]}</option>)}</select></label>
          <label className="block text-xs font-medium">موقع العمل<select className={`${control} mt-1 w-full`} value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">الموقع الأساسي للموظف</option>{options.locations.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="block text-xs font-medium">طريقة التحقق<select className={`${control} mt-1 w-full`} value={form.requiredMethod} onChange={(event) => setForm({ ...form, requiredMethod: event.target.value })}><option value="">حسب إعدادات الموظف</option>{ATTENDANCE_METHODS.map((value) => <option key={value} value={value}>{ATTENDANCE_METHOD_LABELS[value]}</option>)}</select></label>
          <Button className="w-full" disabled={save.isPending || !form.staffId}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}حفظ الوردية</Button>
          <p className="text-[11px] text-muted-foreground">ورديات المناسبات تُنشأ من تبويب «الحضور» داخل الحجز حتى ترتبط بالحجز الأصلي.</p>
        </form>
      ) : null}
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">من<Input type="date" className="w-40" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">إلى<Input type="date" className="w-40" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
          <select aria-label="الموظف" className={control} value={range.staffId} onChange={(event) => setRange({ ...range, staffId: event.target.value })}><option value="">كل الموظفين</option>{options.staff.map((row) => <option key={row.id} value={row.id}>{row.fullName}</option>)}</select>
        </div>
        {shifts.isError ? <Failed error={shifts.error} retry={() => void shifts.refetch()} /> : shifts.isPending ? <Skeleton className="h-48 w-full" /> : !shifts.data.data.length ? <Empty>لا توجد ورديات مضافة. الموظف ذو الدوام الثابت يتبع إعداداته بدون ورديات.</Empty> : (
          <TableShell>
            <thead><tr>{["الموظف", "التاريخ", "الوقت", "النوع", "الموقع", "الحجز", "الأجر", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
            <tbody>{shifts.data.data.map((row) => (
              <tr key={row.shiftId}>
                <td className={`${td} font-medium`}>{row.staffName ?? "—"}</td>
                <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{row.date}</td>
                <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{baghdadTime(row.startMs)}–{baghdadTime(row.endMs)}</td>
                <td className={`${td} text-xs`}>{SHIFT_KIND_LABELS[row.kind] ?? row.kind}</td>
                <td className={`${td} text-xs`}>{row.locationName ?? "—"}</td>
                <td className={`${td} text-xs`}>{row.bookingId ? <a className="text-primary underline underline-offset-2" href={`/admin/bookings/${row.bookingSource}/${row.bookingId}`}>فتح الحجز الأصلي #{row.bookingId}</a> : "—"}</td>
                <td className={`${td} text-xs tabular-nums`}>{row.payAmount ? number(row.payAmount) : "—"}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {row.bookingId && row.payAmount && options.capabilities.canApprove ? <Button type="button" size="sm" variant="outline" disabled={pay.isPending} onClick={() => pay.mutate(row.shiftId)}>اعتماد الأجر</Button> : null}
                    {canManage ? <Button type="button" size="sm" variant="ghost" aria-label="إلغاء الوردية" disabled={cancel.isPending} onClick={() => cancel.mutate(row.shiftId)}><Trash2 className="h-3.5 w-3.5" /></Button> : null}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </TableShell>
        )}
      </div>
    </div>
  );
}

const BLANK_LOCATION = { name: "", kind: "office", address: "", latitude: "", longitude: "", radiusMeters: "100", maxAccuracyMeters: "100", requiredMethod: "qr_gps", warehouseId: "", isActive: true };

function LocationsTab({ options }: { options: Options }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<LocationRow | "new" | null>(null);
  const [form, setForm] = useState(BLANK_LOCATION);
  const warehouses = useQuery<{ data: Array<{ id: number; name: string }> }>({ queryKey: ["admin", "warehouses", "list"], queryFn: () => adminFetch("/admin/warehouses/list"), enabled: Boolean(editing), retry: false });
  const open = (row: LocationRow | "new") => {
    setEditing(row);
    setForm(row === "new" ? BLANK_LOCATION : { name: row.name, kind: row.kind, address: row.address ?? "", latitude: row.latitude == null ? "" : String(row.latitude), longitude: row.longitude == null ? "" : String(row.longitude), radiusMeters: String(row.radiusMeters), maxAccuracyMeters: String(row.maxAccuracyMeters), requiredMethod: row.requiredMethod, warehouseId: row.warehouseId ? String(row.warehouseId) : "", isActive: row.isActive });
  };
  const save = useMutation({
    mutationFn: () => adminFetch(editing && editing !== "new" ? `/admin/attendance/locations/${editing.id}` : "/admin/attendance/locations", { method: editing && editing !== "new" ? "PATCH" : "POST", body: JSON.stringify(form) }),
    onSuccess: () => { toast({ title: "تم حفظ موقع العمل" }); setEditing(null); void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] }); },
  });
  const fillFromMyLocation = () => {
    if (!navigator.geolocation) { toast({ title: "هذا المتصفح لا يدعم تحديد الموقع", variant: "destructive" }); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => setForm((current) => ({ ...current, latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) })),
      () => toast({ title: "تعذر تحديد موقعك", variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div className="space-y-3">
      {options.capabilities.canManage ? <Button type="button" onClick={() => open("new")}><Plus className="h-4 w-4" />إضافة موقع عمل</Button> : null}
      {!options.locations.length ? <Empty>لا توجد مواقع عمل بعد. أضف المحل الرئيسي والمخازن أولاً.</Empty> : (
        <TableShell>
          <thead><tr>{["الموقع", "النوع", "العنوان", "الإحداثيات", "النطاق", "طريقة التحقق", "الحالة", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
          <tbody>{options.locations.map((row) => (
            <tr key={row.id}>
              <td className={`${td} font-medium`}>{row.name}{row.warehouseName ? <span className="block text-[11px] text-muted-foreground">مرتبط بـ {row.warehouseName}</span> : null}</td>
              <td className={`${td} text-xs`}>{LOCATION_KIND_LABELS[row.kind] ?? row.kind}</td>
              <td className={`${td} max-w-48 truncate text-xs`} title={row.address ?? ""}>{row.address ?? "—"}</td>
              <td dir="ltr" className={`${td} whitespace-nowrap text-right text-xs tabular-nums`}>{row.latitude == null ? "—" : `${row.latitude}, ${row.longitude}`}</td>
              <td className={`${td} text-xs tabular-nums`}>{row.radiusMeters} م</td>
              <td className={`${td} text-xs`}>{methodLabel(row.requiredMethod)}</td>
              <td className={td}><span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${row.isActive ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{row.isActive ? "نشط" : "غير نشط"}</span></td>
              <td className={td}>{options.capabilities.canManage ? <Button type="button" size="sm" variant="ghost" aria-label={`تعديل ${row.name}`} onClick={() => open(row)}><Pencil className="h-3.5 w-3.5" /></Button> : null}</td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(next) => { if (!next && !save.isPending) setEditing(null); }}>
        <DialogContent dir="rtl" className="max-h-[90dvh] w-[min(calc(100%-2rem),34rem)] overflow-y-auto">
          <DialogHeader className="text-start"><DialogTitle>{editing && editing !== "new" ? `تعديل ${editing.name}` : "إضافة موقع عمل"}</DialogTitle><DialogDescription>النطاق يحدد المسافة المسموحة عن هذه النقطة عند التحقق بـ GPS.</DialogDescription></DialogHeader>
          <form id="attendance-location" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
            <label className="text-sm font-medium">اسم الموقع<Input required maxLength={160} className="mt-1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="المحل الرئيسي" /></label>
            <label className="text-sm font-medium">النوع<select className={`${control} mt-1 w-full`} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{Object.entries(LOCATION_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium sm:col-span-2">العنوان<Input maxLength={500} className="mt-1" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
            <label className="text-sm font-medium">خط العرض<Input dir="ltr" inputMode="decimal" className="mt-1" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} /></label>
            <label className="text-sm font-medium">خط الطول<Input dir="ltr" inputMode="decimal" className="mt-1" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} /></label>
            <div className="sm:col-span-2"><Button type="button" variant="outline" size="sm" onClick={fillFromMyLocation}><MapPin className="h-3.5 w-3.5" />استخدم موقعي الحالي</Button></div>
            <label className="text-sm font-medium">النطاق المسموح (متر)<Input type="number" min={10} max={5000} className="mt-1" value={form.radiusMeters} onChange={(event) => setForm({ ...form, radiusMeters: event.target.value })} /></label>
            <label className="text-sm font-medium">أقصى دقة مقبولة (متر)<Input type="number" min={5} max={1000} className="mt-1" value={form.maxAccuracyMeters} onChange={(event) => setForm({ ...form, maxAccuracyMeters: event.target.value })} /></label>
            <label className="text-sm font-medium">طريقة التحقق الافتراضية<select className={`${control} mt-1 w-full`} value={form.requiredMethod} onChange={(event) => setForm({ ...form, requiredMethod: event.target.value })}>{ATTENDANCE_METHODS.filter((value) => value !== "any").map((value) => <option key={value} value={value}>{ATTENDANCE_METHOD_LABELS[value]}</option>)}</select></label>
            <label className="text-sm font-medium">مخزن مرتبط (اختياري)<select className={`${control} mt-1 w-full`} value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}><option value="">بدون</option>{(warehouses.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="flex min-h-10 items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />موقع نشط</label>
          </form>
          {save.isError ? <p role="alert" className="text-sm text-destructive">{apiErrorMessage(save.error)}</p> : null}
          <DialogFooter className="gap-2 sm:justify-start"><Button type="submit" form="attendance-location" disabled={save.isPending}>حفظ</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={() => setEditing(null)}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KioskTab({ options }: { options: Options }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [locationId, setLocationId] = useState("");
  const [created, setCreated] = useState("");
  const kiosks = useQuery<{ data: Kiosk[] }>({ queryKey: ["admin", "attendance", "kiosks"], queryFn: () => adminFetch("/admin/attendance/kiosks") });
  const create = useMutation({
    mutationFn: () => adminFetch<{ deviceToken: string }>("/admin/attendance/kiosks", { method: "POST", body: JSON.stringify({ locationId: Number(locationId) }) }),
    onSuccess: (result) => { setCreated(`${window.location.origin}/attendance-kiosk/${result.deviceToken}`); void queryClient.invalidateQueries({ queryKey: ["admin", "attendance", "kiosks"] }); },
    onError: (error) => toast({ title: "تعذّر إنشاء الشاشة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/attendance/kiosks/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "أُلغيت الشاشة" }); void queryClient.invalidateQueries({ queryKey: ["admin", "attendance", "kiosks"] }); },
    onError: (error) => toast({ title: "تعذّر الإلغاء", description: apiErrorMessage(error), variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      {options.capabilities.canManage ? (
        <div className="space-y-3 rounded-2xl border border-[#f4d6da] bg-card p-4 dark:border-border">
          <h3 className="font-bold">شاشة حضور جديدة (آيباد)</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium">موقع العمل<select aria-label="موقع العمل لشاشة QR" className={`${control} mt-1 block`} value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">اختر الموقع</option>{options.locations.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <Button type="button" disabled={!locationId || create.isPending} onClick={() => create.mutate()}><QrCode className="h-4 w-4" />إنشاء رابط الشاشة</Button>
          </div>
          {created ? (
            <div className="space-y-2 rounded-xl bg-primary/5 p-3 text-sm">
              <p className="font-semibold">افتح هذا الرابط على الآيباد. يظهر مرة وحدة فقط.</p>
              <p dir="ltr" className="break-all text-xs">{created}</p>
              <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={async () => { try { if (!navigator.clipboard) throw new Error("نسخ الرابط غير متاح؛ انسخه يدوياً من الحقل أعلاه"); await navigator.clipboard.writeText(created); toast({ title: "تم نسخ الرابط" }); } catch (cause) { toast({ title: "تعذّر النسخ", description: apiErrorMessage(cause), variant: "destructive" }); } }}><Copy className="h-3.5 w-3.5" />نسخ الرابط</Button><Button type="button" size="sm" asChild><a href={created} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />فتح شاشة QR</a></Button></div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">الرمز يتغيّر كل 30 ثانية. لأنه يمكن مشاركته عن بعد، استخدم QR + GPS حيث يهم إثبات الوجود.</p>
        </div>
      ) : null}
      {kiosks.isError ? <Failed error={kiosks.error} retry={() => void kiosks.refetch()} /> : kiosks.isPending ? <Skeleton className="h-24 w-full" /> : !kiosks.data.data.length ? <Empty>لا توجد شاشات حضور بعد.</Empty> : (
        <TableShell wide={560}>
          <thead><tr>{["الشاشة", "الموقع", "آخر اتصال", "الحالة", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
          <tbody>{kiosks.data.data.map((row) => (
            <tr key={row.id}>
              <td className={`${td} font-medium`}>{row.name}</td>
              <td className={`${td} text-xs`}>{row.locationName}</td>
              <td className={`${td} text-xs tabular-nums`}>{attendanceTimestamp(row.lastSeenAt)}</td>
              <td className={td}><span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${row.isActive ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{row.isActive ? "فعالة" : "ملغاة"}</span></td>
              <td className={td}>{row.isActive && options.capabilities.canManage ? <Button type="button" size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(row.id)}>إلغاء</Button> : null}</td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
    </div>
  );
}

function CorrectionsTab({ options }: { options: Options }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("pending");
  const rows = useQuery<{ data: Correction[] }>({ queryKey: ["admin", "attendance", "corrections", status], queryFn: () => adminFetch(`/admin/attendance/corrections${status ? `?status=${status}` : ""}`) });
  const review = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) => adminFetch<{ protectedRuns: Array<{ runNo: string }> }>(`/admin/attendance/corrections/${id}`, { method: "PATCH", body: JSON.stringify({ status: approved ? "approved" : "rejected" }) }),
    onSuccess: (result, { approved }) => {
      toast({ title: approved ? "تمت الموافقة وتحديث السجل" : "رُفض الطلب", description: result.protectedRuns?.length ? `يخص دورة رواتب منتهية (${result.protectedRuns.map((run) => run.runNo).join("، ")}): لم تتغيّر، وتسويتها بملحق رواتب.` : undefined });
      void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] });
    },
    onError: (error) => toast({ title: "تعذّرت المراجعة", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const showAttachment = async (id: number) => {
    try {
      const result = await adminFetch<{ attachment: string | null }>(`/admin/attendance/corrections/${id}/attachment`);
      if (result.attachment) window.open(result.attachment, "_blank", "noopener");
    } catch (error) { toast({ title: "تعذّر فتح المرفق", description: apiErrorMessage(error), variant: "destructive" }); }
  };
  return (
    <div className="space-y-3">
      <select aria-label="الحالة" className={control} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الطلبات</option>{Object.entries(CORRECTION_STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
      {rows.isError ? <Failed error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <Skeleton className="h-32 w-full" /> : !rows.data.data.length ? <Empty>لا توجد طلبات.</Empty> : (
        <TableShell wide={900}>
          <thead><tr>{["الموظف", "التاريخ", "النوع", "الوقت المطلوب", "السبب", "الحالة", ""].map((label, index) => <th key={index} className={th}>{label}</th>)}</tr></thead>
          <tbody>{rows.data.data.map((row) => (
            <tr key={row.id}>
              <td className={`${td} font-medium`}>{row.name}</td>
              <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{row.workDate}</td>
              <td className={`${td} text-xs`}>{CORRECTION_TYPES[row.requestType] ?? row.requestType}</td>
              <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>{row.checkInMs ? `حضور ${baghdadTime(row.checkInMs)}` : ""} {row.checkOutMs ? `انصراف ${baghdadTime(row.checkOutMs)}` : ""}</td>
              <td className={`${td} max-w-64 text-xs`}>{row.reason}{row.hasAttachment ? <Button type="button" variant="link" size="sm" className="h-auto p-0 ps-2 text-xs" onClick={() => void showAttachment(row.id)}>المرفق</Button> : null}</td>
              <td className={td}><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${CORRECTION_STATUS[row.status]?.cls ?? ""}`}>{CORRECTION_STATUS[row.status]?.label ?? row.status}</span>{row.reviewedByName ? <span className="block text-[11px] text-muted-foreground">{row.reviewedByName}</span> : null}</td>
              <td className={td}>{row.status === "pending" && options.capabilities.canApprove ? <div className="flex flex-wrap gap-1"><Button type="button" size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: row.id, approved: true })}>موافقة</Button><Button type="button" size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: row.id, approved: false })}>رفض</Button></div> : null}</td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
    </div>
  );
}

const REPORTS: Record<string, { label: string; keep: (row: ReportRow) => boolean }> = {
  summary: { label: "ملخص الحضور والرواتب", keep: () => true },
  late: { label: "التأخيرات", keep: (row) => row.lateArrivals > 0 },
  absence: { label: "الغيابات", keep: (row) => row.absentDays > 0 },
  overtime: { label: "الإضافي", keep: (row) => row.overtimeHours > 0 },
  events: { label: "حضور المناسبات", keep: (row) => row.eventShifts > 0 },
};

function ReportsTab({ options }: { options: Options }) {
  const { toast } = useToast();
  const today = baghdadDate();
  const [filters, setFilters] = useState({ from: `${today.slice(0, 7)}-01`, to: today, staffId: "", department: "", locationId: "" });
  const [kind, setKind] = useState("summary");
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const report = useQuery<{ data: ReportRow[] }>({ queryKey: ["admin", "attendance", "report", params.toString()], queryFn: () => adminFetch(`/admin/attendance/report?${params}`) });
  const rows = useMemo(() => (report.data?.data ?? []).filter(REPORTS[kind].keep), [report.data, kind]);
  const preset = (days: number) => setFilters((current) => ({ ...current, from: addDays(today, -days), to: today }));
  const columns: Array<{ key: string; header: string; value: (row: ReportRow) => string | number; cell?: (row: ReportRow) => number }> = [
    { key: "name", header: "الموظف", value: (row) => row.name },
    { key: "department", header: "القسم", value: (row) => row.department ?? "—" },
    { key: "scheduled", header: "أيام الدوام", value: (row) => row.scheduledDays },
    { key: "present", header: "الحضور", value: (row) => row.presentDays },
    { key: "absent", header: "غياب", value: (row) => row.absentDays },
    { key: "leave", header: "إجازة", value: (row) => row.paidLeaveDays + row.unpaidLeaveDays },
    { key: "hours", header: "الساعات", value: (row) => number(row.workedHours), cell: (row) => row.workedHours },
    { key: "late", header: "تأخير (د)", value: (row) => row.lateMinutes },
    { key: "early", header: "انصراف مبكر (د)", value: (row) => row.earlyLeaveMinutes },
    { key: "overtime", header: "إضافي (س)", value: (row) => number(row.overtimeHours), cell: (row) => row.overtimeHours },
    { key: "missing", header: "بلا انصراف", value: (row) => row.missingCheckOut },
    { key: "events", header: "مناسبات", value: (row) => `${row.eventAttended}/${row.eventShifts}` },
    { key: "deductions", header: "خصم مقترح", value: (row) => number(row.proposedDeductions), cell: (row) => row.proposedDeductions },
  ];
  // Hours and money stay real numbers so Excel can add them up.
  const exportExcel = () => void import("xlsx").then((XLSX) => {
    const sheet = XLSX.utils.aoa_to_sheet([columns.map((column) => column.header), ...rows.map((row) => columns.map((column) => (column.cell ?? column.value)(row)))]);
    sheet["!cols"] = columns.map((_, index) => ({ wch: index === 0 ? 28 : 14 }));
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(workbook, sheet, REPORTS[kind].label);
    XLSX.writeFile(workbook, `attendance-${kind}-${filters.from}-${filters.to}.xlsx`);
  }).catch((error) => toast({ title: "تعذّر تصدير الملف", description: apiErrorMessage(error), variant: "destructive" }));
  // Real paged print: the rasterised PDF path froze the page for over a minute on this report.
  const print = () => void exportReport({
    options: { title: REPORTS[kind].label, subtitle: `${filters.from} إلى ${filters.to}`, orientation: "landscape", emptyText: "لا توجد بيانات" },
    columns: columns.map((column, index): ReportColumn<ReportRow> => ({ key: column.key, header: column.header, width: index === 0 ? 20 : 8, align: index > 1 ? "center" : undefined, priority: "high", value: column.value })),
    rows,
    filename: `attendance-${kind}.pdf`,
    mode: "print",
  }).catch((error) => toast({ title: "تعذّرت الطباعة", description: apiErrorMessage(error), variant: "destructive" }));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">خصومات الحضور مقترحة فقط؛ لا تُطبق أو تُصرف قبل اعتماد المدير لدورة الرواتب عبر المسار المالي الحالي.</p>
      <div className="flex flex-wrap items-end gap-2">
        <select aria-label="نوع التقرير" className={control} value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(REPORTS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
        <label className="flex flex-col gap-1 text-xs font-medium">من<Input type="date" className="w-40" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs font-medium">إلى<Input type="date" className="w-40" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <Button type="button" size="sm" variant="ghost" onClick={() => preset(0)}>يومي</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => preset(6)}>أسبوعي</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setFilters({ ...filters, from: `${today.slice(0, 7)}-01`, to: today })}>شهري</Button>
        <select aria-label="الموظف" className={control} value={filters.staffId} onChange={(event) => setFilters({ ...filters, staffId: event.target.value })}><option value="">كل الموظفين</option>{options.staff.map((row) => <option key={row.id} value={row.id}>{row.fullName}</option>)}</select>
        <select aria-label="القسم" className={control} value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}><option value="">كل الأقسام</option>{[...new Set(options.staff.map((row) => row.department).filter(Boolean))].map((value) => <option key={String(value)} value={String(value)}>{value}</option>)}</select>
        <select aria-label="موقع العمل" className={control} value={filters.locationId} onChange={(event) => setFilters({ ...filters, locationId: event.target.value })}><option value="">كل المواقع</option>{options.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <Button type="button" variant="outline" disabled={report.isError || report.isPending || !rows.length} onClick={exportExcel}><Download className="h-4 w-4" />Excel</Button>
        <Button type="button" variant="outline" disabled={report.isError || report.isPending || !rows.length} onClick={print}><Printer className="h-4 w-4" />A4</Button>
      </div>
      {report.isError ? <Failed error={report.error} retry={() => void report.refetch()} /> : report.isPending ? <Skeleton className="h-48 w-full" /> : !rows.length ? <Empty>لا توجد بيانات لهذا التقرير في الفترة المحددة.</Empty> : (
        <TableShell wide={1040}>
          <thead><tr>{columns.map((column) => <th key={column.key} className={th}>{column.header}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.staffId}>{columns.map((column, index) => <td key={column.key} className={`${td} ${index === 0 ? "font-medium" : "text-xs tabular-nums"}`}>{column.value(row)}</td>)}</tr>)}</tbody>
        </TableShell>
      )}
    </div>
  );
}

function SettingsTab({ options, policyEditor, onSettings }: { options: Options; policyEditor: ReactNode; onSettings: (staffId: number, name: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ overtimeRequiresApproval: Boolean(options.policy.overtimeRequiresApproval), checkInEarlyMinutes: String(options.policy.checkInEarlyMinutes ?? 120), locationRetentionDays: String(options.policy.locationRetentionDays ?? 90) });
  const [staffSearch, setStaffSearch] = useState("");
  const save = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/policy", { method: "PATCH", body: JSON.stringify({ overtimeRequiresApproval: form.overtimeRequiresApproval, checkInEarlyMinutes: Number(form.checkInEarlyMinutes), locationRetentionDays: Number(form.locationRetentionDays) }) }),
    onSuccess: () => { toast({ title: "تم حفظ الإعدادات" }); void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] }); },
    onError: (error) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const staff = options.staff.filter((row) => !staffSearch.trim() || row.fullName.includes(staffSearch.trim()));
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-[#f4d6da] bg-card p-4 dark:border-border">
        <h3 className="font-bold">إعدادات عامة</h3>
        <fieldset disabled={!options.capabilities.canManagePolicy} className="grid gap-3 sm:grid-cols-3">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.overtimeRequiresApproval} onChange={(event) => setForm({ ...form, overtimeRequiresApproval: event.target.checked })} />الإضافي يحتاج اعتماد المدير</label>
          <label className="text-sm font-medium">التسجيل قبل الوردية بـ (دقيقة)<Input type="number" min={0} max={720} className="mt-1" value={form.checkInEarlyMinutes} onChange={(event) => setForm({ ...form, checkInEarlyMinutes: event.target.value })} /></label>
          <label className="text-sm font-medium">حفظ إحداثيات التسجيل (يوم)<Input type="number" min={1} max={3650} className="mt-1" value={form.locationRetentionDays} onChange={(event) => setForm({ ...form, locationRetentionDays: event.target.value })} /></label>
        </fieldset>
        {options.capabilities.canManagePolicy ? <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>حفظ</Button> : <p className="text-xs text-muted-foreground">هذه الإعدادات يعدّلها مدير النظام.</p>}
      </section>
      {policyEditor}
      <section className="space-y-3 rounded-2xl border border-[#f4d6da] bg-card p-4 dark:border-border">
        <h3 className="font-bold">إعدادات الموظفين</h3>
        <Input aria-label="ابحث عن موظف" placeholder="ابحث عن موظف" value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} />
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{staff.map((row) => (
          <li key={row.id}><button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border/40 px-3 text-right text-sm hover:bg-muted/50" onClick={() => onSettings(row.id, row.fullName)}><span className="min-w-0 truncate">{row.fullName}</span><Settings2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /></button></li>
        ))}</ul>
      </section>
      <section className="space-y-2 rounded-2xl border border-[#f4d6da] bg-card p-4 dark:border-border">
        <h3 className="flex items-center gap-2 font-bold"><Fingerprint className="h-4 w-4 text-primary" aria-hidden />أجهزة البصمة</h3>
        <p className="text-sm text-muted-foreground">لا توجد أجهزة مرتبطة حالياً.</p>
        <p className="text-xs text-muted-foreground">الربط يعتمد على موديل الجهاز وواجهته البرمجية عند شرائه. النظام لا يخزن بصمات أو صور وجوه.</p>
      </section>
    </div>
  );
}

export function AttendanceCenter({ policyEditor }: { policyEditor: ReactNode }) {
  const options = useQuery<Options>({ queryKey: ["admin", "attendance", "options"], queryFn: () => adminFetch("/admin/attendance/options") });
  const [tab, setTab] = useState("dashboard");
  const [employee, setEmployee] = useState<{ id: number; name: string } | null>(null);
  const openSettings = (id: number, name: string) => setEmployee({ id, name });
  if (options.isError) return <Failed error={options.error} retry={() => void options.refetch()} />;
  if (options.isPending) return <Skeleton className="h-64 w-full" />;
  const data = options.data;
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><CalendarCheck className="h-5 w-5 text-primary" aria-hidden />الحضور والانصراف</h1>
        <p className="mt-1 text-sm text-muted-foreground">متابعة الدوام وإدارة الورديات والمواقع، وربط ما يُعتمد منها بدورة الرواتب.</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11" asChild><a href="/staff?tab=attendance"><UserCheck className="h-4 w-4" aria-hidden />فتح حضوري</a></Button>
      </div>
      <Tabs dir="rtl" value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          {[["dashboard", "لوحة الحضور"], ["records", "سجل الدوام"], ["shifts", "الورديات"], ["locations", "مواقع العمل"], ["kiosk", "شاشة QR"], ["corrections", "طلبات التصحيح"], ["reports", "التقارير"], ["settings", "الإعدادات"]].map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="dashboard" className="mt-3"><DashboardTab options={data} onSettings={openSettings} /></TabsContent>
        <TabsContent value="records" className="mt-3"><RecordsTab options={data} /></TabsContent>
        <TabsContent value="shifts" className="mt-3"><ShiftsTab options={data} /></TabsContent>
        <TabsContent value="locations" className="mt-3"><LocationsTab options={data} /></TabsContent>
        <TabsContent value="kiosk" className="mt-3"><KioskTab options={data} /></TabsContent>
        <TabsContent value="corrections" className="mt-3"><CorrectionsTab options={data} /></TabsContent>
        <TabsContent value="reports" className="mt-3"><ReportsTab options={data} /></TabsContent>
        <TabsContent value="settings" className="mt-3"><SettingsTab options={data} policyEditor={policyEditor} onSettings={openSettings} /></TabsContent>
      </Tabs>
      <Dialog open={Boolean(employee)} onOpenChange={(next) => { if (!next) setEmployee(null); }}>
        <DialogContent dir="rtl" className="max-h-[90dvh] w-[min(calc(100%-2rem),40rem)] overflow-y-auto">
          <DialogHeader className="text-start"><DialogTitle>إعدادات الحضور: {employee?.name}</DialogTitle><DialogDescription>القواعد الخاصة بهذا الموظف. الموظف نفسه لا يستطيع تغييرها.</DialogDescription></DialogHeader>
          {employee ? <AttendanceSettingsPanel staffId={employee.id} onSaved={() => setEmployee(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
