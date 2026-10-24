import assert from "node:assert/strict";
import fs from "node:fs";import vm from "node:vm";import ts from "typescript";
import { sql,eq,asc } from "drizzle-orm";import { PgDialect } from "drizzle-orm/pg-core";
import * as tables from "@workspace/db";
import { readResourceBooking } from "../src/server/booking-resource-period";
import { findBookingStaffConflict,BookingResourceConflictError,resourceTimingProblem } from "../src/server/booking-resource-availability";
import { readBookingResourceWindow,bookingResourceSpan } from "../src/lib/booking-resource-window";
const ast=ts.createSourceFile("api.ts",fs.readFileSync("src/server/api.ts","utf8"),ts.ScriptTarget.Latest,true);
const compile=(name:string)=>ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const period={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
const dialect=new PgDialect();
async function run(conflict:boolean){
  let writes=0;const order:string[]=[];
  const reference={source:"kosha",entityType:"kosha_booking",id:7,row:{assignedStaffId:null,status:"confirmed"},details:{bookingOperations:{resourceWindow:period}},operations:{resourceWindow:period},customerName:"عميل",eventDate:"2026-10-22"};
  const staff=[{id:2,fullName:"أحمد",username:"ahmed",role:"staff",department:"kosha",isActive:true}];
  const builder={set:()=>builder,where:async()=>{writes++},values:async()=>{writes++}};
  const tx={execute:async(query:any)=>{
    const q=dialect.sqlToQuery(query).sql.replace(/\s+/g," ").trim();order.push(q);
    if(q.startsWith("SELECT id,status,event_date"))return {rows:[{id:7,status:"confirmed",event_date:"2026-10-22",booking_details:null,details:reference.details}]};
    if(q.startsWith("SELECT vehicle_id,crew_id")||q.startsWith("SELECT m.staff_id"))return {rows:[]};
    if(q.includes("FROM staff")&&q.includes("FOR UPDATE"))return {rows:staff.map(s=>({...s,is_active:s.isActive}))};
    if(q.startsWith("WITH bookings"))return {rows:conflict?[{source:"service",id:7,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}}}]:[]};
    throw Error("Unexpected route SQL "+q);
  },update:()=>builder,insert:()=>builder};
  const context=vm.createContext({...tables,sql,eq,asc,readResourceBooking,findBookingStaffConflict,readBookingResourceWindow,bookingResourceSpan,resourceTimingProblem,BookingResourceConflictError,
    requireAnyPermission:async()=>({id:1,role:"admin",fullName:"مدير",username:"admin"}),isResponse:(v:any)=>typeof v?.status==="number",hasPermission:()=>false,
    int:(v:string)=>Number(v),ensureAdminExtensionsTables:async()=>{},ensureKoshaStaffTables:async()=>{},ensureVariantTables:async()=>{},ensureMasterCashBoxTables:async()=>{},
    loadBookingOperationsReference:async()=>reference,canManageBookingStaffAssignments:()=>true,bookingAssignmentTypes:async()=>["kosha"],staffMatchesBookingAssignment:()=>true,
    BookingStaffAssignmentSchema:{safeParse:(value:any)=>({success:true,data:value})},body:async()=>({assignedStaffIds:[2]}),
    bookingEvidenceWriteSql:()=>sql`'{}'::jsonb`,logAdminActivity:async()=>{},json:(data:any)=>({status:200,data}),error:(message:string,status:number)=>({status,message}),
    db:{query:{staffTable:{findMany:async()=>staff}},transaction:async(run:any)=>run(tx)}
  });
  vm.runInContext(compile("bookingAssignedStaff"),context);vm.runInContext(compile("handleBookingOperations"),context);
  const work=context.handleBookingOperations({method:"PATCH"},["admin","booking-operations","kosha","7","staff-assignment"],"booking-operations");
  if(conflict){await assert.rejects(()=>work,(e:any)=>e instanceof BookingResourceConflictError&&e.status===409);assert.equal(writes,0,"conflict cannot write team, timeline or notifications");}
  else{assert.equal((await work).status,200);assert.ok(writes>0);}
  assert.ok(order[0].includes("FOR UPDATE"),"source booking lock precedes resource check");
  assert.ok(order.find(q=>q.includes("FROM staff")&&q.includes("FOR UPDATE")),"selected employee is locked during authoritative overlap check");
}
await run(true);await run(false);
console.log("PASS real staff-assignment route rejects occupancy conflict under original booking/staff locks before writes; eligible clear assignment retains original writes");
