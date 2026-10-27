import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod/v4";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
import {parseMoney,formatMoney} from "../src/lib/vehicle-partnership/money";
import {validatePayoutCapacity} from "../src/lib/vehicle-partnership/payout";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId} from "../src/server/vehicle-partnership/agreements";
import {partnershipRows,PartnershipRepositoryError,appendPartnershipAudit} from "../src/server/vehicle-partnership/repository";
assert.ok(existsSync("src/server/vehicle-partnership/driver-payments.ts"),"driver partial payments require a source-owned atomic settlement and approval proof");
const path="src/server/vehicle-partnership/driver-payments.ts",tree=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,""));
const code=ts.transpileModule(body.join("\n")+"\n({requestPartnershipDriverPayment,prepareDriverPaymentFinancialRequest,prepareDriverPaymentExecution,finishDriverPaymentExecution,rejectDriverPaymentFinancialTransaction})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true},admin={...actor,role:"admin"};
let root:any,settlements:any[],financials:any[],audits:any[],journalIds:Set<number>,queries:string[],originUnavailable=false,failAudit="",originCalls=0,cache:any;
const original={entryId:21,employeeId:9,expenseId:31,costFundingId:41,accrualFinancialId:51,amount:"100.00",entryDate:"2026-10-25",sourceDigest:"a".repeat(64)};
function reset(){root={id:1,vehicleId:12,version:2};settlements=[];financials=[];audits=[];journalIds=new Set();queries=[];originUnavailable=false;failAudit="";originCalls=0;cache={settled:"0.00",remaining:"100.00",status:"approved"};}reset();
const clone=(value:any)=>structuredClone(value),dialect=new PgDialect();
function state(){let paid=0n,reserved=0n;for(const row of settlements){assert.notEqual(row.financial_transaction_id,null,"canonical must never observe the unlinked staging settlement");const f=financials.find(item=>item.id===row.financial_transaction_id);assert.ok(f);if(f.approval_status==="executed")paid+=parseMoney(row.amount);else if(f.approval_status==="pending")reserved+=parseMoney(row.amount);}
 if(paid+reserved>10000n)throw new PartnershipRepositoryError("overpaid",409,"CONFLICT");cache={settled:formatMoney(paid),remaining:formatMoney(10000n-paid),status:paid===10000n?"settled":paid>0n?"partially_settled":"approved"};return {approvalStatus:cache.status,totalAmount:"100.00",approvedPaidAmount:cache.settled,remainingAmount:cache.remaining,reservedAmount:formatMoney(reserved),availableAmount:formatMoney(10000n-paid-reserved),payable:true};}
const execute=async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params as any[];queries.push(q.sql);
 assert.ok(!/UPDATE master_cash_box|INSERT INTO financial_ledger_entries|INSERT INTO employee_finance_entries|UPDATE vehicle_expenses|INSERT INTO \w*payroll\w*\s/.test(q.sql),"source payment module must not post cash, payroll, a second expense or employee entitlement");
 if(q.sql.includes("vp_driver_payment_scope"))return {rows:p[0]===21?[{vehicle_id:12,partnership_id:1,vehicle_expense_id:31,entry_id:21}]:[]};
 if(q.sql.includes("vp_driver_payment_settlement_scope")){const found=settlements.find(row=>row.id===p[0]);return {rows:found?[{id:found.id,entry_id:found.entry_id}]:[]};}
 if(q.sql.includes("vp_driver_payment_settlement")){const found=settlements.filter(row=>typeof p[0]==="string"?row.idempotency_key===p[0]:row.id===p[0]).map(row=>({...clone(row),financial_uses:financials.filter(f=>f.id===row.financial_transaction_id).length?settlements.filter(s=>s.financial_transaction_id===row.financial_transaction_id).length:0}));return {rows:found};}
 if(q.sql.includes("vp_driver_payment_financial")||q.sql.includes("vp_financial_request_replay"))return {rows:clone(financials.filter(row=>typeof p[0]==="string"?row.idempotency_key===p[0]:row.id===p[0]))};
 if(q.sql.includes("vp_driver_payment_proposal"))return {rows:clone(audits.filter(a=>a.transaction_id===p[0]&&a.action==="vehicle_partnership_financial_requested"))};
 if(q.sql.includes("vp_driver_payment_finished"))return {rows:clone(audits.filter(a=>a.transaction_id===p[0]&&a.action==="vehicle_partnership_driver_payment_executed"))};
 if(q.sql.includes("vp_driver_payment_pending_journal"))return {rows:journalIds.has(p[0])?[{id:1}]:[]};
 if(q.sql.includes("vp_driver_payment_insert")){const row={id:settlements.length+61,entry_id:p[0],settlement_type:"payment",amount:p[1],settlement_date:p[2],payment_method:p[3],notes:p[4],financial_transaction_id:null,payroll_line_id:null,idempotency_key:p[5],created_by:p[6],created_by_name:p[7]};settlements.push(row);return {rows:[{id:row.id}]};}
 if(q.sql.includes("vp_driver_payment_link")){const row=settlements.find(s=>s.id===p[1]&&s.financial_transaction_id===null);if(!row)return {rows:[]};row.financial_transaction_id=p[0];return {rows:[{id:row.id}]};}
 if(q.sql.startsWith("INSERT INTO financial_transactions")){const row={id:financials.length+91,transaction_no:p[0],transaction_date:p[1],direction:p[2],amount:p[3],transaction_type:p[5],source_type:p[8],source_id:p[9],source_event:p[10],idempotency_key:p[11],payment_method:p[12],approval_status:"pending",balance_before:null,balance_after:null,reversal_txn_id:null,reversed_transaction_id:null};financials.push(row);return {rows:[{id:row.id,approval_status:"pending"}]};}
 if(q.sql.startsWith("UPDATE financial_transactions SET transaction_no")){const row=financials.find(f=>f.id===p[1]);row.transaction_no=p[0];return {rows:[{id:row.id,approval_status:row.approval_status}]};}
 if(q.sql.includes("vp_driver_payment_reject_expense"))return {rows:[{id:31}]};
 if(q.sql.includes("vp_driver_payment_reject")){const row=financials.find(f=>f.id===p[3]);row.approval_status="rejected";return {rows:[{id:row.id}]};}
 if(q.sql.startsWith("INSERT INTO financial_audit_logs")){if(failAudit&&p[1]===failAudit)throw Error("audit unavailable");const row={id:audits.length+1,transaction_id:p[0],action:p[1],new_values:JSON.parse(p[5])};audits.push(row);return {rows:[{id:row.id}]};}
 throw Error("unexpected source SQL "+q.sql);
};
const db:any={execute,transaction:async(work:any)=>{const prior=clone({root,settlements,financials,audits,cache}),oldJournal=new Set(journalIds);try{return await work({execute});}catch(error){({root,settlements,financials,audits,cache}=prior);journalIds=oldJournal;throw error;}}};
const api=vm.runInNewContext(code,{createHash,sql,z,canonicalPartnershipJson,parseMoney,formatMoney,validatePayoutCapacity,PartnershipValidationError,authorizePartnership,partnershipId,partnershipRows,PartnershipRepositoryError,appendPartnershipAudit,
 lockPartnership:async(_tx:any,id:number)=>{assert.equal(id,12);return clone(root);},readOriginalVehicle:async(_tx:any,user:any,id:number)=>{assert.equal(id,12);if(user.allowedBranchIds?.includes(999))throw new PartnershipRepositoryError("branch",403,"FORBIDDEN");},
 lockDriverPaymentOrigin:async(_tx:any,_actor:any,entryId:number,vehicleId?:number)=>{originCalls++;if(originUnavailable)throw new PartnershipRepositoryError("origin unavailable",409,"CONFLICT");assert.equal(entryId,21);assert.ok(vehicleId===undefined||vehicleId===12);return {root:clone(root),proof:clone(original),entry:{id:21,status:cache.status},cost:{id:31},funding:{id:41}};},
 reconcilePaymentState:async(_tx:any,ref:any)=>{assert.equal(ref.sourceType,"vehicle_partnership_driver_entitlement");assert.equal(ref.sourceId,21,"canonical source ID must be employee entry, not settlement");return state();},
 provePartnershipJournal:async(_tx:any,id:number,amount:string,debit:string,credit:string)=>{assert.ok(journalIds.has(id),"executed payout requires the existing journal proof");assert.equal(amount,financials.find(f=>f.id===id).amount);assert.equal(debit,"VP-DRIVER");assert.equal(credit,"1000");return [];},
});
const centralTree=ts.createSourceFile("central.ts",readFileSync("src/server/master-cash-box.ts","utf8"),ts.ScriptTarget.Latest,true),central=centralTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createPartnershipSourceFinancialRequest")!;
const writer=vm.runInNewContext(ts.transpileModule(central.getText(centralTree).replace(/^export\s+/,"")+"\ncreatePartnershipSourceFinancialRequest",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,{sql,authorizePartnership,partnershipRows,parseMoney,appendPartnershipAudit,PartnershipRepositoryError,randomUUID,transactionNumber:(id:number)=>`FIN-${id}`,preparePartnershipFinancialRequest:async(tx:any,reference:any,user:any)=>api.prepareDriverPaymentFinancialRequest(tx,reference,user)});
const command={entryId:21,amount:"40.00",transactionDate:"2026-10-26",paymentMethod:"cash",paymentSource:"MASTER",expectedVersion:2,idempotencyKey:"driver-partial-40",reason:"صرف جزئي لأجرة رحلة"};
const request=(changes:any={},user=actor,vehicle=12)=>api.requestPartnershipDriverPayment(db,user,vehicle,{...command,...changes},writer);
const identity=(id=91,settlementId=61)=>({id,sourceType:"vehicle_partnership_driver",sourceId:String(settlementId)});
await assert.rejects(()=>request({}, {...actor,permissions:[]}),(e:any)=>e.status===403);assert.equal(queries.length,0);
await assert.rejects(()=>request({}, {...actor,allowedBranchIds:[999]} as any),(e:any)=>e.status===403);
await assert.rejects(()=>request({},actor,13),(e:any)=>e.status===404);
await assert.rejects(()=>request({entryId:22}),(e:any)=>e.status===404);
for(const changes of [{expectedVersion:1},{amount:"100.01"},{amount:"0.00"},{transactionDate:"2026-10-24"},{transactionDate:"2026-02-30"},{payrollLineId:2}])await assert.rejects(()=>request(changes),(e:any)=>[409,422].includes(e.status));
assert.equal(settlements.length,0);
for(const action of ["vehicle_partnership_financial_requested","vehicle_partnership_driver_payment_requested"]){failAudit=action;await assert.rejects(()=>request(),/audit unavailable/);assert.equal(settlements.length,0);assert.equal(financials.length,0);assert.equal(audits.length,0);assert.equal(cache.settled,"0.00");}failAudit="";
const first=await request();assert.equal(first.financialTransactionId,91);assert.equal(first.entryId,21);assert.equal(first.settlementId,61);assert.equal(financials[0].source_id,"61");assert.equal(settlements[0].entry_id,21);assert.equal(settlements[0].financial_transaction_id,91);assert.equal(state().approvedPaidAmount,"0.00");assert.equal(state().reservedAmount,"40.00");assert.equal(cache.status,"approved");
const initial=JSON.stringify({settlements,financials,audits,cache}),calls=originCalls;originUnavailable=true;await request();assert.equal(JSON.stringify({settlements,financials,audits,cache}),initial);assert.equal(originCalls,calls,"nonce replay must precede mutable source and capacity reads");originUnavailable=false;
await assert.rejects(()=>request({amount:"30.00"}),(e:any)=>e.status===409);
await assert.rejects(()=>request({amount:"60.01",idempotencyKey:"other-request"}),(e:any)=>[409,422].includes(e.status));
await request({amount:"60.00",idempotencyKey:"driver-partial-60"});assert.equal(state().reservedAmount,"100.00");assert.equal(state().approvedPaidAmount,"0.00");
await assert.rejects(()=>api.prepareDriverPaymentExecution(db,identity(),actor),(e:any)=>e.status===403);
await assert.rejects(()=>api.prepareDriverPaymentExecution(db,identity(91,21),admin),(e:any)=>e.status===404);
const plan=await api.prepareDriverPaymentExecution(db,identity(),admin);assert.equal(plan.amount,"40.00");assert.equal(plan.counterCode,"VP-DRIVER");assert.equal(plan.transactionType,"vp_driver_payment");assert.equal(plan.alreadyExecuted,false);
for(const [field,value] of [["payroll_line_id",1],["settlement_type","payroll"],["settlement_date","2026-10-27"],["payment_method","transfer"],["amount","40.01"],["entry_id",22],["notes","different"]] as const){const saved=settlements[0][field];settlements[0][field]=value;await assert.rejects(()=>api.prepareDriverPaymentExecution(db,identity(),admin),(e:any)=>[404,409].includes(e.status));settlements[0][field]=saved;}
const digest=audits[0].new_values.sourceDigest;audits[0].new_values.sourceDigest="0".repeat(64);await assert.rejects(()=>api.prepareDriverPaymentExecution(db,identity(),admin),(e:any)=>e.status===409);audits[0].new_values.sourceDigest=digest;
financials[0].approval_status="executed";financials[0].balance_before="100.00";financials[0].balance_after="60.00";journalIds.add(91);
await api.finishDriverPaymentExecution(db,plan,admin);assert.equal(state().approvedPaidAmount,"40.00");assert.equal(state().reservedAmount,"60.00");assert.equal(cache.status,"partially_settled");const finished=audits.length;await api.finishDriverPaymentExecution(db,plan,admin);assert.equal(audits.length,finished);assert.equal((await api.prepareDriverPaymentExecution(db,identity(),admin)).alreadyExecuted,true);
await assert.rejects(()=>api.finishDriverPaymentExecution(db,{...plan,amount:"40.01"},admin),(e:any)=>e.status===409);
financials[0].balance_after="59.99";await assert.rejects(()=>api.prepareDriverPaymentExecution(db,identity(),admin),(e:any)=>e.status===409);financials[0].balance_after="60.00";
const second=await api.prepareDriverPaymentExecution(db,identity(92,62),admin);assert.equal(second.amount,"60.00","only this exact settlement's pending hold may be added back");financials[1].approval_status="executed";financials[1].balance_before="60.00";financials[1].balance_after="0.00";journalIds.add(92);await api.finishDriverPaymentExecution(db,second,admin);assert.equal(state().approvedPaidAmount,"100.00");assert.equal(state().reservedAmount,"0.00");assert.equal(cache.status,"settled");
reset();await request();failAudit="vehicle_partnership_driver_payment_rejected";await assert.rejects(()=>db.transaction((tx:any)=>api.rejectDriverPaymentFinancialTransaction(tx,identity(),admin,"رفض الطلب")),/audit unavailable/);assert.equal(financials[0].approval_status,"pending");assert.equal(state().reservedAmount,"40.00");failAudit="";
await db.transaction((tx:any)=>api.rejectDriverPaymentFinancialTransaction(tx,identity(),admin,"رفض الطلب"));assert.equal(state().reservedAmount,"0.00");assert.equal(cache.status,"approved","rejecting cash request must not cancel the original approved accrual");const rejected=audits.length;originUnavailable=true;await api.rejectDriverPaymentFinancialTransaction(db,identity(),admin,"رفض الطلب");await request();assert.equal(audits.length,rejected);assert.equal(settlements.length,1,"rejected nonce retry must preserve history without a new cash request");
console.log("PASS driver partial payments: original employee entry/settlements, atomic NULL staging/link, real trusted financial creator, pending holds only, exact own holds, source proof and principal execution, partial/full settlement, immutable replay, rejection without accrual cancellation and early/late audit rollback (controlled SQL; no live PostgreSQL).");
