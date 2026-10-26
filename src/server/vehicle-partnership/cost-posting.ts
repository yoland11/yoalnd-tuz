import {sql} from "drizzle-orm";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import {lockPartnershipCostContext,preparePartnershipCostRequest} from "./costing";
import {resolvePartnershipFinancialEffect} from "./financial-classification";
import {partnershipAccount,provePartnershipJournal} from "./journal";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import {executePartnershipDriverAccrual} from "./driver-posting";
type Row=Record<string,unknown>;
type Identity={id:number;sourceType:string|null;sourceId:string|null};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
export function partnershipCostPostingType(row:Row){
 if(row.funding_kind==="other"&&row.cost_class==="operating"&&row.employee_finance_entry_id!=null&&row.payer_member_id==null)return "vp_driver_accrual";
 if(!["operating","capital"].includes(String(row.cost_class))||!["partner_advance","partner_capital"].includes(String(row.funding_kind)))conflict("تصنيف تمويل المصروف غير معروف");
 return row.cost_class==="operating"?(row.funding_kind==="partner_advance"?"vp_partner_operating_advance":"vp_partner_operating_capital"):(row.funding_kind==="partner_advance"?"vp_partner_capital_advance":"vp_partner_capital_capital");
}
export async function provePartnershipCostRight(tx:PartnershipExecutor,row:Row,financialId:number,amount:string,status="approved"){
 const rights=partnershipRows(await tx.execute(sql`/* vp_cost_right_proof */ SELECT * FROM vehicle_partnership_rights WHERE cost_funding_id=${Number(row.id)}`));
 const category=row.funding_kind==="partner_advance"?"advance":"capital";
 if(rights.length!==1||Number(rights[0].partnership_id)!==Number(row.partnership_id)||Number(rights[0].member_id)!==Number(row.payer_member_id)||Number(rights[0].financial_transaction_id)!==financialId||rights[0].category!==category||rights[0].status!==status||rights[0].direction!=="credit"||parseMoney(String(rights[0].amount))!==parseMoney(amount))conflict("إثبات سلفة أو رأس مال الشريك لا يطابق المصروف المعتمد");
 return partnershipId(Number(rights[0].id));
}
export async function executePartnershipCostFinancialTransaction(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor,note?:string|null):Promise<{id:number;rightId?:number;employeeFinanceEntryId?:number}>{
 authorizePartnership(actor,true);partnershipId(initial.id);
 if(initial.sourceType!=="vehicle_partnership_cost"||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مصدر تمويل المصروف غير صالح");
 if(note!=null&&(typeof note!=="string"||note.trim().length>2000))throw new PartnershipValidationError("ملاحظة الاعتماد غير صالحة");
 const sourceId=partnershipId(Number(initial.sourceId)),context=await lockPartnershipCostContext(tx,actor,sourceId),{root,row}=context;
 if(row.funding_kind==="other"&&row.employee_finance_entry_id!=null){
  return executePartnershipDriverAccrual(tx,initial,actor,context,note);
 }
 if(Number(row.financial_transaction_id)!==initial.id||!["partner_advance","partner_capital"].includes(String(row.funding_kind))||!["operating","capital"].includes(String(row.cost_class)))conflict("مصدر تمويل المصروف لا يطابق الطلب المالي");
 const pending=row.status==="pending"?await preparePartnershipCostRequest(tx,{sourceType:"vehicle_partnership_cost",sourceId},actor):null;
 const rows=partnershipRows(await tx.execute(sql`/* vp_financial_locked */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,notes FROM financial_transactions WHERE id=${initial.id} FOR UPDATE`));
 if(!rows.length)throw new PartnershipRepositoryError("طلب تمويل المصروف غير موجود",404,"NOT_FOUND");if(rows.length!==1)throw new Error("Ambiguous cost financial request");
 const financial=rows[0],amount=formatMoney(parseMoney(String(financial.amount)));
 const effect=resolvePartnershipFinancialEffect({sourceType:String(financial.source_type),transactionType:String(financial.transaction_type),sourceEvent:String(financial.source_event),direction:String(financial.direction)});
 if(!effect||effect.cash!=="none"||effect.reversal||financial.source_type!==initial.sourceType||String(financial.source_id)!==String(sourceId)||Number(financial.id)!==initial.id||financial.transaction_type!==partnershipCostPostingType(row)||financial.balance_before!=null||financial.balance_after!=null||parseMoney(amount)<=0n)conflict("هوية قيد المصروف أو أثره النقدي غير مطابق للمصدر");
 if(financial.approval_status==="executed"){
  if(row.status!=="approved")conflict("حالة تمويل المصروف لا تطابق القيد المنفذ");
  await provePartnershipJournal(tx,initial.id,amount,effect.debit,effect.credit);
  const rightId=await provePartnershipCostRight(tx,row,initial.id,amount);await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
  return {id:initial.id,rightId};
 }
 if(!pending||financial.approval_status!=="pending"||pending.linkedFinancialTransactionId!==initial.id||pending.transactionType!==financial.transaction_type||pending.amount!==amount||pending.transactionDate!==financial.transaction_date||pending.direction!==financial.direction||pending.sourceEvent!==financial.source_event||!pending.agreementId||!pending.memberId)conflict("اعتماد المصروف يتطلب طلباً معلقاً مطابقاً للمصدر والشريك");
 const accounts=new Map<string,number>();for(const code of [effect.debit,effect.credit].sort())accounts.set(code,await partnershipAccount(tx,code));
 const journal=partnershipRows(await tx.execute(sql`INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${initial.id},${accounts.get(effect.debit)!},'debit',${amount},${pending.description}),(${initial.id},${accounts.get(effect.credit)!},'credit',${amount},${pending.description}) RETURNING id`));
 if(journal.length!==2)throw new Error("Cost balanced journal insert was not confirmed");
 const notes=[financial.notes,note?.trim()].filter(value=>typeof value==="string"&&value.trim()).join("\n")||null;
 const executed=partnershipRows(await tx.execute(sql`UPDATE financial_transactions SET approval_status='executed',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),executed_by=${actor.id},executed_by_name=${actor.name},executed_at=now(),balance_before=NULL,balance_after=NULL,notes=${notes},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));
 if(executed.length!==1||Number(executed[0].id)!==initial.id)conflict("تغير طلب المصروف أثناء الاعتماد");
 const approved=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_cost_funding SET status='approved' WHERE id=${sourceId} AND financial_transaction_id=${initial.id} AND status='pending' RETURNING id`));
 if(approved.length!==1||Number(approved[0].id)!==sourceId)conflict("تعذر تأكيد اعتماد تمويل المصروف");
 const category=row.funding_kind==="partner_advance"?"advance":"capital";
 const rights=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_rights (partnership_id,agreement_id,member_id,cost_funding_id,category,amount,financial_transaction_id,direction,status,event_key,created_by,reason) VALUES (${root.id},${pending.agreementId},${pending.memberId},${sourceId},${category},${amount},${initial.id},'credit','approved',${`vp:cost-right:${sourceId}`},${actor.id},${note?.trim()||String(row.reason)}) RETURNING id`));
 if(rights.length!==1)throw new Error("Partner cost right insert was not confirmed");const rightId=partnershipId(Number(rights[0].id));
 const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId});
 if(parseMoney(payment.approvedPaidAmount)!==0n)conflict("اعتماد التمويل ليس دفعة أو استرداداً نقدياً للشريك");
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"cost_approved",reason:note?.trim()||String(row.reason),financialTransactionId:initial.id,oldValues:{status:"pending"},newValues:{costFundingId:sourceId,expenseId:Number(row.vehicle_expense_id),memberId:pending.memberId,agreementId:pending.agreementId,amount,category,costClass:row.cost_class,rightId,cashImpact:"none",status:"approved"}});
 return {id:initial.id,rightId};
}
