import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {calculatePartnershipClosing,type ClosingMathInput,type ClosingSource} from "../src/lib/vehicle-partnership/closing";
import type {ClosingSnapshot} from "../src/server/vehicle-partnership/closing";

assert.ok(existsSync("src/server/vehicle-partnership/closing-journal.ts"),"the monthly source needs its own balanced journal builder, not the catalog's generic two-leg posting");
const {buildClosingJournal}=await import("../src/server/vehicle-partnership/closing-journal");
const terms=[{id:3,effectiveFrom:"2026-09-01",members:[{id:11,partyKey:"customer:1",profitBasisPoints:5000,expenseBasisPoints:5000},{id:12,partyKey:"supplier:2",profitBasisPoints:5000,expenseBasisPoints:5000}]}];
const input:ClosingMathInput={from:"2026-09-01",to:"2026-09-30",terms,sources:[],lossClaims:[],openingBalanceVerified:true,policy:{depreciation:{kind:"none"},reserve:{kind:"none"},resultAllocation:null,sharedCostBasis:null}};
const source=(key:string,kind:ClosingSource["kind"],amount:string):ClosingSource=>({key,kind,amount,date:input.to,basisDate:input.to,agreementId:3,approved:true,shared:false});
function snapshot(change:Partial<ClosingMathInput>={}):ClosingSnapshot{
 const data={...input,...change};
 return {formatVersion:1,vehicleId:12,partnershipId:1,setupVersion:2,from:data.from,to:data.to,policy:{...data.policy,accountingMethod:"activity_clearing"},agreements:data.terms.map(term=>({id:term.id,revision:1,effectiveFrom:term.effectiveFrom,status:"approved",policy:{},notes:null,members:term.members.map(member=>({...member,party:{kind:member.partyKey.split(":")[0],id:Number(member.partyKey.split(":")[1])},ownershipBasisPoints:5000,capitalContribution:"10000000.00"}))})),sourceSnapshots:[],lossClaims:[...data.lossClaims],previousClosing:null,calculation:calculatePartnershipClosing(data)} as unknown as ClosingSnapshot;
}
const clone=<T>(value:T):T=>structuredClone(value);
function balanced(plan:ReturnType<typeof buildClosingJournal>){
 const sum=(side:string)=>plan.legs.filter(leg=>leg.direction===side).reduce((total,leg)=>total+BigInt(leg.amount.replace(".","")),0n);
 assert.equal(sum("debit"),sum("credit"));assert.equal(sum("debit"),BigInt(plan.amount.replace(".","")));
 assert.ok(plan.legs.every(leg=>Number(leg.amount)>0&&!/(cash|1000)/i.test(leg.accountCode)),"closing never posts MASTER/cash or zero placeholder legs");
}
const ordinary=snapshot({sources:[source("g","internal","2000000.00"),source("e","external","500000.00"),source("c","operating","1200000.00")]});
let result=buildClosingJournal(ordinary);balanced(result);assert.equal(result.amount,"2500000.00");assert.equal(result.transactionType,"vp_month_profit");
assert.deepEqual(result.legs,[{accountCode:"VP-PAYABLE",direction:"debit",amount:"2000000.00"},{accountCode:"VP-RESULT",direction:"debit",amount:"500000.00"},{accountCode:"VP-COST-CLEAR",direction:"credit",amount:"1200000.00"},{accountCode:"VP-PROFIT",direction:"credit",amount:"1300000.00"}]);
assert.deepEqual(ordinary.calculation.profitAllocations.map(a=>a.amount),["650000.00","650000.00"]);
const reserved=snapshot({sources:input.sources.concat([source("g","internal","2000000.00"),source("e","external","500000.00"),source("c","operating","1200000.00")]),policy:{...input.policy,reserve:{kind:"percent",basis:"after_loss_recovery",basisPoints:1000}}});
result=buildClosingJournal(reserved);balanced(result);assert.ok(result.legs.some(leg=>leg.accountCode==="VP-RESERVE"&&leg.amount==="130000.00"));assert.ok(result.legs.some(leg=>leg.accountCode==="VP-PROFIT"&&leg.amount==="1170000.00"));
const loss=snapshot({sources:[source("g","internal","100000.00"),source("c","operating","150000.00")]});
result=buildClosingJournal(loss);balanced(result);assert.equal(result.transactionType,"vp_month_loss");assert.equal(result.amount,"150000.00");assert.ok(result.legs.some(leg=>leg.accountCode==="VP-LOSS"&&leg.direction==="debit"&&leg.amount==="50000.00"));assert.ok(!result.legs.some(leg=>leg.accountCode==="VP-PROFIT"));
const recovered=snapshot({sources:[source("g","internal","150000.00")],lossClaims:terms[0].members.map((m,i)=>({key:`right:${100+i}`,category:"loss",period:"2026-08-01",agreementId:3,memberId:m.id,partyKey:m.partyKey,remaining:"50000.00"}))});
result=buildClosingJournal(recovered);balanced(result);assert.ok(result.legs.some(leg=>leg.accountCode==="VP-LOSS"&&leg.direction==="credit"&&leg.amount==="100000.00"));assert.ok(result.legs.some(leg=>leg.accountCode==="VP-PROFIT"&&leg.amount==="50000.00"));
for(const kind of ["internal_reversal","external_reversal"] as const){
 result=buildClosingJournal(snapshot({sources:[source("refund",kind,"100000.00")]}));balanced(result);assert.equal(result.transactionType,"vp_month_loss");assert.ok(result.legs.some(leg=>leg.direction==="credit"&&leg.accountCode===(kind==="internal_reversal"?"VP-PAYABLE":"VP-RESULT")&&leg.amount==="100000.00"));
}
result=buildClosingJournal(snapshot({sources:[source("e","external","100000.00"),source("refund","cost_recovery","50000.00")]}));balanced(result);assert.equal(result.amount,"150000.00");assert.ok(result.legs.some(leg=>leg.direction==="debit"&&leg.accountCode==="VP-COST-CLEAR"&&leg.amount==="50000.00"));
result=buildClosingJournal(snapshot());assert.deepEqual(result,{legs:[],amount:"0.00",transactionType:"vp_month_profit"},"a genuine zero close has no fake paid amount or ledger movement");
result=buildClosingJournal(snapshot({sources:[source("cent","internal","0.01")]}));balanced(result);assert.equal(result.amount,"0.01");
const dated=[terms[0],{id:4,effectiveFrom:"2026-09-16",members:[{id:21,partyKey:"customer:1",profitBasisPoints:7000,expenseBasisPoints:5000},{id:22,partyKey:"supplier:2",profitBasisPoints:3000,expenseBasisPoints:5000}]}];
const datedSnapshot=snapshot({terms:dated,sources:[{...source("old","internal","100000.00"),date:"2026-09-10",basisDate:"2026-09-10"},{...source("new","internal","200000.00"),agreementId:4}],policy:{...input.policy,resultAllocation:"dated_results"}});
result=buildClosingJournal(datedSnapshot);balanced(result);assert.equal(result.amount,"300000.00");assert.deepEqual(datedSnapshot.calculation.profitAllocations.map(a=>a.amount),["50000.00","50000.00","140000.00","60000.00"],"dated original agreements retain their exact allocation, not an arbitrary current 50/50 override");
const large=snapshot({sources:[source("g","internal","99999999999999.99"),source("e","external","99999999999999.99"),source("c","operating","99999999999999.99")]});
assert.throws(()=>buildClosingJournal(large),error=>(error as {status?:number}).status===422,"journal nominal amount cannot overflow the existing numeric financial column");
for(const mutate of [
 (s:ClosingSnapshot)=>{s.policy.accountingMethod=null;},
 (s:ClosingSnapshot)=>{s.calculation.summary.complete=false;},
 (s:ClosingSnapshot)=>{s.calculation.summary.blockers=["غير مكتمل"];},
 (s:ClosingSnapshot)=>{s.calculation.summary.result="1300000.01";},
 (s:ClosingSnapshot)=>{s.calculation.summary.maxDistributable="1300000.01";},
 (s:ClosingSnapshot)=>{s.calculation.profitAllocations[0].amount="900000.00";s.calculation.profitAllocations[1].amount="400000.00";},
 (s:ClosingSnapshot)=>{s.calculation.profitAllocations[0].memberId=999;},
 (s:ClosingSnapshot)=>{s.calculation.profitAllocations.push(s.calculation.profitAllocations[0]);},
 (s:ClosingSnapshot)=>{s.calculation.summary.proposedProfitShares![0].amount="1.00";},
 (s:ClosingSnapshot)=>{s.calculation.summary.reserve="-0.00";},
 (s:ClosingSnapshot)=>{s.calculation.segments[0].result="1300000.01";},
 (s:ClosingSnapshot)=>{s.agreements[0].status="pending";},
 (s:ClosingSnapshot)=>{s.calculation.digest="bad";},
 (s:ClosingSnapshot)=>{s.policy.reserve={kind:"percent",basis:"recognized_income",basisPoints:1000};},
]){const invalid=clone(ordinary);mutate(invalid);assert.throws(()=>buildClosingJournal(invalid),error=>(error as {status?:number}).status===422,"tampered/incomplete reviewed snapshot must fail closed");}
const badRecovery=clone(recovered);badRecovery.calculation.lossRecoveries[0].lossKey="right:999";assert.throws(()=>buildClosingJournal(badRecovery),/الإغلاق|التوزيع|الخسار/);
const badLoss=clone(loss);badLoss.calculation.lossAllocations[0].amount="1.00";assert.throws(()=>buildClosingJournal(badLoss),/الإغلاق|التوزيع|الخسار/);
console.log("PASS monthly closing journal: exact original-party allocations, balanced signed income/cost/refund legs, reserve/loss/recovery, no-cash zero close and tamper refusal.");
