import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../src/lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId} from "../src/server/vehicle-partnership/agreements";
import {partnershipRows,PartnershipRepositoryError,appendPartnershipAudit} from "../src/server/vehicle-partnership/repository";
const path="src/server/vehicle-partnership/cash-reversal.ts";
assert.ok(existsSync(path),"full executed partnership cash reversal requires its original immutable source proof and finalizer");
const {cashReversalProof,provePartnershipCashReversalHistory}=await import("../src/server/vehicle-partnership/cash-reversal-proof");
const tree=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true),body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,"")).join("\n");
const root={id:1,vehicleId:12},actor={id:7,name:"المدير",role:"admin",permissions:[],isActive:true},reason="إرجاع صرف تم بالخطأ",digest=(v:unknown)=>createHash("sha256").update(canonicalPartnershipJson(v)).digest("hex");
let original:any,reverse:any,proposal:any,allocations:any[],history:any[],closing:any,calls:string[],canonical:any[],preflights=0,fail="",badJournal=false,noLiveAdmission=false,failCanonical=false,sawDriverProof=false,driverMapping:any=null;
function reset(kind="profit"){
 const driver=kind==="driver",advance=kind==="advance",sourceType=driver?"vehicle_partnership_driver":"vehicle_partnership_settlement",type=driver?"vp_driver_payment":advance?"vp_partner_advance_repayment":"vp_partner_distribution";
 original={id:71,transaction_no:"FIN-2026-000071",transaction_date:"2026-08-20",direction:"expense",amount:"40.00",department:"transportation",transaction_type:type,payment_method:"cash",source_type:sourceType,source_id:driver?"61":"11",source_event:driver?"driver_fee_settlement":advance?"advance_reimbursement":"distribution",idempotency_key:"original-request",approval_status:"executed",approved_by:7,executed_by:7,approved_at:"2026-08-20T10:00:00.000Z",executed_at:"2026-08-20T10:00:00.000Z",balance_before:"100.00",balance_after:"60.00",reversal_txn_id:null,reversed_transaction_id:null,reversed_at:null};
 proposal={formatVersion:1,vehicleId:12,partnershipId:1,actorId:3,command:{...(driver?{entryId:21}:{rightId:11}),amount:"40.00",transactionDate:"2026-08-20",paymentMethod:"cash"},...(driver?{settlementId:61}:{}),origin:{closingId:5,revision:2}};
 allocations=driver?[]:[{id:101,right_id:11,financial_transaction_id:71,conversion_allocation_id:null,purpose:advance?"advance_reimbursement":"distribution",amount:"40.00",idempotency_key:"original-allocation",partnership_id:1},{id:102,right_id:12,financial_transaction_id:71,conversion_allocation_id:91,purpose:"internal_entitlement_settlement",amount:"20.00",idempotency_key:"original-coverage",partnership_id:1}];
 reverse=null;history=[];closing={id:5,partnership_id:1,status:kind==="profit"?"distributed":"approved",revision:2,version:8};calls=[];canonical=[];preflights=0;fail="";badJournal=false;noLiveAdmission=false;failCanonical=false;sawDriverProof=false;driverMapping=null;
}
const dialect=new PgDialect();
const execute=async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params as any[];calls.push(q.sql);if(fail&&q.sql.includes(fail))throw Error("reversal source unavailable");assert.doesNotMatch(q.sql,/INSERT INTO (financial_transactions|employee_finance|vehicle_expenses)|UPDATE (financial_transactions|master_cash_box)|INSERT INTO financial_ledger/);
 if(q.sql.includes("vp_cash_reverse_request"))return {rows:[{new_values:{vehicleId:12,partnershipId:1,sourceType:original.source_type,sourceId:Number(original.source_id),amount:original.amount,sourceDigest:digest(proposal),sourceSnapshot:proposal}}]};
 if(q.sql.includes("vp_cash_reverse_history"))return {rows:history.map(h=>({new_values:h}))};
 if(q.sql.includes("vp_cash_reverse_original"))return {rows:[structuredClone(original)]};
 if(q.sql.includes("vp_cash_reverse_children"))return {rows:reverse?[structuredClone(reverse)]:[]};
 if(q.sql.includes("vp_cash_reverse_allocations"))return {rows:structuredClone(allocations)};
 if(q.sql.includes("vp_driver_coverage_saved"))return {rows:driverMapping?[{new_values:{vehicleId:12,partnershipId:1,mappingKey:driverMapping.mappingKey,mappingDigest:digest(driverMapping),proof:driverMapping}}]:[]};
 if(q.sql.includes("vp_activity_journal_proof")){if(badJournal)throw Error("original cash journal mismatch");const counter=original.transaction_type==="vp_driver_payment"?"VP-DRIVER":original.transaction_type==="vp_partner_advance_repayment"?"VP-ADVANCE":"VP-PROFIT";return {rows:[{id:1,entry_side:"debit",code:p[0]===71?counter:"1000",amount:"40.00"},{id:2,entry_side:"credit",code:p[0]===71?"1000":counter,amount:"40.00"}]};}
 if(q.sql.includes("vp_cash_reverse_month"))return {rows:[structuredClone(closing)]};
 if(q.sql.includes("vp_cash_reverse_profit_rights"))return {rows:[{id:11},{id:13}]};
 if(q.sql.includes("vp_cash_reverse_undistributed")){assert.equal(p[0],5);closing.status="approved";closing.version++;return {rows:[{id:5}]};}
 if(q.sql.startsWith("INSERT INTO financial_audit_logs")){history.push(JSON.parse(p[5]));return {rows:[{id:1}]};}
 throw Error("Unexpected source query "+q.sql);
};
const tx={execute};
const preflight=async()=>{if(noLiveAdmission)throw Error("historical replay must not use mutable payout admission");if(driverMapping)assert.ok(calls.includes("month-before-driver"));preflights++;return {alreadyExecuted:true,financialId:71,amount:"40.00",proposal,context:original.source_type==="vehicle_partnership_driver"?{root,proof:{entryId:21}}:{root,row:closing}};};
const api=vm.runInNewContext(ts.transpileModule(body+"\n({preparePartnershipCashReversal,finishPartnershipCashReversal,provePartnershipCashReversalHistory})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,{cashReversalProof,provePartnershipCashReversalHistory,createHash,sql,z,canonicalPartnershipJson,formatMoney,parseMoney,PartnershipValidationError,authorizePartnership,partnershipId,partnershipRows,PartnershipRepositoryError,appendPartnershipAudit,
 lockPartnership:async()=>root,readOriginalVehicle:async()=>({id:12}),prepareDistributionExecution:preflight,prepareAdvancePaymentExecution:preflight,prepareDriverPaymentExecution:preflight,
 readSavedDriverCoverage:async()=>driverMapping,proveDriverCashCoverageSource:async()=>{assert.ok(driverMapping);return {financialId:71};},proveDriverCoverageMapping:async(_tx:any,_root:any,_source:any,rows:any[])=>{assert.ok(driverMapping);assert.equal(rows.length,1);assert.equal(rows[0].allocation_id,102);},
 lockClosingContext:async()=>{assert.ok(driverMapping,"unmapped driver must not guess a closing");calls.push("month-before-driver");return {root,row:{...closing,source_digest:"b".repeat(64),financial_transaction_id:81}};},verifySubmittedClosing:async()=>({journal:{}}),proveClosingJournal:async()=>{},
 provePartnershipJournal:async(_tx:any,id:number,amount:string,debit:string,credit:string)=>{assert.equal(amount,"40.00");assert.ok(id===71||id===72);if(badJournal)throw Error("original cash journal mismatch");assert.equal(id===71?credit:debit,"1000");},
 reconcilePaymentState:async(_tx:any,ref:any)=>{canonical.push(ref);if(reverse&&original.transaction_type==="vp_driver_payment")sawDriverProof=history.length===1;if(failCanonical)return null;if(reverse&&driverMapping&&ref.sourceType==="vehicle_partnership_right")await provePartnershipCashReversalHistory(tx,71);return {remainingAmount:"40.00",reservedAmount:"0.00",approvalStatus:"approved"};},
});
function identity(){return {id:71,sourceType:original.source_type,sourceId:original.source_id,transactionType:original.transaction_type};}
const prepare=(options:any={},user:any=actor,why=reason)=>api.preparePartnershipCashReversal(tx,identity(),user,why,options);
function post(){reverse={...structuredClone(original),id:72,transaction_no:"FIN-2026-000072",transaction_date:"2026-08-21",direction:"revenue",transaction_type:original.transaction_type+"_reversal",source_event:"reversal",idempotency_key:plan.idempotencyKey,approved_at:"2026-08-21T10:00:00.000Z",executed_at:"2026-08-21T10:00:00.000Z",balance_before:"60.00",balance_after:"100.00",reversed_transaction_id:71,reversal_reason:reason,reversed_by:7,reversed_at:"2026-08-21T10:00:00.000Z"};original.reversal_txn_id=72;original.reversal_reason=reason;original.reversed_by=7;original.reversed_at=reverse.reversed_at;}
let plan:any;
for(const kind of ["profit","advance","driver"]){reset(kind);plan=await prepare();assert.equal(plan.alreadyReversed,false);assert.equal(plan.originalId,71);assert.equal(plan.amount,"40.00");assert.equal(plan.sourceId,kind==="driver"?"61":"11");assert.equal(preflights,1);const oldProposal=canonicalPartnershipJson(proposal),oldAlloc=canonicalPartnershipJson(allocations);post();await api.finishPartnershipCashReversal(tx,plan,72,actor);assert.equal(history.length,1);assert.equal(canonicalPartnershipJson(proposal),oldProposal);assert.equal(canonicalPartnershipJson(allocations),oldAlloc);assert.ok(canonical.some(r=>r.sourceType===(kind==="driver"?"vehicle_partnership_driver_entitlement":"vehicle_partnership_right")&&r.sourceId===(kind==="driver"?21:11)));if(kind==="profit")assert.equal(closing.status,"approved");noLiveAdmission=true;closing.revision++;closing.version++;const before=JSON.stringify({history,canonical,original,reverse});assert.equal((await prepare()).alreadyReversed,true);assert.equal(JSON.stringify({history,canonical,original,reverse}),before);await assert.rejects(()=>prepare({},actor,"سبب مختلف"));await assert.rejects(()=>prepare({idempotencyKey:"different-command"}));await assert.rejects(()=>prepare({}, {...actor,id:8}));}
reset();await assert.rejects(()=>prepare({}, {...actor,role:"employee"}),(e:any)=>e.status===403);assert.equal(calls.length,0);
for(const options of [{amount:10},{sourceId:11},{sourceType:"vehicle_expense"},{sourceEvent:"reversal"},{description:"override"},{expectedVersion:8}]){reset();await assert.rejects(()=>prepare(options),(e:any)=>e.status===422);assert.equal(calls.length,0);}
for(const change of [{approval_status:"pending"},{balance_after:"61.00"},{approved_by:null},{executed_at:null},{reversal_txn_id:999},{reversed_transaction_id:2}]){reset();Object.assign(original,change);await assert.rejects(prepare);assert.equal(history.length,0);}
reset();plan=await prepare();post();reverse.transaction_type="manual_reversal";await assert.rejects(()=>api.finishPartnershipCashReversal(tx,plan,72,actor));assert.equal(history.length,0);
reset();plan=await prepare();post();await api.finishPartnershipCashReversal(tx,plan,72,actor);history[0].proof.amount="41.00";await assert.rejects(()=>api.provePartnershipCashReversalHistory(tx,71));
reset();fail="vp_cash_reverse_request";await assert.rejects(prepare,/source unavailable/);
// The same transaction must discard a driver's early immutable proof when
// canonical reconciliation fails, and a month status update if audit fails.
async function finishAtomically(){const before=structuredClone({history,closing,canonical});try{await api.finishPartnershipCashReversal(tx,plan,72,actor);}catch(error){({history,closing,canonical}=before);throw error;}}
reset("driver");plan=await prepare();post();failCanonical=true;await assert.rejects(finishAtomically);assert.equal(sawDriverProof,true);assert.equal(history.length,0);
reset();plan=await prepare();post();fail="INSERT INTO financial_audit_logs";await assert.rejects(finishAtomically,/source unavailable/);assert.equal(closing.status,"distributed");assert.equal(closing.version,8);assert.equal(history.length,0);
reset("driver");driverMapping={formatVersion:1,mappingKey:"vp:driver-coverage:5:r2:financial:71",vehicleId:12,partnershipId:1,financialId:71,settlementId:61,entryId:21,expenseId:31,costFundingId:41,accrualFinancialId:51,amount:"40.00",entryAmount:"100.00",entryDate:"2026-08-15",transactionDate:"2026-08-20",paymentMethod:"cash",driverSourceDigest:"d".repeat(64),driverRequestDigest:digest(proposal),closingId:5,revision:2,closingDigest:"b".repeat(64),closingFinancialId:81,coveredAmount:"20.00",uncoveredAmount:"20.00",coverage:[{rightId:12,conversionAllocationId:91,amount:"20.00"}]};allocations=[{id:102,right_id:12,financial_transaction_id:71,conversion_allocation_id:91,purpose:"internal_entitlement_settlement",amount:"20.00",idempotency_key:"original-coverage",partnership_id:1}];plan=await prepare();post();await api.finishPartnershipCashReversal(tx,plan,72,actor);assert.equal(history.length,1);assert.ok(canonical.some(r=>r.sourceId===12));
console.log("PASS full cash reversal source: original request/journal/source identity, admin-only, no financial writer, immutable history replay after later month changes, original settlement IDs, canonical balances and distributed-month restoration.");
