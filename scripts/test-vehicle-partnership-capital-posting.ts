import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {PgDialect} from "drizzle-orm/pg-core";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
import {executePartnershipFinancialTransaction,rejectPartnershipFinancialTransaction,reversePartnershipFinancialTransaction} from "../src/server/vehicle-partnership/posting";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
const actor={id:7,name:"مدير",role:"admin",permissions:[],isActive:true},dialect=new PgDialect();let state:any,failAudit=false,paid=false;const calls:string[]=[];
function reset(){const proof={memberId:11,amount:"10000000.00",entryDate:"2026-10-20",reason:"تسجيل مساهمة رأس المال"};state={right:{id:41,partnership_id:1,agreement_id:3,member_id:11,amount:proof.amount,category:"capital",direction:"credit",status:"pending",financial_transaction_id:91,event_key:"vp:capital:capital-entry-001",reason:proof.reason,source_snapshot:{entryDate:proof.entryDate,requestKey:"capital-entry-001",commandDigest:createHash("sha256").update(canonicalPartnershipJson(proof)).digest("hex")}},financial:{id:91,source_type:"vehicle_partnership_right",source_id:"41",source_event:"capital_entry",transaction_type:"vp_capital_record",transaction_date:proof.entryDate,direction:"revenue",amount:proof.amount,approval_status:"pending",balance_before:null,balance_after:null},accounts:[],journal:[],reversals:[],audits:0};}
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params;calls.push(q.sql);
 if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(q.sql.includes("FROM fleet_vehicles"))return {rows:[{id:12,branch_id:null,name:"نيسان",is_active:true}]};
 if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[{id:1,vehicle_id:12,version:2,ownership_type:"partnership",registration_owner:"شركة"}]};
 if(q.sql.includes("vp_capital_source"))return {rows:[{...state.right,vehicle_id:12}]};
 if(q.sql.includes("vp_capital_member"))return {rows:[{id:11,agreement_id:3,partnership_id:1,status:"approved",effective_from:"2026-10-01"}]};
 if(q.sql.includes("vp_financial_locked"))return {rows:[state.financial]};
 if(q.sql.includes("vp_chart_account"))return {rows:state.accounts.filter((a:any)=>a.code===p[0])};
 if(q.sql.includes("INSERT INTO financial_accounts")){state.accounts.push({id:state.accounts.length+1,code:p[0],account_type:p[2],is_active:true});return {rows:[{id:state.accounts.length}]};}
 if(q.sql.includes("INSERT INTO financial_ledger_entries")){state.journal.push({id:state.journal.length+1,transaction_id:p[0],account_id:p[1],entry_side:"debit",amount:p[2]},{id:state.journal.length+2,transaction_id:p[4],account_id:p[5],entry_side:"credit",amount:p[6]});return {rows:[{id:1},{id:2}]};}
 if(q.sql.includes("vp_activity_journal_proof"))return {rows:state.journal.filter((j:any)=>j.transaction_id===p[0]).map((j:any)=>({...j,code:state.accounts.find((a:any)=>a.id===j.account_id).code}))};
 if(q.sql.includes("vp_activity_closed_guard"))return {rows:[]};
 if(q.sql.includes("vp_financial_reversal_replay"))return {rows:state.reversals};
 if(q.sql.includes("vp_financial_reversal_key"))return {rows:[]};
 if(q.sql.includes("INSERT INTO financial_transactions")){const row={id:92,source_type:p[5],source_id:p[6],source_event:"reversal",transaction_type:p[4],direction:p[1],amount:p[2],reversed_transaction_id:p[8],approval_status:"executed"};state.reversals.push(row);return {rows:[{id:92}]};}
 if(q.sql.includes("vp_reversal_number"))return {rows:[{id:92}]};
 if(q.sql.includes("vp_financial_reversed")){state.financial.reversal_txn_id=p[0];state.financial.reversed_at="now";return {rows:[{id:91}]};}
 if(q.sql.includes("UPDATE financial_transactions")){state.financial.approval_status=q.sql.includes("approval_status='rejected'")?"rejected":"executed";return {rows:[{id:91}]};}
 if(q.sql.includes("UPDATE vehicle_partnership_rights")){state.right.status=q.sql.includes("status='cancelled'")?"cancelled":q.sql.includes("status='reversed'")?"reversed":"approved";return {rows:[{id:41}]};}
 if(q.sql.includes("vp_payment_right_scope"))return {rows:[{vehicle_id:12}]};
 if(q.sql.includes("vp_payment_right_lock"))return {rows:[state.right]};
 if(q.sql.includes("vp_payment_allocations"))return {rows:paid?[{allocation_id:300,right_id:41,allocation_partnership_id:1,purpose:"capital_transfer",allocated_amount:"10000.00",financial_transaction_id:200,financial_amount:"10000.00",financial_status:"executed",financial_direction:"revenue",financial_source_type:"vehicle_partnership_settlement",financial_source_id:"41",financial_event:"capital_transfer",transaction_type:"vp_capital_cash_received",reversed_amount:"0.00",invalid_reversal:false}]:[]};
 if(q.sql.includes("financial_audit_logs")){if(failAudit)throw Error("capital posting audit failed");state.audits++;return {rows:[{id:state.audits}]};}
 throw Error(`unexpected capital posting SQL ${q.sql}`);
}};
const initial={id:91,sourceType:"vehicle_partnership_right",sourceId:"41"};
const atomic=async(work:()=>Promise<any>)=>{const before=structuredClone(state);try{return await work();}catch(cause){state=before;throw cause;}};
const approve=(a=actor)=>atomic(()=>executePartnershipFinancialTransaction(tx,initial,a,"اعتماد المساهمة"));
reset();const io=calls.length;await assert.rejects(()=>approve({...actor,role:"employee",permissions:["accounting"]}),(e:any)=>e.status===403);assert.equal(calls.length,io);
failAudit=true;await assert.rejects(()=>approve(),/capital posting audit failed/);failAudit=false;assert.equal(state.right.status,"pending");assert.equal(state.journal.length,0);
await approve();assert.equal(state.right.status,"approved");assert.equal(state.journal.length,2);assert.equal(state.accounts.find((a:any)=>a.id===state.journal[0].account_id).code,"VP-CAPITAL-CLEAR");assert.equal(state.accounts.find((a:any)=>a.id===state.journal[1].account_id).code,"VP-CAPITAL");const audits=state.audits;await approve();assert.equal(state.audits,audits);assert.equal(state.journal.length,2);
const reverse=()=>atomic(()=>reversePartnershipFinancialTransaction(tx,initial,actor,"تصحيح المساهمة",{},id=>`FIN-${id}`));paid=true;await assert.rejects(reverse,(e:any)=>e.status===409);paid=false;await reverse();assert.equal(state.right.status,"reversed");assert.equal(state.journal.length,4);await reverse();assert.equal(state.journal.length,4);assert.equal(state.reversals.length,1);
reset();await rejectPartnershipFinancialTransaction(tx,initial,actor,"رفض المساهمة");assert.equal(state.right.status,"cancelled");assert.equal(state.financial.approval_status,"rejected");assert.equal(state.journal.length,0);
assert.ok(calls.every(q=>!/master_cash_box|UPDATE vehicle_partnership_members|INSERT INTO vehicle_expenses|INSERT INTO sales_invoices/.test(q)));
console.log("PASS real capital noncash approval/reject/reversal: one existing declaration, balanced equity journal, immutable source proof, paid reversal blocker and no cash/sales/percentage mutation.");
