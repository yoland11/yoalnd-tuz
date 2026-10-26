import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {submitPartnershipCapital,preparePartnershipCapitalRequest} from "../src/server/vehicle-partnership/capital";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
const actor={id:7,name:"محاسب",role:"employee",isActive:true,permissions:["accounting"]};
let rights:any[]=[],requests=0,audits=0,failAudit=false,memberApproved=true;const dialect=new PgDialect(),calls:string[]=[];
const root={id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:"شركة",version:2};
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params;calls.push(q.sql);
 if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(q.sql.includes("FROM fleet_vehicles"))return {rows:[{id:12,branch_id:null,name:"نيسان",is_active:true,purchase_price:"20000000.00"}]};
 if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[root]};
 if(q.sql.includes("vp_capital_member"))return {rows:memberApproved?[{id:11,agreement_id:3,partnership_id:1,status:"approved",effective_from:"2026-10-01"}]:[]};
 if(q.sql.includes("vp_capital_replay"))return {rows:rights.filter(r=>r.event_key===p[0])};
 if(q.sql.includes("vp_capital_source"))return {rows:rights.filter(r=>r.id===p[0]).map(r=>({...r,vehicle_id:12}))};
 if(q.sql.includes("INSERT INTO vehicle_partnership_rights")){const row={id:41,partnership_id:p[0],agreement_id:p[1],member_id:p[2],amount:p[3],event_key:p[4],created_by:p[5],reason:p[6],source_snapshot:JSON.parse(p[7]),category:"capital",direction:"credit",status:"pending",financial_transaction_id:null};rights.push(row);return {rows:[row]};}
 if(q.sql.includes("UPDATE vehicle_partnership_rights")){rights[0].financial_transaction_id=p[0];return {rows:[{id:41}]};}
 if(q.sql.includes("vp_payment_right_scope"))return {rows:[{vehicle_id:12}]};
 if(q.sql.includes("vp_payment_right_lock"))return {rows:rights};
 if(q.sql.includes("vp_payment_allocations"))return {rows:[]};
 if(q.sql.includes("financial_audit_logs")){if(failAudit)throw Error("capital audit failed");audits++;return {rows:[{id:audits}]};}
 throw Error(`unexpected capital source SQL ${q.sql}`);
}};
const db={...tx,transaction:async<T>(work:(executor:typeof tx)=>Promise<T>)=>{const before=structuredClone({rights,requests,audits});try{return await work(tx);}catch(cause){rights=before.rights;requests=before.requests;audits=before.audits;throw cause;}}};
const command={memberId:11,amount:"10000000.00",entryDate:"2026-10-20",expectedVersion:2,idempotencyKey:"capital-declaration-001",reason:"تسجيل مساهمة رأس مال؛ القبض مستقل"};
const create=async(executor:any,reference:any,a:any)=>{const plan=await preparePartnershipCapitalRequest(executor,reference,a);assert.equal(plan.amount,command.amount);assert.equal(plan.direction,"revenue");assert.equal(plan.transactionType,"vp_capital_record");assert.equal(plan.transactionDate,command.entryDate);requests++;return {id:91,approvalStatus:"pending"};};
await assert.rejects(()=>submitPartnershipCapital(db,{...actor,permissions:[]},12,command,create),(e:any)=>e.status===403);assert.equal(calls.length,0);
await assert.rejects(()=>submitPartnershipCapital(db,actor,12,{...command,approved:true},create),(e:any)=>e.status===422);assert.equal(calls.length,0);
memberApproved=false;await assert.rejects(()=>submitPartnershipCapital(db,actor,12,command,create),(e:any)=>e.status===409);memberApproved=true;
failAudit=true;await assert.rejects(()=>submitPartnershipCapital(db,actor,12,command,create),/capital audit failed/);failAudit=false;assert.equal(rights.length,0);assert.equal(requests,0);
const saved=await submitPartnershipCapital(db,actor,12,command,create);assert.equal(saved.financialTransactionId,91);assert.equal(rights[0].status,"pending");await submitPartnershipCapital(db,actor,12,command,create);assert.equal(requests,1);
await assert.rejects(()=>submitPartnershipCapital(db,actor,12,{...command,amount:"1.00"},create),(e:any)=>e.status===409);
assert.ok(calls.every(q=>!/master_cash_box|financial_ledger_entries|UPDATE vehicle_partnership_members|INSERT INTO (vehicle_expenses|sales_invoices|fleet_vehicles)/.test(q)));
console.log("PASS capital declaration source: existing dated member/vehicle, independent exact amount, central pending approval, canonical unpaid state, atomic retry/rollback and no cash/revenue/ownership mutation.");
