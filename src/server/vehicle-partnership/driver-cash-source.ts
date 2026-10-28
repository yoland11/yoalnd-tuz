import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {partnershipId} from "./agreements";
import {driverAccrualDigest,driverAccrualSnapshot} from "./driver";
import {provePartnershipJournal} from "./journal";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
export type DriverCashCoverageSource={
 financialId:number;settlementId:number;entryId:number;expenseId:number;costFundingId:number;accrualFinancialId:number;driverId:number;
 amount:string;entryAmount:string;entryDate:string;transactionDate:string;paymentMethod:"cash"|"transfer"|"pos";
 reversedAmount:string;reversalTxnId:number|null;reversedAt:string|null;transactionNo:string;sourceDigest:string;
};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function one(rows:Row[],message:string):Row{if(rows.length!==1)conflict(message);return rows[0];}
function day(value:unknown):string{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)conflict("تاريخ مصدر صرف السائق غير صالح");
 return value;
}
function timestamp(value:unknown):string|null{
 if(value==null)return null;const parsed=new Date(value instanceof Date?value.getTime():String(value));
 if(!Number.isFinite(parsed.getTime()))conflict("تاريخ إثبات صرف السائق غير صالح");return parsed.toISOString();
}
function record(value:unknown):value is Row{return !!value&&typeof value==="object"&&!Array.isArray(value);}

/** Independent original-cash proof for classification inside an approved gross
 * conversion. The authorized caller already owns the partnership root lock.
 * This helper is deliberately read-only and does not call payout preflight or
 * canonical reconciliation: either would introduce recursion/extra source locks.
 * Driver liability totals remain the original employee canonical adapter's job. */
export async function proveDriverCashCoverageSource(tx:PartnershipExecutor,root:{id:number;vehicleId:number},financialId:number):Promise<DriverCashCoverageSource>{
 partnershipId(root.id);partnershipId(root.vehicleId);partnershipId(financialId);
 const financial=one(partnershipRows(await tx.execute(sql`/* vp_driver_cash_source_financial */ SELECT f.*,f.transaction_date::date::text AS transaction_date,f.amount::text AS amount,f.balance_before::text AS balance_before,f.balance_after::text AS balance_after,
  coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount,
  EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed' AND (r.direction IS DISTINCT FROM 'revenue' OR r.amount<=0 OR r.source_type IS DISTINCT FROM f.source_type OR r.source_id IS DISTINCT FROM f.source_id OR r.source_event IS DISTINCT FROM 'reversal' OR r.transaction_type IS DISTINCT FROM 'vp_driver_payment_reversal')) AS invalid_reversal
  FROM financial_transactions f WHERE f.id=${financialId} LIMIT 2`)),"صرف السائق الأصلي غير موجود أو مكرر");
 if(Number(financial.id)!==financialId||financial.source_type!=="vehicle_partnership_driver"||typeof financial.source_id!=="string"||!/^[1-9]\d*$/.test(financial.source_id)||financial.source_event!=="driver_fee_settlement"||financial.transaction_type!=="vp_driver_payment"||financial.direction!=="expense"||financial.approval_status!=="executed"||financial.reversed_transaction_id!=null||financial.invalid_reversal!==false)conflict("الحركة لا تمثل صرف أجرة سائق منفذاً من مصدره الأصلي");
 const approvedAt=timestamp(financial.approved_at),executedAt=timestamp(financial.executed_at);
 if(!Number.isSafeInteger(Number(financial.approved_by))||Number(financial.approved_by)<=0||!Number.isSafeInteger(Number(financial.executed_by))||Number(financial.executed_by)<=0||!approvedAt||!executedAt||executedAt<approvedAt)conflict("إثبات الموافقة وتنفيذ صرف السائق الأصلي غير مكتمل");
 const settlementId=partnershipId(Number(financial.source_id)),amount=formatMoney(parseMoney(String(financial.amount))),transactionDate=day(financial.transaction_date),method=String(financial.payment_method);
 const reversedAmount=formatMoney(parseMoney(String(financial.reversed_amount)));
 if(parseMoney(amount)<=0n||parseMoney(reversedAmount)>parseMoney(amount)||!["cash","transfer","pos"].includes(method)||financial.balance_before==null||financial.balance_after==null||parseMoney(String(financial.balance_before))-parseMoney(String(financial.balance_after))!==parseMoney(amount))conflict("قيمة صرف السائق أو حركته النقدية أو طريقة دفعه غير مطابقة");
 const reversalTxnId=financial.reversal_txn_id==null?null:partnershipId(Number(financial.reversal_txn_id)),reversedAt=timestamp(financial.reversed_at);
 if(typeof financial.transaction_no!=="string"||!financial.transaction_no.trim()||financial.transaction_no.length>50||/[\u0000-\u001f]/.test(financial.transaction_no)||/^FIN-TMP-/i.test(financial.transaction_no))conflict("رقم سند صرف السائق النهائي غير متاح");

 // Read all uses of this FI as well as its declared source row: a second
 // settlement must not make the same cash movement pay two employee entries.
 const settlement=one(partnershipRows(await tx.execute(sql`/* vp_driver_cash_source_settlement */ SELECT s.*,s.amount::text AS amount,s.settlement_date::date::text AS settlement_date FROM employee_finance_settlements s WHERE s.financial_transaction_id=${financialId} OR s.id=${settlementId} ORDER BY s.id LIMIT 3`)),"ربط سند السائق بتسويته مفقود أو مكرر");
 if(Number(settlement.id)!==settlementId||Number(settlement.financial_transaction_id)!==financialId||settlement.settlement_type!=="payment"||settlement.payroll_line_id!==null||parseMoney(String(settlement.amount))!==parseMoney(amount)||day(settlement.settlement_date)!==transactionDate||settlement.payment_method!==method)conflict("سند السائق لا يطابق تسوية دفع الأجرة الأصلية أو يرتبط بالراتب");
 const entryId=partnershipId(Number(settlement.entry_id));
 const entry=one(partnershipRows(await tx.execute(sql`/* vp_driver_cash_source_entry */ SELECT e.*,e.amount::text AS amount,e.entry_date::date::text AS entry_date FROM employee_finance_entries e WHERE e.id=${entryId} LIMIT 2`)),"استحقاق أجرة السائق الأصلي مفقود أو مكرر");
 if(Number(entry.id)!==entryId||entry.entry_type!=="trip_driver_fee"||entry.direction!=="payable"||entry.source_type!=="vehicle_expense"||typeof entry.source_id!=="string"||!/^[1-9]\d*$/.test(entry.source_id)||!["approved","partially_settled","settled"].includes(String(entry.status)))conflict("تسوية السائق لا ترتبط باستحقاق رحلة معتمد");
 const expenseId=partnershipId(Number(entry.source_id)),driverId=partnershipId(Number(entry.employee_id)),entryAmount=formatMoney(parseMoney(String(entry.amount))),entryDate=day(entry.entry_date);
 if(parseMoney(entryAmount)<=0n||parseMoney(amount)>parseMoney(entryAmount)||transactionDate<entryDate)conflict("صرف السائق يتجاوز أصل أجرته أو يسبق تاريخها");
 const cost=one(partnershipRows(await tx.execute(sql`/* vp_driver_cash_source_expense */ SELECT e.*,e.amount::text AS amount,e.expense_date::date::text AS cost_date,to_jsonb(e)->>'service_order_id' AS service_order_id,company.approval_status AS company_status,company.source_type AS company_source_type,company.source_id AS company_source_id FROM vehicle_expenses e LEFT JOIN financial_transactions company ON company.id=e.financial_transaction_id WHERE e.id=${expenseId} AND e.vehicle_id=${root.vehicleId} LIMIT 2`)),"مصروف أجرة السائق الأصلي لا يخص المركبة");
 if(Number(cost.id)!==expenseId||Number(cost.vehicle_id)!==root.vehicleId||Number(cost.driver_id)!==driverId||cost.expense_type!=="driver_wage"||parseMoney(String(cost.amount))!==parseMoney(entryAmount)||day(cost.cost_date)!==entryDate)conflict("استحقاق السائق لا يطابق مصروف الرحلة الأصلي");
 if(cost.financial_transaction_id!=null&&(cost.company_source_type!=="vehicle_expense"||String(cost.company_source_id)!==String(expenseId)||!["rejected","cancelled"].includes(String(cost.company_status))))conflict("مصروف أجرة السائق له حركة دفع أخرى من الشركة");

 const funding=one(partnershipRows(await tx.execute(sql`/* vp_driver_cash_source_funding */ SELECT c.* FROM vehicle_partnership_cost_funding c WHERE c.employee_finance_entry_id=${entryId} AND c.status='approved' ORDER BY c.id LIMIT 2`)),"أجرة السائق لا ترتبط بمصدر تمويل معتمد وحيد");
 const costFundingId=partnershipId(Number(funding.id));
 if(Number(funding.partnership_id)!==root.id||Number(funding.vehicle_expense_id)!==expenseId||Number(funding.employee_finance_entry_id)!==entryId||funding.status!=="approved"||funding.funding_kind!=="other"||funding.cost_class!=="operating"||funding.payer_member_id!==null||typeof funding.reason!=="string"||funding.reason.trim().length<3)conflict("مصدر تمويل أجرة السائق لا يطابق المركبة والاستحقاق الأصلي");
 const snapshot=driverAccrualSnapshot(cost,entryId,funding.reason),digest=driverAccrualDigest(cost,entryId,funding.reason);
 if(!record(funding.source_snapshot)||canonicalPartnershipJson(funding.source_snapshot)!==canonicalPartnershipJson(snapshot)||funding.source_digest!==digest)conflict("بصمة أجرة السائق أو مصروفها تغيرت بعد الاعتماد");
 const accrualFinancialId=partnershipId(Number(funding.financial_transaction_id));
 const accrual=one(partnershipRows(await tx.execute(sql`/* vp_driver_cash_source_accrual */ SELECT f.*,f.amount::text AS amount,f.transaction_date::date::text AS transaction_date,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount,EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed' AND (r.direction IS DISTINCT FROM 'revenue' OR r.amount<=0 OR r.source_type IS DISTINCT FROM f.source_type OR r.source_id IS DISTINCT FROM f.source_id OR r.source_event IS DISTINCT FROM 'reversal' OR r.transaction_type IS DISTINCT FROM 'vp_driver_accrual_reversal')) AS invalid_reversal FROM financial_transactions f WHERE f.id=${accrualFinancialId} LIMIT 2`)),"اعتماد أجرة السائق المالي مفقود أو مكرر");
 if(Number(accrual.id)!==accrualFinancialId||accrual.source_type!=="vehicle_partnership_cost"||String(accrual.source_id)!==String(costFundingId)||accrual.source_event!=="driver_accrual"||accrual.transaction_type!=="vp_driver_accrual"||accrual.direction!=="expense"||accrual.approval_status!=="executed"||parseMoney(String(accrual.amount))!==parseMoney(entryAmount)||day(accrual.transaction_date)!==entryDate||accrual.balance_before!=null||accrual.balance_after!=null||accrual.reversed_transaction_id!=null||accrual.reversal_txn_id!=null||accrual.reversed_at!=null||parseMoney(String(accrual.reversed_amount))!==0n||accrual.invalid_reversal!==false)conflict("أجرة السائق لا تطابق اعتماداً غير نقدي منفذاً وغير معكوس");
 await provePartnershipJournal(tx,accrualFinancialId,entryAmount,"5000","VP-DRIVER");
 await provePartnershipJournal(tx,financialId,amount,"VP-DRIVER","1000");
 return {financialId,settlementId,entryId,expenseId,costFundingId,accrualFinancialId,driverId,amount,entryAmount,entryDate,transactionDate,paymentMethod:method as DriverCashCoverageSource["paymentMethod"],reversedAmount,reversalTxnId,reversedAt,transactionNo:financial.transaction_no,sourceDigest:digest};
}
