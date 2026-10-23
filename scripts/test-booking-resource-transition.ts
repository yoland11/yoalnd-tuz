import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import * as periods from "../src/server/booking-resource-period";
const guard=(periods as any).guardBookingResourceWrite;
assert.equal(typeof guard,"function","original calendar/assignment writers need a transactional transition guard");
const dialect=new PgDialect();
const window={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
const original={id:7,status:"confirmed",event_date:"2026-10-22",event_time:"20:00",details:{bookingOperations:{resourceWindow:window}},assigned_staff_id:null,kosha_id:null};
async function run(patch:any,{busy=false,fail=false,legacy=false,archived=false,initialStaff=false,initialDetails=undefined as any,override=false}={}){
 let row:any=structuredClone(original), committed=false; if(legacy)row.details={};if(archived)row.archived_at="2026-10-01";if(initialStaff)row.assigned_staff_id=2;
 if(initialDetails)row.details=structuredClone(initialDetails);
 const calls:string[]=[],before=structuredClone(row);
 const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement).sql.replace(/\s+/g," ").trim();calls.push(q);
  if(q.startsWith("SELECT id,status,event_date"))return {rows:[structuredClone(row)]};
  if(q.startsWith("SELECT vehicle_id,crew_id")||q.startsWith("SELECT m.staff_id")||q.startsWith("SELECT c.staff_id"))return {rows:[]};
  if(q.startsWith("SELECT id,is_active"))return {rows:[{id:2,is_active:true,status:"available"},{id:3,is_active:true,status:"available"}]};
  if(q.includes("FOR UPDATE"))return {rows:[{id:2,is_active:true,status:"available"}]};
  if(q.startsWith("WITH bookings")||q.startsWith("SELECT * FROM (")){if(fail)throw Error("resource read unavailable");return {rows:busy?[{source:"service",id:7,event_date:"2026-10-22",details:original.details}]:[]};}
  if(q.startsWith("SELECT id FROM employee_custody")||q.startsWith("SELECT a.id"))return {rows:[]};
  throw Error("unexpected transition query "+q);
 }};
 try{const value=await guard(tx,{source:"kosha",id:7},async(live:any)=>{assert.ok(calls[0].includes("FOR UPDATE"),"lock original source before its write");assert.equal(live.id,7);row={...row,...structuredClone(patch)};return "saved";},override?{staffOverrideReason:"قرار مدير موثق",staffOverrideIds:[2]}:{});assert.equal(value,"saved");committed=true;return{row,calls,committed};}
 catch(cause){row=before;throw cause;}
}
await assert.rejects(()=>run({assigned_staff_id:2},{busy:true}),/مشغول/);
await assert.rejects(()=>run({assigned_staff_id:2},{fail:true}),/resource read unavailable/);
await assert.rejects(()=>run({assigned_staff_id:2},{legacy:true}),/فترة|مواعيد/);
await assert.rejects(()=>run({event_date:"2026-10-25",assigned_staff_id:2}),/فترة|موعد/);
await assert.rejects(()=>run({event_time:"21:00",assigned_staff_id:2}),/فترة|موعد/);
const assigned=await run({assigned_staff_id:2});assert.ok(assigned.calls.some(q=>q.startsWith("SELECT id,is_active")&&q.includes("ORDER BY id FOR UPDATE")));
assert.equal(assigned.row.assigned_staff_id,2);
const unchanged=await run({details:{memo:"تصحيح اسم"}},{legacy:true});assert.equal(unchanged.calls.some(q=>q.startsWith("WITH bookings")),false,"unrelated legacy edit is not a new allocation");
const removed=await run({status:"cancelled",assigned_staff_id:2},{legacy:true});assert.equal(removed.calls.some(q=>q.startsWith("WITH bookings")),false,"cancellation releases, not allocates");
await run({archived_at:null},{archived:true});
await assert.rejects(()=>run({archived_at:null},{archived:true,initialStaff:true,busy:true}),/مشغول/,"restoring an archived allocation must check its existing identities again");
await assert.rejects(()=>run({details:{eventTime:"20:00",eventEndTime:"02:00",bookingOperations:original.details.bookingOperations},assigned_staff_id:2}),/فترة|موعد/,"an end-time alias cannot bypass the operating period");
await run({details:{assignedStaffIds:[2]}},{legacy:true,initialDetails:{assignedStaffIds:[2,3]}});
await run({details:{linkedAssets:[{productId:20,quantity:1,note:"تصحيح الوصف"}]}},{legacy:true,initialDetails:{linkedAssets:[{productId:20,quantity:1,note:"وصف سابق"}]}});
await run({assigned_staff_id:2},{busy:true,override:true});
await assert.rejects(()=>run({assigned_staff_id:2},{busy:true,override:true,initialDetails:{assignedStaffIds:[3],bookingOperations:original.details.bookingOperations}}),/مشغول/,"photo override must not waive another employee or driver conflict");
await assert.rejects(()=>run({assigned_staff_id:2},{fail:true,override:true}),/resource read unavailable/,"an authorized staffing override cannot suppress a failed resource read");
await assert.rejects(()=>run({assigned_staff_id:2},{legacy:true,override:true}),/فترة|مواعيد/,"an override reason cannot invent an operating period");
console.log("PASS original resource transition: locked read/write/check, shared source identity, full period, time consistency, sorted staff locks, legacy edit and read-error propagation (controlled IO)");
