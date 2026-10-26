import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {saveVehicleAgreement,approveVehicleAgreement,rejectVehicleAgreement,readVehiclePartnership,searchPartnershipParties} from "../src/server/vehicle-partnership/agreements";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";

const dialect=new PgDialect();
const admin={id:7,name:"مدير",role:"admin",isActive:true,permissions:[]};
const accountant={...admin,role:"employee",permissions:["accounting"]};
const outsider={...admin,role:"employee",permissions:["dashboard"]};
const draft={vehicleId:12,registrationOwner:"شركة علي جان",effectiveFrom:"2026-10-01",members:[
 {party:{kind:"customer" as const,id:1},ownershipBasisPoints:5000,profitBasisPoints:5000,expenseBasisPoints:5000,capitalContribution:"10000000"},
 {party:{kind:"supplier" as const,id:2},ownershipBasisPoints:5000,profitBasisPoints:5000,expenseBasisPoints:5000,capitalContribution:"10000000"},
]};
const command={draft,expectedVersion:0,idempotencyKey:"agreement-test-1",reason:"إنشاء اتفاق الشراكة"};
type State={root:any;agreements:any[];members:any[];audits:number};
let state:State={root:null,agreements:[],members:[],audits:0};
let calls:Array<{sql:string;params:any[]}>=[],failAudit=false,partyMissing=false,closedDate:string|null=null,loss="0.00";
const tx={execute:async(statement:any)=>{
 const q=dialect.sqlToQuery(statement);calls.push(q);const p=q.params;
 if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(q.sql.includes("pg_advisory_xact_lock"))return {rows:[{}]};
 if(q.sql.includes("FROM fleet_vehicles"))return {rows:p.includes(12)?[{id:12,branch_id:2,is_active:true,name:"مركبة",plate_number:"123",purchase_price:"20000000.00",purchase_date:"2026-09-01"}]:[]};
 if(q.sql.includes("FROM vehicle_partnerships"))return {rows:state.root?[state.root]:[]};
 if(q.sql.includes("INSERT INTO vehicle_partnerships")){state.root={id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:draft.registrationOwner,version:0};return {rows:[state.root]};}
 if(q.sql.includes("vp_agreement_history"))return {rows:state.agreements};
 if(q.sql.includes("vp_agreement_replay"))return {rows:state.agreements.filter(a=>a.idempotency_key===p[0])};
 if(q.sql.includes("vp_agreement_members"))return {rows:state.members.filter(m=>m.agreement_id===p[0])};
 if(q.sql.includes("vp_closed_boundary"))return {rows:[{closed_through:closedDate}]};
 if(q.sql.includes("vp_carried_loss"))return {rows:[{amount:loss}]};
 if(q.sql.includes("vp_party_lookup"))return {rows:partyMissing?[]:[{id:p[0],name:"شريك أصلي"}]};
 if(q.sql.includes("vp_party_search"))return {rows:[{id:1,name:"أحمد",kind:"customer"}]};
 if(q.sql.includes("INSERT INTO vehicle_partnership_agreements")){
  const a={id:state.agreements.length+1,partnership_id:p[0],revision:p[1],effective_from:p[2],status:"pending",policy:JSON.parse(p[3]),idempotency_key:p[4],reason:p[5]};state.agreements.push(a);return {rows:[a]};
 }
 if(q.sql.includes("INSERT INTO vehicle_partnership_members")){
  const m={id:state.members.length+1,agreement_id:p[0],party_kind:p[1],customer_id:p[2],supplier_id:p[3],staff_id:p[4],ownership_basis_points:p[5],profit_basis_points:p[6],expense_basis_points:p[7],capital_contribution:p[8]};state.members.push(m);return {rows:[m]};
 }
 if(q.sql.includes("UPDATE vehicle_partnership_agreements")){const a=state.agreements.find(a=>a.id===(q.sql.includes("status='rejected'")?p[0]:p[1]));a.status=q.sql.includes("status='rejected'")?"rejected":"approved";return {rows:[a]};}
 if(q.sql.includes("UPDATE vehicle_partnerships")){state.root.version++;return {rows:[state.root]};}
 if(q.sql.includes("financial_audit_logs")){if(failAudit)throw Error("audit unavailable");state.audits++;return {rows:[{id:state.audits}]};}
 throw Error(`Unexpected agreement query: ${q.sql}`);
}};
const db={...tx,transaction:async<T>(work:(executor:typeof tx)=>Promise<T>)=>{const before=structuredClone(state);try{return await work(tx);}catch(cause){state=before;throw cause;}}};
await assert.rejects(()=>readVehiclePartnership(db,outsider,12),(e:any)=>e.status===403);assert.equal(calls.length,0,"authorization precedes any IO");
const empty=await readVehiclePartnership(db,admin,12);assert.equal(empty.partnership,null);assert.equal(empty.vehicle.id,12,"legacy original vehicle remains readable without configuration");
await assert.rejects(()=>saveVehicleAgreement(db,{...accountant,allowedBranchIds:[3]},12,command),(e:any)=>e.status===403);
partyMissing=true;await assert.rejects(()=>saveVehicleAgreement(db,admin,12,command),(e:any)=>e.status===422);partyMissing=false;assert.equal(state.root,null,"invalid source party rolls back initial config");
failAudit=true;await assert.rejects(()=>saveVehicleAgreement(db,admin,12,command),/audit unavailable/);failAudit=false;assert.equal(state.root,null,"failed audit rolls back header, members and agreement");
const saved=await saveVehicleAgreement(db,accountant,12,command);assert.equal(saved.agreement.status,"pending");assert.equal(saved.version,1);assert.equal(state.members.length,2);assert.equal(state.audits,1);
const writes=state.audits;const retry=await saveVehicleAgreement(db,accountant,12,command);assert.equal(retry.agreement.id,saved.agreement.id);assert.equal(state.audits,writes,"same retry adds no agreement, audit or capital receipt");
await assert.rejects(()=>saveVehicleAgreement(db,admin,12,{...command,draft:{...draft,registrationOwner:"آخر"}}),(e:any)=>e.status===409,"idempotency reuse cannot change terms");
await assert.rejects(()=>saveVehicleAgreement(db,admin,13,{...command,draft:{...draft,vehicleId:13},idempotencyKey:"second-vehicle"}),(e:any)=>e.status===404||e.status===409);
await assert.rejects(()=>saveVehicleAgreement(db,admin,12,{...command,idempotencyKey:"stale-version"}),(e:any)=>e.status===409);
await assert.rejects(()=>approveVehicleAgreement(db,accountant,12,{agreementId:1,expectedVersion:1,reason:"اعتماد"}),(e:any)=>e.status===403);
failAudit=true;await assert.rejects(()=>approveVehicleAgreement(db,admin,12,{agreementId:1,expectedVersion:1,reason:"اعتماد"}),/audit unavailable/);failAudit=false;assert.equal(state.agreements[0].status,"pending","failed approval audit restores pending agreement and version");assert.equal(state.root.version,1);
const approved=await approveVehicleAgreement(db,admin,12,{agreementId:1,expectedVersion:1,reason:"اعتماد الاتفاق"});assert.equal(approved.agreement.status,"approved");assert.equal(approved.version,2);
const auditCount=state.audits;await approveVehicleAgreement(db,admin,12,{agreementId:1,expectedVersion:1,reason:"اعتماد الاتفاق"});assert.equal(state.audits,auditCount,"approved retry remains singular");
closedDate="2026-10-31";await assert.rejects(()=>saveVehicleAgreement(db,admin,12,{...command,expectedVersion:2,idempotencyKey:"backdated",draft:{...draft,effectiveFrom:"2026-10-15"}}),(e:any)=>e.status===409);
closedDate=null;loss="100.00";await assert.rejects(()=>saveVehicleAgreement(db,admin,12,{...command,expectedVersion:2,idempotencyKey:"loss-unresolved",draft:{...draft,effectiveFrom:"2026-11-01"}}),(e:any)=>e.status===409,"unresolved carried loss cannot be silently transferred");
const amendment=await saveVehicleAgreement(db,admin,12,{...command,expectedVersion:2,idempotencyKey:"loss-resolved",draft:{...draft,effectiveFrom:"2026-11-01"},lossResolution:{kind:"retain_original_members",reason:"تبقى الخسارة بعهدة أصحابها حسب الاتفاق السابق"}});assert.equal(amendment.agreement.revision,2);
assert.equal(state.agreements[0].status,"approved","amendment never overwrites old terms");
await assert.rejects(()=>rejectVehicleAgreement(db,accountant,12,{agreementId:2,expectedVersion:3,reason:"تصحيح"}),(e:any)=>e.status===403);
const rejected=await rejectVehicleAgreement(db,admin,12,{agreementId:2,expectedVersion:3,reason:"تصحيح بيانات التعديل"});assert.equal(rejected.agreement.status,"rejected");
assert.equal(state.agreements[0].status,"approved");
await saveVehicleAgreement(db,admin,12,{...command,expectedVersion:4,idempotencyKey:"corrected-amendment",draft:{...draft,effectiveFrom:"2026-11-01"},lossResolution:{kind:"retain_original_members",reason:"تبقى الخسارة بعهدة أصحابها"}});assert.equal(state.agreements.length,3,"rejected amendment remains historic but does not block a corrected effective date");
const found=await searchPartnershipParties(db,admin,12,{kind:"customer",query:"أحمد"});assert.equal(found.items[0].name,"أحمد");
assert.ok(calls.some(q=>q.sql.includes("pg_advisory_xact_lock")),"initial singleton creation serialized");
assert.ok(!calls.some(q=>/INSERT INTO (financial_transactions|financial_ledger_entries|vehicle_partnership_rights)|UPDATE master_cash_box/.test(q.sql)),"configuration never creates capital, profit rights or cash movement");
console.log("PASS original-party single vehicle agreement handlers: authorization/scope, legacy empty config, transactional audit rollback, durable retry conflict, stale version, admin approval, dated immutable terms and explicit loss responsibility.");
console.log("LIMITATION: controlled transaction executor; real PostgreSQL concurrency separately guarded.");
