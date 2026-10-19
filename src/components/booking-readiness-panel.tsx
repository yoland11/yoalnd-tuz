import {AlertTriangle,CheckCircle2,ClipboardCheck,HelpCircle,RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import type {BookingOperationalReadiness,BookingReadinessSummary} from "@/lib/booking-operational-readiness";

export type ReadinessDisplay=BookingOperationalReadiness & {generatedAt?:string};
const labels={not_ready:"غير جاهز",needs_followup:"يحتاج متابعة",ready:"جاهز للتنفيذ"};
export function readinessText(value?:BookingReadinessSummary|null) {
  if(!value) return "غير مفحوص";
  return `${value.percentage == null ? "غير متاح" : `${value.percentage}% اكتمال الفحوص`} · ${labels[value.status]}`;
}
export function BookingReadinessStatus({readiness}:{readiness?:BookingReadinessSummary|null}) {
  return <span className="break-words text-sm" dir="rtl">{readinessText(readiness)}</span>;
}
export function BookingReadinessPanel({readiness,loading=false,error,onRetry}:{readiness?:ReadinessDisplay|null;loading?:boolean;error?:unknown;onRetry?:()=>void}) {
  if(loading && !readiness) return <div aria-label="تحميل فحص الجاهزية" className="space-y-3"><Skeleton className="h-20 rounded-xl"/><Skeleton className="h-64 rounded-xl"/></div>;
  const stamp=readiness?.generatedAt && Number.isFinite(Date.parse(readiness.generatedAt)) ? new Date(readiness.generatedAt).toLocaleString("ar-IQ-u-nu-latn",{timeZone:"Asia/Baghdad",dateStyle:"short",timeStyle:"short"}) : null;
  return <section dir="rtl" aria-label="فحص جاهزية الحجز" className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="h-5 w-5 text-primary"/>فحص جاهزية الحجز</h2><p className="mt-1 max-w-prose text-sm text-muted-foreground">فحوص تشغيلية من سجل الحجز. لا تؤثر المبالغ المدفوعة أو المتبقية على نسبة الفحوص.</p></div>
      {onRetry ? <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={onRetry} disabled={loading}><RefreshCw className="h-4 w-4"/>{loading ? "جارٍ التحديث" : "تحديث الفحص"}</Button> : null}
    </header>
    {error ? <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><strong>تعذر تحديث فحص الجاهزية</strong><p className="mt-1">{readiness ? "المعروض آخر قراءة ناجحة، وليس تأكيداً للحالة الحالية." : "لم يمكن التحقق من المتطلبات؛ لا تُعتمد الجاهزية من هذه القراءة."}</p>{onRetry ? <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={onRetry} disabled={loading}>إعادة المحاولة</Button> : null}</div> : null}
    {!readiness ? !error ? <p role="status" className="mt-4 text-sm">لم تتوفر قراءة لفحوص هذا الحجز. غير مفحوص؛ أعد تحميل الفحص قبل التنفيذ.</p> : null : <>
      <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
        <div><strong className={readiness.status==="ready" && !error ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}>{labels[readiness.status]}</strong><p className="mt-1 text-sm text-muted-foreground">{readiness.blockers.length ? `${readiness.blockers.length} فحوص إلزامية غير مكتملة أو غير موثقة` : readiness.checks.some(c=>c.mandatory && c.applicable) ? "الفحوص الإلزامية المسجلة مكتملة" : "لم تُوثق متطلبات إلزامية قابلة للفحص"}</p></div>
        <div className="text-start"><b className="text-xl tabular-nums">{readiness.percentage == null ? "—" : `${readiness.percentage}%`}</b><p className="text-sm text-muted-foreground">اكتمال الفحوص</p></div>
      </div>
      <ul className="grid min-w-0 gap-x-6 md:grid-cols-2">{readiness.checks.map(check=>{
        const Icon=!check.applicable ? HelpCircle : check.state==="pass" ? CheckCircle2 : check.state==="fail" ? AlertTriangle : HelpCircle;
        return <li key={check.id} className="min-w-0 border-b border-border py-3 last:border-b-0"><div className="flex items-start gap-2"><Icon aria-hidden="true" className={`mt-1 h-4 w-4 shrink-0 ${!check.applicable ? "text-muted-foreground" : check.state==="pass" ? "text-emerald-700 dark:text-emerald-300" : check.state==="fail" ? "text-destructive" : "text-primary"}`}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><a className="inline-flex min-h-11 items-center break-words font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={check.href}>{check.label}</a><span className="text-sm text-muted-foreground">{!check.applicable ? "غير مطلوب" : check.state==="pass" ? "موثق" : check.state==="fail" ? "غير مكتمل" : "غير موثق"} · {check.mandatory ? "إلزامي" : "اختياري"}</span></div><p className="max-w-prose break-words text-sm text-muted-foreground">{check.reason}</p></div></div></li>;
      })}</ul>
      <footer className="mt-4 flex flex-wrap justify-between gap-2 text-sm text-muted-foreground"><p className="max-w-prose">الفحص لا يغيّر حالة الحجز ولا يحجز المعدات. المتطلبات الإلزامية غير الموثقة تحتاج مراجعة قبل التنفيذ.</p>{stamp ? <p>آخر فحص: <bdi dir="ltr">{stamp}</bdi> · بغداد</p> : null}</footer>
    </>}
  </section>;
}
