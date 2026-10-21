import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Loader2, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/views/admin/_lib";
import { Failure, workKeys } from "./shared";

export type PickedCustomer = { id: number; name: string; phoneTail: string };
export type PickedBooking = { type: "kosha_booking" | "service_order"; id: number; number: string; title: string; eventDate: string | null };
type CustomerRow = PickedCustomer & { bookings: number };

const STATUS_LABELS: Record<string, string> = {
  new: "جديد", pending: "قيد الانتظار", confirmed: "مؤكد", in_progress: "قيد التنفيذ", completed: "مكتمل", done: "مكتمل", delivered: "مُسلّم", cancelled: "ملغي",
};

/**
 * Customer from the customers list, then one of that customer's bookings.
 * The server re-checks that the booking belongs to the customer.
 */
export function CustomerBookingPicker({
  customer,
  booking,
  onChange,
}: {
  customer: PickedCustomer | null;
  booking: PickedBooking | null;
  onChange: (value: { customer: PickedCustomer | null; booking: PickedBooking | null }) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const search = useQuery({
    queryKey: workKeys.customers(debounced),
    queryFn: () => adminFetch<{ data: CustomerRow[] }>(`/admin/work-commands/customers?q=${encodeURIComponent(debounced)}`).then((result) => result.data),
    enabled: !customer && debounced.length >= 2,
  });
  const bookings = useQuery({
    queryKey: workKeys.customerBookings(customer?.id ?? 0),
    queryFn: () => adminFetch<{ data: Array<PickedBooking & { status: string }> }>(`/admin/work-commands/customers/${customer!.id}/bookings`).then((result) => result.data),
    enabled: Boolean(customer),
  });

  if (!customer)
    return (
      <div className="rounded-xl border border-border">
        <div className="relative p-2">
          <Search className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الزبون أو رقم هاتفه" aria-label="بحث عن زبون" className="min-h-11 pr-9" />
        </div>
        {debounced.length >= 2 ? (
          <div className="max-h-52 overflow-y-auto overscroll-contain border-t border-border p-1">
            {search.isLoading ? <div className="flex min-h-11 items-center gap-2 px-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />جارٍ البحث...</div> : null}
            {search.isError ? <div className="p-1"><Failure title="تعذر البحث في العملاء" error={search.error} onRetry={() => void search.refetch()} /></div> : null}
            {search.data?.map((row) => (
              <Button key={row.id} type="button" variant="ghost" onClick={() => { onChange({ customer: { id: row.id, name: row.name, phoneTail: row.phoneTail }, booking: null }); setQuery(""); }} className="flex h-auto min-h-11 w-full items-center gap-3 px-2 py-1.5 text-start">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{row.name}</span>
                <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground" dir="ltr">••{row.phoneTail}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">{row.bookings ? `حجوزات: ${row.bookings}` : "بلا حجوزات"}</span>
              </Button>
            ))}
            {search.isSuccess && !search.data.length ? <p className="px-2 py-3 text-center text-xs text-muted-foreground">لا يوجد زبون بهذا الاسم أو الرقم في قائمة العملاء.</p> : null}
          </div>
        ) : null}
      </div>
    );

  return (
    <div className="space-y-2 rounded-xl border border-border p-2">
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
        <UserRound className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{customer.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">••{customer.phoneTail}</span>
        <Button type="button" variant="quiet" size="iconSm" aria-label="تغيير الزبون" onClick={() => onChange({ customer: null, booking: null })}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="px-1 text-xs font-bold text-muted-foreground">اختر الحجز</p>
      {bookings.isLoading ? <div className="flex min-h-11 items-center gap-2 px-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />تحميل الحجوزات...</div> : null}
      {bookings.isError ? <Failure title="تعذر تحميل حجوزات الزبون" error={bookings.error} onRetry={() => void bookings.refetch()} /> : null}
      {bookings.data ? (
        <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain" role="radiogroup" aria-label="حجوزات الزبون">
          <BookingOption selected={!booking} onSelect={() => onChange({ customer, booking: null })} title="بدون حجز" detail="يرتبط الأمر بالزبون فقط" />
          {bookings.data.map((row) => (
            <BookingOption
              key={`${row.type}-${row.id}`}
              selected={booking?.type === row.type && booking.id === row.id}
              onSelect={() => onChange({ customer, booking: row })}
              title={`${row.number} · ${row.title}`}
              detail={[row.eventDate ?? "بدون تاريخ", STATUS_LABELS[row.status] ?? row.status].filter(Boolean).join(" · ")}
            />
          ))}
          {!bookings.data.length ? <p className="px-2 py-2 text-xs text-muted-foreground">لا توجد حجوزات لهذا الزبون.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function BookingOption({ selected, onSelect, title, detail }: { selected: boolean; onSelect: () => void; title: string; detail: string }) {
  return (
    <Button type="button" variant={selected ? "selected" : "ghost"} role="radio" aria-checked={selected} onClick={onSelect} className="flex h-auto min-h-12 w-full items-center gap-2.5 px-2.5 py-1.5 text-start">
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{selected ? <Check className="h-3 w-3" /> : null}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><CalendarDays className="h-3 w-3" />{detail}</span>
      </span>
    </Button>
  );
}
