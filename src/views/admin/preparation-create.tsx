import { useEffect, useState } from "react";
import { CalendarDays, Loader2, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminFetch, apiErrorMessage } from "./_lib";
import { CustomerQuickAddDialog, type QuickAddedCustomer } from "./customer-quick-add";
import { PreparationItemPicker } from "./preparation-item-picker";
import type { PreparationDraftItem } from "@/server/preparation-requests";

type Mode = "existing" | "new" | "none";
type BookingOption = { source: "service" | "kosha"; id: number; number: string; customerName: string; customerId: number | null; eventDate: string | null };
type CustomerOption = { id: number; name: string; fullName: string | null; phone: string };
export type PreparationDraft = { mode: Mode; bookingSource?: "service" | "kosha"; bookingId?: number; customerId?: number | null; occasionName?: string; items: PreparationDraftItem[] };
export function validatePreparationDraft(draft: PreparationDraft): string | null {
  if (draft.mode === "existing" && (!draft.bookingSource || !draft.bookingId)) return "اختر الحجز أو المناسبة";
  if (draft.mode !== "existing" && !draft.customerId) return "اختر العميل";
  if (draft.mode === "new" && !draft.occasionName?.trim()) return "اكتب اسم المناسبة";
  if (!draft.items.length) return "أضف عنصر تجهيز واحداً على الأقل";
  return null;
}
export function preparationSaveTarget(draft: Pick<PreparationDraft, "mode" | "bookingSource" | "bookingId">) {
  return draft.mode === "existing" ? `/admin/preparation/bookings/${draft.bookingSource}/${draft.bookingId}/items` : "/admin/preparation/requests";
}

const inputClass = "h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
export function PreparationCreateDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: (cardKey: string) => void }) {
  const [mode, setMode] = useState<Mode>("existing");
  const [bookingSearch, setBookingSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedBooking, setDebouncedBooking] = useState("");
  const [debouncedCustomer, setDebouncedCustomer] = useState("");
  const [booking, setBooking] = useState<BookingOption | null>(null);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [occasionName, setOccasionName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [items, setItems] = useState<PreparationDraftItem[]>([]);
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedBooking(bookingSearch.trim()), 250); return () => window.clearTimeout(timer); }, [bookingSearch]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedCustomer(customerSearch.trim()), 250); return () => window.clearTimeout(timer); }, [customerSearch]);
  const bookings = useQuery<{ bookings: BookingOption[] }>({ queryKey: ["admin", "preparation-booking-options", debouncedBooking], queryFn: () => adminFetch(`/admin/preparation/bookings?search=${encodeURIComponent(debouncedBooking)}`), enabled: open && mode === "existing", staleTime: 15_000 });
  const customers = useQuery<{ customers: CustomerOption[] }>({ queryKey: ["admin", "preparation-customer-options", debouncedCustomer], queryFn: () => adminFetch(`/admin/preparation/customers?search=${encodeURIComponent(debouncedCustomer)}`), enabled: open && mode !== "existing", staleTime: 15_000 });

  const chooseMode = (next: Mode) => { setMode(next); setBooking(null); setSaveError(""); };
  const reset = () => { setBooking(null); setCustomer(null); setBookingSearch(""); setCustomerSearch(""); setOccasionName(""); setEventDate(""); setItems([]); setMode("existing"); setSaveError(""); setToken(crypto.randomUUID()); };
  const save = async () => {
    if (busy) return;
    const draft: PreparationDraft = { mode, bookingSource: booking?.source, bookingId: booking?.id, customerId: customer?.id, occasionName, items };
    const issue = validatePreparationDraft(draft);
    if (issue) { setSaveError(issue); return; }
    setBusy(true); setSaveError("");
    try {
      const payload = mode === "existing" ? { requestToken: token, items } : { requestToken: token, customerId: customer!.id, occasionName: mode === "new" ? occasionName.trim() : null, eventDate: mode === "new" ? eventDate || null : null, items };
      const saved = await adminFetch<{ id: number; source?: string }>(preparationSaveTarget(draft), { method: "POST", body: JSON.stringify(payload) });
      onSaved(mode === "existing" ? `${booking!.source}-${booking!.id}` : `request-${saved.id}`);
      toast.success("تم حفظ قائمة التجهيز");
      reset(); onOpenChange(false);
    } catch (cause) {
      setSaveError(apiErrorMessage(cause, "تعذّر حفظ قائمة التجهيز"));
    } finally { setBusy(false); }
  };
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent dir="rtl" className="max-w-[760px] gap-4 rounded-3xl p-4 sm:p-6">
        <DialogHeader><DialogTitle className="text-xl">تجهيز حسب الطلب</DialogTitle><DialogDescription>اختر مناسبة موجودة أو أنشئ مناسبة جديدة، ثم أضف المواد المطلوبة من المتجر أو الأصول أو من عندك.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="نوع المناسبة">
          {([ ["existing", "مناسبة موجودة"], ["new", "مناسبة جديدة"], ["none", "بدون مناسبة"] ] as const).map(([value, label]) => <Button key={value} type="button" variant={mode === value ? "default" : "outline"} className="min-h-11 rounded-xl text-xs sm:text-sm" onClick={() => chooseMode(value)}>{label}</Button>)}
        </div>
        {mode === "existing" ? <section className="space-y-2 rounded-2xl border border-border p-3"><label className="block space-y-1 text-xs font-semibold"><span>اختر المناسبة أو الحجز</span><span className="relative block"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><input className={`${inputClass} pr-9`} value={bookingSearch} onChange={(event) => { setBookingSearch(event.target.value); setBooking(null); }} placeholder="ابحث بالاسم أو رقم الحجز…" /></span></label>
          {bookings.isLoading ? <p className="text-xs text-muted-foreground">جارٍ تحميل الحجوزات…</p> : bookings.isError ? <p role="alert" className="text-xs text-destructive">{apiErrorMessage(bookings.error, "تعذّر تحميل الحجوزات")} <Button variant="link" onClick={() => void bookings.refetch()}>إعادة المحاولة</Button></p> : <div className="max-h-32 space-y-1 overflow-y-auto">{bookings.data?.bookings.map((row) => <button key={`${row.source}-${row.id}`} type="button" onClick={() => setBooking(row)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-right text-xs ${booking?.id === row.id && booking.source === row.source ? "border-primary bg-primary/10" : "border-border bg-background"}`}><span>{row.customerName} · {row.eventDate?.slice(0, 10) || "بدون تاريخ"}</span><span dir="ltr" className="font-mono">{row.number}</span></button>)}{!bookings.data?.bookings.length ? <p className="text-xs text-muted-foreground">لا توجد حجوزات مطابقة</p> : null}</div>}
          {booking ? <p className="flex items-center gap-2 rounded-xl bg-primary/5 p-2 text-xs"><UserRound className="h-4 w-4" /> الشخص المرتبط بالحجز: <strong>{booking.customerName}</strong> <span className="text-muted-foreground">(لا يتغير من هنا)</span></p> : null}
        </section> : <section className="space-y-3 rounded-2xl border border-border p-3">
          {mode === "new" ? <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs font-semibold"><span>اسم المناسبة</span><input className={inputClass} value={occasionName} onChange={(event) => setOccasionName(event.target.value)} placeholder="مثال: زفاف أو تخرج" /></label><label className="space-y-1 text-xs font-semibold"><span>تاريخ المناسبة (اختياري)</span><span className="relative block"><CalendarDays className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><DateField className={`${inputClass} pr-9`} type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></span></label></div> : null}
          <div className="flex items-end gap-2"><label className="flex-1 space-y-1 text-xs font-semibold"><span>اختر الشخص / العميل</span><input className={inputClass} value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setCustomer(null); }} placeholder="ابحث بالاسم أو الهاتف…" /></label><Button variant="outline" type="button" className="h-11 rounded-xl" onClick={() => setNewCustomerOpen(true)}><Plus className="h-4 w-4" /> إضافة شخص</Button></div>
          {customers.isLoading ? <p className="text-xs text-muted-foreground">جارٍ تحميل العملاء…</p> : customers.isError ? <p role="alert" className="text-xs text-destructive">{apiErrorMessage(customers.error, "تعذّر تحميل العملاء")} <Button variant="link" onClick={() => void customers.refetch()}>إعادة المحاولة</Button></p> : <div className="max-h-28 space-y-1 overflow-y-auto">{customers.data?.customers.map((row) => <button key={row.id} type="button" onClick={() => setCustomer(row)} className={`flex w-full justify-between rounded-xl border px-3 py-2 text-right text-xs ${customer?.id === row.id ? "border-primary bg-primary/10" : "border-border"}`}><span>{row.fullName || row.name}</span><span dir="ltr">{row.phone}</span></button>)}{!customers.data?.customers.length ? <p className="text-xs text-muted-foreground">لا يوجد شخص مطابق. يمكنك إضافته.</p> : null}</div>}
          {customer ? <p className="text-xs font-semibold text-primary">الشخص المختار: {customer.fullName || customer.name}</p> : null}
        </section>}
        <section className="space-y-2"><h3 className="text-sm font-bold">عناصر التجهيز ({items.length})</h3><PreparationItemPicker onAdd={(item) => { setItems((current) => [...current, item]); setSaveError(""); }} />
          {items.length ? <div className="max-h-36 space-y-1 overflow-y-auto">{items.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{item.name} · {item.quantity} {item.infoOnly ? "· للعلم" : ""}</span><Button variant="ghost" size="icon" type="button" aria-label={`حذف ${item.name}`} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)}</div> : null}
        </section>
        {saveError ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end"><Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button><Button type="button" onClick={() => void save()} disabled={busy || !items.length} className="min-h-11 rounded-xl">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} حفظ قائمة التجهيز</Button></div>
      </DialogContent>
    </Dialog>
    <CustomerQuickAddDialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen} onCreated={(created: QuickAddedCustomer) => { setCustomer(created); setCustomerSearch(created.fullName || created.name); setNewCustomerOpen(false); }} />
  </>;
}
