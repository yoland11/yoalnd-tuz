import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {authorizePartnership} from "../src/server/vehicle-partnership/agreements";
import {appendPartnershipAudit,partnershipRows,PartnershipRepositoryError} from "../src/server/vehicle-partnership/repository";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {parseMoney} from "../src/lib/vehicle-partnership/money";
const file=readFileSync("src/server/master-cash-box.ts","utf8"),tree=ts.createSourceFile("finance.ts",file,ts.ScriptTarget.Latest,true);
const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createPartnershipSourceFinancialRequest");assert.ok(node,"trusted source request must reuse the CENTRAL financial request module");
const dialect=new PgDialect(),calls:Array<{sql:string;params:any[]}>=[];let stored:any=null,audits=0,prepared=0,failAudit=false;
const descriptor={sourceType:"vehicle_partnership_activity",sourceId:1,sourceEvent:"internal_entitlement",transactionType:"vp_internal_entitlement",direction:"expense",amount:"30000.00",transactionDate:"2026-10-20",department:"transportation",description:"استحقاق نقل حقيقي",referenceNo:"VP-ACT-1",idempotencyKey:"vp:activity:1:r1",partnershipId:1,vehicleId:12,sourceDigest:"a".repeat(64),linkedFinancialTransactionId:null};
const tx={execute:async(statement:any)=>{const q=dialect.sqlToQuery(statement);calls.push(q);const p=q.params;
 if(q.sql.includes("vp_financial_request_replay"))return {rows:stored?[stored]:[]};
 if(q.sql.includes("INSERT INTO financial_transactions")){stored={id:91,transaction_no:p[0],transaction_date:p[1],direction:p[2],amount:p[3],department:p[4],transaction_type:p[5],reference_no:p[6],description:p[7],source_type:p[8],source_id:p[9],source_event:p[10],idempotency_key:p[11],approval_status:"pending"};return {rows:[stored]};}
 if(q.sql.includes("UPDATE financial_transactions")){stored.transaction_no=p[0];return {rows:[stored]};}
 if(q.sql.includes("financial_audit_logs")){if(failAudit)throw Error("financial audit failed");audits++;return {rows:[{id:audits}]};}
 throw Error(`unexpected central request query ${q.sql}`);
}};
const context={sql,partnershipRows,appendPartnershipAudit,authorizePartnership,PartnershipRepositoryError,PartnershipValidationError,parseMoney,randomUUID:()=>"uuid",transactionNumber:(id:number)=>`FIN-${id}`,preparePartnershipFinancialRequest:async(executor:any,ref:any,actor:any)=>{assert.equal(executor,tx);assert.equal(actor.isActive,true);assert.equal(ref.sourceId,1);prepared++;return {...descriptor,linkedFinancialTransactionId:stored?.id??null};}};
const create=vm.runInNewContext(ts.transpileModule(node.getText(tree).replace(/^export\s+/,""),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+"\ncreatePartnershipSourceFinancialRequest",context);
const actor={id:7,name:"مدير",role:"admin",permissions:[]};
await assert.rejects(()=>create(tx,{sourceType:"vehicle_partnership_activity",sourceId:1},{...actor,role:"employee"}),(e:any)=>e.status===403);assert.equal(prepared,0);assert.equal(calls.length,0);
let result=await create(tx,{sourceType:"vehicle_partnership_activity",sourceId:1,amount:"1",cashImpact:"out"},actor);assert.equal(result.id,91);assert.equal(result.approvalStatus,"pending");assert.equal(stored.amount,"30000.00","source amount wins; extra reference-body flags have no financial effect");assert.equal(audits,1);
result=await create(tx,{sourceType:"vehicle_partnership_activity",sourceId:1},actor);assert.equal(result.id,91);assert.equal(audits,1,"durable retry creates no request/audit duplicate");
stored.amount="1.00";await assert.rejects(()=>create(tx,{sourceType:"vehicle_partnership_activity",sourceId:1},actor),(e:any)=>e.status===409);stored.amount="30000.00";
stored.approval_status="rejected";await assert.rejects(()=>create(tx,{sourceType:"vehicle_partnership_activity",sourceId:1},actor),(e:any)=>e.status===409);stored=null;
failAudit=true;await assert.rejects(()=>create(tx,{sourceType:"vehicle_partnership_activity",sourceId:1},actor),/financial audit failed/);failAudit=false;
assert.ok(calls.every(q=>!/master_cash_box|financial_ledger_entries|UPDATE (kosha_bookings|service_orders)/.test(q.sql)),"pending request does not touch cash, journals or original booking money");
console.log("PASS real central trusted request writer: existing financial table/numbering/audit, server-derived amount, pending only, source-owned durable idempotency and no cash/journal/original price mutation.");
