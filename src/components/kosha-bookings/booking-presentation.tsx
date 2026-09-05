import { Camera, Crown, MessageSquare, TriangleAlert } from "lucide-react";
import type { KoshaManagerBooking } from "@/lib/kosha-manager-contract";
import { bookingLabels, executionLabels, paymentLabels } from "@/lib/kosha-manager";
import { cn } from "@/lib/utils";

export function BookingStatusBadge({status, execution=false}:{status:string;execution?:boolean}) {
  const good=["completed","delivered","paid"].includes(status);
  const bad=["cancelled","unpaid"].includes(status);
  return <span className={cn("inline-flex max-w-full rounded-lg px-2.5 py-1 text-xs font-medium leading-5",good?"bg-emerald-50 text-emerald-800":bad?"bg-rose-50 text-rose-800":"bg-amber-50 text-amber-900")}>{(execution?executionLabels:bookingLabels)[status]||status||"غير محدد"}</span>;
}
export function PaymentStatusBadge({status}:{status:string}) {
  return <span className={cn("inline-flex rounded-lg px-2.5 py-1 text-xs font-medium leading-5",status==="paid"?"bg-emerald-50 text-emerald-800":status==="partial"?"bg-amber-50 text-amber-900":"bg-rose-50 text-rose-800")}>{paymentLabels[status]||status||"غير محدد"}</span>;
}
export function KoshaThumbnail({booking}:{booking:KoshaManagerBooking}) {
  return <div className="flex min-w-0 items-center gap-3"><div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f5efe4] text-[#a5814c]">{booking.koshaImage?<img src={booking.koshaImage} alt="" loading="lazy" className="h-full w-full object-cover"/>:<Crown className="h-6 w-6" strokeWidth={1.5}/>}</div><div className="min-w-0"><p className="max-w-48 break-words text-sm font-semibold text-slate-900">{booking.koshaName||booking.packageName||"حجز كوشة"}</p><p className="mt-1 text-xs text-slate-500" dir="ltr">{booking.number}</p></div></div>;
}
export function BookingActivityIndicators({booking,onClick}:{booking:KoshaManagerBooking;onClick:()=>void}) {
  const a=booking.activity;
  if(!a.photos&&!a.notes&&!a.problems)return null;
  return <button type="button" onClick={onClick} className="flex min-h-10 flex-wrap items-center gap-3 rounded-lg text-xs text-slate-500 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`تنفيذ الكادر: ${a.photos} صور، ${a.notes} ملاحظات، ${a.problems} مشاكل`}><span className="flex items-center gap-1"><Camera size={14}/>{a.photos}</span><span className="flex items-center gap-1"><MessageSquare size={14}/>{a.notes}</span>{a.problems>0&&<span className={cn("flex items-center gap-1",a.openProblems>0&&"text-amber-800")}><TriangleAlert size={14}/>{a.problems}{a.openProblems>0&&" · مشكلة مفتوحة"}</span>}</button>;
}
