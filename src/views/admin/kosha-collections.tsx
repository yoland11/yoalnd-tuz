import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, ShieldCheck, Loader2 } from "lucide-react";
import { staffApi } from "@/views/staff/lib";
import { formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";

export default function KoshaCollectionsPage() {
  const qc = useQueryClient();
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
  const reject = useMutation({ mutationFn: (id: number) => staffApi.reject(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["kosha-collections"] }) });
  const busyId = approve.isPending ? approve.variables : reject.isPending ? reject.variables : null;

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
              <div className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{p.staffName}</span> · {p.booking?.customerName ?? "—"}
              </div>
              {p.booking && (
                <div className="mt-1 text-xs text-muted-foreground">المتبقي على الحجز: {formatCurrency(p.booking.remainingAmount)}</div>
              )}
              {p.note && <div className="mt-1 text-sm">{p.note}</div>}
              <div className="mt-1 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("ar-IQ")}</div>
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
                  onClick={() => reject.mutate(p.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-destructive/40 py-2 text-sm font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" /> رفض
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
