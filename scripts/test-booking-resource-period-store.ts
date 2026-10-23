import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { readResourceBooking,saveBookingResourceWindow } from "../src/server/booking-resource-period";
import {resourceWindowCalendar} from "../src/lib/booking-resource-window";
const dialect=new PgDialect();
const period={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
const ref={source:"service" as const,id:7},actor={id:1,name:"مدير"};
assert.deepEqual(resourceWindowCalendar(period),{eventDate:"2026-10-22",eventTime:"20:00",endTime:"01:00"});
assert.deepEqual(resourceWindowCalendar({preparationStart:"2026-10-24T20:00:00Z",eventStart:"2026-10-24T21:30:00Z",eventEnd:"2026-10-24T23:30:00Z",returnEnd:"2026-10-25T01:00:00Z"}),{eventDate:"2026-10-25",eventTime:"00:30",endTime:"02:30"},"calendar day comes from Baghdad, not UTC date prefix");
function fixture(initialDetails?:any){
  const state={booking:{id:7,status:"confirmed",event_date:"2026-10-22",event_time:null as string|null,kosha_id:null,assigned_staff_id:null,transportation_mode:null,transportation_driver_id:null,transportation_vehicle_id:null,details:{existing:"preserve",bookingOperations:{loading:{receipts:["scan"]},resourceWindow:null,assets:[] as any[]}}},timeline:[] as any[],members:[] as any[],dispatch:[] as any[],fixed:[] as any[],conflicts:[] as any[],queries:[] as any[],failAudit:false,failRead:false,expectCalendar:false,staffActive:true,fleetStatus:"available",outsideDispatch:false};
  if(arguments.length)state.booking.details=initialDetails;
  const database={execute:async(query:any)=>{
    const built=dialect.sqlToQuery(query),q=built.sql.replace(/\s+/g,' ').trim(),p=built.params;
    state.queries.push({q,p});
    if(state.failRead)throw Error("evidence unavailable");
    if(/^SELECT id,status,event_date/.test(q))return {rows:[structuredClone(state.booking)]};
    if(q.startsWith("SELECT vehicle_id,crew_id"))return {rows:state.dispatch};
    if(q.startsWith("SELECT m.staff_id")||q.startsWith("SELECT c.staff_id"))return {rows:state.members};
    if(q.startsWith("SELECT id FROM employee_custody_reservations"))return {rows:state.fixed};
    if(q.startsWith("SELECT a.id FROM kosha_work_order_assets"))return {rows:[]};
    if(q.startsWith("SELECT entity_type,entity_id FROM dispatch_assignments"))return{rows:state.outsideDispatch?[{entity_type:"delivery",entity_id:99}]:[]};
    if(q.includes("FOR UPDATE"))return {rows:[{id:2,is_active:state.staffActive,status:state.fleetStatus}]};
    if(q.startsWith("WITH bookings")||q.startsWith("SELECT * FROM ("))return {rows:state.conflicts};
    if(q.startsWith("UPDATE service_orders SET custom_fields=")||q.startsWith("UPDATE kosha_bookings SET booking_details=")){
      const column=q.startsWith("UPDATE service_orders")?"custom_fields":"booking_details";
      assert.match(q,/jsonb_set/);assert.match(q,/'\{bookingOperations\}'/);assert.doesNotMatch(q,/total_amount|deposit_amount|remaining_amount|payment_status/,"window edit must not change financial columns");
      if(state.expectCalendar){assert.match(q,/event_date=/);const day=p.find((value:any)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value));assert.equal(day,"2026-10-25");state.booking.event_date=day;
        if(column==="booking_details"){assert.match(q,/event_time=/);state.booking.event_time=p.find((value:any)=>value==="20:00") as string;const aliases=p.find((value:any)=>typeof value==="string"&&value.startsWith('{"eventEndTime"'));if(aliases)state.booking.details={...state.booking.details,...JSON.parse(aliases)};}
        else {const aliases=p.find((value:any)=>typeof value==="string"&&value.startsWith('{"eventTime"'));assert.ok(aliases);const times=JSON.parse(String(aliases));assert.equal(times.eventTime,"20:00");assert.equal(times.eventStartTime,"20:00");assert.equal(times.eventEndTime,"01:00");state.booking.details={...state.booking.details,...times};}
      }else assert.doesNotMatch(q,/event_date=/,"old period-only saves retain calendar behavior");
      if(column==="custom_fields")assert.doesNotMatch(q,/updated_at/,"service orders have no updated_at column");
      assert.ok(q.includes(`nullif(${column},'null'::jsonb)`),"JSON-null legacy root must become an object, not remain null");
      assert.ok(q.includes(`nullif(${column}->'bookingOperations','null'::jsonb)`),"JSON-null legacy operations must not concatenate into an array");
      assert.equal(p.at(-1),7);
      state.booking.details={...state.booking.details,bookingOperations:{...state.booking.details?.bookingOperations,resourceWindow:JSON.parse(String(p[0]))}};return {rows:[]};
    }
    if(q.startsWith("INSERT INTO entity_timeline")){if(state.failAudit)throw Error("audit unavailable");state.timeline.push({actor:p[4]});return {rows:[]};}
    throw Error("Unexpected query "+q);
  },transaction:async<T>(run:(tx:any)=>Promise<T>)=>{const old=structuredClone({booking:state.booking,timeline:state.timeline});try{return await run(database)}catch(e){state.booking=old.booking;state.timeline=old.timeline;throw e}}};
  return {state,database};
}
const first=fixture();
// The source reader must see assignments before photography synchronization;
// otherwise a period edit bypasses the same staff conflict recognized by SQL.
for(const source of ["kosha","service"] as const){
  const assigned=fixture({assignedStaffId:"2"});
  assert.deepEqual((await readResourceBooking(assigned.database,{source,id:7})).staffIds,[2],"bare original JSON assignee participates in the same resource check");
}
for(const fields of [
  {assignedPhotographerId:"2"},{photographerId:2},
  {photographyAssignments:[{employeeId:2}]},
  {photographers:[{staffId:"2"}]},
  {assignedPhotographers:[{id:2}]},
]){
  const unsynced=fixture(fields);
  assert.deepEqual((await readResourceBooking(unsynced.database,ref)).staffIds,[2],"saved photographer identity must not depend on a later crew sync");
  unsynced.state.conflicts=[{source:"kosha",id:99,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}}}];
  await assert.rejects(()=>saveBookingResourceWindow(unsynced.database,ref,period,null,actor),/الفريق|السائق/);
  assert.equal(unsynced.state.timeline.length,0,"busy unsynced photographer blocks period save before any audit/write");
  assert.ok(!unsynced.state.queries.some(q=>q.q.startsWith("UPDATE")));
}
const mixed=fixture({assignedStaffId:3,assignedPhotographerId:2,photographerId:3,photographyAssignments:[{employeeId:4},{staffId:2},{id:5},null],photographers:null,assignedPhotographers:[]});
mixed.state.members=[{staff_id:6},{staff_id:2}];
assert.deepEqual((await readResourceBooking(mixed.database,ref)).staffIds,[2,3,4,5,6],"original aliases and synced crew deduplicate into stable lock order");
assert.deepEqual((await readResourceBooking(fixture({photographerId:2}).database,{source:"kosha",id:7})).staffIds,[],"photography-only aliases do not invent a native Kosha assignment");
for(const source of ["kosha","service"] as const)for(const details of [null,{existing:"preserve"},{existing:"preserve",bookingOperations:null}]){
  const legacy=fixture(details);
  await saveBookingResourceWindow(legacy.database,{source,id:7},period,null,actor);
  assert.deepEqual((await readResourceBooking(legacy.database,{source,id:7})).operations.resourceWindow,period);
  if(details)assert.equal(legacy.state.booking.details.existing,"preserve");
  assert.equal(legacy.state.timeline.length,1);
}
assert.equal((await readResourceBooking(first.database,ref)).eventDate,"2026-10-22");
assert.ok(first.state.queries.every(x=>!x.q.startsWith("UPDATE")&&!x.q.startsWith("INSERT")),"GET remains read-only");
await saveBookingResourceWindow(first.database,ref,period,null,actor);
assert.deepEqual(first.state.booking.details.bookingOperations.resourceWindow,period);
assert.equal(first.state.booking.details.existing,"preserve");assert.deepEqual(first.state.booking.details.bookingOperations.loading.receipts,["scan"]);
assert.equal(first.state.timeline.length,1);assert.equal(first.state.timeline[0].actor,1);
assert.equal((await saveBookingResourceWindow(first.database,ref,period,null,actor)).duplicate,true);
assert.equal(first.state.timeline.length,1,"same saved retry creates no second timeline event");
await assert.rejects(()=>saveBookingResourceWindow(first.database,ref,{...period,returnEnd:"2026-10-24T12:00:00+03:00"},null,actor),/تغيّرت/);
const rollback=fixture();rollback.state.failAudit=true;
await assert.rejects(()=>saveBookingResourceWindow(rollback.database,ref,period,null,actor),/audit unavailable/);
assert.equal(rollback.state.booking.details.bookingOperations.resourceWindow,null,"audit failure rolls back timing edit");
for(const status of ["cancelled","completed","delivered"]){const closed=fixture();closed.state.booking.status=status;await assert.rejects(()=>saveBookingResourceWindow(closed.database,ref,period,null,actor),/ملغي|مكتمل/);assert.equal(closed.state.timeline.length,0)}
const wrongDay=fixture();wrongDay.state.booking.event_date="2026-10-23";await assert.rejects(()=>saveBookingResourceWindow(wrongDay.database,ref,period,null,actor),/موعد/);
const outside=fixture();outside.state.booking.details.bookingOperations.assets=[{productId:20,stage:"out"}];await assert.rejects(()=>saveBookingResourceWindow(outside.database,ref,period,null,actor),/صُرفت/);
const fixed=fixture();fixed.state.fixed=[{id:21}];await assert.rejects(()=>saveBookingResourceWindow(fixed.database,ref,period,null,actor),/عهدة/);
const conflict=fixture();conflict.state.members=[{staff_id:2}];conflict.state.conflicts=[{source:"kosha",id:99,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}}}];
await assert.rejects(()=>saveBookingResourceWindow(conflict.database,ref,period,null,actor),/الفريق|السائق/);assert.equal(conflict.state.timeline.length,0);
const broken=fixture();broken.state.failRead=true;await assert.rejects(()=>saveBookingResourceWindow(broken.database,ref,period,null,actor),/evidence unavailable/);
const clock=fixture({eventTime:"20:00",eventEndTime:"01:00",bookingOperations:{resourceWindow:null}});await assert.rejects(()=>saveBookingResourceWindow(clock.database,ref,{...period,eventStart:"2026-10-22T21:00:00+03:00"},null,actor),/الموعد|الفترة/);assert.equal(clock.state.timeline.length,0,"period-only write cannot contradict a populated calendar clock");
const inactive=fixture();inactive.state.members=[{staff_id:2}];inactive.state.staffActive=false;await assert.rejects(()=>saveBookingResourceWindow(inactive.database,ref,period,null,actor),/أهلية|نشط/);
for(const mode of ["maintenance","outside"]){const fleet=fixture();fleet.state.dispatch=[{vehicle_id:2}];fleet.state.fleetStatus=mode==="maintenance"?"maintenance":"available";fleet.state.outsideDispatch=mode==="outside";await assert.rejects(()=>saveBookingResourceWindow(fleet.database,ref,period,null,actor),/المركبة/);assert.equal(fleet.state.timeline.length,0);}
const movedPeriod=Object.fromEntries(Object.entries(period).map(([key,value])=>[key,value.replace("2026-10-22","2026-10-25").replace("2026-10-23","2026-10-26")])) as typeof period;
const repair=fixture({eventTime:"20:00",eventEndTime:"02:00",bookingOperations:{resourceWindow:movedPeriod}});repair.state.booking.event_date="2026-10-25";repair.state.booking.event_time="20:00";repair.state.expectCalendar=true;const repaired=await saveBookingResourceWindow(repair.database,ref,movedPeriod,movedPeriod,actor,{eventDate:"2026-10-25",expectedEventDate:"2026-10-25"});assert.equal(repaired.duplicate,false,"calendar opt-in must repair an inconsistent end clock even if the saved window/date/start match");assert.equal((repair.state.booking.details as any).eventEndTime,"01:00");
for(const source of ["kosha","service"] as const){
 const moved=fixture();moved.state.expectCalendar=true;
 let synchronized=0;
 const result=await saveBookingResourceWindow(moved.database,{source,id:7},movedPeriod,null,actor,{eventDate:"2026-10-25",expectedEventDate:"2026-10-22",afterSave:async(tx,next)=>{assert.equal(tx,moved.database);assert.equal(next.eventDate,"2026-10-25");synchronized++;}});
 assert.equal(result.eventDate,"2026-10-25");assert.equal(result.eventTime,"20:00");
 assert.equal(moved.state.booking.event_date,"2026-10-25");assert.deepEqual(moved.state.booking.details.bookingOperations.resourceWindow,movedPeriod);
 assert.equal(moved.state.timeline.length,1);assert.equal(synchronized,1);
 assert.equal((await saveBookingResourceWindow(moved.database,{source,id:7},movedPeriod,null,actor,{eventDate:"2026-10-25",expectedEventDate:"2026-10-22"})).duplicate,true,"lost-response replay must not create another calendar edit");
 assert.equal(moved.state.timeline.length,1);
}
const staleDay=fixture();await assert.rejects(()=>saveBookingResourceWindow(staleDay.database,ref,movedPeriod,null,actor,{eventDate:"2026-10-25",expectedEventDate:"2026-10-20"}),/تغيّر/);assert.ok(!staleDay.state.queries.some(q=>q.q.startsWith("UPDATE")));
const nativeAlias=fixture({eventEndTime:"02:00",bookingOperations:{resourceWindow:null}});nativeAlias.state.expectCalendar=true;await saveBookingResourceWindow(nativeAlias.database,{source:"kosha",id:7},movedPeriod,null,actor,{eventDate:"2026-10-25",expectedEventDate:"2026-10-22"});assert.equal((nativeAlias.state.booking.details as any).eventEndTime,"01:00","native existing end-time alias follows the explicitly changed original calendar");
const failedSync=fixture();failedSync.state.expectCalendar=true;await assert.rejects(()=>saveBookingResourceWindow(failedSync.database,ref,movedPeriod,null,actor,{eventDate:"2026-10-25",expectedEventDate:"2026-10-22",afterSave:async()=>{throw Error("sync failed")}}),/sync failed/);
assert.equal(failedSync.state.booking.event_date,"2026-10-22");assert.equal(failedSync.state.booking.details.bookingOperations.resourceWindow,null);assert.equal(failedSync.state.timeline.length,0,"linked sync failure must roll back the original calendar and period");
console.log("PASS resource-period read-only projection, canonical-leaf update, stale/retry guard, locked overlap, original manifest holds and audit rollback composition (controlled IO)");
