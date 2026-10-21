import {useQuery} from "@tanstack/react-query";
import {CircleDollarSign,RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {adminFetch,apiErrorMessage,formatCurrency} from "@/views/admin/_lib";
import type {getBookingProfitability} from "@/server/booking-profitability";
type Data=Awaited<ReturnType<typeof getBookingProfitability>>;
const value=(amount:number|null)=>amount===null?"غير متاح":formatCurrency(amount);
const statusLabel:Record<string,string>={executed:"معتمد ومنفذ",pending:"بانتظار الموافقة",estimated:"تقديري — غير معتمد"};

export function BookingProfitabilityView({data}:{data:Data}){
  const figures:[string,number|null][]=[["قيمة العقد",data.contractValue],["التحصيل النقدي",data.collected],["المتبقي على العميل",data.receivable],["الإيراد المعترف به",data.recognizedRevenue],["تكاليف تشغيل معتمدة وموثقة",data.approvedOperatingCost],["تكاليف تشغيل معلقة / تقديرية",data.provisionalOperatingCost],["استثمار المعدات — ليس تكلفة لكل حجز",data.capitalInvestment],["هامش تقديري حسب التكاليف المسجلة فقط",data.estimatedMargin],["الربح الفعلي",data.actualProfit]];
  return <section dir="rtl" aria-label="ربحية الحجز" className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    <header className="flex items-start gap-2"><CircleDollarSign className="mt-1 h-5 w-5 shrink-0 text-primary"/><div><h3 className="text-lg font-semibold">ربحية الحجز</h3><p className="mt-1 text-sm text-muted-foreground">تحليل للقراءة فقط من المراجع المالية الأصلية، دون إنشاء مصروف أو حركة صندوق.</p></div></header>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{figures.map(([label,amount])=><div key={label} className="rounded-lg border border-border p-3"><dt className="text-sm leading-relaxed text-muted-foreground">{label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums">{value(amount)}</dd></div>)}</dl>
    <div role="status" className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm leading-relaxed text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"><b>الربحية الفعلية غير مكتملة</b><ul className="mt-2 list-inside list-disc space-y-1">{data.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>
    <div className="space-y-3"><h4 className="font-semibold">التكاليف المرتبطة دون تكرار</h4>{data.costs.length?<ul className="divide-y divide-border">{data.costs.map(cost=><li key={cost.key} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words font-medium">{cost.label}</p><p className="text-sm text-muted-foreground">{statusLabel[cost.status]??cost.status} · {cost.category==="investment"?"استثمار معدات منفصل":"تكلفة تشغيل الحجز"}</p></div><b className="tabular-nums">{formatCurrency(cost.amount)}</b></li>)}</ul>:<p className="text-sm text-muted-foreground">{data.approvedOperatingCost===null?"بيانات ربط التكاليف بهذا المصدر غير متاحة؛ لا يعني ذلك أن التكلفة صفر.":"لا توجد تكاليف مرتبطة صراحة بالحجز ضمن المصادر المقروءة؛ اكتمال التكاليف غير موثّق."}</p>}</div>
  </section>;
}

export function BookingProfitabilityPanel({endpoint,queryKey}:{endpoint:string;queryKey:readonly unknown[]}){
  const query=useQuery<Data>({queryKey:[...queryKey,"profitability"],queryFn:()=>adminFetch(endpoint)});
  return <div className="space-y-3"><div className="flex justify-end"><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw className="h-4 w-4"/>تحديث الربحية</Button></div>{query.isError?<div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm"><b>تعذر قراءة ربحية الحجز</b><p>{apiErrorMessage(query.error)}</p>{query.data?<p>المعروض آخر قراءة ناجحة، وليس تأكيداً للحالة الحالية.</p>:null}<Button variant="outline" onClick={()=>void query.refetch()}>إعادة المحاولة</Button></div>:null}{query.isLoading?<Skeleton className="h-64 w-full rounded-xl"/>:null}{query.data?<BookingProfitabilityView data={query.data}/>:null}</div>;
}
