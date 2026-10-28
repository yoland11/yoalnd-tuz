import {useId,useRef,useState} from "react";
import {Loader2,RefreshCw} from "lucide-react";
import {z} from "zod/v4";
import {Alert,AlertDescription,AlertTitle} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {Field,FieldDescription,FieldGroup,FieldLabel} from "@/components/ui/field";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
import {Textarea} from "@/components/ui/textarea";
import {parseMoney} from "@/lib/vehicle-partnership/money";
import {formatReportMoney} from "@/lib/vehicle-partnership/reports";
import type {DriverCoverageSyncResult} from "@/server/vehicle-partnership/driver-coverage";
import {adminFetch,apiErrorMessage} from "./_lib";

type Closing={closingId:number;month:string;status:string;version:number;sourceDigest:string|null};
type Props={base:string;closing:Closing|null;canApprove:boolean;refresh:()=>Promise<unknown>};
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const positiveId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const closingSchema=z.object({closingId:positiveId,month:z.string().regex(/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/),status:z.enum(["approved","distributed"]),version:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),sourceDigest:digest});
const keySchema=z.string().trim().min(8).max(180);
const commandSchema=z.object({closingId:positiveId,expectedVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),expectedDigest:digest,idempotencyKey:keySchema,reason:z.string().trim().min(3).max(2000),includeReversalSummary:z.literal(true).optional()}).strict();
export type DriverCoverageCommand=Readonly<z.infer<typeof commandSchema>>;
export type DriverCoverageAttempt=Readonly<{base:string;closing:Readonly<z.infer<typeof closingSchema>>;idempotencyKey:string}>;
const exactAmount=z.string().regex(/^(?:0|[1-9]\d{0,13})\.\d{2}$/);
const resultSchema:z.ZodType<DriverCoverageSyncResult>=z.object({
  closingId:positiveId,revision:positiveId,sourceDigest:digest,matchedPayments:z.number().int().nonnegative().max(200),reversedPayments:z.number().int().nonnegative().max(200).optional(),
  amount:exactAmount,coveredAmount:exactAmount,uncoveredAmount:exactAmount,
  results:z.array(z.object({financialTransactionId:positiveId,transactionNo:z.string().trim().min(1),amount:exactAmount,coveredAmount:exactAmount,uncoveredAmount:exactAmount,alreadyLinked:z.boolean()}).strict()).max(200),
}).strict();

export function canSyncDriverCoverage(closing:Closing|null,canApprove:boolean):boolean{
  return canApprove&&closingSchema.safeParse(closing).success;
}

/** The selected month, vehicle and nonce belong to this attempt, not live props. */
export function createDriverCoverageAttempt(base:string,closing:Closing|null,canApprove:boolean,idempotencyKey:string):DriverCoverageAttempt{
  if(!canApprove)throw new Error("ربط الدفعات متاح للإدارة فقط");
  const target=closingSchema.safeParse(closing);
  if(!target.success)throw new Error("اختر شهراً معتمداً بنسخة وبصمة صالحتين قبل ربط الدفعات");
  if(!/^\/admin\/enterprise\/vehicles\/[1-9]\d*\/partnership$/.test(base))throw new Error("مرجع مركبة الربط غير صالح");
  const key=keySchema.safeParse(idempotencyKey);
  if(!key.success)throw new Error("مرجع محاولة الربط غير صالح");
  return Object.freeze({base,closing:Object.freeze(target.data),idempotencyKey:key.data});
}

export function buildDriverCoverageCommand(attempt:DriverCoverageAttempt,reason:string,canApprove:boolean):DriverCoverageCommand{
  if(!canApprove)throw new Error("ربط الدفعات متاح للإدارة فقط");
  if(!closingSchema.safeParse(attempt.closing).success)throw new Error("بيانات الشهر المثبت غير صالحة؛ ابدأ محاولة جديدة");
  const parsed=commandSchema.safeParse({closingId:attempt.closing.closingId,expectedVersion:attempt.closing.version,expectedDigest:attempt.closing.sourceDigest,idempotencyKey:attempt.idempotencyKey,reason,includeReversalSummary:true});
  if(!parsed.success)throw new Error("اكتب سبب الربط من 3 إلى 2000 حرف وتحقق من مرجع المحاولة");
  return Object.freeze(parsed.data);
}

function checkedResult(value:unknown,command?:DriverCoverageCommand):DriverCoverageSyncResult{
  const parsed=resultSchema.safeParse(value);
  if(!parsed.success)throw new Error("نتيجة ربط دفعات السائقين غير مكتملة؛ أعد المحاولة بالمرجع نفسه");
  const result=parsed.data;
  if(command&&(result.closingId!==command.closingId||result.sourceDigest!==command.expectedDigest))throw new Error("نتيجة الربط لا تطابق الشهر والبصمة المثبتين");
  if(result.matchedPayments!==result.results.length||result.matchedPayments+(result.reversedPayments??0)>200||new Set(result.results.map(row=>row.financialTransactionId)).size!==result.results.length)throw new Error("نتيجة الربط لا تطابق سندات الصرف الأصلية");
  for(const row of result.results)if(parseMoney(row.coveredAmount)+parseMoney(row.uncoveredAmount)!==parseMoney(row.amount))throw new Error("مبالغ سند ربط السائق غير متوازنة");
  for(const field of ["amount","coveredAmount","uncoveredAmount"] as const)if(result.results.reduce((sum,row)=>sum+parseMoney(row[field]),0n)!==parseMoney(result[field]))throw new Error("إجمالي الربط لا يطابق مبالغ سنداته الأصلية");
  return result;
}

/** Save errors propagate as AJN errors; a later refresh cannot undo success. */
export async function submitDriverCoverageAttempt(attempt:DriverCoverageAttempt,command:DriverCoverageCommand,{onSaved,refresh,onRefreshError}:{onSaved:(result:DriverCoverageSyncResult)=>void;refresh:()=>Promise<unknown>;onRefreshError:(error:unknown)=>void}):Promise<DriverCoverageSyncResult>{
  if(command.closingId!==attempt.closing.closingId||command.expectedVersion!==attempt.closing.version||command.expectedDigest!==attempt.closing.sourceDigest||command.idempotencyKey!==attempt.idempotencyKey)throw new Error("بيانات المحاولة لا تطابق الشهر المثبت");
  const result=checkedResult(await adminFetch<DriverCoverageSyncResult>(`${attempt.base}/closings/driver-coverage`,{method:"POST",body:JSON.stringify(command)}),command);
  onSaved(result);
  try{await refresh();}catch(error){onRefreshError(error);}
  return result;
}

function Money({value}:{value:string}){
  return <bdi dir="ltr" className="whitespace-nowrap tabular-nums">{formatReportMoney(value)}</bdi>;
}

export function DriverCoverageResultTable({result}:{result:DriverCoverageSyncResult}){
  const verified=checkedResult(result);
  return <div dir="rtl" className="flex min-w-0 flex-col gap-3">
    <p className="max-w-prose text-sm leading-6">المبالغ تخص سندات الصرف الأصلية. «مدفوع خارج التحويل» مبلغ مدفوع بالفعل؛ لا يتحول إلى استحقاق جديد.</p>
    {(verified.reversedPayments??0)>0&&<p className="rounded-lg bg-muted/40 p-3 text-sm leading-6">تم التحقق من {verified.reversedPayments} دفعات معكوسة بالكامل واستبعادها من التغطية الجديدة. سنداتها وسجل عكسها محفوظة.</p>}
    {verified.matchedPayments===0?<p className="rounded-lg bg-muted/40 p-3 text-sm">لا توجد دفعات سائقين منفذة مطابقة لأجور هذا الشهر المعتمد. لم تُنشأ دفعة أو تكلفة جديدة.</p>:<div className="min-w-0 rounded-xl border border-border/50">
      <Table className="min-w-[760px] text-right">
        <caption className="sr-only">نتيجة ربط دفعات السائقين بسنداتها الأصلية</caption>
        <TableHeader><TableRow className="bg-muted/40">{["سند الصرف الأصلي","المبلغ المنفذ فعلياً","مغطى من التحويل","مدفوع خارج التحويل","حالة الربط"].map(label=><TableHead key={label} scope="col" className="p-3 text-right">{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{verified.results.map(row=><TableRow key={row.financialTransactionId}>
          <TableCell className="max-w-64 break-words p-3"><bdi dir="ltr" className="font-medium">{row.transactionNo}</bdi></TableCell>
          <TableCell className="p-3"><Money value={row.amount}/></TableCell>
          <TableCell className="p-3"><Money value={row.coveredAmount}/></TableCell>
          <TableCell className="p-3"><Money value={row.uncoveredAmount}/></TableCell>
          <TableCell className="p-3">{row.alreadyLinked?"مرتبط سابقاً":row.coveredAmount==="0.00"?"مدفوع خارج التحويل بالكامل":"تم ربط التغطية"}</TableCell>
        </TableRow>)}</TableBody>
        <tfoot className="border-t border-border bg-muted/40 font-semibold"><TableRow><TableHead scope="row" className="p-3 text-right">الإجمالي</TableHead>{(["amount","coveredAmount","uncoveredAmount"] as const).map(field=><TableCell key={field} className="p-3"><Money value={verified[field]}/></TableCell>)}<TableCell className="p-3">{verified.matchedPayments} سند</TableCell></TableRow></tfoot>
      </Table>
    </div>}
  </div>;
}

export default function VehicleDriverCoverage({base,closing,canApprove,refresh}:Props){
  const reasonId=useId();
  const [attempt,setAttempt]=useState<DriverCoverageAttempt|null>(null),[open,setOpen]=useState(false),[reason,setReason]=useState("");
  const [command,setCommand]=useState<DriverCoverageCommand|null>(null),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(null);
  const [saved,setSaved]=useState<{month:string;result:DriverCoverageSyncResult}|null>(null),[refreshError,setRefreshError]=useState<unknown>(null);
  const commandRef=useRef<DriverCoverageCommand|null>(null),busyRef=useRef(false);
  const available=canSyncDriverCoverage(closing,canApprove);

  function beginNewAttempt(){
    if(busyRef.current)return;
    try{
      const next=createDriverCoverageAttempt(base,closing,canApprove,`vp-driver-sync-${crypto.randomUUID()}`);
      commandRef.current=null;setCommand(null);setAttempt(next);setReason("");setError(null);setOpen(true);
    }catch(failure){setError(failure);}
  }

  function closeConfirmation(){
    if(busyRef.current)return;
    setOpen(false);
    // Closing an unsent confirmation cancels it. Once sent, keep its body for replay.
    if(!commandRef.current){setAttempt(null);setReason("");setError(null);}
  }

  async function submit(){
    if(busyRef.current||!attempt)return;
    if(!canApprove){setError(new Error("ربط الدفعات متاح للإدارة فقط"));return;}
    let body:DriverCoverageCommand;
    try{body=commandRef.current??buildDriverCoverageCommand(attempt,reason,canApprove);}catch(failure){setError(failure);return;}
    // Freeze before the first request. Every retry uses this same exact body.
    commandRef.current=body;setCommand(body);busyRef.current=true;setPending(true);setError(null);
    try{
      await submitDriverCoverageAttempt(attempt,body,{
        onSaved:result=>{setSaved({month:attempt.closing.month,result});setRefreshError(null);setOpen(false);setAttempt(null);setReason("");commandRef.current=null;setCommand(null);},
        refresh,onRefreshError:failure=>setRefreshError(failure),
      });
    }catch(failure){setError(failure);}finally{busyRef.current=false;setPending(false);}
  }

  async function retryRefresh(){
    if(busyRef.current)return;
    busyRef.current=true;setPending(true);
    try{await refresh();setRefreshError(null);}catch(failure){setRefreshError(failure);}finally{busyRef.current=false;setPending(false);}
  }

  if(!canApprove)return null;
  return <div dir="rtl" className="mt-5 flex min-w-0 flex-col gap-4 border-t border-border/50 pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1"><h4 className="font-semibold">ربط دفعات السائقين المنفذة</h4><p className="max-w-prose text-sm leading-6 text-muted-foreground">تصنيف الدفعات المنفذة على سنداتها الأصلية ضمن تحويلات الشهر المعتمد، بما فيها الدفعات السابقة للإغلاق. لا ينشئ الربط صرفاً نقدياً أو دفعة أو تكلفة جديدة.</p></div>
      <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!available||pending} onClick={()=>attempt?setOpen(true):beginNewAttempt()}>ربط دفعات السائقين بالشهر</Button>
    </div>
    {!available&&<p className="text-sm leading-6 text-muted-foreground">اختر شهراً معتمداً بنسخة وبصمة صالحتين لتفعيل الربط.</p>}
    {attempt&&!open&&<Alert><AlertTitle>محاولة ربط محفوظة</AlertTitle><AlertDescription><p>المحاولة تخص شهر <bdi dir="ltr">{attempt.closing.month}</bdi>، النسخة {attempt.closing.version}. استئنافها يحافظ على مرجعها وبياناتها.</p><Button type="button" variant="outline" className="mt-3 min-h-11" disabled={pending} onClick={()=>setOpen(true)}>استئناف المحاولة السابقة</Button></AlertDescription></Alert>}
    {Boolean(error)&&!open&&<Alert variant="destructive"><AlertTitle>تعذر ربط الدفعات</AlertTitle><AlertDescription className="break-words">{apiErrorMessage(error)}</AlertDescription></Alert>}
    {saved&&<section aria-label="نتيجة ربط دفعات السائقين" className="flex min-w-0 flex-col gap-3">
      <p role="status" className="text-sm font-semibold">حُفظت نتيجة ربط دفعات شهر <bdi dir="ltr">{saved.month}</bdi> — مراجعة الإغلاق {saved.result.revision}</p>
      <DriverCoverageResultTable result={saved.result}/>
      {Boolean(refreshError)&&<Alert><AlertTitle>حُفظ الربط وتعذر تحديث العرض</AlertTitle><AlertDescription><p className="break-words">{apiErrorMessage(refreshError)}</p><Button type="button" variant="outline" className="mt-3 min-h-11 gap-2" disabled={pending} onClick={()=>void retryRefresh()}><RefreshCw aria-hidden="true"/>تحديث العرض</Button></AlertDescription></Alert>}
    </section>}
    <Dialog open={open&&attempt!==null} onOpenChange={next=>{if(!next)closeConfirmation();}}>
      <DialogContent dir="rtl" className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>ربط دفعات السائقين بالشهر</DialogTitle><DialogDescription>راجع الشهر المثبت وسبب الربط قبل التأكيد.</DialogDescription></DialogHeader>
        {attempt&&<form className="flex min-w-0 flex-col gap-4" onSubmit={event=>{event.preventDefault();void submit();}}>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted/40 p-3 text-sm"><div><dt className="text-muted-foreground">الشهر المثبت</dt><dd className="mt-1 font-semibold"><bdi dir="ltr">{attempt.closing.month}</bdi></dd></div><div><dt className="text-muted-foreground">نسخة الإغلاق</dt><dd className="mt-1 font-semibold">{attempt.closing.version}</dd></div></dl>
          <p className="max-w-prose text-sm leading-7">سيُضاف الربط إلى سندات الصرف المنفذة نفسها، ويشمل دفعات أجور هذا الشهر التي صُرفت قبل الإغلاق. لن يُنشأ صرف من الصندوق أو سند مالي أو دفعة أو تكلفة جديدة. المبلغ غير المغطى يبقى «مدفوع خارج التحويل» ولا يصبح مستحقاً للصرف مرة أخرى.</p>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">الشهر ونسخته مثبتان لهذه المحاولة حتى لو تغير الاختيار في الصفحة. بعد الإرسال، تعيد المحاولة البيانات ومرجع الربط نفسيهما.</p>
          <FieldGroup><Field data-disabled={pending||command!==null}><FieldLabel htmlFor={reasonId}>سبب الربط *</FieldLabel><Textarea id={reasonId} required minLength={3} maxLength={2000} value={reason} disabled={pending||command!==null} onChange={event=>setReason(event.target.value)} aria-describedby={`${reasonId}-help`}/><FieldDescription id={`${reasonId}-help`}>{command?"السبب مثبت مع المحاولة السابقة. لتغييره اختر بدء محاولة جديدة أدناه.":"اكتب سبب مراجعة وربط هذه الدفعات من 3 إلى 2000 حرف."}</FieldDescription></Field></FieldGroup>
          {Boolean(error)&&<Alert variant="destructive"><AlertTitle>تعذر إكمال الربط</AlertTitle><AlertDescription className="flex flex-col gap-2"><p className="break-words">{apiErrorMessage(error)}</p>{command&&<p>قد يكون الطلب السابق وصل إلى الخادم. أعد المحاولة بالبيانات نفسها لاسترجاع نتيجته بأمان.</p>}</AlertDescription></Alert>}
          <DialogFooter><Button type="submit" className="min-h-11 gap-2" disabled={pending||(!command&&(reason.trim().length<3||reason.trim().length>2000))}>{pending&&<Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none"/>}{pending?"جارٍ ربط الدفعات…":command?"إعادة المحاولة بالمرجع نفسه":"تأكيد ربط الدفعات"}</Button><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={closeConfirmation}>{command?"إغلاق":"إلغاء"}</Button></DialogFooter>
          {command&&Boolean(error)&&<div className="flex flex-col gap-2 border-t border-border/50 pt-3"><p className="text-sm leading-6 text-muted-foreground">لربط الشهر المعروض حالياً أو تغيير السبب، ابدأ محاولة جديدة بمرجع مستقل. يتحقق النظام من أي ربط محفوظ على السندات الأصلية قبل الإضافة.</p><Button type="button" variant="outline" className="min-h-11" disabled={pending||!available} onClick={beginNewAttempt}>بدء محاولة جديدة للشهر المعروض</Button></div>}
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
