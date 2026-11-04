import { evaluateResourceConflict, type ResourceOccupancy, type ResourceReservation } from "./booking-resource-conflicts";
import type { ResourceBookingRef } from "./booking-resource-conflicts";
import { lapsedLegacyReservation, lineOutstanding, lineReservedNotOut, normalizeQuantityLine, usableQuantity, type Availability, type CommitmentRow, type QuantityBuckets } from "./quantity-assets";

export type PeriodCommitment = CommitmentRow & { interval: ResourceOccupancy | null; hasResourceWindow?:boolean };

/** Scheduling only, over the original mutually-exclusive physical buckets.
 * Store holds remain global: consumable stock is not automatically replenished.
 * Missing periods or mismatched original checkout evidence are not availability.
 */
export function quantityPeriodAvailability(input:{booking:ResourceBookingRef;buckets:QuantityBuckets;rows:PeriodCommitment[];interval:ResourceOccupancy|null;otherHolds:number;/** Baghdad day; lets lapsed date-only reservations stop holding units. */today?:string}):{complete:boolean;availability:Availability|null} {
  const reservations:ResourceReservation[]=[];
  let allOut=0,otherOut=0;
  for(const row of input.rows){
    const source=row.source==="kosha_booking"?"kosha":row.source==="service_order"?"service":row.source==="rental_order"?"rental":null;
    if(!source)throw Error("Invalid quantity commitment source");
    const booking:ResourceBookingRef={source,id:row.bookingId};
    const line=normalizeQuantityLine(row.line),out=lineOutstanding(line),reserved=lineReservedNotOut(line,row.status);
    allOut+=out;
    if(source!==input.booking.source||booking.id!==input.booking.id)otherOut+=out;
    if(out)reservations.push({id:`${row.source}:${row.bookingId}:out`,booking,resource:"quantity",quantity:out,status:"checked_out",interval:null});
    if(reserved&&!(input.today&&lapsedLegacyReservation(row,input.today)))reservations.push({id:`${row.source}:${row.bookingId}:reserved`,booking,resource:"quantity",quantity:reserved,status:"reserved",interval:row.interval});
  }
  if(allOut!==input.buckets.checkedOut)return {complete:false,availability:null};
  const usable=usableQuantity(input.buckets),holds=input.otherHolds;
  if(!Number.isFinite(holds)||holds<0)throw Error("Invalid stock hold quantity");
  // A new rental has no persisted ID during this read-only preview. Use an
  // impossible database identity only inside the pure comparator; it excludes
  // no real reservation and is never sent to a database writer.
  const targetBooking = input.booking.source === "rental" && input.booking.id === 0 ? { source: "rental" as const, id: Number.MAX_SAFE_INTEGER } : input.booking;
  const result=evaluateResourceConflict({booking:targetBooking,resource:"quantity",required:1,stock:usable,stockBasis:"total_serviceable",interval:input.interval,reservations});
  if(result.reserved===null||result.available===null)return {complete:false,availability:null};
  const reserved=result.reserved-otherOut,committed=result.reserved+holds;
  return {complete:true,availability:{usable,reserved,out:otherOut,otherHolds:holds,committed,available:Math.max(0,usable-committed)}};
}
