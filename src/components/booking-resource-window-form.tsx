import { useEffect, useId, useRef, useState } from "react";
import { Clock3, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { parseBookingResourceWindow, resourceWindowCalendar, type BookingResourceWindow } from "@/lib/booking-resource-window";

export type BookingResourceWindowData = {
  resourceWindow: BookingResourceWindow | null;
  expectedWindow: unknown;
  eventDate: string | null;
  eventTime: string | null;
  canEdit: boolean;
  canReschedule?: boolean;
};
export type ResourceWindowCalendarChange = { eventDate: string; expectedEventDate: string | null };
const fields = [
  ["preparationStart", "بداية التجهيز", "يشمل التحميل والنقل والتركيب قبل المناسبة."],
  ["eventStart", "بداية المناسبة", "يجب أن يطابق تاريخ المناسبة المسجل في الحجز."],
  ["eventEnd", "نهاية المناسبة", "وقت انتهاء المناسبة، وليس انتهاء إشغال المعدات."],
  ["returnEnd", "اكتمال الإرجاع", "يشمل الفك والنقل وفحص المعدات عند عودتها."],
] as const;
type Draft = Record<keyof BookingResourceWindow, string>;
export type ResourceWindowDraft=Draft;
export function baghdadLocal(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
const draftOf = (value: BookingResourceWindow | null): Draft => Object.fromEntries(fields.map(([key]) => [key, baghdadLocal(value?.[key])])) as Draft;
export const resourceWindowDraftOf = draftOf;
export const emptyResourceWindowDraft=()=>draftOf(null);
export function resourceWindowFromLocal(draft:Draft,eventDate?:string|null){
  return parseBookingResourceWindow(Object.fromEntries(fields.map(([key])=>[key,draft[key]?`${draft[key]}${draft[key].length===16?":00":""}+03:00`:""])),eventDate);
}
export function BookingResourceWindowInputs({draft,disabled=false,onChange}:{draft:Draft;disabled?:boolean;onChange:(key:keyof BookingResourceWindow,value:string)=>void}){
  const prefix=useId();
  return <FieldGroup className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">{fields.map(([key,label,description])=><Field key={key} className="min-w-0 gap-2"><FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel><Input id={`${prefix}-${key}`} name={key} type="datetime-local" step="1" dir="ltr" className="min-h-11 min-w-0 max-w-full text-sm" required value={draft[key]} disabled={disabled} onChange={event=>onChange(key,event.target.value)} aria-describedby={`${prefix}-${key}-help`}/><FieldDescription id={`${prefix}-${key}-help`}>{description}</FieldDescription></Field>)}</FieldGroup>;
}

/** No guessed duration or reservation side effect. The expected snapshot stays
 * with the draft: a background refresh cannot silently overwrite unsaved times. */
export function BookingResourceWindowForm({ data, loading = false, error, onRetry, onSave, optional = false }: {
  data?: BookingResourceWindowData;
  /** Bookings: without a period the whole event day is held. Photography still requires one. */
  optional?: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSave: (window: BookingResourceWindow, expected: unknown, calendar?: ResourceWindowCalendarChange) => Promise<unknown>;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState(() => draftOf(data?.resourceWindow ?? null));
  const [expected, setExpected] = useState<unknown>(data?.expectedWindow ?? null);
  const [expectedDate, setExpectedDate] = useState<string | null>(data?.eventDate ?? null);
  const [reschedule, setReschedule] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (data && !dirty && !inFlight.current) {
      setDraft(draftOf(data.resourceWindow));
      setExpected(data.expectedWindow);
      setExpectedDate(data.eventDate);
    }
  }, [data, dirty]);
  const title = <header className="flex items-start gap-2"><Clock3 aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-primary" /><div><h2 className="text-lg font-semibold">فترة تشغيل الموارد</h2><p className="mt-1 max-w-prose text-sm text-muted-foreground">من بداية التجهيز إلى اكتمال الإرجاع. جميع المواعيد بتوقيت بغداد؛ حفظ الفترة وحدها لا يصرف مخزوناً ولا يغيّر تاريخ الحجز.</p></div></header>;
  if (loading && !data) return <section dir="rtl" aria-label="تحميل فترة تشغيل الموارد" className="space-y-3 rounded-xl border border-border p-4"><Skeleton className="h-12" /><Skeleton className="h-40" /></section>;
  return <section dir="rtl" aria-label="فترة تشغيل الموارد" className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
    {title}
    {error ? <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><strong>تعذر قراءة المواعيد الحالية</strong><p className="mt-1">لا يمكن اعتماد توفر الموارد من هذه القراءة. أعد المحاولة قبل حفظ المواعيد.</p>{onRetry ? <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={onRetry} disabled={loading}>إعادة المحاولة</Button> : null}</div> : null}
    {data ? <form className="mt-4 space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (inFlight.current || !data.canEdit || error || loading) return;
      setSaveError(""); setSaved(false);
      let window: BookingResourceWindow;
      const changeCalendar = reschedule && data.canReschedule;
      try { window = resourceWindowFromLocal(draft, changeCalendar ? undefined : data.eventDate); }
      catch (cause) { setSaveError(cause instanceof Error ? cause.message : "تحقق من مواعيد التشغيل"); return; }
      inFlight.current = true; setPending(true);
      try {
        const calendar = changeCalendar ? { eventDate: resourceWindowCalendar(window).eventDate, expectedEventDate: expectedDate } : undefined;
        await onSave(window, expected, calendar);
        if (mounted.current) { setExpected(window); if (calendar) setExpectedDate(calendar.eventDate); setDirty(false); setSaved(true); }
      } catch (cause) { if (mounted.current) setSaveError(cause instanceof Error ? cause.message : "تعذر حفظ المواعيد؛ احتفظنا بالمدخلات لإعادة المحاولة"); }
      finally { inFlight.current = false; if (mounted.current) setPending(false); }
    }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-y border-border py-3 text-sm"><p>تاريخ المناسبة المسجل: <bdi dir="ltr" className="font-medium">{data.eventDate?.slice(0, 10) || "غير مسجل"}{data.eventTime ? ` · ${data.eventTime}` : ""}</bdi></p><p className={data.resourceWindow || optional ? "text-foreground" : "font-medium text-primary"}>{data.resourceWindow ? "فترة تشغيل مسجلة" : optional ? "اختيارية — بدونها يُحجز يوم المناسبة كاملاً" : "مواعيد التشغيل غير مكتملة"}</p></div>
      {data.canEdit && data.canReschedule ? <Field className="gap-2 rounded-lg border border-border p-3"><div className="flex items-start gap-3"><Checkbox id={`${prefix}-reschedule`} checked={reschedule} disabled={pending || !!error || loading} onCheckedChange={checked => { setReschedule(checked === true); setDirty(true); setSaved(false); setSaveError(""); }} aria-describedby={`${prefix}-reschedule-help`} className="mt-1" /><FieldLabel htmlFor={`${prefix}-reschedule`} className="min-h-8 cursor-pointer">تعديل موعد الحجز مع فترة الموارد</FieldLabel></div><FieldDescription id={`${prefix}-reschedule-help`}>عند تفعيله، يُحفظ تاريخ ووقت الحجز من بداية المناسبة أدناه مع الفترة في عملية واحدة، بعد مراجعة التعارضات. اتركه مغلقاً لحفظ الفترة فقط.</FieldDescription></Field> : null}
      <BookingResourceWindowInputs draft={draft} disabled={!data.canEdit || pending || !!error || loading} onChange={(key,value)=>{setDraft(current=>({...current,[key]:value}));setDirty(true);setSaved(false);setSaveError("");}}/>
      {saveError ? <p role="alert" className="break-words rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{saveError}</p> : null}
      {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{reschedule && data.canReschedule ? "تم حفظ موعد الحجز وفترة الموارد" : "تم حفظ فترة تشغيل الموارد"}</p> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="max-w-prose text-sm text-muted-foreground">{optional ? "تُراجع التعارضات عند حجز الموارد. بدون فترة يُعتبر الفريق والسيارة والمعدات محجوزين طوال يوم المناسبة؛ حدّدها إذا احتجت دقة بالساعات." : "تُراجع التعارضات عند حجز الموارد. المواعيد الناقصة لا تعني أن المعدات أو الفريق متاحون."}</p>{data.canEdit ? <Button type="submit" disabled={pending || !!error || loading || !dirty} className="min-h-11 w-full sm:w-auto"><Save aria-hidden="true" />{pending ? "جارٍ حفظ المواعيد" : reschedule && data.canReschedule ? "حفظ موعد الحجز والفترة" : "حفظ فترة التشغيل"}</Button> : <p className="text-sm">عرض فقط — تعديل المواعيد يتطلب صلاحية تعديل الحجز.</p>}</footer>
    </form> : null}
  </section>;
}
