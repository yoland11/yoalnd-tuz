import {sql} from "drizzle-orm";
import {baghdadDay} from "../../lib/kosha-manager";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {reconcilePaymentState} from "../payment-state";
import {activityRange,readVehicleActivity} from "./activity";
import {authorizePartnership,partnershipId,readVehiclePartnership,type PartnershipActor,type PartnershipDatabase} from "./agreements";
import {lockPartnership,partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function bounded(rows:Row[],maximum:number,label:string):Row[]{
  if(rows.length>maximum)throw new PartnershipRepositoryError(`سجل ${label} يتجاوز حد العرض؛ ضيّق الفترة أو اطلب كشفاً مقسماً`,409,"LIMIT_EXCEEDED");
  if(new Set(rows.map(row=>partnershipId(Number(row.id)))).size!==rows.length)conflict(`سجل ${label} يحتوي مراجع مكررة`);
  return rows;
}
function amount(value:unknown):string{return formatMoney(parseMoney(String(value)));}
function date(value:unknown):string{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)conflict("تاريخ مصدر حساب المركبة غير صالح");
  return value;
}
const optionalId=(value:unknown)=>value==null?null:partnershipId(Number(value));
const name=(value:unknown)=>typeof value==="string"?value:null;
function version(value:unknown):number{const result=Number(value);if(!Number.isSafeInteger(result)||result<0)conflict("نسخة مصدر حساب المركبة غير صالحة");return result;}
async function sourceRows(tx:PartnershipExecutor,rootId:number,vehicleId:number,from:string,to:string){
  // Query each source independently. A join that multiplies historical funding
  // rows must not multiply a driver entitlement or a financial request.
  const closings=bounded(partnershipRows(await tx.execute(sql`/* vp_workspace_closings */ SELECT id,period::text,status,version,revision,source_digest,financial_transaction_id FROM vehicle_partnership_closings WHERE partnership_id=${rootId} ORDER BY period DESC LIMIT 121`)),120,"الإغلاقات");
  const rights=bounded(partnershipRows(await tx.execute(sql`/* vp_workspace_rights */ SELECT r.id,r.partnership_id,r.category,r.direction,r.member_id,r.amount::text,r.status,l.closing_id,h.version AS closing_version,ah.id AS advance_closing_id,ah.version AS advance_closing_version,CASE m.party_kind WHEN 'customer' THEN coalesce(nullif(c.full_name,''),c.name) WHEN 'supplier' THEN su.name WHEN 'staff' THEN coalesce(nullif(st.full_name,''),st.username) END AS member_name FROM vehicle_partnership_rights r LEFT JOIN vehicle_partnership_members m ON m.id=r.member_id LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN suppliers su ON su.id=m.supplier_id LEFT JOIN staff st ON st.id=m.staff_id LEFT JOIN vehicle_partnership_closing_lines l ON l.id=r.closing_line_id LEFT JOIN vehicle_partnership_closings h ON h.id=l.closing_id AND h.partnership_id=r.partnership_id LEFT JOIN vehicle_partnership_cost_funding af ON af.id=r.cost_funding_id AND af.partnership_id=r.partnership_id LEFT JOIN vehicle_expenses ae ON ae.id=af.vehicle_expense_id LEFT JOIN vehicle_partnership_closings ah ON r.category='advance' AND ah.partnership_id=r.partnership_id AND ah.period=date_trunc('month',ae.expense_date::date::timestamp)::date AND ah.status IN ('approved','distributed') WHERE r.partnership_id=${rootId} ORDER BY r.id LIMIT 201`)),200,"استحقاقات الشركاء");
  const drivers=bounded(partnershipRows(await tx.execute(sql`/* vp_workspace_drivers */ SELECT e.id,e.employee_id,coalesce(nullif(s.full_name,''),s.username) AS employee_name,e.amount::text,e.entry_date::text,e.status FROM employee_finance_entries e JOIN staff s ON s.id=e.employee_id WHERE e.entry_type='trip_driver_fee' AND e.direction='payable' AND e.source_type='vehicle_expense' AND EXISTS (SELECT 1 FROM vehicle_partnership_cost_funding funding JOIN vehicle_expenses expense ON expense.id=funding.vehicle_expense_id WHERE funding.partnership_id=${rootId} AND expense.vehicle_id=${vehicleId} AND funding.employee_finance_entry_id=e.id AND funding.vehicle_expense_id::text=e.source_id AND funding.funding_kind='other') ORDER BY e.id LIMIT 201`)),200,"مستحقات السائقين");
  const expenses=bounded(partnershipRows(await tx.execute(sql`/* vp_workspace_expenses */ SELECT e.id,e.expense_type,e.amount::text,e.expense_date::date::text AS expense_date,e.driver_id,e.description,e.status,(SELECT funding.status FROM vehicle_partnership_cost_funding funding WHERE funding.partnership_id=${rootId} AND funding.vehicle_expense_id=e.id ORDER BY funding.id DESC LIMIT 1) AS funding_status FROM vehicle_expenses e WHERE e.vehicle_id=${vehicleId} AND e.expense_date::date BETWEEN ${from}::date AND ${to}::date ORDER BY e.expense_date DESC,e.id DESC LIMIT 201`)),200,"المصاريف");
  const requests=bounded(partnershipRows(await tx.execute(sql`/* vp_workspace_requests */ SELECT f.id,f.source_type,f.source_id,f.source_event,f.approval_status,f.amount::text,f.transaction_date::text,f.description FROM financial_audit_logs audit JOIN financial_transactions f ON f.id=audit.transaction_id WHERE audit.action='vehicle_partnership_financial_requested' AND audit.new_values->>'partnershipId'=${String(rootId)} AND audit.new_values->>'vehicleId'=${String(vehicleId)} AND f.transaction_date BETWEEN ${from}::date AND ${to}::date ORDER BY f.id DESC LIMIT 201`)),200,"الطلبات المالية");
  return {closings,rights,drivers,expenses,requests};
}

/** Authorized operational read model. Canonical reconciliation may repair the
 * original employee payment cache inside this transaction; it never creates a
 * financial request, ledger entry, salary, expense or cash movement. */
export async function readPartnershipWorkspace(db:PartnershipDatabase,actor:PartnershipActor,vehicleId:number,filters:{from?:string|null;to?:string|null}){
  authorizePartnership(actor);partnershipId(vehicleId);
  const today=baghdadDay(),monthStart=today.slice(0,7)+"-01",monthEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10);
  const range=activityRange({vehicleId,from:filters.from||monthStart,to:filters.to||monthEnd});
  return db.transaction(async tx=>{
    const setup=await readVehiclePartnership(tx,actor,vehicleId);
    const empty={activity:null,closings:[],rights:[],driverEntries:[],expenses:[],requests:[],canApprove:actor.role==="admin",approvalHref:"/admin/finance/master-cash",from:range.from,to:range.to};
    if(!setup.partnership)return {...empty,setupState:setup.configuredElsewhere?"configured_elsewhere":"not_configured"};
    const root=await lockPartnership(tx,vehicleId),lockedSetup=await readVehiclePartnership(tx,actor,vehicleId);
    if(!lockedSetup.partnership||lockedSetup.partnership.id!==root.id)conflict("تغير إعداد شراكة المركبة أثناء العرض");
    const source=await sourceRows(tx,root.id,vehicleId,range.from,range.to);
    const rights=[];
    for(const row of source.rights){
      if(Number(row.partnership_id)!==root.id)conflict("استحقاق الشريك خارج نطاق المركبة");
      const id=partnershipId(Number(row.id)),paymentState=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_right",sourceId:id});
      rights.push({id,category:String(row.category),direction:String(row.direction),memberId:optionalId(row.member_id),memberName:name(row.member_name),amount:amount(row.amount),status:String(row.status),closingId:optionalId(row.closing_id),closingVersion:row.closing_version==null?null:version(row.closing_version),advanceClosingId:optionalId(row.advance_closing_id),advanceClosingVersion:row.advance_closing_version==null?null:version(row.advance_closing_version),paymentState});
    }
    const driverEntries=[];
    for(const row of source.drivers){
      const entryId=partnershipId(Number(row.id)),paymentState=await reconcilePaymentState(tx,{sourceType:"vehicle_partnership_driver_entitlement",sourceId:entryId});
      driverEntries.push({entryId,employeeId:partnershipId(Number(row.employee_id)),employeeName:name(row.employee_name),amount:amount(row.amount),entryDate:date(row.entry_date),status:paymentState.approvalStatus,paymentState});
    }
    const activity=lockedSetup.partnership.agreements.some(agreement=>agreement.status==="approved")?await readVehicleActivity(tx,actor,range):null;
    return {...empty,setupState:"configured",activity,rights,driverEntries,
      closings:source.closings.map(row=>({closingId:partnershipId(Number(row.id)),month:date(row.period).slice(0,7),status:String(row.status),version:version(row.version),revision:partnershipId(Number(row.revision)),sourceDigest:name(row.source_digest),financialTransactionId:optionalId(row.financial_transaction_id)})),
      expenses:source.expenses.map(row=>({id:partnershipId(Number(row.id)),expenseType:String(row.expense_type),amount:amount(row.amount),date:date(row.expense_date),driverId:optionalId(row.driver_id),description:name(row.description),status:String(row.status),fundingStatus:name(row.funding_status)})),
      requests:source.requests.map(row=>({id:partnershipId(Number(row.id)),sourceType:String(row.source_type),sourceId:String(row.source_id),sourceEvent:String(row.source_event),status:String(row.approval_status),amount:amount(row.amount),date:date(row.transaction_date),description:name(row.description)})),
    };
  });
}
