import assert from "node:assert/strict";
import { quantityPeriodAvailability } from "../src/lib/quantity-asset-period";
const interval={start:"2026-10-22T12:00:00+03:00",end:"2026-10-23T12:00:00+03:00"};
const buckets={inWarehouse:11,checkedOut:4,damaged:3,maintenance:2,missing:1};
const rows=[
 {source:"kosha_booking",bookingId:1,day:"2026-10-21",status:"completed",line:{trackingMode:"quantity",quantity:4,reservedQty:4,checkedOutQty:4,stage:"out"},interval:null},
 {source:"service_order",bookingId:2,day:"2026-10-22",status:"confirmed",line:{trackingMode:"quantity",quantity:8,reservedQty:8,stage:"reserved"},interval:{start:interval.start,end:"2026-10-22T17:00:00+03:00"}},
 {source:"kosha_booking",bookingId:3,day:"2026-10-23",status:"confirmed",line:{trackingMode:"quantity",quantity:6,reservedQty:6,stage:"reserved"},interval:{start:"2026-10-22T17:00:00+03:00",end:interval.end}},
];
const input={booking:{source:"kosha" as const,id:2},buckets,rows,interval,otherHolds:1};
assert.deepEqual(quantityPeriodAvailability(input).availability,{usable:15,reserved:8,out:4,otherHolds:1,committed:13,available:2},"shared quantities count peak period plus real outstanding and global store holds once");
assert.equal(quantityPeriodAvailability({...input,booking:{source:"service",id:2}}).availability?.available,4,"only exact source may exclude its own reservation");
assert.equal(quantityPeriodAvailability({...input,rows:[...rows,{...rows[1],bookingId:5,interval:null}]}).complete,false,"active legacy timing is incomplete, not free");
assert.equal(quantityPeriodAvailability({...input,buckets:{...buckets,checkedOut:5}}).complete,false,"unreconciled checkout counter is not proof of availability");
assert.equal(quantityPeriodAvailability({...input,interval:null}).complete,false);
assert.equal(quantityPeriodAvailability({...input,rows:rows.map(r=>({...r,line:{...r.line,returnedGoodQty:r.bookingId===1?2:0}})),buckets:{...buckets,inWarehouse:13,checkedOut:2}}).availability?.available,4,"partial return frees only actual healthy returned units");
console.log("PASS full-period quantity availability: original buckets/lines, peak demand, sources, partial return, unknown timing and reconciliation");
