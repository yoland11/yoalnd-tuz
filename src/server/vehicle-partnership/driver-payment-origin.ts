import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {authorizePartnership,partnershipId,type PartnershipActor} from "./agreements";
import {lockPartnershipCostContext} from "./costing";
import {driverAccrualDigest,driverAccrualSnapshot} from "./driver";
import {provePartnershipJournal} from "./journal";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
export type DriverPaymentOriginProof={entryId:number;employeeId:number;expenseId:number;costFundingId:number;accrualFinancialId:number;amount:string;entryDate:string;sourceDigest:string};
type DriverPaymentOrigin={root:Awaited<ReturnType<typeof lockPartnershipCostContext>>["root"];entry:Row;cost:Row;funding:Row;proof:DriverPaymentOriginProof};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}

/** Proves the existing approved per-trip wage without reconciling settlements.
 * The caller owns the transaction and may still be staging an unlinked payment.
 * Historical staff/vehicle activity and cached paid balances are not authority. */
export async function lockDriverPaymentOrigin(tx:PartnershipExecutor,actor:PartnershipActor,entryId:number,vehicleId?:number):Promise<DriverPaymentOrigin>{
 authorizePartnership(actor);partnershipId(entryId);if(vehicleId!==undefined)partnershipId(vehicleId);
 const scopes=partnershipRows(await tx.execute(sql`/* vp_driver_payment_origin_scope */ SELECT c.id,c.partnership_id,c.vehicle_expense_id,c.employee_finance_entry_id,p.vehicle_id FROM vehicle_partnership_cost_funding c JOIN vehicle_partnerships p ON p.id=c.partnership_id WHERE c.employee_finance_entry_id=${entryId} AND c.status='approved' ORDER BY c.id LIMIT 2`));
 if(!scopes.length)throw new PartnershipRepositoryError("لا يوجد مصدر أجرة سائق معتمد لهذا الاستحقاق",404,"NOT_FOUND");
 if(scopes.length!==1)conflict("استحقاق السائق مرتبط بأكثر من مصدر أجرة معتمد");
 const scope=scopes[0],scopedVehicleId=partnershipId(Number(scope.vehicle_id)),costFundingId=partnershipId(Number(scope.id));
 if(Number(scope.employee_finance_entry_id)!==entryId||vehicleId!==undefined&&scopedVehicleId!==vehicleId)conflict("استحقاق السائق لا يخص المركبة المطلوبة");

 // Reuse the common root -> original vehicle/expense -> funding lock order;
 // only then lock the employee entitlement and its original accrual financial.
 const {root,cost,row:funding}=await lockPartnershipCostContext(tx,actor,costFundingId);
 if(root.vehicleId!==scopedVehicleId||Number(scope.partnership_id)!==root.id||Number(scope.vehicle_expense_id)!==Number(cost.id)||Number(funding.id)!==costFundingId||Number(funding.partnership_id)!==root.id||Number(funding.vehicle_expense_id)!==Number(cost.id)||Number(funding.employee_finance_entry_id)!==entryId||funding.status!=="approved"||funding.funding_kind!=="other"||funding.cost_class!=="operating"||funding.payer_member_id!=null)conflict("مصدر أجرة السائق لا يطابق التكلفة المعتمدة الأصلية");
 if(cost.expense_type!=="driver_wage"||cost.driver_id==null)conflict("مصروف الرحلة الأصلي ليس أجرة سائق موثقة");
 const expenseId=partnershipId(Number(cost.id)),employeeId=partnershipId(Number(cost.driver_id)),amount=formatMoney(parseMoney(String(cost.amount))),entryDate=String(cost.cost_date);
 const entries=partnershipRows(await tx.execute(sql`/* vp_driver_payment_origin_entry */ SELECT *,entry_date::date::text AS entry_date,amount::text AS amount FROM employee_finance_entries WHERE id=${entryId} FOR UPDATE`));
 if(entries.length!==1)conflict("مصدر استحقاق الموظف غير موجود أو مكرر");
 const entry=entries[0];
 if(Number(entry.id)!==entryId||Number(entry.employee_id)!==employeeId||entry.entry_type!=="trip_driver_fee"||entry.direction!=="payable"||entry.source_type!=="vehicle_expense"||String(entry.source_id)!==String(expenseId)||!["approved","partially_settled","settled"].includes(String(entry.status))||parseMoney(String(entry.amount))!==parseMoney(amount)||String(entry.entry_date)!==entryDate)conflict("استحقاق السائق لا يطابق أجرة الرحلة الأصلية المعتمدة");
 const reason=String(funding.reason),snapshot=driverAccrualSnapshot(cost,entryId,reason),sourceDigest=driverAccrualDigest(cost,entryId,reason);
 if(!funding.source_snapshot||typeof funding.source_snapshot!=="object"||Array.isArray(funding.source_snapshot)||canonicalPartnershipJson(funding.source_snapshot)!==canonicalPartnershipJson(snapshot)||funding.source_digest!==sourceDigest)conflict("تغيرت بيانات أجرة الرحلة أو بصمتها منذ اعتماد الاستحقاق");

 if(funding.financial_transaction_id==null||!Number.isSafeInteger(Number(funding.financial_transaction_id))||Number(funding.financial_transaction_id)<=0)conflict("مرجع اعتماد أجرة السائق المالي مفقود");
 const accrualFinancialId=Number(funding.financial_transaction_id);
 const financialRows=partnershipRows(await tx.execute(sql`/* vp_driver_payment_origin_accrual */ SELECT f.*,f.transaction_date::date::text AS transaction_date,f.amount::text AS amount,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount FROM financial_transactions f WHERE f.id=${accrualFinancialId} FOR UPDATE OF f`));
 if(financialRows.length!==1)conflict("قيد اعتماد أجرة السائق مفقود أو مكرر");
 const financial=financialRows[0];
 if(Number(financial.id)!==accrualFinancialId||financial.source_type!=="vehicle_partnership_cost"||String(financial.source_id)!==String(costFundingId)||financial.source_event!=="driver_accrual"||financial.transaction_type!=="vp_driver_accrual"||financial.direction!=="expense"||financial.approval_status!=="executed"||parseMoney(String(financial.amount))!==parseMoney(amount)||String(financial.transaction_date)!==entryDate||financial.balance_before!=null||financial.balance_after!=null||financial.reversed_transaction_id!=null||financial.reversal_txn_id!=null||financial.reversed_at!=null||parseMoney(String(financial.reversed_amount))!==0n)conflict("قيد أجرة السائق لا يطابق اعتماداً غير نقدي منفذاً وغير معكوس");
 await provePartnershipJournal(tx,accrualFinancialId,amount,"5000","VP-DRIVER");
 return {root,entry,cost,funding,proof:{entryId,employeeId,expenseId,costFundingId,accrualFinancialId,amount,entryDate,sourceDigest}};
}
