import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fetchAdminMe, hasPerm, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";

type SummaryRow = { type: string; label: string; count: number };
type BinItem = { id: number; title: string; subtitle: string; deletedAt: string | null };

export default function RecycleBinPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<BinItem | null>(null);
  const [reason, setReason] = useState("");

  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });
  const user = me ?? null;
  const canRestore = hasPerm(user, "recycle_bin_restore");
  const canPurge = hasPerm(user, "recycle_bin_purge") && user?.role === "admin";

  const { data: summary, isLoading: sLoading, isError: sError, refetch, isFetching } = useQuery<{ summary: SummaryRow[] }>({
    queryKey: ["admin", "recycle-bin"],
    queryFn: () => adminFetch("/admin/recycle-bin"),
  });

  const { data: items, isLoading: iLoading } = useQuery<{ type: string; items: BinItem[] }>({
    queryKey: ["admin", "recycle-bin", active],
    queryFn: () => adminFetch(`/admin/recycle-bin/${active}`),
    enabled: Boolean(active),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["admin", "recycle-bin"] });
  }

  const restore = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      adminFetch(`/admin/recycle-bin/${type}/${id}/restore`, { method: "POST", body: JSON.stringify({ id }) }),
    onSuccess: () => { invalidate(); toast({ title: "تمت الاستعادة" }); },
    onError: (e: any) => toast({ title: "تعذرت الاستعادة", description: e?.message, variant: "destructive" }),
  });

  const purge = useMutation({
    mutationFn: ({ type, id, reason }: { type: string; id: number; reason: string }) =>
      adminFetch(`/admin/recycle-bin/${type}/${id}/purge`, { method: "POST", body: JSON.stringify({ id, reason }) }),
    onSuccess: () => {
      invalidate();
      setPurgeTarget(null);
      setReason("");
      toast({ title: "تم الحذف النهائي" });
    },
    onError: (e: any) => toast({ title: "تعذر الحذف النهائي", description: e?.message, variant: "destructive" }),
  });

  function confirmPurge() {
    if (!purgeTarget || !active) return;
    if (reason.trim().length < 3) {
      toast({ title: "أدخل سبب الحذف", description: "٣ أحرف على الأقل", variant: "destructive" });
      return;
    }
    if (!window.confirm("الحذف النهائي لا يمكن التراجع عنه. هل أنت متأكد؟")) return;
    purge.mutate({ type: active, id: purgeTarget.id, reason: reason.trim() });
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-primary" /> سلة المحذوفات
        </h1>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        السجلات المحذوفة لا تُزال فعلياً — تبقى مع علاقاتها ويمكن استعادتها. الحذف النهائي متاح للمدير فقط ويُرفض إذا
        كانت هناك حركات مالية منفّذة مرتبطة بالسجل.
      </p>

      {!canRestore && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> لديك صلاحية العرض فقط.
        </div>
      )}

      {sError ? (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger flex items-center gap-2">
          <XCircle className="w-4 h-4" /> تعذّر تحميل سلة المحذوفات.
        </div>
      ) : sLoading ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(summary?.summary ?? []).map((s) => (
            <button
              key={s.type}
              type="button"
              onClick={() => setActive(active === s.type ? null : s.type)}
              className={`rounded-xl border p-4 text-right transition-colors ${
                active === s.type
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/30 bg-card hover:border-primary/30"
              }`}
            >
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground tabular-nums mt-1">{s.count}</p>
            </button>
          ))}
        </div>
      )}

      {active && (
        <section className="bg-card rounded-xl border border-border/30 p-4 sm:p-6">
          <h2 className="font-semibold text-foreground mb-3">
            {(summary?.summary ?? []).find((s) => s.type === active)?.label ?? active}
          </h2>
          {iLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (items?.items?.length ?? 0) === 0 ? (
            <EmptyState message="لا توجد سجلات محذوفة" />
          ) : (
            <div className="space-y-2">
              {items!.items.map((it) => (
                <div key={it.id} className="rounded-lg border border-border/20 bg-background/40 p-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-semibold text-foreground">{it.title || `#${it.id}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.subtitle}
                      {it.deletedAt ? ` · حُذف في ${new Date(it.deletedAt).toLocaleString("ar-IQ")}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {canRestore && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate({ type: active, id: it.id })}
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> استعادة
                      </Button>
                    )}
                    {canPurge && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1.5"
                        onClick={() => { setPurgeTarget(it); setReason(""); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> حذف نهائي
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {purgeTarget && (
            <div className="mt-4 rounded-lg border border-status-danger/30 bg-status-danger/5 p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-status-danger" />
                حذف نهائي: {purgeTarget.title || `#${purgeTarget.id}`}
              </p>
              <p className="text-xs text-muted-foreground">
                هذا الإجراء لا يمكن التراجع عنه، ويُسجَّل في سجل التدقيق.
              </p>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="سبب الحذف النهائي (إلزامي)"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5"
                  disabled={purge.isPending || reason.trim().length < 3}
                  onClick={confirmPurge}
                >
                  {purge.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  تأكيد الحذف النهائي
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPurgeTarget(null)}>إلغاء</Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
