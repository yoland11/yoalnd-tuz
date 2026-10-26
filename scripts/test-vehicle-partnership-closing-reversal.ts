import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
import {parseMoney,formatMoney} from "../src/lib/vehicle-partnership/money";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {authorizePartnership,partnershipId} from "../src/server/vehicle-partnership/agreements";
import {partnershipRows,PartnershipRepositoryError,appendPartnershipAudit} from "../src/server/vehicle-partnership/repository";
const file="src/server/vehicle-partnership/closing-reversal.ts";
assert.ok(existsSync(file),"unused monthly reopening must reverse the original multi-leg journal and preserve its revision");
const tree=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
const declarations=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,""));
const postingTree=ts.createSourceFile("posting.ts",readFileSync("src/server/vehicle-partnership/closing-posting.ts","utf8"),ts.ScriptTarget.Latest,true);
const proof=postingTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="proveClosingJournal")!;
const code=ts.transpileModule(proof.getText(postingTree).replace(/^export\s+/,"")+"\n"+declarations.join("\n")+"\n({reverseClosingFinancialTransaction})",{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const hash=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
const actor={id:7,name:"المدير",role:"admin",permissions:[],isActive:true};
const identity={id:91,sourceType:"vehicle_partnership_closing",sourceId:"5"};
const snapshot={from:"2025-08-01",to:"2025-08-31",vehicleId:12,partnershipId:1};
const journal={amount:"120.00",transactionType:"vp_month_profit",legs:[{accountCode:"VP-PAYABLE",direction:"debit",amount:"100.00"},{accountCode:"VP-RESULT",direction:"debit",amount:"20.00"},{accountCode:"VP-COST-CLEAR",direction:"credit",amount:"40.00"},{accountCode:"VP-PROFIT",direction:"credit",amount:"80.00"}]};
let header:any,financial:any,reverse:any,rights:any[],ledger:any[],audit:any[],queries:string[],guardFailure=false,failAudit=false,reconciled=0,proofCalls=0;
const initialState=()=>{
 header={id:5,partnership_id:1,period:"2025-08-01",revision:1,version:4,status:"approved",financial_transaction_id:91,source_digest:hash(snapshot),approved_by:7,approved_at:"2026-10-26T00:00:00Z"};
 financial={id:91,source_type:identity.sourceType,source_id:"5",source_event:"monthly_result",transaction_type:"vp_month_profit",transaction_date:"2025-08-31",direction:"expense",amount:"120.00",approval_status:"executed",balance_before:null,balance_after:null,reversed_transaction_id:null,reversal_txn_id:null,reversed_at:null,idempotency_key:"vp:closing:5:r1",approved_by:7};
 reverse=null;rights=[{id:101,status:"approved"},{id:102,status:"approved"}];ledger=journal.legs.map((leg,index)=>({id:index+1,transaction_id:91,account_id:index+31,code:leg.accountCode,entry_side:leg.direction,amount:leg.amount}));
 audit=[{id:1,transaction_id:91,actor_id:7,action:"vehicle_partnership_closing_financial_approved",new_values:{closingId:5,revision:1,sourceDigest:hash(snapshot),amount:"120.00",status:"approved",partnershipId:1,vehicleId:12}}];queries=[];guardFailure=false;failAudit=false;reconciled=0;proofCalls=0;
};
initialState();const dialect=new PgDialect();
const execute=async(statement:any)=>{
 const q=dialect.sqlToQuery(statement),p=q.params as any[];queries.push(q.sql);
 if(q.sql.includes("vp_month_reverse_financial"))return {rows:[structuredClone(financial)]};
 if(q.sql.includes("vp_month_reverse_summary"))return {rows:[{amount:journal.amount,snapshot:{snapshot,journal}}]};
 if(q.sql.includes("vp_month_reverse_approval"))return {rows:structuredClone(audit.filter(a=>a.action==="vehicle_partnership_closing_financial_approved"))};
 if(q.sql.includes("vp_month_reverse_prior"))return {rows:reverse?[structuredClone(reverse)]:[]};
 if(q.sql.includes("vp_month_reverse_operation"))return {rows:structuredClone(audit.filter(a=>a.action==="vehicle_partnership_closing_reopened"))};
 if(q.sql.includes("vp_month_journal_proof"))return {rows:structuredClone(ledger.filter(l=>l.transaction_id===p[0]))};
 if(q.sql.includes("vp_month_reverse_key"))return {rows:[]};
 if(q.sql.includes("vp_month_reverse_insert")){
  reverse={id:92,source_type:p[4],source_id:p[5],source_event:"reversal",transaction_type:p[3],direction:p[1],amount:p[2],approval_status:"executed",reversed_transaction_id:p[7],idempotency_key:p[6],balance_before:null,balance_after:null};return {rows:[{id:92}]};
 }
 if(q.sql.includes("vp_month_reverse_number"))return {rows:[{id:92}]};
 if(q.sql.includes("vp_month_reverse_leg")){const original=ledger.find(l=>l.account_id===p[1]&&l.transaction_id===91)!;ledger.push({id:ledger.length+1,transaction_id:p[0],account_id:p[1],code:original.code,entry_side:p[2],amount:p[3]});return {rows:[{id:ledger.length}]};}
 if(q.sql.includes("vp_month_reverse_original")){financial={...financial,reversal_txn_id:92,reversed_at:"2026-10-26T01:00:00Z"};return {rows:[{id:91}]};}
 if(q.sql.includes("vp_month_reverse_rights")){rights=rights.map(r=>({...r,status:"reversed"}));return {rows:rights.map(r=>({id:r.id}))};}
 if(q.sql.includes("vp_month_reverse_header")){header={...header,status:"draft",revision:header.revision+1,version:header.version+1,financial_transaction_id:null,approved_by:null,approved_at:null};return {rows:[{id:5}]};}
 if(q.sql.startsWith("INSERT INTO financial_audit_logs")){if(failAudit)throw Error("audit unavailable");audit.push({id:audit.length+1,transaction_id:p[0],action:p[1],actor_id:p[2],new_values:JSON.parse(p[5]),reason:p[6]});return {rows:[{id:audit.length}]};}
 throw Error("Unexpected closing reversal query "+q.sql);
};
const api=vm.runInNewContext(code,{sql,createHash,randomUUID,canonicalPartnershipJson,parseMoney,formatMoney,PartnershipValidationError,PartnershipRepositoryError,authorizePartnership,partnershipId,partnershipRows,appendPartnershipAudit,
 lockClosingContext:async()=>({root:{id:1,vehicleId:12},row:structuredClone(header)}),
 verifySubmittedClosing:async(_tx:any,_actor:any,context:any,revalidate:boolean)=>{proofCalls++;assert.equal(revalidate,false);assert.equal(context.row.revision,1,"retry verifies original immutable revision even after a new approval");assert.equal(context.row.source_digest,hash(snapshot));return {snapshot,journal};},
 assertClosingUnused:async()=>{if(guardFailure)throw new PartnershipRepositoryError("used closing",409,"CONFLICT");return rights.filter(r=>r.status==="approved").map(r=>r.id);},
 proveClosingRevisionRights:async(_tx:any,_context:any,status:string)=>{assert.ok(rights.every(r=>r.status===status));return rights.map(r=>r.id);},
 reconcileClosingAffected:async()=>{assert.equal(financial.reversal_txn_id,92);if(reconciled===0)assert.equal(header.status,"draft");assert.ok(rights.every(r=>r.status==="reversed"));reconciled++;return [51,101,102];},
});
const options={idempotencyKey:"month-reopen-91",expectedVersion:4,expectedDigest:hash(snapshot)};
const run=async(changes:any={},user=actor)=>{const before=structuredClone({header,financial,reverse,rights,ledger,audit,reconciled});try{return await api.reverseClosingFinancialTransaction({execute},identity,user,"تصحيح الشهر",{...options,...changes},(id:number)=>`FIN-${id}`);}catch(error){({header,financial,reverse,rights,ledger,audit,reconciled}=before);throw error;}};
await assert.rejects(()=>run({}, {...actor,role:"employee",permissions:["accounting"]}),(e:any)=>e.status===403);assert.equal(queries.length,0);
await assert.rejects(()=>run({sourceType:"vehicle_expense"}),(e:any)=>e.status===409);
await assert.rejects(()=>run({amount:119.99}),(e:any)=>e.status===409);
await assert.rejects(()=>run({expectedVersion:3}),(e:any)=>e.status===409);
await assert.rejects(()=>run({expectedDigest:"b".repeat(64)}),(e:any)=>e.status===409);
guardFailure=true;await assert.rejects(()=>run(),(e:any)=>e.status===409);assert.equal(reverse,null);guardFailure=false;
failAudit=true;await assert.rejects(()=>run(),/audit unavailable/);assert.equal(header.status,"approved");assert.equal(rights[0].status,"approved");assert.equal(ledger.length,4);assert.equal(reverse,null);failAudit=false;
const reopened=await run();assert.equal(reopened.reverseId,92);assert.equal(reopened.alreadyReversed,false);assert.equal(header.revision,2);assert.equal(header.version,5);assert.equal(header.financial_transaction_id,null);assert.equal(header.approved_by,null);assert.equal(ledger.length,8);assert.equal(reconciled,1);assert.equal(financial.approval_status,"executed","original remains immutable executed history with explicit reversal reference");
const beforeRetry=JSON.stringify({header,financial,rights,ledger,audit});await run();assert.equal(JSON.stringify({header,financial,rights,ledger,audit}),beforeRetry,"retry must create no duplicate journal, revision or audit");
// A new approved revision must not prevent an old exact command retry or get reversed by it.
header={...header,status:"approved",revision:2,version:9,source_digest:"c".repeat(64),financial_transaction_id:95};
const current=JSON.stringify(header);await run();assert.equal(JSON.stringify(header),current);
await assert.rejects(()=>run({idempotencyKey:"different-reopen-key"}),(e:any)=>e.status===409);
ledger.find(l=>l.transaction_id===92).amount="99.00";await assert.rejects(()=>run(),(e:any)=>e.status===409);
assert.ok(!queries.some(q=>/master_cash_box|DELETE FROM|UPDATE (?:kosha_bookings|vehicle_expenses|vehicle_partnership_activity)/i.test(q)),"reopening never edits original trips/costs or Cash Box");
const dispatcher=readFileSync("src/server/vehicle-partnership/posting.ts","utf8"),dispatcherTree=ts.createSourceFile("dispatcher.ts",dispatcher,ts.ScriptTarget.Latest,true);
const reversal=dispatcherTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="reversePartnershipFinancialTransaction")!.getText(dispatcherTree);
assert.ok(reversal.indexOf('initial.sourceType==="vehicle_partnership_closing"')<reversal.indexOf("activityIdFor(initial)"),"monthly reversal must dispatch before original activity-only guard");
assert.match(dispatcher,/l\.revision=h\.revision/ ,"only the active approved revision may lock an original source after reopening");
console.log("PASS real monthly reversal: principal-only, full amount/version/digest, exact frozen revision, opposite multi-leg journal, unused guard, atomic audit rollback, immutable retries after new revision, canonical release and no cash (controlled SQL boundary; not live PostgreSQL).");
