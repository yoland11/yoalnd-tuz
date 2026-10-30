import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {sql,and,eq} from "drizzle-orm";
import {readTransportPlan} from "../src/lib/booking-transport-plan";
const source=readFileSync("src/server/api.ts","utf8"),start=source.indexOf('  if (section === "vehicles" && parts[1] && parts[2] === "expenses" && method === "POST" && !parts[3]) {');
const prefix=source.slice(start,source.indexOf('    const result = await db.transaction',start))+'return {status:200};}';
const compiled=ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const initial=readTransportPlan({source:"service",id:7,bookingNumber:"B-7",legacy:{mode:"ajn",fee:50000,vehicleId:5},storedPlan:null});
const plan={...initial,legacy:false,revision:1,trips:[initial.trips[0],{...initial.trips[0],id:"t2",sequence:2,vehicleId:6}]};
const table=new Proxy({},{get:(_target,key)=>sql.raw(String(key))});
async function run(kind:"kosha"|"service",vehicleId:number,storedPlan:any){
 const data=kind==="kosha"?{bookingId:7}:{serviceOrderId:7};
 const db={query:{fleetVehiclesTable:{findFirst:async()=>({id:vehicleId,isActive:true})},koshaBookingsTable:{findFirst:async()=>({id:7,transportationMode:"ajn",transportationFee:"50000",transportationVehicleId:5,bookingDetails:{bookingOperations:{transportPlan:storedPlan}}})}},execute:async()=>({rows:[{id:7,transportation:{mode:"ajn",fee:50000,vehicleId:5},transport_plan:storedPlan}]})};
 const env={db,sql,and,eq,section:"vehicles",method:"POST",parts:["vehicles",String(vehicleId),"expenses"],req:{},int:Number,isResponse:()=>false,requirePermission:async()=>({id:1}),VehicleExpenseSchema:{extend:()=>({safeParse:()=>({success:true,data})})},z:{coerce:{number:()=>({int:()=>({positive:()=>({optional:()=>({nullable:()=>({})})})})})}},body:async()=>data,vehicleExpenseServiceLinkReady:async()=>true,SERVICE_TRANSPORT:sql.raw("custom_fields->'bookingOperations'->'transportation'"),readTransportPlan,error:(message:string,status:number)=>({message,status}),fleetVehiclesTable:table,koshaBookingsTable:table};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 return new AsyncFunction(...Object.keys(env),compiled)(...Object.values(env));
}
for(const kind of ["kosha","service"] as const){
 assert.equal((await run(kind,6,plan)).status,200,"secondary assigned vehicle may link the same existing expense workflow");
 assert.equal((await run(kind,9,plan)).status,400,"unrelated vehicle cannot claim the booking expense");
 assert.equal((await run(kind,5,null)).status,200,"legacy primary assignment remains valid");
 assert.equal((await run(kind,6,null)).status,400);
 await assert.rejects(()=>run(kind,6,{trips:"corrupt"}));
}
console.log("PASS actual vehicle expense eligibility: both original sources, secondary plan vehicle, legacy identity and corrupt-plan refusal; financial posting untouched");
