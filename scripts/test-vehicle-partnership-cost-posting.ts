import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {executePartnershipFinancialTransaction,rejectPartnershipFinancialTransaction,reversePartnershipFinancialTransaction} from "../src/server/vehicle-partnership/posting";
import {partnershipCostDigest} from "../src/server/vehicle-partnership/costing";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
const actor={id:7,name:"مدير",role:"admin",isActive:true,permissions:[]};
const expense={id:21,vehicle_id:12,booking_id:8,service_order_id:null,driver_id:null,expense_type:"maintenance",amount:"100000.00",cost_date:"2026-10-20",status:"pending",description:"تصليح المركبة",attachments:[],financial_transaction_id:null};
const root={id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:"شركة",version:2};
let state:any,failAudit=false,closed=false,paymentMode="none";const dialect=new PgDialect(),calls:Array<{sql:string;params:any[]}>=[];
function reset(kind="partner_advance",costClass="operating"){
 const row={id:31,partnership_id:1,vehicle_expense_id:21,payer_member_id:11,funding_kind:kind,cost_class:costClass,reason:"دفع الشريك",status:"pending",financial_transaction_id:91};
 state={funding:{...row,source_digest:partnershipCostDigest(expense,row)},financial:{id:91,source_type:"vehicle_partnership_cost",source_id:"31",source_event:"partner_paid_cost",transaction_type:`vp_partner_${costClass}_${kind==="partner_advance"?"advance":"capital"}`,transaction_date:"2026-10-20",direction:"expense",amount:"100000.00",approval_status:"pending",balance_before:null,balance_after:null},rights:[],accounts:[],journal:[],reversals:[],audits:0};
}
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement);calls.push(q);const p=q.params;
 if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
 if(q.sql.includes("FROM fleet_vehicles"))return {rows:[{id:12,branch_id:null,is_active:true,name:"نيسان"}]};
 if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[root]};
 if(q.sql.includes("vp_cost_original"))return {rows:[expense]};
 if(q.sql.includes("vp_cost_source"))return {rows:[{...state.funding,vehicle_id:12}]};
 if(q.sql.includes("vp_cost_member"))return {rows:[{id:11,agreement_id:3,partnership_id:1,status:"approved",effective_from:"2026-10-01"}]};
 if(q.sql.includes("vp_financial_locked"))return {rows:[state.financial]};
 if(q.sql.includes("vp_chart_account"))return {rows:state.accounts.filter((a:any)=>a.code===p[0])};
 if(q.sql.includes("INSERT INTO financial_accounts")){state.accounts.push({id:state.accounts.length+1,code:p[0],account_type:p[2],is_active:true});return {rows:[{id:state.accounts.length}]};}
 if(q.sql.includes("INSERT INTO financial_ledger_entries")){state.journal.push({id:state.journal.length+1,transaction_id:p[0],account_id:p[1],entry_side:"debit",amount:p[2]},{id:state.journal.length+2,transaction_id:p[4],account_id:p[5],entry_side:"credit",amount:p[6]});return {rows:[{id:1},{id:2}]};}
 if(q.sql.includes("vp_activity_journal_proof"))return {rows:state.journal.filter((j:any)=>j.transaction_id===p[0]).map((j:any)=>({...j,code:state.accounts.find((a:any)=>a.id===j.account_id).code}))};
 if(q.sql.includes("vp_cost_closed_guard"))return {rows:closed?[{id:1}]:[]};
 if(q.sql.includes("vp_financial_reversal_replay"))return {rows:state.reversals};
 if(q.sql.includes("vp_financial_reversal_key"))return {rows:[]};
 if(q.sql.includes("INSERT INTO financial_transactions")){const row={id:92,source_type:p[5],source_id:p[6],source_event:"reversal",transaction_type:p[4],direction:p[1],amount:p[2],reversed_transaction_id:p[8],approval_status:"executed"};state.reversals.push(row);return {rows:[{id:92}]};}
 if(q.sql.includes("vp_reversal_number"))return {rows:[{id:92}]};
 if(q.sql.includes("vp_financial_reversed")){state.financial.reversal_txn_id=p[0];state.financial.reversed_at="now";return {rows:[{id:91}]};}
 if(q.sql.includes("UPDATE financial_transactions")){state.financial.approval_status=q.sql.includes("approval_status='rejected'")?"rejected":"executed";return {rows:[{id:91}]};}
 if(q.sql.includes("UPDATE vehicle_partnership_cost_funding")){state.funding.status=q.sql.includes("status='rejected'")?"rejected":q.sql.includes("status='reversed'")?"reversed":"approved";return {rows:[{id:31}]};}
 if(q.sql.includes("INSERT INTO vehicle_partnership_rights")){state.rights.push({id:41,partnership_id:p[0],agreement_id:p[1],member_id:p[2],cost_funding_id:p[3],category:p[4],amount:p[5],financial_transaction_id:p[6],status:"approved",direction:"credit"});return {rows:[{id:41}]};}
 if(q.sql.includes("vp_cost_right_proof"))return {rows:state.rights};
 if(q.sql.includes("vp_payment_right_scope"))return {rows:[{vehicle_id:12}]};
 if(q.sql.includes("vp_payment_right_lock"))return {rows:state.rights};
 if(q.sql.includes("UPDATE vehicle_partnership_rights")){state.rights[0].status="reversed";return {rows:[{id:41}]};}
 if(q.sql.includes("vp_payment_allocations"))return {rows:paymentMode==="none"?[]:[{allocation_id:300,right_id:41,allocation_partnership_id:1,purpose:"advance_reimbursement",allocated_amount:"10000.00",financial_transaction_id:200,financial_amount:"10000.00",financial_status:paymentMode==="paid"?"executed":"pending",financial_direction:"expense",financial_source_type:"vehicle_partnership_settlement",financial_source_id:"41",financial_event:"advance_reimbursement",transaction_type:"vp_partner_advance_repayment",reversed_amount:"0.00",invalid_reversal:false}]};
 if(q.sql.includes("financial_audit_logs")){if(failAudit)throw Error("cost approval audit failed");state.audits++;return {rows:[{id:state.audits}]};}
 throw Error(`unexpected cost posting SQL ${q.sql}`);
}};
const approve=async(a=actor)=>{const before=structuredClone(state);try{return await executePartnershipFinancialTransaction(tx,{id:91,sourceType:"vehicle_partnership_cost",sourceId:"31"},a,"اعتماد المصروف");}catch(cause){state=before;throw cause;}};
reset();const io=calls.length;await assert.rejects(()=>approve({...actor,role:"employee",permissions:["accounting"]}),(e:any)=>e.status===403);assert.equal(calls.length,io);
state.financial.amount="1.00";await assert.rejects(()=>approve(),(e:any)=>e.status===409);state.financial.amount="100000.00";assert.equal(state.journal.length,0);
failAudit=true;await assert.rejects(()=>approve(),/cost approval audit failed/);failAudit=false;assert.equal(state.financial.approval_status,"pending");assert.equal(state.funding.status,"pending");assert.equal(state.rights.length,0);assert.equal(state.journal.length,0);
await approve();assert.equal(state.funding.status,"approved");assert.equal(state.rights[0].category,"advance");assert.equal(state.rights[0].amount,"100000.00");assert.equal(state.accounts.find((a:any)=>a.id===state.journal[0].account_id).code,"5000");assert.equal(state.accounts.find((a:any)=>a.id===state.journal[1].account_id).code,"VP-ADVANCE");
const audits=state.audits;await approve();assert.equal(state.audits,audits);assert.equal(state.journal.length,2);assert.equal(state.rights.length,1);
reset("partner_capital","capital");await approve();assert.equal(state.rights[0].category,"capital");assert.equal(state.accounts.find((a:any)=>a.id===state.journal[0].account_id).code,"VP-INVESTMENT");assert.equal(state.accounts.find((a:any)=>a.id===state.journal[1].account_id).code,"VP-CAPITAL");
reset();const initial={id:91,sourceType:"vehicle_partnership_cost",sourceId:"31"};
await rejectPartnershipFinancialTransaction(tx,initial,actor,"سبب رفض المصروف");assert.equal(state.funding.status,"rejected");assert.equal(state.financial.approval_status,"rejected");const rejectedAudits=state.audits;await rejectPartnershipFinancialTransaction(tx,initial,actor,"سبب رفض المصروف");assert.equal(state.audits,rejectedAudits);assert.equal(state.journal.length,0);
reset();await approve();const reverse=async()=>{const before=structuredClone(state);try{return await reversePartnershipFinancialTransaction(tx,initial,actor,"تصحيح التمويل",{},id=>`FIN-${id}`);}catch(cause){state=before;throw cause;}};
closed=true;await assert.rejects(reverse,(e:any)=>e.status===409);closed=false;
paymentMode="paid";await assert.rejects(reverse,(e:any)=>e.status===409);paymentMode="reserved";await assert.rejects(reverse,(e:any)=>e.status===409);paymentMode="none";
failAudit=true;await assert.rejects(reverse,/cost approval audit failed/);failAudit=false;assert.equal(state.reversals.length,0);assert.equal(state.rights[0].status,"approved");assert.equal(state.funding.status,"approved");
await reverse();assert.equal(state.funding.status,"reversed");assert.equal(state.rights[0].status,"reversed");assert.equal(state.reversals.length,1);assert.equal(state.journal.length,4);const reverseAudits=state.audits;await reverse();assert.equal(state.audits,reverseAudits);assert.equal(state.journal.length,4);
assert.ok(calls.every(q=>!/master_cash_box|INSERT INTO vehicle_expenses|UPDATE vehicle_expenses|UPDATE vehicle_partnership_members|INSERT INTO employee_finance/.test(q.sql)));
console.log("PASS actual partner cost approval: one original expense, one balanced expense-or-capital journal, one advance-or-capital right, admin-only atomic rollback/replay, no MASTER/ownership/payroll mutation.");
