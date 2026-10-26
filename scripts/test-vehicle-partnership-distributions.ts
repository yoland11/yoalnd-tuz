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
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId} from "../src/server/vehicle-partnership/agreements";
import {partnershipRows,PartnershipRepositoryError,appendPartnershipAudit} from "../src/server/vehicle-partnership/repository";
import {buildPayoutCoverage,validatePayoutCapacity} from "../src/lib/vehicle-partnership/payout";
const file="src/server/vehicle-partnership/distributions.ts";
assert.ok(existsSync(file),"partial profit payouts require a source-owned pending request and immutable allocation proof");
const tree=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,""));
const code=ts.transpileModule(body.join("\n")+"\n({requestPartnerDistribution,prepareDistributionFinancialRequest,prepareDistributionExecution,finishDistributionExecution,rejectDistributionFinancialTransaction})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true},admin={...actor,role:"admin"};
const root={id:1,vehicleId:12,version:2};
let header:any,right:any,financial:any,allocations:any[],audits:any[],failAudit=false,failFinalRequestAudit=false,sourceUnavailable=false,queries:string[],sourceCalls=0,cashWrites=0,priorPaid=0n,priorReserved=0n;
const snapshot={from:"2025-08-01",to:"2025-08-31",sourceSnapshots:[],calculation:{profitAllocations:[{memberId:11,amount:"100.00"}]}};
const originDigest="a".repeat(64),dialect=new PgDialect();
const reset=()=>{header={id:5,partnership_id:1,period:"2025-08-01",revision:1,version:4,status:"approved",financial_transaction_id:81,source_digest:originDigest};right={id:101,partnership_id:1,agreement_id:3,member_id:11,closing_line_id:21,category:"profit",direction:"credit",status:"approved",amount:"100.00",financial_transaction_id:81,source_snapshot:{closingId:5,revision:1,sourceDigest:originDigest}};financial=null;allocations=[];audits=[];queries=[];sourceCalls=0;failAudit=false;sourceUnavailable=false;cashWrites=0;priorPaid=0n;priorReserved=0n;};reset();
const state=(id:number)=>{
 if(id===101){const own=allocations.find(a=>a.right_id===101);const amount=own?parseMoney(own.amount):0n,paid=priorPaid+(financial?.approval_status==="executed"?amount:0n),reserved=priorReserved+(financial?.approval_status==="pending"?amount:0n);return {approvalStatus:"approved",totalAmount:"100.00",approvedPaidAmount:formatMoney(paid),reservedAmount:formatMoney(reserved),availableAmount:formatMoney(10000n-paid-reserved),remainingAmount:formatMoney(10000n-paid),payable:true};}
 const coverage=allocations.find(a=>a.right_id===51),amount=coverage?parseMoney(coverage.amount):0n,paid=priorPaid+(financial?.approval_status==="executed"?amount:0n),reserved=priorReserved+(financial?.approval_status==="pending"?amount:0n);
 return {approvalStatus:"approved",totalAmount:"100.00",approvedPaidAmount:formatMoney(paid),reservedAmount:"0.00",availableAmount:"0.00",remainingAmount:"0.00",nonCashSettledAmount:formatMoney(10000n-paid),conversionAmount:"100.00",conversionCashPaidAmount:formatMoney(paid),conversionCashReservedAmount:formatMoney(reserved),availableCoverageAmount:formatMoney(10000n-paid-reserved)};
};
const execute=async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params as any[];queries.push(q.sql);assert.ok(!/UPDATE master_cash_box|INSERT INTO financial_ledger_entries/.test(q.sql));
 if(q.sql.includes("vp_distribution_scope"))return {rows:[{vehicle_id:12,closing_id:5,right_id:101}]};
 if(q.sql.includes("vp_distribution_right"))return {rows:[structuredClone({...right,line_revision:1,closing_id:5})]};
 if(q.sql.includes("vp_distribution_financial"))return {rows:financial?[structuredClone(financial)]:[]};
 if(q.sql.includes("vp_distribution_proposal"))return {rows:structuredClone(audits.filter(a=>a.action==="vehicle_partnership_financial_requested"))};
 if(q.sql.includes("vp_distribution_finished"))return {rows:structuredClone(audits.filter(a=>a.action==="vehicle_partnership_distribution_executed"))};
 if(q.sql.includes("vp_distribution_allocations"))return {rows:structuredClone(allocations)};
 if(q.sql.includes("vp_distribution_budget"))return {rows:[{id:61,right_id:51,partnership_id:1,purpose:"internal_conversion",conversion_allocation_id:null,financial_transaction_id:81,amount:"100.00"}]};
 if(q.sql.includes("vp_financial_request_replay"))return {rows:financial?.idempotency_key===p[0]?[structuredClone(financial)]:[]};
 if(q.sql.startsWith("INSERT INTO financial_transactions")){financial={id:91,transaction_no:p[0],transaction_date:p[1],direction:p[2],amount:p[3],transaction_type:p[5],source_type:p[8],source_id:p[9],source_event:p[10],idempotency_key:p[11],payment_method:p[12],approval_status:"pending",balance_before:null,balance_after:null,reversal_txn_id:null,reversed_transaction_id:null};return {rows:[{id:91,approval_status:"pending"}]};}
 if(q.sql.startsWith("UPDATE financial_transactions SET transaction_no")){financial.transaction_no=p[0];return {rows:[{id:91,approval_status:"pending"}]};}
 if(q.sql.includes("vp_distribution_allocation_insert")){const row={id:allocations.length+71,right_id:p[0],financial_transaction_id:p[1],conversion_allocation_id:p[2],purpose:p[3],amount:p[4],idempotency_key:p[5]};allocations.push(row);return {rows:[{id:row.id}]};}
 if(q.sql.includes("vp_distribution_pending_journal"))return {rows:[]};
 if(q.sql.includes("vp_distribution_origin_financial"))return {rows:[{id:81,source_type:"vehicle_partnership_closing",source_id:"5",source_event:"monthly_result",transaction_type:"vp_month_profit",direction:"expense",amount:"100.00",transaction_date:"2025-08-31",approval_status:"executed",reversal_txn_id:null,balance_before:null,balance_after:null}]};
 if(q.sql.includes("vp_distribution_reject")){financial.approval_status="rejected";return {rows:[{id:91}]};}
 if(q.sql.includes("vp_distribution_profit_rights"))return {rows:[{id:101}]};
 if(q.sql.includes("vp_distribution_distributed")){header={...header,status:"distributed",version:header.version+1};return {rows:[{id:5}]};}
 if(q.sql.startsWith("INSERT INTO financial_audit_logs")){if(failAudit||failFinalRequestAudit&&p[1]==="vehicle_partnership_distribution_requested")throw Error("audit unavailable");const row={id:audits.length+1,transaction_id:p[0],action:p[1],actor_id:p[2],new_values:JSON.parse(p[5])};audits.push(row);return {rows:[{id:row.id}]};}
 throw Error("Unexpected distribution query "+q.sql);
};
const db={execute,transaction:async<T>(work:(tx:any)=>Promise<T>)=>{const old=structuredClone({header,right,financial,allocations,audits});try{return await work({execute});}catch(error){({header,right,financial,allocations,audits}=old);throw error;}}};
const api=vm.runInNewContext(code,{sql,z,createHash,canonicalPartnershipJson,parseMoney,formatMoney,PartnershipValidationError,PartnershipRepositoryError,partnershipRows,partnershipId,authorizePartnership,appendPartnershipAudit,buildPayoutCoverage,validatePayoutCapacity,
 lockPartnership:async()=>root,readOriginalVehicle:async()=>({id:12}),
 lockClosingContext:async()=>{sourceCalls++;if(sourceUnavailable)throw Error("originals unavailable");return {root,row:structuredClone(header)};},
 verifySubmittedClosing:async()=>({snapshot,journal:{amount:"100.00",transactionType:"vp_month_profit",legs:[]}}),
 proveClosingRevisionRights:async()=>[101],reserveClosingConversions:async()=>[51],proveClosingJournal:async()=>[],
 reconcilePaymentState:async(_tx:any,input:any)=>state(Number(input.sourceId)),
 provePartnershipJournal:async()=>[],
});
const command={rightId:101,amount:"40.00",transactionDate:"2026-10-26",paymentMethod:"cash",paymentSource:"MASTER",expectedVersion:4,idempotencyKey:"profit-partial-40",reason:"حصة شهرية جزئية"};
const centralTree=ts.createSourceFile("central.ts",readFileSync("src/server/master-cash-box.ts","utf8"),ts.ScriptTarget.Latest,true);
const central=centralTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createPartnershipSourceFinancialRequest")!;
const writer=vm.runInNewContext(ts.transpileModule(central.getText(centralTree).replace(/^export\s+/,"")+"\ncreatePartnershipSourceFinancialRequest",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,{sql,authorizePartnership,partnershipRows,parseMoney,appendPartnershipAudit,PartnershipRepositoryError,randomUUID,transactionNumber:(id:number)=>`FIN-${id}`,preparePartnershipFinancialRequest:async(tx:any,reference:any,user:any)=>api.prepareDistributionFinancialRequest(tx,reference,user)});
const request=(changes:any={},user=actor)=>api.requestPartnerDistribution(db,user,12,{...command,...changes},writer);
await assert.rejects(()=>request({}, {...actor,permissions:[]}),(e:any)=>e.status===403);assert.equal(queries.length,0);
await assert.rejects(()=>request({amount:"100.01"}),(e:any)=>e.status===409||e.status===422);assert.equal(financial,null);
await assert.rejects(()=>request({expectedVersion:3}),(e:any)=>e.status===409);
failAudit=true;await assert.rejects(()=>request(),/audit unavailable/);assert.equal(financial,null);assert.equal(allocations.length,0);failAudit=false;
failFinalRequestAudit=true;await assert.rejects(()=>request(),/audit unavailable/);assert.equal(financial,null);assert.equal(allocations.length,0,"late audit failure rolls back the real central FI, proposal and all reservations");failFinalRequestAudit=false;
const first=await request();assert.equal(first.financialTransactionId,91);assert.equal(financial.approval_status,"pending");assert.equal(allocations.length,2);assert.equal(state(101).approvedPaidAmount,"0.00");assert.equal(state(101).reservedAmount,"40.00");assert.equal(state(51).conversionCashReservedAmount,"40.00");
const existing=JSON.stringify({financial,allocations,audits}),calls=sourceCalls;sourceUnavailable=true;await request();assert.equal(JSON.stringify({financial,allocations,audits}),existing);assert.equal(sourceCalls,calls,"durable retry precedes mutable source reads and new capacity checks");sourceUnavailable=false;
await assert.rejects(()=>request({amount:"30.00"}),(e:any)=>e.status===409);
const initial={id:91,sourceType:"vehicle_partnership_settlement",sourceId:"101"};
await assert.rejects(()=>api.prepareDistributionExecution(db,initial,actor),(e:any)=>e.status===403);
const plan=await api.prepareDistributionExecution(db,initial,admin);assert.equal(plan.alreadyExecuted,false);assert.equal(plan.amount,"40.00");assert.equal(plan.counterCode,"VP-PROFIT");assert.equal(financial.approval_status,"pending");
allocations[1].amount="40.01";await assert.rejects(()=>api.prepareDistributionExecution(db,initial,admin),(e:any)=>e.status===409);allocations[1].amount="40.00";
financial.approval_status="executed";financial.balance_before="100.00";financial.balance_after="60.00";await api.finishDistributionExecution(db,plan,admin);assert.equal(state(101).approvedPaidAmount,"40.00");assert.equal(header.status,"approved");assert.equal((await api.prepareDistributionExecution(db,initial,admin)).alreadyExecuted,true);
const finishedCount=audits.length;await api.finishDistributionExecution(db,plan,admin);assert.equal(audits.length,finishedCount,"finalization retries must not duplicate execution audit or monthly transitions");
await assert.rejects(()=>api.finishDistributionExecution(db,{...plan,amount:"40.01"},admin),(e:any)=>e.status===409,"the finalizer must not accept a different amount from a caller");
financial.balance_after="59.99";await assert.rejects(()=>api.prepareDistributionExecution(db,initial,admin),(e:any)=>e.status===409);financial.balance_after="60.00";
reset();await request();await db.transaction(tx=>api.rejectDistributionFinancialTransaction(tx,initial,admin,"رفض طلب الحصة"));assert.equal(financial.approval_status,"rejected");assert.equal(state(101).reservedAmount,"0.00");assert.equal(state(51).conversionCashReservedAmount,"0.00");const auditCount=audits.length;await api.rejectDistributionFinancialTransaction(db,initial,admin,"رفض طلب الحصة");assert.equal(audits.length,auditCount);
reset();await request({amount:"100.00"});financial.approval_status="executed";financial.balance_before="120.00";financial.balance_after="20.00";const full=await api.prepareDistributionExecution(db,initial,admin);await api.finishDistributionExecution(db,full,admin);assert.equal(header.status,"distributed");
reset();priorPaid=4000n;await assert.rejects(()=>request({amount:"60.01"}),(e:any)=>e.status===409||e.status===422);assert.equal(financial,null);
await request({amount:"60.00"});assert.equal(state(101).approvedPaidAmount,"40.00");assert.equal(state(101).reservedAmount,"60.00");assert.equal(allocations[1].amount,"60.00");const remainder=await api.prepareDistributionExecution(db,initial,admin);financial.approval_status="executed";financial.balance_before="75.00";financial.balance_after="15.00";await api.finishDistributionExecution(db,remainder,admin);assert.equal(state(101).approvedPaidAmount,"100.00");assert.equal(header.status,"distributed","only completion of all approved rights changes the month to distributed");
reset();priorPaid=4000n;priorReserved=3000n;await assert.rejects(()=>request({amount:"30.01"}),(e:any)=>e.status===409||e.status===422);assert.equal(financial,null);await request({amount:"20.00"});assert.equal(state(101).reservedAmount,"50.00");assert.equal((await api.prepareDistributionExecution(db,initial,admin)).amount,"20.00","approval adds back only its proven own hold, preserving another pending request");
assert.equal(cashWrites,0,"source module prepares and reconciles; only original central MASTER executor may post cash");
console.log("PASS source-owned partial profit distribution: approved frozen source, immutable proposal, all-or-nothing reservations/audit, exact retries, own holds only, matching coverage, principal execution/rejection and distributed state (controlled SQL; no live PostgreSQL).");
