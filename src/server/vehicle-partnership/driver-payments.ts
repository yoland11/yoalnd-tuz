import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {validatePayoutCapacity} from "../../lib/vehicle-partnership/payout";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import type {PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from "./accounting";
import {lockDriverPaymentOrigin,type DriverPaymentOriginProof} from "./driver-payment-origin";
import type {DriverPaymentState} from "./driver-payment-state";
import {provePartnershipJournal} from "./journal";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
type Identity={id:number;sourceType:string|null;sourceId:string|null};
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات طلب صرف أجرة السائق غير مكتمل");return value as Row;}
const commandSchema=z.object({entryId:z.number().int().positive(),amount:z.string().transform(v=>formatMoney(parseMoney(v))),transactionDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),paymentMethod:z.enum(["cash","transfer","pos"]),paymentSource:z.literal("MASTER"),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000)}).strict();
export type DriverPaymentCommand=z.infer<typeof commandSchema>;
type Proposal={formatVersion:1;vehicleId:number;partnershipId:number;actorId:number;command:DriverPaymentCommand;fingerprint:string;key:string;settlementId:number;origin:DriverPaymentOriginProof};
function command(value:unknown):DriverPaymentCommand{
 const parsed=commandSchema.safeParse(value);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(i=>i.message).join("؛ "));
 const result=parsed.data,date=new Date(`${result.transactionDate}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==result.transactionDate||parseMoney(result.amount)<=0n)throw new PartnershipValidationError("تاريخ أو مبلغ صرف أجرة السائق غير صالح");return result;
}
const requestKey=(vehicleId:number,actorId:number,value:DriverPaymentCommand)=>`vp:driver-payment:${hash({vehicleId,actorId,key:value.idempotencyKey})}`;
const fingerprint=(vehicleId:number,actorId:number,value:DriverPaymentCommand)=>hash({vehicleId,actorId,command:value});
function financialSource(initial:Identity){partnershipId(initial.id);if(initial.sourceType!=="vehicle_partnership_driver"||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مرجع صرف أجرة السائق غير صالح");return partnershipId(Number(initial.sourceId));}
async function financial(tx:PartnershipExecutor,ref:{key:string}|{id:number},lock=false){
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_payment_financial */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,payment_method,idempotency_key,approval_status,balance_before::text,balance_after::text,reversal_txn_id,reversed_transaction_id FROM financial_transactions WHERE ${"key" in ref?sql`idempotency_key=${ref.key}`:sql`id=${ref.id}`} ${lock?sql`FOR UPDATE`:sql``}`));
 if(rows.length>1)conflict("مرجع طلب أجرة السائق مكرر");return rows[0]??null;
}
/** Stable historical identity permits exact request/rejection retries after the
 * original accrual was reversed. New payments still prove its live origin. */
async function scope(tx:PartnershipExecutor,actor:PartnershipActor,entryId:number,vehicleId?:number){
 const read=async()=>partnershipRows(await tx.execute(sql`/* vp_driver_payment_scope */ SELECT DISTINCT p.vehicle_id,c.partnership_id,c.vehicle_expense_id,ef.id AS entry_id FROM employee_finance_entries ef JOIN vehicle_partnership_cost_funding c ON c.employee_finance_entry_id=ef.id JOIN vehicle_partnerships p ON p.id=c.partnership_id WHERE ef.id=${entryId} AND ef.source_type='vehicle_expense' AND ef.source_id=c.vehicle_expense_id::text ORDER BY p.vehicle_id,c.partnership_id,c.vehicle_expense_id,ef.id LIMIT 2`));
 const rows=await read();if(rows.length!==1||Number(rows[0].entry_id)!==entryId||vehicleId!==undefined&&Number(rows[0].vehicle_id)!==vehicleId)throw new PartnershipRepositoryError("استحقاق السائق غير موجود ضمن المركبة",404,"NOT_FOUND");
 const root=await lockPartnership(tx,partnershipId(Number(rows[0].vehicle_id)));await readOriginalVehicle(tx,actor,root.vehicleId);
 const current=await read();if(current.length!==1||canonicalPartnershipJson(current)!==canonicalPartnershipJson(rows)||Number(rows[0].partnership_id)!==root.id)conflict("تغير نطاق استحقاق السائق أثناء المراجعة");return {root,expenseId:partnershipId(Number(rows[0].vehicle_expense_id))};
}
async function settlement(tx:PartnershipExecutor,ref:{id:number}|{key:string},lock=false){
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_payment_settlement */ SELECT s.*,s.amount::text AS amount,s.settlement_date::text AS settlement_date,(SELECT count(*)::int FROM employee_finance_settlements duplicate WHERE duplicate.financial_transaction_id=s.financial_transaction_id) AS financial_uses FROM employee_finance_settlements s WHERE ${"id" in ref?sql`s.id=${ref.id}`:sql`s.idempotency_key=${ref.key}`} ${lock?sql`FOR UPDATE OF s`:sql``}`));
 if(rows.length>1)conflict("تسوية أجرة السائق مكررة");return rows[0]??null;
}
async function settlementScope(tx:PartnershipExecutor,actor:PartnershipActor,settlementId:number){
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_payment_settlement_scope */ SELECT id,entry_id FROM employee_finance_settlements WHERE id=${settlementId}`));
 if(rows.length!==1||Number(rows[0].id)!==settlementId)throw new PartnershipRepositoryError("تسوية أجرة السائق غير موجودة",404,"NOT_FOUND");const entryId=partnershipId(Number(rows[0].entry_id));return {...await scope(tx,actor,entryId),entryId};
}
function proveSettlement(row:Row,proposal:Proposal,financialId:number|null){
 const value=proposal.command;
 if(Number(row.id)!==proposal.settlementId||Number(row.entry_id)!==value.entryId||row.settlement_type!=="payment"||row.payroll_line_id!==null||parseMoney(String(row.amount))!==parseMoney(value.amount)||row.settlement_date!==value.transactionDate||row.payment_method!==value.paymentMethod||row.idempotency_key!==proposal.key||Number(row.created_by)!==proposal.actorId||row.notes!==value.reason||(row.financial_transaction_id==null?null:Number(row.financial_transaction_id))!==financialId||financialId!==null&&Number(row.financial_uses)!==1)conflict("تسوية أجرة الرحلة لا تطابق طلب صرفها الأصلي");
}
async function storedProposal(tx:PartnershipExecutor,row:Row):Promise<Proposal>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_payment_proposal */ SELECT id,new_values FROM financial_audit_logs WHERE transaction_id=${Number(row.id)} AND action='vehicle_partnership_financial_requested' ORDER BY id LIMIT 2`));
 if(rows.length!==1)conflict("طلب أجرة السائق بلا إثبات مصدر وحيد");
 const audit=object(rows[0].new_values),proposal=object(audit.sourceSnapshot) as unknown as Proposal,value=command(proposal.command),original=object(proposal.origin);
 if(proposal.formatVersion!==1||proposal.key!==requestKey(partnershipId(proposal.vehicleId),partnershipId(proposal.actorId),value)||proposal.fingerprint!==fingerprint(proposal.vehicleId,proposal.actorId,value)||audit.sourceDigest!==hash(proposal)||Number(audit.vehicleId)!==proposal.vehicleId||Number(audit.partnershipId)!==partnershipId(proposal.partnershipId)||audit.sourceType!=="vehicle_partnership_driver"||Number(audit.sourceId)!==partnershipId(proposal.settlementId)||audit.amount!==value.amount||Number(original.entryId)!==value.entryId||typeof original.entryDate!=="string"||value.transactionDate<original.entryDate||parseMoney(String(original.amount))<parseMoney(value.amount)||!["pending","executed","rejected"].includes(String(row.approval_status))||row.source_type!=="vehicle_partnership_driver"||String(row.source_id)!==String(proposal.settlementId)||row.source_event!=="driver_fee_settlement"||row.transaction_type!=="vp_driver_payment"||row.direction!=="expense"||parseMoney(String(row.amount))!==parseMoney(value.amount)||row.transaction_date!==value.transactionDate||row.payment_method!==value.paymentMethod||row.idempotency_key!==proposal.key||row.reversed_transaction_id!=null)conflict("طلب صرف أجرة السائق لا يطابق اقتراحه الأصلي المحفوظ");
 return proposal;
}
function validateCommandOrigin(root:{version:number},value:DriverPaymentCommand,origin:DriverPaymentOriginProof){
 if(root.version!==value.expectedVersion)conflict("نسخة اتفاق المركبة تغيرت؛ حدّث البيانات قبل طلب الأجرة");if(value.entryId!==origin.entryId||value.transactionDate<origin.entryDate||parseMoney(value.amount)>parseMoney(origin.amount))conflict("طلب الصرف لا يطابق أجرة الرحلة وتاريخها");
}
function makeProposal(root:{id:number;vehicleId:number;version:number},actor:PartnershipActor,value:DriverPaymentCommand,settlementId:number,origin:DriverPaymentOriginProof):Proposal{
 validateCommandOrigin(root,value,origin);partnershipId(settlementId);
 return {formatVersion:1,vehicleId:root.vehicleId,partnershipId:root.id,actorId:actor.id,command:value,fingerprint:fingerprint(root.vehicleId,actor.id,value),key:requestKey(root.vehicleId,actor.id,value),settlementId,origin};
}
function result(row:Row,proposal:Proposal){return {financialTransactionId:partnershipId(Number(row.id)),settlementId:proposal.settlementId,entryId:proposal.command.entryId,amount:proposal.command.amount,approvalStatus:String(row.approval_status)};}
function approvedState(state:DriverPaymentState,proof:DriverPaymentOriginProof){
 if(!state||!state.payable||!["approved","partially_settled","settled"].includes(state.approvalStatus)||parseMoney(state.totalAmount)!==parseMoney(proof.amount))conflict("أجرة الرحلة الأصلية غير معتمدة للصرف");return state;
}
/** All staging, source proof, pending FI, guarded link and canonical hold commit
 * together. The nullable staging row must never reach canonical reconciliation. */
export async function requestPartnershipDriverPayment(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);const value=command(input),key=requestKey(vehicleId,actor.id,value);
 return db.transaction(async tx=>{
  const scoped=await scope(tx,actor,value.entryId,vehicleId),prior=await financial(tx,{key});
  if(prior){const proposal=await storedProposal(tx,prior),saved=await settlement(tx,{id:proposal.settlementId});if(!saved)conflict("تسوية طلب الصرف الأصلي مفقودة");proveSettlement(saved,proposal,Number(prior.id));if(proposal.partnershipId!==scoped.root.id||proposal.vehicleId!==vehicleId||proposal.fingerprint!==fingerprint(vehicleId,actor.id,value))conflict("مرجع صرف الأجرة مستخدم لبيانات مختلفة");return result(prior,proposal);}
  const context=await lockDriverPaymentOrigin(tx,actor,value.entryId,vehicleId);if(context.root.id!==scoped.root.id||context.proof.expenseId!==scoped.expenseId)conflict("أصل أجرة السائق لا يطابق نطاق الطلب");
  // Validate version/date before any staged write; capacity comes from the
  // original employee entitlement, never the cached remaining field.
  validateCommandOrigin(context.root,value,context.proof);
  const state=approvedState(await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:value.entryId}),context.proof);
  validatePayoutCapacity({amount:value.amount,availableAmount:state.availableAmount,ownPendingAmount:"0.00",reservedAmount:state.reservedAmount,coverage:[]});
  const inserted=partnershipRows(await tx.execute(sql`/* vp_driver_payment_insert */ INSERT INTO employee_finance_settlements (entry_id,settlement_type,amount,settlement_date,payment_method,notes,financial_transaction_id,payroll_line_id,idempotency_key,created_by,created_by_name) VALUES (${value.entryId},'payment',${value.amount},${value.transactionDate},${value.paymentMethod},${value.reason},NULL,NULL,${key},${actor.id},${actor.name}) RETURNING id`));
  if(inserted.length!==1)throw new Error("Driver payment settlement insert was not confirmed");const settlementId=partnershipId(Number(inserted[0].id)),proposal=makeProposal(context.root,actor,value,settlementId,context.proof);
  const created=await createRequest(tx,{sourceType:"vehicle_partnership_driver",sourceId:settlementId,driverPayment:value},actor);if(created.approvalStatus!=="pending")conflict("يجب أن يبدأ صرف أجرة السائق بطلب معلق فقط");
  const row=await financial(tx,{id:partnershipId(created.id)});if(!row||row.approval_status!=="pending")conflict("تعذر تأكيد طلب أجرة السائق المعلق");const persisted=await storedProposal(tx,row);if(canonicalPartnershipJson(persisted)!==canonicalPartnershipJson(proposal))conflict("مصدر الطلب المالي لا يطابق أجرة السائق");
  const linked=partnershipRows(await tx.execute(sql`/* vp_driver_payment_link */ UPDATE employee_finance_settlements SET financial_transaction_id=${created.id} WHERE id=${settlementId} AND financial_transaction_id IS NULL RETURNING id`));if(linked.length!==1||Number(linked[0].id)!==settlementId)conflict("تعذر ربط تسوية الأجرة بطلبها المالي");
  const saved=await settlement(tx,{id:settlementId});if(!saved)conflict("تسوية أجرة السائق مفقودة");proveSettlement(saved,proposal,created.id);
  await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:value.entryId});
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:scoped.root.id,actor,action:"driver_payment_requested",reason:value.reason,financialTransactionId:created.id,newValues:{entryId:value.entryId,settlementId,amount:value.amount,sourceDigest:hash(proposal),status:"pending",cashImpact:"none"}});return result(row,proposal);
 });
}
/** Invoked only inside the caller's atomic staging transaction. No canonical
 * read here: an unlinked settlement is intentionally not a valid payment yet. */
export async function prepareDriverPaymentFinancialRequest(tx:PartnershipExecutor,reference:{sourceType:"vehicle_partnership_driver";sourceId:number;driverPayment?:unknown},actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 authorizePartnership(actor);partnershipId(reference.sourceId);const value=command(reference.driverPayment),context=await lockDriverPaymentOrigin(tx,actor,value.entryId),proposal=makeProposal(context.root,actor,value,reference.sourceId,context.proof),saved=await settlement(tx,{id:reference.sourceId},true);
 if(!saved)throw new PartnershipRepositoryError("تسوية الأجرة المعلقة غير موجودة",404,"NOT_FOUND");proveSettlement(saved,proposal,null);
 return {sourceType:"vehicle_partnership_driver",sourceId:reference.sourceId,sourceEvent:"driver_fee_settlement",transactionType:"vp_driver_payment",direction:"expense",amount:value.amount,transactionDate:value.transactionDate,department:"transportation",description:`صرف أجرة سائق رحلة المركبة ${proposal.vehicleId}`,referenceNo:`VP-DRIVER-${reference.sourceId}`,idempotencyKey:proposal.key,partnershipId:proposal.partnershipId,vehicleId:proposal.vehicleId,employeeFinanceEntryId:value.entryId,sourceDigest:hash(proposal),sourceSnapshot:proposal,paymentMethod:value.paymentMethod,linkedFinancialTransactionId:null};
}
export type DriverPaymentExecution={sourceType:"vehicle_partnership_driver";transactionType:"vp_driver_payment";alreadyExecuted:boolean;financialId:number;amount:string;counterCode:"VP-DRIVER";proposal:Proposal;context:Awaited<ReturnType<typeof lockDriverPaymentOrigin>>};
export async function prepareDriverPaymentExecution(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor):Promise<DriverPaymentExecution>{
 authorizePartnership(actor,true);const settlementId=financialSource(initial),scoped=await settlementScope(tx,actor,settlementId),context=await lockDriverPaymentOrigin(tx,actor,scoped.entryId,scoped.root.vehicleId),saved=await settlement(tx,{id:settlementId},true),row=await financial(tx,{id:initial.id},true);
 if(!row||!saved)throw new PartnershipRepositoryError("طلب صرف أجرة السائق غير موجود",404,"NOT_FOUND");const proposal=await storedProposal(tx,row);proveSettlement(saved,proposal,initial.id);
 if(proposal.settlementId!==settlementId||proposal.command.entryId!==scoped.entryId||proposal.vehicleId!==scoped.root.vehicleId||proposal.partnershipId!==scoped.root.id||context.root.id!==scoped.root.id||canonicalPartnershipJson(proposal.origin)!==canonicalPartnershipJson(context.proof))conflict("أصل أجرة السائق المعتمد تغير أو لا يطابق طلب الصرف");
 const plan:DriverPaymentExecution={sourceType:"vehicle_partnership_driver",transactionType:"vp_driver_payment",alreadyExecuted:row.approval_status==="executed",financialId:initial.id,amount:proposal.command.amount,counterCode:"VP-DRIVER",proposal,context};
 if(row.reversal_txn_id!=null)conflict("صرف أجرة السائق معكوس؛ راجع السجل المالي");
 if(plan.alreadyExecuted){if(row.balance_before==null||row.balance_after==null||parseMoney(String(row.balance_before))-parseMoney(String(row.balance_after))!==parseMoney(plan.amount))conflict("إثبات الحركة النقدية المنفذة لا يطابق أجرة السائق");await provePartnershipJournal(tx,initial.id,plan.amount,"VP-DRIVER","1000");approvedState(await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:scoped.entryId}),context.proof);return plan;}
 if(row.approval_status!=="pending"||row.balance_before!=null||row.balance_after!=null)conflict("يمكن اعتماد طلب أجرة السائق المعلق المطابق فقط");
 const journal=partnershipRows(await tx.execute(sql`/* vp_driver_payment_pending_journal */ SELECT id FROM financial_ledger_entries WHERE transaction_id=${initial.id} LIMIT 1`));if(journal.length)conflict("طلب الأجرة المعلق عليه قيد سابق؛ يلزم المصالحة");
 const state=approvedState(await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:scoped.entryId}),context.proof);
 validatePayoutCapacity({amount:plan.amount,availableAmount:state.availableAmount,ownPendingAmount:plan.amount,reservedAmount:state.reservedAmount,coverage:[]});return plan;
}
/** Called after the original MASTER block. Neither this module nor printing
 * posts payroll, a second vehicle expense, ledger entries or a cash movement. */
export async function finishDriverPaymentExecution(tx:PartnershipExecutor,plan:DriverPaymentExecution,actor:PartnershipActor){
 authorizePartnership(actor,true);const confirmed=await prepareDriverPaymentExecution(tx,{id:plan.financialId,sourceType:"vehicle_partnership_driver",sourceId:String(plan.proposal.settlementId)},actor);
 if(!confirmed.alreadyExecuted||plan.amount!==confirmed.amount||canonicalPartnershipJson(plan.proposal)!==canonicalPartnershipJson(confirmed.proposal))conflict("تأكيد صرف الأجرة لا يطابق الحركة النقدية المنفذة");const {root}=confirmed.context;
 const prior=partnershipRows(await tx.execute(sql`/* vp_driver_payment_finished */ SELECT id,new_values FROM financial_audit_logs WHERE transaction_id=${plan.financialId} AND action='vehicle_partnership_driver_payment_executed' ORDER BY id LIMIT 2`));
 if(prior.length){const saved=object(prior[0].new_values);if(prior.length!==1||Number(saved.vehicleId)!==root.vehicleId||Number(saved.partnershipId)!==root.id||Number(saved.entryId)!==confirmed.proposal.command.entryId||Number(saved.settlementId)!==confirmed.proposal.settlementId||saved.amount!==confirmed.amount||saved.status!=="executed"||saved.cashImpact!=="out")conflict("سجل تأكيد صرف الأجرة غير مطابق");return;}
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"driver_payment_executed",reason:plan.proposal.command.reason,financialTransactionId:plan.financialId,newValues:{entryId:plan.proposal.command.entryId,settlementId:plan.proposal.settlementId,amount:plan.amount,status:"executed",cashImpact:"out"}});
}
export async function rejectDriverPaymentFinancialTransaction(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor,reason:string,mode:"reject"|"cancel"="reject"){
 authorizePartnership(actor,mode==="reject");if(typeof reason!=="string"||reason.trim().length<3||reason.trim().length>2000)throw new PartnershipValidationError("سبب رفض أجرة السائق مطلوب");const settlementId=financialSource(initial),scoped=await settlementScope(tx,actor,settlementId);
 // Acquire the original expense before settlement/FI even when its accrual
 // has since been reversed; repeated rejection must remain a historical read.
 const expenses=partnershipRows(await tx.execute(sql`/* vp_driver_payment_reject_expense */ SELECT id FROM vehicle_expenses WHERE id=${scoped.expenseId} AND vehicle_id=${scoped.root.vehicleId} FOR UPDATE`));if(expenses.length!==1||Number(expenses[0].id)!==scoped.expenseId)conflict("مصدر أجرة السائق غير موجود");
 const saved=await settlement(tx,{id:settlementId},true),row=await financial(tx,{id:initial.id},true);if(!saved||!row)throw new PartnershipRepositoryError("طلب أجرة السائق غير موجود",404,"NOT_FOUND");const proposal=await storedProposal(tx,row);proveSettlement(saved,proposal,initial.id);
 if(proposal.vehicleId!==scoped.root.vehicleId||proposal.partnershipId!==scoped.root.id||proposal.command.entryId!==scoped.entryId||proposal.settlementId!==settlementId)conflict("طلب الأجرة لا يعود لاستحقاق هذه المركبة");if(row.approval_status==="rejected")return {id:initial.id};
 if(row.approval_status!=="pending"||row.balance_before!=null||row.balance_after!=null||row.reversal_txn_id!=null)conflict("يمكن رفض أو إلغاء طلب أجرة السائق المعلق فقط");
 const journal=partnershipRows(await tx.execute(sql`/* vp_driver_payment_pending_journal */ SELECT id FROM financial_ledger_entries WHERE transaction_id=${initial.id} LIMIT 1`));if(journal.length)conflict("طلب أجرة السائق المعلق عليه قيد سابق");
 const changed=partnershipRows(await tx.execute(sql`/* vp_driver_payment_reject */ UPDATE financial_transactions SET approval_status='rejected',rejected_by=${actor.id},rejected_by_name=${actor.name},rejected_at=now(),rejection_reason=${reason.trim()},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));if(changed.length!==1||Number(changed[0].id)!==initial.id)conflict("طلب الأجرة تغير أثناء الرفض");
 await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:scoped.entryId});
 await appendPartnershipAudit(tx,{vehicleId:scoped.root.vehicleId,partnershipId:scoped.root.id,actor,action:mode==="cancel"?"driver_payment_cancelled":"driver_payment_rejected",reason:reason.trim(),financialTransactionId:initial.id,newValues:{entryId:scoped.entryId,settlementId,status:"rejected",cashImpact:"none"}});return {id:initial.id};
}
