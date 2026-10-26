import {createHash,randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import {lockPartnershipActivityContext,preparePartnershipFinancialRequest} from "./accounting";
import {resolvePartnershipFinancialEffect} from "./financial-classification";
import {partnershipAccount as account,provePartnershipJournal as journalProof} from "./journal";
import {executePartnershipCostFinancialTransaction,partnershipCostPostingType,provePartnershipCostRight} from "./cost-posting";
import {lockPartnershipCostContext} from "./costing";
import {lockPartnershipCapitalContext} from "./capital";
import {executePartnershipCapitalFinancialTransaction} from "./capital-posting";
import {transitionDriverAccrual} from "./driver-posting";
import {executeClosingFinancialTransaction,rejectClosingFinancialTransaction} from "./closing-posting";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type FinancialIdentity={id:number;sourceType:string|null;sourceId:string|null};
type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
async function internalRightProof(tx:PartnershipExecutor,activity:Row,financialId:number,status="approved"):Promise<number>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_activity_right_proof */ SELECT id,partnership_id,agreement_id,activity_id,amount::text,status,financial_transaction_id FROM vehicle_partnership_rights WHERE activity_id=${Number(activity.id)} AND category='internal_entitlement'`));
 if(rows.length!==1||Number(rows[0].partnership_id)!==Number(activity.partnership_id)||Number(rows[0].agreement_id)!==Number(activity.agreement_id)||Number(rows[0].financial_transaction_id)!==financialId||rows[0].status!==status||parseMoney(String(rows[0].amount))!==parseMoney(String(activity.amount)))conflict("إثبات استحقاق النقل الداخلي غير مكتمل");
 return partnershipId(Number(rows[0].id));
}
/** Invoked ONLY by the existing central financial approval transaction. New
 * source kinds fail closed until their own source-specific resolver exists.
 * Internal approval is an obligation, never cash or customer sales. */
export async function executePartnershipFinancialTransaction(tx:PartnershipExecutor,initial:FinancialIdentity,actor:PartnershipActor,note?:string|null):Promise<{id:number;rightId?:number}>{
 authorizePartnership(actor,true);
 if(initial.sourceType==="vehicle_partnership_closing")return executeClosingFinancialTransaction(tx,initial,actor,note);
 if(initial.sourceType==="vehicle_partnership_cost")return executePartnershipCostFinancialTransaction(tx,initial,actor,note);
 if(initial.sourceType==="vehicle_partnership_right")return executePartnershipCapitalFinancialTransaction(tx,initial,actor,note);
 if(initial.sourceType!=="vehicle_partnership_activity")conflict("مصدر الشراكة المالية غير مدعوم للاعتماد");
 const financialId=partnershipId(initial.id);
 if(!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مرجع مصدر النقل غير صالح");
 const activityId=partnershipId(Number(initial.sourceId));
 if(note!=null&&(typeof note!=="string"||note.trim().length>2000))throw new PartnershipValidationError("ملاحظة الاعتماد غير صالحة");
 const {root,row:activity}=await lockPartnershipActivityContext(tx,actor,activityId);
 if(Number(activity.financial_transaction_id)!==financialId)conflict("طلب النقل مرتبط بمرجع مالي مختلف");
 // Pending source validation happens before the financial row lock. All source
 // writers use this same root/original/source ordering.
 const pending=activity.status==="pending"?await preparePartnershipFinancialRequest(tx,{sourceType:"vehicle_partnership_activity",sourceId:activityId},actor):null;
 const rows=partnershipRows(await tx.execute(sql`/* vp_financial_locked */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,notes FROM financial_transactions WHERE id=${financialId} FOR UPDATE`));
 if(rows.length!==1)throw new PartnershipRepositoryError("الطلب المالي غير موجود",404,"NOT_FOUND");
 const financial=rows[0],amount=formatMoney(parseMoney(String(activity.amount)));
 const effect=resolvePartnershipFinancialEffect({sourceType:String(financial.source_type),transactionType:String(financial.transaction_type),sourceEvent:String(financial.source_event),direction:String(financial.direction)});
 if(!effect||effect.cash!=="none"||effect.operating!=="none"||effect.reversal||Number(financial.id)!==financialId||financial.source_type!==initial.sourceType||String(financial.source_id)!==String(activityId)||parseMoney(String(financial.amount))!==parseMoney(amount)||financial.transaction_date!==String(activity.recognition_date)||financial.balance_before!=null||financial.balance_after!=null)conflict("مبلغ أو هوية الطلب المالي لا يطابق مصدر النقل غير النقدي");
 const expectedType=activity.income_basis==="internal"?"vp_internal_entitlement":"vp_external_attribution";
 if(financial.transaction_type!==expectedType)conflict("نوع الطلب المالي لا يطابق أساس أجرة النقل");
 if(financial.approval_status==="executed"){
  if(activity.status!=="approved")conflict("حالة مصدر النقل لا تطابق القيد المنفذ");
  const snapshot=activity.source_snapshot;
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))conflict("إثبات المصدر المعتمد غير مكتمل");
  const digest=createHash("sha256").update(canonicalPartnershipJson({snapshot,amount,incomeBasis:activity.income_basis,recognitionDate:String(activity.recognition_date),reason:activity.reason})).digest("hex");
  if(digest!==activity.source_digest)conflict("بيانات المصدر المعتمد لا تطابق بصمته المحفوظة");
  await journalProof(tx,financialId,amount,effect.debit,effect.credit);
  if(activity.income_basis==="internal"){
   const rightId=await internalRightProof(tx,activity,financialId);
   await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
   return {id:financialId,rightId};
  }
  return {id:financialId};
 }
 if(financial.approval_status!=="pending"||!pending||pending.linkedFinancialTransactionId!==financialId||pending.transactionType!==financial.transaction_type||pending.direction!==financial.direction||pending.sourceEvent!==financial.source_event)conflict("يمكن اعتماد طلب النقل المعلّق المطابق لمصدره فقط");
 if(parseMoney(amount)>0n){
  const ids=new Map<string,number>();for(const code of [effect.debit,effect.credit].sort())ids.set(code,await account(tx,code));
  const inserted=partnershipRows(await tx.execute(sql`INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${financialId},${ids.get(effect.debit)!},'debit',${amount},${pending.description}),(${financialId},${ids.get(effect.credit)!},'credit',${amount},${pending.description}) RETURNING id`));
  if(inserted.length!==2)throw new Error("Partnership balanced journal insert was not confirmed");
 }
 const notes=[financial.notes,note?.trim()].filter(value=>typeof value==="string"&&value.trim()).join("\n")||null;
 const executed=partnershipRows(await tx.execute(sql`UPDATE financial_transactions SET approval_status='executed',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),executed_by=${actor.id},executed_by_name=${actor.name},executed_at=now(),balance_before=NULL,balance_after=NULL,notes=${notes},updated_at=now() WHERE id=${financialId} AND approval_status='pending' RETURNING id`));
 if(executed.length!==1||Number(executed[0].id)!==financialId)conflict("تغيرت حالة طلب النقل أثناء الاعتماد");
 const source=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_activity SET status='approved' WHERE id=${activityId} AND financial_transaction_id=${financialId} AND status='pending' RETURNING id`));
 if(source.length!==1||Number(source[0].id)!==activityId)conflict("تعذر تأكيد اعتماد مصدر النقل");
 let rightId:number|undefined;
 if(activity.income_basis==="internal"){
  const rights=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_rights (partnership_id,agreement_id,activity_id,amount,category,direction,status,event_key,financial_transaction_id,created_by,reason) VALUES (${root.id},${Number(activity.agreement_id)},${activityId},${amount},'internal_entitlement','credit','approved',${`vp:internal-entitlement:${activityId}`},${financialId},${actor.id},${note?.trim()||String(activity.reason)}) RETURNING id`));
  if(rights.length!==1)throw new Error("Partnership entitlement insert was not confirmed");rightId=partnershipId(Number(rights[0].id));
  const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  if(!payment||parseMoney(payment.approvedPaidAmount)!==0n)conflict("إنشاء الاستحقاق لا يمثل صرفاً نقدياً");
 }
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"financial_approved",reason:note?.trim()||String(activity.reason),financialTransactionId:financialId,oldValues:{status:"pending"},newValues:{activityId,status:"executed",amount,cashImpact:"none",...(rightId?{rightId}:{})}});
 return {id:financialId,...(rightId?{rightId}:{})};
}

function activityIdFor(initial:FinancialIdentity):number{
 if(initial.sourceType!=="vehicle_partnership_activity"&&initial.sourceType!=="vehicle_partnership_cost"&&initial.sourceType!=="vehicle_partnership_right")conflict("مصدر الشراكة المالية غير مدعوم لهذه العملية");
 partnershipId(initial.id);
 if(!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مرجع مصدر النقل غير صالح");
 return partnershipId(Number(initial.sourceId));
}
async function financialLock(tx:PartnershipExecutor,id:number):Promise<Row>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_financial_locked */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,department,notes,reversed_at,reversal_txn_id,reversed_transaction_id FROM financial_transactions WHERE id=${id} FOR UPDATE`));
 if(rows.length!==1)throw new PartnershipRepositoryError("الطلب المالي غير موجود",404,"NOT_FOUND");return rows[0];
}
function validateLinkedIdentity(activity:Row,financial:Row,initial:FinancialIdentity):void{
 if(Number(activity.financial_transaction_id)!==initial.id||Number(financial.id)!==initial.id||financial.source_type!==initial.sourceType||String(financial.source_id)!==String(activity.id))conflict("مصدر النقل لا يطابق مرجع الطلب المالي");
}
function cleanReason(value:string):string{
 if(typeof value!=="string"||value.trim().length<3||value.trim().length>2000)throw new PartnershipValidationError("سبب واضح للعملية مطلوب");return value.trim();
}
export async function rejectPartnershipFinancialTransaction(tx:PartnershipExecutor,initial:FinancialIdentity,actor:PartnershipActor,reason:string,mode:"reject"|"cancel"="reject"):Promise<{id:number}>{
 if(initial.sourceType==="vehicle_partnership_closing")return rejectClosingFinancialTransaction(tx,initial,actor,reason,mode);
 authorizePartnership(actor,mode==="reject");const activityId=activityIdFor(initial),why=cleanReason(reason);
 const isCost=initial.sourceType==="vehicle_partnership_cost";
 const isCapital=initial.sourceType==="vehicle_partnership_right";
 const {root,row:activity}=isCapital?await lockPartnershipCapitalContext(tx,actor,activityId):isCost?await lockPartnershipCostContext(tx,actor,activityId):await lockPartnershipActivityContext(tx,actor,activityId),financial=await financialLock(tx,initial.id);
 validateLinkedIdentity(activity,financial,initial);
 if(financial.approval_status==="rejected"&&["rejected","cancelled"].includes(String(activity.status)))return {id:initial.id};
 if(financial.approval_status!=="pending"||activity.status!=="pending")conflict("يمكن رفض أو إلغاء طلب النقل المعلّق فقط");
 const rejected=partnershipRows(await tx.execute(sql`UPDATE financial_transactions SET approval_status='rejected',rejected_by=${actor.id},rejected_by_name=${actor.name},rejected_at=now(),rejection_reason=${why},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));
 if(rejected.length!==1||Number(rejected[0].id)!==initial.id)conflict("تغير طلب النقل أثناء الرفض");
 const source=partnershipRows(await tx.execute(isCapital?sql`UPDATE vehicle_partnership_rights SET status='cancelled' WHERE id=${activityId} AND financial_transaction_id=${initial.id} AND status='pending' RETURNING id`:isCost?sql`UPDATE vehicle_partnership_cost_funding SET status='rejected' WHERE id=${activityId} AND financial_transaction_id=${initial.id} AND status='pending' RETURNING id`:sql`/* vp_activity_rejected */ UPDATE vehicle_partnership_activity SET status=${mode==="cancel"?"cancelled":"rejected"} WHERE id=${activityId} AND financial_transaction_id=${initial.id} AND status='pending' RETURNING id`));
 if(source.length!==1||Number(source[0].id)!==activityId)conflict("تعذر تأكيد رفض مصدر النقل");
 if(isCost&&activity.funding_kind==="other"&&activity.employee_finance_entry_id!=null)await transitionDriverAccrual(tx,activity,"rejected",actor,why);
 if(isCapital)await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:activityId});
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:mode==="cancel"?"financial_cancelled":"financial_rejected",reason:why,financialTransactionId:initial.id,oldValues:{status:"pending"},newValues:{activityId,status:"rejected",cashImpact:"none"}});
 return {id:initial.id};
}
export type PartnershipReversalOptions={amount?:number;idempotencyKey?:string;sourceType?:string;sourceId?:string|number;sourceEvent?:string;description?:string};
/** Full reversal of an unused non-cash source. Used/closed obligations require
 * an approved correction, never a fake cash refund or historical overwrite. */
export async function reversePartnershipFinancialTransaction(tx:PartnershipExecutor,initial:FinancialIdentity,actor:PartnershipActor,reason:string,options:PartnershipReversalOptions,numberFinancial:(id:number)=>string):Promise<{originalId:number;reverseId:number;alreadyReversed:boolean}>{
 authorizePartnership(actor,true);const activityId=activityIdFor(initial),why=cleanReason(reason);
 if(options.sourceType!=null&&options.sourceType!==initial.sourceType||options.sourceId!=null&&String(options.sourceId)!==String(initial.sourceId)||options.sourceEvent!=null&&options.sourceEvent!=="reversal")conflict("لا يمكن تغيير مصدر عكس استحقاق النقل");
 const isCost=initial.sourceType==="vehicle_partnership_cost";
 const isCapital=initial.sourceType==="vehicle_partnership_right";
 const context=isCapital?await lockPartnershipCapitalContext(tx,actor,activityId):isCost?await lockPartnershipCostContext(tx,actor,activityId):await lockPartnershipActivityContext(tx,actor,activityId);
 const {root,row:activity}=context,financial=await financialLock(tx,initial.id);
 const isDriver=isCost&&activity.funding_kind==="other"&&activity.employee_finance_entry_id!=null;
 validateLinkedIdentity(activity,financial,initial);
 const amount=formatMoney(parseMoney(String(financial.amount)));
 if(financial.approval_status!=="executed"||financial.balance_before!=null||financial.balance_after!=null||!isCost&&parseMoney(amount)!==parseMoney(String(activity.amount)))conflict("يمكن عكس القيد غير النقدي المنفذ المطابق للمصدر فقط");
 if(options.amount!=null&&parseMoney(String(options.amount))!==parseMoney(amount))conflict("العكس الجزئي لاستحقاق النقل غير مدعوم؛ استخدم تصحيحاً معتمداً");
 const effect=resolvePartnershipFinancialEffect({sourceType:String(financial.source_type),transactionType:String(financial.transaction_type),sourceEvent:String(financial.source_event),direction:String(financial.direction)});
 if(!effect||effect.cash!=="none"||!isCost&&effect.operating!=="none"||effect.reversal||isCost&&financial.transaction_type!==partnershipCostPostingType(activity)||isCapital&&financial.transaction_type!=="vp_capital_record")conflict("القيد ليس مصدر شراكة أصلياً غير نقدي");
 const prior=partnershipRows(await tx.execute(sql`/* vp_financial_reversal_replay */ SELECT id,source_type,source_id,source_event,transaction_type,direction,amount::text,reversed_transaction_id FROM financial_transactions WHERE reversed_transaction_id=${initial.id} AND approval_status='executed' ORDER BY id LIMIT 2`));
 if(prior.length){
  const r=prior[0];
  if(prior.length!==1||activity.status!=="reversed"||Number(financial.reversal_txn_id)!==Number(r.id)||r.source_type!==initial.sourceType||String(r.source_id)!==String(activityId)||r.transaction_type!==`${String(financial.transaction_type)}_reversal`||r.source_event!=="reversal"||r.direction===financial.direction||parseMoney(String(r.amount))!==parseMoney(amount)||Number(r.reversed_transaction_id)!==initial.id)conflict("سجل العكس السابق غير مطابق للمصدر");
  await journalProof(tx,Number(r.id),amount,effect.credit,effect.debit);
  if(isDriver)await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:Number(activity.employee_finance_entry_id)});
  else if(isCost)await provePartnershipCostRight(tx,activity,initial.id,amount,"reversed");
  else if(isCapital)await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:activityId});
  else if(activity.income_basis==="internal")await internalRightProof(tx,activity,initial.id,"reversed");
  return {originalId:initial.id,reverseId:partnershipId(Number(r.id)),alreadyReversed:true};
 }
 if(financial.reversed_at!=null||financial.reversal_txn_id!=null||activity.status!=="approved")conflict("حالة الاستحقاق لا تسمح بعكس جديد");
 const originalKey="original" in context?`${context.original.source}:${context.original.sourceId}:transportation`:isCapital?`capital:${activityId}`:`vehicle_expense:${Number(activity.vehicle_expense_id)}`;
 const closed=partnershipRows(await tx.execute(sql`/* vp_activity_closed_guard */ /* vp_cost_closed_guard */ SELECT h.id FROM vehicle_partnership_closing_lines l JOIN vehicle_partnership_closings h ON h.id=l.closing_id WHERE h.partnership_id=${root.id} AND h.status IN ('approved','distributed') AND (l.source_key=${originalKey} OR l.snapshot->>${isCapital?"capitalRightId":isCost?"costFundingId":"activityId"}=${String(activityId)}) LIMIT 1`));
 if(closed.length)conflict("استحقاق النقل ضمن إغلاق معتمد؛ استخدم تصحيح فترة أو إعادة فتح مضبوطة");
 let rightId:number|undefined;
 if(isDriver){
  const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:Number(activity.employee_finance_entry_id)});
  if(parseMoney(payment.approvedPaidAmount)>0n||parseMoney(payment.reservedAmount)>0n)conflict("أجرة السائق عليها صرف منفذ أو معلق؛ لا يمكن عكس استحقاقها");
 }
 else if(isCapital||isCost||activity.income_basis==="internal"){
  rightId=isCapital?activityId:isCost?await provePartnershipCostRight(tx,activity,initial.id,amount):await internalRightProof(tx,activity,initial.id);
  const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  if(parseMoney(payment.approvedPaidAmount)>0n||parseMoney(payment.reservedAmount)>0n)conflict("توجد دفعات منفذة أو طلبات صرف معلقة على الاستحقاق؛ لا يمكن عكسه");
 }
 const originalJournal=await journalProof(tx,initial.id,amount,effect.debit,effect.credit);
 const key=options.idempotencyKey?.trim()||`vp:activity-reversal:${initial.id}`;
 if(key.length<8||key.length>180)throw new PartnershipValidationError("مرجع العكس غير صالح");
 const used=partnershipRows(await tx.execute(sql`/* vp_financial_reversal_key */ SELECT id FROM financial_transactions WHERE idempotency_key=${key}`));
 if(used.length)conflict("مرجع العكس مستخدم لحركة مالية أخرى");
 const description=options.description?.trim()||`عكس استحقاق النقل ${activityId}: ${why}`;
 const reversals=partnershipRows(await tx.execute(sql`INSERT INTO financial_transactions (transaction_no,transaction_date,direction,amount,department,transaction_type,source_type,source_id,source_event,idempotency_key,reversed_transaction_id,reversal_reason,approval_status,payment_method,requested_by,requested_by_name,approved_by,approved_by_name,approved_at,executed_by,executed_by_name,executed_at,balance_before,balance_after,description) VALUES (${`FIN-TMP-${randomUUID()}`},(now() AT TIME ZONE 'Asia/Baghdad')::date,${financial.direction==="expense"?"revenue":"expense"},${amount},${String(financial.department??"transportation")},${`${String(financial.transaction_type)}_reversal`},${initial.sourceType},${String(activityId)},'reversal',${key},${initial.id},${why},'executed','other',${actor.id},${actor.name},${actor.id},${actor.name},now(),${actor.id},${actor.name},now(),NULL,NULL,${description}) RETURNING id`));
 if(reversals.length!==1)throw new Error("Partnership reversal insert was not confirmed");const reverseId=partnershipId(Number(reversals[0].id));
 const numbered=partnershipRows(await tx.execute(sql`/* vp_reversal_number */ UPDATE financial_transactions SET transaction_no=${numberFinancial(reverseId)} WHERE id=${reverseId} RETURNING id`));
 if(numbered.length!==1||Number(numbered[0].id)!==reverseId)throw new Error("Partnership reversal numbering was not confirmed");
 if(originalJournal.length){
  const debit=originalJournal.find(j=>j.entry_side==="credit")!,credit=originalJournal.find(j=>j.entry_side==="debit")!;
  const entries=partnershipRows(await tx.execute(sql`INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${reverseId},${partnershipId(Number(debit.account_id))},'debit',${amount},${description}),(${reverseId},${partnershipId(Number(credit.account_id))},'credit',${amount},${description}) RETURNING id`));
  if(entries.length!==2)throw new Error("Partnership reversal journal insert was not confirmed");
 }
 const header=partnershipRows(await tx.execute(sql`/* vp_financial_reversed */ UPDATE financial_transactions SET reversal_txn_id=${reverseId},reversed_at=now(),reversed_by=${actor.id},reversed_by_name=${actor.name},reversal_reason=${why},updated_at=now() WHERE id=${initial.id} AND reversal_txn_id IS NULL RETURNING id`));
 if(header.length!==1||Number(header[0].id)!==initial.id)conflict("تغيرت حالة العكس أثناء المراجعة");
 const source=partnershipRows(await tx.execute(isCapital?sql`UPDATE vehicle_partnership_rights SET status='reversed' WHERE id=${activityId} AND financial_transaction_id=${initial.id} AND status='approved' RETURNING id`:isCost?sql`UPDATE vehicle_partnership_cost_funding SET status='reversed' WHERE id=${activityId} AND financial_transaction_id=${initial.id} AND status='approved' RETURNING id`:sql`UPDATE vehicle_partnership_activity SET status='reversed' WHERE id=${activityId} AND financial_transaction_id=${initial.id} AND status='approved' RETURNING id`));
 if(source.length!==1||Number(source[0].id)!==activityId)conflict("تعذر تأكيد عكس مصدر النقل");
 if(isDriver)await transitionDriverAccrual(tx,activity,"cancelled",actor,why);
 if(rightId){
  if(!isCapital){
  const rights=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_rights SET status='reversed' WHERE id=${rightId} AND financial_transaction_id=${initial.id} AND status='approved' RETURNING id`));
  if(rights.length!==1||Number(rights[0].id)!==rightId)conflict("تعذر تأكيد عكس الاستحقاق المرتبط");
  }
  await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
 }
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"financial_reversed",reason:why,financialTransactionId:initial.id,oldValues:{status:"executed"},newValues:{activityId,reverseId,amount,cashImpact:"none",status:"reversed"}});
 return {originalId:initial.id,reverseId,alreadyReversed:false};
}
