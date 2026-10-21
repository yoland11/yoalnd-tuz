import {useEffect,useRef,useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {Field,FieldGroup,FieldLabel} from './ui/field';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './ui/dialog';
import {Alert,AlertDescription,AlertTitle} from './ui/alert';
import {adminFetch,apiErrorMessage} from '@/views/admin/_lib';
export type PreparationGroupDraft={department:string;command:'start'|'confirm';keys:string[];label:string};
type Command=Omit<PreparationGroupDraft,'label'>&{action:'group';confirmation:true;requestId:string};
type Props={endpoint:string;actorId?:number;canManage:boolean;draft:PreparationGroupDraft|null;onClose:()=>void;onDone:()=>void;onBusyChange:(busy:boolean)=>void;labelForDepartment:(key:string)=>string};
export function PreparationGroupAction(props:Props){
  // Navigation/login changes must never carry a pending command into a new scope.
  return <ScopedPreparationGroupAction key={JSON.stringify([props.actorId??null,props.endpoint])} {...props}/>;
}
function ScopedPreparationGroupAction({endpoint,actorId,canManage,draft,onClose,onDone,onBusyChange,labelForDepartment}:Props){
  const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<Command|null>(null),[failure,setFailure]=useState(''),[result,setResult]=useState('');
  const sending=useRef(false),restored=useRef(''),active=useRef(true);const key=actorId?`ajn:preparation-group:v1:${actorId}:${endpoint}`:null;
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  function store(value:Command|null){if(active.current)setPending(value);try{if(key){if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key)}}catch{/* Server transaction receipt remains durable. */}}
  useEffect(()=>{if(draft){setOpen(true);setConfirmed(false);setFailure('')}},[draft]);
  useEffect(()=>{if(!key||restored.current===key)return;restored.current=key;try{const value=JSON.parse(sessionStorage.getItem(key)||'null');if(value?.action==='group'&&value.requestId&&Array.isArray(value.keys)){setPending(value);setOpen(true);setFailure('توجد محاولة مجموعة غير مؤكدة؛ أعد نفس المحاولة دون تكرار.')}}catch{/* Invalid local cache grants no server permission. */}},[key]);
  const mutation=useMutation({mutationFn:async(command:Command)=>{const value=await adminFetch<{ok:boolean;updated:number;replayed?:boolean}>(endpoint,{method:'POST',body:JSON.stringify(command)});if(value?.ok!==true||!Number.isInteger(value.updated))throw Error('لم يتأكد حفظ مجموعة التجهيز؛ أعد نفس المحاولة');return value},onSuccess:value=>{store(null);if(!active.current)return;setFailure('');setResult(value.replayed?'تأكيد المجموعة محفوظ سابقاً دون تكرار':'تم حفظ إجراء مجموعة التجهيز');setOpen(false);onClose();onDone()},onError:cause=>{if(active.current)setFailure(apiErrorMessage(cause));const status=(cause as any)?.status;if(status>=400&&status<500)store(null)},onSettled:()=>{sending.current=false}});
  const busy=mutation.isPending||!!pending;
  useEffect(()=>{onBusyChange(busy)},[busy,onBusyChange]);
  function send(){if(sending.current||!canManage||!actorId||!confirmed||!draft||pending||!draft.keys.length)return;const command:Command={action:'group',confirmation:true,requestId:crypto.randomUUID(),department:draft.department,command:draft.command,keys:draft.keys};sending.current=true;store(command);mutation.mutate(command)}
  const selected=pending??draft;
  return <>{result?<Alert role="status"><AlertTitle>{result}</AlertTitle></Alert>:null}{pending&&!open?<Button variant="outline" onClick={()=>setOpen(true)}>متابعة إجراء المجموعة غير المؤكد</Button>:null}
    <Dialog open={open} onOpenChange={value=>{if(!mutation.isPending){setOpen(value);if(!value)onClose()}}}><DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{selected?.command==='start'?'بدء تجهيز المجموعة':'تأكيد تجهيز المجموعة'}</DialogTitle><DialogDescription>هذا الإجراء يحدّث قائمة التجهيز فقط، ولا يصرف مخزوناً أو يغيّر الفاتورة. الأصول تُجهّز من مسارها الأصلي، والمهام المسندة تحتاج اعتمادها أولاً.</DialogDescription></DialogHeader>
      <p>{draft?.label??labelForDepartment(selected?.department??'')} · {selected?.keys.length??0} عنصر</p>
      <FieldGroup><Field orientation="horizontal" data-disabled={busy}><Checkbox id="preparation-group-confirm" checked={confirmed} disabled={busy} onCheckedChange={v=>setConfirmed(v===true)}/><FieldLabel htmlFor="preparation-group-confirm">أؤكد إجراء التجهيز لهذه المجموعة فقط</FieldLabel></Field></FieldGroup>
      {failure?<Alert variant="destructive"><AlertTitle>لم يتأكد حفظ المجموعة</AlertTitle><AlertDescription>{failure}</AlertDescription></Alert>:null}
      {pending?<Button disabled={!canManage||mutation.isPending} onClick={()=>{if(sending.current)return;sending.current=true;mutation.mutate(pending)}}>إعادة إجراء المجموعة نفسه دون تكرار</Button>:<Button disabled={!canManage||mutation.isPending||!confirmed||!draft?.keys.length} onClick={send}>{selected?.command==='start'?'تأكيد بدء المجموعة':'تأكيد تجهيز المجموعة'}</Button>}
    </DialogContent></Dialog>
  </>;
}
