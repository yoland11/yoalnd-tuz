import { sql } from "drizzle-orm";
import QRCode from "qrcode";
import { shortBookingNumber } from "@/lib/booking-number";
import { executedTransportRevenue } from "@/lib/booking-transport";
import { readTransportPlan,transportPlanFee,transportTripReference,TransportPlanError,type TransportPlan,type TransportReference } from "@/lib/booking-transport-plan";
import type { TransportReceiptData,TransportReceiptVariant } from "@/lib/transport-receipt";

type Executor={execute(query:any):Promise<any>};
export type TransportReceiptAccess={
  canView:boolean;
  canViewCustomerCharge:boolean;
  company:TransportReceiptData["company"];
  origin?:string|null;
};
const clean=(value:unknown):string|null=>typeof value==="string"?value.trim()||null:null;
function rows(value:unknown):Record<string,any>[] {
  if(!value||typeof value!=="object"||!Array.isArray((value as {rows?:unknown}).rows))throw new Error("Invalid transport receipt database response");
  return (value as {rows:Record<string,any>[]}).rows;
}
/** Called with server-derived permissions, never request-supplied access flags.
 * Whitelists fields AFTER lookup; a driver DTO never even carries customer money. */
export async function readTransportReceipt(executor:Executor,ref:TransportReference,selection:{tripId:string;variant:TransportReceiptVariant},access:TransportReceiptAccess):Promise<TransportReceiptData>{
  if(!access.canView)throw new TransportPlanError("ليس لديك صلاحية عرض وصل النقل",403);
  if(!["kosha","service"].includes(ref.source)||!Number.isSafeInteger(ref.id)||ref.id<=0||typeof selection.tripId!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(selection.tripId)||!["customer","driver","internal"].includes(selection.variant))throw new TransportPlanError("بيانات اختيار وصل النقل غير صحيحة",422);
  if(selection.variant==="customer"&&!access.canViewCustomerCharge)throw new TransportPlanError("ليس لديك صلاحية عرض أجرة نقل العميل؛ استخدم وصل السائق",403);
  const result=await executor.execute(ref.source==="kosha"?sql`
    SELECT id,tracking_code,customer_name,phone,booking_details AS details,transportation_mode,transportation_fee,
      transportation_vehicle_id,transportation_driver_id,transportation_notes
    FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL LIMIT 1`:sql`
    SELECT id,tracking_code,customer_name,phone,custom_fields AS details
    FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL LIMIT 1`);
  const found=rows(result);
  if(found.length>1)throw new Error("Ambiguous transport receipt source");
  const booking=found[0];
  if(!booking)throw new TransportPlanError("الحجز غير موجود أو مؤرشف",404);
  if(Number(booking.id)!==ref.id)throw new Error("Transport receipt source identity mismatch");
  const details=booking.details??{};
  if(typeof details!=="object"||Array.isArray(details)||details.bookingOperations!=null&&(typeof details.bookingOperations!=="object"||Array.isArray(details.bookingOperations)))throw new TransportPlanError("بيانات عمليات الحجز المحفوظة غير صالحة",422);
  const operations=details.bookingOperations??{};
  const legacy=ref.source==="kosha"&&booking.transportation_mode?{
    mode:booking.transportation_mode,fee:booking.transportation_fee,vehicleId:booking.transportation_vehicle_id,driverId:booking.transportation_driver_id,note:booking.transportation_notes,
  }:operations.transportation??null;
  const bookingNumber=shortBookingNumber(ref.source,ref.id,booking.tracking_code);
  const plan=readTransportPlan({...ref,bookingNumber,legacy,storedPlan:operations.transportPlan});
  const trip=plan.trips.find(t=>t.id===selection.tripId);
  if(!trip)throw new TransportPlanError("عملية النقل غير موجودة ضمن هذا الحجز",404);
  const [driver,vehicle]=await Promise.all([
    trip.driverId?executor.execute(sql`SELECT id,full_name,username,to_jsonb(s)->>'phone' AS phone FROM staff s WHERE id=${trip.driverId} LIMIT 1`).then(result=>rows(result)[0]??null):Promise.resolve(null),
    trip.vehicleId?executor.execute(sql`SELECT id,name,plate_number FROM fleet_vehicles WHERE id=${trip.vehicleId} LIMIT 1`).then(result=>rows(result)[0]??null):Promise.resolve(null),
  ]);
  if(driver&&Number(driver.id)!==trip.driverId||vehicle&&Number(vehicle.id)!==trip.vehicleId)throw new Error("Transport assignment identity mismatch");
  let qrUrl:string|null=null;
  if(access.origin){
    const origin=new URL(access.origin);
    if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password)throw new TransportPlanError("عنوان صفحة النقل غير آمن",422);
    const link=new URL(`/admin/bookings/${ref.source}/${ref.id}`,origin.origin);
    link.searchParams.set("tab","overview");link.searchParams.set("transportTrip",trip.id);link.hash="ajn-transport-card";qrUrl=link.toString();
  }
  const showCustomerMoney=selection.variant!=="driver"&&access.canViewCustomerCharge;
  return {
    sourceRevision:plan.revision,receiptReference:transportTripReference(bookingNumber,trip.sequence),bookingNumber,variant:selection.variant,
    company:{name:clean(access.company.name),phone:clean(access.company.phone),logoUrl:clean(access.company.logoUrl)},
    customerName:clean(booking.customer_name),customerPhone:clean(booking.phone),transportType:trip.transportType,
    origin:trip.origin,destination:trip.destination,transportDate:trip.transportDate,departureTime:trip.departureTime,expectedArrivalTime:trip.expectedArrivalTime,
    driverName:clean(driver?.full_name)||clean(driver?.username),driverPhone:trip.driverPhone??clean(driver?.phone),vehicleName:clean(vehicle?.name),vehiclePlate:clean(vehicle?.plate_number),
    assignedWork:trip.assignedWork,notes:trip.notes,status:null,
    amount:showCustomerMoney?{value:plan.feeMode==="overall"?transportPlanFee(plan):trip.customerCharge!,label:plan.feeMode==="overall"?"أجرة النقل الكلية للحجز":"مبلغ نقل هذه الرحلة"}:null,
    driverSettlement:null,qrUrl,qrDataUrl:qrUrl?await QRCode.toDataURL(qrUrl,{width:160,margin:1,errorCorrectionLevel:"M"}):null,
  };
}

/** Read-only analytical attribution. Shared overall fees are unknown per vehicle,
 * never a fabricated split or the whole fee on EACH vehicle. Costs stay one fact. */
export function projectVehicleTransportBooking(plan:TransportPlan,vehicleId:number,finance:{paid:number;total:number;approvedExpense:number}){
  if(!Number.isSafeInteger(vehicleId)||vehicleId<=0||Object.values(finance).some(v=>!Number.isFinite(v)||v<0))throw new TransportPlanError("بيانات تحليل النقل غير متطابقة",422);
  const operations=plan.trips.filter(t=>t.vehicleId===vehicleId);
  const allocated=plan.feeMode==="per_trip"||plan.trips.every(t=>t.vehicleId===vehicleId);
  const customerCharge=!operations.length?0:!allocated?null:plan.feeMode==="overall"?transportPlanFee(plan):operations.reduce((sum,t)=>sum+Math.round(t.customerCharge!*100),0)/100;
  const transportRevenue=customerCharge==null?null:executedTransportRevenue(customerCharge,finance.paid,finance.total);
  const expense=finance.approvedExpense;
  return {operations,customerCharge,transportRevenue,expense,profit:customerCharge==null?null:Math.round((customerCharge-expense)*100)/100};
}
