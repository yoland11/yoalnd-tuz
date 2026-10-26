import {allocateMoney,parseMoney,formatMoney,validateShares} from "./money";
import {PartnershipValidationError,type AgreementDraft,type AgreementMember,type CostFact,type IncomeFact,type MonthFacts,type MonthResult,type Share,type TripFacts,type TripResult} from "./types";

const fail=(message:string):never=>{throw new PartnershipValidationError(message)};
const record=(value:unknown):Record<string,unknown>=>value!=null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:fail("بيانات الشراكة غير صالحة");
const positiveId=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0?value:fail("معرّف المركبة أو الطرف غير صالح");
const requiredText=(value:unknown,max:number)=>typeof value==="string"&&value.trim()&&value.trim().length<=max?value.trim():fail("النص المطلوب غير صالح");
function calendarDate(value:unknown):string{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return fail("تاريخ الاتفاق غير صالح");
  const date=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)return fail("تاريخ الاتفاق غير صالح");
  return value;
}
function basisPoints(value:unknown):number{
  if(typeof value!=="number"||!Number.isInteger(value)||value<0||value>10000)return fail("نسبة الشريك غير صالحة");
  return value;
}
function member(value:unknown):AgreementMember{
  const m=record(value),party=record(m.party);
  if(!["customer","supplier","staff"].includes(String(party.kind)))return fail("نوع الطرف غير صالح");
  return {party:{kind:party.kind as AgreementMember["party"]["kind"],id:positiveId(party.id)},ownershipBasisPoints:basisPoints(m.ownershipBasisPoints),profitBasisPoints:basisPoints(m.profitBasisPoints),expenseBasisPoints:basisPoints(m.expenseBasisPoints),capitalContribution:formatMoney(parseMoney(m.capitalContribution as string))};
}
export function validateAgreement(value:unknown):AgreementDraft{
  const draft=record(value);
  if(!Array.isArray(draft.members)||draft.members.length!==2)return fail("هذه المركبة تتطلب شريكين فقط");
  const members=draft.members.map(member);
  for(const field of ["ownershipBasisPoints","profitBasisPoints","expenseBasisPoints"] as const)validateShares(members.map(m=>({key:`${m.party.kind}:${m.party.id}`,basisPoints:m[field]})));
  return {vehicleId:positiveId(draft.vehicleId),registrationOwner:requiredText(draft.registrationOwner,500),effectiveFrom:calendarDate(draft.effectiveFrom),members};
}
function sourceKey(value:unknown):string{
  if(typeof value!=="string"||!value.trim()||value!==value.trim()||value.length>240)return fail("مرجع المصدر المالي غير صالح");
  return value;
}
function costTotal(costs:readonly CostFact[],blockers:string[]):bigint{
  if(!Array.isArray(costs))return fail("قائمة المصاريف غير صالحة");
  let total=0n;const seen=new Map<string,CostFact>();
  for(const cost of costs){
    if(!cost||!["approved","pending","rejected"].includes(cost.status)||!["driver","fuel","operating","capital"].includes(cost.category))return fail("مصدر المصروف المالي غير صالح");
    const key=sourceKey(cost.sourceKey),previous=seen.get(key);
    const amount=cost.amount==null?null:parseMoney(cost.amount);
    if(previous){
      if((previous.amount==null?null:parseMoney(previous.amount))!==amount||previous.status!==cost.status||previous.category!==cost.category)return fail("قيم مصدر المصروف نفسه متعارضة وغير متطابقة");
      continue;
    }
    seen.set(key,cost);
    if(cost.status==="rejected"||cost.category==="capital")continue;
    if(cost.status!=="approved"){blockers.push("توجد تكلفة بانتظار الاعتماد");continue;}
    if(amount==null){blockers.push(cost.category==="driver"?"أجرة السائق غير معروفة":"مبلغ تكلفة معتمدة غير معروف");continue;}
    total+=amount;
  }
  return total;
}
function incomeTotals(income:readonly IncomeFact[],blockers:string[]):{internal:bigint;external:bigint}{
  if(!Array.isArray(income))return fail("قائمة الإيرادات غير صالحة");
  const seen=new Map<string,IncomeFact>();let internal=0n,external=0n;
  for(const fact of income){
    if(!fact||!["internal","external"].includes(fact.kind)||typeof fact.approved!=="boolean"||typeof fact.recognized!=="boolean")return fail("مصدر إيراد النقل غير صالح");
    const key=sourceKey(fact.sourceKey),previous=seen.get(key);
    const amount=fact.amount==null?null:parseMoney(fact.amount);
    if(previous){
      if(previous.kind!==fact.kind||(previous.amount==null?null:parseMoney(previous.amount))!==amount||previous.approved!==fact.approved||previous.recognized!==fact.recognized)return fail("مرجع الإيراد مكرر بقيم متعارضة");
      continue;
    }
    seen.set(key,fact);
    if(!fact.approved||!fact.recognized){blockers.push("يوجد إيراد أو استحقاق نقل غير معتمد أو غير معترف به");continue;}
    if(amount==null){blockers.push("مبلغ إيراد النقل غير معروف");continue;}
    if(fact.kind==="internal")internal+=amount;else external+=amount;
  }
  return {internal,external};
}
function initialBlockers(value?:readonly string[]):string[]{
  if(value==null)return [];
  if(!Array.isArray(value)||value.some(item=>typeof item!=="string"||!item.trim()))return fail("أسباب عدم اكتمال الحساب غير صالحة");
  return [...value];
}
export function calculateTrip(input:TripFacts):TripResult{
  validateShares(input.profitShares);
  const blockers=initialBlockers(input.blockers);
  if(!input.income)blockers.push("مصدر إيراد النقل غير محدد");
  if(!input.driver)blockers.push("أجرة السائق غير محددة؛ سجّل الأجرة أو عدم وجود أجرة صراحة");
  if(input.driver&&input.driver.category!=="driver")return fail("مصدر أجرة السائق ليس تكلفة سائق");
  if(input.driver?.status==="rejected")blockers.push("أجرة السائق مرفوضة أو ملغاة؛ سجّل الأجرة أو عدم وجود أجرة صراحة");
  const income=incomeTotals(input.income?[input.income]:[],blockers);
  const cost=costTotal(input.driver?[input.driver,...input.costs]:input.costs,blockers);
  if(blockers.length)return {complete:false,blockers:[...new Set(blockers)],income:null,cost:null,contribution:null,provisionalShares:null};
  const revenue=income.internal+income.external,contribution=revenue-cost;
  return {complete:true,blockers:[],income:formatMoney(revenue),cost:formatMoney(cost),contribution:formatMoney(contribution),provisionalShares:contribution>=0n?allocateMoney(contribution,input.profitShares):null};
}
export function calculateMonth(input:MonthFacts):MonthResult{
  validateShares(input.profitShares);validateShares(input.lossShares);
  const partnerKeys=new Set(input.profitShares.map(share=>share.key));
  if(input.lossShares.length!==partnerKeys.size||input.lossShares.some(share=>!partnerKeys.has(share.key)))return fail("شركاء الربح والخسارة يجب أن يكونوا نفس أطراف الاتفاق");
  const blockers=initialBlockers(input.blockers);
  const income=incomeTotals([...input.externalIncome,...input.internalIncome],blockers);
  if(input.externalIncome.some(f=>f.kind!=="external")||input.internalIncome.some(f=>f.kind!=="internal"))return fail("نوع الإيراد لا يطابق قسمه في الحساب");
  let cost=costTotal(input.costs,blockers);
  if(input.depreciation==null)blockers.push("سياسة الإهلاك غير محددة");
  else if(input.depreciation.kind==="configured")cost+=parseMoney(input.depreciation.amount);
  else if(input.depreciation.kind!=="none")return fail("سياسة الإهلاك غير صالحة");
  const carriedLoss=input.carriedLoss==null?null:parseMoney(input.carriedLoss);
  if(carriedLoss==null)blockers.push("رصيد الخسارة المرحلة غير محدد");
  if(input.reserve==null)blockers.push("سياسة الاحتياطي غير محددة");
  const result=income.internal+income.external-cost;
  const recovered=carriedLoss==null||result<=0n?0n:result<carriedLoss?result:carriedLoss;
  const available=result>0n?result-recovered:0n;
  let reserve=0n;
  if(input.reserve?.kind==="fixed")reserve=parseMoney(input.reserve.amount);
  else if(input.reserve?.kind==="percent"){
    const points=basisPoints(input.reserve.basisPoints);
    if(!["after_loss_recovery","recognized_income"].includes(input.reserve.basis))return fail("أساس الاحتياطي غير صالح");
    const base=input.reserve.basis==="recognized_income"?income.internal+income.external:available;
    reserve=(base*BigInt(points)+5000n)/10000n;
  }else if(input.reserve!=null&&input.reserve.kind!=="none")return fail("سياسة الاحتياطي غير صالحة");
  if(reserve>available)blockers.push("الاحتياطي يتجاوز الربح المتاح بعد استرداد الخسارة");
  if(blockers.length)return {complete:false,blockers:[...new Set(blockers)],externalIncome:null,internalIncome:null,cost:null,result:null,lossRecovered:null,carriedLossOut:null,reserve:null,maxDistributable:null,proposedProfitShares:null,lossAllocations:null};
  const currentLoss=result<0n?-result:0n;
  const distributable=available-reserve;
  return {complete:true,blockers:[],externalIncome:formatMoney(income.external),internalIncome:formatMoney(income.internal),cost:formatMoney(cost),result:formatMoney(result),lossRecovered:formatMoney(recovered),carriedLossOut:formatMoney(carriedLoss!+currentLoss-recovered),reserve:formatMoney(reserve),maxDistributable:formatMoney(distributable),proposedProfitShares:allocateMoney(distributable,input.profitShares),lossAllocations:allocateMoney(currentLoss,input.lossShares)};
}
