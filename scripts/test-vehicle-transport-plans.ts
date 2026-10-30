import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {readTransportPlan} from "../src/lib/booking-transport-plan";
import {assertPlanFitsPartnershipLedger,readVehicleTransportPlans,addPlanVehicleStats} from "../src/server/vehicle-transport-plans";
const base=readTransportPlan({source:"service",id:7,bookingNumber:"B-7",legacy:{mode:"ajn",fee:50000,vehicleId:5},storedPlan:null});
const plan={...base,legacy:false,revision:1,feeMode:"per_trip",overallCharge:null,trips:[{...base.trips[0],customerCharge:30000},{...base.trips[0],id:"t2",sequence:2,vehicleId:6,customerCharge:20000}]};
let rows:any[]=[{source:"service",id:7,tracking_code:"AJN-1234-ABCDEF0123456789",customer_name:"عميل",event_date:"2026-10-24",total_amount:"200000",paid_amount:"100000",plan,legacy:{mode:"ajn",fee:50000,vehicleId:5}}];
const dialect=new PgDialect();let query:any;
const db={execute:async(statement:any)=>{query=dialect.sqlToQuery(statement);return {rows}}};
let result=await readVehicleTransportPlans(db,{vehicleId:6,from:"2026-10-01",to:"2026-10-31"});
assert.equal(result[0].plan.trips[1].vehicleId,6);assert.equal(result[0].bookingNo,"B-7-1234");
assert.match(query.sql,/UNION ALL/i);assert.match(query.sql,/LIMIT 1001/i);assert.ok(query.params.includes('{"trips":[{"vehicleId":6}]}'));
let stats=addPlanVehicleStats({tripCount:0,transportationRevenue:0,vehicleExpenses:5000},result,6);
assert.equal(stats.tripCount,1);assert.equal(stats.transportationRevenue,20000);assert.equal(stats.netProfit,15000);
assert.equal(addPlanVehicleStats({tripCount:0,transportationRevenue:0,vehicleExpenses:90000},result,6).netProfit,-70000,"a vehicle loss stays signed");
rows=[{...rows[0],plan:{...plan,feeMode:"overall",overallCharge:50000,trips:plan.trips.map(t=>({...t,customerCharge:null}))}}];
result=await readVehicleTransportPlans(db,{});stats=addPlanVehicleStats({tripCount:0,transportationRevenue:0,vehicleExpenses:5000},result,6);
assert.equal(stats.transportationRevenue,null);assert.equal(stats.netProfit,null);assert.equal(stats.unallocatedBookings,1);assert.equal(stats.vehicleExpenses,5000);
rows=[{...rows[0],plan:{trips:"corrupt"}}];await assert.rejects(()=>readVehicleTransportPlans(db,{}));
rows=Array.from({length:1001},()=>({}));await assert.rejects(()=>readVehicleTransportPlans(db,{}),/نطاق|حد|تصفية/);
await assert.rejects(()=>readVehicleTransportPlans({execute:async()=>{throw Error("database unavailable")}},{}),/database unavailable/);
console.log("PASS fleet plan reader and aggregation: bounded queries, secondary vehicles, fees once, unknown overall allocation, expense once and visible failures");

// The partnership ledger reads one vehicle per booking: a shared plan must not reach a partner's accounts.
{
  const trips=(...ids:(number|null)[])=>({trips:ids.map(vehicleId=>({vehicleId}))});
  let queried=0;
  const partnered={execute:async()=>{queried++;return {rows:[{vehicle_id:6}]};}};
  await assertPlanFitsPartnershipLedger(partnered,trips(6,6));
  assert.equal(queried,0,"one vehicle needs no check: the whole fee is that vehicle's");
  await assert.rejects(assertPlanFitsPartnershipLedger(partnered,trips(5,6)),(cause:any)=>cause.status===409&&/شراكة/.test(cause.message));
  await assertPlanFitsPartnershipLedger({execute:async()=>({rows:[]})},trips(5,6));
  await assert.rejects(assertPlanFitsPartnershipLedger({execute:async()=>({})},trips(5,6)),/Invalid vehicle partnership query response/,"a failed read never passes as no partnership");
}
console.log("PASS shared trip plans never reach a one-vehicle partnership ledger");
