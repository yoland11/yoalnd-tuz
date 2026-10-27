import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {PARTNERSHIP_TABLE_NAMES} from "../src/server/vehicle-partnership/repository";
import {partnershipCostDigest,partnershipCostSnapshot} from "../src/server/vehicle-partnership/costing";
import {lockAdvancePaymentOrigin,readAdvancePaymentScope} from "../src/server/vehicle-partnership/advance-origin";

type Row=Record<string,any>;
const actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true,allowedBranchIds:[2]};
function fixture(costClass="operating"){
 const dialect=new PgDialect(),calls:Array<{sql:string;params:any[]}>=[];
 const root={id:1,vehicle_id:12,ownership_type:"company",registration_owner:"شركة",version:5};
 const vehicle={id:12,branch_id:2,is_active:false,name:"مركبة تاريخية"};
 const cost:Row={id:21,vehicle_id:12,expense_type:costClass==="capital"?"repairs":"maintenance",amount:"100000.00",cost_date:"2026-10-20",driver_id:null,booking_id:8,service_order_id:null,description:"دفع الشريك للتصليح",attachments:[],financial_transaction_id:null,financial_status:null,financial_source_type:null,financial_source_id:null};
 const funding:Row={id:31,partnership_id:1,vehicle_expense_id:21,payer_member_id:11,employee_finance_entry_id:null,funding_kind:"partner_advance",cost_class:costClass,status:"approved",reason:"مصروف مدفوع من الشريك",financial_transaction_id:91};
 function snapshot(){funding.source_snapshot=partnershipCostSnapshot(cost,funding);funding.source_digest=partnershipCostDigest(cost,funding);}snapshot();
 const right:Row={id:41,partnership_id:1,agreement_id:3,member_id:11,cost_funding_id:31,activity_id:null,closing_line_id:null,source_snapshot:{},category:"advance",direction:"credit",amount:"100000.00",status:"approved",event_key:"vp:cost-right:31",financial_transaction_id:91};
 const member:Row={id:11,agreement_id:3,partnership_id:1,status:"superseded",effective_from:"2026-10-01",party_kind:"customer",customer_id:10,supplier_id:null,staff_id:null};
 const financial:Row={id:91,source_type:"vehicle_partnership_cost",source_id:"31",source_event:"partner_paid_cost",transaction_type:`vp_partner_${costClass}_advance`,transaction_date:"2026-10-20",direction:"expense",amount:"100000.00",approval_status:"executed",payment_method:"other",idempotency_key:"vp:cost:31",balance_before:null,balance_after:null,reversed_transaction_id:null,reversal_txn_id:null,reversed_at:null,reversed_amount:"0.00"};
 let scope:Row[]=[{right_id:41,partnership_id:1,cost_funding_id:31,vehicle_expense_id:21,vehicle_id:12}],rights:Row[]=[right],members:Row[]=[member],financials:Row[]=[financial],rightProof:Row[]=[right],journal:Row[]=[{id:1,account_id:1,entry_side:"debit",amount:"100000.00",code:costClass==="capital"?"VP-INVESTMENT":"5000"},{id:2,account_id:2,entry_side:"credit",amount:"100000.00",code:"VP-ADVANCE"}],failAt="";
 const sqlFailure=new Error("original SQL failure");
 const tx={execute:async(statement:any)=>{
  const q=dialect.sqlToQuery(statement);calls.push(q);if(failAt&&q.sql.includes(failAt))throw sqlFailure;
  assert.match(q.sql,/^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i,"approved origin must never write financial or source data");
  assert.doesNotMatch(q.sql,/master_cash_box|vehicle_partnership_settlement_allocations|employee_finance_settlements/);
  if(q.sql.includes("vp_advance_payment_scope")){assert.match(q.sql,/LIMIT 2/);assert.doesNotMatch(q.sql,/FOR UPDATE/);return {rows:scope.filter(r=>r.right_id===q.params[0])};}
  if(q.sql.includes("to_regclass"))return {rows:PARTNERSHIP_TABLE_NAMES.map(name=>({name,present:true}))};
  if(q.sql.includes("FROM vehicle_partnerships"))return {rows:[root]};
  if(q.sql.includes("FROM fleet_vehicles"))return {rows:[vehicle]};
  if(q.sql.includes("vp_cost_source"))return {rows:[{...funding,vehicle_id:12}]};
  if(q.sql.includes("vp_cost_original"))return {rows:[cost]};
  if(q.sql.includes("vp_advance_payment_right")){assert.match(q.sql,/FOR UPDATE/);assert.deepEqual(q.params,[41]);return {rows:rights};}
  if(q.sql.includes("vp_advance_payment_member")){assert.deepEqual(q.params,[funding.payer_member_id,right.agreement_id,root.id]);assert.match(q.sql,/FOR KEY SHARE OF m,g/);assert.doesNotMatch(q.sql,/later|is_active|FROM staff/);return {rows:members};}
  if(q.sql.includes("vp_advance_payment_financial")){assert.deepEqual(q.params,[91]);assert.match(q.sql,/FOR UPDATE OF f/);assert.match(q.sql,/reversed_transaction_id=f.id/);return {rows:financials};}
  if(q.sql.includes("vp_cost_right_proof"))return {rows:rightProof};
  if(q.sql.includes("vp_activity_journal_proof")){assert.deepEqual(q.params,[91]);return {rows:journal};}
  throw Error("Unexpected origin SQL "+q.sql);
 }};
 return {tx,calls,root,vehicle,cost,funding,right,member,financial,snapshot,sqlFailure,get scope(){return scope;},set scope(v){scope=v;},get rights(){return rights;},set rights(v){rights=v;},get members(){return members;},set members(v){members=v;},get financials(){return financials;},set financials(v){financials=v;},get rightProof(){return rightProof;},set rightProof(v){rightProof=v;},get journal(){return journal;},set journal(v){journal=v;},set failAt(v:string){failAt=v;}};
}
const run=(f:ReturnType<typeof fixture>,user=actor,vehicleId:number|undefined=12)=>lockAdvancePaymentOrigin(f.tx,user,41,vehicleId);
const conflict=(e:any)=>e.status===409&&e.code==="CONFLICT";
async function bad(mutate:(f:ReturnType<typeof fixture>)=>void){const f=fixture();mutate(f);await assert.rejects(()=>run(f),conflict);}
for(const user of [{...actor,permissions:[]},{...actor,isActive:false}]){const f=fixture();await assert.rejects(()=>run(f,user),(e:any)=>e.status===403);assert.equal(f.calls.length,0);}
for(const [rightId,vehicleId] of [[0,12],[41,0],[41,NaN]]){const f=fixture();await assert.rejects(()=>lockAdvancePaymentOrigin(f.tx,actor,rightId,vehicleId),(e:any)=>e.status===422);assert.equal(f.calls.length,0);}
{const f=fixture();await assert.rejects(()=>run(f,actor,99),(e:any)=>e.status===404);assert.equal(f.calls.length,1);}
{const f=fixture();f.scope=[];await assert.rejects(()=>run(f),(e:any)=>e.status===404);}
{const f=fixture();f.scope.push({...f.scope[0]});await assert.rejects(()=>run(f),conflict);}
{const f=fixture();f.vehicle.branch_id=3;await assert.rejects(()=>run(f),(e:any)=>e.status===403);assert.ok(f.calls.every(q=>!/vp_cost_original|vp_advance_payment_right/.test(q.sql)));}
for(const costClass of ["operating","capital"]){
 const f=fixture(costClass),before=structuredClone({right:f.right,cost:f.cost,funding:f.funding,financial:f.financial});
 const result=await run(f);assert.equal(result.root.vehicleId,12);assert.equal(result.right.id,41);assert.equal(result.funding.id,31);
 assert.deepEqual(result.proof,{rightId:41,costFundingId:31,expenseId:21,originalFinancialId:91,agreementId:3,memberId:11,amount:"100000.00",costDate:"2026-10-20",sourceDigest:f.funding.source_digest,rightSnapshot:{}});
 assert.deepEqual({right:f.right,cost:f.cost,funding:f.funding,financial:f.financial},before,"origin proof leaves source and original FI untouched");
 const at=(r:RegExp)=>f.calls.findIndex(q=>r.test(q.sql));assert.ok(at(/FROM vehicle_partnerships[\s\S]*FOR UPDATE/)<at(/vp_cost_original/));assert.ok(at(/vp_cost_original/)<at(/vp_cost_source[\s\S]*FOR UPDATE OF c/));assert.ok(at(/vp_cost_source[\s\S]*FOR UPDATE OF c/)<at(/vp_advance_payment_right/));assert.ok(at(/vp_advance_payment_right/)<at(/vp_advance_payment_financial/));
}
{const f=fixture();f.funding.status="reversed";f.right.status="reversed";const result=await readAdvancePaymentScope(f.tx,actor,41,12);assert.equal(result.root.id,1);assert.equal(result.costFundingId,31);assert.equal(result.expenseId,21);assert.ok(f.calls.every(q=>!/vp_cost_original|vp_cost_source|FOR KEY SHARE|vp_advance_payment_financial/.test(q.sql)),"historical retry scope must not acquire fleet, source or FI locks");}
{const f=fixture();f.member.status="approved";await run(f,{...actor,role:"admin",permissions:[]});}
{const f=fixture();f.cost.financial_transaction_id=88;f.cost.financial_status="rejected";f.cost.financial_source_type="vehicle_expense";f.cost.financial_source_id="21";f.snapshot();await run(f);}
{const f=fixture();f.funding.source_snapshot=Object.fromEntries(Object.entries(f.funding.source_snapshot).reverse());await run(f);}
for(const [key,value] of Object.entries({id:42,partnership_id:2,agreement_id:4,member_id:12,cost_funding_id:32,activity_id:8,closing_line_id:7,category:"capital",direction:"debit",amount:"100001.00",status:"pending",event_key:"vp:cost-right:32",financial_transaction_id:92}))await bad(f=>{f.right[key]=value;});
for(const snapshot of [null,[],{amount:"100000.00"}])await bad(f=>{f.right.source_snapshot=snapshot;});
for(const [key,value] of Object.entries({id:32,partnership_id:2,payer_member_id:12,employee_finance_entry_id:51,funding_kind:"partner_capital",cost_class:"unknown",status:"reversed",financial_transaction_id:92,source_digest:"0".repeat(64),reason:"تعديل"}))await bad(f=>{f.funding[key]=value;});
await bad(f=>{f.funding.vehicle_expense_id=22;f.cost.id=22;});
for(const [key,value] of Object.entries({id:12,agreement_id:4,partnership_id:2,status:"pending",effective_from:"2026-10-21",party_kind:"other",customer_id:null,supplier_id:5}))await bad(f=>{f.member[key]=value;});
for(const [key,value] of Object.entries({amount:"100001.00",cost_date:"2026-10-21",description:"تعديل المصروف",expense_type:"fuel"}))await bad(f=>{f.cost[key]=value;});
await bad(f=>{f.funding.source_snapshot.extra=true;});await bad(f=>{f.funding.source_snapshot=null;});
await bad(f=>{f.cost.financial_transaction_id=88;f.cost.financial_status="executed";f.cost.financial_source_type="vehicle_expense";f.cost.financial_source_id="21";});
for(const [key,value] of Object.entries({id:92,source_type:"vehicle_expense",source_id:"32",source_event:"driver_accrual",transaction_type:"vp_partner_operating_capital",transaction_date:"2026-10-21",direction:"revenue",amount:"100001.00",approval_status:"pending",balance_before:"0.00",balance_after:"0.00",reversed_transaction_id:90,reversal_txn_id:92,reversed_at:"2026-10-22",reversed_amount:"1.00",payment_method:"cash",idempotency_key:"different"}))await bad(f=>{f.financial[key]=value;});
await bad(f=>{f.rights=[];});await bad(f=>{f.rights=[f.right,{...f.right}];});await bad(f=>{f.members=[];});await bad(f=>{f.financials=[];});await bad(f=>{f.financials=[f.financial,{...f.financial}];});await bad(f=>{f.rightProof=[];});await bad(f=>{f.rightProof=[f.right,{...f.right}];});
await bad(f=>{f.journal=[];});await bad(f=>{f.journal[0].code="VP-INVESTMENT";});await bad(f=>{f.journal[1].code="VP-CAPITAL";});await bad(f=>{f.journal[0].amount="99999.99";});
for(const marker of ["vp_advance_payment_scope","vp_cost_source","vp_cost_original","vp_advance_payment_right","vp_advance_payment_member","vp_advance_payment_financial","vp_cost_right_proof","vp_activity_journal_proof"]){const f=fixture();f.failAt=marker;await assert.rejects(()=>run(f),e=>e===f.sqlFailure,"database failure must propagate rather than becoming an empty origin");}
console.log("PASS actual approved advance origin: original expense/funding/right/dated member, immutable digest and source ID, inactive historical liabilities, original noncash operating/capital journal, company-paid refusal and read-only ordered source proof.");
