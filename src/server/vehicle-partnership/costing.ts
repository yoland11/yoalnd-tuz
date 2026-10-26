import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {activityRange} from "./activity";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import type {PartnershipFinancialRequestReference,PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from "./accounting";
import {preparePartnershipDriverAccrual} from "./driver";

type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
const costSchema=z.object({expenseId:z.number().int().positive(),payerMemberId:z.number().int().positive(),fundingKind:z.enum(["partner_advance","partner_capital"]),costClass:z.enum(["operating","capital"]),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000)}).strict();

/** Optional extension of the ORIGINAL vehicle-expense financial path. Checking
 * installation is read-only; absent feature tables never trigger runtime DDL.
 * Both old cash approval and new funding acquire root -> expense -> financial. */
export async function lockPartnershipOriginalVehicleExpense(tx:PartnershipExecutor,initial:{id:number;sourceType:string|null;sourceId:string|null},mode:"execute"|"cancel"|"reject"|"reverse"):Promise<void>{
 if(initial.sourceType!=="vehicle_expense")return;
 const schema=partnershipRows(await tx.execute(sql`/* vp_original_expense_schema */ SELECT to_regclass('public.vehicle_partnerships') IS NOT NULL AND to_regclass('public.vehicle_partnership_cost_funding') IS NOT NULL AS present`));
 if(schema.length!==1||typeof schema[0].present!=="boolean")throw new Error("Invalid partnership installation metadata");
 if(schema[0].present===false)return;
 if(!initial.sourceId||!/^[1-9]\d*$/.test(initial.sourceId))throw new PartnershipValidationError("مصدر مصروف المركبة غير صالح");
 const expenseId=partnershipId(Number(initial.sourceId));
 const roots=partnershipRows(await tx.execute(sql`/* vp_original_expense_root */ SELECT p.id,p.vehicle_id FROM vehicle_partnerships p JOIN vehicle_expenses e ON e.vehicle_id=p.vehicle_id WHERE e.id=${expenseId} FOR UPDATE OF p`));
 if(!roots.length)return;if(roots.length!==1)throw new Error("Ambiguous original expense partnership");
 const expenses=partnershipRows(await tx.execute(sql`/* vp_original_expense_lock */ SELECT id,financial_transaction_id FROM vehicle_expenses WHERE id=${expenseId} AND vehicle_id=${Number(roots[0].vehicle_id)} FOR UPDATE`));
 if(expenses.length!==1||Number(expenses[0].id)!==expenseId||Number(expenses[0].financial_transaction_id)!==initial.id)conflict("طلب مصروف المركبة لا يطابق مرجعه المالي الأصلي");
 const funding=partnershipRows(await tx.execute(sql`/* vp_original_expense_funding */ SELECT id,status FROM vehicle_partnership_cost_funding WHERE vehicle_expense_id=${expenseId} AND partnership_id=${Number(roots[0].id)} AND status IN ('pending','approved') FOR UPDATE`));
 if(funding.length&&(mode==="execute"||mode==="reverse"))conflict("للمصروف تمويل مسجل من الشريك؛ راجعه من حسابات الشراكة لمنع الدفع مرتين");
}

/** Original expense is locked after the partnership root and before any new
 * financial source. An old pending cash request must first be cancelled via
 * its original workflow; this command cannot silently convert it or pay twice. */
export async function readPartnershipOriginalCost(tx:PartnershipExecutor,vehicleId:number,expenseId:number):Promise<Row>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_cost_original */ SELECT e.*,to_jsonb(e)->>'service_order_id' AS service_order_id,e.expense_date::date::text AS cost_date,f.approval_status AS financial_status,f.source_type AS financial_source_type,f.source_id AS financial_source_id FROM vehicle_expenses e LEFT JOIN financial_transactions f ON f.id=e.financial_transaction_id WHERE e.id=${partnershipId(expenseId)} AND e.vehicle_id=${partnershipId(vehicleId)} FOR UPDATE OF e`));
 if(!rows.length)throw new PartnershipRepositoryError("مصروف المركبة الأصلي غير موجود",404,"NOT_FOUND");
 if(rows.length!==1||Number(rows[0].id)!==expenseId||Number(rows[0].vehicle_id)!==vehicleId)throw new Error("Invalid original vehicle cost identity");
 const cost=rows[0];activityRange({vehicleId,from:cost.cost_date,to:cost.cost_date});
 if(parseMoney(String(cost.amount))<=0n)conflict("مصروف الشريك يجب أن يطابق مصروفاً أصلياً موجباً");
 if(cost.financial_transaction_id!=null){
  if(cost.financial_source_type!=="vehicle_expense"||String(cost.financial_source_id)!==String(expenseId))conflict("المرجع المالي للمصروف الأصلي غير مطابق");
  if(cost.financial_status==="executed")conflict("المصروف مدفوع من الشركة؛ لا يمكن تسجيله مرة ثانية على الشريك");
  if(cost.financial_status!=="rejected"&&cost.financial_status!=="cancelled")conflict("ألغِ طلب صرف المصروف المعلّق من مساره الأصلي قبل تصنيفه مدفوعاً من الشريك");
 }
 return cost;
}
async function payerAgreement(tx:PartnershipExecutor,rootId:number,memberId:number,date:string):Promise<Row>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_cost_member */ SELECT m.id,m.agreement_id,g.partnership_id,g.status,g.effective_from::text FROM vehicle_partnership_members m JOIN vehicle_partnership_agreements g ON g.id=m.agreement_id WHERE m.id=${partnershipId(memberId)} AND g.partnership_id=${rootId} AND g.status='approved' AND g.effective_from<=${date}::date AND NOT EXISTS (SELECT 1 FROM vehicle_partnership_agreements later WHERE later.partnership_id=g.partnership_id AND later.status='approved' AND later.effective_from<=${date}::date AND later.effective_from>g.effective_from) FOR KEY SHARE OF m,g`));
 if(rows.length!==1||Number(rows[0].id)!==memberId||Number(rows[0].partnership_id)!==rootId||rows[0].status!=="approved"||String(rows[0].effective_from)>date)conflict("الشريك الدافع ليس ضمن الاتفاق المعتمد النافذ بتاريخ المصروف");
 return rows[0];
}
export function partnershipCostSnapshot(cost:Row,funding:Pick<Row,"partnership_id"|"payer_member_id"|"funding_kind"|"cost_class"|"reason">){
 return {expenseId:partnershipId(Number(cost.id)),vehicleId:partnershipId(Number(cost.vehicle_id)),amount:formatMoney(parseMoney(String(cost.amount))),date:String(cost.cost_date),expenseType:String(cost.expense_type),driverId:cost.driver_id==null?null:partnershipId(Number(cost.driver_id)),bookingId:cost.booking_id==null?null:partnershipId(Number(cost.booking_id)),serviceOrderId:cost.service_order_id==null?null:partnershipId(Number(cost.service_order_id)),description:cost.description??null,attachments:cost.attachments??[],originalFinancialId:cost.financial_transaction_id==null?null:partnershipId(Number(cost.financial_transaction_id)),partnershipId:partnershipId(Number(funding.partnership_id)),payerMemberId:partnershipId(Number(funding.payer_member_id)),fundingKind:funding.funding_kind,costClass:funding.cost_class,reason:funding.reason};
}
export function partnershipCostDigest(cost:Row,funding:Pick<Row,"partnership_id"|"payer_member_id"|"funding_kind"|"cost_class"|"reason">):string{
 return createHash("sha256").update(canonicalPartnershipJson(partnershipCostSnapshot(cost,funding))).digest("hex");
}
export async function lockPartnershipCostContext(tx:PartnershipExecutor,actor:PartnershipActor,costFundingId:number){
 authorizePartnership(actor);partnershipId(costFundingId);
 const read=async(lock=false)=>partnershipRows(await tx.execute(sql`/* vp_cost_source */ SELECT c.*,p.vehicle_id FROM vehicle_partnership_cost_funding c JOIN vehicle_partnerships p ON p.id=c.partnership_id WHERE c.id=${costFundingId} ${lock?sql`FOR UPDATE OF c`:sql``}`));
 const initial=await read();if(!initial.length)throw new PartnershipRepositoryError("مصدر تمويل المصروف غير موجود",404,"NOT_FOUND");
 if(initial.length!==1)throw new Error("Ambiguous partnership cost funding identity");
 const root=await lockPartnership(tx,partnershipId(Number(initial[0].vehicle_id)));await readOriginalVehicle(tx,actor,root.vehicleId,true);
 const cost=await readPartnershipOriginalCost(tx,root.vehicleId,partnershipId(Number(initial[0].vehicle_expense_id)));
 const locked=await read(true);if(locked.length!==1||Number(locked[0].partnership_id)!==root.id||Number(locked[0].vehicle_expense_id)!==Number(cost.id))conflict("تغير مصدر المصروف أثناء المراجعة");
 return {root,cost,row:locked[0]};
}
export async function preparePartnershipCostRequest(tx:PartnershipExecutor,reference:PartnershipFinancialRequestReference,actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 authorizePartnership(actor);if(reference.sourceType!=="vehicle_partnership_cost")conflict("نوع مصدر تمويل المصروف غير مطابق");
 const {root,cost,row}=await lockPartnershipCostContext(tx,actor,reference.sourceId);
 if(row.funding_kind==="other"&&row.employee_finance_entry_id!=null)return preparePartnershipDriverAccrual(tx,{root,cost,row},actor);
 if(root.ownershipType!=="partnership"||row.status!=="pending"||!["partner_advance","partner_capital"].includes(String(row.funding_kind))||!["operating","capital"].includes(String(row.cost_class)))conflict("تمويل المصروف ليس طلب شراكة معلقاً صالحاً");
 const payer=await payerAgreement(tx,root.id,partnershipId(Number(row.payer_member_id)),String(cost.cost_date));
 if(cost.expense_type==="driver_wage"&&row.cost_class==="capital")conflict("أجرة السائق ليست استثماراً رأسمالياً");
 const digest=partnershipCostDigest(cost,{partnership_id:row.partnership_id,payer_member_id:row.payer_member_id,funding_kind:row.funding_kind,cost_class:row.cost_class,reason:row.reason});if(digest!==row.source_digest)conflict("تغير المصروف أو تصنيف تمويله؛ يجب مراجعة الطلب قبل الاعتماد");
 const transactionType=row.cost_class==="operating"?(row.funding_kind==="partner_advance"?"vp_partner_operating_advance":"vp_partner_operating_capital"):(row.funding_kind==="partner_advance"?"vp_partner_capital_advance":"vp_partner_capital_capital");
 return {sourceType:"vehicle_partnership_cost",sourceId:reference.sourceId,sourceEvent:"partner_paid_cost",transactionType,direction:"expense",amount:formatMoney(parseMoney(String(cost.amount))),transactionDate:String(cost.cost_date),department:"transportation",description:`مصروف مركبة مدفوع من الشريك — ${String(cost.description??cost.expense_type)}`,referenceNo:`VE-${Number(cost.id)}`,idempotencyKey:`vp:cost:${reference.sourceId}`,partnershipId:root.id,vehicleId:root.vehicleId,sourceDigest:digest,linkedFinancialTransactionId:row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id)),agreementId:partnershipId(Number(payer.agreement_id)),memberId:partnershipId(Number(row.payer_member_id))};
}
const dto=(row:Row)=>({costFundingId:partnershipId(Number(row.id)),expenseId:partnershipId(Number(row.vehicle_expense_id)),status:String(row.status),financialTransactionId:partnershipId(Number(row.financial_transaction_id))});
export async function submitPartnershipCost(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);const parsed=costSchema.safeParse(input);
 if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(issue=>issue.message).join("؛ "));const command=parsed.data;
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId,true);
  if(root.ownershipType!=="partnership")conflict("المركبة ليست ضمن شراكة فعالة");
  const cost=await readPartnershipOriginalCost(tx,vehicleId,command.expenseId);
  await payerAgreement(tx,root.id,command.payerMemberId,String(cost.cost_date));
  if(cost.expense_type==="driver_wage"&&command.costClass==="capital")conflict("أجرة السائق ليست استثماراً رأسمالياً");
  const sourceDigest=partnershipCostDigest(cost,{partnership_id:root.id,payer_member_id:command.payerMemberId,funding_kind:command.fundingKind,cost_class:command.costClass,reason:command.reason});
  const replay=partnershipRows(await tx.execute(sql`/* vp_cost_replay */ SELECT * FROM vehicle_partnership_cost_funding WHERE idempotency_key=${command.idempotencyKey}`));
  if(replay.length){if(replay.length!==1||replay[0].source_digest!==sourceDigest||Number(replay[0].partnership_id)!==root.id)conflict("مرجع تمويل المصروف مستخدم لبيانات أخرى");return dto(replay[0]);}
  if(root.version!==command.expectedVersion)conflict("تغير اتفاق الشراكة؛ حدّث البيانات قبل إرسال المصروف");
  const existing=partnershipRows(await tx.execute(sql`/* vp_cost_existing */ SELECT id,status FROM vehicle_partnership_cost_funding WHERE vehicle_expense_id=${command.expenseId} AND status IN ('pending','approved') FOR UPDATE`));
  if(existing.length)conflict("للمصروف تصنيف تمويل مسجل؛ راجعه أو صححه بمسار معتمد دون إنشاء مصروف مكرر");
  const rows=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_cost_funding (partnership_id,vehicle_expense_id,payer_member_id,funding_kind,cost_class,source_digest,idempotency_key,created_by,reason,status,source_snapshot) VALUES (${root.id},${command.expenseId},${command.payerMemberId},${command.fundingKind},${command.costClass},${sourceDigest},${command.idempotencyKey},${actor.id},${command.reason},'pending',${JSON.stringify(partnershipCostSnapshot(cost,{partnership_id:root.id,payer_member_id:command.payerMemberId,funding_kind:command.fundingKind,cost_class:command.costClass,reason:command.reason}))}::jsonb) RETURNING *`));
  if(rows.length!==1)throw new Error("Cost funding insert was not confirmed");const id=partnershipId(Number(rows[0].id));
  const financial=await createRequest(tx,{sourceType:"vehicle_partnership_cost",sourceId:id},actor);
  if(!Number.isSafeInteger(financial.id)||financial.id<=0||financial.approvalStatus!=="pending")throw new Error("Cost funding requires a pending central financial request");
  const linked=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_cost_funding SET financial_transaction_id=${financial.id} WHERE id=${id} AND financial_transaction_id IS NULL AND status='pending' RETURNING id`));
  if(linked.length!==1||Number(linked[0].id)!==id)throw new Error("Cost financial link was not confirmed");
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"cost_submitted",reason:command.reason,financialTransactionId:financial.id,newValues:{costFundingId:id,expenseId:command.expenseId,payerMemberId:command.payerMemberId,fundingKind:command.fundingKind,costClass:command.costClass,status:"pending"}});
  return dto({...rows[0],financial_transaction_id:financial.id});
 });
}
