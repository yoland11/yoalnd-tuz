import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql,eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { guardBookingResourceWrite } from "../src/server/booking-resource-period";
const source=readFileSync("src/server/api.ts","utf8"),ast=ts.createSourceFile("api.ts",source,ts.ScriptTarget.Latest,true);
const routed=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="updateRoutedKoshaServiceBooking");assert.ok(routed);assert.match(routed.getText(ast),/guardBookingResourceWrite/,"the alternate routed Kosha editor must not bypass the same period guard");
for(const condition of ['resource === "transportation"','resource === "workflow" && method === "PATCH"']){
 let branch:ts.IfStatement|undefined;function find(node:ts.Node){if(ts.isIfStatement(node)&&node.expression.getText(ast)===condition)branch=node;ts.forEachChild(node,find);}find(ast);assert.ok(branch);assert.match(branch.getText(ast),/guardBookingResourceWrite/,`${condition} must validate its actual saved resources before commit`);
}
for(const kind of ["kosha","service"] as const){
 const candidates:ts.VariableDeclaration[]=[];
 function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.name.elements[0]?.getText(ast)==="row"&&node.initializer?.getText(ast).includes(`guardBookingResourceWrite(tx,{source:"${kind}"`))candidates.push(node);ts.forEachChild(node,visit);}visit(ast);
 assert.ok(candidates.length>0,`original ${kind} calendar/assignment route must guard its actual write in the original transaction`);
 for(const candidate of candidates){
  const expression=candidate.initializer!.getText(ast),dialect=new PgDialect(),reschedule=expression.includes("preRescheduleStatus"),restoring=expression.includes("archivedAt: null");
  if(kind==="service")assert.match(expression,/syncCentralBookingToPhotography/,"linked photo synchronization belongs inside the original calendar/assignment transaction");
  for(const mode of ["busy","clear",...(kind==="service"?["sync_failure"]:[])]){
   const busy=mode==="busy";
   let active=false,writes=0,commits=0,history=0;
   const period={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
   let row:any={id:7,status:reschedule?"reschedule_pending":"confirmed",event_date:"2026-10-22",event_time:kind==="kosha"?"20:00":null,assigned_staff_id:null,details:{eventTime:"20:00",bookingOperations:{resourceWindow:period}}};
   if(restoring){row.archived_at="2026-10-01";row.details.assignedPhotographerId=2;}
   const initial=structuredClone(row);
   const tx:any={execute:async(statement:any)=>{assert.equal(active,true,"all guard reads and resource locks are inside the write transaction");const q=dialect.sqlToQuery(statement).sql.replace(/\s+/g," ").trim();
    if(q.startsWith("SELECT id,status,event_date"))return{rows:[structuredClone(row)]};
    if(q.startsWith("SELECT vehicle_id,crew_id")||q.startsWith("SELECT m.staff_id")||q.startsWith("SELECT c.staff_id"))return{rows:[]};
    if(q.startsWith("SELECT id,is_active"))return{rows:[{id:2,is_active:true}]};
    if(q.startsWith("WITH bookings"))return{rows:busy?[{source:kind==="kosha"?"service":"kosha",id:7,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:period}}}]:[]};
    throw Error("unexpected route query "+q);
   },update:()=>({set:(value:any)=>({where:()=>({returning:async()=>{assert.equal(active,true);writes++;if(value.assignedStaffId!==undefined){assert.equal(kind,"kosha","service assignment belongs to JSON, never a nonexistent service column");row.assigned_staff_id=value.assignedStaffId;}if(Object.hasOwn(value,"archivedAt"))row.archived_at=value.archivedAt;if(value.customFields)row.details=value.customFields;if(value.status)row.status=value.status;if(value.eventDate)row.event_date=value.eventDate;return[{id:7}];}})})}),insert:()=>({values:async()=>{assert.equal(active,true);history++;}})};
   const db={transaction:async(fn:any)=>{active=true;try{const result=await fn(tx);commits++;return result;}catch(cause){row=structuredClone(initial);history=0;throw cause;}finally{active=false;}}};
   const update=kind==="kosha"?{assignedStaffId:2}:{customFields:{...initial.details,assignedPhotographerId:2}};
   const context:any={db,eq,sql,guardBookingResourceWrite,id:7,order:{id:7},update,bookingEvidenceWriteSql:(_:any,v:any)=>v,koshaBookingsTable:{id:"id",bookingDetails:"details"},serviceOrdersTable:{id:"id"},serviceOrderStatusHistoryTable:{},serviceItemsToSave:null,serviceOrderItemsTable:{},newStatus:"confirmed",newEventDate:busy?"2026-10-25":"2026-10-22",action:"accept",noteText:null,historyNote:"قبول"};
   context.auth={id:1,fullName:"مدير"};context.req={headers:new Map()};context.syncCentralBookingToPhotography=async(_id:number,_actor:any,connection:any)=>{assert.equal(active,true);assert.equal(connection,tx);if(mode==="sync_failure")throw Error("linked sync unavailable");return{linked:false};};
   vm.createContext(context);vm.runInContext(ts.transpileModule(`async function run(){return ${expression};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
   if(busy){await assert.rejects(()=>context.run(),reschedule?/فترة|موعد/:/مشغول/);assert.equal(commits,0);assert.deepEqual(row,initial,"conflict rolls actual original calendar/assignment values back");assert.equal(history,0,"status history shares the rollback");}
   else if(mode==="sync_failure"){await assert.rejects(()=>context.run(),/linked sync unavailable/);assert.equal(commits,0);assert.deepEqual(row,initial,"a failed linked-photo sync must not leave a saved booking date/assignment");}
   else{await context.run();assert.equal(commits,1);assert.equal(writes,1);}
  }
 }
}
console.log("PASS actual native/service/reschedule write expressions: guard inside original transaction, conflicts roll back, clear candidate commits (controlled IO)");
