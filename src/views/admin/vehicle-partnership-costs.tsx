import {useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {Link} from "wouter";
import {Loader2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {useToast} from "@/hooks/use-toast";
import {formatReportMoney} from "@/lib/vehicle-partnership/reports";
import {adminFetch,apiErrorMessage} from "./_lib";

type CostMember={id:number;name:string|null};
type CostAgreement={id:number;status:string;effectiveFrom:string;members:CostMember[]};
type Expense={id:number;date:string;expenseType:string;amount:string;description:string|null;fundingStatus:string|null};
export function costFundingMembers(agreements:CostAgreement[],date:string):CostMember[]{
 const eligible=agreements.filter(a=>a.status==="approved"&&a.effectiveFrom<=date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
 if(!eligible.length)return [];
 if(eligible.length>1&&eligible[0].effectiveFrom===eligible[1].effectiveFrom)throw new Error("اتفاق نافذ مكرر بتاريخ المصروف؛ راجع سجل الاتفاقات");
 return eligible[0].members;
}
const control="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm";
const key=()=>`vp-cost-ui-${crypto.randomUUID()}`;
export default function VehiclePartnershipCosts({base,version,agreements,expenses,refresh}:{base:string;version:number;agreements:CostAgreement[];expenses:Expense[];refresh:()=>Promise<unknown>}){
 const {toast}=useToast();
 const [expenseId,setExpenseId]=useState(""),[payer,setPayer]=useState(""),[kind,setKind]=useState(""),[costClass,setCostClass]=useState(""),[reason,setReason]=useState(""),[nonce,setNonce]=useState(key);
 const available=expenses.filter(e=>e.fundingStatus!=="approved"&&e.fundingStatus!=="pending"),selected=available.find(e=>e.id===Number(expenseId));
 const members=selected?costFundingMembers(agreements,selected.date):[];
 const submit=useMutation({mutationFn:()=>{
  if(!selected||!members.some(m=>m.id===Number(payer))||!["partner_advance","partner_capital"].includes(kind)||!["operating","capital"].includes(costClass))throw new Error("اختر المصروف الأصلي والشريك النافذ وتصنيف التمويل");
  return adminFetch(base+"/costs",{method:"POST",body:JSON.stringify({expenseId:selected.id,payerMemberId:Number(payer),fundingKind:kind,costClass,expectedVersion:version,idempotencyKey:nonce,reason})});
 },onSuccess:async()=>{
  setExpenseId("");setPayer("");setKind("");setCostClass("");setReason("");setNonce(key());toast({title:"تم إرسال تمويل المصروف للموافقة",description:"لم يُخصم مبلغ من الصندوق."});
  try{await refresh();}catch(error){toast({title:"حُفظ التمويل وتعذر تحديث العرض",description:apiErrorMessage(error),variant:"destructive"});}
 },onError:error=>toast({title:"تعذر تسجيل مصروف الشريك",description:apiErrorMessage(error),variant:"destructive"})});
 return <section className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5" dir="rtl"><h3 className="font-bold">مصروف مدفوع من الشريك</h3><p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">اختر مصروف المركبة الموجود، وحدد من دفعه فعلياً. التصنيف لا يغيّر نسب الملكية، ولا يسجل مصروفاً ثانياً. إذا له طلب صرف من الشركة، ألغِ المعلّق من الموافقات الأصلية أولاً؛ المدفوع من الشركة يمنعه الخادم.</p>
 <form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();submit.mutate();}}><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-sm"><span>مصروف المركبة الأصلي *</span><select required className={control} value={expenseId} onChange={e=>{setExpenseId(e.target.value);setPayer("");setCostClass("");}}><option value="">اختر المصروف من الفترة المعروضة</option>{available.map(e=><option key={e.id} value={e.id}>{e.date} · {e.description||e.expenseType} · {formatReportMoney(e.amount)}</option>)}</select></label><label className="space-y-2 text-sm"><span>الشريك الدافع بتاريخ المصروف *</span><select required className={control} disabled={!selected} value={payer} onChange={e=>setPayer(e.target.value)}><option value="">اختر الشريك من الاتفاق النافذ</option>{members.map((m,i)=><option key={m.id} value={m.id}>{m.name||`الشريك ${i+1}`}</option>)}</select></label><label className="space-y-2 text-sm"><span>معالجة المبلغ المدفوع *</span><select required className={control} value={kind} onChange={e=>setKind(e.target.value)}><option value="">حدد الاتفاق الفعلي</option><option value="partner_advance">سلفة قابلة للاسترداد للشريك</option><option value="partner_capital">مساهمة رأسمالية إضافية</option></select></label><label className="space-y-2 text-sm"><span>طبيعة المصروف *</span><select required className={control} value={costClass} onChange={e=>setCostClass(e.target.value)}><option value="">حدد التصنيف المعتمد</option><option value="operating">مصروف تشغيل</option><option value="capital" disabled={selected?.expenseType==="driver_wage"}>استثمار / تحسين رأسمالي</option></select></label></div>
 {selected&&<p className="rounded-lg bg-muted/50 p-3 text-sm">المبلغ الأصلي: <bdi dir="ltr" className="font-semibold">{formatReportMoney(selected.amount)}</bdi> · <bdi>{selected.date}</bdi>{!members.length&&<span className="mt-2 block text-destructive">لا يوجد اتفاق معتمد نافذ لهذا المصروف. راجع تاريخ الاتفاق قبل المتابعة.</span>}</p>}
 <label className="block space-y-2 text-sm"><span>سبب التمويل وإثبات ترتيبه *</span><Textarea required minLength={3} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="text-xs leading-6 text-muted-foreground">اعتماد السلفة يثبت المستحق فقط. تسديدها من الصندوق طلب منفصل بعد اعتماد شهر المصروف وموافقة الإدارة. المساهمة الرأسمالية لا تصبح سلفة قابلة للصرف.</p><div className="flex flex-wrap gap-2"><Button type="submit" disabled={submit.isPending||!selected||!payer||!kind||!costClass} className="min-h-11 gap-2">{submit.isPending&&<Loader2 className="h-4 w-4 animate-spin"/>}إرسال التمويل للموافقة</Button><Link href="/admin/finance/master-cash" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-primary">الموافقات الأصلية</Link></div></form></section>;
}
