import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import * as plans from "../src/lib/booking-transport-plan";
import { guardBookingResourceWrite, readResourceBooking } from "../src/server/booking-resource-period";
import { findBookingStaffConflict, findBookingVehicleConflict } from "../src/server/booking-resource-availability";

const uses = (plans as any).transportResourceUses;
assert.equal(typeof uses, "function", "all transport trip resources must participate in reservations");
const interval = { start: "2026-10-24T00:00:00+03:00", end: "2026-10-25T00:00:00+03:00" };
const make = (id:string, sequence:number, vehicleId:number, driverId:number) => ({ id, sequence, vehicleId, driverId, customerCharge: 25000 });
const plan = (trips:any[]) => plans.validateTransportPlan({ version:1, revision:1, feeMode:"per_trip", overallCharge:null, trips });
const two = plan([make("trip-1",1,5,8), make("trip-2",2,6,9)]);
assert.deepEqual(uses(two,interval).map((u:any)=>[u.vehicleId,u.driverId]), [[5,8],[6,9]]);
assert.throws(()=>uses(plan([make("t1",1,5,8), make("t2",2,5,9)]),interval), /فترة|تداخل/, "same vehicle with no explicit release is not free");
assert.throws(()=>uses(plan([{...make("t1",1,5,8),expectedArrivalTime:"10:00"}, {...make("t2",2,6,8),departureTime:"11:00"}]),interval), /فترة|تداخل/, "ETA is not a resource return time");
const sequential = plan([
  {...make("t1",1,5,8),resourceOccupancy:{...interval,end:"2026-10-24T10:00:00+03:00"}},
  {...make("t2",2,5,8),resourceOccupancy:{...interval,start:"2026-10-24T10:00:00+03:00"}},
]);
assert.equal(uses(sequential,interval).length,2,"touching intervals may reuse a driver and vehicle");
assert.throws(()=>uses(sequential,null), /فترة|تاريخ/);
assert.throws(()=>uses(sequential,{...interval,start:"2026-10-24T09:00:00+03:00"}), /فترة/);
assert.throws(()=>uses(plan([{...make("t1",1,5,8),resourceOccupancy:{start:"2026-02-30T00:00:00Z",end:"2026-03-02T00:00:00Z"}}]), interval), /./);

const dialect = new PgDialect();
const ref = {source:"kosha" as const,id:7,eventDate:"2026-10-24",operations:{}};
const candidate = {source:"service",id:20,event_date:"2026-10-24",details:{bookingOperations:{transportPlan:two}},transport_plan_only:true};
for(const [kind,find] of [["staff",(tx:any)=>findBookingStaffConflict(ref,[9],tx)], ["vehicle",(tx:any)=>findBookingVehicleConflict(ref,6,tx)]] as const){
  const result = await find({execute:async(statement:any)=>{
    const q=dialect.sqlToQuery(statement);
    // Real adapter emits a query selecting the additive plan, not just primary IDs.
    return {rows:q.sql.includes("transportPlan")?[candidate]:[]};
  }});
  assert.equal(result?.id,20,`${kind} conflicts include secondary trips`);
  await assert.rejects(()=>find({execute:async()=>({rows:[{...candidate,details:{bookingOperations:{transportPlan:{trips:"broken"}}}}]})}), /./,"corrupt plan cannot be silently ignored");
  assert.equal(await find({execute:async()=>({rows:[{...candidate,details:{bookingOperations:{transportPlan:plan([make("other",1,66,99)])}}}]})}),null,"unrelated trip resources are not a false conflict");
}

let row:any={id:7,status:"confirmed",event_date:"2026-10-24",details:{},assigned_staff_id:null,kosha_id:null};
const lockedIds:number[]=[];
const tx={execute:async(statement:any)=>{
  const q=dialect.sqlToQuery(statement),sql=q.sql.replace(/\s+/g," ").trim();
  if(sql.startsWith("SELECT id,status,event_date"))return {rows:[structuredClone(row)]};
  if(sql.startsWith("SELECT vehicle_id,crew_id")||sql.startsWith("SELECT m.staff_id"))return {rows:[]};
  if(sql.startsWith("SELECT id,is_active FROM staff"))return {rows:[{id:8,is_active:true},{id:9,is_active:true}]};
  if(sql.startsWith("SELECT id,is_active,status FROM fleet_vehicles")){lockedIds.push(Number(q.params[0]));return {rows:[{id:Number(q.params[0]),is_active:true,status:"available"}]};}
  if(sql.startsWith("WITH bookings")||sql.startsWith("SELECT entity_type,entity_id"))return {rows:[]};
  throw Error("unexpected transport guard query "+sql);
}};
await guardBookingResourceWrite(tx,{source:"kosha",id:7},async()=>{row.details={bookingOperations:{transportPlan:two}}});
const saved=await readResourceBooking(tx,{source:"kosha",id:7});
assert.deepEqual(saved.staffIds,[8,9]);
assert.deepEqual((saved as any).vehicleIds,[5,6]);
assert.deepEqual(lockedIds,[5,6],"secondary trip vehicles locked in stable order before confirmation");
console.log("PASS transport plan resources: sequential reuse, missing release, secondary trip conflicts, malformed data, original source guard and ordered vehicle locks");
