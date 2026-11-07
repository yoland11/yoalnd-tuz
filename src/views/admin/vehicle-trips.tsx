import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Loader2, Printer, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useBookingTransportPrint } from "@/components/booking-transport-print";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type VehicleOption = { id: number; name: string; plateNumber?: string | null; isActive?: boolean; status?: string };
type Driver = { id: number; fullName?: string | null; username?: string | null; isActive?: boolean };
export type StandaloneTripRow = {
  bookingId: number; bookingNo: string; customerName: string; eventDate?: string | null; driverName?: string | null; transportationFee: number | null;
  standalone?: { phone: string | null; origin: string | null; destination: string | null; notes: string | null; collected: number; pending: number; driverId: number | null };
};
const METHODS = [["cash", "نقدي"], ["transfer", "تحويل"], ["pos", "بطاقة"]] as const;
type Method = (typeof METHODS)[number][0];
const field = "mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm";
const key = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
function baghdadToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((part) => parts.find((item) => item.type === part)!.value).join("-");
}

function MethodPicker({ id, value, onChange }: { id: string; value: Method; onChange: (value: Method) => void }) {
  return <div className="text-sm"><span id={id}>طريقة الدفع</span><div role="radiogroup" aria-labelledby={id} className="mt-1.5 flex gap-1">{METHODS.map(([method, label]) => <Button key={method} type="button" role="radio" aria-checked={value === method} variant={value === method ? "default" : "outline"} size="sm" className="flex-1" onClick={() => onChange(method)}>{label}</Button>)}</div></div>;
}

/** «إضافة نقل»: a transport job not tied to a booking. Its fee is the vehicle's income. */
export function VehicleTripDialog({ vehicleId, vehicles, onClose }: { vehicleId?: number; vehicles?: VehicleOption[]; onClose: () => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const drivers = useQuery<Driver[]>({ queryKey: ["admin", "vehicle-drivers"], queryFn: () => adminFetch("/admin/staff"), staleTime: 60_000 });
  const choices = (vehicles ?? []).filter((vehicle) => vehicle.isActive !== false && vehicle.status !== "inactive");
  const [form, setForm] = useState({ vehicle: vehicleId ? String(vehicleId) : choices.length === 1 ? String(choices[0].id) : "", tripDate: baghdadToday(), customerName: "", customerPhone: "", origin: "", destination: "", driverId: "", fee: "", notes: "" });
  const [collectNow, setCollectNow] = useState(true);
  const [method, setMethod] = useState<Method>("cash");
  const [attempt, setAttempt] = useState(() => key("vehicle-trip"));
  const set = (name: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [name]: value })); setAttempt(key("vehicle-trip")); };
  const save = useMutation({
    mutationFn: () => adminFetch(`/admin/enterprise/vehicles/${form.vehicle}/trips`, { method: "POST", body: JSON.stringify({
      tripDate: form.tripDate, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim() || null, origin: form.origin.trim() || null,
      destination: form.destination.trim() || null, driverId: form.driverId ? Number(form.driverId) : null, fee: Number(form.fee), notes: form.notes.trim() || null,
      collectNow, paymentMethod: method, idempotencyKey: attempt,
    }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin", "vehicle", Number(form.vehicle)] });
      void client.invalidateQueries({ queryKey: ["admin", "vehicles"] });
      onClose();
      toast({ title: "انحفظ النقل", description: collectNow ? "الأجرة انرسلت للصندوق الرئيسي بانتظار الموافقة." : "تكدر تقبض الأجرة بعدين من قائمة الرحلات." });
    },
    onError: (error) => toast({ title: "تعذر حفظ النقل", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const ready = Boolean(form.vehicle) && Boolean(form.customerName.trim()) && Number(form.fee) > 0 && Boolean(form.tripDate);
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent dir="rtl" className="max-h-[92dvh] max-w-lg overflow-y-auto">
      <DialogHeader><DialogTitle>إضافة نقل</DialogTitle><DialogDescription>شغلة نقل بدون حجز: لزبون أو للمحل. أجرتها تنحسب بدخل السيارة.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <fieldset disabled={save.isPending} className="grid gap-3 sm:grid-cols-2">
          {vehicleId ? null : <label className="text-sm sm:col-span-2"><span>السيارة</span><select required className={field} value={form.vehicle} onChange={(event) => set("vehicle", event.target.value)}><option value="">اختر السيارة</option>{choices.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : ""}</option>)}</select></label>}
          <label className="text-sm"><span>اسم الزبون</span><Input className="mt-1.5" required maxLength={200} value={form.customerName} onChange={(event) => set("customerName", event.target.value)} /></label>
          <label className="text-sm"><span>الهاتف (اختياري)</span><Input className="mt-1.5" type="tel" dir="ltr" maxLength={30} value={form.customerPhone} onChange={(event) => set("customerPhone", event.target.value)} /></label>
          <label className="text-sm"><span>من</span><Input className="mt-1.5" maxLength={300} value={form.origin} onChange={(event) => set("origin", event.target.value)} /></label>
          <label className="text-sm"><span>إلى</span><Input className="mt-1.5" maxLength={300} value={form.destination} onChange={(event) => set("destination", event.target.value)} /></label>
          <label className="text-sm"><span>التاريخ</span><Input className="mt-1.5" type="date" required value={form.tripDate} onChange={(event) => set("tripDate", event.target.value)} /></label>
          <label className="text-sm"><span>الأجرة — د.ع</span><Input className="mt-1.5" required inputMode="decimal" dir="ltr" value={form.fee} onChange={(event) => set("fee", event.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="text-sm sm:col-span-2"><span>السائق (اختياري)</span><select className={field} value={form.driverId} onChange={(event) => set("driverId", event.target.value)}><option value="">{drivers.isLoading ? "جاري التحميل…" : "بدون سائق محدد"}</option>{(drivers.data ?? []).filter((driver) => driver.isActive !== false).map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName || driver.username || `#${driver.id}`}</option>)}</select>{drivers.isError ? <span role="alert" className="mt-1 block text-xs text-destructive">تعذر تحميل الموظفين: {apiErrorMessage(drivers.error)}</span> : null}</label>
          <label className="text-sm sm:col-span-2"><span>ملاحظات (اختياري)</span><Textarea className="mt-1.5" rows={2} maxLength={1000} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label>
        </fieldset>
        <div className="space-y-3 rounded-xl bg-muted/50 p-3">
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={collectNow} disabled={save.isPending} onCheckedChange={(value) => { setCollectNow(value === true); setAttempt(key("vehicle-trip")); }} className="mt-0.5" /><span>قبضت الأجرة الآن <span className="block text-xs text-muted-foreground">تنرسل للصندوق الرئيسي وتنحسب بعد الموافقة.</span></span></label>
          {collectNow ? <MethodPicker id="vehicle-trip-method" value={method} onChange={(value) => { setMethod(value); setAttempt(key("vehicle-trip")); }} /> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-start"><Button type="submit" disabled={save.isPending || !ready} className="gap-2">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}حفظ النقل</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>إلغاء</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** Status, collection, receipt and cancellation of one standalone trip. */
export function StandaloneTripActions({ vehicle, row }: { vehicle: { id: number; name: string; plateNumber?: string | null }; row: StandaloneTripRow }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const print = useBookingTransportPrint();
  const [dialog, setDialog] = useState<"collect" | "cancel" | null>(null);
  const [method, setMethod] = useState<Method>("cash");
  const [attempt, setAttempt] = useState(() => key("vehicle-trip-collect"));
  const info = row.standalone ?? { phone: null, origin: null, destination: null, notes: null, collected: 0, pending: 0, driverId: null };
  const fee = row.transportationFee ?? 0;
  const remaining = Math.max(0, Math.round((fee - info.collected) * 100) / 100);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["admin", "vehicle", vehicle.id] }); void client.invalidateQueries({ queryKey: ["admin", "vehicles"] }); };
  const collect = useMutation({
    mutationFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicle.id}/trips/${row.bookingId}/collect`, { method: "POST", body: JSON.stringify({ paymentMethod: method, idempotencyKey: attempt }) }),
    onSuccess: () => { setAttempt(key("vehicle-trip-collect")); setDialog(null); refresh(); toast({ title: "انرسلت الأجرة للصندوق", description: "تنحسب مقبوضة بعد الموافقة." }); },
    onError: (error) => toast({ title: "تعذر تسجيل القبض", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicle.id}/trips/${row.bookingId}/cancel`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { setDialog(null); refresh(); toast({ title: "انلغى النقل" }); },
    onError: (error) => toast({ title: "تعذر إلغاء النقل", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const state = info.pending > 0 ? { label: "الأجرة بانتظار الموافقة", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" }
    : remaining <= 0 ? { label: "الأجرة مقبوضة", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" }
    : info.collected > 0 ? { label: `باقي ${formatCurrency(remaining)}`, tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" }
    : { label: "الأجرة غير مقبوضة", tone: "bg-muted text-foreground" };
  const printSlip = () => print({
    bookingNumber: row.bookingNo, numberLabel: "رقم النقل", title: "وصل نقل",
    feeNoteText: remaining <= 0 && info.pending <= 0 ? "الأجرة مقبوضة" : info.pending > 0 ? "الأجرة بانتظار موافقة الصندوق" : "الأجرة غير مقبوضة بعد",
    customerName: row.customerName, phone: info.phone, eventDate: row.eventDate ?? null, eventTime: null,
    location: [info.origin && `من ${info.origin}`, info.destination && `إلى ${info.destination}`].filter(Boolean).join(" ") || null,
    vehicle: `${vehicle.name}${vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : ""}`, driver: row.driverName ?? null, fee, inTotal: true, note: info.notes,
  });
  return <div className="mt-2 flex flex-wrap items-center gap-2">
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${state.tone}`}>{state.label}</span>
    {remaining > 0 && info.pending <= 0 ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDialog("collect")}><Banknote className="h-3.5 w-3.5" />قبض الأجرة</Button> : null}
    <Button type="button" size="sm" variant="ghost" className="h-8 gap-1" onClick={printSlip}><Printer className="h-3.5 w-3.5" />وصل</Button>
    {info.collected <= 0 && info.pending <= 0 ? <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-destructive" onClick={() => setDialog("cancel")}><X className="h-3.5 w-3.5" />إلغاء</Button> : null}
    {dialog ? <Dialog open onOpenChange={(open) => { if (!open && !collect.isPending && !cancel.isPending) setDialog(null); }}>
      <DialogContent dir="rtl" className="max-w-sm">
        {dialog === "collect" ? <>
          <DialogHeader><DialogTitle>قبض أجرة النقل</DialogTitle><DialogDescription>{row.customerName} · {formatCurrency(remaining)}. تنرسل للصندوق الرئيسي بانتظار الموافقة.</DialogDescription></DialogHeader>
          <MethodPicker id={`trip-${row.bookingId}-method`} value={method} onChange={(value) => { setMethod(value); setAttempt(key("vehicle-trip-collect")); }} />
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={collect.isPending} className="gap-2" onClick={() => collect.mutate()}>{collect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}إرسال للموافقة</Button><Button variant="outline" disabled={collect.isPending} onClick={() => setDialog(null)}>رجوع</Button></DialogFooter>
        </> : <>
          <DialogHeader><DialogTitle>إلغاء النقل {row.bookingNo}؟</DialogTitle><DialogDescription>ينشال من دخل السيارة وأرباح الشريك. ما ينقبض منه شي.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start"><Button variant="destructive" disabled={cancel.isPending} className="gap-2" onClick={() => cancel.mutate()}>{cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}إلغاء النقل</Button><Button variant="outline" disabled={cancel.isPending} onClick={() => setDialog(null)}>رجوع</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog> : null}
  </div>;
}
