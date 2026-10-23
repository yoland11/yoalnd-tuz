import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql,eq,inArray,and} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {readResourceBooking,lockBookingExecutionTeam} from "../src/server/booking-resource-period";
import {readPhotographyResource} from "../src/server/photography-resource-period";
import {resourceRows,BookingResourceConflictError} from "../src/server/booking-resource-availability";
const source=readFileSync("src/server/photography-booking-integration.ts","utf8"),ast=ts.createSourceFile("integration.ts",source,ts.ScriptTarget.Latest,true);
const names=["syncCentralBookingToPhotography","writeSyncAudit","mapObject","arrays","positiveId","validDate","boundedTime","bookingCode","eventStatus","initialStage"];
const code=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text??"")).map(node=>node.getText(ast).replace(/^export /,"")).join("\n");
const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const dialect=new PgDialect();
for(const mode of ["unchanged_legacy","moved_clear","moved_busy","audit_failure","legacy_event_link","legacy_shoot_link","period_only"]){
 const moved=["moved_clear","moved_busy","audit_failure"].includes(mode),day=moved?"2026-10-25":"2026-10-22";
 const period={preparationStart:`${day}T12:00:00+03:00`,eventStart:`${day}T20:00:00+03:00`,eventEnd:`2026-10-${moved?"26":"23"}T01:00:00+03:00`,returnEnd:`2026-10-${moved?"26":"23"}T12:00:00+03:00`};
 const scheduled=moved||mode==="period_only";
 const fresh:any={id:7,serviceId:1,eventDate:day,createdAt:new Date("2026-01-01"),customerName:"عميل",phone:"07700000000",status:"confirmed",customFields:{assignedPhotographerId:2,eventTime:"20:00",eventEndTime:"01:00",bookingOperations:scheduled?{resourceWindow:period}:{}}};
 const oldEvent:any={id:9,bookingId:mode==="legacy_event_link"?null:7,clientToken:"private-token",eventDate:"2026-10-22",eventStartTime:"20:00",eventEndTime:"01:00",assignedStaffId:2,status:"active"};
 const shoot:any={id:5,eventId:9,bookingId:mode==="legacy_shoot_link"?null:7,stage:"crew_assigned",cancelledAt:null};
 let writes=0,staffChecks=0,sourceLocked=false,audits=0,setup=0,eventReads=0,shootReads=0,createdOriginals=0;
 const tables:any=Object.fromEntries(["serviceOrdersTable","photographyEventsTable","photographyShootsTable","photographyShootCrewTable","photographyChecklistItemsTable","photographyWorkflowSettingsTable","photographyShootEventsTable","entityTimelineTable","adminActivityLogsTable","staffTable"].map(name=>[name,{name,id:name+".id",eventId:name+".eventId",bookingId:name+".bookingId",shootId:name+".shootId",staffId:name+".staffId",assignmentStatus:name+".assignmentStatus",code:name+".code",customFields:name+".customFields"}]));
 const tx:any={execute:async(statement:any)=>{const {sql:text}=dialect.sqlToQuery(statement),q=text.replace(/\s+/g," ").trim();
  if(q.startsWith("SELECT id FROM service_orders")){sourceLocked=true;return{rows:[{id:7}]};}
  if(q.startsWith("WITH linked"))return{rows:[{event_id:9}]};
  if(q.startsWith("SELECT e.booking_id,sh.booking_id"))return{rows:[{booking_id:oldEvent.bookingId,shoot_booking_id:shoot.bookingId,crew_booking_id:7}]};
  if(q.startsWith("SELECT e.id,e.booking_id"))return{rows:[{id:9,booking_id:oldEvent.bookingId,event_date:oldEvent.eventDate,event_start_time:"20:00",event_end_time:"01:00",assigned_staff_id:2,status:"active",resource_window:null,shoot_stage:shoot.stage}]};
  if(q.startsWith("select pg_advisory_xact_lock")){assert.ok(sourceLocked,"original central row lock must precede photography sync lock");return{rows:[]};}
  if(q.startsWith("SELECT id,status,event_date"))return{rows:[{id:7,status:"confirmed",event_date:day,details:fresh.customFields}]};
  if(q.startsWith("SELECT vehicle_id,crew_id")||q.startsWith("SELECT c.staff_id"))return{rows:[]};
  if(q.startsWith("SELECT id,is_active"))return{rows:[{id:2,is_active:true}]};
  if(q.startsWith("WITH bookings")){staffChecks++;return{rows:mode==="moved_busy"?[{source:"kosha",id:7,event_date:day,details:{bookingOperations:{resourceWindow:period}}}]:[]};}
  throw Error("unexpected sync query "+q);
 },query:{serviceOrdersTable:{findFirst:async()=>{assert.ok(sourceLocked);return fresh;}},photographyEventsTable:{findFirst:async()=>++eventReads===1&&mode==="legacy_event_link"?undefined:oldEvent},photographyShootsTable:{findFirst:async()=>++shootReads===1&&mode==="legacy_shoot_link"?undefined:shoot},photographyShootCrewTable:{findMany:async()=>[{staffId:2,assignmentStatus:"accepted"}]},staffTable:{findMany:async()=>[{id:2,fullName:"مصور"}]},photographyWorkflowSettingsTable:{findFirst:async()=>({requireReacceptOnScheduleChange:true})}},
 update:(table:any)=>({set:(value:any)=>({where:()=>({returning:async()=>{writes++;return[table===tables.photographyEventsTable?{...oldEvent,...value}:{...shoot,...value}];},then:(yes:any,no:any)=>{writes++;return Promise.resolve([]).then(yes,no);}})})}),
 insert:(table:any)=>({values:(value:any)=>{if(table===tables.adminActivityLogsTable){if(mode==="audit_failure")throw Error("audit unavailable");audits++;}const done=()=>{writes++;return Promise.resolve([])};return{returning:async()=>{createdOriginals++;return[table===tables.photographyEventsTable?{...oldEvent,...value,id:99}:{...shoot,...value,id:77}];},onConflictDoUpdate:done,onConflictDoNothing:done,then:(yes:any,no:any)=>done().then(yes,no)};}})};
 const forbidden=new Proxy({},{get(){throw Error("default connection used inside supplied transaction");}});
 const context:any={sql,eq,inArray,and,...tables,db:forbidden,readResourceBooking,readPhotographyResource,resourceRows,BookingResourceConflictError,lockBookingExecutionTeam,clientToken:()=>"private-token",ensurePhotographyIntegrationTables:async()=>{setup++;},detectPhotographyBooking:async(_order:any,connection:any)=>{assert.equal(connection,tx,"classification reads share the transaction on a single-connection serverless pool");return{isPhotography:true,reasons:["photographer_assignment"],items:[],debug:{}};},normalizeShootStage:(stage:string)=>stage??"new_booking",routedKoshaCustomFieldsSql:(_:any,value:any)=>value,PHOTOGRAPHY_CHECKLISTS:{},CUSTOMER_STATUS:{crew_assigned:"فريق"},console:{info:()=>{}}};
 vm.createContext(context);vm.runInContext(compiled,context);
 if(mode==="moved_busy"){await assert.rejects(()=>context.syncCentralBookingToPhotography(7,{id:1},tx),/مشغول/);assert.equal(writes,0,"busy fresh crew blocks every event/shoot/audit write");}
 else if(mode==="audit_failure")await assert.rejects(()=>context.syncCentralBookingToPhotography(7,{id:1},tx),/audit unavailable/);
 else{const result=await context.syncCentralBookingToPhotography(7,{id:1},tx,{resourceWindowChanged:mode==="period_only"});assert.equal(result.linked,true);assert.equal(result.scheduleChanged,scheduled);assert.equal(audits,1);assert.equal(result.event.id,9,"reuse the original event even if only the shoot/crew holds the known central link");assert.equal(result.shoot.id,5,"reuse the original shoot even if its newer central field is missing");assert.equal(createdOriginals,0,"synchronizing valid legacy links must not create another event/shoot");}
 assert.equal(setup,0,"no default-connection schema/setup query inside supplied transaction");
 assert.equal(staffChecks,scheduled?1:0,"unchanged legacy refresh is not another allocation, while period extension still requires the existing schedule/reaccept policy");
}
console.log("PASS original photo sync: fresh central source lock, supplied transaction, no nested/default connection, unchanged legacy refresh, full-period crew check and audit failure propagation (controlled IO)");
