import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {loadBookingConflictReport} from "../src/server/booking-conflict-report";
import {readConflictQuantityHistory} from "../src/server/booking-conflict-history";

const window={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
const dialect=new PgDialect();
async function report(options:{missingTiming?:boolean;badResult?:boolean;tooMany?:boolean;fail?:boolean;fraction?:boolean;badRequired?:boolean;profileMissing?:boolean;badNames?:boolean;vehicleStatus?:string;crewStatus?:string;clearDispatch?:boolean;history?:any[]}={}){
 const queries:string[]=[];
 const tx={execute:async(query:any)=>{
  const {sql:text,params}=dialect.sqlToQuery(query);queries.push(text);
  assert.match(text.trim(),/^(SELECT|WITH)/i,"report must never lock, update, reserve or emit a movement");assert.doesNotMatch(text,/FOR UPDATE|INSERT INTO|\bUPDATE\b|\bDELETE\b/i);
  if(options.fail)throw Error("database unavailable");
  if(options.badResult)return {bad:[]};
  if(/FROM kosha_bookings WHERE id=/.test(text))return {rows:[{id:7,status:"confirmed",event_date:"2026-10-22",kosha_id:3,details:{bookingOperations:{resourceWindow:options.missingTiming?undefined:window,assets:[{productId:20,quantity:1,stage:"reserved"},{productId:30,quantity:options.badRequired?"bad":options.fraction?1.5:10,trackingMode:"quantity",stage:"reserved"}]},assignedStaffIds:[2]}}]};
  if(/SELECT vehicle_id,crew_id FROM dispatch/.test(text))return {rows:[{vehicle_id:4,crew_id:6}]};
  if(/SELECT m.staff_id/.test(text))return {rows:[]};
  if(/SELECT product_id FROM employee_custody/.test(text))return {rows:[{product_id:40}]};
  if(/SELECT a.product_id FROM kosha_work_order_assets/.test(text))return {rows:[{product_id:41}]};
  if(/FROM products p/.test(text))return {rows:[20,30,40,41].map(id=>({id,name_ar:`معدة ${id}`,is_asset:true,stock:id===30?15:1,tracking_mode:id===30&&!options.profileMissing?"quantity":null,asset_status:"active",quantity_checked_out:0,quantity_damaged:0,quantity_maintenance:0,quantity_missing:0,unit_of_measure:"قطعة"}))};
  if(options.badNames&&/AS kind/.test(text))return {rows:[{kind:"staff",id:999,name:"Wrong scope",active:true}]};
  if(/AS kind/.test(text)&&/FROM staff/.test(text))return {rows:[{kind:"staff",id:2,name:"أحمد",active:true},{kind:"vehicle",id:4,name:"سيارة النقل",active:true,status:options.vehicleStatus},{kind:"crew",id:6,name:"فريق التركيب",active:true,status:options.crewStatus},{kind:"kosha",id:3,name:"كوشة ملكية",active:true}]};
  if(/AS resource_window/.test(text))return {rows:options.history??(options.tooMany?Array.from({length:501},(_,i)=>({source:"service_order",booking_id:100+i,line:{productId:30,quantity:1,stage:"reserved"}})): [{source:"service_order",booking_id:9,day:"2026-10-22",status:"confirmed",line:{productId:30,quantity:8,stage:"reserved"},resource_window:window}])};
  if(/FROM stock_reservations/.test(text))return {rows:[{product_id:30,quantity:0}]};
  if(/original_lines AS/.test(text))return {rows:params.includes("20")?[{source:"service",id:7,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:window}},still_out:true}]:[]};
  if(/CROSS JOIN unnest/.test(text))return {rows:[{source:"service",id:8,event_date:"2026-10-22",details:{bookingOperations:{resourceWindow:window}}}]};
  if(/dispatch_assignments d/.test(text))return {rows:!options.clearDispatch&&params.includes(4)?[{source:"service",id:9,event_date:"2026-10-22",details:{}}]:[]};
  if(/kosha_id=/.test(text))return {rows:[]};
  throw Error(`Unexpected SQL ${text}`);
 }};
 return {value:await loadBookingConflictReport(tx,{source:"kosha",id:7}),queries};
}
const {value,queries}=await report();
assert.equal(value.source,"kosha");assert.equal(value.id,7);assert.equal(value.coverage,"partial");assert.equal(value.rows.length,8);
const byKey=new Map(value.rows.map(row=>[row.key,row]));
assert.equal(byKey.get("asset:20")!.state,"conflict");assert.deepEqual(byKey.get("asset:20")!.booking,{source:"service",id:7},"same numeric ID from another source is NOT self");
assert.equal(byKey.get("asset:40")!.state,"no_conflict","original fixed custody participates without a duplicate JSON line");assert.ok(byKey.has("asset:41"),"original work manifest resources are checked");
assert.equal(byKey.get("quantity:30")!.state,"conflict");assert.deepEqual(byKey.get("quantity:30")!.quantities,{required:10,available:7,reserved:8,missing:3,unit:"قطعة"});
assert.deepEqual(byKey.get("quantity:30")!.booking,{source:"service",id:9},"shortage report links to a genuinely overlapping original commitment, not another system");
assert.equal(byKey.get("staff:2")!.state,"conflict");assert.equal(byKey.get("vehicle:4")!.state,"incomplete");
assert.equal(byKey.get("crew:6")!.state,"no_conflict");assert.equal(byKey.get("kosha:3")!.state,"no_conflict");
assert.ok(queries.every(query=>!/FOR UPDATE/.test(query)));assert.ok(!JSON.stringify(value).includes("bookingOperations"),"return only report DTO, not private source JSON");
const missing=await report({missingTiming:true});assert.equal(missing.value.timingComplete,false);assert.ok(missing.value.rows.every(row=>row.state!=="no_conflict"));
const fraction=await report({fraction:true});assert.equal(fraction.value.rows.find(row=>row.key==="quantity:30")!.state,"incomplete","never floor unsupported historical quantities into fake availability");
const invalidRequired=await report({badRequired:true});assert.equal(invalidRequired.value.rows.find(row=>row.key==="quantity:30")!.quantities,undefined,"invalid quantities must not leak NaN/null as valid numeric data");
const missingProfile=await report({profileMissing:true});assert.equal(missingProfile.value.rows.find(row=>row.key==="quantity:30")?.state,"incomplete","missing quantity profile must not become an available individual asset");
const closedHistory=Array.from({length:1000},(_,i)=>({source:"service_order",booking_id:100+i,day:"2026-01-01",status:"completed",line:{productId:30,trackingMode:"quantity",quantity:1,reservedQty:1,checkedOutQty:1,returnedGoodQty:1,stage:"returned"}}));
const historyReport=await report({history:[...closedHistory,{source:"service_order",booking_id:9,day:"2026-10-22",status:"confirmed",line:{productId:30,quantity:8,stage:"reserved"},resource_window:window}]});
assert.deepEqual(historyReport.value.rows.find(row=>row.key==="quantity:30")!.quantities,{required:10,available:7,reserved:8,missing:3,unit:"قطعة"},"settled history must not exhaust live evidence or change original shortage");
assert.ok(historyReport.queries.some(query=>/AS resource_window/.test(query)&&/LIMIT 5001\b/.test(query)),"one bounded read with overflow sentinel, not paginated omissions");
const settled=closedHistory[0];
const splitReturn={...settled,line:{...settled.line,quantity:3,reservedQty:3,checkedOutQty:3,returnedGoodQty:1,returnedDamagedQty:1,missingQty:1,stage:"inspection"}};
assert.deepEqual(readConflictQuantityHistory({rows:[settled,splitReturn,{...settled,line:{...settled.line,stage:"completed"}},{...settled,line:{...settled.line,stage:"released",checkedOutQty:0,returnedGoodQty:0}}]},[30]),[],"balanced closed counters, including original damaged/missing buckets, hold no scheduling capacity");
const uncertain=[
 {...settled,line:{...settled.line,trackingMode:undefined}},
 {...settled,line:{...settled.line,quantity:1.5}},
 {...settled,line:{...settled.line,reservedQty:"invalid"}},
 {...settled,line:{...settled.line,preparedQty:1.5}},
 {...settled,line:{...settled.line,returnedGoodQty:2}},
 {...settled,line:{...settled.line,checkedOutQty:2}},
 {...settled,status:"cancelled",line:{...settled.line,stage:"out",returnedGoodQty:0}},
 {...settled,line:{...settled.line,stage:"unknown"}},
 {...settled,line:{...settled.line,quantity:true}},
 {...settled,line:{...settled.line,reservedQty:""}},
 {...settled,line:{...settled.line,missingQty:[]}},
];
assert.deepEqual(readConflictQuantityHistory({rows:uncertain},[30]),uncertain,"legacy, fractional, malformed, over-returned and outstanding evidence must remain visible despite terminal status");
const liveHistory=Array.from({length:500},(_,i)=>({...settled,booking_id:100+i,line:{productId:30,quantity:1,stage:"reserved"}}));
assert.equal(readConflictQuantityHistory({rows:liveHistory},[30]).length,500);
assert.throws(()=>readConflictQuantityHistory({rows:[...liveHistory,liveHistory[0]]},[30]),/كثيرة/);
assert.equal(readConflictQuantityHistory({rows:Array.from({length:5000},()=>settled)},[30]).length,0);
assert.throws(()=>readConflictQuantityHistory({rows:Array.from({length:5001},()=>settled)},[30]),/كثيرة/);
for(const bad of [undefined,{rows:null},{rows:{}},{rows:[{...settled,source:"other"}]},{rows:[{...settled,booking_id:0}]},{rows:[{...settled,booking_id:true}]},{rows:[{...settled,line:{...settled.line,productId:[30]}}]},{rows:[{...settled,line:{...settled.line,productId:999}}]}])assert.throws(()=>readConflictQuantityHistory(bad,[30]),/database response/i,"invalid identity is rejected before settled filtering");
for(const [key,bad] of [["quantity",true],["reservedQty",""],["missingQty",[]],["returnedDamagedQty",{}],["preparedQty",1.5]] as const){
 const result=await report({history:[{...settled,line:{...settled.line,[key]:bad}}]});
 assert.equal(result.value.rows.find(row=>row.key==="quantity:30")!.state,"incomplete",`malformed ${key} cannot become availability through Number coercion after retention`);
}
const overReturned=await report({history:[{...settled,line:{...settled.line,returnedGoodQty:2}}]});
assert.equal(overReturned.value.rows.find(row=>row.key==="quantity:30")!.state,"incomplete","retained over-return must not disappear behind the original clamped outstanding counter");
const unreturned=await report({history:[...closedHistory,{...settled,status:"cancelled",line:{...settled.line,returnedGoodQty:0,stage:"completed"}}]});
assert.equal(unreturned.value.rows.find(row=>row.key==="quantity:30")!.state,"incomplete","closed/cancelled but physically unreturned history stays in original checkout reconciliation");
for(const vehicleStatus of ["maintenance","repair","retired","inactive"]){
 const result=await report({vehicleStatus,clearDispatch:true});
 assert.equal(result.value.rows.find(row=>row.key==="vehicle:4")?.state,"incomplete",`dispatch-blocked vehicle status ${vehicleStatus} must remain visible for review even without an overlapping booking`);
}
for(const crewStatus of ["inactive","maintenance","unavailable"]){
 const result=await report({crewStatus,clearDispatch:true});
 assert.equal(result.value.rows.find(row=>row.key==="crew:6")?.state,"incomplete",`dispatch-blocked crew status ${crewStatus} must remain visible for review`);
}
const assigned=await report({vehicleStatus:"outside",crewStatus:"busy",clearDispatch:true});
assert.equal(assigned.value.rows.find(row=>row.key==="vehicle:4")?.state,"no_conflict","outside can be the original vehicle's own booking assignment");
assert.equal(assigned.value.rows.find(row=>row.key==="crew:6")?.state,"no_conflict","busy can be the original crew's own booking assignment");
await assert.rejects(()=>report({badNames:true}),/resource name database response/i);
await assert.rejects(()=>report({badResult:true}),/database response/i);await assert.rejects(()=>report({tooMany:true}),/كثيرة/);await assert.rejects(()=>report({fail:true}),/database unavailable/);
console.log("PASS read-only conflict report: original sources/holds, actual quantity shortage, missing timing, fractional legacy data, bounded SQL, no private JSON or writes; controlled IO, not PostgreSQL integration");
