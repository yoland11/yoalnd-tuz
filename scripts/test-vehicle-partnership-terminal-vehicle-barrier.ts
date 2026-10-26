import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {guardBookingResourceWrite,validateBookingResourceCreation} from "../src/server/booking-resource-period";
const dialect=new PgDialect();
async function run({create=false,vehicleId=12,dispatchVehicleId=null as number|null,fail=false,missing=false,status="completed"}={}){
 let row:any={id:7,status,event_date:"2025-08-20",details:{bookingOperations:{transportation:{mode:"ajn",vehicleId}}},archived_at:null};const before=structuredClone(row),queries:string[]=[],vehicleLocks:number[]=[];
 const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement);queries.push(q.sql);
  if(q.sql.includes("FROM service_orders WHERE id="))return {rows:[structuredClone(row)]};
  if(q.sql.includes("FROM dispatch_assignments"))return {rows:dispatchVehicleId?[{vehicle_id:dispatchVehicleId,crew_id:null}]:[]};
  if(q.sql.includes("FROM photography_shoot_crew"))return {rows:[]};
  if(q.sql.includes("vp_terminal_vehicle_barrier")){vehicleLocks.push(Number(q.params[0]));if(fail)throw Error("vehicle lock unavailable");return {rows:missing?[]:[{id:Number(q.params[0]),is_active:true,status:"available"}]};}
  throw Error("Unexpected terminal source query "+q.sql);
 }};
 try{if(create)await validateBookingResourceCreation(tx,{source:"service",id:7});else await guardBookingResourceWrite(tx,{source:"service",id:7},async()=>{row={...row,details:{bookingOperations:{transportation:{mode:"ajn",vehicleId,fee:"100.00"}}}};return true;});}catch(error){row=before;throw error;}
 return {queries,row,vehicleLocks};
}
const modified=await run();assert.ok(modified.queries.some(q=>q.includes("vp_terminal_vehicle_barrier")),"terminal JSON transport writes must serialize their selected fleet identity before commit");
assert.ok(modified.queries.findIndex(q=>q.includes("service_orders")&&q.includes("FOR UPDATE"))<modified.queries.findIndex(q=>q.includes("vp_terminal_vehicle_barrier")),"retain original booking-before-fleet lock order");
assert.ok(!modified.queries.some(q=>q.includes("WITH bookings")||q.includes("FROM staff")),"terminal edits must not reintroduce eligibility/scheduling checks on old staff/vehicles");
assert.ok((await run({create:true})).queries.some(q=>q.includes("vp_terminal_vehicle_barrier")),"creation/import through original guard uses same barrier");
assert.deepEqual((await run({dispatchVehicleId:13})).vehicleLocks,[12,13],"financial JSON vehicle and operational dispatch vehicle must both serialize in sorted order");
assert.ok(!(await run({vehicleId:0})).queries.some(q=>q.includes("vp_terminal_vehicle_barrier")),"valid legacy absence of vehicle remains usable");
await assert.rejects(()=>run({fail:true}),/vehicle lock unavailable/);
await assert.rejects(()=>run({missing:true}),(error:any)=>error.status===409);
console.log("PASS original service terminal/create transport barrier: booking-first, fleet FOR UPDATE, unchanged legacy scheduling, missing identity/error rollback (controlled SQL).");
