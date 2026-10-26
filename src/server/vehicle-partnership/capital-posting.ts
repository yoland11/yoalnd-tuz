import {sql} from "drizzle-orm";
import {parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import {lockPartnershipCapitalContext,preparePartnershipCapitalRequest} from "./capital";
import {resolvePartnershipFinancialEffect} from "./financial-classification";
import {partnershipAccount,provePartnershipJournal} from "./journal";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
export async function executePartnershipCapitalFinancialTransaction(tx:PartnershipExecutor,initial:{id:number;sourceType:string|null;sourceId:string|null},actor:PartnershipActor,note?:string|null):Promise<{id:number;rightId:number}>{
 authorizePartnership(actor,true);partnershipId(initial.id);
 if(initial.sourceType!=="vehicle_partnership_right"||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مصدر مساهمة رأس المال غير صالح");
 if(note!=null&&(typeof note!=="string"||note.trim().length>2000))throw new PartnershipValidationError("ملاحظة الاعتماد غير صالحة");
 const rightId=partnershipId(Number(initial.sourceId)),{root,row,proof}=await lockPartnershipCapitalContext(tx,actor,rightId);
 if(Number(row.financial_transaction_id)!==initial.id)conflict("مرجع مساهمة رأس المال المالي غير مطابق");
 const pending=row.status==="pending"?await preparePartnershipCapitalRequest(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId},actor):null;
 const rows=partnershipRows(await tx.execute(sql`/* vp_financial_locked */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,notes FROM financial_transactions WHERE id=${initial.id} FOR UPDATE`));
 if(!rows.length)throw new PartnershipRepositoryError("طلب مساهمة رأس المال غير موجود",404,"NOT_FOUND");if(rows.length!==1)throw new Error("Ambiguous capital financial request");
 const financial=rows[0];const effect=resolvePartnershipFinancialEffect({sourceType:String(financial.source_type),transactionType:String(financial.transaction_type),sourceEvent:String(financial.source_event),direction:String(financial.direction)});
 if(!effect||effect.cash!=="none"||effect.operating!=="none"||effect.reversal||Number(financial.id)!==initial.id||financial.source_type!==initial.sourceType||String(financial.source_id)!==String(rightId)||financial.transaction_type!=="vp_capital_record"||financial.transaction_date!==proof.entryDate||parseMoney(String(financial.amount))!==parseMoney(proof.amount)||financial.balance_before!=null||financial.balance_after!=null)conflict("قيد مساهمة رأس المال لا يطابق مصدرها غير النقدي");
 if(financial.approval_status==="executed"){
  if(row.status!=="approved")conflict("حالة المساهمة لا تطابق القيد المنفذ");
  await provePartnershipJournal(tx,initial.id,proof.amount,effect.debit,effect.credit);await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});return {id:initial.id,rightId};
 }
 if(!pending||row.status!=="pending"||financial.approval_status!=="pending"||pending.linkedFinancialTransactionId!==initial.id)conflict("اعتماد المساهمة يتطلب طلباً معلقاً مطابقاً للمصدر");
 const accounts=new Map<string,number>();for(const code of [effect.debit,effect.credit].sort())accounts.set(code,await partnershipAccount(tx,code));
 const entries=partnershipRows(await tx.execute(sql`INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${initial.id},${accounts.get(effect.debit)!},'debit',${proof.amount},${pending.description}),(${initial.id},${accounts.get(effect.credit)!},'credit',${proof.amount},${pending.description}) RETURNING id`));if(entries.length!==2)throw new Error("Capital balanced journal insert was not confirmed");
 const notes=[financial.notes,note?.trim()].filter(value=>typeof value==="string"&&value.trim()).join("\n")||null;
 const financialSaved=partnershipRows(await tx.execute(sql`UPDATE financial_transactions SET approval_status='executed',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),executed_by=${actor.id},executed_by_name=${actor.name},executed_at=now(),balance_before=NULL,balance_after=NULL,notes=${notes},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));if(financialSaved.length!==1||Number(financialSaved[0].id)!==initial.id)conflict("تغير طلب المساهمة أثناء الاعتماد");
 const saved=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_rights SET status='approved' WHERE id=${rightId} AND financial_transaction_id=${initial.id} AND status='pending' RETURNING id`));if(saved.length!==1||Number(saved[0].id)!==rightId)conflict("تعذر تأكيد اعتماد المساهمة");
 const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});if(parseMoney(payment.approvedPaidAmount)!==0n||parseMoney(payment.reservedAmount)!==0n)conflict("اعتماد المساهمة لا يمثل قبضاً نقدياً");
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"capital_approved",reason:note?.trim()||String(row.reason),financialTransactionId:initial.id,oldValues:{status:"pending"},newValues:{rightId,memberId:proof.memberId,amount:proof.amount,entryDate:proof.entryDate,status:"approved",cashImpact:"none"}});
 return {id:initial.id,rightId};
}
