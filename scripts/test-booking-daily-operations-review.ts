import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { loadDailyOperations } from "../src/server/booking-daily-operations";
import { buildDailyOperations, parseDailyOperationsFilters, projectDailyBooking, type DailyBookingFact } from "../src/lib/booking-daily-operations";

const now = new Date("2026-10-18T12:01:00Z");
const filters = parseDailyOperationsFilters(new URLSearchParams());
const base: DailyBookingFact = {source:"kosha",id:12,number:"K-12",customerName:"أحمد",eventDate:"2026-10-17",eventTime:"16:00",location:"بغداد",status:"confirmed",category:"kosha",details:{},assignedStaffId:null,vehicleId:null,vehicleName:null,transportationMode:null,crewName:null,overdueTasks:0,openTasks:0,products:[]};
let failures = 0;
async function check(name:string, fn:()=>void|Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch(cause) { failures++; console.error(`FAIL ${name}`, cause); }
}
function fixture(options:{arrival?:unknown; manifest?:any[]; details?:any; number?:string|null} = {}) {
  const queries:ReturnType<PgDialect["sqlToQuery"]>[]=[];
  return {queries,executor:{async execute(sql:any) {
    const q=new PgDialect().sqlToQuery(sql);queries.push(q);
    if(queries.length===1) return {rows:[{source:"kosha",id:12,number:options.number===undefined ? "K-12" : options.number,customer_name:"أحمد",event_date:"2026-10-17",event_time:"16:00",location:"بغداد",status:"confirmed",category:"kosha",details:options.details ?? {},execution_stage:"INSTALLING",required_arrival_at:options.arrival ?? null,arrived_at:null}]};
    if(q.sql.includes("kosha_work_order_assets")) return {rows:options.manifest ?? []};
    return {rows:[]};
  }}};
}

await check("original work-order manifest participates in pending returns",async()=>{
  const db=fixture({manifest:[{source_id:12,product_id:7,checked_out:true,returned:false,return_condition:null}]});
  const result=await loadDailyOperations(db.executor,filters,["kosha"],now);
  assert.equal(result.rows[0].pendingReturn,1);
  assert.equal(result.summary.pendingReturns,1);
  assert.ok(result.rows[0].issues.some(i=>i.kind==="previous-event-return"));
  const returned=fixture({manifest:[{source_id:12,product_id:7,checked_out:true,returned:true,return_condition:"good"}]});
  assert.equal((await loadDailyOperations(returned.executor,filters,["kosha"],now)).rows[0].pendingReturn,0);
  for (const condition of ["damaged","missing","maintenance"]) {
    const inspected=fixture({manifest:[{source_id:12,product_id:7,checked_out:true,returned:true,return_condition:condition}]});
    const row=(await loadDailyOperations(inspected.executor,filters,["kosha"],now)).rows[0];
    assert.equal(row.pendingReturn,0,`${condition} was accounted for at return, not still outside`);
    assert.equal(row.preparation.problems,1,`${condition} remains visible as an equipment problem`);
  }
  const overlap=fixture({details:{bookingOperations:{assets:[{productId:7,stage:"out"}]}},manifest:[{source_id:12,product_id:7,checked_out:true,returned:false}]});
  assert.equal((await loadDailyOperations(overlap.executor,filters,["kosha"],now)).rows[0].pendingReturn,1,"same physical identity cannot double the count");
  const mixed=fixture({details:{bookingOperations:{assets:[{productId:7,trackingMode:"quantity",quantity:4,checkedOutQty:3}]}},manifest:[{source_id:12,product_id:7,checked_out:true,returned:false}]});
  const mixedRow=(await loadDailyOperations(mixed.executor,filters,["kosha"],now)).rows[0];
  assert.equal(mixedRow.pendingReturn,3,"do not sum a possibly overlapping single physical checkout");
  assert.equal((mixedRow as any).returnEvidenceIncomplete,true,"mixed custody records must not claim an exact reconciled quantity");
  assert.ok(db.queries.find(q=>q.sql.includes("kosha_work_order_assets"))?.params.includes(12));
});
await check("Baghdad wall-clock arrival is independent of server timezone",async()=>{
  const original=process.env.TZ;process.env.TZ="UTC";
  try {
    for(const arrival of ["2026-10-18 15:00:00","2026-10-18T15:00","2026-10-18T15:00:00+03:00",new Date("2026-10-18T12:00:00Z")]) {
      const db=fixture({arrival});const result=await loadDailyOperations(db.executor,filters,["kosha"],now);
      assert.ok(result.rows[0].issues.some(i=>i.kind==="late-arrival"),`15:00 Baghdad must be overdue at 12:01Z: ${String(arrival)}`);
    }
  } finally { if(original===undefined) delete process.env.TZ;else process.env.TZ=original; }
});
await check("pre-limit search uses displayed fallback and number-name order",async()=>{
  const db=fixture({number:null});
  const result=await loadDailyOperations(db.executor,{...filters,search:"KOSHA-12 أحمد"},["kosha"],now);
  assert.equal(result.rows.length,1,"projection accepts the same combined search as SQL");
  const sql=db.queries[0].sql;
  assert.match(sql,/coalesce\(nullif\(number,''\),\s*CASE[\s\S]+KOSHA-[\s\S]+SRV-[\s\S]+\|\| ' ' \|\| coalesce\(customer_name,''\)/i);
  assert.ok(db.queries[0].params.includes("KOSHA-12 أحمد"));
  assert.ok(sql.indexOf("position(")<sql.indexOf("LIMIT"));
});
await check("photography stays in active field KPI after shooting starts",()=>{
  for(const stage of ["on_the_way","shooting"]) {
    const result=buildDailyOperations([{...base,source:"service",category:"photography",execution:{stage}}],filters,false,now);
    assert.equal(result.summary.active,1,`${stage} is active field execution`);
  }
});
assert.equal(failures,0,`${failures} review regressions remain`);
