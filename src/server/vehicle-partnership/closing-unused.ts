import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {parseMoney} from "../../lib/vehicle-partnership/money";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import type {ClosingRightsContext} from "./closing-rights";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات الإغلاق المحفوظ غير صالح");return value as Row;}
function context(input:ClosingRightsContext){
 partnershipId(input.root.id);partnershipId(input.root.vehicleId);partnershipId(Number(input.row.id));partnershipId(Number(input.row.revision));
 if(input.snapshot.partnershipId!==input.root.id||input.snapshot.vehicleId!==input.root.vehicleId||Number(input.row.partnership_id)!==input.root.id||input.financialId!==(input.row.financial_transaction_id==null?null:Number(input.row.financial_transaction_id))||typeof input.row.source_digest!=="string"||!/^[a-f0-9]{64}$/.test(input.row.source_digest))conflict("هوية الإغلاق أو نسخته أو مرجعه المالي غير مطابق");
 if(input.financialId!=null)partnershipId(input.financialId);
}
const revisionPrefix=(input:ClosingRightsContext)=>`vp:closing:${Number(input.row.id)}:r${Number(input.row.revision)}:`;

/** Strict EXISTING rights proof only. A reversal replay uses the original
 * frozen revision and reversed status, without inspecting a newer month's
 * payments, creating missing rights, or reapplying the unused-period gate. */
async function proveRevision(tx:PartnershipExecutor,input:ClosingRightsContext,status:"approved"|"reversed"){
 context(input);if(!["approved","reversed"].includes(status))conflict("حالة إثبات حق الإغلاق غير صالحة");
 const expected=new Map<string,{category:string;kind:string;agreementId:number;memberId:number;amount:string;proof:Row}>();
 for(const [kind,category,items] of [["profit_allocation","profit",input.snapshot.calculation.profitAllocations],["loss_allocation","loss",input.snapshot.calculation.lossAllocations],["loss_recovery","loss_recovery",input.snapshot.calculation.lossRecoveries]] as const){
  for(const [index,item] of items.entries())if(parseMoney(item.amount)>0n){partnershipId(item.agreementId);partnershipId(item.memberId);expected.set(`${kind}:${index}:${item.agreementId}:${item.memberId}`,{category,kind,agreementId:item.agreementId,memberId:item.memberId,amount:item.amount,proof:item as unknown as Row});}
 }
 if(expected.size>500||input.financialId==null&&expected.size)conflict("الحقوق الموجبة تتطلب قيداً مالياً معتمداً ضمن حد المراجعة");
 const lines=partnershipRows(await tx.execute(sql`/* vp_unused_allocation_lines */ SELECT id,source_key,line_kind,agreement_id,member_id,amount::text,snapshot FROM vehicle_partnership_closing_lines WHERE closing_id=${Number(input.row.id)} AND revision=${Number(input.row.revision)} AND line_kind IN ('profit_allocation','loss_allocation','loss_recovery') ORDER BY id LIMIT 501`));
 const rights=partnershipRows(await tx.execute(sql`/* vp_unused_monthly_rights */ SELECT r.*,r.amount::text FROM vehicle_partnership_rights r LEFT JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE (l.closing_id=${Number(input.row.id)} AND l.revision=${Number(input.row.revision)}) OR r.event_key LIKE ${revisionPrefix(input)+"%"} OR (${input.financialId}::integer IS NOT NULL AND r.financial_transaction_id=${input.financialId} AND r.category IN ('profit','loss','loss_recovery')) ORDER BY r.id LIMIT 501`));
 if(lines.length>500||rights.length>500||lines.length!==expected.size||rights.length!==expected.size)conflict("حقوق الإغلاق أو سطور توزيعه ناقصة أو مكررة");
 const lineIds=new Set<number>(),rightIds=new Set<number>(),result:number[]=[],amounts=new Map<number,bigint>();
 for(const line of lines){
  const value=expected.get(String(line.source_key)),lineId=partnershipId(Number(line.id));
  if(lineIds.has(lineId)||!value||line.line_kind!==value.kind||Number(line.agreement_id)!==value.agreementId||Number(line.member_id)!==value.memberId||parseMoney(String(line.amount))!==parseMoney(value.amount)||canonicalPartnershipJson(line.snapshot)!==canonicalPartnershipJson(value.proof))conflict("سطر توزيع الإغلاق لا يطابق النتيجة المجمدة");
  lineIds.add(lineId);expected.delete(String(line.source_key));
  let lossRightId:number|undefined;
  if(value.category==="loss_recovery"){
   const key=String(value.proof.lossKey);if(!/^right:[1-9]\d*$/.test(key))conflict("مصدر استرداد خسارة الإغلاق غير موثق");lossRightId=partnershipId(Number(key.slice(6)));
   const claims=input.snapshot.lossClaims.filter(claim=>claim.key===key);
   if(claims.length!==1||claims[0].category!=="loss"||claims[0].agreementId!==value.agreementId||claims[0].memberId!==value.memberId||parseMoney(claims[0].remaining)<parseMoney(value.amount))conflict("استرداد الخسارة لا يطابق رصيد طرفه الأصلي");
  }
  const proof={...value.proof,closingId:Number(input.row.id),revision:Number(input.row.revision),sourceDigest:String(input.row.source_digest),...(lossRightId?{lossRightId}:{})};
  const matches=rights.filter(right=>Number(right.closing_line_id)===lineId);if(matches.length!==1)conflict("حق الإغلاق الأصلي مفقود أو مكرر");
  const right=matches[0],rightId=partnershipId(Number(right.id));
  if(rightIds.has(rightId)||Number(right.partnership_id)!==input.root.id||Number(right.agreement_id)!==value.agreementId||Number(right.member_id)!==value.memberId||parseMoney(String(right.amount))!==parseMoney(value.amount)||right.category!==value.category||right.direction!==(value.category==="loss"?"debit":"credit")||right.status!==status||right.event_key!==`${revisionPrefix(input)}${value.category}:${lineId}`||Number(right.financial_transaction_id)!==input.financialId||canonicalPartnershipJson(right.source_snapshot)!==canonicalPartnershipJson(proof))conflict("حق الشريك لا يطابق أصل نسخة الإغلاق");
  rightIds.add(rightId);result.push(rightId);amounts.set(rightId,parseMoney(value.amount));
 }
 if(expected.size||rights.some(right=>!rightIds.has(Number(right.id))))conflict("يوجد حق شهري خارج التوزيع المجمد");
 return {ids:result.sort((a,b)=>a-b),amounts};
}

export async function proveClosingRevisionRights(tx:PartnershipExecutor,input:ClosingRightsContext,status:"approved"|"reversed"="approved"):Promise<number[]>{return (await proveRevision(tx,input,status)).ids;}

/** The caller holds root/context locks and proves the immutable approved
 * revision. Root serialization also protects the absence of a later pending
 * close. This guard reads and reconciles only; it never repairs missing rights. */
export async function assertClosingUnused(tx:PartnershipExecutor,actor:PartnershipActor,input:ClosingRightsContext):Promise<number[]>{
 authorizePartnership(actor,true);context(input);
 if(!["approved","distributed"].includes(String(input.row.status))||typeof input.row.period!=="string"||!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(input.row.period)||input.snapshot.from!==input.row.period)conflict("حالة الإغلاق أو شهر نسخته المجمدة غير مطابق");
 const later=partnershipRows(await tx.execute(sql`/* vp_unused_later_period */ SELECT id FROM vehicle_partnership_closings WHERE partnership_id=${input.root.id} AND period>${input.row.period}::date AND status IN ('pending','approved','distributed') ORDER BY period,id LIMIT 1`));
 if(later.length)conflict("يوجد إغلاق لاحق معلق أو معتمد؛ يلزم تصحيح مؤرخ بدلاً من إعادة الفتح");
 for(const source of input.snapshot.sourceSnapshots)if(object(object(source.snapshot).financial).sourceType==="vehicle_expense")conflict("يتضمن الشهر سجل مصروف نقدي أصلي؛ يلزم تصحيح مؤرخ دون إعادة الفتح");
 const proven=await proveRevision(tx,input,"approved"),result=proven.ids;
 // A loss can be consumed by a recovery even if a downstream header has been
 // damaged. Do not infer that an absent later header makes the loss unused.
 const recovered=partnershipRows(await tx.execute(sql`/* vp_unused_loss_recoveries */ SELECT rr.id FROM vehicle_partnership_rights rr WHERE rr.category='loss_recovery' AND rr.status='approved' AND rr.source_snapshot->>'lossRightId' IN (SELECT r.id::text FROM vehicle_partnership_rights r JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE l.closing_id=${Number(input.row.id)} AND l.revision=${Number(input.row.revision)} AND r.partnership_id=${input.root.id} AND r.category='loss') ORDER BY rr.id LIMIT 1`));
 if(recovered.length)conflict("استُخدمت خسارة الشهر في استرداد معتمد؛ يلزم تصحيح الفترة");
 for(const sourceId of result){
  const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId});
  if(!state||state.approvalStatus!=="approved"||parseMoney(state.totalAmount)!==proven.amounts.get(sourceId)||typeof state.approvedPaidAmount!=="string"||typeof state.reservedAmount!=="string")conflict("حالة حق الإغلاق الأصلية غير متاحة");
  // The frozen right proof above establishes the amount. Canonical state must
  // agree, including non-payable loss/recovery rights and optional conversions.
  if([state.approvedPaidAmount,state.reservedAmount,state.nonCashSettledAmount,state.conversionAmount,state.pendingConversionAmount,state.conversionCashPaidAmount,state.conversionCashReservedAmount].some(value=>value!=null&&parseMoney(value)>0n))conflict("حق الإغلاق مستخدم أو عليه طلب نقدي معلق");
 }
 const claims=new Map<number,{amount:bigint;net:bigint;agreementId:number;financialId:number}>();
 for(const source of input.snapshot.sourceSnapshots){
  const proof=object(source.snapshot);if(proof.activityId==null)continue;const financial=object(proof.financial);
  if(!["vp_internal_entitlement","vp_internal_entitlement_reversal"].includes(String(financial.type)))continue;
  const activityId=partnershipId(Number(proof.activityId)),reverse=financial.type==="vp_internal_entitlement_reversal",agreementId=partnershipId(Number(object(proof.sourceSnapshot).agreementId)),amount=parseMoney(String(financial.amount));
  if(financial.sourceType!=="vehicle_partnership_activity"||String(financial.sourceId)!==String(activityId)||financial.status!=="executed"||financial.event!==(reverse?"reversal":"internal_entitlement")||financial.direction!==(reverse?"revenue":"expense")||amount<=0n)conflict("مصدر تحويل استحقاق النقل غير موثق");
  const prior=claims.get(activityId)??{amount:0n,net:0n,agreementId,financialId:0};if(prior.agreementId!==agreementId)conflict("اتفاق مصدر النقل المجمد متعارض");
  if(reverse)prior.net-=amount;else{if(prior.financialId)conflict("مصدر استحقاق النقل مكرر");prior.amount=amount;prior.financialId=partnershipId(Number(financial.id));prior.net+=amount;}claims.set(activityId,prior);
 }
 const internal=String(input.snapshot.calculation.summary.internalIncome);
 if(internal.startsWith("-")||[...claims.values()].some(claim=>!claim.financialId||claim.net<0n||claim.net!==0n&&claim.net!==claim.amount)||[...claims.values()].reduce((sum,claim)=>sum+claim.net,0n)!==parseMoney(internal))conflict("صافي تحويل النقل لا يطابق مصادر الإغلاق الأصلية");
 const active=new Map([...claims].filter(([,claim])=>claim.net>0n));
 if(input.financialId==null&&active.size)conflict("إغلاق بلا حركة مالية لا يقبل تحويل استحقاق موجب");
 const conversions=partnershipRows(await tx.execute(sql`/* vp_unused_conversions */ SELECT a.*,a.amount::text,r.partnership_id,r.agreement_id,r.activity_id,r.amount::text AS right_amount,r.status AS right_status,r.category AS right_category,r.financial_transaction_id AS right_financial_id FROM vehicle_partnership_settlement_allocations a LEFT JOIN vehicle_partnership_rights r ON r.id=a.right_id WHERE (${input.financialId}::integer IS NOT NULL AND a.financial_transaction_id=${input.financialId}) OR a.idempotency_key LIKE ${revisionPrefix(input)+"convert:%"} ORDER BY a.id LIMIT 3001`));
 if(conversions.length>3000||conversions.length!==active.size)conflict("تحويلات الإغلاق ناقصة أو مكررة أو تتجاوز النطاق");
 const seen=new Set<number>(),allocationIds=new Set<number>();
 for(const conversion of conversions){
  const rightId=partnershipId(Number(conversion.right_id)),allocationId=partnershipId(Number(conversion.id)),activityId=partnershipId(Number(conversion.activity_id)),claim=active.get(activityId);
  if(!claim||seen.has(rightId)||allocationIds.has(allocationId)||Number(conversion.partnership_id)!==input.root.id||Number(conversion.agreement_id)!==claim.agreementId||Number(conversion.right_financial_id)!==claim.financialId||conversion.right_status!=="approved"||conversion.right_category!=="internal_entitlement"||parseMoney(String(conversion.right_amount))!==claim.amount||parseMoney(String(conversion.amount))!==claim.net||Number(conversion.financial_transaction_id)!==input.financialId||conversion.purpose!=="internal_conversion"||conversion.conversion_allocation_id!=null||conversion.idempotency_key!==`${revisionPrefix(input)}convert:${rightId}`)conflict("تحويل الإغلاق لا يطابق استحقاق النقل الأصلي المعتمد");
  active.delete(activityId);seen.add(rightId);allocationIds.add(allocationId);
  const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  if(!state||state.approvalStatus!=="approved"||parseMoney(state.totalAmount)!==claim.amount||typeof state.approvedPaidAmount!=="string"||typeof state.reservedAmount!=="string"||typeof state.conversionAmount!=="string"||typeof state.nonCashSettledAmount!=="string"||typeof state.pendingConversionAmount!=="string"||typeof state.conversionCashPaidAmount!=="string"||typeof state.conversionCashReservedAmount!=="string"||parseMoney(state.conversionAmount)!==claim.net||parseMoney(state.nonCashSettledAmount)!==claim.net||[state.approvedPaidAmount,state.reservedAmount,state.pendingConversionAmount,state.conversionCashPaidAmount,state.conversionCashReservedAmount].some(value=>value!=null&&parseMoney(value)>0n))conflict("استحقاق النقل عليه صرف أو حجز نقدي أو تحويل آخر");
 }
 if(active.size)conflict("تحويل أصلي غير مثبت ضمن الإغلاق");
 return result;
}
