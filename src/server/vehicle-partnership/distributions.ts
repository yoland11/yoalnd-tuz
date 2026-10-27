import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {buildPayoutCoverage,validatePayoutCapacity,type PayoutCoverage} from "../../lib/vehicle-partnership/payout";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import type {PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from "./accounting";
import {lockClosingContext,verifySubmittedClosing} from "./closing-lifecycle";
import {proveClosingJournal} from "./closing-posting";
import {proveClosingRevisionRights} from "./closing-unused";
import {reserveClosingConversions} from "./closing-rights";
import {provePartnershipJournal} from "./journal";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
type Identity={id:number;sourceType:string|null;sourceId:string|null};
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات طلب صرف الحصة غير مكتمل");return value as Row;}
const commandSchema=z.object({rightId:z.number().int().positive(),amount:z.string().transform(v=>formatMoney(parseMoney(v))),transactionDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),paymentMethod:z.enum(["cash","transfer","pos"]),paymentSource:z.literal("MASTER"),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000)}).strict();
export type DistributionCommand=z.infer<typeof commandSchema>;
type Proposal={formatVersion:1;vehicleId:number;partnershipId:number;actorId:number;command:DistributionCommand;fingerprint:string;key:string;origin:Row;coverage:PayoutCoverage[]};
function command(value:unknown):DistributionCommand{
 const parsed=commandSchema.safeParse(value);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(i=>i.message).join("؛ "));
 const result=parsed.data,date=new Date(`${result.transactionDate}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==result.transactionDate||parseMoney(result.amount)<=0n)throw new PartnershipValidationError("تاريخ أو مبلغ صرف الحصة غير صالح");return result;
}
const requestKey=(vehicleId:number,actorId:number,value:DistributionCommand)=>`vp:distribution:${hash({vehicleId,actorId,key:value.idempotencyKey})}`;
const fingerprint=(vehicleId:number,actorId:number,value:DistributionCommand)=>hash({vehicleId,actorId,command:value});
function financialSource(initial:Identity){partnershipId(initial.id);if(initial.sourceType!=="vehicle_partnership_settlement"||!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مرجع صرف الحصة غير صالح");return partnershipId(Number(initial.sourceId));}
async function financial(tx:PartnershipExecutor,ref:{key:string}|{id:number},lock=false){
 const rows=partnershipRows(await tx.execute(sql`/* vp_distribution_financial */ SELECT id,source_type,source_id,source_event,transaction_type,transaction_date::text,direction,amount::text,payment_method,idempotency_key,approval_status,balance_before::text,balance_after::text,reversal_txn_id,reversed_transaction_id FROM financial_transactions WHERE ${"key" in ref?sql`idempotency_key=${ref.key}`:sql`id=${ref.id}`} ${lock?sql`FOR UPDATE`:sql``}`));
 if(rows.length>1)conflict("مرجع طلب صرف الحصة مكرر");return rows[0]??null;
}
async function scope(tx:PartnershipExecutor,actor:PartnershipActor,rightId:number,vehicleId?:number){
 const rows=partnershipRows(await tx.execute(sql`/* vp_distribution_scope */ SELECT p.vehicle_id,l.closing_id,r.id AS right_id FROM vehicle_partnership_rights r JOIN vehicle_partnerships p ON p.id=r.partnership_id LEFT JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE r.id=${rightId}`));
 if(rows.length!==1||Number(rows[0].right_id)!==rightId||vehicleId!=null&&Number(rows[0].vehicle_id)!==vehicleId)throw new PartnershipRepositoryError("استحقاق الحصة غير موجود ضمن المركبة",404,"NOT_FOUND");
 const originalVehicle=partnershipId(Number(rows[0].vehicle_id)),root=await lockPartnership(tx,originalVehicle);await readOriginalVehicle(tx,actor,originalVehicle);
 if(rows[0].closing_id==null)conflict("هذا المسار لصرف الأرباح الشهرية المعتمدة فقط");return {root,closingId:partnershipId(Number(rows[0].closing_id))};
}
async function sourceContext(tx:PartnershipExecutor,actor:PartnershipActor,rightId:number,vehicleId?:number){
 const found=await scope(tx,actor,rightId,vehicleId),context=await lockClosingContext(tx,actor,found.closingId);
 if(context.root.id!==found.root.id)conflict("تغير نطاق مصدر حصة الشريك");
 const rows=partnershipRows(await tx.execute(sql`/* vp_distribution_right */ SELECT r.*,r.amount::text,l.revision AS line_revision,l.closing_id FROM vehicle_partnership_rights r JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE r.id=${rightId} FOR UPDATE OF r`));
 if(rows.length!==1)conflict("استحقاق الشهر الأصلي غير موجود");return {...context,right:rows[0]};
}
async function origin(tx:PartnershipExecutor,actor:PartnershipActor,context:Awaited<ReturnType<typeof sourceContext>>){
 const {root,row,right}=context;
 if(!["approved","distributed"].includes(String(row.status))||Number(right.partnership_id)!==root.id||right.category!=="profit"||right.direction!=="credit"||right.status!=="approved"||Number(right.line_revision)!==Number(row.revision)||Number(right.closing_id)!==Number(row.id)||Number(right.financial_transaction_id)!==Number(row.financial_transaction_id)||parseMoney(String(right.amount))<=0n)conflict("الحصة لا تعود لربح شهري معتمد قابل للصرف");
 const proof=await verifySubmittedClosing(tx,actor,context,false),rights=await proveClosingRevisionRights(tx,{root,row,snapshot:proof.snapshot,financialId:Number(row.financial_transaction_id)});
 if(!rights.includes(Number(right.id)))conflict("حق الشريك غير موجود في التوزيع المجمد");
 const financials=partnershipRows(await tx.execute(sql`/* vp_distribution_origin_financial */ SELECT id,source_type,source_id,source_event,transaction_type,direction,amount::text,transaction_date::text,approval_status,reversal_txn_id,balance_before,balance_after FROM financial_transactions WHERE id=${Number(row.financial_transaction_id)}`));
 const f=financials[0];if(financials.length!==1||!f||f.source_type!=="vehicle_partnership_closing"||String(f.source_id)!==String(row.id)||f.source_event!=="monthly_result"||f.transaction_type!==proof.journal.transactionType||f.direction!==(proof.journal.transactionType==="vp_month_profit"?"expense":"revenue")||f.approval_status!=="executed"||f.reversal_txn_id!=null||f.balance_before!=null||f.balance_after!=null||parseMoney(String(f.amount))!==parseMoney(proof.journal.amount)||f.transaction_date!==proof.snapshot.to)conflict("قيد أرباح الشهر الأصلي غير منفذ أو معكوس أو غير مطابق");
 await proveClosingJournal(tx,Number(f.id),proof.journal);
 await reserveClosingConversions(tx,actor,{root,row,snapshot:proof.snapshot,financialId:Number(f.id)},true);
 return {rightId:partnershipId(Number(right.id)),closingId:Number(row.id),revision:Number(row.revision),sourceDigest:String(row.source_digest),periodEnd:proof.snapshot.to,originalFinancialId:Number(f.id),agreementId:partnershipId(Number(right.agreement_id)),memberId:partnershipId(Number(right.member_id)),rightAmount:formatMoney(parseMoney(String(right.amount))),rightSnapshot:object(right.source_snapshot)};
}
async function budgets(tx:PartnershipExecutor,context:Awaited<ReturnType<typeof sourceContext>>){
 const rows=partnershipRows(await tx.execute(sql`/* vp_distribution_budget */ SELECT a.id,a.right_id,a.purpose,a.conversion_allocation_id,a.financial_transaction_id,a.amount::text,r.partnership_id FROM vehicle_partnership_settlement_allocations a JOIN vehicle_partnership_rights r ON r.id=a.right_id WHERE a.financial_transaction_id=${Number(context.row.financial_transaction_id)} AND a.purpose='internal_conversion' ORDER BY a.id LIMIT 501`));
 if(rows.length>500)conflict("تحويلات تمويل الشهر تتجاوز حد المراجعة");const result=[];
 for(const row of rows){if(Number(row.partnership_id)!==context.root.id||row.purpose!=="internal_conversion"||row.conversion_allocation_id!=null||Number(row.financial_transaction_id)!==Number(context.row.financial_transaction_id))conflict("مرجع تحويل تمويل الشهر غير مطابق");const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:partnershipId(Number(row.right_id))});if(!state||state.approvalStatus!=="approved"||typeof state.availableCoverageAmount!=="string"||typeof state.conversionCashReservedAmount!=="string")conflict("رصيد تغطية التحويل غير متاح");result.push({rightId:Number(row.right_id),conversionAllocationId:partnershipId(Number(row.id)),availableAmount:state.availableCoverageAmount,reservedAmount:state.conversionCashReservedAmount});}
 return result;
}
async function makeProposal(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,value:DistributionCommand):Promise<Proposal>{
 const context=await sourceContext(tx,actor,value.rightId,vehicleId),proof=await origin(tx,actor,context);
 if(Number(context.row.version)!==value.expectedVersion)conflict("نسخة حساب الشراكة تغيرت؛ حدّث الحساب قبل طلب الحصة");
 if(value.transactionDate<String(proof.periodEnd))conflict("تاريخ صرف الحصة يسبق اكتمال شهر الاستحقاق");
 const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:value.rightId});
 if(!state||state.approvalStatus!=="approved"||!state.payable||parseMoney(state.totalAmount)!==parseMoney(String(proof.rightAmount)))conflict("حصة الشريك غير معتمدة للصرف");
 validatePayoutCapacity({amount:value.amount,availableAmount:state.availableAmount,ownPendingAmount:"0.00",reservedAmount:state.reservedAmount,coverage:[]});
 const coverage=buildPayoutCoverage(value.amount,await budgets(tx,context));
 return {formatVersion:1,vehicleId,partnershipId:context.root.id,actorId:actor.id,command:value,fingerprint:fingerprint(vehicleId,actor.id,value),key:requestKey(vehicleId,actor.id,value),origin:proof,coverage};
}
async function storedProposal(tx:PartnershipExecutor,row:Row):Promise<Proposal>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_distribution_proposal */ SELECT id,new_values FROM financial_audit_logs WHERE transaction_id=${Number(row.id)} AND action='vehicle_partnership_financial_requested' ORDER BY id LIMIT 2`));
 if(rows.length!==1)conflict("طلب الحصة بلا إثبات مصدر وحيد");if(!["pending","executed","rejected"].includes(String(row.approval_status)))conflict("حالة طلب الحصة غير معروفة");const audit=object(rows[0].new_values),proposal=object(audit.sourceSnapshot) as unknown as Proposal,value=command(proposal.command);
 if(proposal.formatVersion!==1||!Array.isArray(proposal.coverage)||proposal.coverage.length>500||proposal.key!==requestKey(partnershipId(proposal.vehicleId),partnershipId(proposal.actorId),value)||proposal.fingerprint!==fingerprint(proposal.vehicleId,proposal.actorId,value)||audit.sourceDigest!==hash(proposal)||Number(audit.vehicleId)!==proposal.vehicleId||Number(audit.partnershipId)!==proposal.partnershipId||audit.sourceType!=="vehicle_partnership_settlement"||Number(audit.sourceId)!==value.rightId||audit.amount!==value.amount||row.source_type!=="vehicle_partnership_settlement"||String(row.source_id)!==String(value.rightId)||row.source_event!=="distribution"||row.transaction_type!=="vp_partner_distribution"||row.direction!=="expense"||parseMoney(String(row.amount))!==parseMoney(value.amount)||row.transaction_date!==value.transactionDate||row.payment_method!==value.paymentMethod||row.idempotency_key!==proposal.key||row.reversed_transaction_id!=null)conflict("طلب صرف الحصة لا يطابق اقتراحه الأصلي المحفوظ");
 validatePayoutCapacity({amount:value.amount,availableAmount:value.amount,ownPendingAmount:"0.00",reservedAmount:"0.00",coverage:proposal.coverage.map(item=>({...item,availableAmount:item.amount,ownPendingAmount:"0.00",reservedAmount:"0.00"}))});return proposal;
}
async function allocations(tx:PartnershipExecutor,row:Row,proposal:Proposal){
 const rows=partnershipRows(await tx.execute(sql`/* vp_distribution_allocations */ SELECT id,right_id,financial_transaction_id,conversion_allocation_id,purpose,amount::text,idempotency_key FROM vehicle_partnership_settlement_allocations WHERE financial_transaction_id=${Number(row.id)} ORDER BY id LIMIT 502`));
 const expected=[{rightId:proposal.command.rightId,parent:null as number|null,purpose:"distribution",amount:proposal.command.amount,key:proposal.key+":primary"},...proposal.coverage.map(c=>({rightId:c.rightId,parent:c.conversionAllocationId,purpose:"internal_entitlement_settlement",amount:c.amount,key:proposal.key+`:coverage:${c.conversionAllocationId}`}))];
 if(rows.length!==expected.length||rows.length>501||new Set(rows.map(r=>r.id)).size!==rows.length)conflict("توزيعات طلب الحصة ناقصة أو مكررة");
 for(const item of expected){const matches=rows.filter(r=>Number(r.right_id)===item.rightId&&(r.conversion_allocation_id==null?null:Number(r.conversion_allocation_id))===item.parent&&r.purpose===item.purpose);if(matches.length!==1||Number(matches[0].financial_transaction_id)!==Number(row.id)||parseMoney(String(matches[0].amount))!==parseMoney(item.amount)||matches[0].idempotency_key!==item.key)conflict("توزيع الصرف لا يطابق الحصة وتغطيتها المحفوظتين");}
 return rows;
}
function result(row:Row){return {financialTransactionId:partnershipId(Number(row.id)),rightId:partnershipId(Number(row.source_id)),amount:formatMoney(parseMoney(String(row.amount))),approvalStatus:String(row.approval_status)};}
/** Atomic pending request only. The existing central source writer owns the FI;
 * its immutable audit plus these allocations are committed in the SAME tx. */
export async function requestPartnerDistribution(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);const value=command(input),key=requestKey(vehicleId,actor.id,value);
 return db.transaction(async tx=>{
  const scoped=await scope(tx,actor,value.rightId,vehicleId),prior=await financial(tx,{key});
  if(prior){const proof=await storedProposal(tx,prior);if(proof.partnershipId!==scoped.root.id||proof.fingerprint!==fingerprint(vehicleId,actor.id,value))conflict("مرجع طلب الحصة مستخدم لبيانات مختلفة");await allocations(tx,prior,proof);return result(prior);}
  const proposal=await makeProposal(tx,actor,vehicleId,value),created=await createRequest(tx,{sourceType:"vehicle_partnership_settlement",sourceId:value.rightId,distribution:value},actor);
  if(created.approvalStatus!=="pending")conflict("يجب أن يبدأ صرف الحصة بطلب معلق فقط");const row=await financial(tx,{id:partnershipId(created.id)});
  if(!row||row.approval_status!=="pending")conflict("تعذر تأكيد طلب الحصة المعلق");const persisted=await storedProposal(tx,row);if(canonicalPartnershipJson(persisted)!==canonicalPartnershipJson(proposal))conflict("مصدر الطلب المالي لا يطابق اقتراح الحصة");
  const entries=[{rightId:value.rightId,parent:null as number|null,purpose:"distribution",amount:value.amount,key:key+":primary"},...proposal.coverage.map(c=>({rightId:c.rightId,parent:c.conversionAllocationId,purpose:"internal_entitlement_settlement",amount:c.amount,key:key+`:coverage:${c.conversionAllocationId}`}))];
  for(const item of entries){const inserted=partnershipRows(await tx.execute(sql`/* vp_distribution_allocation_insert */ INSERT INTO vehicle_partnership_settlement_allocations (right_id,financial_transaction_id,conversion_allocation_id,purpose,amount,idempotency_key,created_by,reason) VALUES (${item.rightId},${created.id},${item.parent},${item.purpose},${item.amount},${item.key},${actor.id},${value.reason}) RETURNING id`));if(inserted.length!==1)throw new Error("Distribution reservation insert was not confirmed");}
  await allocations(tx,row,proposal);for(const id of [...new Set(entries.map(e=>e.rightId))].sort((a,b)=>a-b))await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:id});
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:scoped.root.id,actor,action:"distribution_requested",reason:value.reason,financialTransactionId:created.id,newValues:{rightId:value.rightId,amount:value.amount,sourceDigest:hash(proposal),status:"pending",cashImpact:"none"}});return result(row);
 });
}
export async function prepareDistributionFinancialRequest(tx:PartnershipExecutor,reference:{sourceType:"vehicle_partnership_settlement";sourceId:number;distribution?:unknown},actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 authorizePartnership(actor);const value=command(reference.distribution);if(value.rightId!==reference.sourceId)conflict("مرجع الحصة لا يطابق طلبها");const found=await scope(tx,actor,value.rightId),proposal=await makeProposal(tx,actor,found.root.vehicleId,value);
 return {sourceType:"vehicle_partnership_settlement",sourceId:value.rightId,sourceEvent:"distribution",transactionType:"vp_partner_distribution",direction:"expense",amount:value.amount,transactionDate:value.transactionDate,department:"transportation",description:`صرف حصة أرباح المركبة ${proposal.vehicleId}`,referenceNo:`VP-PROFIT-${value.rightId}`,idempotencyKey:proposal.key,partnershipId:proposal.partnershipId,vehicleId:proposal.vehicleId,sourceDigest:hash(proposal),sourceSnapshot:proposal,paymentMethod:value.paymentMethod,linkedFinancialTransactionId:null};
}
export type DistributionExecution={sourceType:"vehicle_partnership_settlement";transactionType:"vp_partner_distribution";alreadyExecuted:boolean;financialId:number;amount:string;counterCode:"VP-PROFIT";proposal:Proposal;context:Awaited<ReturnType<typeof sourceContext>>};
export async function prepareDistributionExecution(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor):Promise<DistributionExecution>{
 authorizePartnership(actor,true);const rightId=financialSource(initial),context=await sourceContext(tx,actor,rightId),row=await financial(tx,{id:initial.id},true);if(!row)throw new PartnershipRepositoryError("طلب صرف الحصة غير موجود",404,"NOT_FOUND");
 const proposal=await storedProposal(tx,row);if(proposal.vehicleId!==context.root.vehicleId||proposal.partnershipId!==context.root.id||proposal.command.rightId!==rightId||canonicalPartnershipJson(proposal.origin)!==canonicalPartnershipJson(await origin(tx,actor,context)))conflict("أصل الحصة المعتمد تغير أو لا يطابق الطلب");await allocations(tx,row,proposal);
 const plan:DistributionExecution={sourceType:"vehicle_partnership_settlement",transactionType:"vp_partner_distribution",alreadyExecuted:row.approval_status==="executed",financialId:initial.id,amount:proposal.command.amount,counterCode:"VP-PROFIT",proposal,context};
 if(row.reversal_txn_id!=null)conflict("طلب الحصة معكوس؛ راجع سجل الصرف");
 if(plan.alreadyExecuted){if(row.balance_before==null||row.balance_after==null||parseMoney(String(row.balance_before))-parseMoney(String(row.balance_after))!==parseMoney(plan.amount))conflict("إثبات الحركة النقدية المنفذة لا يطابق الحصة");await provePartnershipJournal(tx,initial.id,plan.amount,"VP-PROFIT","1000");for(const id of [rightId,...proposal.coverage.map(c=>c.rightId)].sort((a,b)=>a-b))await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:id});return plan;}
 if(row.approval_status!=="pending"||row.balance_before!=null||row.balance_after!=null)conflict("يمكن اعتماد طلب الحصة المعلق المطابق فقط");
 const journal=partnershipRows(await tx.execute(sql`/* vp_distribution_pending_journal */ SELECT id FROM financial_ledger_entries WHERE transaction_id=${initial.id} LIMIT 1`));if(journal.length)conflict("طلب الحصة المعلق عليه قيد سابق؛ يلزم المصالحة");
 const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:rightId}),budget=await budgets(tx,context);
 if(!state||state.approvalStatus!=="approved"||!state.payable||parseMoney(state.totalAmount)!==parseMoney(String(proposal.origin.rightAmount)))conflict("الحصة الأصلية غير معتمدة");
 const coverage=proposal.coverage.map(c=>{const current=budget.find(b=>b.rightId===c.rightId&&b.conversionAllocationId===c.conversionAllocationId);if(!current)conflict("تغطية الطلب لا تعود لتحويل الشهر المعتمد");return {...c,...current,ownPendingAmount:c.amount};});
 validatePayoutCapacity({amount:plan.amount,availableAmount:state.availableAmount,ownPendingAmount:plan.amount,reservedAmount:state.reservedAmount,coverage});return plan;
}
/** Final reconciliation/audit after the SAME central MASTER block posts once. */
export async function finishDistributionExecution(tx:PartnershipExecutor,plan:DistributionExecution,actor:PartnershipActor){
 authorizePartnership(actor,true);const confirmed=await prepareDistributionExecution(tx,{id:plan.financialId,sourceType:"vehicle_partnership_settlement",sourceId:String(plan.proposal.command.rightId)},actor);
 if(!confirmed.alreadyExecuted)conflict("الحركة النقدية للحصة لم تُنفذ بعد");const {root,row}=confirmed.context;
 if(plan.amount!==confirmed.amount||canonicalPartnershipJson(plan.proposal)!==canonicalPartnershipJson(confirmed.proposal))conflict("بيانات تأكيد صرف الحصة لا تطابق حركتها الأصلية");
 const prior=partnershipRows(await tx.execute(sql`/* vp_distribution_finished */ SELECT id,new_values FROM financial_audit_logs WHERE transaction_id=${plan.financialId} AND action='vehicle_partnership_distribution_executed' ORDER BY id LIMIT 2`));
 if(prior.length){const saved=object(prior[0].new_values);if(prior.length!==1||Number(saved.vehicleId)!==root.vehicleId||Number(saved.partnershipId)!==root.id||Number(saved.rightId)!==confirmed.proposal.command.rightId||Number(saved.closingId)!==Number(row.id)||saved.amount!==confirmed.amount||saved.status!=="executed"||saved.cashImpact!=="out")conflict("سجل تأكيد الحصة المنفذ غير مطابق");return;}
 const rights=partnershipRows(await tx.execute(sql`/* vp_distribution_profit_rights */ SELECT r.id FROM vehicle_partnership_rights r JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id WHERE r.partnership_id=${root.id} AND l.closing_id=${Number(row.id)} AND l.revision=${Number(row.revision)} AND r.category='profit' AND r.status='approved' ORDER BY r.id LIMIT 501`));
 if(!rights.length||rights.length>500)conflict("سجل حقوق أرباح الشهر غير مكتمل");let complete=true;
 for(const right of rights){const state=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:partnershipId(Number(right.id))});if(!state||parseMoney(state.remainingAmount)!==0n||parseMoney(state.reservedAmount)!==0n)complete=false;}
 if(complete&&row.status==="approved"){const updated=partnershipRows(await tx.execute(sql`/* vp_distribution_distributed */ UPDATE vehicle_partnership_closings SET status='distributed',version=version+1 WHERE id=${Number(row.id)} AND version=${Number(row.version)} AND status='approved' RETURNING id`));if(updated.length!==1)conflict("حساب الشهر تغير أثناء تأكيد توزيع الأرباح");}
 await appendPartnershipAudit(tx,{vehicleId:root.vehicleId,partnershipId:root.id,actor,action:"distribution_executed",reason:plan.proposal.command.reason,financialTransactionId:plan.financialId,newValues:{rightId:plan.proposal.command.rightId,closingId:Number(row.id),amount:plan.amount,status:"executed",cashImpact:"out"}});
}
export async function rejectDistributionFinancialTransaction(tx:PartnershipExecutor,initial:Identity,actor:PartnershipActor,reason:string,mode:"reject"|"cancel"="reject"){
 authorizePartnership(actor,mode==="reject");if(typeof reason!=="string"||reason.trim().length<3||reason.trim().length>2000)throw new PartnershipValidationError("سبب رفض الحصة مطلوب");const rightId=financialSource(initial),context=await sourceContext(tx,actor,rightId),row=await financial(tx,{id:initial.id},true);if(!row)throw new PartnershipRepositoryError("طلب الحصة غير موجود",404,"NOT_FOUND");const proposal=await storedProposal(tx,row);await allocations(tx,row,proposal);
 if(proposal.vehicleId!==context.root.vehicleId||proposal.partnershipId!==context.root.id||proposal.command.rightId!==rightId)conflict("الطلب لا يعود لاستحقاق هذه المركبة");if(row.approval_status==="rejected")return {id:initial.id};
 if(row.approval_status!=="pending"||row.balance_before!=null||row.balance_after!=null)conflict("يمكن رفض أو إلغاء طلب الحصة المعلق فقط");
 const changed=partnershipRows(await tx.execute(sql`/* vp_distribution_reject */ UPDATE financial_transactions SET approval_status='rejected',rejected_by=${actor.id},rejected_by_name=${actor.name},rejected_at=now(),rejection_reason=${reason.trim()},updated_at=now() WHERE id=${initial.id} AND approval_status='pending' RETURNING id`));if(changed.length!==1)conflict("طلب الحصة تغير أثناء الرفض");
 for(const id of [rightId,...proposal.coverage.map(c=>c.rightId)].sort((a,b)=>a-b))await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:id});
 await appendPartnershipAudit(tx,{vehicleId:context.root.vehicleId,partnershipId:context.root.id,actor,action:mode==="cancel"?"distribution_cancelled":"distribution_rejected",reason:reason.trim(),financialTransactionId:initial.id,newValues:{rightId,status:"rejected",cashImpact:"none"}});return {id:initial.id};
}
