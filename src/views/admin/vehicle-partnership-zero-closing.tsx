import {useId,useRef,useState} from 'react';
import {z} from 'zod/v4';
import {Loader2,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {adminFetch,apiErrorMessage} from './_lib';

export type ZeroClosingHeader={closingId:number;month:string;status:string;version:number;revision:number;sourceDigest:string|null;financialTransactionId:number|null};
const number=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),positive=number.positive(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const headerSchema=z.object({closingId:positive,month:z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),status:z.enum(['pending','approved']),version:number,revision:positive,sourceDigest:digest,financialTransactionId:z.null()});
function recoveryAction(header:ZeroClosingHeader,canApprove:boolean){const parsed=headerSchema.safeParse(header);if(!parsed.success)return null;return parsed.data.status==='pending'?'cancel_zero':canApprove?'reopen_zero':null;}
const actionLabel=(action:'cancel_zero'|'reopen_zero')=>action==='cancel_zero'?'إلغاء الإغلاق المعلق':'إعادة فتح الإغلاق';
export function makeZeroClosingAttempt(base:string,header:ZeroClosingHeader,canApprove:boolean,reason:string,key:string){
 const action=recoveryAction(header,canApprove);
 if(!/^\/admin\/enterprise\/vehicles\/[1-9]\d*\/partnership$/.test(base)||!action)throw new Error('الإغلاق الأصلي غير مؤهل لهذا الإجراء');
 const command=z.object({closingId:positive,action:z.enum(['cancel_zero','reopen_zero']),expectedVersion:number,expectedDigest:digest,reason:z.string().trim().min(3).max(2000),idempotencyKey:z.string().trim().min(8).max(180)}).strict().parse({closingId:header.closingId,action,expectedVersion:header.version,expectedDigest:header.sourceDigest,reason,idempotencyKey:key});
 // Month/revision identify the original header in the UI and response proof.
 // The original strict transition endpoint accepts only the command fields.
 return Object.freeze({route:base+'/closings/transition',month:header.month,revision:header.revision,command:Object.freeze(command)});
}
type Attempt=ReturnType<typeof makeZeroClosingAttempt>;
export async function submitZeroClosingAttempt(attempt:Attempt,callbacks:{onSaved:()=>void;refresh:()=>Promise<unknown>;onRefreshError:(error:unknown)=>void}){
 const raw=await adminFetch(attempt.route,{method:'POST',body:JSON.stringify(attempt.command)});
 const result=headerSchema.extend({status:z.literal('draft')}).strict().parse(raw);
 if(result.closingId!==attempt.command.closingId||result.month!==attempt.month||result.version!==attempt.command.expectedVersion+1||result.revision!==attempt.revision+1||result.sourceDigest!==attempt.command.expectedDigest)throw new Error('نتيجة الإغلاق لا تطابق النسخة والشهر الأصليين؛ أعد المحاولة بنفس المرجع');
 callbacks.onSaved();try{await callbacks.refresh();}catch(error){callbacks.onRefreshError(error);}return result;
}

/** Kept mounted outside the changing monthly preview and workspace query states.
 * Only an explicit new review discards the original request after submission. */
export default function VehiclePartnershipZeroClosing({base,closings,canApprove,visible,refresh}:{base:string;closings:ZeroClosingHeader[];canApprove:boolean;visible:boolean;refresh:()=>Promise<unknown>}){
 const id=useId(),[selected,setSelected]=useState<ZeroClosingHeader|null>(null),[open,setOpen]=useState(false),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(null),[saved,setSaved]=useState(false),[refreshError,setRefreshError]=useState<unknown>(null),[frozen,setFrozen]=useState<Attempt|null>(null),attempt=useRef<Attempt|null>(null),busy=useRef(false);
 const eligible=closings.filter(header=>recoveryAction(header,canApprove));
 const current=frozen??(selected?{month:selected.month,revision:selected.revision,command:{action:recoveryAction(selected,canApprove)}}:null);
 function reset(){attempt.current=null;setFrozen(null);setSelected(null);setOpen(false);setReason('');setConfirmed(false);setError(null);setSaved(false);setRefreshError(null);}
 async function submit(){
  if(busy.current||saved||!confirmed)return;
  let command=attempt.current;
  try{if(!command){if(!selected)throw new Error('اختر الإغلاق الأصلي');command=makeZeroClosingAttempt(base,selected,canApprove,reason,`vp-zero-${crypto.randomUUID()}`);}}
  catch(failure){setError(failure);return;}
  attempt.current=command;setFrozen(command);busy.current=true;setPending(true);setError(null);
  try{await submitZeroClosingAttempt(command,{onSaved:()=>{setSaved(true);setRefreshError(null);setOpen(false);},refresh,onRefreshError:setRefreshError});}
  catch(failure){setError(failure);}finally{busy.current=false;setPending(false);}
 }
 if(!visible&&!frozen&&!saved)return null;
 if(!eligible.length&&!selected&&!frozen&&!saved)return null;
 return <section dir="rtl" className="space-y-3 rounded-2xl border border-border/50 bg-card p-4 sm:p-5"><h3 className="font-bold">استعادة الإغلاقات الخالية من القيود</h3><p className="max-w-prose text-sm leading-6 text-muted-foreground">الإجراء يعيد الفترة إلى المسودة وفق النسخة المحفوظة. يتحقق النظام من خلو القيود وعدم استخدام حقوق الفترة قبل الحفظ.</p>
 {saved?<div role="status" className="space-y-3 rounded-xl border border-border p-3"><p className="font-semibold">حُفظت العملية — {frozen&&actionLabel(frozen.command.action)} لشهر <bdi>{frozen?.month}</bdi></p>{refreshError!=null&&<div role="alert" className="text-sm text-destructive"><p>حُفظت العملية وتعذر تحديث العرض</p><p className="break-words">{apiErrorMessage(refreshError)}</p></div>}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending} onClick={async()=>{if(busy.current)return;busy.current=true;setPending(true);try{await refresh();setRefreshError(null);}catch(failure){setRefreshError(failure);}finally{busy.current=false;setPending(false);}}}><RefreshCw className="me-2 h-4 w-4"/>تحديث العرض</Button><Button type="button" variant="ghost" disabled={pending} onClick={reset}>مراجعة أخرى</Button></div></div>:<>
 {frozen&&<div role="status" className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm"><p>المحاولة الأصلية: {actionLabel(frozen.command.action)} — شهر <bdi>{frozen.month}</bdi>، النسخة {frozen.command.expectedVersion}، المراجعة {frozen.revision}</p><p>عند انقطاع الرد، أعد المحاولة بنفس المرجع للتأكد من النتيجة.</p>{error!=null&&<p role="alert" className="break-words text-destructive">{apiErrorMessage(error)}</p>}<Button type="button" variant="outline" disabled={pending} onClick={()=>setOpen(true)}>{pending?'جاري التحقق…':'متابعة المحاولة الأصلية'}</Button></div>}
 {visible&&eligible.length>0&&<ul className="space-y-2">{eligible.map(header=>{const action=recoveryAction(header,canApprove)!;return <li key={header.closingId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 p-3"><p className="text-sm">شهر <bdi>{header.month}</bdi> · {header.status==='pending'?'بانتظار الموافقة':'معتمد'} · المراجعة {header.revision}</p><Button type="button" variant="outline" disabled={pending||frozen!==null||selected!==null} onClick={()=>{setSelected({...header});setReason('');setConfirmed(false);setError(null);setOpen(true);}}>{actionLabel(action)}</Button></li>;})}</ul>}
 </>}
 <Dialog open={open} onOpenChange={value=>{if(pending)return;setOpen(value);if(!value&&!attempt.current){setSelected(null);setReason('');setConfirmed(false);setError(null);}}}><DialogContent><DialogHeader><DialogTitle>{current?.command.action?actionLabel(current.command.action):'مراجعة الإغلاق'}</DialogTitle><DialogDescription>شهر {current?.month} · المراجعة {current?.revision}. يعاد الإغلاق إلى المسودة بعد التحقق من سجله الأصلي.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event=>{event.preventDefault();void submit();}}><label htmlFor={`${id}-reason`} className="block space-y-2 text-sm"><span>سبب الإلغاء أو إعادة الفتح *</span><Textarea id={`${id}-reason`} required minLength={3} maxLength={2000} disabled={pending||frozen!==null} value={frozen?.command.reason??reason} onChange={event=>setReason(event.target.value)}/></label><label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" required disabled={pending||frozen!==null} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1"/><span>أؤكد إعادة هذه النسخة الأصلية إلى المسودة للشهر المحدد أعلاه.</span></label>{error!=null&&<p role="alert" className="break-words text-sm text-destructive">{apiErrorMessage(error)}</p>}<DialogFooter><Button type="submit" disabled={pending||!confirmed||(!frozen&&(reason.trim().length<3||reason.trim().length>2000))}>{pending?<><Loader2 className="me-2 h-4 w-4 animate-spin"/>جاري الحفظ…</>:frozen?'إعادة المحاولة بنفس المرجع':'تأكيد إعادة الفترة للمسودة'}</Button>{frozen&&error!=null&&<Button type="button" variant="ghost" disabled={pending} onClick={reset}>ترك المحاولة ومراجعة المصدر</Button>}</DialogFooter></form></DialogContent></Dialog>
 </section>;
}
