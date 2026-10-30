import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod/v4";
import { sql, eq, and, ne } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as tables from "@workspace/db";
import * as plan from "../src/lib/booking-transport-plan";
const ast=ts.createSourceFile("api.ts",fs.readFileSync("src/server/api.ts","utf8"),ts.ScriptTarget.Latest,true);
let patch:ts.Block|undefined;
function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(ast)==='method === "PATCH"'&&ts.isBlock(n.thenStatement)&&n.thenStatement.getText(ast).includes("const compatiblePatch = rawPatch"))patch=n.thenStatement;ts.forEachChild(n,visit)}visit(ast);
assert.ok(patch);
const stop=patch.statements.findIndex(s=>s.getText(ast).startsWith("let [row] = await db.transaction"));
assert.ok(stop>0);
const prefix=patch.statements.slice(0,stop).map(s=>s.getText(ast)).join("\n");
const declaration=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==="KoshaBookingUpdateSchema"));assert.ok(declaration);
const legacy=plan.readTransportPlan({source:"kosha",id:7,bookingNumber:"B-7",legacy:{mode:"ajn",fee:50000,vehicleId:5,driverId:8},storedPlan:null});
const draft={...legacy,feeMode:"per_trip",overallCharge:null,trips:[{...legacy.trips[0],customerCharge:30000},{...legacy.trips[0],id:"trip-2",sequence:2,vehicleId:6,driverId:9,customerCharge:30000}]};
const existing:any={id:7,status:"confirmed",eventDate:"2026-10-24",totalAmount:"200000",paidAmount:"0",transportationMode:"ajn",transportationFee:"50000",transportationVehicleId:5,transportationDriverId:8,updatedAt:new Date("2026-10-24T10:00:00Z"),bookingDetails:{pricing:{totalAmount:200000,paidAmount:0}}};
async function run(payload:any,row=existing){
  const selected={from:()=>selected,where:()=>selected,limit:async()=>[]};
  const context:any={...tables,...plan,sql,eq,and,ne,z,existing:row,id:7,req:{headers:new Map()},auth:{role:"admin",username:"admin"},KOSHA_BOOKING_STATUS_VALUES:["confirmed","cancelled"],
    body:async()=>payload,canEditOrderFinancials:()=>true,money:(v:any)=>Math.round(Number(v??0)*100)/100,
    nullableText:(v:any)=>v==null?null:String(v).trim()||null,textFallback:(v:any,old:any)=>v||old,normalizeKoshaStringList:(v:any)=>v??[],
    paymentSummary:(total:number,paid:number)=>({deposit:paid,remaining:total-paid,status:paid?"partial":"unpaid"}),transportVehicleBookedElsewhere:async()=>null,transportVehicleClash:async()=>null,assertPlanFitsPartnershipLedger:async()=>undefined,
    error:(message:string,status:number)=>({status,message}),validationError:()=>({status:422}),
    db:{query:{fleetVehiclesTable:{findFirst:async()=>({id:5,isActive:true})},staffTable:{findFirst:async()=>({id:8})},koshaBookingsTable:{findFirst:async()=>null}},select:()=>selected},
  };
  vm.createContext(context);
  const code=`${declaration.getText(ast)}\nasync function run(){${prefix}\nreturn {update,parsed:parsed.data,transportationRequested};}`;
  vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  try{return await context.run()}catch(cause){if(cause instanceof plan.TransportPlanError)return {status:cause.status};throw cause}
}
let result=await run({transportPlan:draft,expectedTransportRevision:0});
assert.equal(result.update.totalAmount,"210000","original Kosha pricing replaces 50,000 with derived 60,000 once");
assert.equal(result.update.transportationFee,"60000");
assert.equal(result.update.bookingDetails.pricing.totalAmount,210000,"original product recalculation must not restore the old transport price");
assert.equal(result.parsed.transportPlan.trips.length,2);
result=await run({transportPlan:draft,expectedTransportRevision:0},{...existing,paidAmount:"20000"});
assert.equal(result.status,409,"original paid-booking restriction remains intact");
const saved=plan.prepareTransportPlanSave(legacy,draft,0,true).plan;
result=await run({transportationFee:1},{...existing,bookingDetails:{...existing.bookingDetails,bookingOperations:{transportPlan:saved}}});
assert.equal(result.status,409,"legacy Kosha edit cannot corrupt a multi-trip plan");
console.log("PASS actual Kosha transport PATCH preparation: derived aggregate, pricing base compatibility, paid guard and protected plan edits");

// Exercise the ORIGINAL transaction expression against controlled row IO. A plan
// omitted from its canonical JSON leaf, or checked only before locking, must fail.
const rowStatement=patch.statements[stop] as ts.VariableStatement;
const expression=rowStatement.declarationList.declarations[0].initializer!.getText(ast);
const prepared=await run({transportPlan:draft,expectedTransportRevision:0});
const dialect=new PgDialect();
for(const mode of ["clear","stale","paid"]){
  let row:any=structuredClone(existing),writes=0,commits=0;
  if(mode==="stale"){
    const changedDraft={...draft,trips:[{...draft.trips[0],customerCharge:40000},draft.trips[1]]};
    row.transportationFee="70000";row.totalAmount="220000";row.bookingDetails={bookingOperations:{transportPlan:plan.prepareTransportPlanSave(legacy,changedDraft,0,true).plan}};
  }
  if(mode==="paid")row.paidAmount="10000";
  const before=structuredClone(row);
  const tx:any={query:{koshaBookingsTable:{findFirst:async()=>structuredClone(row)}},execute:async()=>({rows:[]}),update:()=>({set:(data:any)=>({where:()=>({returning:async()=>{
    writes++;
    const q=dialect.sqlToQuery(data.bookingDetails);
    const encoded=q.params.filter((p:any)=>typeof p==="string").map((p:any)=>{try{return JSON.parse(p)}catch{return null}});
    const savedPlan=encoded.find((p:any)=>p?.version===1&&Array.isArray(p.trips));
    row={...row,...data,bookingDetails:{...row.bookingDetails,bookingOperations:{transportPlan:savedPlan}}};
    return [row];
  }})})})};
  const context:any={...tables,...plan,sql,eq,id:7,existing,update:prepared.update,transportPlanChange:plan.prepareTransportPlanSave(legacy,draft,0,true),transportPlanReplayed:false,parsed:{data:{transportPlan:draft,expectedTransportRevision:0}},auth:{role:"admin"},
    bookingEvidenceWriteSql:(_column:any,patch:any)=>sql`${JSON.stringify(patch)}::jsonb`,canEditOrderFinancials:()=>true,reconcilePaymentState:async()=>({approvedPaidAmount:"0"}),
    transportVehicleClash:async()=>null,
    assertPlanFitsPartnershipLedger:async()=>undefined,
    guardBookingResourceWrite:async(_tx:any,_ref:any,work:any)=>work({details:row.bookingDetails,operations:row.bookingDetails?.bookingOperations??{}}),
    db:{transaction:async(work:any)=>{try{const result=await work(tx);commits++;return result}catch(cause){row=before;throw cause}}},
  };
  vm.createContext(context);vm.runInContext(ts.transpileModule(`async function run(){return ${expression}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  if(mode==="clear"){await context.run();assert.equal(row.bookingDetails.bookingOperations.transportPlan?.revision,1,"canonical plan leaf must be written with the aggregate under the source lock");assert.equal(commits,1);}
  else{await assert.rejects(()=>context.run(),/تغيّر|حدّث|دفعات/);assert.equal(commits,0);assert.equal(writes,0,"stale or newly paid booking must be rejected before any write");}
}
console.log("PASS actual Kosha transport transaction: saved plan leaf, locked stale revision/paid recheck and rollback before writes");
