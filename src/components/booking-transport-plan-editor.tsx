import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/employee-select";
import { adminFetch, apiErrorMessage, formatCurrency } from "@/views/admin/_lib";
import { transportPlanFee, transportResourceUses, validateTransportPlan, type TransportFeeMode, type TransportPlan, type TransportReference, type TransportTrip } from "@/lib/booking-transport-plan";
import type { EmployeeIdentity } from "@/lib/employee-identity";
import type { TransportPlanResponse, TransportReceiptReference } from "./transport-receipt-dialog";

type Vehicle = { id: number; name: string; plateNumber?: string | null; isActive?: boolean };
type LegacyMode = "ajn" | "customer" | null;

export function changeTransportFeeMode(plan: TransportPlan, feeMode: TransportFeeMode): TransportPlan {
  if (plan.feeMode === feeMode) return plan;
  // Never allocate an overall charge among trips without an explicit user choice.
  const overallCharge = feeMode === "overall" && plan.trips.every(t => t.customerCharge != null)
    ? plan.trips.reduce((sum, t) => sum + Math.round(t.customerCharge! * 100), 0) / 100 : null;
  return { ...plan, feeMode, overallCharge, trips: plan.trips.map(t => ({ ...t, customerCharge: null })) };
}

function emptyTrip(sequence: number, vehicleId: number | null = null): TransportTrip {
  return { id: crypto.randomUUID(), sequence, transportType: null, origin: null, destination: null, transportDate: null, departureTime: null, expectedArrivalTime: null, vehicleId, driverId: null, driverPhone: null, assignedWork: null, notes: null, customerCharge: null, resourceOccupancy: null };
}

/** A second trip on a one-trip plan priced as a whole: that whole price simply
 * becomes the first trip's price (no split is invented) and each trip then has
 * its own fee, so every vehicle's account gets its own trip's money. */
export function addTransportTrip(plan: TransportPlan, vehicleId: number | null = null): TransportPlan {
  const next = emptyTrip(Math.max(0, ...plan.trips.map(t => t.sequence)) + 1, vehicleId);
  if (!plan.trips.length) return { ...plan, feeMode: "per_trip", overallCharge: null, trips: [next] };
  if (plan.feeMode === "overall" && plan.trips.length === 1)
    return { ...plan, feeMode: "per_trip", overallCharge: null, trips: [{ ...plan.trips[0], customerCharge: plan.overallCharge }, next] };
  return { ...plan, trips: [...plan.trips, next] };
}

const optionalText = (value: string) => value || null;
function localTime(value?: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return parts.replace(" ", "T");
}
function FormError({ error }: { error: unknown }) {
  return error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{apiErrorMessage(error, "تعذر حفظ النقل")}</p> : null;
}
const money = (value: number | null) => value == null || value === 0 ? "" : value;
const amountInput = (value: string) => value === "" ? null : Number(value);

export function BookingTransportPlanForm({ data, vehicles, drivers, onSave, busy, error, startWithTrip = false, suggestedVehicleId = null }: {
  data: TransportPlanResponse; vehicles: Vehicle[]; drivers: EmployeeIdentity[];
  onSave: (plan: TransportPlan) => Promise<unknown>; busy: boolean; error?: unknown;
  /** Open with one empty trip when nothing is saved yet. */
  startWithTrip?: boolean; suggestedVehicleId?: number | null;
}) {
  const id = useId();
  const saved = data.transportPlan;
  const [plan, setPlan] = useState<TransportPlan>(() => {
    const copy = { ...saved, trips: saved.trips.map(t => ({ ...t })) };
    return startWithTrip && !copy.trips.length ? addTransportTrip(copy, suggestedVehicleId) : copy;
  });
  const [confirmed, setConfirmed] = useState(false), [validation, setValidation] = useState<unknown>(null);
  const disabled = busy || !data.capabilities.canEdit;
  const savedIds = new Set(saved.trips.map(t => t.id));
  const update = (index: number, patch: Partial<TransportTrip>) => setPlan(p => ({ ...p, trips: p.trips.map((t, i) => i === index ? { ...t, ...patch } : t) }));
  let summary: number | null = null;
  try { summary = transportPlanFee(validateTransportPlan(plan)); } catch { /* Incomplete local draft, never a server/API failure. */ }
  // Only an explicit switch of a saved multi-trip plan needs a confirmation; adding
  // a trip keeps the saved fee exactly where it was.
  const explicitSwitch = plan.feeMode !== saved.feeMode && saved.trips.length > 1;
  const overall = plan.feeMode === "overall";
  const singleOverall = overall && plan.trips.length <= 1;
  const legacyInfoFee = saved.legacy && (data.transportation as any)?.mode === "ajn" && (data.transportation as any)?.inTotal !== true && !(data.transportation as any)?.vehicleId;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setValidation(null);
    try {
      if (explicitSwitch && !confirmed) throw new Error("أكد تغيير طريقة الأجرة قبل الحفظ");
      const valid = validateTransportPlan(plan);
      if (!valid.trips.length || valid.trips.some(t => !t.vehicleId)) throw new Error("اختر السيارة لكل رحلة");
      if (transportPlanFee(valid) <= 0) throw new Error("اكتب أجرة النقل");
      if (data.resourceOccupancy) transportResourceUses(valid, data.resourceOccupancy);
      await onSave(valid);
    } catch (cause) { setValidation(cause); }
  };
  const feeField = (trip: TransportTrip, index: number) => singleOverall
    ? <Field><FieldLabel htmlFor={`${id}-overall`}>الأجرة — د.ع</FieldLabel><Input id={`${id}-overall`} type="number" min={0} max={1e9} step="0.01" inputMode="decimal" value={money(plan.overallCharge)} onChange={e => setPlan(p => ({ ...p, overallCharge: amountInput(e.target.value) }))}/></Field>
    : overall ? null
    : <Field><FieldLabel htmlFor={`${id}-${trip.id}-charge`}>الأجرة — د.ع</FieldLabel><Input id={`${id}-${trip.id}-charge`} type="number" min={0} max={1e9} step="0.01" inputMode="decimal" value={money(trip.customerCharge)} onChange={e => update(index, { customerCharge: amountInput(e.target.value) })}/></Field>;
  return <form onSubmit={event => void submit(event)} className="space-y-4" dir="rtl">
    {!data.capabilities.canEdit ? <p className="text-sm text-muted-foreground">للعرض فقط: تعديل النقل يحتاج صلاحية مالية وتعديل الحجز، وحجز الكوشة المدفوع ما يتغيّر نقله.</p> : null}
    {legacyInfoFee ? <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-200">هذه الأجرة مسجّلة للعلم فقط وما مضافة لمبلغ الحجز. اختر السيارة واحفظ حتى تنضاف مرة وحدة.</p> : null}
    {overall && !singleOverall ? <div className="rounded-xl border border-border bg-muted/40 p-3">
      <Field><FieldLabel htmlFor={`${id}-overall`}>أجرة واحدة لكل الرحلات — د.ع</FieldLabel><Input id={`${id}-overall`} type="number" min={0} max={1e9} step="0.01" inputMode="decimal" value={money(plan.overallCharge)} disabled={disabled} onChange={e => setPlan(p => ({ ...p, overallCharge: amountInput(e.target.value) }))}/>
        <FieldDescription>الأجرة الوحدة ما تنحسب لأي سيارة بعينها.</FieldDescription></Field>
      {data.capabilities.canEdit ? <Button type="button" variant="outline" size="sm" className="mt-2" disabled={disabled} onClick={() => { setPlan(p => changeTransportFeeMode(p, "per_trip")); setConfirmed(false); }}>أجرة لكل رحلة</Button> : null}
    </div> : null}
    {plan.trips.map((trip, index) => {
      const extras = [trip.transportType, trip.expectedArrivalTime, trip.driverPhone, trip.assignedWork, trip.notes].some(Boolean);
      const route = [trip.origin, trip.destination, trip.transportDate, trip.departureTime].some(Boolean);
      return <fieldset key={trip.id} disabled={disabled} className="min-w-0 rounded-xl border border-border bg-background p-4">
        <legend className="px-2 text-sm font-semibold">{plan.trips.length > 1 ? `رحلة ${trip.sequence}` : "الرحلة"}</legend>
        {!savedIds.has(trip.id) && plan.trips.length > 1 ? <Button type="button" variant="ghost" size="sm" className="float-left -mt-2 h-8 gap-1 text-destructive" onClick={() => setPlan(p => ({ ...p, trips: p.trips.filter(t => t.id !== trip.id) }))}><Trash2 className="h-3.5 w-3.5"/>حذف</Button> : null}
        <FieldGroup className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Field><FieldLabel htmlFor={`${id}-${trip.id}-vehicle`}>السيارة</FieldLabel><Select dir="rtl" disabled={disabled} value={trip.vehicleId ? String(trip.vehicleId) : ""} onValueChange={value => update(index, { vehicleId: Number(value) })}><SelectTrigger id={`${id}-${trip.id}-vehicle`}><SelectValue placeholder="اختر السيارة"/></SelectTrigger><SelectContent><SelectGroup>{vehicles.filter(v => v.isActive !== false || v.id === trip.vehicleId).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}{v.plateNumber ? ` · ${v.plateNumber}` : ""}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor={`${id}-${trip.id}-driver`}>السائق</FieldLabel><EmployeeSelect id={`${id}-${trip.id}-driver`} employees={drivers} value={trip.driverId ? String(trip.driverId) : ""} onValueChange={value => update(index, { driverId: value ? Number(value) : null })} disabled={disabled} emptyLabel="بدون سائق محدد"/></Field>
          {feeField(trip, index)}
        </FieldGroup>
        <details className="mt-4 min-w-0 border-t border-border text-sm">
          <summary className="cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            تفاصيل الرحلة
            {route ? <span className="ms-2 inline-block rounded-md bg-muted px-2 py-1 text-xs font-normal">مكان ووقت</span> : null}
            {trip.resourceOccupancy ? <span className="ms-2 inline-block rounded-md bg-muted px-2 py-1 text-xs font-normal">فترة مخصصة</span> : null}
            {extras ? <span className="ms-2 inline-block rounded-md bg-muted px-2 py-1 text-xs font-normal">بيانات إضافية</span> : null}
          </summary>
          <FieldGroup className="grid min-w-0 gap-4 pt-2 sm:grid-cols-2">
            {([ ["origin", "موقع الانطلاق"], ["destination", "موقع الوصول"], ["transportDate", "تاريخ النقل"], ["departureTime", "وقت الانطلاق"], ["expectedArrivalTime", "الوصول المتوقع"], ["transportType", "نوع النقل"], ["driverPhone", "هاتف السائق"], ["assignedWork", "أعمال النقل المكلّف بها"] ] as const).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`${id}-${trip.id}-${key}`}>{label}</FieldLabel><Input id={`${id}-${trip.id}-${key}`} type={key === "transportDate" ? "date" : key === "departureTime" || key === "expectedArrivalTime" ? "time" : key === "driverPhone" ? "tel" : "text"} maxLength={key === "driverPhone" ? 30 : 500} dir={key === "driverPhone" ? "ltr" : undefined} value={trip[key] ?? ""} onChange={e => update(index, { [key]: optionalText(e.target.value) })}/></Field>)}
            <Field className="sm:col-span-2"><FieldLabel htmlFor={`${id}-${trip.id}-notes`}>ملاحظات النقل</FieldLabel><Textarea id={`${id}-${trip.id}-notes`} maxLength={2000} value={trip.notes ?? ""} onChange={e => update(index, { notes: optionalText(e.target.value) })}/><FieldDescription>تطلع على وصل النقل.</FieldDescription></Field>
          </FieldGroup>
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-1 font-medium">وقت انشغال السيارة والسائق (اختياري)</h3>
            <p className="mb-3 text-xs text-muted-foreground">بدونه تنحجز السيارة يوم المناسبة كله. حدده إذا نفس السيارة تطلع برحلتين بنفس اليوم.</p>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">{([ ["start", "يبدأ من"], ["end", "ينتهي ويرجع"] ] as const).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`${id}-${trip.id}-${key}`}>{label}</FieldLabel><Input id={`${id}-${trip.id}-${key}`} type="datetime-local" dir="ltr" value={localTime(trip.resourceOccupancy?.[key])} onChange={e => update(index, { resourceOccupancy: { start: trip.resourceOccupancy?.start ?? "", end: trip.resourceOccupancy?.end ?? "", [key]: e.target.value ? `${e.target.value}:00+03:00` : "" } })}/></Field>)}</div>
            {trip.resourceOccupancy ? <Button type="button" variant="ghost" className="mt-2" onClick={() => update(index, { resourceOccupancy: null })}>طول يوم المناسبة</Button> : null}
          </div>
        </details>
      </fieldset>;
    })}
    {data.capabilities.canEdit ? <Button type="button" variant="outline" disabled={busy || plan.trips.length >= 50} onClick={() => setPlan(p => addTransportTrip(p))}><Plus data-icon="inline-start"/>{plan.trips.length === 1 ? "إضافة رحلة ثانية" : "إضافة رحلة"}</Button> : null}
    <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-muted p-3 text-sm"><span>مجموع أجرة النقل <span className="text-xs text-muted-foreground">(تنضاف لمبلغ الحجز مرة وحدة)</span></span><b className="tabular-nums">{summary == null ? "أكمل الأجرة" : formatCurrency(summary)}</b></p>
    {explicitSwitch ? <Field orientation="horizontal"><Checkbox id={`${id}-confirm`} checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={disabled}/><FieldLabel htmlFor={`${id}-confirm`}>أؤكد تغيير طريقة الأجرة وتحديث مبلغ الحجز</FieldLabel></Field> : null}
    <FormError error={validation || error}/>
    {data.capabilities.canEdit ? <Button type="submit" disabled={busy}>{busy ? "جارٍ الحفظ والتحقق من التعارض…" : "حفظ النقل"}</Button> : null}
  </form>;
}

const MODES: Array<[Exclude<LegacyMode, null> | "none", string]> = [["ajn", "النقل علينا"], ["customer", "على الزبون"], ["none", "بدون نقل"]];

/** The one transport card of a booking: who transports, then car, driver and fee per trip. */
export function BookingTransportPlanEditor({ reference, onPrint, sectionId }: { reference: TransportReference; onPrint: (ref: TransportReceiptReference) => void; sectionId?: string }) {
  const client = useQueryClient(), base = `/admin/booking-operations/${reference.source}/${reference.id}`;
  const transport = useQuery<TransportPlanResponse & { dispatchVehicle?: { id: number } | null }>({ queryKey: ["admin", "booking-operations", reference.source, reference.id, "transportation"], queryFn: () => adminFetch(`${base}/transportation`), retry: false });
  const editable = !!transport.data?.capabilities.canEdit;
  const vehicles = useQuery<{data: Vehicle[]}>({ queryKey: ["admin", "enterprise", "vehicles", "booking-editor"], queryFn: () => adminFetch("/admin/enterprise/vehicles"), enabled: editable, staleTime: 60_000 });
  const drivers = useQuery<EmployeeIdentity[]>({ queryKey: ["admin", "staff", "booking-editor"], queryFn: () => adminFetch("/admin/staff"), enabled: editable, staleTime: 60_000 });
  const [choice, setChoice] = useState<LegacyMode | undefined>(undefined);
  const invalidate = () => Promise.all([["admin", "booking-operations", reference.source, reference.id], ["admin", "booking-center"], ["admin", "booking-workspace"], ["admin", "enterprise", "vehicles"], ["admin", "vehicle"], ["transport-receipt", reference.source, reference.id]].map(queryKey => client.invalidateQueries({ queryKey })));
  const save = useMutation({ mutationFn: (plan: TransportPlan) => adminFetch(reference.source === "kosha" ? `/admin/kosha-bookings/${reference.id}?source=kosha` : `${base}/transportation`, { method: reference.source === "kosha" ? "PATCH" : "POST", body: JSON.stringify({ transportPlan: plan, expectedTransportRevision: plan.revision }) }), onSuccess: async () => { setChoice(undefined); await invalidate(); } });
  // «على الزبون» / «بدون نقل» exist only before a trip plan is saved (the server keeps a saved plan's trips).
  const setMode = useMutation({ mutationFn: (mode: Exclude<LegacyMode, "ajn">) => reference.source === "kosha"
      ? adminFetch(`/admin/kosha-bookings/${reference.id}?source=kosha`, { method: "PATCH", body: JSON.stringify({ transportationMode: mode, transportationFee: 0, transportationVehicleId: null, transportationDriverId: null, transportationNotes: null }) })
      : adminFetch(`${base}/transportation`, { method: "POST", body: JSON.stringify({ mode, fee: 0, vehicleId: null, driverId: null, note: null }) }),
    onSuccess: async () => { setChoice(undefined); await invalidate(); } });
  const failed = transport.error || (editable && (vehicles.error || drivers.error));
  const data = transport.data;
  const legacy = data?.transportPlan.legacy !== false;
  const savedMode: LegacyMode = !data ? null : !legacy ? "ajn" : (data.transportation as any)?.mode === "ajn" ? "ajn" : (data.transportation as any)?.mode === "customer" ? "customer" : null;
  const mode = choice === undefined ? savedMode : choice;
  const fee = data && savedMode === "ajn" ? (() => { try { return transportPlanFee(data.transportPlan); } catch { return null; } })() : null;
  const headline = savedMode === "ajn" ? `${data!.transportPlan.trips.length > 1 ? `${data!.transportPlan.trips.length} رحلات` : "رحلة وحدة"}${fee ? ` · ${formatCurrency(fee)}` : ""}` : savedMode === "customer" ? "على الزبون" : "بدون نقل";
  return <section id={sectionId} className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-bold"><Truck className="size-4 text-primary"/>النقل</h2>{data ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums">{headline}</span> : null}</div>
    {failed ? <><FormError error={failed}/><Button type="button" variant="outline" onClick={() => { void transport.refetch(); if (editable) { void vehicles.refetch(); void drivers.refetch(); } }}>إعادة المحاولة</Button></> : transport.isPending || editable && (vehicles.isPending || drivers.isPending) ? <p role="status">تحميل بيانات النقل…</p> : data ? <>
      {legacy ? <div role="radiogroup" aria-label="منو يتكفل بالنقل" className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1 rounded-xl bg-muted/60 p-1">{MODES.map(([value, label]) => { const selected = (value === "none" ? null : value) === mode; return <Button key={value} type="button" role="radio" aria-checked={selected} variant={selected ? "default" : "ghost"} className="h-10" disabled={!editable || setMode.isPending || save.isPending} onClick={() => setChoice(value === "none" ? null : value)}>{label}</Button>; })}</div> : null}
      {mode === "ajn" ? <>
        {savedMode === "ajn" && data.warnings?.length ? <div role="status" aria-label="تنبيهات النقل" className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-900 dark:text-amber-200">{data.warnings.map(warning => <p key={warning}>{warning}</p>)}</div> : null}
        {savedMode === "ajn" && data.transportPlan.trips.length ? <div className="flex flex-wrap gap-2">{data.transportPlan.trips.map(trip => <Button key={trip.id} type="button" variant="outline" size="sm" onClick={() => onPrint({ ...reference, tripId: trip.id })}><Printer data-icon="inline-start"/>وصل رحلة {trip.sequence}{trip.destination ? ` · ${trip.destination}` : ""}</Button>)}</div> : null}
        <BookingTransportPlanForm key={`${reference.source}:${reference.id}:${data.transportPlan.revision}:${savedMode}`} data={data} vehicles={vehicles.data?.data ?? data.assignmentOptions?.vehicles ?? []} drivers={drivers.data ?? data.assignmentOptions?.drivers ?? []} onSave={plan => save.mutateAsync(plan)} busy={save.isPending} error={save.error} startWithTrip suggestedVehicleId={data.dispatchVehicle?.id ?? null}/>
      </> : <>
        <p className="text-sm text-muted-foreground">{mode === "customer" ? "الزبون يتكفل بنقل أغراضه؛ ما تنضاف أجرة نقل للحجز." : "ما اكو نقل لهذا الحجز."}</p>
        <FormError error={setMode.error}/>
        {editable && mode !== savedMode ? <Button type="button" disabled={setMode.isPending} onClick={() => setMode.mutate(mode as Exclude<LegacyMode, "ajn">)}>{setMode.isPending ? "جارٍ الحفظ…" : "حفظ"}</Button> : null}
      </>}
    </> : null}
  </section>;
}
