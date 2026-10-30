import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {sql,eq,and,gte,lte,desc,asc,inArray} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {readTransportPlan,TransportPlanError} from "../src/lib/booking-transport-plan";
import {projectVehicleTransportBooking} from "../src/server/booking-transport-receipt";
import {addPlanVehicleStats} from "../src/server/vehicle-transport-plans";
const api=readFileSync("src/server/api.ts","utf8"),dialect=new PgDialect();
const legacy={mode:"ajn",fee:50000,vehicleId:5};
const initial=readTransportPlan({source:"service",id:7,bookingNumber:"B-7",legacy,storedPlan:null});
let plan={...initial,legacy:false,revision:1,feeMode:"per_trip" as "per_trip"|"overall",overallCharge:null as number|null,trips:[{...initial.trips[0],customerCharge:30000 as number|null},{...initial.trips[0],id:"t2",sequence:2,vehicleId:6,customerCharge:20000 as number|null}]};
let ioFailure=false,overflowLegacy=false;
const column=new Proxy({}, {get:(_target,key)=>sql.raw(String(key))});
const money=(v:unknown)=>Math.round(Number(v??0)*100)/100;
const booking=()=>({source:"service" as const,id:7,bookingNo:"B-7",customerName:"عميل",eventDate:"2026-10-24",total:200000,paid:100000,paymentStatus:"partial",plan});
async function run(kind:"list"|"financial"){
 const start=api.indexOf(kind==="list"?'  if (section === "vehicles") {':'  if (section === "vehicles" && parts[1] && parts[2] === "financial"');
 const end=kind==="list"?api.indexOf('    if (method === "POST") {',start):api.indexOf('  if (section === "vehicles" && parts[1] && parts[2] === "expenses"',start);
 let code=api.slice(start,end);if(kind==="list")code+='\n}';
 const db={query:{fleetVehiclesTable:{findFirst:async()=>({id:6,name:"الثانية",plateNumber:"6"}),findMany:async()=>[{id:6,name:"الثانية",purchasePrice:"0"}]},koshaBookingsTable:{findMany:async()=>overflowLegacy?Array.from({length:501},(_,index)=>({id:index+1,totalAmount:"100000",paidAmount:"50000",transportationFee:"10000"})):[]},staffTable:{findMany:async()=>[]},vehicleExpensesTable:{findMany:async()=>[{id:1,vehicleId:6,amount:"5000",status:"executed",financialTransactionId:10,expenseType:"fuel",expenseDate:new Date("2026-10-24"),cashAccountCode:"MASTER"}]},financialTransactionsTable:{findMany:async()=>[]}},execute:async(statement:any)=>{
  if(ioFailure)throw Error("fleet database unavailable");
  const q=dialect.sqlToQuery(statement).sql;
  if(q.includes("from fleet_vehicles v")) { assert.match(q,/transportPlan' is null/,"legacy aggregate must exclude saved trip plans");return {rows:[{id:6,trip_count:0,service_trip_count:0,transportation_revenue:0,service_transportation_revenue:0,vehicle_expenses:5000}]}; }
  if(q.includes("from service_orders s"))return {rows:[]};
  if(q.includes("from vehicle_expenses"))return {rows:[{id:1,service_order_id:7}]};
  return {rows:[]};
 }};
 const env={db,sql,eq,and,gte,lte,desc,asc,inArray,method:"GET",section:"vehicles",parts:["vehicles","6",kind],req:{nextUrl:new URL("https://example.test")},int:Number,money,readTransportPlan,TransportPlanError,projectVehicleTransportBooking,readVehicleTransportPlans:async()=>[booking()],addPlanVehicleStats,vehicleExpenseServiceLinkReady:async()=>true,VEHICLE_EXPENSE_TYPES:["fuel"],VEHICLE_EXPENSE_LABELS:{fuel:"وقود"},enterpriseDate:()=>null,json:(data:any)=>data,error:(message:string,status:number)=>({message,status}),fleetVehiclesTable:column,koshaBookingsTable:column,staffTable:column,vehicleExpensesTable:column,financialTransactionsTable:column};
 const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 return new AsyncFunction(...Object.keys(env),compiled)(...Object.values(env));
}
let response=await run("list");assert.equal(response.data[0].stats.transportationRevenue,20000);assert.equal(response.data[0].stats.netProfit,15000);assert.equal(response.data[0].stats.tripCount,1);
response=await run("financial");assert.equal(response.trips.length,1);assert.equal(response.trips[0].operations[0].id,"t2");assert.equal(response.trips[0].tripExpense,5000);assert.equal(response.trips[0].tripProfit,15000);
plan={...plan,feeMode:"overall",overallCharge:50000,trips:plan.trips.map(t=>({...t,customerCharge:null}))};
response=await run("financial");assert.equal(response.summary.transportationRevenue,null);assert.equal(response.summary.netProfit,null);assert.equal(response.summary.vehicleExpenses,5000);assert.equal(response.summary.unallocatedBookings,1);
response=await run("list");assert.equal(response.data[0].stats.transportationRevenue,null);
overflowLegacy=true;await assert.rejects(()=>run("financial"),/نطاق|حد|تصفية/);overflowLegacy=false;
ioFailure=true;await assert.rejects(()=>run("list"),/fleet database unavailable/);
console.log("PASS actual fleet list/financial handlers: secondary trip selected, legacy sums exclude plans, one expense, null unallocated profit and query failure propagation");
