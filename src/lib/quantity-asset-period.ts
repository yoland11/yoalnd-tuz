import { evaluateResourceConflict, type ResourceOccupancy, type ResourceReservation } from "./booking-resource-conflicts";
import type { BookingOperationRef } from "./booking-operational-readiness";
import { lineOutstanding, lineReservedNotOut, normalizeQuantityLine, usableQuantity, type Availability, type CommitmentRow, type QuantityBuckets } from "./quantity-assets";

export type PeriodCommitment = CommitmentRow & { interval: ResourceOccupancy | null; hasResourceWindow?:boolean };

/** Scheduling only, over the original mutually-exclusive physical buckets.
 * Store holds remain global: consumable stock is not automatically replenished.
 * Missing periods or mismatched original checkout evidence are not availability.
 */
export function quantityPeriodAvailability(input:{booking:BookingOperationRef;buckets:QuantityBuckets;rows:PeriodCommitment[];interval:ResourceOccupancy|null;otherHolds:number}):{complete:boolean;availability:Availability|null} {
  const reservations:ResourceReservation[]=[];
  let allOut=0,otherOut=0;
  for(const row of input.rows){
    const source=row.source==="kosha_booking"?"kosha":row.source==="service_order"?"service":null;
    if(!source)throw Error("Invalid quantity commitment source");
    const booking:BookingOperationRef={source,id:row.bookingId};
    const line=normalizeQuantityLine(row.line),out=lineOutstanding(line),reserved=lineReservedNotOut(line,row.status);
    allOut+=out;
    if(source!==input.booking.source||booking.id!==input.booking.id)otherOut+=out;
    if(out)reservations.push({id:`${row.source}:${row.bookingId}:out`,booking,resource:"quantity",quantity:out,status:"checked_out",interval:null});
    if(reserved)reservations.push({id:`${row.source}:${row.bookingId}:reserved`,booking,resource:"quantity",quantity:reserved,status:"reserved",interval:row.interval});
  }
  if(allOut!==input.buckets.checkedOut)return {complete:false,availability:null};
  const usable=usableQuantity(input.buckets),holds=input.otherHolds;
  if(!Number.isFinite(holds)||holds<0)throw Error("Invalid stock hold quantity");
  const result=evaluateResourceConflict({booking:input.booking,resource:"quantity",required:1,stock:usable,stockBasis:"total_serviceable",interval:input.interval,reservations});
  if(result.reserved===null||result.available===null)return {complete:false,availability:null};
  const reserved=result.reserved-otherOut,committed=result.reserved+holds;
  return {complete:true,availability:{usable,reserved,out:otherOut,otherHolds:holds,committed,available:Math.max(0,usable-committed)}};
}
