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
const file="src/server/vehicle-partnership/advance-payments.ts";
assert.ok(existsSync(file),"approved partner advance reimbursement needs its own pending lifecycle before cash may move");
const tree=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,""));
const code=ts.transpileModule(body.join("\n")+"\n({requestPartnerAdvancePayment,prepareAdvancePaymentFinancialRequest,prepareAdvancePaymentExecution,finishAdvancePaymentExecution,rejectAdvancePaymentFinancialTransaction})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true},admin={...actor,role:"admin"};
const root={id:1,vehicleId:12,version:2};
let zeroApproved=true;
let monthRows:any[],originFinancial:any,sourceJournal:any,costClass="operating",pendingJournal=false,failQuery="",locks:string[],header:any,right:any,financial:any,allocations:any[],audits:any[],failAudit=false,failFinalRequestAudit=false,sourceUnavailable=false,queries:string[],sourceCalls=0,cashWrites=0,priorPaid=0n,priorReserved=0n;
const sourceSnapshot={expenseId:21,amount:"100.00",date:"2025-08-20"};
const advanceProof={rightId:101,costFundingId:31,expenseId:21,originalFinancialId:71,agreementId:3,memberId:11,amount:"100.00",costDate:"2025-08-20",sourceDigest:"b".repeat(64),rightSnapshot:{}};
const frozen={key:"financial:71",snapshot:{costFundingId:31,expenseId:21,sourceSnapshot,sourceDigest:advanceProof.sourceDigest,sourceStatus:"approved",financial:{id:71,sourceType:"vehicle_partnership_cost",sourceId:"31",event:"partner_paid_cost",type:"vp_partner_operating_advance",direction:"expense",amount:"100.00",date:"2025-08-20",status:"executed",reversalOf:null}}};
const snapshot:any={from:"2025-08-01",to:"2025-08-31",sourceSnapshots:[frozen],calculation:{profitAllocations:[{memberId:11,amount:"100.00"}]}};
const originDigest="a".repeat(64),dialect=new PgDialect();
const reset=()=>{monthRows=[{id:5,period:"2025-08-01",cost_date:"2025-08-20"}];originFinancial={id:81,source_type:"vehicle_partnership_closing",source_id:"5",source_event:"monthly_result",transaction_type:"vp_month_profit",direction:"expense",amount:"100.00",transaction_date:"2025-08-31",approval_status:"executed",reversal_txn_id:null,reversed_transaction_id:null,reversed_at:null,reversed_amount:"0.00",balance_before:null,balance_after:null};sourceJournal={amount:"100.00",transactionType:"vp_month_profit",legs:[]};snapshot.sourceSnapshots=[structuredClone(frozen)];costClass="operating";pendingJournal=false;failQuery="";locks=[];failFinalRequestAudit=false;header={id:5,partnership_id:1,period:"2025-08-01",revision:1,version:4,status:"approved",financial_transaction_id:81,source_digest:originDigest};right={id:101,partnership_id:1,agreement_id:3,member_id:11,cost_funding_id:31,category:"advance",direction:"credit",status:"approved",amount:"100.00",financial_transaction_id:71,source_snapshot:{}};financial=null;allocations=[];audits=[];queries=[];sourceCalls=0;failAudit=false;sourceUnavailable=false;cashWrites=0;priorPaid=0n;priorReserved=0n;};reset();
const state=(id:number)=>{
 if(id===101){const own=allocations.find(a=>a.right_id===101);const amount=own?parseMoney(own.amount):0n,paid=priorPaid+(financial?.approval_status==="executed"?amount:0n),reserved=priorReserved+(financial?.approval_status==="pending"?amount:0n);return {approvalStatus:"approved",totalAmount:"100.00",approvedPaidAmount:formatMoney(paid),reservedAmount:formatMoney(reserved),availableAmount:formatMoney(10000n-paid-reserved),remainingAmount:formatMoney(10000n-paid),payable:true};}
 const coverage=allocations.find(a=>a.right_id===51),amount=coverage?parseMoney(coverage.amount):0n,paid=priorPaid+(financial?.approval_status==="executed"?amount:0n),reserved=priorReserved+(financial?.approval_status==="pending"?amount:0n);
 return {approvalStatus:"approved",totalAmount:"100.00",approvedPaidAmount:formatMoney(paid),reservedAmount:"0.00",availableAmount:"0.00",remainingAmount:"0.00",nonCashSettledAmount:formatMoney(10000n-paid),conversionAmount:"100.00",conversionCashPaidAmount:formatMoney(paid),conversionCashReservedAmount:formatMoney(reserved),availableCoverageAmount:formatMoney(10000n-paid-reserved)};
};
const execute=async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params as any[];queries.push(q.sql);if(failQuery&&q.sql.includes(failQuery))throw Error("SQL unavailable "+failQuery);assert.ok(!/UPDATE master_cash_box|INSERT INTO financial_ledger_entries/.test(q.sql));
 if(q.sql.includes("vp_advance_payment_month")){assert.deepEqual(p,[31,1]);assert.doesNotMatch(q.sql,/FOR UPDATE|FOR KEY SHARE/);return {rows:structuredClone(monthRows)};}

 if(q.sql.includes("vp_advance_payment_financial"))return {rows:financial?[structuredClone(financial)]:[]};
 if(q.sql.includes("vp_advance_payment_proposal"))return {rows:structuredClone(audits.filter(a=>a.action==="vehicle_partnership_financial_requested"))};
 if(q.sql.includes("vp_advance_payment_finished"))return {rows:structuredClone(audits.filter(a=>a.action==="vehicle_partnership_advance_payment_executed"))};
 if(q.sql.includes("vp_advance_payment_allocations"))return {rows:structuredClone(allocations)};
 if(q.sql.includes("vp_advance_payment_budget"))return {rows:[{id:61,right_id:51,partnership_id:1,purpose:"internal_conversion",conversion_allocation_id:null,financial_transaction_id:81,amount:"100.00"}]};
 if(q.sql.includes("vp_financial_request_replay"))return {rows:financial?.idempotency_key===p[0]?[structuredClone(financial)]:[]};
 if(q.sql.startsWith("INSERT INTO financial_transactions")){financial={id:91,transaction_no:p[0],transaction_date:p[1],direction:p[2],amount:p[3],transaction_type:p[5],source_type:p[8],source_id:p[9],source_event:p[10],idempotency_key:p[11],payment_method:p[12],approval_status:"pending",balance_before:null,balance_after:null,reversal_txn_id:null,reversed_transaction_id:null};return {rows:[{id:91,approval_status:"pending"}]};}
 if(q.sql.startsWith("UPDATE financial_transactions SET transaction_no")){financial.transaction_no=p[0];return {rows:[{id:91,approval_status:"pending"}]};}
 if(q.sql.includes("vp_advance_payment_allocation_insert")){const row={id:allocations.length+71,right_id:p[0],financial_transaction_id:p[1],conversion_allocation_id:p[2],purpose:p[3],amount:p[4],idempotency_key:p[5]};allocations.push(row);return {rows:[{id:row.id}]};}
 if(q.sql.includes("vp_advance_payment_pending_journal"))return {rows:pendingJournal?[{id:1}]:[]};
 if(q.sql.includes("vp_advance_payment_origin_financial"))return {rows:originFinancial?[structuredClone(originFinancial)]:[]};
 if(q.sql.includes("vp_advance_payment_reject")){financial.approval_status="rejected";return {rows:[{id:91}]};}
 if(q.sql.startsWith("INSERT INTO financial_audit_logs")){if(failAudit||failFinalRequestAudit&&p[1]==="vehicle_partnership_advance_payment_requested")throw Error("audit unavailable");const row={id:audits.length+1,transaction_id:p[0],action:p[1],actor_id:p[2],new_values:JSON.parse(p[5])};audits.push(row);return {rows:[{id:row.id}]};}
 throw Error("Unexpected advance reimbursement query "+q.sql);
};
const db={execute,transaction:async<T>(work:(tx:any)=>Promise<T>)=>{const old=structuredClone({header,right,financial,allocations,audits});try{return await work({execute});}catch(error){({header,right,financial,allocations,audits}=old);throw error;}}};
const api=vm.runInNewContext(code,{sql,z,createHash,canonicalPartnershipJson,parseMoney,formatMoney,PartnershipValidationError,PartnershipRepositoryError,partnershipRows,partnershipId,authorizePartnership,appendPartnershipAudit,buildPayoutCoverage,validatePayoutCapacity,
 readAdvancePaymentScope:async()=>{locks.push("scope");return {root,rightId:101,costFundingId:31,expenseId:21};},
 lockAdvancePaymentOrigin:async()=>{assert.equal(locks.at(-1),"closing","month original booking locks must precede fleet/expense locks");locks.push("origin");return {root,right:structuredClone(right),cost:{id:21,cost_date:"2025-08-20"},funding:{id:31,source_snapshot:sourceSnapshot,cost_class:costClass,funding_kind:"partner_advance"},proof:advanceProof};},partnershipCostPostingType:()=>`vp_partner_${costClass}_advance`,
 lockClosingContext:async()=>{sourceCalls++;locks.push("closing");if(sourceUnavailable)throw Error("originals unavailable");return {root,row:structuredClone(header)};},
 verifySubmittedClosing:async(_tx:any,_actor:any,_ctx:any,revalidate:any)=>{assert.equal(revalidate,false);return {snapshot,journal:sourceJournal};},
 reserveClosingConversions:async(_tx:any,_actor:any,_ctx:any,verifyOnly:any)=>{assert.equal(verifyOnly,true,"reuse conversion proof without creating another reservation");return [51];},proveClosingJournal:async()=>[],
 reconcilePaymentState:async(_tx:any,input:any)=>state(Number(input.sourceId)),
 provePartnershipJournal:async()=>[],
 previewClosing:async()=>({stored:zeroApproved,closingId:5,version:header.version,status:header.status,sourceDigest:originDigest}),
});
const command={rightId:101,amount:"40.00",transactionDate:"2026-10-26",paymentMethod:"cash",paymentSource:"MASTER",expectedVersion:4,idempotencyKey:"advance-partial-40",reason:"استرداد سلفة جزئي"};
const centralTree=ts.createSourceFile("central.ts",readFileSync("src/server/master-cash-box.ts","utf8"),ts.ScriptTarget.Latest,true);
const central=centralTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createPartnershipSourceFinancialRequest")!;
const writer=vm.runInNewContext(ts.transpileModule(central.getText(centralTree).replace(/^export\s+/,"")+"\ncreatePartnershipSourceFinancialRequest",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,{sql,authorizePartnership,partnershipRows,parseMoney,appendPartnershipAudit,PartnershipRepositoryError,randomUUID,transactionNumber:(id:number)=>`FIN-${id}`,preparePartnershipFinancialRequest:async(tx:any,reference:any,user:any)=>api.prepareAdvancePaymentFinancialRequest(tx,reference,user)});
const request=(changes:any={},user=actor)=>api.requestPartnerAdvancePayment(db,user,12,{...command,...changes},writer);
await assert.rejects(()=>request({}, {...actor,permissions:[]}),(e:any)=>e.status===403);assert.equal(queries.length,0);
await assert.rejects(()=>request({amount:"100.01"}),(e:any)=>e.status===409||e.status===422);assert.equal(financial,null);
await assert.rejects(()=>request({expectedVersion:3}),(e:any)=>e.status===409);
failAudit=true;await assert.rejects(()=>request(),/audit unavailable/);assert.equal(financial,null);assert.equal(allocations.length,0);failAudit=false;
failFinalRequestAudit=true;await assert.rejects(()=>request(),/audit unavailable/);assert.equal(financial,null);assert.equal(allocations.length,0,"late audit failure rolls back the real central FI, proposal and all reservations");failFinalRequestAudit=false;
const first=await request();assert.equal(first.financialTransactionId,91);assert.equal(financial.approval_status,"pending");assert.equal(allocations.length,2);assert.equal(state(101).approvedPaidAmount,"0.00");assert.equal(state(101).reservedAmount,"40.00");assert.equal(state(51).conversionCashReservedAmount,"40.00");
const existing=JSON.stringify({financial,allocations,audits}),calls=sourceCalls;sourceUnavailable=true;await request();assert.equal(JSON.stringify({financial,allocations,audits}),existing);assert.equal(sourceCalls,calls,"durable retry precedes mutable source reads and new capacity checks");sourceUnavailable=false;
await assert.rejects(()=>request({amount:"30.00"}),(e:any)=>e.status===409);
const initial={id:91,sourceType:"vehicle_partnership_settlement",sourceId:"101"};
await assert.rejects(()=>api.prepareAdvancePaymentExecution(db,initial,actor),(e:any)=>e.status===403);
const plan=await api.prepareAdvancePaymentExecution(db,initial,admin);assert.equal(plan.alreadyExecuted,false);assert.equal(plan.amount,"40.00");assert.equal(plan.counterCode,"VP-ADVANCE");assert.equal(financial.approval_status,"pending");
allocations[1].amount="40.01";await assert.rejects(()=>api.prepareAdvancePaymentExecution(db,initial,admin),(e:any)=>e.status===409);allocations[1].amount="40.00";
financial.approval_status="executed";financial.balance_before="100.00";financial.balance_after="60.00";await api.finishAdvancePaymentExecution(db,plan,admin);assert.equal(state(101).approvedPaidAmount,"40.00");assert.equal(header.status,"approved");assert.equal((await api.prepareAdvancePaymentExecution(db,initial,admin)).alreadyExecuted,true);
const finishedCount=audits.length;await api.finishAdvancePaymentExecution(db,plan,admin);assert.equal(audits.length,finishedCount,"finalization retries must not duplicate execution audit or monthly transitions");
await assert.rejects(()=>api.finishAdvancePaymentExecution(db,{...plan,amount:"40.01"},admin),(e:any)=>e.status===409,"the finalizer must not accept a different amount from a caller");
financial.balance_after="59.99";await assert.rejects(()=>api.prepareAdvancePaymentExecution(db,initial,admin),(e:any)=>e.status===409);financial.balance_after="60.00";
reset();await request();await db.transaction(tx=>api.rejectAdvancePaymentFinancialTransaction(tx,initial,admin,"رفض طلب الحصة"));assert.equal(financial.approval_status,"rejected");assert.equal(state(101).reservedAmount,"0.00");assert.equal(state(51).conversionCashReservedAmount,"0.00");const auditCount=audits.length;await api.rejectAdvancePaymentFinancialTransaction(db,initial,admin,"رفض طلب الحصة");assert.equal(audits.length,auditCount);
reset();await request({amount:"100.00"});financial.approval_status="executed";financial.balance_before="120.00";financial.balance_after="20.00";const full=await api.prepareAdvancePaymentExecution(db,initial,admin);await api.finishAdvancePaymentExecution(db,full,admin);assert.equal(header.status,"approved");
reset();priorPaid=4000n;await assert.rejects(()=>request({amount:"60.01"}),(e:any)=>e.status===409||e.status===422);assert.equal(financial,null);
await request({amount:"60.00"});assert.equal(state(101).approvedPaidAmount,"40.00");assert.equal(state(101).reservedAmount,"60.00");assert.equal(allocations[1].amount,"60.00");const remainder=await api.prepareAdvancePaymentExecution(db,initial,admin);financial.approval_status="executed";financial.balance_before="75.00";financial.balance_after="15.00";await api.finishAdvancePaymentExecution(db,remainder,admin);assert.equal(state(101).approvedPaidAmount,"100.00");assert.equal(header.status,"approved","advance repayment never changes monthly profit-distribution status");
reset();priorPaid=4000n;priorReserved=3000n;await assert.rejects(()=>request({amount:"30.01"}),(e:any)=>e.status===409||e.status===422);assert.equal(financial,null);await request({amount:"20.00"});assert.equal(state(101).reservedAmount,"50.00");assert.equal((await api.prepareAdvancePaymentExecution(db,initial,admin)).amount,"20.00","approval adds back only its proven own hold, preserving another pending request");

// Frozen original month is mandatory: pre-close reimbursements cannot consume
// a future gross conversion, even when the underlying advance is approved.
for(const status of ["draft","review","pending"]){reset();header.status=status;await assert.rejects(()=>request(),(e:any)=>e.status===409);assert.equal(financial,null);}
reset();monthRows=[];await assert.rejects(()=>request(),(e:any)=>e.status===409);assert.equal(financial,null);
reset();monthRows.push({...monthRows[0]});await assert.rejects(()=>request(),(e:any)=>e.status===409);
reset();await assert.rejects(()=>request({transactionDate:"2025-08-30"}),(e:any)=>e.status===409);
for(const update of [
 (s:any)=>{s.sourceSnapshots=[];},
 (s:any)=>{s.sourceSnapshots.push(structuredClone(s.sourceSnapshots[0]));},
 (s:any)=>{s.sourceSnapshots[0].snapshot.costFundingId=32;},
 (s:any)=>{s.sourceSnapshots[0].snapshot.expenseId=22;},
 (s:any)=>{s.sourceSnapshots[0].snapshot.sourceDigest="c".repeat(64);},
 (s:any)=>{s.sourceSnapshots[0].snapshot.sourceSnapshot.amount="101.00";},
 (s:any)=>{s.sourceSnapshots[0].snapshot.financial.id=72;},
 (s:any)=>{s.sourceSnapshots[0].snapshot.financial.status="pending";},
 (s:any)=>{s.sourceSnapshots[0].snapshot.financial.amount="99.00";},
 (s:any)=>{s.sourceSnapshots[0].snapshot.financial.date="2025-08-21";},
 (s:any)=>{s.sourceSnapshots[0].snapshot.financial.type="vp_partner_capital_advance";},
 (s:any)=>{s.sourceSnapshots[0].snapshot.sourceStatus="reversed";},
]){reset();update(snapshot);await assert.rejects(()=>request(),(e:any)=>e.status===409);assert.equal(financial,null);assert.equal(allocations.length,0);}
for(const [key,value] of Object.entries({id:82,source_type:"vehicle_expense",source_id:"6",source_event:"other",direction:"revenue",amount:"101.00",approval_status:"pending",reversal_txn_id:82,reversed_transaction_id:80,reversed_at:"2025-09-01",reversed_amount:"1.00",balance_before:"0.00",balance_after:"0.00",transaction_date:"2025-08-30"})){reset();originFinancial[key]=value;await assert.rejects(()=>request(),(e:any)=>e.status===409);assert.equal(financial,null);}
// Capital advances still require their exact frozen source. A genuinely empty
// noncash journal supplies no conversion budget; no ledger or cash is invented.
reset();costClass="capital";snapshot.sourceSnapshots[0].snapshot.financial.type="vp_partner_capital_advance";header.financial_transaction_id=null;sourceJournal={amount:"0.00",transactionType:"vp_month_profit",legs:[]};zeroApproved=false;await assert.rejects(()=>request(),(e:any)=>e.status===409);assert.equal(financial,null);zeroApproved=true;
reset();costClass="capital";snapshot.sourceSnapshots[0].snapshot.financial.type="vp_partner_capital_advance";await request();assert.equal(allocations.length,2);
reset();costClass="capital";snapshot.sourceSnapshots[0].snapshot.financial.type="vp_partner_capital_advance";header.financial_transaction_id=null;sourceJournal={amount:"0.00",transactionType:"vp_month_profit",legs:[]};await request();assert.equal(allocations.length,1);assert.equal(queries.some(q=>q.includes("vp_advance_payment_budget")),false);assert.equal(allocations[0].purpose,"advance_reimbursement");
reset();header.financial_transaction_id=null;await assert.rejects(()=>request(),(e:any)=>e.status===409);
// Exact own pending hold only, no hidden second cash writer or approval bypass.
reset();await request();pendingJournal=true;await assert.rejects(()=>api.prepareAdvancePaymentExecution(db,initial,admin),(e:any)=>e.status===409);await assert.rejects(()=>api.rejectAdvancePaymentFinancialTransaction(db,initial,admin,"رفض السلفة"),(e:any)=>e.status===409);assert.equal(financial.approval_status,"pending");
reset();await request();sourceUnavailable=true;await api.rejectAdvancePaymentFinancialTransaction(db,initial,actor,"إلغاء طلب السلفة","cancel");assert.equal(financial.approval_status,"rejected");await request();assert.equal(allocations.length,2,"cancelled request retry is historical and never restores holds");
reset();failQuery="vp_advance_payment_month";await assert.rejects(()=>request(),/SQL unavailable/);assert.equal(financial,null);
reset();await request();const beforeReject=JSON.stringify({financial,allocations,audits});failAudit=true;await assert.rejects(()=>db.transaction(tx=>api.rejectAdvancePaymentFinancialTransaction(tx,initial,admin,"رفض طلب السلفة")),/audit unavailable/);assert.equal(JSON.stringify({financial,allocations,audits}),beforeReject,"late reject audit failure restores pending FI and reservations");
reset();await request();audits[0].new_values.sourceSnapshot.command.amount="41.00";await assert.rejects(()=>api.prepareAdvancePaymentExecution(db,initial,admin),(e:any)=>e.status===409);
reset();await request();allocations.push({...allocations[0],id:999});await assert.rejects(()=>api.prepareAdvancePaymentExecution(db,initial,admin),(e:any)=>e.status===409);
assert.equal(cashWrites,0,"source module prepares and reconciles; only original central MASTER executor may post cash");
console.log("PASS source-owned partial advance reimbursement: approved frozen source, immutable proposal, all-or-nothing reservations/audit, exact retries, own holds only, matching coverage, principal execution/rejection and unchanged monthly profit status (controlled SQL; no live PostgreSQL).");
