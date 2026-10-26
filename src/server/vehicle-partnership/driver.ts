import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {reconcilePaymentState} from "../payment-state";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {readPartnershipOriginalCost,type lockPartnershipCostContext} from "./costing";
import {appendPartnershipAudit,lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
import type {PartnershipFinancialRequestWriter,TrustedPartnershipRequest} from "./accounting";
type Row=Record<string,unknown>;
type CostContext=Awaited<ReturnType<typeof lockPartnershipCostContext>>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
const schema=z.object({expenseId:z.number().int().positive(),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().trim().min(8).max(180),reason:z.string().trim().min(3).max(2000)}).strict();
export function driverAccrualSnapshot(cost:Row,entryId:number,reason:string){
 return {expenseId:partnershipId(Number(cost.id)),vehicleId:partnershipId(Number(cost.vehicle_id)),driverId:partnershipId(Number(cost.driver_id)),expenseType:String(cost.expense_type),amount:formatMoney(parseMoney(String(cost.amount))),date:String(cost.cost_date),bookingId:cost.booking_id==null?null:partnershipId(Number(cost.booking_id)),serviceOrderId:cost.service_order_id==null?null:partnershipId(Number(cost.service_order_id)),description:cost.description??null,attachments:cost.attachments??[],originalFinancialId:cost.financial_transaction_id==null?null:partnershipId(Number(cost.financial_transaction_id)),employeeFinanceEntryId:partnershipId(entryId),reason};
}
export function driverAccrualDigest(cost:Row,entryId:number,reason:string):string{
 return createHash("sha256").update(canonicalPartnershipJson(driverAccrualSnapshot(cost,entryId,reason))).digest("hex");
}
async function originalDriver(tx:PartnershipExecutor,cost:Row,rootId:number):Promise<number>{
 if(cost.expense_type!=="driver_wage"||cost.driver_id==null)conflict("اختر مصروف أجرة سائق أصلياً مرتبطاً بالسائق لهذه الرحلة");
 const driverId=partnershipId(Number(cost.driver_id));
 const staff=partnershipRows(await tx.execute(sql`/* vp_driver_original_staff */ SELECT id FROM staff WHERE id=${driverId} FOR KEY SHARE`));
 if(staff.length!==1||Number(staff[0].id)!==driverId)conflict("السائق المرتبط بمصروف الرحلة غير موجود");
 const agreements=partnershipRows(await tx.execute(sql`/* vp_driver_agreement */ SELECT id FROM vehicle_partnership_agreements WHERE partnership_id=${rootId} AND status='approved' AND effective_from<=${String(cost.cost_date)}::date ORDER BY effective_from DESC LIMIT 1 FOR KEY SHARE`));
 if(agreements.length!==1)conflict("يجب اعتماد اتفاق شراكة نافذ بتاريخ الرحلة قبل تسجيل أجرها المستحق");
 return driverId;
}
export async function preparePartnershipDriverAccrual(tx:PartnershipExecutor,context:CostContext,actor:PartnershipActor):Promise<TrustedPartnershipRequest>{
 authorizePartnership(actor);const {root,cost,row}=context;
 if(root.ownershipType!=="partnership"||row.status!=="pending"||row.funding_kind!=="other"||row.cost_class!=="operating"||row.employee_finance_entry_id==null||row.payer_member_id!=null)conflict("مصدر أجرة السائق ليس استحقاقاً معلقاً صالحاً");
 const driverId=await originalDriver(tx,cost,root.id),entryId=partnershipId(Number(row.employee_finance_entry_id));
 const entries=partnershipRows(await tx.execute(sql`/* vp_driver_entry_source */ SELECT * FROM employee_finance_entries WHERE id=${entryId} FOR UPDATE`));
 if(entries.length!==1)conflict("مصدر استحقاق الموظف غير موجود");const entry=entries[0];
 if(Number(entry.employee_id)!==driverId||entry.entry_type!=="trip_driver_fee"||entry.direction!=="payable"||entry.source_type!=="vehicle_expense"||String(entry.source_id)!==String(cost.id)||entry.status!=="pending"||parseMoney(String(entry.amount))!==parseMoney(String(cost.amount))||parseMoney(String(entry.settled_amount))!==0n||parseMoney(String(entry.remaining_amount))!==parseMoney(String(cost.amount)))conflict("استحقاق السائق لا يطابق أجرة الرحلة الأصلية");
 const digest=driverAccrualDigest(cost,entryId,String(row.reason));if(digest!==row.source_digest)conflict("أجرة الرحلة أو سائقها تغيرت؛ راجع طلب الاستحقاق قبل الاعتماد");
 return {sourceType:"vehicle_partnership_cost",sourceId:partnershipId(Number(row.id)),sourceEvent:"driver_accrual",transactionType:"vp_driver_accrual",direction:"expense",amount:formatMoney(parseMoney(String(cost.amount))),transactionDate:String(cost.cost_date),department:"transportation",description:`أجرة سائق مستحقة للرحلة — ${String(cost.description??"")}`,referenceNo:`VE-${Number(cost.id)}`,idempotencyKey:`vp:driver-accrual:${Number(row.id)}`,partnershipId:root.id,vehicleId:root.vehicleId,sourceDigest:digest,linkedFinancialTransactionId:row.financial_transaction_id==null?null:partnershipId(Number(row.financial_transaction_id)),employeeFinanceEntryId:entryId};
}
const dto=(row:Row)=>({costFundingId:partnershipId(Number(row.id)),employeeFinanceEntryId:partnershipId(Number(row.employee_finance_entry_id)),financialTransactionId:partnershipId(Number(row.financial_transaction_id)),status:String(row.status)});
/** ONE derived employee entitlement for the ORIGINAL per-trip vehicle expense.
 * No independent fee input, recurring salary, new trip or duplicate cost. */
export async function submitPartnershipDriverAccrual(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,input:unknown,createRequest:PartnershipFinancialRequestWriter){
 authorizePartnership(actor);partnershipId(vehicleId);const parsed=schema.safeParse(input);if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(issue=>issue.message).join("؛ "));const command=parsed.data;
 return db.transaction(async tx=>{
  const root=await lockPartnership(tx,vehicleId);await readOriginalVehicle(tx,actor,vehicleId,true);if(root.ownershipType!=="partnership")conflict("المركبة ليست ضمن شراكة فعالة");
  const cost=await readPartnershipOriginalCost(tx,vehicleId,command.expenseId),driverId=await originalDriver(tx,cost,root.id),amount=formatMoney(parseMoney(String(cost.amount)));
  const replay=partnershipRows(await tx.execute(sql`/* vp_driver_replay */ SELECT * FROM vehicle_partnership_cost_funding WHERE idempotency_key=${command.idempotencyKey}`));
  if(replay.length){if(replay.length!==1||Number(replay[0].partnership_id)!==root.id||replay[0].funding_kind!=="other"||replay[0].source_digest!==driverAccrualDigest(cost,Number(replay[0].employee_finance_entry_id),command.reason))conflict("مرجع استحقاق السائق مستخدم لبيانات أخرى");return dto(replay[0]);}
  if(root.version!==command.expectedVersion)conflict("تغير اتفاق الشراكة؛ حدّث البيانات قبل تسجيل الاستحقاق");
  const costs=partnershipRows(await tx.execute(sql`/* vp_driver_existing_cost */ SELECT id FROM vehicle_partnership_cost_funding WHERE vehicle_expense_id=${command.expenseId} AND status IN ('pending','approved') FOR UPDATE`));
  if(costs.length)conflict("لأجرة الرحلة مصدر تمويل أو استحقاق مسجل؛ لا تنشئ أجرة ثانية");
  const prior=partnershipRows(await tx.execute(sql`/* vp_driver_existing_entry */ SELECT * FROM employee_finance_entries WHERE source_type='vehicle_expense' AND source_id=${String(command.expenseId)} ORDER BY id LIMIT 2 FOR UPDATE`));
  if(prior.length>1)conflict("يوجد أكثر من استحقاق مرتبط بالأجرة الأصلية؛ يلزم مراجعة المصادر");
  const previous=prior[0]??null;let entries:Row[];
  if(previous){
   if(previous.entry_type!=="trip_driver_fee"||previous.direction!=="payable"||!["rejected","cancelled"].includes(String(previous.status))||parseMoney(String(previous.settled_amount))!==0n||parseMoney(String(previous.remaining_amount))!==parseMoney(String(previous.amount)))conflict("يوجد استحقاق موظف نشط أو رصيد قديم غير مثبت؛ لا يمكن إعادة تسجيله");
   const settlements=partnershipRows(await tx.execute(sql`/* vp_driver_entry_history */ SELECT id FROM employee_finance_settlements WHERE entry_id=${Number(previous.id)} ORDER BY id LIMIT 1 FOR UPDATE`));
   if(settlements.length)conflict("لا يمكن إعادة تسعير استحقاق له سجل تسويات؛ استخدم تصحيحاً مالياً معتمداً");
   entries=partnershipRows(await tx.execute(sql`/* vp_driver_entry_resubmit */ UPDATE employee_finance_entries SET employee_id=${driverId},entry_date=${String(cost.cost_date)},amount=${amount},remaining_amount=${amount},description=${String(cost.description??"أجرة سائق الرحلة")},notes=${command.reason},attachments=${JSON.stringify(cost.attachments??[])}::jsonb,submitted_by=${actor.id},submitted_by_name=${actor.name},status='pending',settled_amount=0,approved_by=NULL,approved_by_name='',approved_at=NULL,rejected_by=NULL,rejected_at=NULL,rejection_reason=NULL,updated_at=now() WHERE id=${Number(previous.id)} AND status IN ('rejected','cancelled') RETURNING *`));
  }else{
   entries=partnershipRows(await tx.execute(sql`INSERT INTO employee_finance_entries (employee_id,entry_no,entry_date,amount,remaining_amount,description,source_id,submitted_by,submitted_by_name,notes,attachments,entry_type,direction,source_type,status,settled_amount,category) VALUES (${driverId},${`DRV-VE-${command.expenseId}`},${String(cost.cost_date)},${amount},${amount},${String(cost.description??"أجرة سائق الرحلة")},${String(command.expenseId)},${actor.id},${actor.name},${command.reason},${JSON.stringify(cost.attachments??[])}::jsonb,'trip_driver_fee','payable','vehicle_expense','pending',0,'vehicle_driver') RETURNING *`));
  }
  if(entries.length!==1)throw new Error("Driver employee entitlement insert was not confirmed");const entryId=partnershipId(Number(entries[0].id));
  const digest=driverAccrualDigest(cost,entryId,command.reason);
  const rows=partnershipRows(await tx.execute(sql`INSERT INTO vehicle_partnership_cost_funding (partnership_id,vehicle_expense_id,employee_finance_entry_id,source_digest,idempotency_key,created_by,reason,funding_kind,cost_class,status,source_snapshot) VALUES (${root.id},${command.expenseId},${entryId},${digest},${command.idempotencyKey},${actor.id},${command.reason},'other','operating','pending',${JSON.stringify(driverAccrualSnapshot(cost,entryId,command.reason))}::jsonb) RETURNING *`));
  if(rows.length!==1)throw new Error("Driver cost link insert was not confirmed");const fundingId=partnershipId(Number(rows[0].id));
  const financial=await createRequest(tx,{sourceType:"vehicle_partnership_cost",sourceId:fundingId},actor);if(!Number.isSafeInteger(financial.id)||financial.id<=0||financial.approvalStatus!=="pending")throw new Error("Driver accrual requires central pending financial approval");
  const linked=partnershipRows(await tx.execute(sql`UPDATE vehicle_partnership_cost_funding SET financial_transaction_id=${financial.id} WHERE id=${fundingId} AND financial_transaction_id IS NULL AND status='pending' RETURNING id`));if(linked.length!==1||Number(linked[0].id)!==fundingId)throw new Error("Driver financial request link was not confirmed");
  const payment=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});if(parseMoney(payment.approvedPaidAmount)!==0n||parseMoney(payment.reservedAmount)!==0n)conflict("تسجيل أجر السائق لا يمثل صرفاً نقدياً");
  await appendPartnershipAudit(tx,{vehicleId,partnershipId:root.id,actor,action:"driver_accrual_submitted",reason:command.reason,financialTransactionId:financial.id,...(previous?{oldValues:{employeeEntitlement:previous}}:{}),newValues:{expenseId:command.expenseId,driverId,employeeFinanceEntryId:entryId,costFundingId:fundingId,amount,status:"pending",cashImpact:"none",resubmitted:previous!=null}});
  return dto({...rows[0],financial_transaction_id:financial.id});
 });
}
