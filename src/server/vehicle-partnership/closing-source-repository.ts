import {sql} from "drizzle-orm";
import {closingMonthBounds,type ClosingTerm} from "../../lib/vehicle-partnership/closing";
import {authorizePartnership,partnershipId,readVehiclePartnership,type PartnershipActor} from "./agreements";
import {collectClosingEvidence,type ActivityClosingEvidence,type CostClosingEvidence,type CompanyClosingEvidence,type ClosingFinancialEvent} from "./closing-evidence";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function record(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid stored closing evidence object");return value as Row;}
function text(value:unknown):string{if(typeof value!=="string")throw new Error("Invalid stored closing evidence text");return value;}
const positive=(value:unknown)=>partnershipId(Number(value));
const optionalId=(value:unknown)=>value==null?null:positive(value);
function financial(value:unknown):ClosingFinancialEvent{
 if(value==null)conflict("مصدر الإغلاق بلا مرجع مالي أصلي؛ يلزم المراجعة");const row=record(value);
 return {id:positive(row.id),sourceType:text(row.sourceType),sourceId:text(row.sourceId),event:row.event==null?null:text(row.event),type:text(row.type),direction:text(row.direction),amount:text(row.amount),date:text(row.date),status:text(row.status),reversalOf:optionalId(row.reversalOf)};
}
function reversals(value:unknown){if(!Array.isArray(value))throw new Error("Invalid stored closing reversal list");return value.map(financial);}
/** Aliases are server-owned enum constants, never request/query input. Amounts
 * remain decimal TEXT inside JSON; PostgreSQL JSON numerics would lose cents
 * when the driver decodes them to JavaScript floating point. */
function eventJson(alias:"f"|"r"){
 const c=(name:string)=>sql.raw(`${alias}.${name}`);
 return sql`jsonb_build_object('id',${c("id")},'sourceType',${c("source_type")},'sourceId',${c("source_id")},'event',${c("source_event")},'type',${c("transaction_type")},'direction',${c("direction")},'amount',${c("amount")}::text,'date',${c("transaction_date")}::text,'status',${c("approval_status")},'reversalOf',${c("reversed_transaction_id")})`;
}
const financialColumn=()=>sql`CASE WHEN f.id IS NULL THEN NULL ELSE ${eventJson("f")} END AS financial`;
const reversalColumn=()=>sql`coalesce((SELECT jsonb_agg(v.event ORDER BY v.id) FROM (SELECT r.id,${eventJson("r")} AS event FROM financial_transactions r WHERE r.reversed_transaction_id=f.id ORDER BY r.id LIMIT 1001) v),'[]'::jsonb) AS reversals`;
function limited(rows:Row[],label:string){if(rows.length>2000)throw new PartnershipRepositoryError(`تجاوزت ${label} حد القراءة؛ لا يمكن اعتماد إجمالي مقتطع`,409,"LIMIT_EXCEEDED");return rows;}

/** Read-only ORIGINAL-source evidence for a later transactional preview/close.
 * Caller must ALSO review current source completeness, chronology and approved
 * loss rights before approving a month. This reader alone never certifies a
 * complete closing and never posts money or modifies original records. */
export async function readClosingSourceEvidence(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,month:string){
 authorizePartnership(actor);partnershipId(vehicleId);const range=closingMonthBounds(month);
 const setup=await readVehiclePartnership(tx,actor,vehicleId),root=setup.partnership;
 if(!root||root.ownershipType!=="partnership")conflict("المركبة ليست ضمن اتفاق شراكة فعال");
 const agreements=root.agreements.filter(a=>a.status==="approved"&&a.effectiveFrom<=range.to).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
 if(!agreements.length)conflict("لا يوجد اتفاق معتمد نافذ لشهر الإغلاق");
 const terms:ClosingTerm[]=agreements.map(a=>({id:a.id,effectiveFrom:a.effectiveFrom,members:a.members.map(m=>({id:m.id,partyKey:`${m.party.kind}:${m.party.id}`,profitBasisPoints:m.profitBasisPoints,expenseBasisPoints:m.expenseBasisPoints}))}));
 const activation=agreements[0].effectiveFrom;
 // Read from activation, including inactive history. Filtering only the current
 // month or latest funding would lose refunds and superseded original wages.
 const activityRows=limited(partnershipRows(await tx.execute(sql`/* vp_closing_source_activities */ SELECT a.*,a.amount::text AS amount,${vehicleId}::integer AS vehicle_id,a.recognition_date::text AS recognition_date,${financialColumn()},${reversalColumn()} FROM vehicle_partnership_activity a LEFT JOIN financial_transactions f ON f.id=a.financial_transaction_id WHERE a.partnership_id=${root.id} AND a.recognition_date BETWEEN ${activation}::date AND ${range.to}::date ORDER BY a.id LIMIT 2001`)),"مصادر النقل");
 const costRows=limited(partnershipRows(await tx.execute(sql`/* vp_closing_source_costs */ SELECT c.*,e.vehicle_id,${financialColumn()},${reversalColumn()} FROM vehicle_partnership_cost_funding c JOIN vehicle_expenses e ON e.id=c.vehicle_expense_id LEFT JOIN financial_transactions f ON f.id=c.financial_transaction_id WHERE c.partnership_id=${root.id} AND coalesce(nullif(c.source_snapshot->>'date','')::date,${activation}::date) BETWEEN ${activation}::date AND ${range.to}::date ORDER BY c.id LIMIT 2001`)),"مصادر تمويل المصاريف");
 const companyRows=limited(partnershipRows(await tx.execute(sql`/* vp_closing_source_company_costs */ SELECT e.id,e.vehicle_id,jsonb_build_object('expenseId',e.id,'vehicleId',e.vehicle_id,'date',e.expense_date::date::text,'amount',e.amount::text,'expenseType',e.expense_type,'status',e.status,'bookingId',e.booking_id,'serviceOrderId',nullif(to_jsonb(e)->>'service_order_id','')::integer,'driverId',e.driver_id,'description',e.description,'attachments',to_jsonb(e)->'attachments','financialTransactionId',e.financial_transaction_id) AS snapshot,${financialColumn()},${reversalColumn()} FROM vehicle_expenses e LEFT JOIN financial_transactions f ON f.id=e.financial_transaction_id WHERE e.vehicle_id=${vehicleId} AND e.expense_date::date BETWEEN ${activation}::date AND ${range.to}::date AND (e.financial_transaction_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM vehicle_partnership_cost_funding c WHERE c.vehicle_expense_id=e.id AND c.partnership_id=${root.id} AND c.status IN ('pending','approved'))) ORDER BY e.id LIMIT 2001`)),"مصاريف الشركة الأصلية");
 const activities:ActivityClosingEvidence[]=activityRows.map(row=>{
  const references=[["kosha",row.kosha_booking_id],["service",row.service_order_id],["delivery",row.delivery_order_id]].filter(([,value])=>value!=null);
  if(references.length!==1)conflict("مرجع عملية النقل الأصلية غير صالح للإغلاق");
  const incomeBasis=text(row.income_basis);if(incomeBasis!=="internal"&&incomeBasis!=="external")conflict("أساس دخل النقل غير معروف");
  return {id:positive(row.id),partnershipId:positive(row.partnership_id),vehicleId:positive(row.vehicle_id),agreementId:positive(row.agreement_id),original:{source:String(references[0][0]),id:positive(references[0][1])},incomeBasis,amount:text(row.amount),recognitionDate:text(row.recognition_date),status:text(row.status),sourceDigest:text(row.source_digest),snapshot:record(row.source_snapshot),reason:text(row.reason),financial:financial(row.financial),reversals:reversals(row.reversals)};
 });
 const costs:CostClosingEvidence[]=costRows.map(row=>({id:positive(row.id),partnershipId:positive(row.partnership_id),vehicleId:positive(row.vehicle_id),expenseId:positive(row.vehicle_expense_id),fundingKind:text(row.funding_kind),costClass:text(row.cost_class),employeeEntryId:optionalId(row.employee_finance_entry_id),payerMemberId:optionalId(row.payer_member_id),status:text(row.status),sourceDigest:text(row.source_digest),snapshot:record(row.source_snapshot),reason:text(row.reason),financial:financial(row.financial),reversals:reversals(row.reversals)}));
 const companyCosts:CompanyClosingEvidence[]=companyRows.map(row=>({expenseId:positive(row.id),vehicleId:positive(row.vehicle_id),snapshot:record(row.snapshot),financial:row.financial==null?null:financial(row.financial),reversals:reversals(row.reversals)}));
 const evidence=collectClosingEvidence({vehicleId,partnershipId:root.id,...range,terms,activities,costs,companyCosts});
 return {...evidence,vehicleId,partnershipId:root.id,setupVersion:root.version,...range,agreements,terms};
}
