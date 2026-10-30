import {sql} from "drizzle-orm";
import {shortBookingNumber} from "../lib/booking-number";
import {readTransportPlan,TransportPlanError,type TransportPlanView} from "../lib/booking-transport-plan";
import {projectVehicleTransportBooking} from "./booking-transport-receipt";

type Executor={execute:(query:any)=>Promise<any>};
export type VehiclePlanBooking={source:"kosha"|"service";id:number;bookingNo:string;customerName:string;eventDate:string|null;total:number;paid:number;paymentStatus:string|null;plan:TransportPlanView};
export type VehicleTransportFinancialTrip={source:"kosha"|"service";bookingId:number;bookingNo:string;customerName:string;eventDate:string|null;transportationFee:number|null;executedTransportationRevenue:number|null;paymentStatus:string|null;executionStatus:string;driverName:string|null;tripExpense:number;tripProfit:number|null;operations?:Array<{id:string;sequence:number;destination:string|null;driverName:string|null}>};
/** Read the original JSON extension only. No trip table, writes or accounting.
 * The bound fails visibly rather than silently returning incomplete financials. */
export async function readVehicleTransportPlans(executor:Executor,filters:{vehicleId?:number;from?:string|null;to?:string|null}):Promise<VehiclePlanBooking[]>{
  const vehicleMatch=filters.vehicleId?JSON.stringify({trips:[{vehicleId:filters.vehicleId}]}):null;
  const result=await executor.execute(sql`
    SELECT 'kosha' AS source,k.id,k.tracking_code,k.customer_name,k.event_date::text,k.total_amount::text,k.paid_amount::text,k.payment_status,
      k.booking_details->'bookingOperations'->'transportPlan' AS plan,
      jsonb_build_object('mode',k.transportation_mode,'fee',k.transportation_fee,'vehicleId',k.transportation_vehicle_id,'driverId',k.transportation_driver_id,'note',k.transportation_notes) AS legacy
    FROM kosha_bookings k WHERE k.booking_details->'bookingOperations'->'transportPlan' IS NOT NULL
      AND k.archived_at IS NULL AND k.status NOT IN ('cancelled','canceled')
      ${vehicleMatch?sql`AND k.booking_details->'bookingOperations'->'transportPlan' @> ${vehicleMatch}::jsonb`:sql``}
      ${filters.from?sql`AND k.event_date::text >= ${filters.from}`:sql``}
      ${filters.to?sql`AND k.event_date::text <= ${filters.to}`:sql``}
    UNION ALL
    SELECT 'service' AS source,s.id,s.tracking_code,s.customer_name,s.event_date::text,s.total_amount::text,s.deposit_amount::text AS paid_amount,s.payment_status,
      s.custom_fields->'bookingOperations'->'transportPlan' AS plan,s.custom_fields->'bookingOperations'->'transportation' AS legacy
    FROM service_orders s WHERE s.custom_fields->'bookingOperations'->'transportPlan' IS NOT NULL
      AND s.archived_at IS NULL AND s.status NOT IN ('cancelled','canceled')
      ${vehicleMatch?sql`AND s.custom_fields->'bookingOperations'->'transportPlan' @> ${vehicleMatch}::jsonb`:sql``}
      ${filters.from?sql`AND s.event_date::text >= ${filters.from}`:sql``}
      ${filters.to?sql`AND s.event_date::text <= ${filters.to}`:sql``}
    LIMIT 1001
  `);
  if(!Array.isArray(result?.rows))throw new Error("Invalid fleet transport query response");
  if(result.rows.length>1000)throw new TransportPlanError("تجاوزت الرحلات حد التقرير؛ استخدم نطاق تاريخ أو تصفية مركبة أدق",422);
  return result.rows.map((row:any)=>{
    if(!["kosha","service"].includes(row.source)||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0)throw new Error("Invalid fleet transport source identity");
    const total=Number(row.total_amount),paid=Number(row.paid_amount);
    if(!Number.isFinite(total)||!Number.isFinite(paid)||total<0||paid<0)throw new TransportPlanError("تعذر مطابقة مبالغ الحجز في تقرير النقل",422);
    const bookingNo=shortBookingNumber(row.source,Number(row.id),row.tracking_code);
    const plan=readTransportPlan({source:row.source,id:Number(row.id),bookingNumber:bookingNo,legacy:row.legacy,storedPlan:row.plan});
    if(filters.vehicleId&&!plan.trips.some(t=>t.vehicleId===filters.vehicleId))throw new Error("Fleet plan query returned an unrelated vehicle");
    return {source:row.source,id:Number(row.id),bookingNo,customerName:String(row.customer_name??""),eventDate:row.event_date??null,total,paid,paymentStatus:row.payment_status??null,plan};
  });
}
/** The partnership ledger credits ONE vehicle with a booking's whole fee, so a fee shared
 * across vehicles cannot reach a partner's accounts correctly. Refuse it, never misattribute. */
export async function assertPlanFitsPartnershipLedger(executor:Executor,plan:{trips:readonly {vehicleId:number|null}[]}){
  const ids=[...new Set(plan.trips.map(trip=>trip.vehicleId).filter((id):id is number=>id!=null))];
  if(ids.length<2)return;
  const result=await executor.execute(sql`SELECT vehicle_id FROM vehicle_partnerships WHERE vehicle_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) LIMIT 1`);
  if(!Array.isArray(result?.rows))throw new Error("Invalid vehicle partnership query response");
  if(result.rows.length)throw new TransportPlanError("إحدى هذه السيارات عليها شراكة، وحساب الشريك يقرأ سيارة واحدة لكل حجز. اجعل رحلات هذا الحجز كلها على سيارة واحدة.",409);
}
export function addPlanVehicleStats(base:{tripCount:number;transportationRevenue:number;vehicleExpenses:number},bookings:VehiclePlanBooking[],vehicleId:number){
  let tripCount=base.tripCount,allocatedTransportationRevenue=base.transportationRevenue,unallocatedBookings=0;
  for(const booking of bookings){
    const value=projectVehicleTransportBooking(booking.plan,vehicleId,{paid:booking.paid,total:booking.total,approvedExpense:0});
    tripCount+=value.operations.length;
    if(value.customerCharge==null)unallocatedBookings++;else allocatedTransportationRevenue+=value.customerCharge;
  }
  allocatedTransportationRevenue=Math.round(allocatedTransportationRevenue*100)/100;
  return {...base,tripCount,allocatedTransportationRevenue,unallocatedBookings,transportationRevenue:unallocatedBookings?null:allocatedTransportationRevenue,netProfit:unallocatedBookings?null:Math.round((allocatedTransportationRevenue-base.vehicleExpenses)*100)/100};
}
