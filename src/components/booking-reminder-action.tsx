import {useEffect,useRef,useState} from "react";
import {useMutation,useQueryClient} from "@tanstack/react-query";
import {Bell} from "lucide-react";
import {Button} from "./ui/button";
import {Textarea} from "./ui/textarea";
import {Checkbox} from "./ui/checkbox";
import {Field,FieldGroup,FieldLabel} from "./ui/field";
import {Alert,AlertDescription,AlertTitle} from "./ui/alert";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "./ui/dialog";
import {adminFetch,apiErrorMessage} from "@/views/admin/_lib";
import type {BookingReminderRequest,sendBookingReminders} from "@/server/booking-reminders";
type Row={source:"kosha"|"service";id:number;number:string};
type Result=Awaited<ReturnType<typeof sendBookingReminders>>;
export function BookingReminderAction({rows,actorId,canManage,disabled}:{rows:Row[];actorId?:number;canManage:boolean;disabled?:boolean}){
  const qc=useQueryClient();const [open,setOpen]=useState(false),[message,setMessage]=useState(""),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<BookingReminderRequest|null>(null),[result,setResult]=useState<Result|null>(null),[failure,setFailure]=useState("");
  const submitting=useRef(false),restored=useRef(0);const cacheKey=actorId?`ajn:booking-reminder:v1:${actorId}`:null;
  function store(command:BookingReminderRequest|null){setPending(command);try{if(cacheKey){if(command)sessionStorage.setItem(cacheKey,JSON.stringify(command));else sessionStorage.removeItem(cacheKey)}}catch{/* Server receipt remains the source of retry safety. */}}
  useEffect(()=>{if(!actorId||!cacheKey||restored.current===actorId)return;restored.current=actorId;try{const value=JSON.parse(sessionStorage.getItem(cacheKey)||"null");if(value?.action==="send_reminder"&&value.requestId&&Array.isArray(value.refs)){setPending(value);setOpen(true);setFailure("توجد محاولة تذكير غير مؤكدة؛ أعد نفس المحاولة دون تكرار.")}}catch{/* Invalid local cache cannot authorize server actions. */}},[actorId,cacheKey]);
  const mutation=useMutation({mutationFn:(command:BookingReminderRequest)=>adminFetch<Result>("/admin/booking-operations/bulk",{method:"POST",body:JSON.stringify({...command,confirmation:true})}),onSuccess:value=>{setResult(value);const retry=value.results.some(r=>r.status==="failed"&&(r.httpStatus??500)>=500);if(!retry)store(null);setFailure(retry?"لم يتأكد إرسال بعض التذكيرات. أعد نفس المحاولة؛ لن تتكرر النتائج الناجحة.":"");void qc.invalidateQueries({queryKey:["admin","booking-operations"]})},onError:cause=>{setFailure(apiErrorMessage(cause));const status=(cause as any)?.status;if(status>=400&&status<500)store(null)},onSettled:()=>{submitting.current=false}});
  function send(){if(submitting.current||pending||!canManage||!confirmed||!rows.length||rows.length>50||!message.trim())return;const command:BookingReminderRequest={requestId:crypto.randomUUID(),action:"send_reminder",refs:rows.map(({source,id})=>({source,id})),message:message.trim()};submitting.current=true;store(command);mutation.mutate(command)}
  const busy=mutation.isPending||!!pending;
  return <><Button variant="outline" disabled={disabled||!canManage||!rows.length||rows.length>50||busy} onClick={()=>{setOpen(true);setConfirmed(false);setResult(null);setFailure("")}}><Bell data-icon="inline-start"/>إرسال تذكير تشغيلي</Button>{pending&&!open?<Button variant="outline" onClick={()=>setOpen(true)}>متابعة التذكير غير المؤكد</Button>:null}
    <Dialog open={open} onOpenChange={value=>{if(!mutation.isPending)setOpen(value)}}><DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>تذكير فريق الحجوزات المحددة</DialogTitle><DialogDescription>إشعار داخل بوابة الموظف للموظفين الفعّالين المعيّنين للحجز أو مهامه. لا رسائل خارجية ولا تغيير للمخزون أو الدفعات.</DialogDescription></DialogHeader>
      <p className="text-sm">{pending?.refs.length??rows.length} حجزاً · كل حجز يُراجع مستقلاً، وتُعرض أسباب منع الإرسال.</p>
      <FieldGroup><Field data-disabled={busy}><FieldLabel htmlFor="booking-reminder-message">نص التذكير</FieldLabel><Textarea id="booking-reminder-message" value={pending?.message??message} maxLength={500} disabled={busy} onChange={e=>setMessage(e.target.value)}/></Field><Field orientation="horizontal" data-disabled={busy}><Checkbox id="booking-reminder-confirm" checked={confirmed} disabled={busy} onCheckedChange={v=>setConfirmed(v===true)}/><FieldLabel htmlFor="booking-reminder-confirm">أؤكد إرسال تذكير تشغيلي للحجوزات المحددة</FieldLabel></Field></FieldGroup>
      {failure?<Alert variant="destructive"><AlertTitle>لم تتأكد كل التذكيرات</AlertTitle><AlertDescription>{failure}</AlertDescription></Alert>:null}
      {result?<ul aria-label="نتائج إرسال التذكير" className="flex flex-col gap-2 text-sm">{result.results.map(r=><li key={`${r.source}:${r.id}`}><b>{rows.find(row=>row.source===r.source&&row.id===r.id)?.number??`${r.source}:${r.id}`}</b> · {r.status==="success"?r.replayed?"أُرسل سابقاً — دون تكرار":`أُرسل إلى ${r.updated} موظف`:`لم يُرسل: ${r.message}`}</li>)}</ul>:null}
      {pending?<Button disabled={!canManage||mutation.isPending} onClick={()=>{if(submitting.current)return;submitting.current=true;mutation.mutate(pending)}}>إعادة التذكير نفسه دون تكرار</Button>:<Button disabled={!canManage||mutation.isPending||!confirmed||!rows.length||rows.length>50||!message.trim()} onClick={send}>تأكيد إرسال التذكير</Button>}
    </DialogContent></Dialog>
  </>;
}
