import {sql} from "drizzle-orm";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor} from "./agreements";
import {lockPartnershipCostContext,partnershipCostDigest,partnershipCostSnapshot} from "./costing";
import {partnershipCostPostingType,provePartnershipCostRight} from "./cost-posting";
import {provePartnershipJournal} from "./journal";
import {lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
export type AdvancePaymentOriginProof={rightId:number;costFundingId:number;expenseId:number;originalFinancialId:number;agreementId:number;memberId:number;amount:string;costDate:string;sourceDigest:string;rightSnapshot:Row};
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}

/** Stable original identity only. The root is locked before any source lock;
 * request/rejection retries can still prove history after its funding reversed.
 * Monthly coverage must acquire booking locks before the full cost context. */
export async function readAdvancePaymentScope(tx:PartnershipExecutor,actor:PartnershipActor,rightId:number,vehicleId?:number){
 authorizePartnership(actor);partnershipId(rightId);if(vehicleId!==undefined)partnershipId(vehicleId);
 const read=async()=>partnershipRows(await tx.execute(sql`/* vp_advance_payment_scope */ SELECT r.id AS right_id,r.partnership_id,r.cost_funding_id,c.vehicle_expense_id,p.vehicle_id FROM vehicle_partnership_rights r JOIN vehicle_partnerships p ON p.id=r.partnership_id JOIN vehicle_partnership_cost_funding c ON c.id=r.cost_funding_id AND c.partnership_id=r.partnership_id WHERE r.id=${rightId} LIMIT 2`));
 const rows=await read();
 if(!rows.length)throw new PartnershipRepositoryError("سلفة الشريك الأصلية غير موجودة",404,"NOT_FOUND");
 if(rows.length!==1)conflict("مرجع سلفة الشريك مكرر");
 const original=rows[0],scopedVehicleId=partnershipId(Number(original.vehicle_id));
 if(Number(original.right_id)!==rightId||vehicleId!==undefined&&scopedVehicleId!==vehicleId)throw new PartnershipRepositoryError("سلفة الشريك غير موجودة ضمن المركبة",404,"NOT_FOUND");
 const root=await lockPartnership(tx,scopedVehicleId);await readOriginalVehicle(tx,actor,scopedVehicleId);
 const current=await read();
 if(current.length!==1||Number(original.partnership_id)!==root.id||canonicalPartnershipJson(current)!==canonicalPartnershipJson(rows))conflict("تغير نطاق مصدر السلفة أثناء المراجعة");
 return {root,rightId,costFundingId:partnershipId(Number(original.cost_funding_id)),expenseId:partnershipId(Number(original.vehicle_expense_id))};
}

/** Proves the existing approved partner-paid cost and its original advance.
 * No settlement/cached balance, current ownership or current staff activity is
 * authority for the liability. Caller owns all subsequent canonical/cash work. */
export async function lockAdvancePaymentOrigin(tx:PartnershipExecutor,actor:PartnershipActor,rightId:number,vehicleId?:number){
 const scope=await readAdvancePaymentScope(tx,actor,rightId,vehicleId);
 const {root,cost,row:funding}=await lockPartnershipCostContext(tx,actor,scope.costFundingId);
 if(root.id!==scope.root.id||root.vehicleId!==scope.root.vehicleId||Number(cost.id)!==scope.expenseId||Number(funding.id)!==scope.costFundingId||Number(funding.partnership_id)!==root.id||Number(funding.vehicle_expense_id)!==scope.expenseId||funding.status!=="approved"||funding.funding_kind!=="partner_advance"||!["operating","capital"].includes(String(funding.cost_class))||funding.payer_member_id==null||funding.employee_finance_entry_id!=null||typeof funding.reason!=="string"||funding.reason.trim().length<3)conflict("مصدر السلفة لا يطابق مصروف الشريك المعتمد");
 if(cost.expense_type==="driver_wage"&&funding.cost_class==="capital")conflict("أجرة السائق ليست استثماراً رأسمالياً");
 const costFundingId=scope.costFundingId,expenseId=scope.expenseId,memberId=partnershipId(Number(funding.payer_member_id)),amount=formatMoney(parseMoney(String(cost.amount))),costDate=String(cost.cost_date);
 const savedFunding={partnership_id:funding.partnership_id,payer_member_id:funding.payer_member_id,funding_kind:funding.funding_kind,cost_class:funding.cost_class,reason:funding.reason};
 const expectedSnapshot=partnershipCostSnapshot(cost,savedFunding),sourceDigest=partnershipCostDigest(cost,savedFunding);
 if(!funding.source_snapshot||typeof funding.source_snapshot!=="object"||Array.isArray(funding.source_snapshot)||canonicalPartnershipJson(funding.source_snapshot)!==canonicalPartnershipJson(expectedSnapshot)||funding.source_digest!==sourceDigest)conflict("تغير المصروف أو إثبات تمويل السلفة منذ اعتمادها");
 const originalFinancialId=partnershipId(Number(funding.financial_transaction_id));
 const rights=partnershipRows(await tx.execute(sql`/* vp_advance_payment_right */ SELECT r.*,r.amount::text AS amount FROM vehicle_partnership_rights r WHERE r.id=${rightId} FOR UPDATE OF r`));
 if(rights.length!==1)conflict("استحقاق السلفة الأصلي مفقود أو مكرر");const right=rights[0];
 if(Number(right.id)!==rightId||Number(right.partnership_id)!==root.id||Number(right.cost_funding_id)!==costFundingId||Number(right.member_id)!==memberId||right.activity_id!=null||right.closing_line_id!=null||right.category!=="advance"||right.direction!=="credit"||right.status!=="approved"||parseMoney(String(right.amount))!==parseMoney(amount)||right.event_key!==`vp:cost-right:${costFundingId}`||Number(right.financial_transaction_id)!==originalFinancialId||!right.source_snapshot||typeof right.source_snapshot!=="object"||Array.isArray(right.source_snapshot)||canonicalPartnershipJson(right.source_snapshot)!=="{}")conflict("استحقاق السلفة لا يطابق تمويل المصروف الأصلي");
 const agreementId=partnershipId(Number(right.agreement_id));
 const members=partnershipRows(await tx.execute(sql`/* vp_advance_payment_member */ SELECT m.id,m.agreement_id,m.party_kind,m.customer_id,m.supplier_id,m.staff_id,g.partnership_id,g.status,g.effective_from::text FROM vehicle_partnership_members m JOIN vehicle_partnership_agreements g ON g.id=m.agreement_id WHERE m.id=${memberId} AND g.id=${agreementId} AND g.partnership_id=${root.id} FOR KEY SHARE OF m,g`));
 if(members.length!==1)conflict("الشريك الأصلي للسلفة أو اتفاقه غير موجود");const member=members[0],kind=String(member.party_kind);
 if(Number(member.id)!==memberId||Number(member.agreement_id)!==agreementId||Number(member.partnership_id)!==root.id||!["approved","superseded"].includes(String(member.status))||typeof member.effective_from!=="string"||!/^(\d{4})-(\d{2})-(\d{2})$/.test(member.effective_from)||member.effective_from>costDate||!["customer","supplier","staff"].includes(kind)||[member.customer_id,member.supplier_id,member.staff_id].filter(value=>value!=null).length!==1||member[`${kind}_id`]==null)conflict("السلفة لا تعود للشريك الأصلي في اتفاق نافذ بتاريخ المصروف");
 partnershipId(Number(member[`${kind}_id`]));
 const financials=partnershipRows(await tx.execute(sql`/* vp_advance_payment_financial */ SELECT f.*,f.transaction_date::date::text AS transaction_date,f.amount::text AS amount,coalesce((SELECT sum(r.amount) FROM financial_transactions r WHERE r.reversed_transaction_id=f.id AND r.approval_status='executed'),0)::text AS reversed_amount FROM financial_transactions f WHERE f.id=${originalFinancialId} FOR UPDATE OF f`));
 if(financials.length!==1)conflict("قيد اعتماد السلفة الأصلي مفقود أو مكرر");const financial=financials[0];
 if(Number(financial.id)!==originalFinancialId||financial.source_type!=="vehicle_partnership_cost"||String(financial.source_id)!==String(costFundingId)||financial.source_event!=="partner_paid_cost"||financial.transaction_type!==partnershipCostPostingType(funding)||financial.direction!=="expense"||financial.approval_status!=="executed"||parseMoney(String(financial.amount))!==parseMoney(amount)||financial.transaction_date!==costDate||financial.payment_method!=="other"||financial.idempotency_key!==`vp:cost:${costFundingId}`||financial.balance_before!=null||financial.balance_after!=null||financial.reversed_transaction_id!=null||financial.reversal_txn_id!=null||financial.reversed_at!=null||parseMoney(String(financial.reversed_amount))!==0n)conflict("قيد السلفة لا يطابق اعتماد مصروف غير نقدي منفذاً وغير معكوس");
 if(await provePartnershipCostRight(tx,funding,originalFinancialId,amount)!==rightId)conflict("سلفة أخرى تستخدم مصدر تمويل المصروف");
 await provePartnershipJournal(tx,originalFinancialId,amount,funding.cost_class==="operating"?"5000":"VP-INVESTMENT","VP-ADVANCE");
 const proof:AdvancePaymentOriginProof={rightId,costFundingId,expenseId,originalFinancialId,agreementId,memberId,amount,costDate,sourceDigest,rightSnapshot:right.source_snapshot as Row};
 return {root,right,cost,funding,proof};
}
