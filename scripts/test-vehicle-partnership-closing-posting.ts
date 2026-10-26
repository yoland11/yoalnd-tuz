import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {parseMoney,formatMoney} from "../src/lib/vehicle-partnership/money";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
import {authorizePartnership,partnershipId} from "../src/server/vehicle-partnership/agreements";
import {partnershipRows,PartnershipRepositoryError,appendPartnershipAudit} from "../src/server/vehicle-partnership/repository";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
const file="src/server/vehicle-partnership/closing-posting.ts";
assert.ok(existsSync(file),"monthly financial approval must execute a source-specific balanced noncash journal");
const source=readFileSync(file,"utf8"),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,"")).join("\n");
const code=ts.transpileModule(body+"\n({executeClosingFinancialTransaction,rejectClosingFinancialTransaction})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const actor={id:7,name:"مدير",role:"admin",permissions:[],isActive:true};
const identity={id:91,sourceType:"vehicle_partnership_closing",sourceId:"5"};
let header:any={id:5,partnership_id:1,period:"2025-08-01",revision:1,version:3,status:"pending",financial_transaction_id:91,source_digest:"a".repeat(64),reason:"إغلاق الشهر"};
let financial:any={id:91,source_type:"vehicle_partnership_closing",source_id:"5",source_event:"monthly_result",transaction_type:"vp_month_profit",transaction_date:"2025-08-31",direction:"expense",amount:"100.00",approval_status:"pending",balance_before:null,balance_after:null,reversal_txn_id:null,reversed_transaction_id:null,idempotency_key:"vp:closing:5:r1"};
let ledger:any[]=[],audits=0,rightsCalls=0,reserveCalls=0,reconciled=0,failAudit=false,stale=false,flags:boolean[]=[],queries:string[]=[];
const plan={amount:"100.00",transactionType:"vp_month_profit",legs:[{accountCode:"VP-PAYABLE",direction:"debit",amount:"100.00"},{accountCode:"VP-PROFIT",direction:"credit",amount:"100.00"}]};
const accounts=new Map([["VP-PAYABLE",1],["VP-PROFIT",2]]),dialect=new PgDialect();
const execute=async(statement:any)=>{const q=dialect.sqlToQuery(statement),p=q.params as any[];queries.push(q.sql);
 if(q.sql.includes("vp_month_financial_lock"))return {rows:[structuredClone(financial)]};
 if(q.sql.includes("vp_month_journal_proof"))return {rows:structuredClone(ledger)};
 if(q.sql.includes("vp_month_journal_insert")){const item={id:ledger.length+1,account_id:p[1],entry_side:p[2],amount:p[3],code:[...accounts].find(([,id])=>id===p[1])?.[0]};ledger.push(item);return {rows:[item]};}
 if(q.sql.includes("vp_month_financial_executed")){financial.approval_status="executed";return {rows:[{id:91}]};}
 if(q.sql.includes("vp_month_source_approved")){header={...header,status:"approved",version:header.version+1,approved_by:7};return {rows:[structuredClone(header)]};}
 if(q.sql.includes("vp_month_financial_rejected")){financial.approval_status="rejected";return {rows:[{id:91}]};}
 if(q.sql.includes("vp_month_source_rejected")){header={...header,status:"draft",revision:header.revision+1,version:header.version+1,financial_transaction_id:null};return {rows:[structuredClone(header)]};}
 if(q.sql.startsWith("INSERT INTO financial_audit_logs")){if(failAudit)throw Error("audit unavailable");audits++;return {rows:[{id:audits}]};}
 throw Error("Unexpected monthly posting query "+q.sql);
};
const api=vm.runInNewContext(code,{sql,canonicalPartnershipJson,parseMoney,formatMoney,authorizePartnership,partnershipId,partnershipRows,PartnershipRepositoryError,PartnershipValidationError,appendPartnershipAudit,
 lockClosingContext:async()=>({root:{id:1,vehicleId:12},row:structuredClone(header)}),
 verifySubmittedClosing:async(_tx:any,_actor:any,_context:any,revalidate=true)=>{flags.push(revalidate);if(revalidate&&stale)throw new PartnershipRepositoryError("stale source",409,"CONFLICT");return {snapshot:{from:"2025-08-01",to:"2025-08-31"},journal:plan};},
 partnershipAccount:async(_tx:any,code:string)=>accounts.get(code),
 reserveClosingConversions:async()=>{reserveCalls++;return [51];},
 approveClosingRights:async(_tx:any,_actor:any,context:any)=>{assert.equal(financial.approval_status,"executed");assert.equal(context.row.status,"approved");rightsCalls++;return [101,102];},
 reconcileClosingAffected:async()=>{reconciled++;return [];},
});
async function run(work:()=>Promise<any>){const old=structuredClone({header,financial,ledger,audits,rightsCalls,reserveCalls,reconciled});try{return await work();}catch(error){({header,financial,ledger,audits,rightsCalls,reserveCalls,reconciled}=old);throw error;}}
const approve=()=>run(()=>api.executeClosingFinancialTransaction({execute},identity,actor));
await assert.rejects(()=>api.executeClosingFinancialTransaction({execute},identity,{...actor,role:"employee"}),(e:any)=>e.status===403);assert.equal(queries.length,0);
financial.amount="99.99";await assert.rejects(approve,(e:any)=>e.status===409);financial.amount="100.00";assert.equal(ledger.length,0);
stale=true;await assert.rejects(approve,(e:any)=>e.status===409);stale=false;
failAudit=true;await assert.rejects(approve,/audit unavailable/);assert.equal(financial.approval_status,"pending");assert.equal(header.status,"pending");assert.equal(ledger.length,0);assert.equal(rightsCalls,0);failAudit=false;
await approve();assert.equal(financial.approval_status,"executed");assert.equal(header.status,"approved");assert.equal(ledger.length,2);assert.equal(rightsCalls,1);assert.equal(reserveCalls,1);
await approve();assert.equal(ledger.length,2);assert.equal(audits,1);assert.equal(rightsCalls,2);assert.equal(flags.at(-1),false,"executed replay verifies frozen proof instead of recalculating edited current sources");
ledger[0].amount="100.01";await assert.rejects(approve,(e:any)=>e.status===409);ledger[0].amount="100.00";
financial.approval_status="pending";header.status="pending";ledger=[];
await run(()=>api.rejectClosingFinancialTransaction({execute},identity,actor,"رفض للمراجعة"));assert.equal(financial.approval_status,"rejected");assert.equal(header.status,"draft");assert.equal(header.revision,2);assert.equal(header.financial_transaction_id,null);assert.equal(reconciled,1);assert.equal(ledger.length,0);
await run(()=>api.rejectClosingFinancialTransaction({execute},identity,actor,"رفض للمراجعة"));assert.equal(header.revision,2,"rejection retry must not consume another revision");
assert.ok(!queries.some(q=>/master_cash_box|UPDATE (?:orders|kosha_bookings|payroll)|DELETE FROM/i.test(q)),"closing approval is noncash reclassification only");
const accountingSource=readFileSync("src/server/vehicle-partnership/accounting.ts","utf8"),postingSource=readFileSync("src/server/vehicle-partnership/posting.ts","utf8");
assert.match(accountingSource,/reference\.sourceType==="vehicle_partnership_closing"\)return prepareClosingFinancialRequest/,"real trusted writer must use the monthly source preparer");
assert.match(postingSource,/initial\.sourceType==="vehicle_partnership_closing"\)return executeClosingFinancialTransaction/,"real central partnership dispatcher must use monthly approval");
assert.match(postingSource,/initial\.sourceType==="vehicle_partnership_closing"\)return rejectClosingFinancialTransaction/,"real rejection/cancel path must release monthly holds");
const chartSource=readFileSync("src/server/vehicle-partnership/journal.ts","utf8"),chartTree=ts.createSourceFile("chart.ts",chartSource,ts.ScriptTarget.Latest,true);
const chartNodes=chartTree.statements.filter(n=>ts.isFunctionDeclaration(n)||ts.isVariableStatement(n));
const chartCode=ts.transpileModule(chartNodes.map(n=>n.getText(chartTree).replace(/^export\s+/,"")).join("\n")+"\npartnershipAccount;",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const actualAccount=vm.runInNewContext(chartCode,{sql,parseMoney,partnershipId,partnershipRows,PartnershipRepositoryError});
for(const [code,type] of [["VP-PROFIT","liability"],["VP-LOSS","asset"],["VP-RESERVE","equity"],["VP-RESULT","equity"],["VP-COST-CLEAR","equity"]])assert.equal(await actualAccount({execute:async(query:any)=>{assert.ok(dialect.sqlToQuery(query).params.includes(code));return {rows:[{id:31,code,account_type:type,is_active:true}]};}},code),31);
console.log("PASS real monthly source posting: principal approval, nominal/source checks, balanced legs, atomic audit rollback, immutable replay, canonical rights, rejection/revision history and no Cash Box mutation (controlled executor).");
