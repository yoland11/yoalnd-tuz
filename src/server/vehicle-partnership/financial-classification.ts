import {sql,type SQL} from "drizzle-orm";
import {PartnershipRepositoryError} from "./repository";

type Rule={sourceType:string;sourceEvent:string;direction:"revenue"|"expense";cash:"none"|"in"|"out";operating:"none"|"expense";debit:string;credit:string};
/** Server-owned catalog. Neither a client flag nor the word 'expense' decides
 * cash impact. Resolve again from the actual approved source before posting. */
export const PARTNERSHIP_POSTING_TYPES={
 vp_opening_loss:{sourceType:"vehicle_partnership_opening",sourceEvent:"opening_loss",direction:"revenue",cash:"none",operating:"none",debit:"VP-LOSS",credit:"VP-OPENING-CLEAR"},
 vp_internal_entitlement:{sourceType:"vehicle_partnership_activity",sourceEvent:"internal_entitlement",direction:"expense",cash:"none",operating:"none",debit:"VP-INTERNAL",credit:"VP-PAYABLE"},
 vp_external_attribution:{sourceType:"vehicle_partnership_activity",sourceEvent:"external_attribution",direction:"revenue",cash:"none",operating:"none",debit:"VP-ACTIVITY",credit:"VP-ATTRIBUTION"},
 vp_partner_operating_advance:{sourceType:"vehicle_partnership_cost",sourceEvent:"partner_paid_cost",direction:"expense",cash:"none",operating:"expense",debit:"5000",credit:"VP-ADVANCE"},
 vp_partner_operating_capital:{sourceType:"vehicle_partnership_cost",sourceEvent:"partner_paid_cost",direction:"expense",cash:"none",operating:"expense",debit:"5000",credit:"VP-CAPITAL"},
 vp_partner_capital_advance:{sourceType:"vehicle_partnership_cost",sourceEvent:"partner_paid_cost",direction:"expense",cash:"none",operating:"none",debit:"VP-INVESTMENT",credit:"VP-ADVANCE"},
 vp_partner_capital_capital:{sourceType:"vehicle_partnership_cost",sourceEvent:"partner_paid_cost",direction:"expense",cash:"none",operating:"none",debit:"VP-INVESTMENT",credit:"VP-CAPITAL"},
 vp_driver_accrual:{sourceType:"vehicle_partnership_cost",sourceEvent:"driver_accrual",direction:"expense",cash:"none",operating:"expense",debit:"5000",credit:"VP-DRIVER"},
 vp_driver_payment:{sourceType:"vehicle_partnership_driver",sourceEvent:"driver_fee_settlement",direction:"expense",cash:"out",operating:"none",debit:"VP-DRIVER",credit:"1000"},
 vp_capital_record:{sourceType:"vehicle_partnership_right",sourceEvent:"capital_entry",direction:"revenue",cash:"none",operating:"none",debit:"VP-CAPITAL-CLEAR",credit:"VP-CAPITAL"},
 vp_month_profit:{sourceType:"vehicle_partnership_closing",sourceEvent:"monthly_result",direction:"expense",cash:"none",operating:"none",debit:"VP-RESULT",credit:"VP-PROFIT"},
 vp_month_loss:{sourceType:"vehicle_partnership_closing",sourceEvent:"monthly_result",direction:"revenue",cash:"none",operating:"none",debit:"VP-LOSS",credit:"VP-RESULT"},
 vp_partner_distribution:{sourceType:"vehicle_partnership_settlement",sourceEvent:"distribution",direction:"expense",cash:"out",operating:"none",debit:"VP-PROFIT",credit:"1000"},
 vp_partner_advance_repayment:{sourceType:"vehicle_partnership_settlement",sourceEvent:"advance_reimbursement",direction:"expense",cash:"out",operating:"none",debit:"VP-ADVANCE",credit:"1000"},
 vp_internal_settlement:{sourceType:"vehicle_partnership_settlement",sourceEvent:"internal_entitlement_settlement",direction:"expense",cash:"out",operating:"none",debit:"VP-PAYABLE",credit:"1000"},
 vp_capital_cash_received:{sourceType:"vehicle_partnership_settlement",sourceEvent:"capital_transfer",direction:"revenue",cash:"in",operating:"none",debit:"1000",credit:"VP-CAPITAL-CLEAR"},
} as const satisfies Record<string,Rule>;
export type PartnershipPostingType=keyof typeof PARTNERSHIP_POSTING_TYPES;
export type PartnershipFinancialIdentity={sourceType:string|null;transactionType:string;sourceEvent:string;direction:string;reversedTransactionId?:number|null};
export type PartnershipFinancialEffect=Omit<Rule,"operating"> & {operating:"none"|"expense"|"expense_reversal";reversal:boolean};
export const isPartnershipFinancialSource=(source:unknown):boolean=>typeof source==="string"&&source.startsWith("vehicle_partnership_");
function fail(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
/** Generic cash-box forms may not impersonate an immutable feature source.
 * A dedicated trusted server source adapter must build its request instead. */
export function assertGenericFinancialSourceInput(input:unknown):void{
 if(!input||typeof input!=="object"||Array.isArray(input))return;
 const row=input as Record<string,unknown>;
 if(isPartnershipFinancialSource(row.sourceType)||typeof row.transactionType==="string"&&row.transactionType.startsWith("vp_"))
  fail("حركة شراكة المركبة تُنشأ أو تُعدّل من مصدرها فقط، مع مراجعة الاستحقاق والموافقة المالية");
}
export function resolvePartnershipFinancialEffect(identity:PartnershipFinancialIdentity):PartnershipFinancialEffect|null{
 if(!isPartnershipFinancialSource(identity.sourceType)){
  if(identity.transactionType.startsWith("vp_"))fail("نوع الشراكة يتطلب مصدر شراكة موثّقاً");
  return null;
 }
 const reversal=identity.transactionType.endsWith("_reversal"),type=reversal?identity.transactionType.slice(0,-9):identity.transactionType;
 const rule:Rule|undefined=Object.prototype.hasOwnProperty.call(PARTNERSHIP_POSTING_TYPES,type)?PARTNERSHIP_POSTING_TYPES[type as PartnershipPostingType]:undefined;
 if(!rule||rule.sourceType!==identity.sourceType)fail("مصدر أو نوع الحركة المالية للشراكة غير معتمد");
 if(reversal){
  if(!Number.isSafeInteger(identity.reversedTransactionId)||Number(identity.reversedTransactionId)<=0||identity.sourceEvent!=="reversal")fail("مصدر العكس المالي غير موثق");
  if(identity.direction===(rule.direction)||!["revenue","expense"].includes(identity.direction))fail("اتجاه عكس الشراكة غير صحيح");
  return {...rule,direction:identity.direction as Rule["direction"],cash:rule.cash==="out"?"in":rule.cash==="in"?"out":"none",operating:rule.operating==="expense"?"expense_reversal":"none",debit:rule.credit,credit:rule.debit,reversal:true};
 }
 if(identity.reversedTransactionId!=null)fail("مصدر الحركة العكسية لا يطابق نوعها");
 if(identity.sourceEvent!==rule.sourceEvent)fail("حدث مصدر الشراكة لا يطابق نوع الحركة");
 if(identity.direction!==rule.direction)fail("اتجاه مصدر الشراكة لا يطابق نوع الحركة");
 return {...rule,reversal:false};
}
type Columns={sourceType:SQL;transactionType:SQL};
/** Partnership postings never create additional company sales/customer receipts.
 * Operating cost reversals belong to net expenses, even with revenue direction. */
export function partnershipIncomePredicate(columns:Columns):SQL{
 return sql`(left(coalesce(${columns.sourceType},''),20)<>${"vehicle_partnership_"} AND left(coalesce(${columns.transactionType},''),3)<>${"vp_"})`;
}
/** Fixed-source SQL classification for aggregate readers; no feature table
 * join/DDL dependency for an installation that has not enabled partnership. */
export function partnershipCashPredicate(columns:Columns):SQL{
 const sources=[...new Set(Object.values(PARTNERSHIP_POSTING_TYPES).filter(rule=>rule.cash!=="none").map(rule=>rule.sourceType))];
 return sql`(left(coalesce(${columns.sourceType},''),20)<>${"vehicle_partnership_"} OR ${columns.sourceType} IN (${sql.join(sources.map(source=>sql`${source}`),sql`, `)}))`;
}
export function partnershipOperatingPredicate(columns:Columns):SQL{
 const operating=Object.entries(PARTNERSHIP_POSTING_TYPES).filter(([,rule])=>rule.operating==="expense").flatMap(([type])=>[type,`${type}_reversal`]);
 return sql`(left(coalesce(${columns.sourceType},''),20)<>${"vehicle_partnership_"} OR (${columns.sourceType}=${"vehicle_partnership_cost"} AND ${columns.transactionType} IN (${sql.join(operating.map(type=>sql`${type}`),sql`, `)})))`;
}
