import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/money";

type KoshaTrackingStep = { key: string; label: string; done: boolean; current: boolean };

type KoshaTracking = {
  trackingCode: string | null;
  koshaName: string | null;
  packageName: string | null;
  customerName: string;
  eventDate: string;
  eventTime: string;
  trackingStatus: string;
  currentStep: number;
  steps: KoshaTrackingStep[];
  priced: boolean;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  createdAt: string;
};

export default function KoshaTrackingPage() {
  const [, params] = useRoute("/kosha-tracking/:token");
  const token = params?.token ?? "";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["kosha-tracking", token],
    queryFn: async () => {
      const res = await fetch(`/api/koshas/track/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("لم يتم العثور على الحجز");
      return res.json() as Promise<KoshaTracking>;
    },
    enabled: !!token,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return <div className="flex min-h-[60dvh] items-center justify-center" dir="rtl"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center" dir="rtl">
        <h1 className="text-lg font-bold text-foreground">تعذّر العثور على الحجز</h1>
        <p className="mt-2 text-sm text-muted-foreground">تحقّق من رابط التتبع أو امسح الكود من فاتورتك مرة أخرى.</p>
      </div>
    );
  }

  const currentLabel = data.steps[data.currentStep]?.label ?? "—";
  return (
    <div className="mx-auto max-w-xl px-4 py-8" dir="rtl">
      <div className="rounded-2xl border border-border/40 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">رقم التتبع</p>
            <p className="font-mono text-lg font-bold text-primary">{data.trackingCode}</p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{currentLabel}</span>
        </div>
        <div className="mt-3 text-sm font-medium text-foreground">{data.koshaName || "كوشة"}{data.packageName ? ` • ${data.packageName}` : ""}</div>
        {data.eventDate ? (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{data.eventDate} {data.eventTime}</div>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-border/40 bg-card p-5">
        <h2 className="mb-4 text-sm font-bold text-foreground">حالة الكوشة</h2>
        <ol className="relative">
          {data.steps.map((step, index) => {
            const last = index === data.steps.length - 1;
            return (
              <li key={step.key} className="relative flex gap-3 pb-6 last:pb-0">
                {!last ? <span className={`absolute right-[13px] top-7 h-[calc(100%-12px)] w-0.5 ${step.done ? "bg-primary" : "bg-border"}`} aria-hidden /> : null}
                <span className={`relative z-10 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border ${step.done ? "border-primary bg-primary text-primary-foreground" : step.current ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}>
                  {step.done ? <Check className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}
                </span>
                <div className="pt-0.5">
                  <p className={`text-sm font-semibold ${step.current ? "text-primary" : step.done ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</p>
                  {step.current ? <p className="mt-0.5 text-xs text-muted-foreground">الحالة الحالية</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {data.priced ? (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border/30 bg-card p-3 text-center"><p className="text-[11px] text-muted-foreground">الإجمالي</p><p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(data.totalAmount)}</p></div>
          <div className="rounded-xl border border-border/30 bg-card p-3 text-center"><p className="text-[11px] text-muted-foreground">الواصل</p><p className="mt-1 text-sm font-bold text-status-success">{formatCurrency(data.paidAmount)}</p></div>
          <div className="rounded-xl border border-border/30 bg-card p-3 text-center"><p className="text-[11px] text-muted-foreground">المتبقي</p><p className="mt-1 text-sm font-bold text-status-danger">{formatCurrency(data.remainingAmount)}</p></div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4 text-center text-sm text-muted-foreground">بانتظار تحديد السعر من الإدارة</div>
      )}
    </div>
  );
}
