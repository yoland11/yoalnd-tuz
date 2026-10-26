import {sql,type SQL} from "drizzle-orm";
import {closingMonthBounds} from "../../lib/vehicle-partnership/closing";
import {authorizePartnership,partnershipId,readOriginalVehicle,type PartnershipActor} from "./agreements";
import {lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Group="kosha"|"service"|"delivery"|"dispatch"|"delivery_details"|"sales_invoice"|"order"|"expense"|"activity"|"funding"|"employee"|"closing"|"closing_line"|"right"|"financial";
const TABLES:Record<Group,string>={kosha:"kosha_bookings",service:"service_orders",delivery:"delivery_orders",dispatch:"dispatch_assignments",delivery_details:"delivery_details",sales_invoice:"sales_invoices",order:"orders",expense:"vehicle_expenses",activity:"vehicle_partnership_activity",funding:"vehicle_partnership_cost_funding",employee:"employee_finance_entries",closing:"vehicle_partnership_closings",closing_line:"vehicle_partnership_closing_lines",right:"vehicle_partnership_rights",financial:"financial_transactions"};
const originals:readonly Group[]=["kosha","service","sales_invoice","order","delivery_details","delivery","dispatch"];
const later=["expense","activity","funding","employee","closing","closing_line","right","financial"] as const satisfies readonly Group[];
const inIds=(ids:readonly number[])=>ids.length?sql.join(ids.map(id=>sql`${id}`),sql`, `):sql`NULL`;
function changed(message:string):never{throw new PartnershipRepositoryError(message,409,"SOURCE_CHANGED");}
function ids(rows:Record<string,unknown>[],limit:number):number[]{
 if(rows.length>limit)throw new PartnershipRepositoryError("مصادر الإغلاق تتجاوز حد القفل الآمن؛ راجع فترة أصغر قبل المتابعة",409,"LIMIT_EXCEEDED");
 const result=rows.map(row=>partnershipId(Number(row.id)));
 if(new Set(result).size!==result.length)changed("هوية مصدر الإغلاق مكررة");return result.sort((a,b)=>a-b);
}
async function candidates(tx:PartnershipExecutor,group:Group,query:SQL,limit=2000){
 return ids(partnershipRows(await tx.execute(sql`${sql.raw(`/* vp_closing_lock_candidates:${group} */`)} ${query} ORDER BY id LIMIT ${sql.raw(String(limit+1))}`)),limit);
}
async function lockRows(tx:PartnershipExecutor,group:Group,expected:readonly number[]){
 if(!expected.length)return;
 const actual=ids(partnershipRows(await tx.execute(sql`${sql.raw(`/* vp_closing_lock_rows:${group} */`)} SELECT id FROM ${sql.identifier(TABLES[group])} WHERE id IN (${inIds(expected)}) ORDER BY id FOR UPDATE`)),expected.length);
 if(actual.length!==expected.length||actual.some((id,index)=>id!==expected[index]))changed("تغيرت هوية أحد مصادر الإغلاق أثناء القفل؛ أعد المحاولة");
}
type CandidateSet=Record<Group,number[]>;

/** The caller owns the existing transaction and re-runs the authoritative
 * preview AFTER this helper. No financial calculation or write is performed.
 *
 * Existing booking writers lock their booking before fleet resources, so the
 * same order is retained here. Fleet FOR UPDATE (not KEY SHARE) also blocks
 * new FK-linked expenses, dispatches and Kosha vehicle assignments. Recheck
 * membership after the barrier and abort instead of acquiring a newly found
 * booking under fleet, which could invert that original writer's lock order.
 *
 * JSON-only service identities also rely on the original mutation/creation
 * guard's terminal/unchanged-resource fleet barrier. Out-of-band database
 * writers are not authorized by this helper. Recognized partnership and
 * original vehicle-cost events share root locking; late sources remain
 * explicit closing/adjustment blockers. Live concurrency needs isolated TEST.
 */
export async function lockClosingOriginalSources(tx:PartnershipExecutor,actor:PartnershipActor,vehicleId:number,month:string):Promise<void>{
 authorizePartnership(actor);partnershipId(vehicleId);const range=closingMonthBounds(month);
 const root=await lockPartnership(tx,vehicleId);
 await readOriginalVehicle(tx,actor,vehicleId);
 if(root.ownershipType!=="partnership")changed("المركبة لا تستخدم اتفاق شراكة فعالاً");
 const activity=(field:"kosha_booking_id"|"service_order_id"|"delivery_order_id",alias:string)=>sql`EXISTS(SELECT 1 FROM vehicle_partnership_activity a WHERE a.partnership_id=${root.id} AND ${sql.raw(`a.${field}=${alias}.id`)} AND a.recognition_date<=${range.to}::date)`;
 const sourceQueries:Record<"kosha"|"service"|"delivery",SQL>={
  kosha:sql`SELECT k.id FROM kosha_bookings k WHERE (k.transportation_vehicle_id=${vehicleId} AND k.transportation_mode='ajn' AND k.archived_at IS NULL AND k.status NOT IN ('cancelled','canceled') AND (left(k.event_date,10) BETWEEN ${range.from} AND ${range.to} OR k.event_date IS NULL OR k.event_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')) OR ${activity("kosha_booking_id","k")} OR EXISTS(SELECT 1 FROM vehicle_partnership_cost_funding c WHERE c.partnership_id=${root.id} AND c.source_snapshot->>'bookingId'=k.id::text) OR EXISTS(SELECT 1 FROM vehicle_expenses e WHERE e.vehicle_id=${vehicleId} AND e.booking_id=k.id AND e.expense_date::date<=${range.to}::date)`,
  service:sql`SELECT s.id FROM service_orders s WHERE (s.custom_fields->'bookingOperations'->'transportation'->>'vehicleId'=${String(vehicleId)} AND s.custom_fields->'bookingOperations'->'transportation'->>'mode'='ajn' AND s.archived_at IS NULL AND s.status NOT IN ('cancelled','canceled') AND (left(s.event_date,10) BETWEEN ${range.from} AND ${range.to} OR s.event_date IS NULL OR s.event_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')) OR ${activity("service_order_id","s")} OR EXISTS(SELECT 1 FROM vehicle_partnership_cost_funding c WHERE c.partnership_id=${root.id} AND c.source_snapshot->>'serviceOrderId'=s.id::text) OR EXISTS(SELECT 1 FROM vehicle_expenses e WHERE e.vehicle_id=${vehicleId} AND to_jsonb(e)->>'service_order_id'=s.id::text AND e.expense_date::date<=${range.to}::date)`,
  delivery:sql`SELECT d.id FROM delivery_orders d WHERE EXISTS(SELECT 1 FROM dispatch_assignments da JOIN delivery_details dd ON dd.id=d.delivery_details_id WHERE da.entity_type='delivery_order' AND da.entity_id=d.id AND da.vehicle_id=${vehicleId} AND d.status NOT IN ('cancelled','returned') AND (left(dd.expected_ship_date::text,10) BETWEEN ${range.from} AND ${range.to} OR dd.expected_ship_date IS NULL OR dd.expected_ship_date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')) OR ${activity("delivery_order_id","d")}`,
 };
 const originalCandidates=async()=>{
  const result={} as CandidateSet;
  for(const group of ["kosha","service","delivery"] as const)result[group]=await candidates(tx,group,sourceQueries[group]);
  result.dispatch=await candidates(tx,"dispatch",sql`SELECT id FROM dispatch_assignments WHERE entity_type='delivery_order' AND entity_id IN (${inIds(result.delivery)})`);
  result.delivery_details=await candidates(tx,"delivery_details",sql`SELECT id FROM delivery_details WHERE id IN (SELECT delivery_details_id FROM delivery_orders WHERE id IN (${inIds(result.delivery)}))`);
  result.sales_invoice=await candidates(tx,"sales_invoice",sql`SELECT id FROM sales_invoices WHERE id IN (SELECT sales_invoice_id FROM delivery_orders WHERE id IN (${inIds(result.delivery)}))`);
  result.order=await candidates(tx,"order",sql`SELECT id FROM orders WHERE id IN (SELECT order_id FROM delivery_orders WHERE id IN (${inIds(result.delivery)}))`);
  return result;
 };
 const before=await originalCandidates();
 // Invoice editors take invoice -> details -> delivery; original dispatch
 // writers take fleet -> dispatch. Keep both real parent/child orders.
 for(const group of originals)if(group!=="dispatch")await lockRows(tx,group,before[group]);
 const fleet=partnershipRows(await tx.execute(sql`/* vp_closing_fleet_barrier */ SELECT id FROM fleet_vehicles WHERE id=${vehicleId} FOR UPDATE`));
 if(fleet.length!==1||Number(fleet[0].id)!==vehicleId)changed("هوية المركبة تغيرت أثناء قفل مصادر الإغلاق");
 const after=await originalCandidates();
 for(const group of originals)if(canonicalIds(before[group])!==canonicalIds(after[group]))changed("ظهرت أو تغيرت مصادر نقل أثناء قفل الإغلاق؛ أعد المحاولة");
 await lockRows(tx,"dispatch",after.dispatch);
 const remaining:Record<typeof later[number],SQL>={
  expense:sql`SELECT id FROM vehicle_expenses WHERE vehicle_id=${vehicleId} AND expense_date::date<=${range.to}::date`,
  activity:sql`SELECT id FROM vehicle_partnership_activity WHERE partnership_id=${root.id} AND recognition_date<=${range.to}::date`,
  funding:sql`SELECT id FROM vehicle_partnership_cost_funding WHERE partnership_id=${root.id}`,
  employee:sql`SELECT id FROM employee_finance_entries WHERE id IN (SELECT employee_finance_entry_id FROM vehicle_partnership_cost_funding WHERE partnership_id=${root.id})`,
  closing:sql`SELECT id FROM vehicle_partnership_closings WHERE partnership_id=${root.id} AND period<=${range.to}::date`,
  closing_line:sql`SELECT id FROM vehicle_partnership_closing_lines WHERE closing_id IN (SELECT id FROM vehicle_partnership_closings WHERE partnership_id=${root.id} AND period<=${range.to}::date)`,
  right:sql`SELECT id FROM vehicle_partnership_rights WHERE partnership_id=${root.id}`,
  financial:sql`WITH source_ids AS (
   SELECT financial_transaction_id AS id FROM vehicle_partnership_activity WHERE partnership_id=${root.id} AND recognition_date<=${range.to}::date
   UNION SELECT financial_transaction_id FROM vehicle_partnership_cost_funding WHERE partnership_id=${root.id}
   UNION SELECT financial_transaction_id FROM vehicle_expenses WHERE vehicle_id=${vehicleId} AND expense_date::date<=${range.to}::date
   UNION SELECT financial_transaction_id FROM vehicle_partnership_closings WHERE partnership_id=${root.id} AND period<=${range.to}::date
   UNION SELECT financial_transaction_id FROM vehicle_partnership_rights WHERE partnership_id=${root.id}
   UNION SELECT financial_transaction_id FROM vehicle_partnership_settlement_allocations WHERE right_id IN (SELECT id FROM vehicle_partnership_rights WHERE partnership_id=${root.id})
  ) SELECT id FROM financial_transactions WHERE id IN (SELECT id FROM source_ids) OR reversed_transaction_id IN (SELECT id FROM source_ids)`,
 };
 for(const group of later){const selected=await candidates(tx,group,remaining[group],group==="financial"||group==="closing_line"||group==="right"?5000:2000);await lockRows(tx,group,selected);}
}
function canonicalIds(values:readonly number[]):string{return values.join(",");}
