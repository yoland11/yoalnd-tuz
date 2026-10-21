import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import {createLoading,executeLoadingRequest} from "../src/lib/booking-loading";
assert.ok(existsSync("src/server/booking-loading.ts"),"original-record loading store is missing");
const { getLoadingView, runLoadingRequest }=await import("../src/server/booking-loading");
const dialect=new PgDialect();
let details:any={primaryEmployeeId:1,assistantEmployeeId:2,bookingOperations:{untouched:"keep",assets:[{productId:10,quantity:1,stage:"out",custodyId:100,pickedAt:"2026-10-19T08:00:00Z"}]}};
let auditCount=0,failAudit=false;const queries:string[]=[];
const executor:any={execute:async(q:any)=>{
  const {sql,params}=dialect.sqlToQuery(q);queries.push(sql);
  if(sql.includes("FROM kosha_bookings")||sql.includes("FROM service_orders"))return {rows:[{id:12,status:"confirmed",details,assigned_staff_id:1,vehicle_id:8}]};
  if(sql.includes("kosha_work_order_members")||sql.includes("photography_shoot_crew"))return {rows:[]};
  if(sql.includes("FROM staff"))return {rows:[{id:1,name:"علي"},{id:2,name:"أحمد"}]};
  if(sql.includes("FROM fleet_vehicles"))return {rows:[{id:8,name:"مركبة 8",is_active:true,status:"active"}]};
  if(sql.includes("to_regclass"))return {rows:[{ready:true}]};
  if(sql.includes("FROM products"))return {rows:[{id:10,name:"عمود",barcode:"COLUMN",images:[],qr_token:"qr-column",tracking_mode:null,unit:null}]};
  if(sql.includes("FROM equipment_custody"))return {rows:[{id:100,product_id:10,quantity:1,status:"issued",notes:"kosha_booking #12",staff_id:2}]};
  if(sql.includes("FROM stock_reservations")||sql.includes("FROM stock_movements")||sql.includes("FROM kosha_work_order_assets"))return {rows:[]};
  if(sql.startsWith("UPDATE ")){assert.ok(sql.includes("booking_details"));details={...details,bookingOperations:{...details.bookingOperations,loading:JSON.parse(params.find((p:any)=>typeof p==="string"&&p.startsWith('{"version":')) as string)}};return {rows:[{id:12}]}}
  if(sql.includes("INSERT INTO entity_timeline")){if(failAudit)throw new Error("audit unavailable");auditCount++;return {rows:[]}}
  throw new Error(`Unexpected SQL ${sql}`);
}};
const database:any={...executor,transaction:async(run:any)=>{const before=structuredClone(details),audits=auditCount;try{return await run(executor)}catch(e){details=before;auditCount=audits;throw e}}};
const manager={id:1,name:"علي",manager:true};
const deps={now:()=>"2026-10-19T09:00:00.000Z",nextId:()=>"load-original"};
const view=await getLoadingView(database,{source:"kosha",id:12},manager);
assert.equal(view.facts.lines[0].origin,"custody:100");
assert.equal(view.record,null);
assert.equal(queries.some(q=>/CREATE |ALTER |INSERT |UPDATE |DELETE /i.test(q)),false,"GET is read-only and never initializes schema");
queries.length=0;
await assert.rejects(()=>getLoadingView(database,{source:"kosha",id:12},{id:99,name:"غير مكلف"}),/فريق الحجز/);
assert.equal(queries.some(q=>q.includes("FROM products")),false,"deny before reading any equipment identity");
queries.length=0;
const command:any={type:"create",requestId:"create-12",responsibleId:1,senderId:1,receiverId:2};
await runLoadingRequest(database,{source:"kosha",id:12},manager,command,deps);
assert.equal(auditCount,1);
assert.equal(details.bookingOperations.untouched,"keep");
assert.equal(queries.some(q=>q.includes("FOR UPDATE")),true,"booking serializes operational retries");
assert.equal(queries.some(q=>/UPDATE (products|warehouse_stock|stock_reservations)|INSERT INTO (stock_movements|equipment_custody|financial_transactions)/i.test(q)),false,"loading must NEVER post a second movement");
const replay=await runLoadingRequest(database,{source:"kosha",id:12},manager,command,deps);
assert.equal(replay.duplicate,true);assert.equal(auditCount,1);
failAudit=true;
await assert.rejects(()=>runLoadingRequest(database,{source:"kosha",id:12},manager,{type:"scan",manifestId:"load-original",requestId:"scan-12",lineKey:"asset:10",code:"qr-column",quantity:1},deps),/audit unavailable/);
assert.equal(details.bookingOperations.loading.lines[0].loaded,0,"audit failure rolls back evidence in the same transaction");
failAudit=false;
await runLoadingRequest(database,{source:"kosha",id:12},manager,{type:"scan",manifestId:"load-original",requestId:"scan-12",lineKey:"asset:10",code:"qr-column",quantity:1},deps);
assert.equal(details.bookingOperations.loading.lines[0].loaded,1);
// Controlled interleaving: a legacy return wins before SELECT FOR UPDATE obtains
// the original row. An unlocked snapshot would still see it as issued.
details={primaryEmployeeId:1,assistantEmployeeId:2,bookingOperations:{assets:[]}};
const originalRow={id:9,work_order_id:5,product_id:10,asset_code:'COLUMN',checked_out_at:'2026-10-19T08:00:00Z',return_condition:'good'};
const raceExecute=async(q:any)=>{const query=dialect.sqlToQuery(q);if(query.sql.includes('FROM kosha_work_order_assets')){queries.push(query.sql);return {rows:[{...originalRow,returned_at:query.sql.includes('FOR UPDATE OF a')?'2026-10-19T10:00:00Z':null}]}}return executor.execute(q)};
const beforeRace=await getLoadingView({execute:raceExecute},{source:'kosha',id:12},manager);
const facts:any={...beforeRace.facts,lines:beforeRace.facts.lines.map(l=>({...l,codes:['COLUMN']}))};
let manifest=createLoading(facts,{id:'work-order-manifest',responsibleId:1,senderId:1,receiverId:2},manager,deps.now());
for(const [actorId,command]of [[1,{type:'scan',lineKey:manifest.lines[0].key,code:'COLUMN',quantity:1}],[1,{type:'acknowledge',role:'sender'}],[2,{type:'acknowledge',role:'receiver'}]]as any[]){manifest=executeLoadingRequest(manifest,facts,{id:actorId,name:'موظف'},{...command,manifestId:manifest.id,requestId:crypto.randomUUID()},deps.now(),'unused').record}
details.bookingOperations.loading=manifest;
const raceDatabase={execute:raceExecute,transaction:(fn:any)=>database.transaction(()=>fn({execute:raceExecute}))};
await assert.rejects(()=>runLoadingRequest(raceDatabase,{source:'kosha',id:12},manager,{type:'confirm',manifestId:manifest.id,requestId:'race-confirm'},deps),/إرجاع|خارج|تحميل|إعادة/);
assert.equal(details.bookingOperations.loading.status,'loading','a return which won the original row lock must prevent stale loading confirmation');
assert.ok(queries.some(q=>q.includes('FROM kosha_work_order_assets')&&q.includes('FOR UPDATE OF a')),'lock the ORIGINAL work-order row before using its return condition');
console.log("PASS actual loading store: original custody identity, pre-read assignment authorization, same transaction, rollback, durable replay and NO inventory/financial writes");
