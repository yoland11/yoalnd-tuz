import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, Loader2, QrCode, RefreshCw, RotateCcw, Truck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeSelect } from "@/components/employee-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import type { LoadingRecord, LoadingRequest } from "@/lib/booking-loading";
import type { getLoadingView } from "@/server/booking-loading";

type View=Awaited<ReturnType<typeof getLoadingView>>;
type Draft=LoadingRequest extends infer R?R extends LoadingRequest?Omit<R,"requestId">:never:never;
type Line=LoadingRecord["lines"][number];
const CameraScanner=lazy(()=>import("@/views/staff/live-scanner").then(m=>({default:m.LiveScanner})));
const number=(n:number)=>n.toLocaleString("ar-IQ-u-nu-latn",{maximumFractionDigits:3});
const date=(value:string)=>new Date(value).toLocaleString("ar-IQ",{timeZone:"Asia/Baghdad"});
const conditionLabel={good:"سليم",damaged:"تالف",missing:"مفقود",maintenance:"يحتاج صيانة"} as const;

/** Legacy work orders lack the canonical damaged/missing quantity buckets. */
export function LegacyWorkOrderReturnForm({note,onNote,busy,onConfirm}:{note:string;onNote:(value:string)=>void;busy:boolean;onConfirm:()=>void}){
  return <><p role="status" className="rounded-lg bg-muted p-3 text-sm">إرجاع سليم فقط من أمر التنفيذ القديم. إذا وُجد تلف أو فقدان أو صيانة، لا تؤكد الإرجاع كسليم؛ سجّل بلاغ الحالة في الحجز واطلب مراجعة المستودع.</p><Label htmlFor="work-order-return-note">ملاحظة (اختياري)</Label><Textarea id="work-order-return-note" maxLength={1000} disabled={busy} value={note} onChange={e=>onNote(e.target.value)}/><Button disabled={busy} onClick={onConfirm}>تأكيد الإرجاع السليم إلى أمر التنفيذ الأصلي</Button></>;
}

export function LoadingPanelView({view,busy,onAction,onReturn}:{view:View;busy:boolean;onAction:(command:Draft)=>void;onReturn?:(line:Line,outstanding:number)=>void}) {
  const {record,facts}=view;
  const [responsible,setResponsible]=useState(String(record?.responsibleId??facts.staff[0]?.id??""));
  const [sender,setSender]=useState(String(record?.senderId??facts.staff[0]?.id??""));
  const [receiver,setReceiver]=useState(String(record?.receiverId??facts.staff[1]?.id??""));
  const [revise,setRevise]=useState(false),[reason,setReason]=useState("");
  const [selected,setSelected]=useState(record?.lines[0]?.key??""),[code,setCode]=useState(""),[quantity,setQuantity]=useState("1"),[camera,setCamera]=useState(false);
  const [handover,setHandover]=useState({receiverId:"",from:"",to:"",condition:"good" as keyof typeof conditionLabel,note:""});
  const [cancelReason,setCancelReason]=useState("");
  const employees=facts.staff.map(s=>({id:s.id,fullName:s.name,avatarUrl:(s as any).avatarUrl??null}));
  const employee=(id:number)=>facts.staff.find(s=>s.id===id)?.name??"موظف من الفريق الأصلي";
  const disabled=busy||!view.canAct;
  const currentLine=record?.lines.find(l=>l.key===selected);
  const complete=!!record&&record.lines.every(l=>l.loaded===l.required);
  const total=record?.lines.reduce((sum,l)=>sum+l.required,0)??0;
  const loaded=record?.lines.reduce((sum,l)=>sum+l.loaded,0)??0;
  const progress=total?Math.round(loaded/total*100):0;
  const pendingHandover=record?.handovers.find(h=>!h.receivedAt&&!h.cancelledAt);
  const currentHolder=record?.handovers.filter(h=>h.receivedAt).at(-1)?.receiverId;
  const scan=(value:string)=>{
    if(!record||!currentLine||disabled)return;
    setCamera(false);
    onAction({type:"scan",manifestId:record.id,lineKey:currentLine.key,code:value.trim(),quantity:Number(quantity)});
  };
  const employeeField=(label:string,value:string,onChange:(value:string)=>void)=>
    <div className="min-w-0 space-y-2"><Label>{label}</Label><EmployeeSelect employees={employees} value={value} onValueChange={onChange} disabled={disabled} aria-label={label} /></div>;
  return <section dir="rtl" className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="تحميل المركبة والعهدة">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2"><Truck className="mt-1 h-5 w-5 shrink-0 text-primary"/><div><h3 className="text-lg font-semibold">تحميل المركبة</h3><p className="mt-1 max-w-prose text-sm text-muted-foreground">تجهيز ← صرف أصلي ← مسح QR ← تسليم واستلام ← إرجاع وفحص.</p></div></div>
      <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium">{record?.status==="confirmed"?"التحميل مؤكد":record?"قيد التحميل":"لم تبدأ قائمة التحميل"}</span>
    </header>
    <p className="text-sm leading-relaxed">التحميل مرتبط بنفس الحجز ومراجع الصرف الأصلية؛ لا يخصم المخزون مرة ثانية. المواد المستهلكة لا تتطلب إرجاعاً عادياً.</p>
    {!view.canAct?<p className="rounded-lg bg-muted p-3 text-sm" role="status">عرض فقط؛ الإجراءات لفريق الحجز المخول.</p>:null}
    {view.blockers.length?<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="status"><b>قبل بدء التحميل</b><ul className="mt-2 list-inside list-disc space-y-1">{view.blockers.map((item,i)=><li key={i}>{item}</li>)}</ul><p className="mt-2">جهّز المعدات وأخرجها من الإجراءات الأصلية في هذا الحجز، وحدد المركبة وفريق التسليم والاستلام.</p></div>:null}
    <dl className="flex flex-wrap gap-x-8 gap-y-2 border-y border-border py-3 text-sm"><div><dt className="text-muted-foreground">المركبة</dt><dd className="font-semibold">{record?.vehicleName??facts.vehicle?.name??"غير معينة"}</dd></div>{record?<><div><dt className="text-muted-foreground">مسؤول التحميل</dt><dd>{employee(record.responsibleId)}</dd></div><div><dt className="text-muted-foreground">المسلّم ← المستلم</dt><dd>{employee(record.senderId)} ← {employee(record.receiverId)}</dd></div></>:null}</dl>
    {!record||revise?<div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">{employeeField("مسؤول التحميل",responsible,setResponsible)}{employeeField("الموظف المسلّم",sender,setSender)}{employeeField("الموظف المستلم",receiver,setReceiver)}</div>
      {revise?<div className="space-y-2"><Label htmlFor="loading-revision-reason">سبب مراجعة القائمة</Label><Textarea id="loading-revision-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} disabled={disabled}/><p className="text-sm text-muted-foreground">تُحفظ القائمة السابقة وتبدأ مراجعة جديدة بمسح وإقرارات جديدة، دون تغيير الصرف أو المخزون.</p></div>:null}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled||(!revise&&view.blockers.length>0)||!responsible||!sender||!receiver||sender===receiver||(revise&&reason.trim().length<5)} onClick={()=>{
        if(revise&&record)onAction({type:"revise",manifestId:record.id,responsibleId:Number(responsible),senderId:Number(sender),receiverId:Number(receiver),reason:reason.trim()});
        else onAction({type:"create",responsibleId:Number(responsible),senderId:Number(sender),receiverId:Number(receiver)});
        setRevise(false);
      }}><ClipboardCheck className="h-4 w-4"/>{revise?"تأكيد مراجعة القائمة":"إنشاء قائمة التحميل من الصرف الأصلي"}</Button>{revise?<Button variant="outline" disabled={busy} onClick={()=>setRevise(false)}>إلغاء المراجعة</Button>:null}</div>
    </div>:null}
    {record?<>
      <div className="space-y-2" role="status"><div className="flex justify-between text-sm"><span>الممسوح {number(loaded)} من {number(total)}</span><b>{progress}%</b></div><progress className="h-2 w-full accent-primary" max={100} value={progress} aria-label="تقدم تحميل المعدات"/></div>
      <div className="divide-y divide-border">{record.lines.map(line=>{
        const returned=view.returns?.lines.find(l=>l.key===line.key);
        return <div key={line.key} role="group" aria-label={`عنصر التحميل: ${line.name}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <button type="button" disabled={disabled||record.status!=="loading"} onClick={()=>{setSelected(line.key);setQuantity("1");setCamera(false)}} aria-pressed={selected===line.key} className={`min-h-11 min-w-0 flex-1 rounded-lg p-2 text-right outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary ${selected===line.key?"bg-primary/10":"hover:bg-muted"}`}><b className="block break-words">{line.name}</b><span className="text-sm text-muted-foreground">{line.kind==="consumable"?"مادة مستهلكة":line.tracking==="individual"?"أصل فردي — مسح واحد لكل قطعة":"معدات متعددة الكمية — حدد الكمية"}</span></button>
          <span className="text-sm tabular-nums">{number(line.loaded)} / {number(line.required)} {line.unit}</span>
          {returned?<div className="text-sm"><span>معاد {number(returned.returned)} · خارج {number(returned.outstanding)}</span>{returned.damaged||returned.missing||returned.maintenance?<p className="text-destructive">تالف {returned.damaged} · مفقود {returned.missing} · صيانة {returned.maintenance}</p>:null}</div>:null}
          {record.status==="confirmed"&&line.kind==="asset"&&returned?.outstanding&&onReturn?<Button type="button" variant="outline" disabled={disabled} onClick={()=>onReturn(line,returned.outstanding)}><RotateCcw className="h-4 w-4"/>الإرجاع الأصلي</Button>:null}
        </div>;
      })}</div>
      {record.status==="loading"&&!revise?<>
        <form className="space-y-3 border-t border-border pt-4" onSubmit={e=>{e.preventDefault();scan(code)}}>
          <h4 className="font-semibold">مسح العنصر المحدد: {currentLine?.name??"اختر عنصراً"}</h4>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
            <div className="space-y-2"><Label htmlFor="loading-code">QR أو الباركود</Label><Input id="loading-code" value={code} onChange={e=>setCode(e.target.value)} disabled={disabled} autoComplete="off" dir="ltr" placeholder="امسح أو اكتب الرمز"/></div>
            <div className="space-y-2"><Label htmlFor="loading-quantity">الكمية الممسوحة</Label><Input id="loading-quantity" type="number" min={currentLine?.kind==="consumable"?0.001:1} step={currentLine?.kind==="consumable"?0.001:1} value={quantity} disabled={disabled||currentLine?.tracking==="individual"} onChange={e=>setQuantity(e.target.value)}/></div>
            <Button className="self-end" type="submit" disabled={disabled||!code.trim()||!currentLine||!(Number(quantity)>0)}><QrCode className="h-4 w-4"/>تأكيد المسح</Button>
          </div>
          <Button type="button" variant="outline" disabled={disabled||!currentLine} onClick={()=>setCamera(!camera)}><QrCode className="h-4 w-4"/>{camera?"إغلاق الكاميرا":"مسح بالكاميرا"}</Button>
          {camera&&!disabled?<div className="max-w-lg"><Suspense fallback={<Skeleton className="h-52 w-full rounded-lg"/>}><CameraScanner onDetect={scan} stopOnDetect /></Suspense></div>:null}
        </form>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {view.actorId===record.senderId?<Button type="button" variant="outline" disabled={disabled||!complete||!!record.acknowledgements.sender} onClick={()=>onAction({type:"acknowledge",manifestId:record.id,role:"sender"})}><Users className="h-4 w-4"/>إقراري بالتسليم</Button>:null}
          {view.actorId===record.receiverId?<Button type="button" variant="outline" disabled={disabled||!complete||!!record.acknowledgements.receiver} onClick={()=>onAction({type:"acknowledge",manifestId:record.id,role:"receiver"})}><Users className="h-4 w-4"/>إقراري بالاستلام</Button>:null}
          <Button type="button" disabled={disabled||!complete||!record.acknowledgements.sender||!record.acknowledgements.receiver||(!view.canManage&&view.actorId!==record.responsibleId)} onClick={()=>onAction({type:"confirm",manifestId:record.id})}><Check className="h-4 w-4"/>تأكيد تحميل المركبة</Button>
          {(view.canManage||view.actorId===record.responsibleId)?<Button type="button" variant="ghost" disabled={disabled} onClick={()=>setRevise(true)}>مراجعة القائمة قبل التأكيد</Button>:null}
        </div>
        <p className="text-sm text-muted-foreground">المسلّم: {record.acknowledgements.sender?"أقرّ بنفسه":"بانتظار إقراره"} · المستلم: {record.acknowledgements.receiver?"أقرّ بنفسه":"بانتظار إقراره"}. تأكيد التحميل لا يعتمد جاهزية الحجز الشاملة.</p>
      </>:null}
      {view.returns?<div className="rounded-lg bg-muted/50 p-3 text-sm" role="status"><b>مطابقة الإرجاع مع الصرف الأصلي</b><p className="mt-1">مطلوب {number(view.returns.required)} · معاد {number(view.returns.returned)} · لم يعد {number(view.returns.outstanding)}</p><p>تالف {view.returns.damaged} · مفقود {view.returns.missing} · يحتاج صيانة {view.returns.maintenance}</p></div>:null}
      <div className="space-y-3 border-t border-border pt-4"><h4 className="font-semibold">سجل عهدة المعدات</h4>
        {record.handovers.length?<ol className="space-y-3">{record.handovers.map(h=><li key={h.id} className="border-b border-border pb-3 text-sm"><p className="break-words font-medium">{h.from} ← {h.to}</p><p>{employee(h.senderId)} ← {employee(h.receiverId)} · {conditionLabel[h.condition]}</p><p className="text-muted-foreground">{date(h.at)} · {h.cancelledAt?`تسليم ملغى ${date(h.cancelledAt)}`:h.receivedAt?`استلام مؤكد ${date(h.receivedAt)}`:"بانتظار إقرار المستلم"}</p><ul className="mt-1 space-y-1">{h.lines.map(l=><li key={l.key}>{record.lines.find(o=>o.key===l.key)?.name} · {number(l.quantity)}</li>)}</ul>{h.note?<p className="break-words">{h.note}</p>:null}{h.cancellationReason?<p className="break-words">سبب الإلغاء: {h.cancellationReason}</p>:null}</li>)}</ol>:<p className="text-sm text-muted-foreground">يبدأ السجل عند تأكيد المسح والتسليم والاستلام.</p>}
        {record.status==="confirmed"&&pendingHandover?.receiverId===view.actorId?<Button type="button" disabled={disabled} onClick={()=>onAction({type:"receive",manifestId:record.id,handoverId:pendingHandover.id})}>إقراري باستلام العهدة الحالية</Button>:null}
        {record.status==="confirmed"&&pendingHandover&&(pendingHandover.senderId===view.actorId||view.canManage)?<div className="space-y-2"><Label htmlFor="custody-cancel-reason">سبب إلغاء التسليم المعلق</Label><Input id="custody-cancel-reason" maxLength={1000} value={cancelReason} disabled={disabled} onChange={e=>setCancelReason(e.target.value)}/><Button variant="outline" disabled={disabled||cancelReason.trim().length<5} onClick={()=>onAction({type:"cancel_handover",manifestId:record.id,handoverId:pendingHandover.id,reason:cancelReason.trim()})}>إلغاء التسليم المعلق</Button></div>:null}
        {record.status==="confirmed"&&!pendingHandover&&currentHolder===view.actorId&&(view.returns?.outstanding??0)>0?<form className="space-y-3" onSubmit={e=>{e.preventDefault();onAction({type:"handover",manifestId:record.id,...handover,receiverId:Number(handover.receiverId)})}}>
          <h5 className="text-sm font-medium">تسليم المعدات المتبقية إلى الموظف التالي</h5>
          <div className="grid gap-3 sm:grid-cols-2">{employeeField("المستلم التالي",handover.receiverId,value=>setHandover({...handover,receiverId:value}))}<div className="space-y-2"><Label htmlFor="custody-condition">الحالة عند التسليم</Label><select id="custody-condition" className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" disabled={disabled} value={handover.condition} onChange={e=>setHandover({...handover,condition:e.target.value as typeof handover.condition})}>{Object.entries(conditionLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div className="space-y-2"><Label htmlFor="custody-from">من موقع</Label><Input id="custody-from" value={handover.from} maxLength={200} disabled={disabled} onChange={e=>setHandover({...handover,from:e.target.value})}/></div><div className="space-y-2"><Label htmlFor="custody-to">إلى موقع</Label><Input id="custody-to" value={handover.to} maxLength={200} disabled={disabled} onChange={e=>setHandover({...handover,to:e.target.value})}/></div></div>
          <Label htmlFor="custody-note">ملاحظة التسليم {handover.condition!=="good"?"*":"(اختياري)"}</Label><Textarea id="custody-note" value={handover.note} disabled={disabled} maxLength={1000} onChange={e=>setHandover({...handover,note:e.target.value})}/>
          <Button type="submit" variant="outline" disabled={disabled||!handover.receiverId||Number(handover.receiverId)===view.actorId||!handover.from.trim()||!handover.to.trim()||(handover.condition!=="good"&&!handover.note.trim())}>تسجيل التسليم وطلب إقرار المستلم</Button>
          <p className="text-sm text-muted-foreground">بلاغ الحالة هنا لا يغيّر المخزون أو الحسابات. سجّل التلف والفقدان والإرجاع من المسار الأصلي للحجز.</p>
        </form>:null}
      </div>
      {record.revisions.length?<details className="text-sm"><summary className="cursor-pointer py-2 font-medium">مراجعات القائمة المحفوظة ({record.revisions.length})</summary><ul className="space-y-2">{record.revisions.map(r=><li key={r.snapshot.id}>{date(r.at)} · {r.reason}</li>)}</ul></details>:null}
    </>:null}
  </section>;
}

/** Uses the shared scanner and HTTP client. Failed requests retain their SAME durable key. */
export function BookingLoadingPanel({endpoint,queryKey,onReturn}:{endpoint:string;queryKey:readonly unknown[];onReturn?:(line:Line,outstanding:number)=>void}) {
  const qc=useQueryClient();
  const query=useQuery<View>({queryKey:[...queryKey,"loading"],queryFn:()=>adminFetch(endpoint),refetchInterval:20_000});
  const [pending,setPending]=useState<LoadingRequest|null>(null),[failure,setFailure]=useState("");
  const [workOrderReturn,setWorkOrderReturn]=useState<{line:Line;workOrderId:number}|null>(null);
  const [returnNote,setReturnNote]=useState("");
  const submitting=useRef(false),restored=useRef("");
  const storageKey=`ajn:loading-pending:v1:${endpoint}`;
  const savePending=(command:LoadingRequest|null)=>{
    setPending(command);
    try{if(command)sessionStorage.setItem(storageKey,JSON.stringify({actorId:query.data?.actorId,command}));else sessionStorage.removeItem(storageKey)}catch{/* The server receipt remains durable when session storage is unavailable. */}
  };
  useEffect(()=>{
    if(!query.data||restored.current===`${endpoint}:${query.data.actorId}`)return;
    restored.current=`${endpoint}:${query.data.actorId}`;
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");if(saved?.actorId===query.data.actorId&&typeof saved.command?.requestId==="string"){setPending(saved.command);setFailure("توجد محاولة لم يتأكد ردها؛ أعد نفس المحاولة قبل عملية جديدة.")}}catch{/* Invalid local cache never changes server evidence. */}
  },[endpoint,query.data?.actorId,storageKey]);
  const mutation=useMutation({mutationFn:(command:LoadingRequest)=>adminFetch<View>(endpoint,{method:"POST",body:JSON.stringify(command)}),
    onSuccess:view=>{savePending(null);setFailure("");qc.setQueryData([...queryKey,"loading"],view);qc.invalidateQueries({queryKey:["admin","booking-center"]});qc.invalidateQueries({queryKey:["admin","booking-operations"]});},
    onError:cause=>{setFailure(apiErrorMessage(cause,"تعذر تأكيد حفظ العملية؛ أعد نفس المحاولة."));const status=(cause as any)?.status;if(status>=400&&status<500)savePending(null);},
    onSettled:()=>{submitting.current=false},
  });
  const send=(draft:Draft)=>{
    if(submitting.current||pending||query.isError||!query.data?.canAct)return;
    const command={...draft,requestId:crypto.randomUUID()} as LoadingRequest;
    submitting.current=true;savePending(command);mutation.mutate(command);
  };
  const originalWorkOrderReturn=useMutation({mutationFn:()=>{
    if(!workOrderReturn)throw new Error("مرجع أمر التنفيذ غير متاح");
    const path=endpoint.startsWith("/staff/")?`/staff/koshas/work-orders/${workOrderReturn.workOrderId}/return`:`/admin/koshat-tasks/${workOrderReturn.workOrderId}/return`;
    return adminFetch(path,{method:"POST",body:JSON.stringify({productId:workOrderReturn.line.productId,condition:"good",note:returnNote.trim()||null})});
  },onSuccess:()=>{setWorkOrderReturn(null);void query.refetch()},onError:cause=>{setFailure(apiErrorMessage(cause));void query.refetch()}});
  const openReturn=(line:Line,outstanding:number)=>{
    const original=/^work-order:(\d+):(\d+)$/.exec(line.origin);
    if(original){setWorkOrderReturn({line,workOrderId:Number(original[1])});setReturnNote("");}
    else onReturn?.(line,outstanding);
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">قراءة مباشرة لأدلة التحميل والعهدة الأصلية</span><Button type="button" variant="outline" disabled={query.isFetching||mutation.isPending} onClick={()=>void query.refetch()}><RefreshCw className="h-4 w-4"/>تحديث التحميل</Button></div>
    {query.isError?<div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><b>تعذر قراءة سجل التحميل</b><p>{apiErrorMessage(query.error)}</p>{query.data?<p>المعروض آخر قراءة ناجحة؛ الإجراءات متوقفة حتى ينجح التحديث.</p>:null}<Button variant="outline" onClick={()=>void query.refetch()}>إعادة المحاولة</Button></div>:null}
    {failure?<div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><p>{failure}</p>{pending?<Button type="button" variant="outline" disabled={mutation.isPending||query.isError} onClick={()=>{if(submitting.current)return;submitting.current=true;mutation.mutate(pending)}}>{mutation.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:null}إعادة نفس المحاولة دون تكرار</Button>:null}</div>:null}
    {query.isLoading?<Skeleton className="h-64 w-full rounded-xl"/>:null}
    {query.data?<LoadingPanelView key={query.data.record?.id??`${endpoint}:new`} view={query.data} busy={mutation.isPending||!!pending||query.isError} onAction={send} onReturn={openReturn}/>:null}
    <Dialog open={!!workOrderReturn} onOpenChange={open=>{if(!open&&!originalWorkOrderReturn.isPending)setWorkOrderReturn(null)}}><DialogContent dir="rtl"><DialogHeader><DialogTitle>إرجاع {workOrderReturn?.line.name}</DialogTitle><DialogDescription>يُعاد الأصل من نفس أمر التنفيذ ومرجع الصرف الأصلي، باستخدام مسار الإرجاع الحالي.</DialogDescription></DialogHeader><LegacyWorkOrderReturnForm note={returnNote} onNote={setReturnNote} busy={originalWorkOrderReturn.isPending} onConfirm={()=>originalWorkOrderReturn.mutate()}/></DialogContent></Dialog>
  </div>;
}
