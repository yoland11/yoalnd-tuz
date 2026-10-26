import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {assertPartnershipSchema,lockPartnership,appendPartnershipAudit,PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
const dialect=new PgDialect();let missing=false,absent=false,broken=false,failAudit=false;
const calls:Array<{sql:string;params:unknown[]}>=[];
const tx={execute:async(statement:any)=>{
 const query=dialect.sqlToQuery(statement);calls.push(query);
 if(broken)throw Error("connection unavailable");
 if(query.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map((name:string,index:number)=>({name,present:!(missing&&index===0)}))};
 if(query.sql.includes("FOR UPDATE"))return {rows:absent?[]:[{id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:"شركة",version:0}]};
 if(query.sql.includes("financial_audit_logs")){if(failAudit)throw Error("audit unavailable");return {rows:[{id:3}]};}
 throw Error("Unexpected repository query");
}};
await assertPartnershipSchema(tx);assert.equal(calls.length,1);assert.ok(calls.every(call=>/^\s*SELECT\b/i.test(call.sql)),"schema readiness never executes DDL or writes");
missing=true;await assert.rejects(()=>assertPartnershipSchema(tx),(error:any)=>error.status===503&&error.code==="SETUP_REQUIRED");missing=false;
broken=true;await assert.rejects(()=>assertPartnershipSchema(tx),/connection unavailable/);broken=false;
const before=calls.length;await assert.rejects(()=>lockPartnership(tx,0),(error:any)=>error.status===422);assert.equal(calls.length,before);
const row=await lockPartnership(tx,12);assert.equal(row.id,1);assert.equal(row.vehicleId,12);assert.ok(calls.at(-1)!.params.includes(12));assert.match(calls.at(-1)!.sql,/FOR UPDATE/);
absent=true;await assert.rejects(()=>lockPartnership(tx,12),(error:any)=>error.status===404);absent=false;
await assert.rejects(()=>assertPartnershipSchema({execute:async()=>({rows:null})}),/response|استجابة/);
await appendPartnershipAudit(tx,{vehicleId:12,partnershipId:1,action:"agreement_created",actor:{id:7,name:"مدير"},reason:"إعداد الشراكة",oldValues:{},newValues:{ownership:"partnership"}});
const audit=calls.at(-1)!;assert.match(audit.sql,/INSERT INTO financial_audit_logs/);assert.ok(audit.params.includes("vehicle_partnership_agreement_created"));assert.ok(audit.params.includes(7));
failAudit=true;await assert.rejects(()=>appendPartnershipAudit(tx,{vehicleId:12,partnershipId:1,action:"agreement_created",actor:{id:7,name:"مدير"},reason:"سبب"}),/audit unavailable/);
console.log("PASS real partnership repository SQL boundary: read-only schema gate, explicit setup failure, source row lock, identity validation, existing financial audit and propagated DB/audit failures");
console.log("LIMITATION: controlled executor only; not live PostgreSQL integration or concurrency proof.");
