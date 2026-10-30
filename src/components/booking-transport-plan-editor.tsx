import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmployeeSelect } from "@/components/employee-select";
import { adminFetch, apiErrorMessage, formatCurrency } from "@/views/admin/_lib";
import { transportPlanFee, transportResourceUses, validateTransportPlan, type TransportFeeMode, type TransportPlan, type TransportReference, type TransportTrip } from "@/lib/booking-transport-plan";
import type { EmployeeIdentity } from "@/lib/employee-identity";
import type { TransportPlanResponse, TransportReceiptReference } from "./transport-receipt-dialog";

type Vehicle = { id: number; name: string; plateNumber?: string | null; isActive?: boolean };
export function changeTransportFeeMode(plan: TransportPlan, feeMode: TransportFeeMode): TransportPlan {
  if (plan.feeMode === feeMode) return plan;
  // Never allocate an overall charge among trips without an explicit user choice.
  const overallCharge = feeMode === "overall" && plan.trips.every(t => t.customerCharge != null)
    ? plan.trips.reduce((sum, t) => sum + Math.round(t.customerCharge! * 100), 0) / 100 : null;
  return { ...plan, feeMode, overallCharge, trips: plan.trips.map(t => ({ ...t, customerCharge: null })) };
}
const optionalText = (value: string) => value || null;
function localTime(value?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return parts.replace(" ", "T");
}
function FormError({ error }: { error: unknown }) {
  return error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{apiErrorMessage(error, "تعذر حفظ خطة النقل")}</p> : null;
}

export function BookingTransportPlanForm({ data, vehicles, drivers, onSave, busy, error }: {
  data: TransportPlanResponse; vehicles: Vehicle[]; drivers: EmployeeIdentity[];
  onSave: (plan: TransportPlan) => Promise<unknown>; busy: boolean; error?: unknown;
}) {
  const id = useId();
  const [plan, setPlan] = useState<TransportPlan>(() => ({ ...data.transportPlan, trips: data.transportPlan.trips.map(t => ({ ...t })) }));
  const [confirmed, setConfirmed] = useState(false), [validation, setValidation] = useState<unknown>(null);
  const disabled = busy || !data.capabilities.canEdit;
  const update = (index: number, patch: Partial<TransportTrip>) => setPlan(p => ({ ...p, trips: p.trips.map((t, i) => i === index ? { ...t, ...patch } : t) }));
  let summary: number | null = null;
  try { summary = transportPlanFee(validateTransportPlan(plan)); } catch { /* Incomplete local draft, never a server/API failure. */ }
  const modeChanged = plan.feeMode !== data.transportPlan.feeMode;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setValidation(null);
    try {
      if (modeChanged && !confirmed) throw new Error("أكد تغيير طريقة احتساب أجرة النقل قبل الحفظ");
      const valid = validateTransportPlan(plan);
      if (!valid.trips.length || valid.trips.some(t => !t.vehicleId)) throw new Error("أضف رحلة واختر مركبة لكل رحلة");
      if (transportPlanFee(valid) <= 0) throw new Error("أدخل أجرة نقل أكبر من صفر");
      if (data.resourceOccupancy) transportResourceUses(valid, data.resourceOccupancy);
      await onSave(valid);
    } catch (cause) { setValidation(cause); }
  };
  return <form onSubmit={event => void submit(event)} className="space-y-4" dir="rtl">
    {!data.capabilities.canEdit ? <p className="text-sm text-muted-foreground">عرض للقراءة فقط؛ تعديل الأجرة والإسناد يحتاج صلاحية مالية وتعديل الحجز، والحجوزات المدفوعة تتبع قيودها الأصلية.</p> : null}
    <Field><FieldLabel id={`${id}-mode`}>طريقة احتساب أجرة العميل</FieldLabel><ToggleGroup type="single" variant="outline" aria-labelledby={`${id}-mode`} value={plan.feeMode} disabled={disabled} className="flex-wrap justify-start" onValueChange={value => { if (value === "overall" || value === "per_trip") { setPlan(p => changeTransportFeeMode(p, value)); setConfirmed(false); } }}><ToggleGroupItem value="overall">أجرة كلية لجميع الرحلات</ToggleGroupItem><ToggleGroupItem value="per_trip">أجرة مستقلة لكل رحلة</ToggleGroupItem></ToggleGroup><FieldDescription>تُضاف الأجرة إلى الحجز مرة واحدة. أجرة العميل ليست دفعة للسائق ولا مصروفاً للمركبة.</FieldDescription></Field>
    {plan.feeMode === "overall" ? <Field><FieldLabel htmlFor={`${id}-overall`}>أجرة النقل الكلية للحجز — د.ع</FieldLabel><Input id={`${id}-overall`} type="number" min={0} max={1e9} step="0.01" inputMode="decimal" value={plan.overallCharge ?? ""} disabled={disabled} onChange={e => setPlan(p => ({ ...p, overallCharge: e.target.value === "" ? null : Number(e.target.value) }))}/></Field> : null}
    {plan.trips.map((trip, index) => <fieldset key={trip.id} disabled={disabled} className="min-w-0 rounded-xl border border-border bg-background p-4"><legend className="px-2 text-sm font-semibold">رحلة {trip.sequence}</legend><FieldGroup className="grid min-w-0 gap-4 sm:grid-cols-2">
      {([ ["transportType", "نوع النقل"], ["origin", "موقع الانطلاق"], ["destination", "موقع الوصول"], ["transportDate", "تاريخ النقل"], ["departureTime", "وقت الانطلاق"], ["expectedArrivalTime", "الوصول المتوقع"], ["driverPhone", "هاتف السائق"], ["assignedWork", "أعمال النقل المكلّف بها"] ] as const).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`${id}-${trip.id}-${key}`}>{label}</FieldLabel><Input id={`${id}-${trip.id}-${key}`} type={key === "transportDate" ? "date" : key.endsWith("Time") ? "time" : key === "driverPhone" ? "tel" : "text"} maxLength={key === "driverPhone" ? 30 : 500} dir={key === "driverPhone" ? "ltr" : undefined} value={trip[key] ?? ""} onChange={e => update(index, { [key]: optionalText(e.target.value) })}/></Field>)}
      <Field><FieldLabel htmlFor={`${id}-${trip.id}-vehicle`}>المركبة</FieldLabel><Select dir="rtl" disabled={disabled} value={trip.vehicleId ? String(trip.vehicleId) : ""} onValueChange={value => update(index, { vehicleId: Number(value) })}><SelectTrigger id={`${id}-${trip.id}-vehicle`}><SelectValue placeholder="اختر المركبة"/></SelectTrigger><SelectContent><SelectGroup>{vehicles.filter(v => v.isActive !== false || v.id === trip.vehicleId).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}{v.plateNumber ? ` · ${v.plateNumber}` : ""}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      <Field><FieldLabel htmlFor={`${id}-${trip.id}-driver`}>السائق</FieldLabel><EmployeeSelect id={`${id}-${trip.id}-driver`} employees={drivers} value={trip.driverId ? String(trip.driverId) : ""} onValueChange={value => update(index, { driverId: value ? Number(value) : null })} disabled={disabled} emptyLabel="بدون سائق محدد"/></Field>
      {plan.feeMode === "per_trip" ? <Field><FieldLabel htmlFor={`${id}-${trip.id}-charge`}>أجرة هذه الرحلة — د.ع</FieldLabel><Input id={`${id}-${trip.id}-charge`} type="number" min={0} max={1e9} step="0.01" inputMode="decimal" value={trip.customerCharge ?? ""} onChange={e => update(index, { customerCharge: e.target.value === "" ? null : Number(e.target.value) })}/></Field> : null}
      <Field className="sm:col-span-2"><FieldLabel htmlFor={`${id}-${trip.id}-notes`}>ملاحظات النقل</FieldLabel><Textarea id={`${id}-${trip.id}-notes`} maxLength={2000} value={trip.notes ?? ""} onChange={e => update(index, { notes: optionalText(e.target.value) })}/><FieldDescription>هذه الملاحظة مخصصة لوصل النقل؛ لا تضع ملاحظات إدارية خاصة هنا.</FieldDescription></Field>
    </FieldGroup><details className="mt-4 text-sm"><summary className="cursor-pointer py-2 font-medium">فترة تحميل ونقل وإرجاع المورد — اختياري</summary><p className="mb-3 text-xs text-muted-foreground">بتوقيت بغداد. بدون فترة محددة يُحجز المورد طوال فترة تشغيل الحجز. إعادة استخدامه في رحلة ثانية تتطلب فترتين غير متداخلتين.</p><div className="grid gap-4 sm:grid-cols-2">{([ ["start", "بداية انشغال المورد"], ["end", "نهاية الانشغال والإرجاع"] ] as const).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`${id}-${trip.id}-${key}`}>{label}</FieldLabel><Input id={`${id}-${trip.id}-${key}`} type="datetime-local" dir="ltr" value={localTime(trip.resourceOccupancy?.[key])} onChange={e => update(index, { resourceOccupancy: { start: trip.resourceOccupancy?.start ?? "", end: trip.resourceOccupancy?.end ?? "", [key]: e.target.value ? `${e.target.value}:00+03:00` : "" } })}/></Field>)}</div>{trip.resourceOccupancy ? <Button type="button" variant="ghost" className="mt-2" onClick={() => update(index, { resourceOccupancy: null })}>استخدام فترة الحجز الكاملة</Button> : null}</details></fieldset>)}
    {data.capabilities.canEdit ? <Button type="button" variant="outline" disabled={busy || plan.trips.length >= 50} onClick={() => setPlan(p => ({ ...p, trips: [...p.trips, { id: crypto.randomUUID(), sequence: Math.max(0, ...p.trips.map(t => t.sequence)) + 1, transportType: null, origin: null, destination: null, transportDate: null, departureTime: null, expectedArrivalTime: null, vehicleId: null, driverId: null, driverPhone: null, assignedWork: null, notes: null, customerCharge: p.feeMode === "per_trip" ? null : null, resourceOccupancy: null }] }))}><Plus data-icon="inline-start"/>إضافة رحلة نقل</Button> : null}
    <p className="rounded-xl bg-muted p-3 text-sm">المجموع قبل الحفظ: <b>{summary == null ? "أكمل أجور الرحلات" : formatCurrency(summary)}</b></p>
    {modeChanged ? <Field orientation="horizontal"><Checkbox id={`${id}-confirm`} checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={disabled}/><FieldLabel htmlFor={`${id}-confirm`}>أؤكد تغيير طريقة احتساب الأجرة وتحديث مبلغ الحجز مرة واحدة</FieldLabel></Field> : null}
    <FormError error={validation || error}/>
    {data.capabilities.canEdit ? <Button type="submit" disabled={busy}>{busy ? "جارٍ الحفظ والتحقق من التعارض…" : "حفظ خطة النقل"}</Button> : null}
  </form>;
}

export function BookingTransportPlanEditor({ reference, onPrint, sectionId }: { reference: TransportReference; onPrint: (ref: TransportReceiptReference) => void; sectionId?: string }) {
  const client = useQueryClient(), base = `/admin/booking-operations/${reference.source}/${reference.id}`;
  const transport = useQuery<TransportPlanResponse>({ queryKey: ["admin", "booking-operations", reference.source, reference.id, "transportation"], queryFn: () => adminFetch(`${base}/transportation`), retry: false });
  const editable = !!transport.data?.capabilities.canEdit;
  const vehicles = useQuery<{data: Vehicle[]}>({ queryKey: ["admin", "enterprise", "vehicles", "booking-editor"], queryFn: () => adminFetch("/admin/enterprise/vehicles"), enabled: editable, staleTime: 60_000 });
  const drivers = useQuery<EmployeeIdentity[]>({ queryKey: ["admin", "staff", "booking-editor"], queryFn: () => adminFetch("/admin/staff"), enabled: editable, staleTime: 60_000 });
  const save = useMutation({ mutationFn: (plan: TransportPlan) => adminFetch(reference.source === "kosha" ? `/admin/kosha-bookings/${reference.id}?source=kosha` : `${base}/transportation`, { method: reference.source === "kosha" ? "PATCH" : "POST", body: JSON.stringify({ transportPlan: plan, expectedTransportRevision: plan.revision }) }), onSuccess: async () => {
    await Promise.all([["admin", "booking-operations", reference.source, reference.id], ["admin", "booking-center"], ["admin", "booking-workspace"], ["admin", "enterprise", "vehicles"], ["transport-receipt", reference.source, reference.id]].map(queryKey => client.invalidateQueries({ queryKey })));
  } });
  const failed = transport.error || (editable && (vehicles.error || drivers.error));
  return <section id={sectionId} className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4" dir="rtl"><h2 className="flex items-center gap-2 font-bold"><Truck className="size-4 text-primary"/>رحلات النقل ووصولاتها</h2><p className="text-sm text-muted-foreground">تُحفظ الرحلات داخل الحجز الأصلي مع فحص تعارض السائق والمركبة. الطباعة لا تنشئ مصروفاً أو دفعة.</p>
    {failed ? <><FormError error={failed}/><Button type="button" variant="outline" onClick={() => { void transport.refetch(); if (editable) { void vehicles.refetch(); void drivers.refetch(); } }}>إعادة المحاولة</Button></> : transport.isPending || editable && (vehicles.isPending || drivers.isPending) ? <p role="status">تحميل بيانات النقل…</p> : transport.data ? <>
      <div className="flex flex-wrap gap-2">{transport.data.transportPlan.trips.map(trip => <Button key={trip.id} type="button" variant="outline" onClick={() => onPrint({ ...reference, tripId: trip.id })}><Printer data-icon="inline-start"/>وصل رحلة {trip.sequence}{trip.destination ? ` · ${trip.destination}` : ""}</Button>)}</div>
            <details open={!transport.data.transportPlan.legacy || undefined} className="min-w-0 text-sm"><summary className="cursor-pointer py-2 font-medium">{transport.data.transportPlan.trips.length ? "تقسيم النقل على عدة رحلات" : "إضافة رحلات نقل"}</summary><div className="pt-2"><BookingTransportPlanForm key={`${reference.source}:${reference.id}:${transport.data.transportPlan.revision}`} data={transport.data} vehicles={vehicles.data?.data ?? transport.data.assignmentOptions?.vehicles ?? []} drivers={drivers.data ?? transport.data.assignmentOptions?.drivers ?? []} onSave={plan => save.mutateAsync(plan)} busy={save.isPending} error={save.error}/></div></details>
    </> : null}</section>;
}
