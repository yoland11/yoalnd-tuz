import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpRight, Banknote, Loader2, PenLine, RefreshCw, TriangleAlert, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { basisPointsLabel, type PartnerBalance, type PartnerMonth, type PartnerTerm } from "@/lib/vehicle-partner-share";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";

type Payout = { id: number; transactionNo: string | null; date: string; amount: number; reversed: number; status: string; paymentMethod: string | null; note: string | null; requestedBy: string | null };
export type VehiclePartnerState = {
  ready: true; thisMonth: string; canManage: boolean;
  partner: PartnerTerm | null; upcoming?: PartnerTerm | null; terms: PartnerTerm[];
  months: PartnerMonth[]; balance: PartnerBalance | null; payouts: Payout[];
};

const PAYOUT_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "بانتظار الموافقة", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  executed: { label: "مدفوع", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
  partially_reversed: { label: "معكوس جزئياً", tone: "bg-muted text-foreground" },
  reversed: { label: "معكوس", tone: "bg-muted text-muted-foreground" },
  rejected: { label: "مرفوض", tone: "bg-muted text-muted-foreground" },
  cancelled: { label: "ملغي", tone: "bg-muted text-muted-foreground" },
};
const METHODS = [["cash", "نقدي"], ["transfer", "تحويل"], ["pos", "بطاقة"]] as const;

export const monthLabel = (month: string) => month.replace("-", " / ");
const signed = (value: number) => <bdi dir="ltr" className={`tabular-nums ${value < 0 ? "text-destructive" : ""}`}>{formatCurrency(value)}</bdi>;
function baghdadToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}
const newKey = () => `vps-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function partnerQueryKey(vehicleId: number) { return ["admin", "vehicle", vehicleId, "partner"] as const; }

/** The company and one partner share this vehicle's monthly net. */
export default function VehiclePartnerPanel({ vehicleId, vehicleName }: { vehicleId: number; vehicleName: string }) {
  const query = useQuery<VehiclePartnerState>({ queryKey: partnerQueryKey(vehicleId), queryFn: () => adminFetch(`/admin/enterprise/vehicles/${vehicleId}/partner`) });
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  if (query.isLoading) return <section aria-busy="true" className="rounded-2xl border border-border/50 bg-card p-5 text-sm text-muted-foreground">جاري حساب أرباح السيارة…</section>;
  if (query.isError || !query.data) return <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5"><p className="font-medium">تعذر تحميل حساب الشريك</p><p className="mt-1 text-sm">{apiErrorMessage(query.error ?? new Error("لم تصل البيانات"))}</p><Button variant="outline" className="mt-3 gap-2" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />إعادة المحاولة</Button></section>;
  const state = query.data;
  const latest = state.terms.at(-1) ?? null;
  const dialogs = <>
    {editing ? <PartnerTermDialog vehicleId={vehicleId} state={state} onClose={() => setEditing(false)} /> : null}
    {paying && state.balance ? <PayoutDialog vehicleId={vehicleId} state={state} onClose={() => setPaying(false)} /> : null}
  </>;

  if (!state.terms.length) return <section className="rounded-2xl border border-border/50 bg-card p-6">
    <h2 className="text-lg font-bold">السيارة كلها للشركة</h2>
    <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">إذا عندك شريك بهذه السيارة، سجّل اسمه ونسبته. بعدها ينحسب له كل شهر نصيبه من صافي الربح: أجور الرحلات ناقص مصاريف السيارة.</p>
    {state.canManage ? <Button className="mt-4 gap-2" onClick={() => setEditing(true)}><UserRoundPlus className="h-4 w-4" />إضافة شريك</Button> : <p className="mt-4 text-xs text-muted-foreground">إضافة الشريك تحتاج صلاحية الحسابات.</p>}
    {dialogs}
  </section>;

  const balance = state.balance!;
  const payee = state.partner ?? [...state.terms].reverse().find((term) => term.shareBasisPoints > 0 && term.startsMonth <= state.thisMonth) ?? null;
  const ended = !state.partner && latest?.shareBasisPoints === 0;
  return <div className="space-y-4">
    <section className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-bold">{payee?.partnerName ?? latest?.partnerName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.partner ? <>شريك بنسبة <b className="text-foreground">{basisPointsLabel(state.partner.shareBasisPoints)}</b> من صافي الربح، والباقي للشركة</> : ended ? <>انتهت الشراكة من شهر <bdi dir="ltr">{monthLabel(latest!.startsMonth)}</bdi></> : <>تبدأ الشراكة من شهر <bdi dir="ltr">{monthLabel(state.terms[0].startsMonth)}</bdi></>}
            {payee?.partnerPhone ? <> · <bdi dir="ltr">{payee.partnerPhone}</bdi></> : null}
          </p>
          {state.upcoming ? <p className="mt-1 text-xs text-muted-foreground">من شهر <bdi dir="ltr">{monthLabel(state.upcoming.startsMonth)}</bdi>: {state.upcoming.shareBasisPoints ? `نسبة ${basisPointsLabel(state.upcoming.shareBasisPoints)}` : "تنتهي الشراكة"}</p> : null}
        </div>
        {state.canManage ? <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditing(true)}><PenLine className="h-4 w-4" />تعديل الشريك أو النسبة</Button> : null}
      </div>

      <dl className="mt-5 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-px overflow-hidden rounded-xl border border-border/50 bg-border/50 sm:grid-cols-4">
        {([["حصته من الأرباح", balance.earned], ["استلم", balance.paid], ["بانتظار الموافقة", balance.pending], ["الباقي له", balance.remaining]] as const).map(([label, value], index) => <div key={label} className="bg-card p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={`mt-1 font-bold tabular-nums ${index === 3 ? "text-lg text-primary" : "text-base"}`}>{signed(value)}</dd>
        </div>)}
      </dl>
      {balance.remaining < 0 ? <p className="mt-2 text-xs text-destructive">الشريك استلم أكثر من حصته بـ {formatCurrency(-balance.remaining)}؛ ينخصم من أرباحه القادمة.</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {state.canManage && payee ? <Button className="gap-2" disabled={balance.available <= 0} onClick={() => setPaying(true)}><Banknote className="h-4 w-4" />صرف حصة الشريك</Button> : null}
        <p className="text-xs leading-5 text-muted-foreground">الصرف يطلع من الصندوق الرئيسي بعد موافقة الإدارة. الطلب المعلّق يحجز مبلغه من الباقي.</p>
      </div>
    </section>

    <section className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5">
      <h3 className="font-bold">الأرباح شهر بشهر</h3>
      <p className="mt-1 text-xs text-muted-foreground">الصافي = أجور رحلات {vehicleName} بتاريخ المناسبة ناقص مصاريفها المنفذة. الشهر الخسران ينقص من الحصة.</p>
      {/* Phone: one line per month with what matters; the full table from sm up. */}
      <ul className="mt-3 divide-y divide-border/40 sm:hidden">{state.months.map((month) => <li key={month.month} className="py-3">
        <div className="flex items-baseline justify-between gap-3"><bdi dir="ltr" className="font-semibold tabular-nums">{monthLabel(month.month)}</bdi><span className="text-sm">الصافي {signed(month.net)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{month.tripCount} رحلة · دخل {formatCurrency(month.income)} · مصاريف {formatCurrency(month.expenses)}</p>
        {month.shareBasisPoints ? <p className="mt-1 text-sm">حصة الشريك {signed(month.partnerShare)} · الشركة {signed(month.companyShare)}</p> : null}
        {month.unallocatedTrips ? <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{month.unallocatedTrips} حجز بأجرة كلية لعدة سيارات، أجرته ما محسوبة</p> : null}
        {month.pendingExpenses ? <p className="mt-1 text-xs text-muted-foreground">{month.pendingExpenses} مصروف بانتظار الموافقة</p> : null}
      </li>)}</ul>
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] text-right text-sm">
          <thead className="border-b border-border/60 text-xs text-muted-foreground"><tr>{["الشهر", "الرحلات", "الدخل", "المصاريف", "الصافي", "حصة الشريك", "حصة الشركة"].map((head) => <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead>
          <tbody>{state.months.map((month) => <tr key={month.month} className="border-b border-border/30 align-top">
            <td className="px-2 py-2.5"><bdi dir="ltr" className="font-medium tabular-nums">{monthLabel(month.month)}</bdi>{month.month === state.thisMonth ? <span className="ms-2 text-xs text-muted-foreground">الشهر الحالي</span> : null}
              {month.unallocatedTrips ? <span className="mt-1 flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300"><TriangleAlert className="h-3 w-3 shrink-0" />{month.unallocatedTrips} حجز بأجرة كلية لعدة سيارات، أجرته ما محسوبة</span> : null}
              {month.pendingExpenses ? <span className="mt-1 block text-xs text-muted-foreground">{month.pendingExpenses} مصروف بانتظار الموافقة</span> : null}
            </td>
            <td className="px-2 py-2.5 tabular-nums">{month.tripCount}</td>
            <td className="px-2 py-2.5">{signed(month.income)}</td>
            <td className="px-2 py-2.5">{signed(month.expenses)}</td>
            <td className="px-2 py-2.5 font-semibold">{signed(month.net)}</td>
            <td className="px-2 py-2.5 font-semibold">{month.shareBasisPoints ? <>{signed(month.partnerShare)}<span className="block text-xs font-normal text-muted-foreground">{basisPointsLabel(month.shareBasisPoints)}</span></> : <span className="text-muted-foreground">—</span>}</td>
            <td className="px-2 py-2.5">{signed(month.companyShare)}</td>
          </tr>)}{!state.months.length ? <tr><td colSpan={7} className="px-2 py-8 text-center text-muted-foreground">تبدأ الأشهر من شهر <bdi dir="ltr">{monthLabel(state.terms[0].startsMonth)}</bdi>.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>

    <section className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5">
      <h3 className="font-bold">صرف الحصص</h3>
      {state.payouts.length ? <ul className="mt-3 divide-y divide-border/40">{state.payouts.map((payout) => {
        const status = PAYOUT_STATUS[payout.status] ?? { label: payout.status, tone: "bg-muted text-foreground" };
        return <li key={payout.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{signed(payout.amount)}<span className={`ms-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span></p>
            <p className="mt-0.5 text-xs text-muted-foreground"><bdi dir="ltr">{payout.date}</bdi>{payout.transactionNo ? <> · <bdi dir="ltr">{payout.transactionNo}</bdi></> : null}{payout.note ? ` · ${payout.note}` : ""}</p>
          </div>
          <Link href={`/admin/finance/master-cash?transaction=${payout.id}`} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:underline">الصندوق<ArrowUpRight className="h-4 w-4" /></Link>
        </li>;
      })}</ul> : <p className="mt-2 text-sm text-muted-foreground">ما انصرف للشريك شي بعد.</p>}
    </section>
    {dialogs}
  </div>;
}

function useRefreshPartner(vehicleId: number) {
  const client = useQueryClient();
  return (data?: VehiclePartnerState) => {
    if (data?.ready) client.setQueryData(partnerQueryKey(vehicleId), data);
    void client.invalidateQueries({ queryKey: partnerQueryKey(vehicleId) });
  };
}

function PartnerTermDialog({ vehicleId, state, onClose }: { vehicleId: number; state: VehiclePartnerState; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefreshPartner(vehicleId);
  const current = state.partner ?? state.terms.at(-1) ?? null;
  const [name, setName] = useState(current?.partnerName ?? "");
  const [phone, setPhone] = useState(current?.partnerPhone ?? "");
  const [percent, setPercent] = useState(current?.shareBasisPoints ? String(current.shareBasisPoints / 100) : "50");
  const [month, setMonth] = useState(state.thisMonth);
  const save = useMutation({
    mutationFn: (sharePercent: string) => adminFetch<VehiclePartnerState>(`/admin/enterprise/vehicles/${vehicleId}/partner`, { method: "POST", body: JSON.stringify({ partnerName: name.trim(), partnerPhone: phone.trim() || null, sharePercent, startsMonth: month }) }),
    onSuccess: (data, sharePercent) => { refresh(data); onClose(); toast({ title: sharePercent === "0" ? "انتهت الشراكة من الشهر المختار" : "انحفظ الشريك ونسبته" }); },
    onError: (error) => toast({ title: "تعذر حفظ الشريك", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const existingMonth = state.terms.some((term) => term.startsMonth === month);
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent dir="rtl" className="max-h-[92dvh] max-w-lg overflow-y-auto">
      <DialogHeader><DialogTitle>{state.terms.length ? "تعديل الشريك أو النسبة" : "إضافة شريك للسيارة"}</DialogTitle><DialogDescription>النسبة من صافي الربح كل شهر. الباقي يبقى للشركة.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(percent.trim()); }}>
        <fieldset disabled={save.isPending} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2"><span>اسم الشريك</span><Input className="mt-1.5" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="text-sm"><span>نسبة الشريك %</span><Input className="mt-1.5" required inputMode="decimal" dir="ltr" value={percent} onChange={(event) => setPercent(event.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="text-sm"><span>الهاتف (اختياري)</span><Input className="mt-1.5" type="tel" dir="ltr" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label className="text-sm sm:col-span-2"><span>يبدأ من شهر</span><Input className="mt-1.5" type="month" required value={month} onChange={(event) => setMonth(event.target.value)} />
            <span className="mt-1 block text-xs text-muted-foreground">{existingMonth ? "هذا الشهر عليه نسبة محفوظة؛ الحفظ يبدّلها." : state.terms.length ? "الأشهر قبله تبقى بنسبتها القديمة." : "الأرباح تنحسب من هذا الشهر."}</span></label>
        </fieldset>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2"><Button type="submit" disabled={save.isPending || !name.trim() || !percent.trim()} className="gap-2">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}حفظ</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>إلغاء</Button></div>
          {state.partner ? <Button type="button" variant="ghost" className="text-destructive" disabled={save.isPending} onClick={() => save.mutate("0")}>إنهاء الشراكة من هذا الشهر</Button> : null}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function PayoutDialog({ vehicleId, state, onClose }: { vehicleId: number; state: VehiclePartnerState; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefreshPartner(vehicleId);
  const available = state.balance!.available;
  const [amount, setAmount] = useState(String(available));
  const [date, setDate] = useState(baghdadToday());
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>("cash");
  const [note, setNote] = useState("");
  // One key per attempt: a retry after a network error cannot create a second request.
  const [key, setKey] = useState(newKey);
  const request = useMutation({
    mutationFn: () => adminFetch<VehiclePartnerState>(`/admin/enterprise/vehicles/${vehicleId}/partner/payouts`, { method: "POST", body: JSON.stringify({ amount: Number(amount), payoutDate: date, paymentMethod: method, note: note.trim() || null, idempotencyKey: key }) }),
    onSuccess: (data) => { setKey(newKey()); refresh(data); onClose(); toast({ title: "انرسل طلب الصرف للموافقة", description: "ينخصم من الصندوق الرئيسي بعد الموافقة فقط." }); },
    onError: (error) => toast({ title: "تعذر إرسال طلب الصرف", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const value = Number(amount);
  const tooMuch = value > available;
  return <Dialog open onOpenChange={(open) => { if (!open && !request.isPending) onClose(); }}>
    <DialogContent dir="rtl" className="max-h-[92dvh] max-w-md overflow-y-auto">
      <DialogHeader><DialogTitle>صرف حصة الشريك</DialogTitle><DialogDescription>الباقي له: {formatCurrency(available)}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); request.mutate(); }}>
        <fieldset disabled={request.isPending} className="space-y-3">
          <label className="block text-sm"><span>المبلغ — د.ع</span><Input className="mt-1.5" required inputMode="decimal" dir="ltr" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9.]/g, "")); setKey(newKey()); }} />{tooMuch ? <span role="alert" className="mt-1 block text-xs text-destructive">أكثر من الباقي للشريك</span> : null}</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm"><span>تاريخ الصرف</span><Input className="mt-1.5" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <div className="text-sm"><span id={`payout-method-${vehicleId}`}>طريقة الدفع</span><div role="radiogroup" aria-labelledby={`payout-method-${vehicleId}`} className="mt-1.5 flex gap-1">{METHODS.map(([value, label]) => <Button key={value} type="button" role="radio" aria-checked={method === value} variant={method === value ? "default" : "outline"} size="sm" className="flex-1" onClick={() => setMethod(value)}>{label}</Button>)}</div></div>
          </div>
          <label className="block text-sm"><span>ملاحظة (اختياري)</span><Textarea className="mt-1.5" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </fieldset>
        <DialogFooter className="gap-2 sm:justify-start"><Button type="submit" disabled={request.isPending || !(value > 0) || tooMuch} className="gap-2">{request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}إرسال للموافقة</Button><Button type="button" variant="outline" disabled={request.isPending} onClick={onClose}>إلغاء</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
