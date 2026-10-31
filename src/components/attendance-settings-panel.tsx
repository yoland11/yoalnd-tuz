import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ATTENDANCE_METHODS, ATTENDANCE_METHOD_LABELS, DAY_LABELS, SCHEDULE_TYPES, SCHEDULE_TYPE_LABELS } from "@/lib/attendance-rules";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

export type AttendanceSettingsForm = {
  enabled: boolean; primaryLocationId: number | null; requiredMethod: string; eventMethod: string | null; allowedMethods: string[]; scheduleType: string;
  shiftStart: string | null; shiftEnd: string | null; weeklyDaysOff: string[] | null; graceMinutes: number | null; overtimeEligible: boolean | null; payrollIntegration: boolean | null; eventAttendance: boolean;
};
type Options = { locations: Array<{ id: number; name: string; isActive: boolean }>; capabilities: { canManage: boolean } };

const control = "mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm";
const triValue = (value: boolean | null) => (value === true ? "yes" : value === false ? "no" : "");
const triRead = (value: string) => (value === "yes" ? true : value === "no" ? false : null);
const selfMethods = ATTENDANCE_METHODS.filter((method) => method === "qr" || method === "gps" || method === "qr_gps");

/** «إعدادات الحضور والانصراف» for one employee. Empty schedule fields fall back to salary settings. */
export function AttendanceSettingsPanel({ staffId, onSaved }: { staffId: number; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const settings = useQuery<AttendanceSettingsForm>({ queryKey: ["admin", "attendance", "settings", staffId], queryFn: () => adminFetch(`/admin/attendance/settings/${staffId}`) });
  const options = useQuery<Options>({ queryKey: ["admin", "attendance", "options"], queryFn: () => adminFetch("/admin/attendance/options"), staleTime: 60_000 });
  const [draft, setDraft] = useState<AttendanceSettingsForm | null>(null);
  const form = draft ?? settings.data;
  const save = useMutation({
    mutationFn: (value: AttendanceSettingsForm) => adminFetch(`/admin/attendance/settings/${staffId}`, { method: "PUT", body: JSON.stringify(value) }),
    onSuccess: () => {
      toast({ title: "تم حفظ إعدادات الحضور" });
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "attendance"] });
      onSaved?.();
    },
  });
  if (settings.isError || options.isError)
    return <p role="alert" className="text-sm text-destructive">{apiErrorMessage(settings.error ?? options.error)} <Button type="button" variant="outline" size="sm" onClick={() => { void settings.refetch(); void options.refetch(); }}>إعادة المحاولة</Button></p>;
  if (!form || !options.data) return <p className="text-sm text-muted-foreground"><Loader2 className="me-1 inline h-4 w-4 animate-spin" aria-hidden />جارٍ التحميل…</p>;
  const set = (patch: Partial<AttendanceSettingsForm>) => setDraft({ ...form, ...patch });
  const canEdit = options.data.capabilities.canManage;
  const daysOff = form.weeklyDaysOff ?? [];
  return (
    <fieldset disabled={!canEdit || save.isPending} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="flex min-h-10 items-center gap-2 text-sm font-semibold sm:col-span-2">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        تفعيل تسجيل الحضور بالتحقق لهذا الموظف
      </label>
      <label className="text-sm font-medium">موقع العمل الأساسي
        <select className={control} value={form.primaryLocationId ?? ""} onChange={(event) => set({ primaryLocationId: Number(event.target.value) || null })}>
          <option value="">بدون موقع ثابت</option>
          {options.data.locations.filter((row) => row.isActive || row.id === form.primaryLocationId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">نظام الدوام
        <select className={control} value={form.scheduleType} onChange={(event) => set({ scheduleType: event.target.value })}>
          {SCHEDULE_TYPES.map((type) => <option key={type} value={type}>{SCHEDULE_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">طريقة التحقق المطلوبة
        <select className={control} value={form.requiredMethod} onChange={(event) => set({ requiredMethod: event.target.value })}>
          {ATTENDANCE_METHODS.map((method) => <option key={method} value={method}>{ATTENDANCE_METHOD_LABELS[method]}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">طريقة التحقق في المناسبات
        <select className={control} value={form.eventMethod ?? ""} onChange={(event) => set({ eventMethod: event.target.value || null })}>
          <option value="">نفس الطريقة أعلاه</option>
          {ATTENDANCE_METHODS.map((method) => <option key={method} value={method}>{ATTENDANCE_METHOD_LABELS[method]}</option>)}
        </select>
      </label>
      <div className="text-sm font-medium sm:col-span-2">الطرق المسموحة
        <div className="mt-1 flex flex-wrap gap-3">
          {selfMethods.map((method) => (
            <label key={method} className="flex min-h-9 items-center gap-1.5 font-normal">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.allowedMethods.includes(method)} onChange={(event) => set({ allowedMethods: event.target.checked ? [...form.allowedMethods, method] : form.allowedMethods.filter((value) => value !== method) })} />
              {ATTENDANCE_METHOD_LABELS[method]}
            </label>
          ))}
          <span className="flex min-h-9 items-center text-xs font-normal text-muted-foreground">جهاز البصمة: غير مرتبط حالياً</span>
        </div>
      </div>
      {form.scheduleType === "fixed" || form.scheduleType === "part_time" ? (
        <>
          <label className="text-sm font-medium">بداية الدوام<Input type="time" dir="ltr" className="mt-1" value={form.shiftStart ?? ""} onChange={(event) => set({ shiftStart: event.target.value || null })} /></label>
          <label className="text-sm font-medium">نهاية الدوام<Input type="time" dir="ltr" className="mt-1" value={form.shiftEnd ?? ""} onChange={(event) => set({ shiftEnd: event.target.value || null })} /></label>
          <div className="text-sm font-medium sm:col-span-2">أيام الراحة
            <div className="mt-1 flex flex-wrap gap-3">
              {Object.entries(DAY_LABELS).map(([key, label]) => (
                <label key={key} className="flex min-h-9 items-center gap-1.5 font-normal">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={daysOff.includes(key)} onChange={(event) => set({ weeklyDaysOff: event.target.checked ? [...daysOff, key] : daysOff.filter((value) => value !== key) })} />
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs font-normal text-muted-foreground">إذا تركتها فارغة تُستخدم أيام الراحة من إعدادات الراتب. نهاية قبل البداية تعني دواماً يعبر منتصف الليل.</p>
          </div>
        </>
      ) : <p className="text-xs text-muted-foreground sm:col-span-2">يُحدَّد دوام هذا الموظف من تبويب «الورديات»؛ لا يُحسب غائباً في يوم بلا وردية.</p>}
      <label className="text-sm font-medium">فترة السماح (دقيقة)<Input type="number" min={0} max={240} className="mt-1" value={form.graceMinutes ?? ""} placeholder="حسب سياسة الشركة" onChange={(event) => set({ graceMinutes: event.target.value === "" ? null : Number(event.target.value) })} /></label>
      <label className="text-sm font-medium">احتساب الإضافي
        <select className={control} value={triValue(form.overtimeEligible)} onChange={(event) => set({ overtimeEligible: triRead(event.target.value) })}>
          <option value="">حسب إعدادات الراتب</option><option value="yes">نعم</option><option value="no">لا</option>
        </select>
      </label>
      <label className="text-sm font-medium">الربط بالرواتب
        <select className={control} value={triValue(form.payrollIntegration)} onChange={(event) => set({ payrollIntegration: triRead(event.target.value) })}>
          <option value="">حسب إعدادات الراتب</option><option value="yes">نعم</option><option value="no">لا</option>
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-2 self-end text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.eventAttendance} onChange={(event) => set({ eventAttendance: event.target.checked })} />
        يسجل حضور المناسبات
      </label>
      {save.isError ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{apiErrorMessage(save.error)}</p> : null}
      {canEdit ? <div className="sm:col-span-2"><Button type="button" disabled={save.isPending || !draft} onClick={() => save.mutate(form)}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ إعدادات الحضور</Button></div> : <p className="text-xs text-muted-foreground sm:col-span-2">للعرض فقط؛ التعديل لمدير الحضور.</p>}
    </fieldset>
  );
}
