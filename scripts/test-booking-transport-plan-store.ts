import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as transport from "../src/lib/booking-transport-plan";
import { mergeBookingOperationalEvidence, bookingEvidenceWriteSql } from "../src/server/booking-operations-write-guard";

const prepare = (transport as any).prepareTransportPlanSave;
assert.equal(typeof prepare,"function","saving must validate current revision under the original booking lock");
const legacy = transport.readTransportPlan({source:"kosha",id:7,bookingNumber:"B-7",legacy:{mode:"ajn",fee:50000,vehicleId:5,driverId:8},storedPlan:null});
const draft:any={...legacy,feeMode:"per_trip",overallCharge:null,trips:[{...legacy.trips[0],customerCharge:30000},{...legacy.trips[0],id:"new-2",sequence:2,vehicleId:6,driverId:9,customerCharge:20000}]};
const first=prepare(legacy,draft,0,true);
assert.equal(first.fee,50000,"legacy 50,000 is replaced, not added again");
assert.equal(first.plan.revision,1);
assert.equal(first.duplicate,false);
const saved={...first.plan,legacy:false};
const retry=prepare(saved,draft,0,true);
assert.equal(retry.duplicate,true,"same stale retry is idempotent");
assert.equal(retry.plan.revision,1);
assert.throws(()=>prepare(saved,{...draft,trips:[{...draft.trips[0],customerCharge:35000},draft.trips[1]]},0,true),/تغيّر|حدّث/);
assert.throws(()=>prepare(saved,{...draft,revision:1,trips:[{...draft.trips[0],customerCharge:35000},draft.trips[1]]},1,false),/صلاحية/);
assert.equal(prepare(saved,{...draft,revision:1},1,false).duplicate,true,"unchanged same-revision save causes no money mutation");
assert.throws(()=>prepare(saved,{...draft,revision:1,trips:[draft.trips[0]]},1,true),/حذف|إزالة|سجل/);
assert.throws(()=>prepare(saved,{...draft,revision:1,trips:[{...draft.trips[0],sequence:9},draft.trips[1]]},1,true),/رقم|سجل/);
assert.throws(()=>prepare(saved,{...draft,revision:1,trips:[{...draft.trips[0],vehicleId:null},draft.trips[1]]},1,true),/مركبة|سيارة/);
const changed=prepare(saved,{...draft,revision:1,feeMode:"overall",overallCharge:60000,trips:draft.trips.map((t:any)=>({...t,customerCharge:null}))},1,true);
assert.equal(changed.fee,60000);
assert.equal(changed.plan.revision,2);

// A stale generic booking form must not erase, rewrite or resurrect trip plans.
const live={bookingOperations:{transportPlan:first.plan,loading:{id:"m-1"}}};
for(const patch of [{bookingOperations:{transportPlan:draft}},{bookingOperations:{transportPlan:null}},{bookingOperations:{other:"keep"}}]){
  assert.deepEqual(mergeBookingOperationalEvidence(live,patch).bookingOperations.transportPlan,first.plan);
}
assert.equal(mergeBookingOperationalEvidence({bookingOperations:{}},{bookingOperations:{transportPlan:first.plan}}).bookingOperations.transportPlan,undefined);
assert.equal(mergeBookingOperationalEvidence({bookingOperations:{transportPlan:first.plan,transportation:{mode:"ajn",fee:50000}}},{bookingOperations:{transportation:{mode:"ajn",fee:1}}}).bookingOperations.transportation.fee,50000,"stale generic forms cannot detach the original charge from its trip plan");
// Test the SQL boundary receives a sanitized patch, not a stale plan. The canonical
// transport writer explicitly sets its own leaf only AFTER this safe projection.
const q=new PgDialect().sqlToQuery(bookingEvidenceWriteSql(sql.raw("booking_details"),{bookingOperations:{transportPlan:draft,note:"edited"}}));
const patch=q.params.map((v:any)=>{if(typeof v!=="string")return null;try{return JSON.parse(v)}catch{return null}}).find((v:any)=>v?.bookingOperations);
assert.equal(patch.bookingOperations.transportPlan,undefined);
assert.equal(patch.bookingOperations.note,"edited");
console.log("PASS transport save contract: exact fee, revision conflict, retry no-op, permission, stable identities and stale JSON protection");
