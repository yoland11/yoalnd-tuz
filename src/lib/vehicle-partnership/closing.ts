import {createHash} from "node:crypto";
import {canonicalPartnershipJson} from "./canonical";
import {allocateMoney,allocateWeightedMoney,formatMoney,parseMoney,validateShares} from "./money";
import {PartnershipValidationError,type DepreciationPolicy,type ReservePolicy,type MonthResult} from "./types";

export type ClosingMember={id:number;partyKey:string;profitBasisPoints:number;expenseBasisPoints:number};
export type ClosingTerm={id:number;effectiveFrom:string;members:readonly ClosingMember[]};
export type ClosingSource={key:string;kind:"internal"|"external"|"internal_reversal"|"external_reversal"|"driver"|"fuel"|"operating"|"capital"|"cost_recovery"|"capital_recovery";date:string;basisDate:string;agreementId:number;amount:string;approved:boolean;shared:boolean;evidence?:string|null};
export const CLOSING_CALCULATION_VERSION=1;
export type ClosingLossClaim={key:string;category:"loss";period:string;agreementId:number;memberId:number;partyKey:string;remaining:string};
export type ClosingMathInput={from:string;to:string;terms:readonly ClosingTerm[];sources:readonly ClosingSource[];lossClaims:readonly ClosingLossClaim[];openingBalanceVerified:boolean;policy:{depreciation:DepreciationPolicy|null;reserve:ReservePolicy|null;resultAllocation:"dated_results"|null;sharedCostBasis:"expense_date"|null};blockers?:readonly string[]};
export type ClosingAllocation={agreementId:number;memberId:number;partyKey:string;amount:string};
export type ClosingRecovery=ClosingAllocation & {lossKey:string};
export type ClosingCalculation={summary:MonthResult;profitAllocations:ClosingAllocation[];lossAllocations:ClosingAllocation[];lossRecoveries:ClosingRecovery[];claimsRemaining:Array<ClosingLossClaim>;segments:Array<{agreementId:number;result:string|null}>;investment:string;digest:string};
function fail(message:string):never{throw new PartnershipValidationError(message);}
const id=(value:number)=>{if(!Number.isSafeInteger(value)||value<=0)fail("معرف مصدر أو شريك الإغلاق غير صالح");return value;};
const memberKey=(agreementId:number,memberId:number)=>`agreement:${agreementId}:member:${memberId}`;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function date(value:string):string{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail("تاريخ مصدر الإغلاق غير صالح");
 const parsed=new Date(`${value}T00:00:00Z`);if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail("تاريخ مصدر الإغلاق غير موجود");return value;
}
export function closingMonthBounds(period:string){
 if(typeof period!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))fail("حدد شهر الإغلاق بصيغة سنة-شهر");
 const from=date(`${period}-01`),year=Number(period.slice(0,4)),month=Number(period.slice(5));
 if(year<1900||year>2199)fail("شهر الإغلاق خارج النطاق المدعوم");
 return {from,to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};
}
function identity(value:string):string{if(typeof value!=="string"||!value||value!==value.trim()||value.length>240)fail("مرجع مصدر الإغلاق غير صالح");return value;}
function party(value:string):string{if(typeof value!=="string"||!/^(customer|supplier|staff):[1-9]\d*$/.test(value)||value.length>120)fail("هوية طرف شراكة الإغلاق غير صالحة");return value;}
/** Computational preview only. Authority, source locks and financial approval
 * remain in the server. Never consumes old APPROVED profit balances: only the
 * current month's provisional positive share can recover that SAME party's
 * original loss. Departed parties' losses stay attached to their original IDs. */
export function calculatePartnershipClosing(input:ClosingMathInput):ClosingCalculation{
 const bounds=closingMonthBounds(input.from.slice(0,7));if(input.from!==bounds.from||input.to!==bounds.to)fail("يجب احتساب شهر كامل للإغلاق");
 if(!Array.isArray(input.terms)||!input.terms.length||input.terms.length>80||!Array.isArray(input.sources)||input.sources.length>5000||!Array.isArray(input.lossClaims)||input.lossClaims.length>5000)fail("مصادر أو اتفاقات الإغلاق تتجاوز النطاق الآمن");
 if(typeof input.openingBalanceVerified!=="boolean"||!input.policy)fail("سياسة الإغلاق أو إثبات الرصيد الافتتاحي غير صالح");
 if(input.policy.resultAllocation!=null&&input.policy.resultAllocation!=="dated_results"||input.policy.sharedCostBasis!=null&&input.policy.sharedCostBasis!=="expense_date")fail("أساس توزيع الإغلاق غير معتمد");
 const terms:ClosingTerm[]=input.terms.map((term:ClosingTerm)=>({id:id(term.id),effectiveFrom:date(term.effectiveFrom),members:term.members.map(m=>({...m,id:id(m.id),partyKey:party(m.partyKey)})).sort((a,b)=>a.id-b.id)})).sort((a,b)=>compare(a.effectiveFrom,b.effectiveFrom)||a.id-b.id);
 const termsById=new Map<number,typeof terms[number]>(),memberIds=new Set<number>();
 for(const term of terms){
  if(termsById.has(term.id)||term.members.length!==2||new Set(term.members.map(m=>m.partyKey)).size!==2)fail("اتفاق أو شريك إغلاق مكرر");termsById.set(term.id,term);
  for(const m of term.members){if(memberIds.has(m.id))fail("معرف عضو مكرر عبر اتفاقات الإغلاق");memberIds.add(m.id);}
  for(const field of ["profitBasisPoints","expenseBasisPoints"] as const)validateShares(term.members.map(m=>({key:memberKey(term.id,m.id),basisPoints:m[field]})));
 }
 if(new Set(terms.map(t=>t.effectiveFrom)).size!==terms.length)fail("يوجد أكثر من اتفاق نافذ في التاريخ نفسه");
 const at=(day:string)=>terms.filter(t=>t.effectiveFrom<=day).at(-1);
 const blockers=[...(input.blockers??[])];if(blockers.some(b=>typeof b!=="string"||!b.trim()))fail("أسباب عدم اكتمال الإغلاق غير صالحة");
 if(!input.openingBalanceVerified)blockers.push("رصيد الخسارة الافتتاحي أو تسلسل الإغلاقات غير مثبت");
 const reference=at(input.to)??terms[0];if(!at(input.to))blockers.push("لا يوجد اتفاق شراكة نافذ لهذا الشهر");
 const sourcesByKey=new Map<string,ClosingSource>();
 for(const source of input.sources){
  if(!["internal","external","internal_reversal","external_reversal","driver","fuel","operating","capital","cost_recovery","capital_recovery"].includes(source.kind)||typeof source.approved!=="boolean"||typeof source.shared!=="boolean")fail("نوع مصدر الإغلاق أو اعتماده غير صالح");
  const normalized={key:identity(source.key),kind:source.kind,date:date(source.date),basisDate:date(source.basisDate),agreementId:id(source.agreementId),amount:formatMoney(parseMoney(source.amount)),approved:source.approved,shared:source.shared,evidence:source.evidence??null};
  if(normalized.date<input.from||normalized.date>input.to)fail("مصدر مالي خارج شهر الإغلاق");
  if(normalized.evidence!=null&&!/^[a-f0-9]{64}$/.test(normalized.evidence))fail("إثبات مصدر الإغلاق غير صالح");
  const old=sourcesByKey.get(normalized.key);if(old&&canonicalPartnershipJson(old)!==canonicalPartnershipJson(normalized))fail("مرجع مصدر الإغلاق مكرر بقيم متعارضة");
  sourcesByKey.set(normalized.key,normalized);
 }
 const sources=[...sourcesByKey.values()].sort((a,b)=>compare(a.key,b.key));
 const claims=input.lossClaims.map(claim=>{
  if(claim.category!=="loss")fail("لا يمكن مقاصة استحقاق ربح معتمد كرصد خسارة مرحلة");
  const normalized={...claim,key:identity(claim.key),period:date(claim.period),agreementId:id(claim.agreementId),memberId:id(claim.memberId),partyKey:party(claim.partyKey),remaining:formatMoney(parseMoney(claim.remaining))};
  const original=termsById.get(normalized.agreementId)?.members.find(m=>m.id===normalized.memberId);
  if(!original||original.partyKey!==normalized.partyKey)fail("رصيد الخسارة لا يطابق طرفه واتفاقه الأصليين");
  if(normalized.period>input.from||normalized.period===input.from&&!normalized.key.startsWith("opening:"))fail("رصيد خسارة من فترة لاحقة أو غير معتمدة");
  return normalized;
 }).sort((a,b)=>compare(a.period,b.period)||compare(a.key,b.key));
 if(new Set(claims.map(c=>c.key)).size!==claims.length)fail("رصيد خسارة مرحلة مكرر");
 const used=new Set<number>();
 terms.forEach((term,index)=>{if(term.effectiveFrom<=input.to&&(terms[index+1]?.effectiveFrom??"9999-12-31")>input.from)used.add(term.id);});
 const netByTerm=new Map<number,bigint>();let investment=0n,internal=0n,external=0n,cost=0n;
 for(const source of sources){
  used.add(source.agreementId);
  const owner=at(source.basisDate);if(!owner||owner.id!==source.agreementId)blockers.push(`مصدر ${source.key} لا يطابق الاتفاق النافذ بتاريخ عمليته`);
  if(!source.approved)blockers.push(`مصدر ${source.key} بانتظار الاعتماد`);
  if(!termsById.has(source.agreementId))blockers.push(`اتفاق مصدر ${source.key} غير متاح`);
  if(source.kind==="internal"||source.kind==="external"){if(source.basisDate>source.date)blockers.push(`مصدر ${source.key} معترف به قبل تاريخ عمليته`);}
  if(!source.approved)continue;const amount=parseMoney(source.amount);
  if(source.kind==="capital"||source.kind==="capital_recovery"){investment+=source.kind==="capital"?amount:-amount;continue;}
  if(source.kind==="internal")internal+=amount;
  else if(source.kind==="external")external+=amount;
  else if(source.kind==="internal_reversal")internal-=amount;
  else if(source.kind==="external_reversal")external-=amount;
  else cost+=source.kind==="cost_recovery"?-amount:amount;
  const sign=source.kind==="internal"||source.kind==="external"||source.kind==="cost_recovery"?1n:-1n;
  netByTerm.set(source.agreementId,(netByTerm.get(source.agreementId)??0n)+sign*amount);
 }
 const depreciation=input.policy.depreciation?.kind==="configured"?parseMoney(input.policy.depreciation.amount):0n;
 if(input.policy.depreciation==null)blockers.push("سياسة الإهلاك غير محددة");
 else if(!["none","configured"].includes(input.policy.depreciation.kind))fail("سياسة الإهلاك غير صالحة");
 cost+=depreciation;
 netByTerm.set(reference.id,(netByTerm.get(reference.id)??0n)-depreciation);used.add(reference.id);
 const segments=terms.filter(t=>used.has(t.id));
 const profiles=new Set(segments.map(t=>canonicalPartnershipJson(t.members.map(m=>({partyKey:m.partyKey,profit:m.profitBasisPoints,expense:m.expenseBasisPoints})).sort((a,b)=>compare(a.partyKey,b.partyKey)))));
 if(profiles.size>1&&input.policy.resultAllocation!=="dated_results")blockers.push("تغيرت نسب أو أطراف الشراكة؛ حدد أساس توزيع صافي الشهر على الفترات المؤرخة");
 if(profiles.size>1&&(sources.some(s=>s.shared)||depreciation>0n)&&input.policy.sharedCostBasis!=="expense_date")blockers.push("حدد أساس إسناد المصاريف المشتركة والإهلاك قبل اعتماد شهر متعدد الاتفاقات");
 if(input.policy.reserve==null)blockers.push("سياسة الاحتياطي غير محددة");
 else if(input.policy.reserve.kind==="percent"){
  if(!Number.isInteger(input.policy.reserve.basisPoints)||input.policy.reserve.basisPoints<0||input.policy.reserve.basisPoints>10000||!["after_loss_recovery","recognized_income"].includes(input.policy.reserve.basis))fail("نسبة الاحتياطي أو أساسه غير صالح");
 }else if(input.policy.reserve.kind==="fixed")parseMoney(input.policy.reserve.amount);
 else if(input.policy.reserve.kind!=="none")fail("سياسة الاحتياطي غير صالحة");
 const digest=createHash("sha256").update(canonicalPartnershipJson({calculationVersion:CLOSING_CALCULATION_VERSION,from:input.from,to:input.to,terms,sources,claims,openingBalanceVerified:input.openingBalanceVerified,policy:input.policy,blockers:[...new Set(blockers)].sort(compare)})).digest("hex");
 const incomplete=():MonthResult=>({complete:false,blockers:[...new Set(blockers)],externalIncome:null,internalIncome:null,cost:null,result:null,lossRecovered:null,carriedLossOut:null,reserve:null,maxDistributable:null,proposedProfitShares:null,lossAllocations:null});
 const failure=(summary:MonthResult):ClosingCalculation=>({summary,profitAllocations:[],lossAllocations:[],lossRecoveries:[],claimsRemaining:claims.map(c=>({...c})),segments:segments.map(t=>({agreementId:t.id,result:null})),investment:formatMoney(investment),digest});
 if(blockers.length)return failure(incomplete());
 const net=segments.reduce((total,t)=>total+(netByTerm.get(t.id)??0n),0n);
 if(net!==internal+external-cost)throw new Error("Closing source totals do not match dated segment totals");
 const allocateSegments=(total:bigint,profit:boolean):ClosingAllocation[]=>{
  const weighted=allocateWeightedMoney(total,segments.map(t=>{const n=netByTerm.get(t.id)??0n;return {key:`agreement:${t.id}`,weight:profit?(n>0n?n:0n):(n<0n?-n:0n)};}));
  return segments.flatMap(term=>allocateMoney(parseMoney(weighted.find(w=>w.key===`agreement:${term.id}`)!.amount),term.members.map(m=>({key:memberKey(term.id,m.id),basisPoints:profit?m.profitBasisPoints:m.expenseBasisPoints}))).map(a=>{const member=term.members.find(m=>memberKey(term.id,m.id)===a.key)!;return {agreementId:term.id,memberId:member.id,partyKey:member.partyKey,amount:a.amount};}));
 };
 const gross=allocateSegments(net>0n?net:0n,true),partyGross=new Map<string,bigint>();
 for(const a of gross)partyGross.set(a.partyKey,(partyGross.get(a.partyKey)??0n)+parseMoney(a.amount));
 const recoveryByParty=new Map<string,bigint>(),recoveries:ClosingRecovery[]=[],remaining:ClosingLossClaim[]=[];let recovered=0n;
 for(const claim of claims){const owed=parseMoney(claim.remaining),available=partyGross.get(claim.partyKey)??0n,take=owed<available?owed:available;partyGross.set(claim.partyKey,available-take);recoveryByParty.set(claim.partyKey,(recoveryByParty.get(claim.partyKey)??0n)+take);recovered+=take;remaining.push({...claim,remaining:formatMoney(owed-take)});if(take>0n)recoveries.push({lossKey:claim.key,agreementId:claim.agreementId,memberId:claim.memberId,partyKey:claim.partyKey,amount:formatMoney(take)});}
 const memberRemaining=new Map(gross.map(a=>[memberKey(a.agreementId,a.memberId),parseMoney(a.amount)]));
 for(const [partyKey,amount] of recoveryByParty){if(amount===0n)continue;const allocations=gross.filter(a=>a.partyKey===partyKey);for(const a of allocateWeightedMoney(amount,allocations.map(a=>({key:memberKey(a.agreementId,a.memberId),weight:parseMoney(a.amount)}))))memberRemaining.set(a.key,memberRemaining.get(a.key)!-parseMoney(a.amount));}
 const available=net>0n?net-recovered:0n;let reserve=0n;
 if(input.policy.reserve?.kind==="fixed")reserve=parseMoney(input.policy.reserve.amount);
 else if(input.policy.reserve?.kind==="percent"){
  const income=internal+external;
  const basis=input.policy.reserve.basis==="recognized_income"?(income>0n?income:0n):available;
  reserve=(basis*BigInt(input.policy.reserve.basisPoints)+5000n)/10000n;
 }
 if(reserve>available){blockers.push("الاحتياطي يتجاوز الربح المتاح بعد استرداد الخسارة");return failure(incomplete());}
 const summary:MonthResult={complete:true,blockers:[],externalIncome:formatMoney(external),internalIncome:formatMoney(internal),cost:formatMoney(cost),result:formatMoney(net),lossRecovered:formatMoney(recovered),carriedLossOut:"0.00",reserve:formatMoney(reserve),maxDistributable:formatMoney(available-reserve),proposedProfitShares:[],lossAllocations:[]};
 const distributed=allocateWeightedMoney(parseMoney(summary.maxDistributable!),gross.map(a=>({key:memberKey(a.agreementId,a.memberId),weight:memberRemaining.get(memberKey(a.agreementId,a.memberId))!})));
 const profitAllocations=gross.map(a=>({...a,amount:distributed.find(d=>d.key===memberKey(a.agreementId,a.memberId))!.amount})),lossAllocations=allocateSegments(net<0n?-net:0n,false);
 summary.carriedLossOut=formatMoney(remaining.reduce((sum,c)=>sum+parseMoney(c.remaining),0n)+(net<0n?-net:0n));
 summary.proposedProfitShares=profitAllocations.map(a=>({key:memberKey(a.agreementId,a.memberId),amount:a.amount}));summary.lossAllocations=lossAllocations.map(a=>({key:memberKey(a.agreementId,a.memberId),amount:a.amount}));
 return {summary,profitAllocations,lossAllocations,lossRecoveries:recoveries,claimsRemaining:remaining,segments:segments.map(t=>({agreementId:t.id,result:formatMoney(netByTerm.get(t.id)??0n)})),investment:formatMoney(investment),digest};
}
