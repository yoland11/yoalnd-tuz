import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, XCircle, ShieldCheck, Loader2, ExternalLink, ImageIcon } from "lucide-react";
import { staffApi } from "@/views/staff/lib";
import { formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

export default function KoshaCollectionsPage() {
  const qc = useQueryClient();
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["kosha-collections", "pending"],
    queryFn: () => staffApi.paymentRequests("pending"),
    refetchInterval: 30000,
  });
  const approve = useMutation({
    mutationFn: (id: number) => staffApi.approve(id),
    onSuccess: () => {
      // Refresh the pending list AND the bookings table so Paid/Remaining update live.
      qc.invalidateQueries({ queryKey: ["kosha-collections"] });
      qc.invalidateQueries({ queryKey: ["admin", "kosha-bookings"] });
    },
  });
  const reject = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => staffApi.reject(id, reason), onSuccess: () => { setRejectingId(null); setRejectionReason(""); qc.invalidateQueries({ queryKey: ["kosha-collections"] }); } });
  const busyId = approve.isPending ? approve.variables : reject.isPending ? reject.variables?.id : null;

  return (
    <div className="space-y-5">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">تحصيلات الكوشات</h1>
          <p className="text-sm text-muted-foreground">اعتماد المبالغ التي حصّلها كادر الكوشات ميدانيًا</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : !data || data.length === 0 ? (
        <EmptyState message="لا توجد طلبات تحصيل بانتظار الاعتماد" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((p) => (
            <div key={p.id} className="rounded-xl border border-border/30 bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="text-xl font-bold text-foreground">{formatCurrency(p.amount)}</div>
                <span className="rounded-full bg-status-warning/15 px-2.5 py-1 text-xs font-bold text-status-warning">بانتظار الاعتماد</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground"><div>الحجز: <b className="text-foreground">{p.booking?.bookingNo ?? `KB-${p.booking?.id ?? "—"}`}</b></div><div>العميل: <b className="text-foreground">{p.booking?.customerName ?? "—"}</b></div><div>الهاتف: <b dir="ltr" className="text-foreground">{p.booking?.customerPhone ?? "—"}</b></div><div>المستلم: <b className="text-foreground">{p.staffName}</b></div><div>قبل التحصيل: <b className="text-foreground">{formatCurrency(p.remainingBefore ?? p.booking?.remainingAmount ?? 0)}</b></div><div>طريقة الدفع: <b className="text-foreground">{p.paymentMethod === "transfer" ? "تحويل" : p.paymentMethod === "card" || p.paymentMethod === "pos" ? "بطاقة" : p.paymentMethod === "other" ? "أخرى" : "نقداً"}</b></div></div>
              {p.note && <div className="mt-2 text-sm">{p.note}</div>}
              {p.receiptImage ? <a href={p.receiptImage} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline"><ImageIcon className="h-4 w-4" /> فتح صورة الوصل</a> : null}
              <div className="mt-1 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("ar-IQ")}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs"><a className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-primary" href={`/admin/kosha-bookings?booking=${p.booking?.id ?? ""}`}><ExternalLink className="h-3.5 w-3.5" /> فتح الحجز</a><a className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-primary" href={`/admin/customers?search=${encodeURIComponent(p.booking?.customerPhone ?? p.booking?.customerName ?? "")}`}><ExternalLink className="h-3.5 w-3.5" /> حساب العميل</a></div>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busyId === p.id}
                  onClick={() => approve.mutate(p.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-status-success py-2 text-sm font-bold text-white transition-colors hover:bg-status-success disabled:opacity-60"
                >
                  {busyId === p.id && approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} موافقة وترحيل للنظام
                </button>
                <button
                  disabled={busyId === p.id}
                  onClick={() => { setRejectingId(p.id); setRejectionReason(""); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-destructive/40 py-2 text-sm font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" /> رفض
                </button>
              </div>
              {rejectingId === p.id ? <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"><label className="mb-1 block text-xs font-bold text-destructive">سبب الرفض مطلوب</label><textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={2} placeholder="مثال: الوصل غير واضح أو المبلغ غير صحيح" className="w-full rounded-md border border-border bg-background p-2 text-sm" /><div className="mt-2 flex gap-2"><button disabled={reject.isPending || rejectionReason.trim().length < 3} onClick={() => reject.mutate({ id: p.id, reason: rejectionReason.trim() })} className="rounded-md bg-destructive px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">تأكيد الرفض</button><button disabled={reject.isPending} onClick={() => setRejectingId(null)} className="rounded-md border border-border px-3 py-1.5 text-sm">إلغاء</button></div></div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
