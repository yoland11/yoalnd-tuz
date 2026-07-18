import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, CheckCircle2, Download, Eye, Loader2,
  RefreshCw, ShieldAlert, Wrench, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, fetchAdminMe, formatCurrency, hasPerm, type AdminMe } from "./_lib";
import { EmptyState } from "./_layout";

type HealthStatus = "ok" | "warn" | "fail";
type HealthCheck = {
  key: string; label: string; status: HealthStatus;
  value: string; detail?: string; count?: number;
};
type HealthReport = {
  generatedAt: string;
  summary: { ok: number; warn: number; fail: number };
  checks: HealthCheck[];
};
type CashboxDrift = { stored: number; expected: number; drift: number };

export default function SystemHealthPage() {
  const [tab, setTab] = useState<"health" | "reconciliation">("health");
  const { data: me } = useQuery<AdminMe | null>({
    queryKey: ["admin", "me"],
    queryFn: () => fetchAdminMe(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4" dir="rtl">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" /> صحة النظام والتسويات
      </h1>

      <div className="flex gap-2">
        {([
          ["health", "مراقبة الصحة"],
          ["reconciliation", "مركز التسويات"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              tab === value
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/30 text-muted-foreground hover:border-primary/30"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "health" ? <HealthTab /> : <ReconciliationTab me={me ?? null} />}
    </div>
  );
}

// ─── Health ──────────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<HealthReport>({
    queryKey: ["admin", "system-health"],
    queryFn: () => adminFetch("/admin/system-health"),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {data && (
          <div className="flex gap-2 flex-wrap text-xs">
            <Badge tone="ok" label={`سليم ${data.summary.ok}`} />
            <Badge tone="warn" label={`تنبيه ${data.summary.warn}`} />
            <Badge tone="fail" label={`خلل ${data.summary.fail}`} />
            <span className="text-muted-foreground self-center">
              آخر فحص: {new Date(data.generatedAt).toLocaleString("ar-IQ")}
            </span>
          </div>
        )}
        <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      {isError ? (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger flex items-center gap-2">
          <XCircle className="w-4 h-4" /> تعذّر تشغيل فحوصات صحة النظام.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !data || data.checks.length === 0 ? (
        <EmptyState message="لا توجد فحوصات" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.checks.map((c) => (
            <div key={c.key} className="bg-card rounded-xl border border-border/30 p-4 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{c.label}</p>
                <StatusIcon status={c.status} />
              </div>
              <p className={`text-lg font-bold tabular-nums ${TONE_TEXT[c.status]}`}>{c.value}</p>
              {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        جميع الفحوصات للقراءة فقط — لا تُعدّل أي بيانات. المعالجة تتم من مركز التسويات أو من وحدة كل قسم.
      </p>
    </div>
  );
}

const TONE_TEXT: Record<HealthStatus, string> = {
  ok: "text-status-success",
  warn: "text-status-warning",
  fail: "text-status-danger",
};

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />;
  return <XCircle className="w-4 h-4 text-status-danger shrink-0" />;
}

function Badge({ tone, label }: { tone: HealthStatus; label: string }) {
  const cls =
    tone === "ok" ? "bg-status-success/10 text-status-success border-status-success/30"
    : tone === "warn" ? "bg-status-warning/10 text-status-warning border-status-warning/30"
    : "bg-status-danger/10 text-status-danger border-status-danger/30";
  return <span className={`px-2 py-1 rounded-full border ${cls}`}>{label}</span>;
}

// ─── Reconciliation (Dry Run → reason → second confirm → apply) ─────────────

type DryRunChange = { record: string; field: string; before: number; after: number; delta: number };
type DryRunResult = {
  target: string; generatedAt: string; affectedCount: number;
  changes: DryRunChange[]; detail: string;
};

function ReconciliationTab({ me }: { me: AdminMe | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canRepair = hasPerm(me, "reconciliation_repair") && (me?.role === "admin" || me?.role === "manager");

  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ cashbox: CashboxDrift }>({
    queryKey: ["admin", "reconciliation"],
    queryFn: () => adminFetch("/admin/reconciliation"),
  });

  const dryRun = useMutation({
    mutationFn: (target: string) =>
      adminFetch<DryRunResult>("/admin/reconciliation/dry-run", {
        method: "POST", body: JSON.stringify({ target }),
      }),
    onSuccess: (result) => setPreview(result),
    onError: (err: any) =>
      toast({ title: "تعذرت المعاينة", description: err?.message, variant: "destructive" }),
  });

  const repair = useMutation({
    mutationFn: ({ target, reason }: { target: string; reason: string }) =>
      adminFetch("/admin/reconciliation/repair", {
        method: "POST", body: JSON.stringify({ target, reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reconciliation"] });
      qc.invalidateQueries({ queryKey: ["admin", "system-health"] });
      setPreview(null);
      setReason("");
      toast({ title: "تمت التسوية بنجاح" });
    },
    onError: (err: any) =>
      toast({ title: "تعذرت التسوية", description: err?.message, variant: "destructive" }),
  });

  function applyRepair() {
    if (!preview) return;
    if (reason.trim().length < 3) {
      toast({ title: "أدخل سبب التسوية", description: "٣ أحرف على الأقل", variant: "destructive" });
      return;
    }
    // Second, explicit confirmation before touching live financial data.
    if (!window.confirm(`سيتم تعديل ${preview.affectedCount} سجل. هذا الإجراء يُسجَّل في سجل التدقيق. هل تريد المتابعة؟`))
      return;
    repair.mutate({ target: preview.target, reason: reason.trim() });
  }

  function exportFindings() {
    if (!preview) return;
    const blob = new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation-dryrun-${preview.target}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const drift = data?.cashbox;
  const balanced = drift ? Math.abs(drift.drift) < 0.01 : true;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      {!canRepair && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> يمكنك عرض الفروقات فقط — تنفيذ التسوية يتطلب صلاحية التسوية ودور المدير.
        </div>
      )}

      {isError ? (
        <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger flex items-center gap-2">
          <XCircle className="w-4 h-4" /> تعذّر تحميل بيانات التسوية.
        </div>
      ) : isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <section className="bg-card rounded-xl border border-border/30 p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-semibold text-foreground">الصندوق الرئيسي</h2>
            {balanced ? (
              <span className="text-xs text-status-success flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> مطابق
              </span>
            ) : (
              <span className="text-xs text-status-danger flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> يوجد فرق
              </span>
            )}
          </div>

          {drift && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="الرصيد المخزّن" value={formatCurrency(drift.stored)} />
              <Stat label="الرصيد المحتسب" value={formatCurrency(drift.expected)} />
              <Stat label="الفرق" value={formatCurrency(drift.drift)} tone={balanced ? "normal" : "danger"} />
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            تعيد التسوية احتساب رصيد الصندوق من الحركات المالية المنفّذة (الرصيد الافتتاحي + الإيرادات − المصروفات).
            لا يتم تعديل أي بيانات إلا بعد المعاينة وإدخال السبب وتأكيد ثانٍ.
          </p>

          {canRepair && !balanced && (
            <div className="space-y-3">
              {/* Step 1 — read-only preview */}
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={dryRun.isPending}
                onClick={() => dryRun.mutate("cashbox")}
              >
                {dryRun.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                معاينة (تشغيل تجريبي)
              </Button>

              {/* Step 2 — before/after + export + reason + apply */}
              {preview && preview.target === "cashbox" && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      نتيجة المعاينة — {preview.affectedCount} سجل متأثر
                    </p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={exportFindings}>
                      <Download className="w-3.5 h-3.5" /> تصدير
                    </Button>
                  </div>

                  {preview.changes.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border/30">
                            <th className="text-right py-1.5 px-2">السجل</th>
                            <th className="text-right py-1.5 px-2">الحقل</th>
                            <th className="text-right py-1.5 px-2">قبل</th>
                            <th className="text-right py-1.5 px-2">بعد</th>
                            <th className="text-right py-1.5 px-2">الفرق</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.changes.map((c, i) => (
                            <tr key={i} className="border-b border-border/10">
                              <td className="py-1.5 px-2 text-foreground">{c.record}</td>
                              <td className="py-1.5 px-2 text-muted-foreground" dir="ltr">{c.field}</td>
                              <td className="py-1.5 px-2 tabular-nums">{formatCurrency(c.before)}</td>
                              <td className="py-1.5 px-2 tabular-nums text-primary">{formatCurrency(c.after)}</td>
                              <td className="py-1.5 px-2 tabular-nums text-status-danger">{formatCurrency(c.delta)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{preview.detail}</p>
                  )}

                  {preview.affectedCount > 0 && (
                    <>
                      <label className="block">
                        <span className="block text-xs text-muted-foreground mb-1">سبب التسوية (إلزامي)</span>
                        <textarea
                          rows={2}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="مثال: فرق ناتج عن حركة أُلغيت يدوياً..."
                          className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </label>
                      <Button
                        size="sm"
                        className="gap-2"
                        disabled={repair.isPending || reason.trim().length < 3}
                        onClick={applyRepair}
                      >
                        {repair.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                        تطبيق التسوية
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="bg-card rounded-xl border border-border/30 p-4 sm:p-6">
        <h2 className="font-semibold text-foreground mb-2">تسويات أخرى</h2>
        <p className="text-xs text-muted-foreground">
          إعادة احتساب دورات الرواتب وفترات المكافآت تُنفَّذ من داخل وحداتها (الرواتب، المكافآت) للحفاظ على منطق كل
          وحدة دون تكرار.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "normal" | "danger" }) {
  return (
    <div className="bg-background/40 rounded-lg border border-border/20 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold tabular-nums mt-0.5 ${tone === "danger" ? "text-status-danger" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
