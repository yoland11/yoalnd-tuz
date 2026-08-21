import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CalendarPlus, Clock3, Eye, LogIn, LogOut, Settings2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TableTotalsFooter } from "@/components/ui/table-totals-footer";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Staff = { id: number; username: string; fullName: string };
type Attendance = {
  id: number;
  staffId: number;
  staffName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  notes: string;
  hours: number;
};
type AttendancePolicy = { workStart: string; workEnd: string; lateGraceMinutes: number; earlyLeaveGraceMinutes: number; lateDeductionRule: string; absenceDeductionRule: string; earlyLeaveDeductionRule: string; unpaidLeaveDeductionRule: string; earlyLeaveDeductionRate: number; unpaidLeaveDeductionRate: number; weekendOvertimeMultiplier: number; holidayOvertimeMultiplier: number; paidLeaveCountsAsPresent: boolean; holidays: string[] };
type OwnPayroll = { id: number; runNo: string; period: string; status: string; paidAt?: string | null; line: any };

const STATUS_LABELS: Record<string, string> = {
  present: "حاضر",
  out: "منصرف",
  late: "متأخر",
  absent: "غائب",
  paid_leave: "إجازة مدفوعة",
  unpaid_leave: "إجازة غير مدفوعة",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ staffId: "", from: todayIso(), to: todayIso() });
  const [policyForm, setPolicyForm] = useState<AttendancePolicy | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [leave, setLeave] = useState({ staffId: "", from: todayIso(), to: todayIso(), leaveType: "paid", reason: "" });
  const [selectedPayroll, setSelectedPayroll] = useState<OwnPayroll | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.staffId) params.set("staffId", filters.staffId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{ data: Attendance[]; staff: Staff[]; policy: AttendancePolicy; canManageAll: boolean }>({
    queryKey: ["admin", "attendance", queryString],
    queryFn: () => adminFetch(`/admin/attendance?${queryString}`),
    staleTime: 20_000,
  });
  const payrollQuery = useQuery<OwnPayroll[]>({ queryKey: ["employee", "payroll", "self"], queryFn: () => adminFetch("/admin/hr/payroll/self"), staleTime: 30_000 });
  useEffect(() => { if (data?.policy && !policyForm) setPolicyForm(data.policy); }, [data?.policy, policyForm]);

  const checkIn = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/check-in", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الحضور" });
      qc.invalidateQueries({ queryKey: ["admin", "attendance"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر تسجيل الحضور", description: err?.message, variant: "destructive" }),
  });

  const checkOut = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/check-out", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الانصراف" });
      qc.invalidateQueries({ queryKey: ["admin", "attendance"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر تسجيل الانصراف", description: err?.message, variant: "destructive" }),
  });
  const savePolicy = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/policy", { method: "PATCH", body: JSON.stringify(policyForm) }),
    onSuccess: () => { toast({ title: "تم حفظ سياسة الحضور" }); setShowPolicy(false); qc.invalidateQueries({ queryKey: ["admin", "attendance"] }); },
    onError: (err: any) => toast({ title: "تعذر حفظ السياسة", description: err?.message, variant: "destructive" }),
  });
  const approveLeave = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/leave", { method: "POST", body: JSON.stringify({ ...leave, staffId: Number(leave.staffId) }) }),
    onSuccess: () => { toast({ title: "تم اعتماد الإجازة وإعادة احتساب المسودات" }); setShowLeave(false); setLeave({ staffId: "", from: todayIso(), to: todayIso(), leaveType: "paid", reason: "" }); qc.invalidateQueries({ queryKey: ["admin", "attendance"] }); qc.invalidateQueries({ queryKey: ["employee", "payroll", "self"] }); },
    onError: (err: any) => toast({ title: "تعذر اعتماد الإجازة", description: err?.message, variant: "destructive" }),
  });

  const totalHours = (data?.data ?? []).reduce((sum, row) => sum + row.hours, 0);
  const presentNow = (data?.data ?? []).filter((row) => !row.checkOutAt && row.status === "present").length;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الحضور والانصراف</h1>
          <p className="text-sm text-muted-foreground mt-1">تسجيل حضور الموظفين واحتساب الساعات اليومية والشهرية.</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.canManageAll && <Button type="button" variant="outline" onClick={() => setShowPolicy((value) => !value)} className="gap-2"><Settings2 className="w-4 h-4" /> السياسة</Button>}
          {data?.canManageAll && <Button type="button" variant="outline" onClick={() => setShowLeave((value) => !value)} className="gap-2"><CalendarPlus className="w-4 h-4" /> اعتماد إجازة</Button>}
          <Button type="button" onClick={() => checkIn.mutate()} disabled={checkIn.isPending} className="gap-2">
            <LogIn className="w-4 h-4" /> حضور
          </Button>
          <Button type="button" variant="outline" onClick={() => checkOut.mutate()} disabled={checkOut.isPending} className="gap-2">
            <LogOut className="w-4 h-4" /> انصراف
          </Button>
        </div>
      </div>

      {showPolicy && policyForm && <section className="rounded-xl border border-border/40 bg-card p-4" aria-labelledby="attendance-policy-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="attendance-policy-title" className="font-semibold">سياسة الحضور والاحتساب</h2><p className="mt-1 text-xs text-muted-foreground">تُطبق على مسودات الرواتب فقط، ويبقى الاعتماد النهائي بيد المدير.</p></div><Button onClick={() => savePolicy.mutate()} disabled={savePolicy.isPending}>{savePolicy.isPending ? "جارٍ الحفظ…" : "حفظ السياسة"}</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><PolicyInput label="بداية الدوام" type="time" value={policyForm.workStart} onChange={(value) => setPolicyForm({ ...policyForm, workStart: value })} /><PolicyInput label="نهاية الدوام" type="time" value={policyForm.workEnd} onChange={(value) => setPolicyForm({ ...policyForm, workEnd: value })} /><PolicyInput label="سماح التأخير (دقيقة)" type="number" value={policyForm.lateGraceMinutes} onChange={(value) => setPolicyForm({ ...policyForm, lateGraceMinutes: Number(value) })} /><PolicyInput label="سماح الانصراف المبكر" type="number" value={policyForm.earlyLeaveGraceMinutes} onChange={(value) => setPolicyForm({ ...policyForm, earlyLeaveGraceMinutes: Number(value) })} /><PolicySelect label="قاعدة التأخير" value={policyForm.lateDeductionRule} onChange={(value) => setPolicyForm({ ...policyForm, lateDeductionRule: value })} options={[["none","بلا خصم"],["per_minute","لكل دقيقة"],["per_occurrence","لكل مرة"]]} /><PolicySelect label="قاعدة الغياب" value={policyForm.absenceDeductionRule} onChange={(value) => setPolicyForm({ ...policyForm, absenceDeductionRule: value })} options={[["none","بلا خصم"],["daily_rate","الأجر اليومي"],["fixed_per_day","مبلغ ثابت لليوم"]]} /><PolicySelect label="قاعدة الانصراف المبكر" value={policyForm.earlyLeaveDeductionRule} onChange={(value) => setPolicyForm({ ...policyForm, earlyLeaveDeductionRule: value })} options={[["none","بلا خصم"],["per_minute","لكل دقيقة"],["per_occurrence","لكل مرة"]]} /><PolicyInput label="معدل خصم الانصراف" type="number" value={policyForm.earlyLeaveDeductionRate} onChange={(value) => setPolicyForm({ ...policyForm, earlyLeaveDeductionRate: Number(value) })} /><PolicySelect label="الإجازة غير المدفوعة" value={policyForm.unpaidLeaveDeductionRule} onChange={(value) => setPolicyForm({ ...policyForm, unpaidLeaveDeductionRule: value })} options={[["none","بلا خصم"],["daily_rate","الأجر اليومي"],["fixed_per_day","مبلغ ثابت لليوم"]]} /><PolicyInput label="معدل الإجازة غير المدفوعة" type="number" value={policyForm.unpaidLeaveDeductionRate} onChange={(value) => setPolicyForm({ ...policyForm, unpaidLeaveDeductionRate: Number(value) })} /><PolicyInput label="معامل إضافي العطلة" type="number" value={policyForm.weekendOvertimeMultiplier} onChange={(value) => setPolicyForm({ ...policyForm, weekendOvertimeMultiplier: Number(value) })} /><PolicyInput label="معامل إضافي الرسمية" type="number" value={policyForm.holidayOvertimeMultiplier} onChange={(value) => setPolicyForm({ ...policyForm, holidayOvertimeMultiplier: Number(value) })} /><label className="block text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">العطل الرسمية (YYYY-MM-DD، مفصولة بفواصل)<input value={policyForm.holidays.join(", ")} onChange={(event) => setPolicyForm({ ...policyForm, holidays: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} className="mt-1 min-h-10 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm text-foreground" /></label></div></section>}

      {showLeave && data?.canManageAll && <section className="rounded-xl border border-border/40 bg-card p-4"><h2 className="font-semibold">اعتماد إجازة موظف</h2><p className="mt-1 text-xs text-muted-foreground">يُسجّل القرار في الحضور والتدقيق ويعيد احتساب مسودات الرواتب المتأثرة.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs text-muted-foreground">الموظف<select value={leave.staffId} onChange={(event) => setLeave({ ...leave, staffId: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">اختر الموظف</option>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.fullName || staff.username}</option>)}</select></label><PolicyInput label="من" type="date" value={leave.from} onChange={(value) => setLeave({ ...leave, from: value })} /><PolicyInput label="إلى" type="date" value={leave.to} onChange={(value) => setLeave({ ...leave, to: value })} /><PolicySelect label="نوع الإجازة" value={leave.leaveType} onChange={(value) => setLeave({ ...leave, leaveType: value })} options={[["paid","مدفوعة"],["unpaid","غير مدفوعة"]]} /><label className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">سبب الاعتماد<textarea value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3 text-sm" /></label></div><div className="mt-3 flex justify-end"><Button disabled={approveLeave.isPending || !leave.staffId || leave.reason.trim().length < 3} onClick={() => approveLeave.mutate()}>{approveLeave.isPending ? "جارٍ الاعتماد…" : "اعتماد الإجازة"}</Button></div></section>}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-2"><UserCheck className="w-4 h-4 text-primary" /> الحاضرون الآن</p>
          <p className="text-2xl font-bold text-foreground mt-2">{presentNow.toLocaleString("ar-IQ")}</p>
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-2"><Clock3 className="w-4 h-4 text-primary" /> مجموع الساعات</p>
          <p className="text-2xl font-bold text-foreground mt-2">{totalHours.toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}</p>
        </div>
        <div className="bg-card rounded-xl border border-border/30 p-4">
          <p className="text-xs text-muted-foreground">عدد السجلات</p>
          <p className="text-2xl font-bold text-foreground mt-2">{(data?.data.length ?? 0).toLocaleString("ar-IQ")}</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select value={filters.staffId} onChange={(e) => setFilters({ ...filters, staffId: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الموظفين</option>
            {(data?.staff ?? []).map((staff) => <option key={staff.id} value={staff.id}>{staff.fullName || staff.username}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm" />
          <Button type="button" variant="outline" onClick={() => setFilters({ staffId: "", from: todayIso(), to: todayIso() })}>اليوم</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}</div>
      ) : !data?.data.length ? (
        <EmptyState message="لا توجد سجلات حضور" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">الموظف</th>
                  <th className="text-right p-3 font-medium">الحضور</th>
                  <th className="text-right p-3 font-medium">الانصراف</th>
                  <th className="text-right p-3 font-medium">الحالة</th>
                  <th className="text-right p-3 font-medium">الساعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-background/30">
                    <td className="p-3 font-medium text-foreground">{row.staffName || `موظف #${row.staffId}`}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.checkInAt)}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDate(row.checkOutAt)}</td>
                    <td className="p-3"><span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs">{STATUS_LABELS[row.status] ?? row.status}</span></td>
                    <td className="p-3 text-foreground">{row.hours.toLocaleString("ar-IQ", { maximumFractionDigits: 1 })}</td>
                  </tr>
                ))}
              </tbody>
              <TableTotalsFooter rows={data.data} allRows={data.data} labelColSpan={3} cells={[
                { key: "status", label: "الحضور", value: () => 0, format: (_, rows) => <span className="text-xs">حاضر {rows.filter((row) => row.status === "present").length.toLocaleString("ar-IQ")} / غائب {rows.filter((row) => row.status === "absent").length.toLocaleString("ar-IQ")}</span> },
                { key: "hours", label: "إجمالي الساعات", value: (row) => Number(row.hours ?? 0), format: (value) => value.toLocaleString("ar-IQ", { maximumFractionDigits: 1 }) },
              ]} />
            </table>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-border/40 bg-card p-4" aria-labelledby="my-payroll-title"><div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-primary" /><div><h2 id="my-payroll-title" className="font-semibold">ملخص رواتبي</h2><p className="text-xs text-muted-foreground">عرض للموظف الحالي فقط؛ الدفع والاعتماد غير متاحين من هنا.</p></div></div>{payrollQuery.isLoading ? <Skeleton className="mt-4 h-20 rounded-xl" /> : payrollQuery.data?.length ? <div className="mt-4 space-y-2">{payrollQuery.data.map((payroll) => <div key={payroll.id} className="flex flex-col gap-3 rounded-lg border border-border/40 p-3 sm:flex-row sm:items-center sm:justify-between"><div><b>{new Date(`${payroll.period}-01T00:00:00Z`).toLocaleDateString("ar-IQ", { month: "long", year: "numeric", timeZone: "UTC" })}</b><p className="mt-1 text-xs text-muted-foreground">{payroll.runNo} · {payroll.status}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><b className="tabular-nums">{Number(payroll.line.netSalary || 0).toLocaleString("en-US")} د.ع</b><Button size="sm" variant="outline" onClick={() => setSelectedPayroll(payroll)}><Eye className="ms-2 h-4 w-4" />تفاصيل احتساب الراتب</Button></div></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">لا توجد رواتب مسجلة لك حتى الآن.</p>}</section>

      <PayrollDetails payroll={selectedPayroll} onClose={() => setSelectedPayroll(null)} />
    </div>
  );
}

function PolicyInput({ label, type, value, onChange }: { label: string; type: string; value: string | number; onChange: (value: string) => void }) { return <label className="block text-xs text-muted-foreground">{label}<input type={type} min={type === "number" ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border/40 bg-background px-3 text-sm text-foreground" /></label>; }
function PolicySelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label className="block text-xs text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border/40 bg-background px-3 text-sm text-foreground">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }
function PayrollDetails({ payroll, onClose }: { payroll: OwnPayroll | null; onClose: () => void }) { if (!payroll) return null; const line = payroll.line, attendance = line.calculationDetails?.attendance ?? {}, formulas = line.calculationDetails?.formulas ?? {}; const rows: Array<[string, number, string?]> = [["الراتب الأساسي", line.baseSalary, formulas.baseSalary],["الإضافي", line.overtimeAmount, formulas.overtime],["المكافآت", line.bonusAmount],["البدلات", Number(line.attendanceAllowance || 0)+Number(line.transportationAllowance||0)+Number(line.foodAllowance||0)+Number(line.phoneAllowance||0)+Number(line.housingAllowance||0)+Number(line.otherFixedAllowances||0)],["الخصم اليدوي", line.manualDeduction],["خصم الغياب", line.absenceDeduction, formulas.absenceDeduction],["خصم التأخير", line.lateDeduction, formulas.lateDeduction],["خصم الانصراف المبكر", line.earlyLeaveDeduction, formulas.earlyLeaveDeduction],["خصم الإجازة غير المدفوعة", line.unpaidLeaveDeduction, formulas.unpaidLeaveDeduction],["إجمالي الراتب", line.grossSalary],["إجمالي الخصومات", line.totalDeductions],["صافي الراتب", line.netSalary]]; return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle>تفاصيل احتساب الراتب</DialogTitle><DialogDescription>{payroll.period} · يعرض هذا السجل راتبك أنت فقط.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Metric label="أيام الحضور" value={line.attendanceDays} /><Metric label="أيام الغياب" value={line.absenceDays} /><Metric label="إجازة مدفوعة" value={line.paidLeaveDays} /><Metric label="إجازة غير مدفوعة" value={line.unpaidLeaveDays} /><Metric label="دقائق التأخير" value={line.totalLateMinutes} /><Metric label="دقائق الانصراف المبكر" value={attendance.earlyLeaveMinutes ?? line.earlyLeaveMinutes} /><Metric label="ساعات العمل" value={line.totalWorkingHours} /><Metric label="ساعات الإضافي" value={line.overtimeHours} /></div><div className="divide-y rounded-xl border">{rows.map(([label, amount, reason]) => <div key={label} className="p-3"><div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{label}</span><b className="tabular-nums">{Number(amount || 0).toLocaleString("en-US")} د.ع</b></div>{reason && <p className="mt-1 text-xs leading-5 text-muted-foreground">{reason}</p>}</div>)}</div></DialogContent></Dialog>; }
function Metric({ label, value }: { label: string; value: unknown }) { return <div className="rounded-lg bg-muted/50 p-2"><span className="text-xs text-muted-foreground">{label}</span><b className="mt-1 block tabular-nums">{Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b></div>; }
