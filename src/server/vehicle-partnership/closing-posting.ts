import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import {lockClosingContext,verifySubmittedClosing} from "./closing-lifecycle";
import type {ClosingJournal} from "./closing-journal";
import {partnershipAccount} from "./journal";
import {reserveClosingConversions,approveClosingRights,reconcileClosingAffected} from "./closing-rights";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
type Identity={id:number;sourceType:string|null;sourceId:string|null};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function sourceId(initial:Identity){
 partnershipId(initial.id);if(initial.sourceType!=="vehicle_partnership_closing"||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مرجع الإغلاق المالي غير صالح");return partnershipId(Number(initial.sourceId));
}
function reason(value:unknown,min=0){if(typeof value!=="string"||value.trim().length<min||value.trim().length>2000)throw new PartnershipValidationError("سبب العملية أو الملاحظة غير صالح");return value.trim();}
async function financialLock(tx:PartnershipExecutor,initial:Identity){
 const rows=partnershipRows(await tx.execute(sql`/* vp_month_financial_lock */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,notes,reversal_txn_id,reversed_transaction_id,idempotency_key FROM financial_transactions WHERE id=${initial.id} FOR UPDATE`));
 if(!rows.length)throw new PartnershipRepositoryError("طلب الإغلاق المالي غير موجود",404,"NOT_FOUND");if(rows.length!==1)throw new Error("Ambiguous monthly financial identity");
 const row=rows[0];if(Number(row.id)!==initial.id||row.source_type!=="vehicle_partnership_closing"||String(row.source_id)!==initial.sourceId||row.source_event!=="monthly_result"||!["vp_month_profit","vp_month_loss"].includes(String(row.transaction_type))||row.balance_before!=null||row.balance_after!=null||row.reversed_transaction_id!=null)conflict("الطلب المالي لا يعود لإغلاق الشراكة غير النقدي");
 return row;
}
export async function proveClosingJournal(tx:PartnershipExecutor,financialId:number,journal:ClosingJournal){
 const rows=partnershipRows(await tx.execute(sql`/* vp_month_journal_proof */ SELECT j.id,j.account_id,j.entry_side,j.amount::text,a.code FROM financial_ledger_entries j JOIN financial_accounts a ON a.id=j.account_id WHERE j.transaction_id=${financialId} ORDER BY j.id LIMIT 9`));
 const expected=journal.legs.map(leg=>({code:leg.accountCode,side:leg.direction,amount:leg.amount})).sort((a,b)=>`${a.code}:${a.side}`.localeCompare(`${b.code}:${b.side}`));
 const actual=rows.map(row=>({code:String(row.code),side:String(row.entry_side),amount:formatMoney(parseMoney(String(row.amount)))})).sort((a,b)=>`${a.code}:${a.side}`.localeCompare(`${b.code}:${b.side}`));
 if(rows.length!==journal.legs.length||canonicalPartnershipJson(actual)!==canonicalPartnershipJson(expected))conflict("القيد الشهري المنفذ لا يطابق جميع أطراف قيده المعتمد");return rows;
}
/** Runs inside the EXISTING principal financial approval transaction. The
 * amount is a journal nominal, never a cash receipt/payment or extra revenue. */
export async function executeClosingFinancialTransaction(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor,note?:string|null):Promise<{id:number;closingId:number}>{
 authorizePartnership(actor,true);const closingId=sourceId(initial),why=note==null?null:reason(note);
 const context=await lockClosingContext(tx,actor,closingId),{root,row}=context;
 if(Number(row.financial_transaction_id)!==initial.id)conflict("الإغلاق مرتبط بطلب مالي مختلف");
 const {snapshot,journal}=await verifySubmittedClosing(tx,actor,context,row.status==="pending");
 const financial=await financialLock(tx,initial),amount=parseMoney(journal.amount);
 if(amount<=0n||parseMoney(String(financial.amount))!==amount||financial.transaction_type!==journal.transactionType||financial.direction!==(journal.transactionType==="vp_month_profit"?"expense":"revenue")||financial.transaction_date!==snapshot.to||financial.idempotency_key!==`vp:closing:${closingId}:r${Number(row.revision)}`||financial.reversal_txn_id!=null)conflict("مبلغ أو تاريخ أو نسخة الطلب المالي لا يطابق قيد الشهر");
 if(financial.approval_status==="executed"){
  if(!["approved","distributed"].includes(String(row.status)))conflict("حالة الإغلاق لا تطابق القيد المنفذ");
  await proveClosingJournal(tx,initial.id,journal);
  await approveClosingRights(tx,actor,{root,row:{...row,status:"approved"},snapshot,financialId:initial.id});return {id:initial.id,closingId};
 }
 if(financial.approval_status!=="pending"||row.status!=="pending")conflict("يمكن اعتماد الإغلاق المعلق فقط");
 const prior=partnershipRows(await tx.execute(sql`/* vp_month_journal_proof */ SELECT j.id FROM financial_ledger_entries j WHERE j.transaction_id=${initial.id} ORDER BY j.id LIMIT 1`));if(prior.length)conflict("طلب الإغلاق المعلق عليه قيد سابق؛ يلزم المصالحة");
 await reserveClosingConversions(tx,actor,{root,row,snapshot,financialId:initial.id});
 const accountIds=new Map<string,number>();for(const code of [...new Set(journal.legs.map(leg=>leg.accountCode))].sort())accountIds.set(code,await partnershipAccount(tx,code));
 for(const leg of journal.legs){
  const inserted=partnershipRows(await tx.execute(sql`/* vp_month_journal_insert */ INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${initial.id},${accountIds.get(leg.accountCode)!},${leg.direction},${leg.amount},${`إغلاق شراكة المركبة ${root.vehicleId} — ${snapshot.to.slice(0,7)}`}) RETURNING id`));
  if(inserted.length!==1)throw new Error("Monthly balanced journal leg insert was not confirmed");
 }
 const notes=[financial.notes,why].filter(value=>typeof value==="string"&&value.trim()).join("\n")||null;
 const posted=partnershipRows(await tx.execute(sql`/* vp_month_financial_executed */ UPDATE financial_transactions SET approval_status='executed',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),executed_by=${actor.id},executed_by_name=${actor.name},executed_at=now(),balance_before=NULL,balance_after=NULL,notes=${notes},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));
 if(posted.length!==1||Number(posted[0].id)!==initial.id)conflict("حالة الطلب المالي تغيرت أثناء اعتماد الشهر");
 const approved=partnershipRows(await tx.execute(sql`/* vp_month_source_approved */ UPDATE vehicle_partnership_closings SET status='approved',version=version+1,approved_by=${actor.id},approved_at=now() WHERE id=${closingId} AND version=${Number(row.version)} AND status='pending' AND financial_transaction_id=${initial.id} RETURNING *,period::text AS period`));
 if(approved.length!==1||Number(approved[0].id)!==closingId)conflict("نسخة الإغلاق تغيرت أثناء الاعتماد");
 const rights=await approveClosingRights(tx,actor,{root,row:approved[0],snapshot,financialId:initial.id});
 await proveClosingJournal(tx,initial.id,journal);
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"closing_financial_approved",reason:why||String(row.reason),financialTransactionId:initial.id,oldValues:{closingId,revision:Number(row.revision),status:"pending"},newValues:{closingId,revision:Number(row.revision),sourceDigest:String(row.source_digest),amount:journal.amount,status:"approved",rights,cashImpact:"none"}});
 return {id:initial.id,closingId};
}
/** Rejection releases canonical holds but retains submitted revision/FI/lines.
 * A new attempt uses a new revision and a new durable source key. */
export async function rejectClosingFinancialTransaction(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor,value:string,mode:"reject"|"cancel"="reject"):Promise<{id:number}>{
 authorizePartnership(actor,mode==="reject");const closingId=sourceId(initial),why=reason(value,3),context=await lockClosingContext(tx,actor,closingId),{root,row}=context,financial=await financialLock(tx,initial);
 if(financial.approval_status==="rejected")return {id:initial.id};
 if(financial.approval_status!=="pending"||row.status!=="pending"||Number(row.financial_transaction_id)!==initial.id)conflict("يمكن رفض أو إلغاء طلب الإغلاق المعلق المطابق فقط");
 await verifySubmittedClosing(tx,actor,context,false);
 const rejected=partnershipRows(await tx.execute(sql`/* vp_month_financial_rejected */ UPDATE financial_transactions SET approval_status='rejected',rejected_by=${actor.id},rejected_by_name=${actor.name},rejected_at=now(),rejection_reason=${why},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));
 if(rejected.length!==1)conflict("طلب الإغلاق تغير أثناء الرفض");
 const changed=partnershipRows(await tx.execute(sql`/* vp_month_source_rejected */ UPDATE vehicle_partnership_closings SET status='draft',revision=revision+1,version=version+1,financial_transaction_id=NULL,approved_by=NULL,approved_at=NULL WHERE id=${closingId} AND version=${Number(row.version)} AND status='pending' AND financial_transaction_id=${initial.id} RETURNING id`));
 if(changed.length!==1)conflict("نسخة الإغلاق تغيرت أثناء الرفض");
 await reconcileClosingAffected(tx,{rootId:root.id,closingId,revision:Number(row.revision),financialId:initial.id});
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:mode==="cancel"?"closing_cancelled":"closing_rejected",reason:why,financialTransactionId:initial.id,oldValues:{closingId,status:"pending",revision:Number(row.revision)},newValues:{closingId,status:"draft",revision:Number(row.revision)+1,cashImpact:"none"}});return {id:initial.id};
}
