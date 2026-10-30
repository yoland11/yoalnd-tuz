import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import * as tables from "@workspace/db";
import * as plan from "../src/lib/booking-transport-plan";
import { transportTotalDelta } from "../src/lib/booking-transport";

const api=fs.readFileSync("src/server/api.ts","utf8");
const start=api.indexOf('  if (resource === "transportation") {');
const block=api.slice(start,api.indexOf('  if (resource === "group-attendees") {',start));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const dialect=new PgDialect();
const initial=plan.readTransportPlan({source:"service",id:7,bookingNumber:"B-7",legacy:{mode:"ajn",fee:50000,inTotal:true,vehicleId:5,driverId:8,note:"تفاصيل النقل الأصلية"},storedPlan:null});
const draft={...initial,feeMode:"per_trip",overallCharge:null,trips:[{...initial.trips[0],customerCharge:30000},{...initial.trips[0],id:"trip-2",sequence:2,vehicleId:6,driverId:9,customerCharge:30000}]};
let state:any={total:200000,paid:0,ops:{baseBookingAmount:160000,transportation:{mode:"ajn",fee:50000,inTotal:true,vehicleId:5,driverId:8,note:"تفاصيل النقل الأصلية"}},writes:0};
class CheckoutError extends Error{constructor(message:string,public status=409,public options={}){super(message)}}
async function run(payload:any,financial=true,failAudit=false){
  const before=structuredClone(state);
  const tx={execute:async(q:any)=>{
    const statement=dialect.sqlToQuery(q).sql.toLowerCase().replace(/\s+/g," ").trim();
    if(statement.startsWith("select total_amount"))return {rows:[{total_amount:String(state.total),deposit_amount:String(state.paid),event_date:"2026-10-24"}]};
    if(statement.startsWith("insert into entity_timeline")){if(failAudit)throw Error("transport audit unavailable");return {rows:[]};}
    throw Error("Unexpected transport route query "+statement);
  },update:()=>({set:(data:any)=>({where:async()=>{state.total=Number(data.totalAmount??state.total);state.paid=Number(data.depositAmount??state.paid);state.writes++}})})};
  const reference:any={source:"service",id:7,entityType:"service_order",row:{bookingCode:"B-7"},details:{bookingOperations:state.ops},operations:state.ops,eventDate:"2026-10-24"};
  const env:any={...tables,sql,eq,and,...plan,resource:"transportation",method:"POST",reference,auth:{id:1,role:"admin",username:"admin",fullName:"مدير"},req:{},
    can:()=>true,canEditOrderFinancials:()=>financial,body:async()=>payload,
    BookingTransportationSchema:z.object({mode:z.enum(["ajn","customer"]).nullable().optional(),fee:z.coerce.number().default(0),vehicleId:z.number().nullable().optional(),driverId:z.number().nullable().optional(),note:z.string().nullable().optional(),transportPlan:z.unknown().optional(),expectedTransportRevision:z.number().optional()}),
    money:(v:any)=>Math.round(Number(v)*100)/100,transportTotalDelta,transportVehicleBookedElsewhere:async()=>null,CheckoutError,
    paymentSummary:(total:number,paid:number)=>({deposit:paid,remaining:total-paid,status:paid?"partial":"unpaid"}),
    transportVehicleClash:async()=>null,
    assertPlanFitsPartnershipLedger:async()=>undefined,
    guardBookingResourceWrite:async(_tx:any,_ref:any,work:any)=>work({details:{bookingOperations:state.ops},operations:state.ops}),
    saveBookingOperations:async(_ref:any,ops:any,_tx:any,savedPlan:any)=>{state.ops=structuredClone({...ops,...(savedPlan?{transportPlan:savedPlan}:{})});state.writes++},
    reconcilePaymentState:async()=>({approvedPaidAmount:String(state.paid)}),
    json:(data:any)=>({status:200,data}),error:(message:string,status:number)=>({status,message}),validationError:()=>({status:422}),formatCurrency:String,
    addEntityTimeline:async()=>{},erpActorFromAdmin:()=>({id:1,name:"مدير"}),logAdminActivity:async()=>{},
    db:{query:{fleetVehiclesTable:{findFirst:async()=>({id:5,name:"سيارة",isActive:true})},staffTable:{findFirst:async()=>({id:8,isActive:true})}},transaction:async(work:any)=>{try{return await work(tx)}catch(cause){state=before;throw cause}}},
  };
  const entries=Object.entries(env).filter(([key])=>/^[a-zA-Z_$][\w$]*$/.test(key)&&key!=="default");
  const compiled=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  try{return await new AsyncFunction(...entries.map(([key])=>key),compiled)(...entries.map(([,value])=>value))}catch(cause){if(cause instanceof plan.TransportPlanError)return {status:cause.status};throw cause}
}
let response=await run({mode:"ajn",fee:1,vehicleId:5,driverId:8,transportPlan:draft,expectedTransportRevision:0});
assert.equal(response.status,200);
assert.equal(state.total,210000,"server derives 60,000 trip fee, replacing 50,000 once; client fee ignored");
assert.equal(state.ops.baseBookingAmount,170000,"authoritative base grows by the same delta without adding booking products twice");
assert.equal(state.ops.transportation.note,"تفاصيل النقل الأصلية","trip-plan upgrade must preserve the original transport notes");
assert.equal(state.ops.transportPlan.revision,1);
const writes=state.writes;
response=await run({mode:"ajn",fee:1,vehicleId:5,transportPlan:draft,expectedTransportRevision:0});
assert.equal(response.status,200);
assert.equal(state.total,210000);
assert.equal(state.writes,writes,"same retry must not save again");
response=await run({mode:"ajn",fee:1,vehicleId:5,transportPlan:{...draft,trips:[{...draft.trips[0],customerCharge:40000},draft.trips[1]]},expectedTransportRevision:0});
assert.equal(response.status,409);
assert.equal(state.writes,writes);
response=await run({mode:"ajn",fee:1,vehicleId:5});
assert.equal(response.status,409,"legacy single-config edits cannot erase a saved plan");
assert.equal(state.writes,writes);
response=await run({mode:"ajn",fee:1,vehicleId:5,transportPlan:{...draft,revision:1,trips:[{...draft.trips[0],customerCharge:40000},draft.trips[1]]},expectedTransportRevision:1},false);
assert.equal(response.status,403);
assert.equal(state.total,210000);
await assert.rejects(()=>run({mode:"ajn",fee:1,vehicleId:5,transportPlan:{...draft,revision:1,trips:[{...draft.trips[0],customerCharge:40000},draft.trips[1]]},expectedTransportRevision:1},true,true),/transport audit unavailable/);
assert.equal(state.total,210000,"failed plan audit rolls the original aggregate write back");
assert.equal(state.ops.transportPlan.revision,1);
console.log("PASS actual service transport route: server-derived aggregate, one delta, same retry no writes, stale/legacy conflicts, financial authorization and transaction rollback");
