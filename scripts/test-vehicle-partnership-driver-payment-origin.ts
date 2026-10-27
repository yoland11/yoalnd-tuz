import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
import {lockDriverPaymentOrigin} from "../src/server/vehicle-partnership/driver-payment-origin";

type Row=Record<string,any>;
const actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true,allowedBranchIds:[2]};
const digest="b426a8b4b8be0284b5b8c41867d0ba77df4ed8bc1f1fd4a71665fc5f63657d65";

/** Only the external SQL executor is replaced. Authorization, cost locking,
 * immutable snapshot/digest validation and journal proof are production code. */
function fixture(){
 const dialect=new PgDialect(),calls:Array<{sql:string;params:any[]}>=[];
 const root={id:1,vehicle_id:12,ownership_type:"company",registration_owner:"شركة",version:3};
 const vehicle={id:12,branch_id:2,is_active:false,name:"مركبة قديمة"};
 const cost:Row={id:21,vehicle_id:12,driver_id:9,expense_type:"driver_wage",amount:"25000.00",cost_date:"2026-10-20",booking_id:8,service_order_id:null,description:"أجرة الرحلة",attachments:[],financial_transaction_id:null,financial_status:null,financial_source_type:null,financial_source_id:null};
 const funding:Row={id:31,partnership_id:1,vehicle_expense_id:21,employee_finance_entry_id:51,payer_member_id:null,funding_kind:"other",cost_class:"operating",status:"approved",reason:"أجرة مستحقة",financial_transaction_id:91,source_digest:digest,source_snapshot:{expenseId:21,vehicleId:12,driverId:9,expenseType:"driver_wage",amount:"25000.00",date:"2026-10-20",bookingId:8,serviceOrderId:null,description:"أجرة الرحلة",attachments:[],originalFinancialId:null,employeeFinanceEntryId:51,reason:"أجرة مستحقة"}};
 const entry:Row={id:51,employee_id:9,entry_type:"trip_driver_fee",direction:"payable",source_type:"vehicle_expense",source_id:"21",status:"approved",entry_date:"2026-10-20",amount:"25000.00",settled_amount:"corrupt cache",remaining_amount:"corrupt cache"};
 const financial:Row={id:91,source_type:"vehicle_partnership_cost",source_id:"31",source_event:"driver_accrual",transaction_type:"vp_driver_accrual",direction:"expense",transaction_date:"2026-10-20",amount:"25000.00",approval_status:"executed",balance_before:null,balance_after:null,reversed_transaction_id:null,reversal_txn_id:null,reversed_at:null,reversed_amount:"0.00"};
 let scopes:Row[]=[{id:31,partnership_id:1,vehicle_expense_id:21,employee_finance_entry_id:51,vehicle_id:12,status:"approved"}];
 let journal:Row[]=[{id:101,account_id:1,entry_side:"debit",amount:"25000.00",code:"5000"},{id:102,account_id:2,entry_side:"credit",amount:"25000.00",code:"VP-DRIVER"}];
 let entryRows:Row[]=[entry],financialRows:Row[]=[financial],failAt="";
 const sqlFailure=new Error("origin SQL failure");
 const tx={execute:async(statement:any)=>{
  const q=dialect.sqlToQuery(statement);calls.push(q);
  if(failAt&&q.sql.includes(failAt))throw sqlFailure;
  assert.match(q.sql,/^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i,"origin proof must issue SELECT statements only");
  assert.doesNotMatch(q.sql,/employee_finance_settlements|master_cash_box|\bFROM staff\b/i,"origin proof must not read settlements, cash or current staff activity");
  if(q.sql.includes("vp_driver_payment_origin_scope")){
   assert.match(q.sql,/c\.employee_finance_entry_id\s*=\s*\$1/);
   assert.match(q.sql,/c\.status\s*=\s*'approved'/);
   assert.match(q.sql,/LIMIT 2\b/);
   assert.doesNotMatch(q.sql,/FOR UPDATE/i,"scope discovery must not lock before the partnership root");
   return {rows:scopes.filter(row=>row.employee_finance_entry_id===q.params[0]&&row.status==="approved").slice(0,2)};
  }
  if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
  if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[root]};
  if(q.sql.includes("FROM fleet_vehicles"))return {rows:[vehicle]};
  if(q.sql.includes("vp_cost_original"))return {rows:[cost]};
  if(q.sql.includes("vp_cost_source"))return {rows:[{...funding,vehicle_id:12}]};
  if(q.sql.includes("vp_driver_payment_origin_entry")){
   assert.match(q.sql,/WHERE id\s*=\s*\$1[\s\S]*FOR UPDATE/);
   assert.deepEqual(q.params,[51]);return {rows:entryRows};
  }
  if(q.sql.includes("vp_driver_payment_origin_accrual")){
   assert.match(q.sql,/sum\(r\.amount\)/i);assert.match(q.sql,/r\.reversed_transaction_id\s*=\s*f\.id/);assert.match(q.sql,/r\.approval_status\s*=\s*'executed'/);
   assert.match(q.sql,/FOR UPDATE OF f/);assert.deepEqual(q.params,[91]);return {rows:financialRows};
  }
  if(q.sql.includes("vp_activity_journal_proof")){assert.deepEqual(q.params,[91]);return {rows:journal};}
  throw new Error(`Unexpected origin SQL: ${q.sql}`);
 }};
 return {tx,calls,root,vehicle,cost,funding,entry,financial,sqlFailure,get scopes(){return scopes;},set scopes(value){scopes=value;},get journal(){return journal;},set journal(value){journal=value;},get entryRows(){return entryRows;},set entryRows(value){entryRows=value;},get financialRows(){return financialRows;},set financialRows(value){financialRows=value;},set failAt(value:string){failAt=value;}};
}
const run=(f:ReturnType<typeof fixture>,a=actor,vehicleId:number|undefined=12)=>lockDriverPaymentOrigin(f.tx,a,51,vehicleId);
const conflict=(e:any)=>e.status===409&&e.code==="CONFLICT";
async function rejectsMutation(mutate:(f:ReturnType<typeof fixture>)=>void){const f=fixture();mutate(f);await assert.rejects(()=>run(f),conflict);}

// A removed permission/scope guard would disclose origin data before rejecting.
for(const unauthorized of [{...actor,permissions:[]},{...actor,isActive:false}]){const f=fixture();await assert.rejects(()=>run(f,unauthorized),(e:any)=>e.status===403);assert.equal(f.calls.length,0);}
for(const [entryId,vehicleId] of [[0,12],[51,0],[51,NaN]]){const f=fixture();await assert.rejects(()=>lockDriverPaymentOrigin(f.tx,actor,entryId,vehicleId),(e:any)=>e.status===422);assert.equal(f.calls.length,0);}
{const f=fixture();await assert.rejects(()=>run(f,actor,99),conflict);assert.equal(f.calls.length,1,"wrong expected vehicle must fail before any source or employee locks");}
{const f=fixture();f.vehicle.branch_id=3;await assert.rejects(()=>run(f),(e:any)=>e.status===403);assert.ok(f.calls.every(q=>!/vp_cost_original|vp_driver_payment_origin_entry/.test(q.sql)));}
{const f=fixture();f.scopes=[];await assert.rejects(()=>run(f),(e:any)=>e.status===404);assert.equal(f.calls.length,1);}
{const f=fixture();f.scopes.push({...f.scopes[0],id:32});await assert.rejects(()=>run(f),conflict);assert.equal(f.calls.length,1,"duplicate approved source must fail before cost/employee locks");}
{const f=fixture();f.scopes[0].status="pending";await assert.rejects(()=>run(f),(e:any)=>e.status===404);}

// Old inactive vehicles and drivers remain owed; terminal ownership and cached
// paid/remaining amounts never replace the immutable approval and journal.
for(const status of ["approved","partially_settled","settled"]){
 const f=fixture();f.entry.status=status;
 const before=structuredClone({entry:f.entry,cost:f.cost,funding:f.funding,financial:f.financial});
 const result=await run(f);
 assert.deepEqual(result.proof,{entryId:51,employeeId:9,expenseId:21,costFundingId:31,accrualFinancialId:91,amount:"25000.00",entryDate:"2026-10-20",sourceDigest:digest});
 assert.equal(result.root.vehicleId,12);assert.deepEqual(result.entry,f.entry);assert.deepEqual(result.cost,f.cost);assert.deepEqual(result.funding,{...f.funding,vehicle_id:12});
 assert.deepEqual({entry:f.entry,cost:f.cost,funding:f.funding,financial:f.financial},before,"proof must have no mutation or cache repair side effect");
 const at=(pattern:RegExp)=>f.calls.findIndex(q=>pattern.test(q.sql));
 const rootLock=at(/FROM vehicle_partnerships[\s\S]*FOR UPDATE/),costLock=at(/vp_cost_original/),fundingLock=at(/vp_cost_source[\s\S]*FOR UPDATE OF c/),entryLock=at(/vp_driver_payment_origin_entry/),financialLock=at(/vp_driver_payment_origin_accrual/);
 assert.ok(rootLock>=0&&rootLock<costLock&&costLock<fundingLock&&fundingLock<entryLock&&entryLock<financialLock,"root -> original expense -> funding -> employee -> accrual lock order");
}
{const f=fixture();await lockDriverPaymentOrigin(f.tx,{...actor,role:"admin",permissions:[]},51);}
{const f=fixture();f.scopes.push({...f.scopes[0],id:32,status:"pending"});await run(f);}
{const f=fixture();f.funding.source_snapshot=Object.fromEntries(Object.entries(f.funding.source_snapshot).reverse());await run(f);}

for(const [key,value] of Object.entries({id:52,employee_id:10,entry_type:"salary",direction:"receivable",source_type:"salary",source_id:"22",status:"pending",entry_date:"2026-10-21",amount:"25001.00"}))await rejectsMutation(f=>{f.entry[key]=value;});
for(const status of ["rejected","cancelled","unknown"])await rejectsMutation(f=>{f.entry.status=status;});
for(const [key,value] of Object.entries({id:32,partnership_id:2,employee_finance_entry_id:52,payer_member_id:11,funding_kind:"partner_advance",cost_class:"capital",status:"pending",source_digest:"a".repeat(64),reason:"سبب مختلف"}))await rejectsMutation(f=>{f.funding[key]=value;});
await rejectsMutation(f=>{f.funding.vehicle_expense_id=22;f.cost.id=22;});
for(const [key,value] of Object.entries({expense_type:"fuel",driver_id:10,amount:"25001.00",cost_date:"2026-10-21",description:"تعديل بعد الموافقة"}))await rejectsMutation(f=>{f.cost[key]=value;});
await rejectsMutation(f=>{f.funding.source_snapshot.amount="25001.00";});
await rejectsMutation(f=>{f.funding.source_snapshot.extra=true;});
await rejectsMutation(f=>{f.funding.source_snapshot=null;});
await rejectsMutation(f=>{f.cost.driver_id=null;});
await rejectsMutation(f=>{f.funding.financial_transaction_id=null;});
await rejectsMutation(f=>{f.cost.financial_transaction_id=88;f.cost.financial_status="executed";f.cost.financial_source_type="vehicle_expense";f.cost.financial_source_id="21";});
await rejectsMutation(f=>{f.entryRows=[];});await rejectsMutation(f=>{f.entryRows=[f.entry,{...f.entry}];});

// Any altered, reversed or unbalanced accrual must fail even when the employee
// row still says approved and its mutable remaining cache looks payable.
for(const [key,value] of Object.entries({id:92,source_type:"vehicle_expense",source_id:"32",source_event:"partner_paid_cost",transaction_type:"vehicle_expense",direction:"revenue",transaction_date:"2026-10-21",amount:"25001.00",approval_status:"pending",balance_before:"0.00",balance_after:"0.00",reversed_transaction_id:90,reversal_txn_id:92,reversed_at:"2026-10-22",reversed_amount:"1.00"}))await rejectsMutation(f=>{f.financial[key]=value;});
await rejectsMutation(f=>{f.financialRows=[];});await rejectsMutation(f=>{f.financialRows=[f.financial,{...f.financial}];});
await rejectsMutation(f=>{f.journal=[];});
await rejectsMutation(f=>{f.journal[1].code="VP-ADVANCE";});
await rejectsMutation(f=>{f.journal[0].amount="24999.00";});
await rejectsMutation(f=>{f.journal.push({...f.journal[0],id:103});});
for(const marker of ["vp_driver_payment_origin_scope","vp_cost_source","vp_cost_original","vp_driver_payment_origin_entry","vp_driver_payment_origin_accrual","vp_activity_journal_proof"]){const f=fixture();f.failAt=marker;await assert.rejects(()=>run(f),error=>error===f.sqlFailure,"SQL errors must propagate unchanged, never become no data");}
console.log("PASS actual driver payment origin proof: scoped approved source, immutable original wage/driver/date/digest, ordered locks, executed noncash accrual and balanced journal; no settlement/cache authority or writes.");
