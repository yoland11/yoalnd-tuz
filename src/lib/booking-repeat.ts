type Details=Record<string,any>;
type RepeatDetails={ok:true;value:Details}|{ok:false;message:string};
const isObject=(value:unknown):value is Details=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const pick=(value:Details,keys:string[])=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));

/** A new destination is a request, never evidence of an old checkout, employee
 * assignment or portal record. This is pure: no source mutation, file copy,
 * reservation, financial recalculation or historical-record update. */
export function normalizeRepeatedBookingDetails(input:unknown):RepeatDetails{
  const invalid=():RepeatDetails=>({ok:false,message:"بيانات الحجز التشغيلية غير صالحة للنسخ؛ راجع الحجز الأصلي دون تغيير سجله"});
  if(input!=null&&!isObject(input))return invalid();
  const next:Details=structuredClone(input??{});
  const original=next.bookingOperations;
  if(original!=null&&!isObject(original))return invalid();
  for(const key of [
    "linkedAssets","assignedStaffId","assignedStaffName","assignedStaffIds","primaryEmployeeId","primaryEmployeeName","assistantEmployeeId","assistantEmployeeName","bookingStaffAssignments","assignedEmployees","executionTeam",
    "assignedPhotographerId","photographerId","photographyAssignments","photographers","assignedPhotographers","photographyPortal","photographyWorkflowStatus","photographyCustomerStatus",
    "transportationDriverId","transportationDriverName","transportationVehicleId","transportationVehicleName","vehicle","vehicles","team",
    "koshaPortalTimeline","koshaPortalMedia","koshaPortalDelivery","executionStage","trackingStatus",
    "bookingSource","sourceType","sourceId","externalReference","rentalOrderId","rentalOrderReference","rentalPeriod","storeOrderId","storeOrderReference","salesInvoiceId","salesInvoiceReference","originalOrderReference","sourceStatus","soundSyncState","repeatedFrom",
  ])delete next[key];
  for(const [container,key] of [[next,"transportation"],[original,"transportation"]] as const){
    if(container?.[key]!=null){if(!isObject(container[key]))return invalid();container[key]=pick(container[key],["mode","fee","note"])}
  }
  if(next.bookingCenterServices!=null){
    if(!Array.isArray(next.bookingCenterServices)||next.bookingCenterServices.some((item:unknown)=>!isObject(item)))return invalid();
    next.bookingCenterServices=next.bookingCenterServices.map((item:Details)=>({...item,status:"waiting"}));
  }
  if(next.soundItems!=null){
    if(!Array.isArray(next.soundItems)||next.soundItems.some((item:unknown)=>!isObject(item)))return invalid();
    for(const item of next.soundItems){
      if(item.rental!=null){
        if(!isObject(item.rental))return invalid();
        // Duration remains a commercial choice; dates must be confirmed for
        // the new booking instead of silently reusing the old occupancy.
        delete item.rental.startDate;
        delete item.rental.endDate;
      }
    }
  }
  if(original!=null){
    // Preserve commercial values verbatim; only original reservation writers
    // may create equipment lines or preparation/return evidence on the new ID.
    const operations=pick(original,["baseBookingAmount","productCharges","transportation"]);
    if(original.productMeta!=null){
      if(!isObject(original.productMeta))return invalid();
      const meta:Details={};
      for(const [key,value] of Object.entries(original.productMeta)){
        if(!isObject(value))return invalid();
        const configuration=pick(value,["unitPrice","discount","note","equipment","returnable","unit","department"]);
        if(Object.keys(configuration).length)meta[key]=configuration;
      }
      operations.productMeta=meta;
    }
    if(original.manualPrepItems!=null){
      if(!Array.isArray(original.manualPrepItems)||original.manualPrepItems.some((item:unknown)=>!isObject(item)))return invalid();
      operations.manualPrepItems=original.manualPrepItems.map((item:Details)=>pick(item,["id","name","source","quantity","department","infoOnly","note","productId","sku"]));
    }
    next.bookingOperations=operations;
  }else delete next.bookingOperations;
  return {ok:true,value:next};
}
