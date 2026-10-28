import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor} from "./agreements";
import {prepareDistributionExecution} from "./distributions";
import {prepareAdvancePaymentExecution} from "./advance-payments";
import {prepareDriverPaymentExecution} from "./driver-payments";
import {readSavedDriverCoverage,proveDriverCoverageMapping} from "./driver-coverage-proof";
import {proveDriverCashCoverageSource} from "./driver-cash-source";
import {lockClosingContext,verifySubmittedClosing} from "./closing-lifecycle";
import {proveClosingJournal} from "./closing-posting";
import {appendPartnershipAudit,lockPartnership,partnershipRows,type PartnershipExecutor} from "./repository";
import {cashReversalProof,provePartnershipCashReversalHistory,type Proof,type CashType,type PartnershipCashReversalPlan} from "./cash-reversal-proof";
export {provePartnershipCashReversalHistory} from "./cash-reversal-proof";
export type {PartnershipCashReversalPlan} from "./cash-reversal-proof";

type Row=Record<string,unknown>;
const {rules,hash,checkedProof,plan,original,request,allocations,children,saved,proveImmutable,provePosted,object,one,conflict,snapshot,signed,commandFingerprint,operationKey}=cashReversalProof;
/** Source admission only. The original MASTER function is the sole cash/FI writer. */
export async function preparePartnershipCashReversal(tx:PartnershipExecutor,initial:{id:number;sourceType:string|null;sourceId:string|null;transactionType:string},actor:PartnershipActor,reason:string,options:unknown={}):Promise<PartnershipCashReversalPlan>{
 authorizePartnership(actor,true);partnershipId(initial.id);const parsed=z.object({idempotencyKey:z.string().trim().min(8).max(180).optional()}).strict().safeParse(options);
 if(!parsed.success||typeof reason!=="string"||reason.trim().length<3||reason.trim().length>2000)throw new PartnershipValidationError("العكس الكامل فقط؛ اكتب السبب ولا تغيّر مبلغ الصرف أو مصدره");
 if(!Object.hasOwn(rules,initial.transactionType)||rules[initial.transactionType as CashType].source!==initial.sourceType||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))conflict("الحركة ليست صرف شراكة أصلياً قابلاً للعكس");
 const audit=await request(tx,initial.id),vehicleId=partnershipId(Number(audit.vehicleId)),root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId);
 if(Number(audit.partnershipId)!==root.id)conflict("طلب الصرف لا يخص شراكة المركبة");
 const nonce=parsed.data.idempotencyKey??`full-original:${initial.id}`,why=reason.trim(),prior=await saved(tx,initial.id);
 if(prior){const history=await provePartnershipCashReversalHistory(tx,initial.id),p=history.proof;if(p.fingerprint!==commandFingerprint({...p,actorId:actor.id,reason:why,nonce})||p.sourceType!==initial.sourceType||p.sourceId!==initial.sourceId||p.transactionType!==initial.transactionType)conflict("سبق عكس السند بطلب مختلف؛ راجع العكس الأصلي");return history;}
 let driverMapping=initial.sourceType==="vehicle_partnership_driver"?await readSavedDriverCoverage(tx,root,initial.id):null;
 // A mapped driver's original month/bookings must precede fleet/cost locks.
 if(driverMapping){const context=await lockClosingContext(tx,actor,driverMapping.closingId);if(context.root.id!==root.id||Number(context.row.revision)!==driverMapping.revision||!["approved","distributed"].includes(String(context.row.status)))conflict("شهر تغطية السائق لا يطابق نسخته الأصلية");const verified=await verifySubmittedClosing(tx,actor,context,false);await proveClosingJournal(tx,driverMapping.closingFinancialId,verified.journal);}
 const prepare=initial.sourceType==="vehicle_partnership_driver"?prepareDriverPaymentExecution:initial.transactionType==="vp_partner_advance_repayment"?prepareAdvancePaymentExecution:prepareDistributionExecution;
 const live=await prepare(tx,initial,actor),row=await original(tx,initial.id,true),value=snapshot(row),rule=rules[initial.transactionType as CashType];
 if(!live.alreadyExecuted||live.financialId!==initial.id||live.context.root.id!==root.id||value.sourceType!==initial.sourceType||value.sourceId!==initial.sourceId||value.transactionType!==initial.transactionType||value.sourceEvent!==rule.event||value.direction!=="expense"||value.amount!==live.amount||parseMoney(live.amount)<=0n||signed(value.balanceBefore)-signed(value.balanceAfter)!==parseMoney(live.amount)||row.reversed_transaction_id!=null||row.reversal_txn_id!=null||row.reversed_at!=null||(await children(tx,initial.id)).length)conflict("الصرف غير منفذ أو سبق عكسه أو لا يطابق مصدره المعتمد");
 const proposal=object(live.proposal),command=object(proposal.command),allocationSnapshot=await allocations(tx,initial.id,root.id);
 if(audit.sourceDigest!==hash(proposal)||hash(audit.sourceSnapshot)!==hash(proposal))conflict("طلب الصرف الأصلي لا يطابق مصدره المجمد");
 if(initial.sourceType==="vehicle_partnership_driver"){
  if(driverMapping){const source=await proveDriverCashCoverageSource(tx,root,initial.id);await proveDriverCoverageMapping(tx,root,source,allocationSnapshot.map(a=>({allocation_id:a.id,right_id:a.rightId,financial_transaction_id:a.financialId,conversion_allocation_id:a.parentId,purpose:a.purpose,allocated_amount:a.amount,idempotency_key:a.key})));}
  else if(allocationSnapshot.length)conflict("صرف السائق عليه تغطية بلا إثبات ربط");
 }
 const closing="row" in live.context?{id:partnershipId(Number(live.context.row.id)),revision:partnershipId(Number(live.context.row.revision))}:driverMapping?{id:driverMapping.closingId,revision:driverMapping.revision}:null;
 const proof=checkedProof({formatVersion:1,originalId:initial.id,vehicleId,partnershipId:root.id,actorId:actor.id,nonce,reason:why,key:operationKey(initial.id,nonce),fingerprint:commandFingerprint({originalId:initial.id,actorId:actor.id,nonce,reason:why,sourceType:initial.sourceType as Proof["sourceType"],sourceId:value.sourceId,transactionType:initial.transactionType as CashType}),amount:live.amount,sourceType:initial.sourceType,sourceId:initial.sourceId,transactionType:initial.transactionType,counterCode:rule.counter,original:value,requestDigest:hash(proposal),allocations:allocationSnapshot,driverMappingDigest:driverMapping?hash(driverMapping):null,primaryRightId:initial.sourceType==="vehicle_partnership_driver"?null:Number(initial.sourceId),driverEntryId:initial.sourceType==="vehicle_partnership_driver"?partnershipId(Number(command.entryId)):null,closing});
 await proveImmutable(tx,proof);
 for(const rightId of [...new Set(allocationSnapshot.map(a=>a.rightId))].sort((a,b)=>a-b)){if(!await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId}))conflict("رصيد استحقاق تغطية الصرف غير متاح");}
 return plan(proof);
}
/** Called only after the same original MASTER transaction wrote the cash-in,
 * typed reverse FI, opposite journal and original link. No cash writer here. */
export async function finishPartnershipCashReversal(tx:PartnershipExecutor,input:PartnershipCashReversalPlan,reverseId:number,actor:PartnershipActor){
 authorizePartnership(actor,true);partnershipId(reverseId);const p=checkedProof(input.proof);
 if(input.alreadyReversed||input.proofDigest!==hash(p)||p.actorId!==actor.id||input.originalId!==p.originalId||input.amount!==p.amount)conflict("تأكيد العكس لا يطابق اقتراحه الأصلي");
 if(await saved(tx,p.originalId))conflict("تأكيد عكس الصرف مكرر");await provePosted(tx,p,reverseId);
 let closingStatusChange:Row|null=null;
 const recordProof=()=>appendPartnershipAudit(tx,{vehicleId:p.vehicleId,partnershipId:p.partnershipId,actor,action:"cash_reversed",reason:p.reason,financialTransactionId:p.originalId,newValues:{proof:p,proofDigest:hash(p),reverseId,closingStatusChange,cashImpact:"in",newExpense:false}});
 // Full driver coverage is read through this immutable proof by canonical
 // reconciliation. Publish it inside the SAME transaction before that read;
 // a later reconciliation/callback failure rolls back proof, cash and journal.
 if(p.transactionType==="vp_driver_payment")await recordProof();
 const rights=[...new Set(p.allocations.map(a=>partnershipId(Number(a.rightId))))].sort((a,b)=>a-b);
 if(p.driverEntryId!=null&&!await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:p.driverEntryId}))conflict("تعذر مصالحة أجرة السائق بعد العكس");
 for(const sourceId of rights)if(!await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId}))conflict("تعذر مصالحة استحقاق الشراكة بعد العكس");
 if(p.transactionType==="vp_partner_distribution"){
  const month=one(partnershipRows(await tx.execute(sql`/* vp_cash_reverse_month */ SELECT id,partnership_id,status,revision,version FROM vehicle_partnership_closings WHERE id=${p.closing!.id} FOR UPDATE`)),"شهر حصة الشريك غير موجود");
  if(Number(month.partnership_id)!==p.partnershipId||Number(month.revision)!==p.closing!.revision||!["approved","distributed"].includes(String(month.status)))conflict("نسخة شهر توزيع الحصة تغيرت أثناء العكس");
  const rows=partnershipRows(await tx.execute(sql`/* vp_cash_reverse_profit_rights */ SELECT r.id FROM vehicle_partnership_rights r JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE r.partnership_id=${p.partnershipId} AND l.closing_id=${p.closing!.id} AND l.revision=${p.closing!.revision} AND r.category='profit' AND r.status='approved' ORDER BY r.id LIMIT 501`));
  if(!rows.length||rows.length>500)conflict("حقوق أرباح الشهر غير مكتملة");let complete=true;
  for(const right of rows){const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:partnershipId(Number(right.id))});if(!state)conflict("رصيد حصة الشهر غير متاح");if(parseMoney(state.remainingAmount)!==0n||parseMoney(state.reservedAmount)!==0n)complete=false;}
  if(!complete&&month.status==="distributed"){const changed=partnershipRows(await tx.execute(sql`/* vp_cash_reverse_undistributed */ UPDATE vehicle_partnership_closings SET status='approved',version=version+1 WHERE id=${p.closing!.id} AND version=${Number(month.version)} AND status='distributed' RETURNING id`));if(changed.length!==1)conflict("حساب الشهر تغير أثناء استعادة حالة التوزيع");closingStatusChange={closingId:p.closing!.id,from:"distributed",to:"approved",previousVersion:Number(month.version),version:Number(month.version)+1};}
 }
 if(p.transactionType!=="vp_driver_payment")await recordProof();
 await provePartnershipCashReversalHistory(tx,p.originalId);
}
