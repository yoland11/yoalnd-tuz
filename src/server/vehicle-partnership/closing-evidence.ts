import {createHash} from "node:crypto";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import type {ClosingSource,ClosingTerm} from "../../lib/vehicle-partnership/closing";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {ORIGINAL_VEHICLE_OPERATING_COST_TYPES} from "../../lib/vehicle-partnership/types";
import {PartnershipRepositoryError} from "./repository";

type RecordValue=Record<string,unknown>;
export type ClosingFinancialEvent={id:number;sourceType:string;sourceId:string;event:string|null;type:string;direction:string;amount:string;date:string;status:string;reversalOf:number|null};
type SourceEvidence={id:number;vehicleId:number;partnershipId:number;status:string;sourceDigest:string;snapshot:RecordValue;reason:string;financial:ClosingFinancialEvent;reversals:readonly ClosingFinancialEvent[]};
export type ActivityClosingEvidence=SourceEvidence & {agreementId:number;original:{source:string;id:number};incomeBasis:"internal"|"external";amount:string;recognitionDate:string};
export type CostClosingEvidence=SourceEvidence & {expenseId:number;fundingKind:string;costClass:string;payerMemberId:number|null;employeeEntryId:number|null};
export type CompanyClosingEvidence={expenseId:number;vehicleId:number;snapshot:RecordValue;financial:ClosingFinancialEvent|null;reversals:readonly ClosingFinancialEvent[]};
export type ClosingEvidenceInput={vehicleId:number;partnershipId:number;from:string;to:string;terms:readonly ClosingTerm[];activities:readonly ActivityClosingEvidence[];costs:readonly CostClosingEvidence[];companyCosts?:readonly CompanyClosingEvidence[]};
export type ClosingEvidenceSnapshot={key:string;snapshot:RecordValue};
function fail(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
function id(value:unknown):number{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<=0)fail("مرجع مصدر الإغلاق غير صالح");return value;}
function day(value:unknown):string{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail("تاريخ مصدر الإغلاق غير صالح");
 const parsed=new Date(`${value}T00:00:00Z`);if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail("تاريخ مصدر الإغلاق غير موجود");return value;
}
/** Accept only persisted, immutable source/financial evidence. This is NOT a
 * current trip profitability reader: edited employee balances cannot replace
 * the original wage snapshot. Every reversal keeps its real transaction date
 * and the original dated agreement. No payment, journal or SQL is performed. */
export function collectClosingEvidence(input:ClosingEvidenceInput){
 id(input.vehicleId);id(input.partnershipId);day(input.from);day(input.to);if(input.from>input.to)fail("فترة مصادر الإغلاق غير صالحة");
 if(input.activities.length+input.costs.length+(input.companyCosts?.length??0)>5000)fail("مصادر الإغلاق تتجاوز حد المراجعة الآمن");
 const terms=[...input.terms].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
 const sources:ClosingSource[]=[],snapshots:ClosingEvidenceSnapshot[]=[],historySources:ClosingSource[]=[],historySnapshots:ClosingEvidenceSnapshot[]=[],blockers:string[]=[];
 const identities=new Map<string,string>(),financialOwners=new Map<number,string>(),activeCosts=new Map<number,string>();
 const at=(date:string)=>terms.filter(t=>t.effectiveFrom<=date).at(-1);
 const within=(date:string)=>date>=input.from&&date<=input.to;
 function registerFinancial(event:ClosingFinancialEvent,owner:string){
  id(event.id);day(event.date);if(typeof event.amount!=="string")fail("مبلغ المصدر المالي يجب أن يبقى نصاً عشرياً دقيقاً");
  if(!["draft","pending","approved","executed","rejected","cancelled"].includes(event.status))fail("حالة المصدر المالي غير معروفة");
  const previous=financialOwners.get(event.id);if(previous&&previous!==owner)fail("حركة مالية مكررة بين مصدرين للإغلاق");financialOwners.set(event.id,owner);
 }
 function emit(source:SourceEvidence,owner:string,baseKind:ClosingSource["kind"],basisDate:string,agreementId:number,amount:string,shared:boolean,extra:RecordValue,businessDate?:string){
  const financial=source.financial;registerFinancial(financial,owner);
  if(parseMoney(financial.amount)!==parseMoney(amount)||financial.reversalOf!==null)fail("مبلغ المصدر المالي أو مرجع العكس لا يطابق إثبات المصدر");
  const company=owner.startsWith("expense:");
  const expectedSource=owner.startsWith("activity:")?"vehicle_partnership_activity":company?"vehicle_expense":"vehicle_partnership_cost";
  if(financial.sourceType!==expectedSource||financial.sourceId!==String(source.id))fail("هوية المصدر المالي لا تطابق مصدر الإغلاق");
  const approved=financial.status==="executed";
  if(approved?!["approved","reversed"].includes(source.status):source.status!=="pending"&&!["rejected","cancelled"].includes(source.status))fail("حالة المصدر لا تطابق الموافقة المالية");
  if(["rejected","cancelled"].includes(financial.status)){
   if(!["rejected","cancelled"].includes(source.status)||source.reversals.length)fail("حالة رفض المصدر لا تطابق حركته المالية");return;
  }
  if(!approved&&source.reversals.length)fail("لا يمكن عكس مصدر مالي غير منفذ");
  const sorted=[...source.reversals].sort((a,b)=>a.id-b.id);let reversed=0n;
  const reversalIds=new Set<number>();
  for(const reversal of sorted){
   registerFinancial(reversal,owner);if(reversalIds.has(reversal.id)||reversal.id===financial.id)fail("مرجع عكس مكرر");reversalIds.add(reversal.id);
   const validEvent=company?["reversal","vehicle_expense_reversal"].includes(String(reversal.event)):reversal.event==="reversal";
   if(reversal.reversalOf!==financial.id||reversal.sourceType!==financial.sourceType||reversal.sourceId!==financial.sourceId||!validEvent||reversal.type!==(company?"manual_reversal":`${financial.type}_reversal`)||reversal.direction!==(financial.direction==="expense"?"revenue":"expense")||reversal.date<financial.date)fail("مرجع العكس المالي لا يطابق المصدر الأصلي");
   const value=parseMoney(reversal.amount);if(value<=0n)fail("مبلغ عكس المصدر غير صالح");
   if(reversal.status==="executed")reversed+=value;
   else if(["draft","pending","approved"].includes(reversal.status))blockers.push(`مصدر ${owner} عليه عكس مالي معلق`);
  }
  if(reversed>parseMoney(amount)||source.status==="reversed"&&reversed!==parseMoney(amount)||!company&&source.status==="approved"&&reversed!==0n)fail("مبلغ العكس أو حالة المصدر لا تطابق الرصيد الأصلي");
  if(extra.expenseId!=null&&["pending","approved"].includes(source.status)){
   const expenseId=id(extra.expenseId),previous=activeCosts.get(expenseId);if(previous&&previous!==owner)fail("مصدر تمويل مكرر للمصروف الأصلي");activeCosts.set(expenseId,owner);
  }
  if(within(businessDate??financial.date)&&sorted.some(r=>r.status==="executed"&&r.date>input.to))blockers.push(`مصدر ${owner} عُكس بعد هذا الشهر؛ يلزم تصحيح الفترة أو مراجعة تسلسل الإغلاقات`);
  const append=(event:ClosingFinancialEvent,kind:ClosingSource["kind"],isReversal=false,date=event.date)=>{
   const key=`financial:${event.id}`;
   const snapshot={...extra,sourceSnapshot:source.snapshot,sourceDigest:source.sourceDigest,sourceStatus:source.status,financial:event,...(isReversal?{reversedFinancialId:financial.id,originalFinancial:financial}:{})};
   const fact:ClosingSource={key,kind,date,basisDate,agreementId,amount:formatMoney(parseMoney(event.amount)),approved:event.status==="executed",shared,evidence:hash(snapshot)};
   historySources.push(fact);historySnapshots.push({key,snapshot});
   if(historySources.length>10000)fail("تجاوزت أحداث مصادر الإغلاق حد المراجعة الآمن");
   if(within(date)){sources.push(fact);snapshots.push({key,snapshot});}
  };
  append(financial,baseKind,false,businessDate??financial.date);
  const reversalKind:ClosingSource["kind"]=baseKind==="internal"?"internal_reversal":baseKind==="external"?"external_reversal":baseKind==="capital"?"capital_recovery":"cost_recovery";
  for(const reversal of sorted)if(reversal.status==="executed")append(reversal,reversalKind,true);
 }
 function original(source:SourceEvidence,owner:string):boolean{
  id(source.id);if(source.vehicleId!==input.vehicleId||source.partnershipId!==input.partnershipId)fail("مصدر الإغلاق مرتبط بمركبة أو شراكة أخرى");
  if(typeof source.reason!=="string"||!source.reason.trim()||source.reversals.length>1000)fail("إثبات مصدر الإغلاق أو سجل عكسه غير مكتمل");
  if(!["pending","approved","reversed","rejected","cancelled"].includes(source.status))fail("حالة مصدر الإغلاق غير معروفة");
  const identity=hash(source),previous=identities.get(owner);if(previous){if(previous!==identity)fail("مصدر إغلاق مكرر ببيانات متعارضة");return false;}identities.set(owner,identity);
  if(!source.snapshot||typeof source.snapshot!=="object"||Array.isArray(source.snapshot)||!Object.keys(source.snapshot).length||!/^[a-f0-9]{64}$/.test(source.sourceDigest))fail("بصمة مصدر الإغلاق غير مكتملة");return true;
 }
 for(const activity of [...input.activities].sort((a,b)=>a.id-b.id)){
  const owner=`activity:${activity.id}`;if(!original(activity,owner))continue;const s=activity.snapshot;
  const basisDate=day(s.eventDate),amount=formatMoney(parseMoney(activity.amount)),date=day(activity.recognitionDate);
  if(!["internal","external"].includes(activity.incomeBasis)||!s.originalDigest||typeof s.originalDigest!=="string"||!/^[a-f0-9]{64}$/.test(s.originalDigest)||s.vehicleId!==input.vehicleId||s.agreementId!==activity.agreementId||!at(basisDate)||at(basisDate)!.id!==activity.agreementId||!["kosha","service","delivery"].includes(String(s.source))||typeof s.driverNoCharge!=="boolean")fail("إثبات مصدر النقل أو اتفاقه الأصلي غير صالح");
  id(s.sourceId);id(s.agreementRevision);
  if(activity.original.source!==s.source||activity.original.id!==s.sourceId)fail("مرجع مصدر النقل لا يطابق رابطه الأصلي المحفوظ");
  if(hash({snapshot:s,amount,incomeBasis:activity.incomeBasis,recognitionDate:date,reason:activity.reason})!==activity.sourceDigest)fail("بصمة مصدر النقل لا تطابق قيمه المحفوظة");
  if(date<basisDate||activity.financial.date!==date||activity.financial.type!==(activity.incomeBasis==="internal"?"vp_internal_entitlement":"vp_external_attribution")||activity.financial.event!==(activity.incomeBasis==="internal"?"internal_entitlement":"external_attribution")||activity.financial.direction!==(activity.incomeBasis==="internal"?"expense":"revenue"))fail("المصدر المالي للنقل لا يطابق نوعه وتاريخه");
  if(activity.incomeBasis==="external"&&(s.inTotal!==true||s.billingSource==null||s.billingId==null||typeof s.originalCustomerCharge!=="string"||parseMoney(s.originalCustomerCharge)!==parseMoney(amount)))fail("دخل النقل الخارجي لا يطابق فاتورته الأصلية");
  emit(activity,owner,activity.incomeBasis,basisDate,activity.agreementId,amount,false,{activityId:activity.id});
 }
 for(const cost of [...input.costs].sort((a,b)=>a.id-b.id)){
  const owner=`cost:${cost.id}`;if(!original(cost,owner))continue;const s=cost.snapshot;
  if(hash(s)!==cost.sourceDigest||s.expenseId!==cost.expenseId||s.vehicleId!==cost.vehicleId||s.reason!==cost.reason||typeof s.amount!=="string")fail("بصمة مصدر المصروف لا تطابق مصروفه الأصلي");
  id(cost.expenseId);const basisDate=day(s.date),term=at(basisDate);if(!term)fail("اتفاق مصدر المصروف الأصلي غير متاح");
  const amount=formatMoney(parseMoney(s.amount));let type:string,event:string,kind:ClosingSource["kind"];
  if(cost.fundingKind==="other"){
   if(cost.costClass!=="operating"||cost.payerMemberId!==null||cost.employeeEntryId!==s.employeeFinanceEntryId||s.expenseType!=="driver_wage")fail("مصدر أجرة السائق لا يطابق المصروف الأصلي");
   id(cost.employeeEntryId);id(s.driverId);type="vp_driver_accrual";event="driver_accrual";kind="driver";
  }else{
   if(!["partner_advance","partner_capital"].includes(cost.fundingKind)||!["operating","capital"].includes(cost.costClass)||s.partnershipId!==cost.partnershipId||s.payerMemberId!==cost.payerMemberId||s.fundingKind!==cost.fundingKind||s.costClass!==cost.costClass||!term.members.some(m=>m.id===cost.payerMemberId))fail("تصنيف تمويل مصدر المصروف أو شريكه غير مطابق");
   if(cost.costClass==="capital"&&s.expenseType==="driver_wage")fail("مصدر أجرة السائق لا يصنف استثماراً رأسمالياً");
   type=cost.costClass==="operating"?(cost.fundingKind==="partner_advance"?"vp_partner_operating_advance":"vp_partner_operating_capital"):(cost.fundingKind==="partner_advance"?"vp_partner_capital_advance":"vp_partner_capital_capital");event="partner_paid_cost";
   kind=cost.costClass==="capital"?"capital":s.expenseType==="driver_wage"?"driver":s.expenseType==="fuel"?"fuel":"operating";
  }
  if(cost.financial.type!==type||cost.financial.event!==event||cost.financial.direction!=="expense"||cost.financial.date!==basisDate)fail("المصدر المالي للمصروف لا يطابق نوعه وتاريخه");
  emit(cost,owner,kind,basisDate,term.id,amount,s.bookingId==null&&s.serviceOrderId==null,{costFundingId:cost.id,expenseId:cost.expenseId});
 }
 for(const cost of [...(input.companyCosts??[])].sort((a,b)=>a.expenseId-b.expenseId)){
  const s=cost.snapshot,owner=`expense:${id(cost.expenseId)}`;
  if(cost.vehicleId!==input.vehicleId||s.vehicleId!==cost.vehicleId||s.expenseId!==cost.expenseId||typeof s.amount!=="string")fail("مصدر مصروف الشركة لا يطابق المركبة أو مصروفها الأصلي");
  const basisDate=day(s.date),term=at(basisDate),financial=cost.financial;
  const relevant=within(basisDate)||cost.reversals.some(r=>within(r.date));
  if(!financial){
   if(s.financialTransactionId!=null||cost.reversals.length)fail("مرجع مصروف المركبة المالي غير موجود أو غير مطابق");
   if(relevant&&!["rejected","cancelled"].includes(String(s.status)))blockers.push(`مصروف ${cost.expenseId} بلا موافقة مالية موثقة`);
   continue;
  }
  if(s.financialTransactionId!==financial.id||financial.sourceType!=="vehicle_expense"||financial.sourceId!==String(cost.expenseId)||financial.direction!=="expense"||financial.reversalOf!==null||financial.type==="manual_reversal")fail("المصدر المالي للمصروف لا يطابق مرجعه الأصلي");
  // A rejected/cancelled original cash request can precede a corrected partner
  // funding request. It has no recognized effect; comparing its OLD amount to
  // today's expense would incorrectly block the corrected authoritative cost.
  if(["rejected","cancelled"].includes(financial.status)){
   if(cost.reversals.length)fail("عكس مالي مرتبط بمصروف مرفوض أو ملغي");continue;
  }
  if(parseMoney(financial.amount)!==parseMoney(s.amount))fail("مبلغ مصروف الشركة لا يطابق الحركة المالية الأصلية");
  if(!term){if(relevant)fail("اتفاق مصروف الشركة الأصلي غير متاح");continue;}
  const known=ORIGINAL_VEHICLE_OPERATING_COST_TYPES;
  if(relevant&&!known.includes(String(s.expenseType)))blockers.push(`مصروف ${cost.expenseId} غير مصنف تشغيلياً أو رأسمالياً`);
  if(relevant&&["rejected","cancelled"].includes(String(s.status))&&financial.status==="executed")blockers.push(`مصروف ${cost.expenseId} حالته لا تطابق حركة الصندوق`);
  const returned=cost.reversals.filter(r=>r.status==="executed").reduce((sum,r)=>sum+parseMoney(r.amount),0n);
  const status=financial.status==="executed"?(returned===parseMoney(s.amount)?"reversed":"approved"):["rejected","cancelled"].includes(financial.status)?financial.status:"pending";
  const evidence:SourceEvidence={id:cost.expenseId,vehicleId:cost.vehicleId,partnershipId:input.partnershipId,status,sourceDigest:hash(s),snapshot:s,reason:"original_company_expense",financial,reversals:cost.reversals};
  if(!original(evidence,owner))continue;
  const kind=s.expenseType==="driver_wage"?"driver":s.expenseType==="fuel"?"fuel":"operating";
  emit(evidence,owner,kind,basisDate,term.id,formatMoney(parseMoney(s.amount)),s.bookingId==null&&s.serviceOrderId==null,{expenseId:cost.expenseId},basisDate);
 }
 return {sources,snapshots,historySources,historySnapshots,blockers:[...new Set(blockers)].sort()};
}
