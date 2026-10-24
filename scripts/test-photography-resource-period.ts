import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
assert.ok(existsSync("src/server/photography-resource-period.ts"),"standalone event writes need the same locked full-period staff guard");
const {readPhotographyResource,guardPhotographyResourceWrite,savePhotographyResourceWindow}=await import("../src/server/photography-resource-period");
const period={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
const dialect=new PgDialect();
function fixture(){
 const state={row:{id:7,booking_id:null as number|null,shoot_booking_id:null as number|null,crew_booking_id:null as number|null,shoot_stage:null as string|null,shoot_cancelled_at:null as string|null,event_date:"2026-10-22",event_start_time:"20:00",event_end_time:"01:00",assigned_staff_id:2,status:"active",resource_window:period as any},crew:[{staff_id:3}],conflicts:[] as any[],queries:[] as string[],audits:0,failAudit:false};
 const executor:any={execute:async(statement:any)=>{const {sql:q0,params}=dialect.sqlToQuery(statement),q=q0.replace(/\s+/g," ").trim();state.queries.push(q);
  if(q.startsWith("SELECT booking_id FROM photography_events")||q.startsWith("SELECT e.booking_id,sh.booking_id"))return{rows:[{booking_id:state.row.booking_id,shoot_booking_id:state.row.shoot_booking_id,crew_booking_id:state.row.crew_booking_id}]};
  if(q.startsWith("SELECT id,status,event_date"))return{rows:[{id:71,status:"confirmed",event_date:"2026-10-22",details:{assignedPhotographerId:2,bookingOperations:{resourceWindow:period}}}]};
  if(q.startsWith("SELECT vehicle_id,crew_id"))return{rows:[]};
  if(q.startsWith("SELECT e.id,e.booking_id"))return{rows:[structuredClone(state.row)]};
  if(q.startsWith("SELECT c.staff_id"))return{rows:state.crew};
  if(q.startsWith("SELECT id,is_active"))return{rows:[{id:2,is_active:true},{id:3,is_active:true},{id:4,is_active:true}]};
  if(q.startsWith("WITH bookings"))return{rows:state.conflicts};
  if(q.startsWith("UPDATE photography_events SET resource_window")){state.row.resource_window=JSON.parse(String(params[0]));state.row.event_date=String(params[1]);state.row.event_start_time=String(params[2]);state.row.event_end_time=String(params[3]);return{rows:[]};}
  if(q.startsWith("SELECT require_reaccept"))return{rows:[{require_reaccept:true}]};
  if(q.startsWith("UPDATE photography_shoot_crew")||q.startsWith("UPDATE photography_shoots"))return{rows:[]};
  if(q.startsWith("INSERT INTO entity_timeline")){if(state.failAudit)throw Error("audit unavailable");state.audits++;return{rows:[]};}
  throw Error("unexpected photography query "+q);
 },transaction:async(fn:any)=>{const old=structuredClone({row:state.row,audits:state.audits});try{return await fn(executor)}catch(cause){state.row=old.row;state.audits=old.audits;throw cause;}}};
 return{state,executor};
}
const read=fixture();const resource=await readPhotographyResource(read.executor,7,true);assert.equal(resource.reference.source,"photography");assert.deepEqual(resource.staffIds,[2,3]);assert.match(read.state.queries[1],/FOR UPDATE/);
const legacyLink=fixture();legacyLink.state.row.shoot_booking_id=71;assert.equal((await readPhotographyResource(legacyLink.executor,7,true)).reference.source,"service","legacy shoot/crew links must retain the original central source even if the newer event link is missing");
const ambiguous=fixture();ambiguous.state.row.booking_id=71;ambiguous.state.row.shoot_booking_id=72;await assert.rejects(()=>readPhotographyResource(ambiguous.executor,7,true),/ربط|مرتبط/);
for(const source of ["kosha","service","photography"]){const f=fixture();f.state.conflicts=[{source,id:source==="photography"?8:7,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}},...(source==="photography"?{photo_identity:{bookingIds:[],central:null}}:{})}];await assert.rejects(()=>f.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{f.state.row.assigned_staff_id=4;f.state.crew=[];})),/مشغول/);assert.equal(f.state.row.assigned_staff_id,2,"failed new employee assignment rolls original event back");}
const legacy=fixture();legacy.state.row.resource_window=null;await legacy.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{}));
legacy.state.row.shoot_stage="shooting";await legacy.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{legacy.state.row.shoot_stage="processing_files";}));
const reopening=fixture();reopening.state.row.shoot_stage="completed";reopening.state.conflicts=[{source:"kosha",id:7,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}}}];await assert.rejects(()=>reopening.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{reopening.state.row.shoot_stage="crew_assigned";})),/مشغول/);assert.equal(reopening.state.row.shoot_stage,"completed");
await legacy.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{legacy.state.row.assigned_staff_id=3;legacy.state.crew=[];}));
// The period is optional: without one the event holds its whole day.
await legacy.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{legacy.state.row.event_date="2026-10-25";}));assert.equal(legacy.state.row.event_date,"2026-10-25");
const dayBusy=fixture();dayBusy.state.row.resource_window=null;dayBusy.state.conflicts=[{source:"kosha",id:7,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}}}];await assert.rejects(()=>dayBusy.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{dayBusy.state.row.assigned_staff_id=4;dayBusy.state.crew=[];})),/مشغول/,"a day-only event still refuses a photographer busy that day");
const badPeriod=fixture();badPeriod.state.row.resource_window={...period,eventEnd:"bad"};await assert.rejects(()=>badPeriod.executor.transaction((tx:any)=>guardPhotographyResourceWrite(tx,7,async()=>{badPeriod.state.row.assigned_staff_id=4;badPeriod.state.crew=[];})),/فترة/,"a saved but invalid period is never replaced by the day");
const next=Object.fromEntries(Object.entries(period).map(([key,value])=>[key,value.replace("2026-10-22","2026-10-25").replace("2026-10-23","2026-10-26")]));
const save=fixture();await savePhotographyResourceWindow(save.executor,7,next,period,{id:1,name:"مدير"},{eventDate:"2026-10-25",expectedEventDate:"2026-10-22"});assert.equal(save.state.row.event_date,"2026-10-25");assert.equal(save.state.audits,1);
const clockOnly=fixture();await assert.rejects(()=>savePhotographyResourceWindow(clockOnly.executor,7,{...period,eventStart:"2026-10-22T21:00:00+03:00"},period,{id:1,name:"مدير"}),/الموعد|الفترة/);assert.equal(clockOnly.state.audits,0);
assert.equal((await savePhotographyResourceWindow(save.executor,7,next,period,{id:1,name:"مدير"},{eventDate:"2026-10-25",expectedEventDate:"2026-10-22"})).duplicate,true);assert.equal(save.state.audits,1,"lost-response retry does not duplicate audit");
const failure=fixture();failure.state.failAudit=true;await assert.rejects(()=>savePhotographyResourceWindow(failure.executor,7,next,period,{id:1,name:"مدير"},{eventDate:"2026-10-25",expectedEventDate:"2026-10-22"}),/audit unavailable/);assert.deepEqual(failure.state.row.resource_window,period);assert.equal(failure.state.row.event_date,"2026-10-22");
const completed=fixture();completed.state.row.shoot_stage="completed";await assert.rejects(()=>savePhotographyResourceWindow(completed.executor,7,next,period,{id:1,name:"مدير"},{eventDate:"2026-10-25",expectedEventDate:"2026-10-22"}),/مكتمل|انتهت/);
console.log("PASS original standalone event: staff/crew full-period identity, transactional assignment rollback, legacy unrelated edit, atomic calendar/window retry and audit rollback (controlled IO)");
