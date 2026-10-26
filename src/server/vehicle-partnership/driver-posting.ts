import {sql} from "drizzle-orm";
import {parseMoney} from "../../lib/vehicle-partnership/money";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import type {lockPartnershipCostContext} from "./costing";
import {preparePartnershipDriverAccrual} from "./driver";
import {resolvePartnershipFinancialEffect} from "./financial-classification";
import {partnershipAccount,provePartnershipJournal} from "./journal";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
type CostContext=Awaited<ReturnType<typeof lockPartnershipCostContext>>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
export async function transitionDriverAccrual(tx:PartnershipExecutor,row:Record<string,unknown>,status:"rejected"|"cancelled",actor:PartnershipActor,reason:string):Promise<void>{
 const entryId=partnershipId(Number(row.employee_finance_entry_id));
 const changed=partnershipRows(await tx.execute(status==="rejected"?sql`UPDATE employee_finance_entries SET status='rejected',rejected_by=${actor.id},rejected_at=now(),rejection_reason=${reason},updated_at=now() WHERE id=${entryId} AND source_type='vehicle_expense' AND source_id=${String(row.vehicle_expense_id)} AND entry_type='trip_driver_fee' AND status='pending' RETURNING id`:sql`UPDATE employee_finance_entries SET status='cancelled',updated_at=now() WHERE id=${entryId} AND source_type='vehicle_expense' AND source_id=${String(row.vehicle_expense_id)} AND entry_type='trip_driver_fee' AND status IN ('approved','partially_settled','settled') RETURNING id`));
 if(changed.length!==1||Number(changed[0].id)!==entryId)conflict("تغيرت حالة استحقاق السائق أثناء المراجعة");
 await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});
}
export async function executePartnershipDriverAccrual(tx:PartnershipExecutor,initial:{id:number;sourceType:string|null;sourceId:string|null},actor:PartnershipActor,context:CostContext,note?:string|null):Promise<{id:number;employeeFinanceEntryId:number}>{
 authorizePartnership(actor,true);const {root,row}=context,entryId=partnershipId(Number(row.employee_finance_entry_id));
 if(initial.sourceType!=="vehicle_partnership_cost"||String(initial.sourceId)!==String(row.id)||Number(row.financial_transaction_id)!==initial.id||row.funding_kind!=="other"||row.cost_class!=="operating"||row.payer_member_id!=null)conflict("مصدر استحقاق السائق لا يطابق الطلب المالي");
 const pending=row.status==="pending"?await preparePartnershipDriverAccrual(tx,context,actor):null;
 const financialRows=partnershipRows(await tx.execute(sql`/* vp_financial_locked */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,approval_status,balance_before,balance_after,notes FROM financial_transactions WHERE id=${initial.id} FOR UPDATE`));
 if(!financialRows.length)throw new PartnershipRepositoryError("طلب استحقاق السائق غير موجود",404,"NOT_FOUND");if(financialRows.length!==1)throw new Error("Ambiguous driver accrual financial request");const financial=financialRows[0];
 const effect=resolvePartnershipFinancialEffect({sourceType:String(financial.source_type),transactionType:String(financial.transaction_type),sourceEvent:String(financial.source_event),direction:String(financial.direction)});
 if(!effect||effect.cash!=="none"||effect.operating!=="expense"||effect.reversal||Number(financial.id)!==initial.id||financial.source_type!==initial.sourceType||String(financial.source_id)!==String(row.id)||financial.transaction_type!=="vp_driver_accrual"||financial.balance_before!=null||financial.balance_after!=null)conflict("قيد استحقاق السائق لا يطابق مصدر التكلفة غير النقدي");
 if(financial.approval_status==="executed"){
  if(row.status!=="approved")conflict("مصدر أجرة السائق لا يطابق القيد المنفذ");
  const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});if(payment.totalAmount!==String(financial.amount))conflict("قيمة استحقاق الموظف لا تطابق قيد أجرة الرحلة");
  await provePartnershipJournal(tx,initial.id,payment.totalAmount,effect.debit,effect.credit);return {id:initial.id,employeeFinanceEntryId:entryId};
 }
 if(!pending||financial.approval_status!=="pending"||pending.linkedFinancialTransactionId!==initial.id||pending.employeeFinanceEntryId!==entryId||pending.amount!==String(financial.amount)||pending.transactionDate!==financial.transaction_date)conflict("يجب اعتماد طلب أجرة معلق مطابق للسائق والرحلة والمبلغ");
 const accounts=new Map<string,number>();for(const code of [effect.debit,effect.credit].sort())accounts.set(code,await partnershipAccount(tx,code));
 const entries=partnershipRows(await tx.execute(sql`INSERT INTO financial_ledger_entries (transaction_id,account_id,entry_side,amount,description) VALUES (${initial.id},${accounts.get(effect.debit)!},'debit',${pending.amount},${pending.description}),(${initial.id},${accounts.get(effect.credit)!},'credit',${pending.amount},${pending.description}) RETURNING id`));if(entries.length!==2)throw new Error("Driver accrual journal insert was not confirmed");
 const notes=[financial.notes,note?.trim()].filter(value=>typeof value==="string"&&value.trim()).join("\n")||null;
 const saved=partnershipRows(await tx.execute(sql`UPDATE financial_transactions SET approval_status='executed',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),executed_by=${actor.id},executed_by_name=${actor.name},executed_at=now(),balance_before=NULL,balance_after=NULL,notes=${notes},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));if(saved.length!==1||Number(saved[0].id)!==initial.id)conflict("تغير طلب أجرة السائق أثناء الاعتماد");
 const source=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_cost_funding SET status='approved' WHERE id=${Number(row.id)} AND financial_transaction_id=${initial.id} AND status='pending' RETURNING id`));if(source.length!==1||Number(source[0].id)!==Number(row.id))conflict("تعذر تأكيد اعتماد مصدر أجرة السائق");
 const employee=partnershipRows(await tx.execute(sql`UPDATE employee_finance_entries SET status='approved',approved_by=${actor.id},approved_by_name=${actor.name},approved_at=now(),updated_at=now() WHERE id=${entryId} AND source_type='vehicle_expense' AND source_id=${String(row.vehicle_expense_id)} AND entry_type='trip_driver_fee' AND status='pending' RETURNING id`));if(employee.length!==1||Number(employee[0].id)!==entryId)conflict("تعذر تأكيد اعتماد استحقاق الموظف");
 const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});if(parseMoney(payment.approvedPaidAmount)!==0n||parseMoney(payment.reservedAmount)!==0n)conflict("اعتماد الأجرة لا يمثل صرفها نقداً");
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"driver_accrual_approved",reason:note?.trim()||String(row.reason),financialTransactionId:initial.id,oldValues:{status:"pending"},newValues:{expenseId:Number(row.vehicle_expense_id),costFundingId:Number(row.id),employeeFinanceEntryId:entryId,amount:pending.amount,status:"approved",cashImpact:"none"}});
 return {id:initial.id,employeeFinanceEntryId:entryId};
}
