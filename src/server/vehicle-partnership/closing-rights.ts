import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import type {ClosingSnapshot} from "./closing";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
export type ClosingRightsContext={root:{id:number;vehicleId:number};row:Row;snapshot:ClosingSnapshot;financialId:number|null};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid monthly rights proof");return value as Row;}
function context(input:ClosingRightsContext){
 partnershipId(input.root.id);partnershipId(input.root.vehicleId);partnershipId(Number(input.row.id));partnershipId(Number(input.row.revision));
 if(input.snapshot.vehicleId!==input.root.vehicleId||input.snapshot.partnershipId!==input.root.id||Number(input.row.partnership_id)!==input.root.id||input.financialId!==(input.row.financial_transaction_id==null?null:Number(input.row.financial_transaction_id)))conflict("هوية الإغلاق ومرجعه المالي غير مطابقين");
 if(input.financialId!=null)partnershipId(input.financialId);
}
/** Convert the ORIGINAL gross claim once. This allocation is noncash and only
 * a reservation until the existing monthly financial request is executed. */
export async function reserveClosingConversions(tx:PartnershipExecutor,actor:PartnershipActor,input:ClosingRightsContext,verifyOnly=false):Promise<number[]>{
 authorizePartnership(actor);context(input);if(verifyOnly?!["approved","distributed"].includes(String(input.row.status)):input.row.status!=="pending")conflict("حالة الإغلاق لا تطابق تحويل الاستحقاق المطلوب");
 const claims=new Map<number,{amount:bigint;net:bigint;financialId:number;agreementId:number}>();
 for(const entry of input.snapshot.sourceSnapshots){
  const proof=object(entry.snapshot);if(proof.activityId==null)continue;const financial=object(proof.financial);
  if(!["vp_internal_entitlement","vp_internal_entitlement_reversal"].includes(String(financial.type)))continue;
  const activityId=partnershipId(Number(proof.activityId)),reverse=financial.type==="vp_internal_entitlement_reversal";
  if(financial.sourceType!=="vehicle_partnership_activity"||String(financial.sourceId)!==String(activityId)||financial.status!=="executed"||financial.direction!==(reverse?"revenue":"expense")||financial.event!==(reverse?"reversal":"internal_entitlement"))conflict("مصدر تحويل الاستحقاق الداخلي غير موثق");
  const amount=parseMoney(String(financial.amount)),source=object(proof.sourceSnapshot),agreementId=partnershipId(Number(source.agreementId));
  const prior=claims.get(activityId)??{amount:0n,net:0n,financialId:0,agreementId};
  if(prior.agreementId!==agreementId)conflict("اتفاق استحقاق النقل تغير داخل الإغلاق");
  if(reverse)prior.net-=amount;
  else{if(prior.financialId)conflict("مصدر استحقاق داخلي مكرر");prior.amount=amount;prior.financialId=partnershipId(Number(financial.id));prior.net+=amount;}
  claims.set(activityId,prior);
 }
 const internal=String(input.snapshot.calculation.summary.internalIncome);
 if(internal.startsWith("-")||[...claims.values()].some(claim=>claim.net<0n||claim.net!==0n&&claim.net!==claim.amount)||[...claims.values()].reduce((sum,claim)=>sum+claim.net,0n)!==parseMoney(internal))conflict("عكس أو رصيد النقل الداخلي يتطلب تصحيح فترة معتمداً");
 const affected:number[]=[];
 for(const [activityId,claim] of [...claims.entries()].sort(([a],[b])=>a-b)){
  if(claim.net===0n)continue;if(input.financialId==null)conflict("تحويل الاستحقاق يتطلب قيد إغلاق مالي فعلي");
  const rights=partnershipRows(await tx.execute(sql`/* vp_month_internal_right */ SELECT id,partnership_id,agreement_id,activity_id,amount::text,status,financial_transaction_id FROM vehicle_partnership_rights WHERE partnership_id=${input.root.id} AND activity_id=${activityId} AND category='internal_entitlement' ORDER BY id FOR UPDATE`));
  if(rights.length!==1||rights[0].status!=="approved"||Number(rights[0].partnership_id)!==input.root.id||Number(rights[0].activity_id)!==activityId||Number(rights[0].agreement_id)!==claim.agreementId||Number(rights[0].financial_transaction_id)!==claim.financialId||parseMoney(String(rights[0].amount))!==claim.amount)conflict("إثبات استحقاق النقل الأصلي لا يطابق مصدر الشهر");
  const rightId=partnershipId(Number(rights[0].id)),key=`vp:closing:${Number(input.row.id)}:r${Number(input.row.revision)}:convert:${rightId}`;
  const existing=partnershipRows(await tx.execute(sql`/* vp_month_conversion_replay */ SELECT id,right_id,financial_transaction_id,amount::text,idempotency_key,purpose,conversion_allocation_id FROM vehicle_partnership_settlement_allocations WHERE right_id=${rightId} AND financial_transaction_id=${input.financialId} ORDER BY id`));
  const before=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  if(!before||before.approvalStatus!=="approved"||parseMoney(before.totalAmount)!==claim.amount||!verifyOnly&&parseMoney(before.approvedPaidAmount)!==0n)conflict("استحقاق النقل مستخدم أو غير معتمد للتحويل");
  if(existing.length){
   const prior=existing[0];if(existing.length!==1||Number(prior.right_id)!==rightId||Number(prior.financial_transaction_id)!==input.financialId||parseMoney(String(prior.amount))!==claim.net||prior.idempotency_key!==key||prior.purpose!=="internal_conversion"||prior.conversion_allocation_id!=null)conflict("تحويل الاستحقاق مكرر أو لا يطابق المصدر");
  }else{
   if(verifyOnly)conflict("تحويل الإغلاق المعتمد غير موجود؛ لا يمكن إصلاحه بصرف أو قيد مكرر");
   if(parseMoney(before.availableAmount)<claim.net)conflict("استحقاق النقل عليه حجز أو تسوية أخرى؛ لا يمكن استخدامه مرتين");
   const inserted=partnershipRows(await tx.execute(sql`/* vp_month_conversion_insert */ INSERT INTO vehicle_partnership_settlement_allocations (right_id,financial_transaction_id,amount,idempotency_key,purpose,created_by,reason) VALUES (${rightId},${input.financialId},${formatMoney(claim.net)},${key},'internal_conversion',${actor.id},${String(input.row.reason)}) RETURNING id`));
   if(inserted.length!==1)throw new Error("Monthly conversion reservation was not confirmed");
  }
  const after=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  const converted=after&&(verifyOnly?after.conversionAmount:after.pendingConversionAmount);
  if(!after||converted==null||parseMoney(converted)!==claim.net||!verifyOnly&&parseMoney(after.approvedPaidAmount)!==0n)conflict("تحويل الإغلاق لا يطابق الحجز غير النقدي الأصلي");affected.push(rightId);
 }
 if(input.financialId!=null){const all=partnershipRows(await tx.execute(sql`/* vp_month_converted_rights */ SELECT right_id FROM vehicle_partnership_settlement_allocations WHERE financial_transaction_id=${input.financialId} AND purpose='internal_conversion' ORDER BY right_id LIMIT 2001`));if(all.length!==affected.length||new Set(all.map(row=>Number(row.right_id))).size!==affected.length||all.some(row=>!affected.includes(Number(row.right_id))))conflict("تحويلات الإغلاق تتضمن استحقاقاً خارج مصادر الشهر");}
 return affected;
}
/** Rights are created from frozen revision lines after central approval only.
 * Profit/capital/advances remain distinct; no payable is produced per trip. */
export async function approveClosingRights(tx:PartnershipExecutor,actor:PartnershipActor,input:ClosingRightsContext):Promise<number[]>{
 authorizePartnership(actor,true);context(input);if(input.row.status!=="approved")conflict("يجب اعتماد الإغلاق قبل إثبات حقوق الشركاء");
 const expected=new Map<string,{category:string;kind:string;agreementId:number;memberId:number;amount:string;proof:Row}>();
 for(const [kind,category,items] of [["profit_allocation","profit",input.snapshot.calculation.profitAllocations],["loss_allocation","loss",input.snapshot.calculation.lossAllocations],["loss_recovery","loss_recovery",input.snapshot.calculation.lossRecoveries]] as const){
  for(const [index,item] of items.entries())if(parseMoney(item.amount)>0n)expected.set(`${kind}:${index}:${item.agreementId}:${item.memberId}`,{category,kind,agreementId:item.agreementId,memberId:item.memberId,amount:item.amount,proof:item as unknown as Row});
 }
 if(input.financialId==null&&expected.size)conflict("الحقوق الموجبة تتطلب قيداً مالياً معتمداً");
 const rows=partnershipRows(await tx.execute(sql`/* vp_month_allocation_lines */ SELECT id,source_key,line_kind,agreement_id,member_id,amount::text,snapshot FROM vehicle_partnership_closing_lines WHERE closing_id=${Number(input.row.id)} AND revision=${Number(input.row.revision)} AND line_kind IN ('profit_allocation','loss_allocation','loss_recovery') ORDER BY id LIMIT 501`));
 if(rows.length!==expected.size||rows.length>500)conflict("سطور توزيع الشهر ناقصة أو مكررة");
 const existing=partnershipRows(await tx.execute(sql`/* vp_month_rights_proof */ SELECT r.*,r.amount::text FROM vehicle_partnership_rights r JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE l.closing_id=${Number(input.row.id)} AND l.revision=${Number(input.row.revision)} ORDER BY r.id LIMIT 501`));
 if(existing.length>rows.length)conflict("حقوق شهرية مكررة");const seen=new Set<number>(),result:number[]=[];
 for(const row of rows){
  const value=expected.get(String(row.source_key)),lineId=partnershipId(Number(row.id));
  if(!value||row.line_kind!==value.kind||Number(row.agreement_id)!==value.agreementId||Number(row.member_id)!==value.memberId||parseMoney(String(row.amount))!==parseMoney(value.amount)||canonicalPartnershipJson(row.snapshot)!==canonicalPartnershipJson(value.proof))conflict("سطر توزيع الشريك لا يطابق النتيجة المعتمدة");
  expected.delete(String(row.source_key));const eventKey=`vp:closing:${Number(input.row.id)}:r${Number(input.row.revision)}:${value.category}:${lineId}`;
  let lossRightId:number|undefined;
  if(value.category==="loss_recovery"){
   const lossKey=String(value.proof.lossKey);if(!/^right:[1-9]\d*$/.test(lossKey))conflict("الخسارة الافتتاحية تحتاج مصدراً معتمداً مستقلاً");lossRightId=partnershipId(Number(lossKey.slice(6)));
   const originals=partnershipRows(await tx.execute(sql`/* vp_month_recovered_loss */ SELECT id,partnership_id,agreement_id,member_id,amount::text,category,status FROM vehicle_partnership_rights WHERE id=${lossRightId} FOR UPDATE`));
   const claim=input.snapshot.lossClaims.find(item=>item.key===lossKey);
   if(originals.length!==1||originals[0].category!=="loss"||originals[0].status!=="approved"||Number(originals[0].partnership_id)!==input.root.id||Number(originals[0].agreement_id)!==value.agreementId||Number(originals[0].member_id)!==value.memberId||!claim||parseMoney(claim.remaining)<parseMoney(value.amount))conflict("استرداد الخسارة لا يعود لرصيد الطرف الأصلي المعتمد");
  }
  const proof={...value.proof,closingId:Number(input.row.id),revision:Number(input.row.revision),sourceDigest:String(input.row.source_digest),...(lossRightId?{lossRightId}:{})};
  const prior=existing.filter(item=>Number(item.closing_line_id)===lineId);let right:Row;
  if(prior.length){
   right=prior[0];if(prior.length!==1||Number(right.partnership_id)!==input.root.id||Number(right.agreement_id)!==value.agreementId||Number(right.member_id)!==value.memberId||parseMoney(String(right.amount))!==parseMoney(value.amount)||right.category!==value.category||right.direction!==(value.category==="loss"?"debit":"credit")||right.status!=="approved"||right.event_key!==eventKey||Number(right.financial_transaction_id)!==input.financialId||canonicalPartnershipJson(right.source_snapshot)!==canonicalPartnershipJson(proof))conflict("حق شريك سابق لا يطابق قيد الإغلاق");
   seen.add(Number(right.id));
  }else{
   const inserted=partnershipRows(await tx.execute(sql`/* vp_month_right_insert */ INSERT INTO vehicle_partnership_rights (partnership_id,agreement_id,member_id,closing_line_id,amount,category,direction,event_key,financial_transaction_id,source_snapshot,status,created_by,reason) VALUES (${input.root.id},${value.agreementId},${value.memberId},${lineId},${value.amount},${value.category},${value.category==="loss"?"debit":"credit"},${eventKey},${input.financialId},${JSON.stringify(proof)}::jsonb,'approved',${actor.id},${String(input.row.reason)}) RETURNING *`));
   if(inserted.length!==1)throw new Error("Monthly partner right insert was not confirmed");right=inserted[0];
  }
  const rightId=partnershipId(Number(right.id)),state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  if(!state||state.totalAmount!==value.amount||state.approvalStatus!=="approved")conflict("حالة حق الشريك لا تطابق قيد الإغلاق");result.push(rightId);
 }
 if(existing.some(right=>!seen.has(Number(right.id))))conflict("حق شهري خارج التوزيع المعتمد");
 await reserveClosingConversions(tx,actor,input,true);
 return result;
}

/** Release/re-derive balances after the source FI/header state changes. The
 * old allocations stay immutable history; canonical state decides their effect. */
export async function reconcileClosingAffected(tx:PartnershipExecutor,input:{rootId:number;closingId:number;revision:number;financialId:number}):Promise<number[]>{
 partnershipId(input.rootId);partnershipId(input.closingId);partnershipId(input.revision);partnershipId(input.financialId);
 const rows=partnershipRows(await tx.execute(sql`/* vp_month_affected_rights */ SELECT DISTINCT r.id,r.partnership_id FROM vehicle_partnership_rights r LEFT JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE (l.closing_id=${input.closingId} AND l.revision=${input.revision}) OR EXISTS(SELECT 1 FROM vehicle_partnership_settlement_allocations a WHERE a.right_id=r.id AND a.financial_transaction_id=${input.financialId}) ORDER BY r.id LIMIT 3001`));
 if(rows.length>3000||rows.some(row=>Number(row.partnership_id)!==input.rootId))conflict("سجل تسوية الإغلاق يتجاوز النطاق أو يعود لشراكة أخرى");
 const ids=rows.map(row=>partnershipId(Number(row.id)));if(new Set(ids).size!==ids.length)conflict("مرجع استحقاق مكرر في تسوية الإغلاق");
 for(const sourceId of ids){const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId});if(!state)conflict("حالة استحقاق الإغلاق غير متاحة للمصالحة");}return ids;
}
