import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ATTENDANCE_METHODS, ATTENDANCE_METHOD_LABELS, baghdadTime } from "@/lib/attendance-rules";
import { adminFetch, apiErrorMessage, formatCurrency } from "@/views/admin/_lib";

type Assigned = { id: number; name: string };
type ShiftRow = { shiftId: number; staffName: string | null; date: string; startMs: number; endMs: number; locationName: string | null; payAmount: number | null };
type Options = { locations: Array<{ id: number; name: string; isActive: boolean; latitude: number | null }>; capabilities: { canManage: boolean; canApprove: boolean } };

/**
 * Attendance shifts for people already assigned to this booking. Being assigned is not attending:
 * the employee still verifies at the venue, and this panel never adds an assignment.
 */
export function BookingAttendancePanel({ source, bookingId, eventDate }: { source: "kosha" | "service"; bookingId: number; eventDate: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ staffId: "", date: eventDate?.slice(0, 10) ?? "", start: "16:00", end: "23:00", locationId: "", requiredMethod: "gps", payAmount: "" });
  const assigned = useQuery<{ assignedStaff: Assigned[] }>({ queryKey: ["admin", "booking-operations", source, bookingId, "attendance-team"], queryFn: () => adminFetch(`/admin/attendance/booking-team?source=${source}&bookingId=${bookingId}`) });
  const options = useQuery<Options>({ queryKey: ["admin", "attendance", "options"], queryFn: () => adminFetch("/admin/attendance/options"), staleTime: 60_000 });
  const shifts = useQuery<{ data: ShiftRow[] }>({
    queryKey: ["admin", "attendance", "shifts", "booking", source, bookingId],
    queryFn: () => adminFetch(`/admin/attendance/shifts?bookingSource=${source}&bookingId=${bookingId}&from=2000-01-01&to=2100-01-01`),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] });
  const create = useMutation({
    mutationFn: () => adminFetch("/admin/attendance/shifts/from-booking", { method: "POST", body: JSON.stringify({ ...form, bookingSource: source, bookingId, staffId: Number(form.staffId), locationId: Number(form.locationId) || null }) }),
    onSuccess: () => { toast({ title: "أضيفت وردية الحضور" }); setForm({ ...form, staffId: "", payAmount: "" }); invalidate(); },
    onError: (error) => toast({ title: "تعذّر إضافة الوردية", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => adminFetch(`/admin/attendance/shifts/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "أُلغيت الوردية" }); invalidate(); },
    onError: (error) => toast({ title: "تعذّر الإلغاء", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const failure = assigned.error ?? options.error ?? shifts.error;
  if (failure) {
    const noAccess = options.isError && /صلاحية/.test(apiErrorMessage(options.error));
    return <div role={noAccess ? undefined : "alert"} className="rounded-xl border border-border/50 p-4 text-sm text-muted-foreground">{apiErrorMessage(failure)}{noAccess ? null : <Button type="button" variant="outline" size="sm" className="ms-2" onClick={() => { void assigned.refetch(); void options.refetch(); void shifts.refetch(); }}>إعادة المحاولة</Button>}</div>;
  }
  const canManage = options.data?.capabilities.canManage;
  const staff = assigned.data?.assignedStaff ?? [];
  const control = "mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm";
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4" dir="rtl">
      <div>
        <h2 className="flex items-center gap-2 font-bold"><CalendarClock className="h-4 w-4 text-primary" aria-hidden />حضور فريق الحجز</h2>
        <p className="mt-1 text-sm text-muted-foreground">التعيين على الحجز لا يعني الحضور؛ كل موظف يسجل حضوره من بوابته، والسجل يبقى مربوطاً بهذا الحجز.</p>
      </div>
      {canManage ? (
        staff.length ? (
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <label className="text-xs font-medium">الموظف<select required className={control} value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}><option value="">اختر من فريق الحجز</option>{staff.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="text-xs font-medium">التاريخ<Input type="date" required className="mt-1" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium">من<Input type="time" dir="ltr" required className="mt-1" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label>
              <label className="text-xs font-medium">إلى<Input type="time" dir="ltr" required className="mt-1" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
            </div>
            <label className="text-xs font-medium">موقع المناسبة<select className={control} value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">اختر الموقع</option>{(options.data?.locations ?? []).filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="text-xs font-medium">طريقة التحقق<select className={control} value={form.requiredMethod} onChange={(event) => setForm({ ...form, requiredMethod: event.target.value })}>{ATTENDANCE_METHODS.map((value) => <option key={value} value={value}>{ATTENDANCE_METHOD_LABELS[value]}</option>)}</select></label>
            <label className="text-xs font-medium">أجر المناسبة (اختياري)<Input type="number" min={0} className="mt-1" value={form.payAmount} onChange={(event) => setForm({ ...form, payAmount: event.target.value })} /></label>
            <div className="sm:col-span-2 lg:col-span-3"><Button disabled={create.isPending || !form.staffId || !form.date}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}إضافة وردية حضور</Button></div>
          </form>
        ) : <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">عيّن موظفين على الحجز أولاً، ثم أضف ورديات حضورهم هنا.</p>
      ) : null}
      {shifts.data?.data.length ? (
        <ul className="divide-y divide-border/40 rounded-xl border border-border/50">{shifts.data.data.map((row) => (
          <li key={row.shiftId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="min-w-0"><b>{row.staffName ?? "—"}</b> <span className="text-xs tabular-nums text-muted-foreground">{row.date} · {baghdadTime(row.startMs)}–{baghdadTime(row.endMs)}{row.locationName ? ` · ${row.locationName}` : ""}{row.payAmount ? ` · ${formatCurrency(row.payAmount)}` : ""}</span></span>
            {canManage ? <Button type="button" size="sm" variant="ghost" aria-label="إلغاء الوردية" disabled={cancel.isPending} onClick={() => cancel.mutate(row.shiftId)}><Trash2 className="h-3.5 w-3.5" /></Button> : null}
          </li>
        ))}</ul>
      ) : shifts.isPending ? null : <p className="text-sm text-muted-foreground">لا توجد ورديات حضور لهذا الحجز.</p>}
    </section>
  );
}
