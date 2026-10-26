import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {submitPartnershipActivity,preparePartnershipFinancialRequest} from "../src/server/vehicle-partnership/accounting";
import {executePartnershipFinancialTransaction,rejectPartnershipFinancialTransaction,reversePartnershipFinancialTransaction} from "../src/server/vehicle-partnership/posting";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";

const admin={id:7,name:"مدير",role:"admin",permissions:[] as string[],isActive:true},accountant={...admin,role:"employee",permissions:["accounting"]};
const dialect=new PgDialect();type State={activities:any[];financial:any;accounts:any[];journal:any[];rights:any[];reversals:any[];audits:number};
let state:State={activities:[],financial:null,accounts:[],journal:[],rights:[],reversals:[],audits:0},failAudit=false,closingBlocked=false,paymentMode="none";
const root={id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:"شركة",version:2};
const trip={source:"kosha",id:8,vehicle_id:12,driver_id:9,reference:"K-8",event_date:"2026-10-20",customer_name:"أحمد",mode:"ajn",status:"confirmed",customer_charge:"50000.00",contract_total:"100000.00",in_total:true,billing_source:"kosha_booking",billing_id:8};
const calls:Array<{sql:string;params:any[]}>=[];
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params;calls.push(q);
 if(q.sql.includes("master_cash_box"))assert.fail("noncash approval must never even lock or read MASTER");
 if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(q.sql.includes("FROM fleet_vehicles"))return {rows:[{id:12,branch_id:null,is_active:true,name:"نيسان",purchase_price:"20000000.00"}]};
 if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[root]};
 if(q.sql.includes("vp_transport_source_lock"))return {rows:[{id:8}]};
 if(q.sql.includes("vp_original_trips"))return {rows:[trip]};
 if(q.sql.includes("vp_financial_activity_source"))return {rows:state.activities.filter(a=>a.id===p[0]).map(a=>({...a,vehicle_id:12}))};
 if(q.sql.includes("vp_agreement_history"))return {rows:[{id:3,revision:1,effective_from:"2026-10-01",status:"approved",policy:{}}]};
 if(q.sql.includes("vp_agreement_members"))return {rows:[{id:11,party_kind:"customer",customer_id:1,ownership_basis_points:5000,profit_basis_points:5000,expense_basis_points:5000,capital_contribution:"10000000.00"},{id:12,party_kind:"supplier",supplier_id:2,ownership_basis_points:5000,profit_basis_points:5000,expense_basis_points:5000,capital_contribution:"10000000.00"}]};
 if(q.sql.includes("vp_transport_replay"))return {rows:state.activities.filter(a=>a.idempotency_key===p[0])};
 if(q.sql.includes("vp_transport_active"))return {rows:state.activities.filter(a=>["pending","approved"].includes(a.status))};
 if(q.sql.includes("vp_transport_revision"))return {rows:[{revision:1}]};
 if(q.sql.includes("INSERT INTO vehicle_partnership_activity")){const row={id:1,partnership_id:p[0],agreement_id:p[1],kosha_booking_id:p[2],service_order_id:p[3],delivery_order_id:p[4],amount:p[5],recognition_date:p[6],revision:p[7],source_digest:p[8],source_snapshot:JSON.parse(p[9]),idempotency_key:p[10],status:"pending",income_basis:p[11],financial_transaction_id:null,reason:p[13]};state.activities.push(row);return {rows:[row]};}
 if(q.sql.includes("vp_financial_locked"))return {rows:state.financial?[state.financial]:[]};
 if(q.sql.includes("vp_chart_account"))return {rows:state.accounts.filter(a=>a.code===p[0])};
 if(q.sql.includes("INSERT INTO financial_accounts")){const row={id:20+state.accounts.length,code:p[0],name_ar:p[1],account_type:p[2],is_active:true};state.accounts.push(row);return {rows:[row]};}
 if(q.sql.includes("INSERT INTO financial_ledger_entries")){const start=state.journal.length;const rows=[{id:start+1,transaction_id:p[0],account_id:p[1],entry_side:"debit",amount:p[2]},{id:start+2,transaction_id:p[4],account_id:p[5],entry_side:"credit",amount:p[6]}];state.journal.push(...rows);return {rows:rows.map(r=>({id:r.id}))};}
 if(q.sql.includes("vp_activity_journal_proof"))return {rows:state.journal.filter(j=>j.transaction_id===p[0]).map(j=>({...j,code:state.accounts.find(a=>a.id===j.account_id).code}))};
 if(q.sql.includes("vp_activity_closed_guard"))return {rows:closingBlocked?[{id:1}]:[]};
 if(q.sql.includes("vp_financial_reversal_replay"))return {rows:state.reversals};
 if(q.sql.includes("vp_financial_reversal_key"))return {rows:state.reversals.filter(r=>r.idempotency_key===p[0])};
 if(q.sql.includes("INSERT INTO financial_transactions")){const row={id:92,transaction_no:p[0],direction:p[1],amount:p[2],department:p[3],transaction_type:p[4],source_type:p[5],source_id:p[6],source_event:"reversal",idempotency_key:p[7],reversed_transaction_id:p[8],approval_status:"executed"};state.reversals.push(row);return {rows:[row]};}
 if(q.sql.includes("vp_reversal_number")){state.reversals[0].transaction_no=p[0];return {rows:[{id:92}]};}
 if(q.sql.includes("vp_financial_reversed")){state.financial.reversal_txn_id=p[0];state.financial.reversed_at="now";return {rows:[{id:91}]};}
 if(q.sql.includes("UPDATE financial_transactions")){state.financial.approval_status=q.sql.includes("approval_status='rejected'")?"rejected":"executed";return {rows:[{id:91}]};}
 if(q.sql.includes("UPDATE vehicle_partnership_activity")){if(q.sql.includes("vp_activity_rejected"))state.activities[0].status=p[0];else if(q.sql.includes("status='reversed'"))state.activities[0].status="reversed";else if(q.sql.includes("status='approved'"))state.activities[0].status="approved";else state.activities[0].financial_transaction_id=p[0];return {rows:[{id:1}]};}
 if(q.sql.includes("INSERT INTO vehicle_partnership_rights")){const row={id:31,partnership_id:p[0],agreement_id:p[1],activity_id:p[2],amount:p[3],category:"internal_entitlement",direction:"credit",status:"approved",financial_transaction_id:91};state.rights.push(row);return {rows:[{id:31}]};}
 if(q.sql.includes("vp_activity_right_proof"))return {rows:state.rights};
 if(q.sql.includes("vp_payment_right_scope"))return {rows:state.rights.length?[{vehicle_id:12}]:[]};
 if(q.sql.includes("vp_payment_right_lock"))return {rows:state.rights};
 if(q.sql.includes("UPDATE vehicle_partnership_rights")){state.rights[0].status="reversed";return {rows:[{id:31}]};}
 if(q.sql.includes("vp_payment_allocations"))return {rows:paymentMode==="none"?[]:[{allocation_id:300,right_id:31,allocation_partnership_id:1,purpose:"internal_entitlement_settlement",allocated_amount:"10000.00",financial_transaction_id:200,financial_amount:"10000.00",financial_status:paymentMode==="paid"?"executed":"pending",financial_direction:"expense",financial_source_type:"vehicle_partnership_settlement",financial_source_id:"31",financial_event:"internal_entitlement_settlement",transaction_type:"vp_internal_settlement",reversed_amount:"0.00",invalid_reversal:false}]};
 if(q.sql.includes("financial_audit_logs")){if(failAudit)throw Error("approval audit failed");state.audits++;return {rows:[{id:state.audits}]};}
 throw Error(`unexpected actual source posting SQL ${q.sql}`);
}};
const db={...tx,transaction:async<T>(work:(executor:typeof tx)=>Promise<T>)=>{const before=structuredClone(state);try{return await work(tx);}catch(cause){state=before;throw cause;}}};
const create=async(executor:any,reference:any,actor:any)=>{const p=await preparePartnershipFinancialRequest(executor,reference,actor);state.financial={id:91,source_type:p.sourceType,source_id:String(p.sourceId),source_event:p.sourceEvent,transaction_type:p.transactionType,transaction_date:p.transactionDate,department:p.department,direction:p.direction,amount:p.amount,approval_status:"pending",balance_before:null,balance_after:null};return {id:91,approvalStatus:"pending"};};
const command={source:"kosha",sourceId:8,incomeBasis:"internal",amount:"30000.00",recognitionDate:"2026-10-20",expectedVersion:2,idempotencyKey:"transport-posting-001",reason:"الأجرة المتفق عليها",driverNoCharge:false};
await submitPartnershipActivity(db,accountant,12,command,create);
const initial={id:91,sourceType:"vehicle_partnership_activity",sourceId:"1"};
const approve=(actor=admin)=>db.transaction(executor=>executePartnershipFinancialTransaction(executor,initial,actor,"موافقة الإدارة"));
const before=calls.length;await assert.rejects(()=>approve(accountant),(e:any)=>e.status===403);assert.equal(calls.length,before);
state.financial.amount="1.00";await assert.rejects(()=>approve(),(e:any)=>e.status===409);state.financial.amount="30000.00";assert.equal(state.journal.length,0);assert.equal(state.rights.length,0);
trip.customer_charge="55000.00";await assert.rejects(()=>approve(),(e:any)=>e.status===409);trip.customer_charge="50000.00";
failAudit=true;await assert.rejects(()=>approve(),/approval audit failed/);failAudit=false;assert.equal(state.financial.approval_status,"pending");assert.equal(state.activities[0].status,"pending");assert.equal(state.journal.length,0);assert.equal(state.rights.length,0,"financial/source/right/journal/audit is one rollback boundary");
const posted=await approve();assert.equal(posted.id,91);assert.equal(state.financial.approval_status,"executed");assert.equal(state.activities[0].status,"approved");assert.equal(state.rights.length,1);assert.equal(state.rights[0].amount,"30000.00");assert.equal(state.journal.length,2);assert.equal(state.journal[0].amount,state.journal[1].amount);
assert.equal(state.accounts.find(a=>a.id===state.journal[0].account_id).code,"VP-INTERNAL");assert.equal(state.accounts.find(a=>a.id===state.journal[1].account_id).code,"VP-PAYABLE");
const auditCount=state.audits;await approve();assert.equal(state.rights.length,1);assert.equal(state.journal.length,2);assert.equal(state.audits,auditCount,"approved replay does not double-post obligation or audit");
const io=calls.length;await assert.rejects(()=>executePartnershipFinancialTransaction(tx,{...initial,sourceType:"vehicle_partnership_unknown"},admin),(e:any)=>e.status===409);assert.equal(calls.length,io,"unknown feature source never falls through to cash");
state={activities:[],financial:null,accounts:[],journal:[],rights:[],reversals:[],audits:0};const {amount:ignored,...external}=command;
await submitPartnershipActivity(db,accountant,12,{...external,incomeBasis:"external",idempotencyKey:"transport-external-001"},create);await approve();assert.equal(state.rights.length,0,"external attribution does not create another customer receivable or internal payable");assert.ok(state.accounts.every(a=>a.account_type==="memo"),"external source attribution is separate from company sales revenue");
assert.ok(calls.every(q=>!/UPDATE (kosha_bookings|service_orders|master_cash_box)|INSERT INTO (sales_invoices|vehicle_expenses)/.test(q.sql)));
state={activities:[],financial:null,accounts:[],journal:[],rights:[],reversals:[],audits:0};await submitPartnershipActivity(db,accountant,12,command,create);
const reject=()=>db.transaction(executor=>rejectPartnershipFinancialTransaction(executor,initial,admin,"تصحيح أجرة النقل","reject"));
await reject();assert.equal(state.financial.approval_status,"rejected");assert.equal(state.activities[0].status,"rejected");const rejectedAudits=state.audits;await reject();assert.equal(state.audits,rejectedAudits);assert.equal(state.journal.length,0);
state={activities:[],financial:null,accounts:[],journal:[],rights:[],reversals:[],audits:0};await submitPartnershipActivity(db,accountant,12,command,create);await approve();
const reverse=()=>db.transaction(executor=>reversePartnershipFinancialTransaction(executor,initial,admin,"إلغاء الاستحقاق غير المستخدم",{},id=>`FIN-${id}`));
closingBlocked=true;await assert.rejects(reverse,(e:any)=>e.status===409);closingBlocked=false;
paymentMode="paid";await assert.rejects(reverse,(e:any)=>e.status===409);paymentMode="reserved";await assert.rejects(reverse,(e:any)=>e.status===409);paymentMode="none";assert.equal(state.reversals.length,0);
failAudit=true;await assert.rejects(reverse,/approval audit failed/);failAudit=false;assert.equal(state.financial.reversal_txn_id,undefined);assert.equal(state.reversals.length,0);assert.equal(state.activities[0].status,"approved");assert.equal(state.rights[0].status,"approved");
const reversed=await reverse();assert.equal(reversed.reverseId,92);assert.equal(state.activities[0].status,"reversed");assert.equal(state.rights[0].status,"reversed");assert.equal(state.journal.length,4);const reverseAudits=state.audits;assert.equal((await reverse()).reverseId,92);assert.equal(state.reversals.length,1);assert.equal(state.journal.length,4);assert.equal(state.audits,reverseAudits);
console.log("PASS real partnership noncash approval/rejection/reversal: admin/source proof, one balanced obligation, memo external revenue, rollback/retry, paid/pending/closed-period reversal blockers and zero MASTER access.");
console.log("LIMITATION: controlled transaction/SQL execution, not real PostgreSQL concurrency proof.");
