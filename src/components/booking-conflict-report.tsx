import {useId, useState} from "react";
import {RefreshCw, ShieldAlert} from "lucide-react";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Skeleton} from "@/components/ui/skeleton";
import {conflictBookingHref, type BookingConflictReport, type ConflictReportRow} from "@/lib/booking-conflict-report";

const kinds:Record<ConflictReportRow["kind"],string>={asset:"معدة فردية",quantity:"معدات بالكميات",staff:"كادر / سائق",vehicle:"مركبة",crew:"فريق تركيب",kosha:"كوشة"};
const states={conflict:"تعارض مسجل",incomplete:"يحتاج مراجعة",no_conflict:"لا تعارض مسجل"} as const;
const number=(value:number|null)=>value===null?"غير محدد":new Intl.NumberFormat("ar-IQ",{maximumFractionDigits:8}).format(value);

export function BookingConflictReportView({data,loading=false,error,onRefresh}:{data?:BookingConflictReport;loading?:boolean;error?:unknown;onRefresh:()=>void}){
  const [showAll,setShowAll]=useState(false),filterId=useId();
  const refresh=<Button type="button" variant="outline" className="min-h-11" onClick={onRefresh} disabled={loading}><RefreshCw aria-hidden="true" data-icon="inline-start"/>{loading?"جارٍ فحص التعارضات":"تحديث فحص التعارضات"}</Button>;
  if(error)return <section dir="rtl" aria-label="فحص تعارضات الموارد"><Alert variant="destructive"><AlertTitle>تعذر فحص التعارضات</AlertTitle><AlertDescription><p>لم نعتمد نتائج القراءة السابقة. أعد المحاولة؛ لا يمكن اعتبار الموارد متاحة.</p><p className="mt-2 break-words">{error instanceof Error?error.message:"تعذر تحميل بيانات الفحص"}</p><div className="mt-3">{refresh}</div></AlertDescription></Alert></section>;
  if(loading||!data)return <section dir="rtl" aria-label="تحميل فحص التعارضات" aria-busy="true" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4"><p>جارٍ فحص التعارضات</p><Skeleton className="h-12"/><Skeleton className="h-24"/></section>;
  const conflicts=data.rows.filter(row=>row.state==="conflict").length,incomplete=data.rows.filter(row=>row.state==="incomplete").length;
  const rows=showAll?data.rows:data.rows.filter(row=>row.state!=="no_conflict");
  return <section dir="rtl" aria-label="فحص تعارضات الموارد" className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><ShieldAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary"/><div className="min-w-0"><h2 className="text-lg font-semibold">فحص تعارضات الموارد</h2><p className="mt-1 text-sm">تعارضات: {conflicts} · يحتاج مراجعة: {incomplete} · موارد مفحوصة: {data.rows.length}</p></div></div>{refresh}</header>
    <Alert role="note" className="mt-4"><AlertTitle>فحص جزئي — لا يعتمد جاهزية الحجز</AlertTitle><AlertDescription>يعرض الإشغال المسجل في مركز الحجوزات وأول حجز متداخل لكل مورد. مواعيد التصوير المستقلة وبعض مسارات الإسناد لم تُستكمل تغطيتها بعد. هذه قراءة لحظية وليست حجزاً للمورد؛ يُعاد التحقق عند التأكيد.</AlertDescription></Alert>
    {!data.timingComplete?<p role="status" className="mt-3 text-sm font-medium">مواعيد التشغيل غير مكتملة؛ حددها في القسم أعلاه قبل اعتماد أي توفر.</p>:null}
    <div className="my-4 flex flex-wrap items-center justify-between gap-3 text-sm"><label htmlFor={filterId} className="flex min-h-11 cursor-pointer items-center gap-2"><Checkbox id={filterId} checked={showAll} onCheckedChange={value=>setShowAll(value===true)}/>عرض كل الموارد المفحوصة</label><p>تُحدّث النتائج عند إعادة الفحص.</p></div>
    {rows.length?<ul className="min-w-0 divide-y divide-border">{rows.map(row=><li key={row.key} aria-label={`${kinds[row.kind]}: ${row.name}`} className="min-w-0 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{row.name}</p><p className="mt-1 text-sm text-foreground/80">{kinds[row.kind]}</p></div><Badge variant={row.state==="conflict"?"destructive":"outline"}>{states[row.state]}</Badge></div>
      <p className="mt-2 break-words text-sm">{row.reason}</p>
      {row.quantities?<><dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["المطلوب",row.quantities.required],["المتاح خلال الفترة",row.quantities.available],["المحجوز / المشغول",row.quantities.reserved],["الناقص",row.quantities.missing]].map(([label,value])=><div key={String(label)} className="min-w-0"><dt className="text-foreground/80">{label}</dt><dd className="mt-1 break-words font-semibold">{number(value as number|null)} {row.quantities!.unit}</dd></div>)}</dl><p className="mt-2 text-sm text-foreground/80">التوفر خلال الفترة يستبعد حجزك الحالي، ويشمل الإشغال والحجوزات الأخرى؛ ليس رصيد المستودع الفوري.</p></>:null}
      {row.booking?<Button variant="outline" asChild className="mt-3 min-h-11 max-w-full whitespace-normal text-start"><a href={conflictBookingHref(row.booking)}>مراجعة الحجز الآخر · {row.booking.source==="kosha"?"كوشة":"خدمة"} <bdi dir="ltr">#{row.booking.id}</bdi></a></Button>:null}
    </li>)}</ul>:<p role="status" className="py-3 text-sm">{data.rows.length?"لم تظهر تعارضات في الفحوص المتاحة. فعّل عرض كل الموارد لمراجعة التفاصيل؛ التغطية جزئية ولا تُعد اعتماداً للتنفيذ.":"لم تُسجل موارد لهذا الحجز؛ أضف المعدات والفريق والنقل ثم أعد الفحص."}</p>}
  </section>;
}
