import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {PgDialect} from "drizzle-orm/pg-core";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";

assert.ok(existsSync("src/server/vehicle-partnership/closing-locks.ts"),"monthly approval must lock original sources, not only the monthly header");
const {lockClosingOriginalSources}=await import("../src/server/vehicle-partnership/closing-locks");
const dialect=new PgDialect(),actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true};
const groups=["kosha","service","delivery","dispatch","delivery_details","sales_invoice","order","expense","activity","funding","employee","closing","closing_line","right","financial"];
let calls:{sql:string;params:unknown[]}[]=[],candidateReads=new Map<string,number>(),branch:number|null=null,overflow:string|null=null,changed:string|null=null,missing:string|null=null,invalid:string|null=null,fail:string|null=null;
const fixture=()=>({execute:async(statement:any)=>{
 const query=dialect.sqlToQuery(statement);calls.push(query);
 if(query.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(query.sql.includes("FROM vehicle_partnerships WHERE"))return {rows:[{id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:"شركة",version:2}]};
 if(query.sql.includes("vp_closing_fleet_barrier"))return {rows:missing==="vehicle"?[]:[{id:12}]};
 if(query.sql.includes("FROM fleet_vehicles WHERE"))return {rows:[{id:12,branch_id:branch,is_active:true,name:"نيسان"}]};
 const candidate=/vp_closing_lock_candidates:([a-z_]+)/.exec(query.sql)?.[1];
 if(candidate){
  if(candidate===fail)throw Error("original source unavailable");
  const count=(candidateReads.get(candidate)??0)+1;candidateReads.set(candidate,count);
  if(candidate===overflow)return {rows:Array.from({length:6001},(_,i)=>({id:i+1}))};
  if(candidate===invalid)return {rows:[{id:"bad"}]};
  return {rows:[{id:groups.indexOf(candidate)+21},...(candidate===changed&&count>1?[{id:999}]:[])]};
 }
 const locked=/vp_closing_lock_rows:([a-z_]+)/.exec(query.sql)?.[1];
 if(locked)return {rows:locked===missing?[]:query.params.map(id=>({id}))};
 throw Error("Unexpected monthly source-lock query "+query.sql);
}});
function reset(){calls=[];candidateReads=new Map();branch=null;overflow=null;changed=null;missing=null;invalid=null;fail=null;}
await assert.rejects(()=>lockClosingOriginalSources(fixture(),{...actor,permissions:[]},12,"2025-08"),(e:any)=>e.status===403);assert.equal(calls.length,0);
await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"bad"),(e:any)=>e.status===422);assert.equal(calls.length,0);
branch=1;await assert.rejects(()=>lockClosingOriginalSources(fixture(),{...actor,allowedBranchIds:[2]},12,"2025-08"),(e:any)=>e.status===403);assert.ok(!calls.some(q=>q.sql.includes("vp_closing_lock_candidates")),"branch access precedes original financial/source queries");reset();
await lockClosingOriginalSources(fixture(),actor,12,"2025-08");
const index=(marker:string)=>calls.findIndex(q=>q.sql.includes(marker.startsWith("vp_closing_lock_rows:")?`${marker} */`:marker));
assert.ok(index("FROM vehicle_partnerships WHERE")<index("vp_closing_lock_rows:kosha"));
for(const group of ["kosha","service","sales_invoice","order","delivery_details","delivery"])assert.ok(index(`vp_closing_lock_rows:${group}`)<index("vp_closing_fleet_barrier"),"original booking and parent billing rows precede fleet barrier");
assert.ok(index("vp_closing_fleet_barrier")<index("vp_closing_lock_rows:dispatch"),"original delivery dispatcher takes fleet before dispatch UPSERT");
assert.ok(index("vp_closing_lock_rows:sales_invoice")<index("vp_closing_lock_rows:delivery_details")&&index("vp_closing_lock_rows:delivery_details")<index("vp_closing_lock_rows:delivery"),"original invoice writer takes parent invoice, then details, then delivery row");
const deliveryWriter=readFileSync("src/server/delivery-details.ts","utf8").split("export async function updateInvoiceDelivery(")[1].split("export async function getInvoiceDelivery(")[0];
assert.ok(deliveryWriter.indexOf(".update(deliveryDetailsTable)")<deliveryWriter.indexOf(".update(deliveryOrdersTable)"),"pin the real original delivery-writer order");
const dispatchWriter=readFileSync("src/server/booking-dispatch.ts","utf8");assert.ok(dispatchWriter.indexOf("for (const id of vehicleIds)")<dispatchWriter.indexOf("tx.insert(dispatchAssignmentsTable)"),"pin the real original dispatcher order");
for(const group of groups.slice(7))assert.ok(index("vp_closing_fleet_barrier")<index(`vp_closing_lock_rows:${group}`),"expenses/financial rows follow original fleet barrier");
assert.match(calls[index("vp_closing_fleet_barrier")].sql,/FOR UPDATE/);
assert.equal(candidateReads.get("service"),2,"candidate membership is rechecked after barrier");
assert.ok(calls.filter(q=>q.sql.includes("vp_closing_lock_rows:")).every(q=>/ORDER BY id\s+FOR UPDATE/.test(q.sql)),"individual original IDs lock in deterministic order");
assert.ok(calls.every(q=>!/(INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE)\s+(?:INTO\s+)?[a-z_]/i.test(q.sql.replace(/FOR UPDATE/g,""))),"lock helper never writes financial data or schema");
assert.ok(calls.some(q=>q.sql.includes("source_snapshot")),"late/superseded source identities remain lockable through immutable feature evidence");
assert.ok(calls.some(q=>q.sql.includes("reversed_transaction_id")),"actual reversal rows are locked with their original financial sources");
reset();changed="service";await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"2025-08"),(e:any)=>e.status===409&&e.code==="SOURCE_CHANGED");assert.ok(!calls.some(q=>q.sql.includes("vp_closing_lock_rows:financial")),"changed candidates fail and roll back rather than lock new booking IDs under fleet");
for(const group of ["kosha","expense","financial"]){reset();overflow=group;await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"2025-08"),(e:any)=>e.status===409&&e.code==="LIMIT_EXCEEDED");}
reset();missing="service";await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"2025-08"),(e:any)=>e.status===409);
reset();missing="vehicle";await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"2025-08"),(e:any)=>e.status===409);
reset();invalid="expense";await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"2025-08"),/هوية|معرّف/);
reset();fail="financial";await assert.rejects(()=>lockClosingOriginalSources(fixture(),actor,12,"2025-08"),/original source unavailable/);
console.log("PASS actual monthly source locks: permission/scope, original booking-before-fleet ordering, deterministic IDs, rechecked membership, bounded reads, original financial/reversal evidence and propagated failures.");
console.log("LIMITATION: controlled SQL executor, not live PostgreSQL lock/concurrency proof; original service guard barrier is verified by its separate actual mutation test.");
