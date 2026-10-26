import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {calculatePartnershipCashPosting} from "../src/lib/vehicle-partnership/cash";
import {PartnershipRepositoryError} from "../src/server/vehicle-partnership/repository";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
const path="src/server/master-cash-box.ts",tree=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="executePendingFinancialTransaction")!;
const code=ts.transpileModule(node.getText(tree)+"\nexecutePendingFinancialTransaction",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
class FinancialApprovalError extends Error{constructor(message:string,public status=409){super(message);}}
let financial:any,cash:any,ledger:any[],audits:any[],preflights=0,finishes=0,failProof=false,failAudit=false,cashLocks=0,staleFirstRead=false;
function reset(){financial={id:91,sourceType:"vehicle_partnership_settlement",sourceId:"101",sourceEvent:"distribution",transactionType:"vp_partner_distribution",transactionDate:"2026-10-26",direction:"expense",amount:"90071992547409.91",approvalStatus:"pending",description:"حصة معتمدة"};cash={id:1,current_balance:"90071992547409.92",total_revenue:"12345.67",total_expenses:"11111.11",net_profit:"17.23",version:4};ledger=[];audits=[];preflights=0;finishes=0;failProof=false;failAudit=false;cashLocks=0;}reset();
const dialect=new PgDialect(),tables={financial:{id:"financial.id",approvalStatus:"financial.approvalStatus"},accounts:{code:"account.code"},cash:{id:"cash.id"},ledger:{},audit:{}};
function selection(table:any){let predicate:any;const rows=()=>{if(table===tables.financial){const row=structuredClone(financial);if(staleFirstRead){row.approvalStatus="pending";staleFirstRead=false;}return [row];}return [{id:predicate?.value==="1000"?1:2,code:predicate?.value,accountType:predicate?.value==="1000"?"asset":"liability",isActive:true}];};const result={then:(resolve:any,reject:any)=>Promise.resolve(rows()).then(resolve,reject),for:async()=>rows()};return {where:(p:any)=>{predicate=p;return {limit:()=>result};}};}
const tx={select:()=>({from:selection}),update:(table:any)=>({set:(values:any)=>({where:()=>{
 if(table===tables.financial){financial={...financial,...values};return {returning:async()=>[structuredClone(financial)]};}
 if(table===tables.cash){cash={...cash,current_balance:values.currentBalance,available_balance:values.availableBalance,total_revenue:values.totalRevenue,total_expenses:values.totalExpenses,net_profit:values.netProfit,version:values.version};return Promise.resolve();}throw Error("unexpected table update");
}})}),insert:(table:any)=>({values:(values:any)=>{if(table===tables.ledger){ledger.push(...structuredClone(values));return {onConflictDoNothing:async()=>{}};}if(table===tables.audit){if(failAudit)throw Error("central audit unavailable");audits.push(...structuredClone(values));return Promise.resolve();}throw Error("unexpected table insert");}}),execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement);if(q.sql.includes("FROM master_cash_box")){cashLocks++;return {rows:[structuredClone(cash)]};}throw Error("unexpected central SQL "+q.sql);}};
const run=vm.runInNewContext(code,{sql,PartnershipRepositoryError,PartnershipValidationError,FinancialApprovalError,calculatePartnershipCashPosting,financialTransactionsTable:tables.financial,financialAccountsTable:tables.accounts,masterCashBoxTable:tables.cash,financialLedgerEntriesTable:tables.ledger,financialAuditLogsTable:tables.audit,eq:(column:any,value:any)=>({column,value}),and:(...parts:any[])=>parts,
 prepareDistributionExecution:async(_tx:any,_initial:any,actor:any)=>{preflights++;if(actor.role!=="admin")throw new PartnershipRepositoryError("principal only",403,"FORBIDDEN");if(failProof)throw new PartnershipRepositoryError("missing source proof",409,"CONFLICT");return {alreadyExecuted:financial.approvalStatus==="executed",amount:financial.amount,counterCode:"VP-PROFIT",financialId:91};},
 finishDistributionExecution:async()=>{assert.equal(financial.approvalStatus,"executed");assert.equal(financial.balanceBefore,"90071992547409.92");assert.equal(financial.balanceAfter,"0.01");assert.equal(cash.current_balance,"0.01");assert.equal(ledger.length,2);finishes++;},
 executePartnershipFinancialTransaction:async()=>{throw new PartnershipRepositoryError("noncash source dispatcher",409,"CONFLICT");},
 lockGraduationPaymentSource:async()=>{throw Error("generic source path must not replace partnership source proof");},
 money:()=>{throw Error("partnership payout must never round through legacy floating point");},counterAccountCode:()=>{throw Error("profit payout must use trusted VP-PROFIT, never generic operating expense");},isBalanceSheetTransfer:()=>true,isPaymentStateSourceType:()=>false,
});
const actor={id:7,name:"مدير",role:"admin",permissions:[]};
async function atomic(user=actor){const before=structuredClone({financial,cash,ledger,audits,finishes});try{return await run(tx,91,user);}catch(error){({financial,cash,ledger,audits,finishes}=before);throw error;}}
await assert.rejects(()=>atomic({...actor,role:"employee"}),(e:any)=>e instanceof FinancialApprovalError&&e.status===403);assert.equal(cashLocks,0);
failProof=true;await assert.rejects(()=>atomic(),(e:any)=>e.status===409);assert.equal(cashLocks,0);failProof=false;
cash.current_balance="1.00";await assert.rejects(()=>atomic(),(e:any)=>e instanceof FinancialApprovalError&&e.status===409);assert.equal(financial.approvalStatus,"pending");assert.equal(ledger.length,0);cash.current_balance="90071992547409.92";
failAudit=true;await assert.rejects(()=>atomic(),/central audit unavailable/);assert.equal(financial.approvalStatus,"pending");assert.equal(cash.current_balance,"90071992547409.92");assert.equal(ledger.length,0);failAudit=false;
await atomic();assert.equal(financial.approvalStatus,"executed");assert.equal(cash.current_balance,"0.01");assert.equal(cash.total_revenue,"12345.67");assert.equal(cash.total_expenses,"11111.11");assert.equal(cash.net_profit,"17.23");assert.equal(ledger[0].amount,"90071992547409.91");assert.equal(ledger[0].accountId,2);assert.equal(ledger[0].entrySide,"debit");assert.equal(ledger[1].accountId,1);assert.equal(ledger[1].entrySide,"credit");assert.equal(audits[1].newValues.balance,"0.01");assert.equal(audits[1].newValues.debit,"90071992547409.91");assert.equal(finishes,1);
const executed=JSON.stringify({financial,cash,ledger,audits,finishes}),locks=cashLocks;await atomic();assert.equal(JSON.stringify({financial,cash,ledger,audits,finishes}),executed);assert.equal(cashLocks,locks,"verified executed retry does not lock or subtract MASTER again");
staleFirstRead=true;const concurrentReply=await atomic();assert.equal(concurrentReply.approvalStatus,"executed","after waiting for source locks the reply must use the fresh executed row, not its earlier pending snapshot");
reset();financial.sourceType="vehicle_partnership_unknown";await assert.rejects(()=>atomic(),(e:any)=>e.status===409);assert.equal(cashLocks,0);
console.log("PASS real central MASTER payout block: principal source preflight, exact large IQD/cents, one original cash update/journal, approved liability accounts, unchanged operating P&L, audit rollback, immutable execution retry and unsupported-source refusal (controlled transaction boundary).");
