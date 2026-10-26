import {PgDialect} from "drizzle-orm/pg-core";
import {PARTNERSHIP_TABLE_NAMES} from "../../src/server/vehicle-partnership/repository";
export const driverAdmin={id:7,name:"مدير",role:"admin",permissions:[] as string[],isActive:true};
export function driverFixture(){
 const dialect=new PgDialect(),calls:Array<{sql:string;params:any[]}>=[];
 const expense={id:21,vehicle_id:12,booking_id:8,service_order_id:null,driver_id:9,expense_type:"driver_wage",amount:"25000.00",cost_date:"2026-10-20",status:"pending",description:"أجرة السائق لهذه الرحلة",attachments:[],financial_transaction_id:null,financial_status:null,financial_source_type:null,financial_source_id:null};
 const root={id:1,vehicle_id:12,ownership_type:"partnership",registration_owner:"شركة",version:2};
 const flags={failAudit:false,driverExists:true,agreementApproved:true,closed:false};
 let state={entries:[] as any[],funding:[] as any[],financial:[] as any[],accounts:[] as any[],journal:[] as any[],reversals:[] as any[],settlements:[] as any[],audits:0};
 const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params;calls.push(q);
  if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
  if(q.sql.includes("FROM fleet_vehicles"))return {rows:[{id:12,branch_id:null,is_active:true,name:"نيسان"}]};
  if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[root]};
  if(q.sql.includes("vp_cost_original"))return {rows:[expense]};
  if(q.sql.includes("vp_driver_original_staff"))return {rows:flags.driverExists?[{id:9}]:[]};
  if(q.sql.includes("vp_driver_agreement"))return {rows:flags.agreementApproved?[{id:3}]:[]};
  if(q.sql.includes("vp_driver_replay"))return {rows:state.funding.filter(f=>f.idempotency_key===p[0])};
  if(q.sql.includes("vp_driver_existing_cost"))return {rows:state.funding.filter(f=>["pending","approved"].includes(f.status))};
  if(q.sql.includes("vp_driver_entry_history"))return {rows:state.settlements};
  if(q.sql.includes("vp_driver_existing_entry"))return {rows:state.entries};
  if(q.sql.includes("vp_driver_entry_source"))return {rows:state.entries.filter(e=>e.id===p[0])};
  if(q.sql.includes("vp_cost_source"))return {rows:state.funding.filter(f=>f.id===p[0]).map(f=>({...f,vehicle_id:12}))};
  if(q.sql.includes("INSERT INTO employee_finance_entries")){const row={id:51,employee_id:p[0],entry_no:p[1],entry_date:p[2],amount:p[3],remaining_amount:p[4],settled_amount:"0.00",description:p[5],source_type:"vehicle_expense",source_id:p[6],entry_type:"trip_driver_fee",direction:"payable",status:"pending"};state.entries.push(row);return {rows:[row]};}
  if(q.sql.includes("INSERT INTO vehicle_partnership_cost_funding")){const row={id:31+state.funding.length,partnership_id:p[0],vehicle_expense_id:p[1],employee_finance_entry_id:p[2],source_digest:p[3],idempotency_key:p[4],created_by:p[5],reason:p[6],source_snapshot:JSON.parse(String(p[7])),status:"pending",funding_kind:"other",cost_class:"operating",payer_member_id:null,financial_transaction_id:null};state.funding.push(row);return {rows:[row]};}
  if(q.sql.includes("vp_financial_locked"))return {rows:[state.financial[0]]};
  if(q.sql.includes("vp_chart_account"))return {rows:state.accounts.filter(a=>a.code===p[0])};
  if(q.sql.includes("INSERT INTO financial_accounts")){state.accounts.push({id:state.accounts.length+1,code:p[0],account_type:p[2],is_active:true});return {rows:[{id:state.accounts.length}]};}
  if(q.sql.includes("INSERT INTO financial_ledger_entries")){state.journal.push({id:state.journal.length+1,transaction_id:p[0],account_id:p[1],entry_side:"debit",amount:p[2]},{id:state.journal.length+2,transaction_id:p[4],account_id:p[5],entry_side:"credit",amount:p[6]});return {rows:[{id:1},{id:2}]};}
  if(q.sql.includes("vp_activity_journal_proof"))return {rows:state.journal.filter(j=>j.transaction_id===p[0]).map(j=>({...j,code:state.accounts.find(a=>a.id===j.account_id).code}))};
  if(q.sql.includes("vp_activity_closed_guard"))return {rows:flags.closed?[{id:1}]:[]};
  if(q.sql.includes("vp_financial_reversal_replay"))return {rows:state.reversals};
  if(q.sql.includes("vp_financial_reversal_key"))return {rows:[]};
  if(q.sql.includes("INSERT INTO financial_transactions")){const row={id:92,source_type:p[5],source_id:p[6],source_event:"reversal",transaction_type:p[4],direction:p[1],amount:p[2],reversed_transaction_id:p[8],approval_status:"executed"};state.reversals.push(row);return {rows:[{id:92}]};}
  if(q.sql.includes("vp_reversal_number"))return {rows:[{id:92}]};
  if(q.sql.includes("vp_financial_reversed")){state.financial[0].reversal_txn_id=p[0];state.financial[0].reversed_at="now";return {rows:[{id:91}]};}
  if(q.sql.includes("UPDATE financial_transactions")){state.financial[0].approval_status=q.sql.includes("approval_status='rejected'")?"rejected":"executed";return {rows:[{id:91}]};}
  if(q.sql.includes("UPDATE vehicle_partnership_cost_funding")){const c=state.funding.find(c=>c.id===(q.sql.includes("SET status=")?p[0]:p[1]));if(q.sql.includes("SET status='reversed'"))c.status="reversed";else if(q.sql.includes("SET status='rejected'"))c.status="rejected";else if(q.sql.includes("SET status='approved'"))c.status="approved";else c.financial_transaction_id=p[0];return {rows:[{id:c.id}]};}
  if(q.sql.includes("UPDATE employee_finance_entries")){const e=state.entries[0];if(q.sql.includes("vp_driver_entry_resubmit")){Object.assign(e,{employee_id:p[0],entry_date:p[1],amount:p[2],remaining_amount:p[3],settled_amount:"0.00",description:p[4],status:"pending"});return {rows:[e]};}if(q.sql.includes("SET settled_amount")){e.settled_amount=p[0];e.remaining_amount=p[1];e.status=p[2];}else e.status=q.sql.includes("status='approved'")?"approved":q.sql.includes("status='rejected'")?"rejected":"cancelled";return {rows:[{id:51}]};}
  if(q.sql.includes("vp_driver_state_scope"))return {rows:[{vehicle_id:12,expense_id:21}]};
  if(q.sql.includes("vp_driver_state_expense_lock"))return {rows:[{id:21}]};
  if(q.sql.includes("vp_driver_state_entry")){const e=state.entries[0],c=state.funding.filter(c=>["pending","approved"].includes(c.status)).at(-1)??state.funding.at(-1),f=state.financial.find(f=>f.id===c.financial_transaction_id);return {rows:[{...e,cost_funding_id:c.id,partnership_id:1,funding_status:c.status,funding_kind:c.funding_kind,vehicle_expense_id:21,source_amount:expense.amount,source_driver_id:expense.driver_id,source_expense_type:expense.expense_type,accrual_id:f.id,accrual_status:f.approval_status,accrual_source_type:f.source_type,accrual_source_id:f.source_id,accrual_type:f.transaction_type,accrual_event:f.source_event,accrual_amount:f.amount,accrual_direction:f.direction,accrual_reversed:state.reversals.length?f.amount:"0.00",invalid_accrual_reversal:false}]};}
  if(q.sql.includes("vp_driver_state_settlements"))return {rows:state.settlements};
  if(q.sql.includes("financial_audit_logs")){if(flags.failAudit)throw Error("driver audit failed");state.audits++;return {rows:[{id:state.audits}]};}
  throw Error(`unexpected driver source SQL ${q.sql}`);
 }};
 const db={...tx,transaction:async<T>(work:(executor:typeof tx)=>Promise<T>)=>{const before=structuredClone(state);try{return await work(tx);}catch(cause){state=before;throw cause;}}};
 return {db,tx,root,expense,flags,calls,get state(){return state;}};
}
