import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {canonicalPartnershipJson} from "../src/lib/vehicle-partnership/canonical";
import {parseMoney} from "../src/lib/vehicle-partnership/money";
import {authorizePartnership,partnershipId} from "../src/server/vehicle-partnership/agreements";
import {partnershipRows,PartnershipRepositoryError} from "../src/server/vehicle-partnership/repository";

const file="src/server/vehicle-partnership/closing-unused.ts";
assert.ok(existsSync(file),"approved monthly reversal needs a strict read-only unused-right guard");
const source=readFileSync(file,"utf8"),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,"")).join("\n");
const code=ts.transpileModule(body+"\n({assertClosingUnused,proveClosingRevisionRights})",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const actor={id:7,name:"مدير",role:"admin",permissions:[],isActive:true},dialect=new PgDialect();
const zeroState={sourceType:"vehicle_partnership_right",sourceId:101,totalAmount:"50.00",approvalStatus:"approved",approvedPaidAmount:"0.00",remainingAmount:"50.00",reservedAmount:"0.00",availableAmount:"50.00",paymentStatus:"unpaid",payable:true};
let input:any,lines:any[],rights:any[],conversions:any[],later:any[],recoveries:any[],states:Map<number,any>,queries:{sql:string;params:unknown[]}[],calls:number[],failure:string|null;
function reset(){
 const profit={agreementId:3,memberId:11,partyKey:"customer:1",amount:"50.00"},loss={agreementId:3,memberId:12,partyKey:"supplier:2",amount:"20.00"},recovery={agreementId:3,memberId:11,partyKey:"customer:1",amount:"10.00",lossKey:"right:31"};
 input={root:{id:1,vehicleId:12},row:{id:5,partnership_id:1,revision:2,status:"approved",period:"2025-08-01",financial_transaction_id:91,source_digest:"a".repeat(64)},financialId:91,snapshot:{vehicleId:12,partnershipId:1,from:"2025-08-01",sourceSnapshots:[{key:"financial:21",snapshot:{activityId:8,sourceSnapshot:{agreementId:3},financial:{id:21,sourceType:"vehicle_partnership_activity",sourceId:"8",type:"vp_internal_entitlement",event:"internal_entitlement",direction:"expense",status:"executed",amount:"100.00"}}}],lossClaims:[{key:"right:31",category:"loss",agreementId:3,memberId:11,remaining:"10.00"}],calculation:{profitAllocations:[profit],lossAllocations:[loss],lossRecoveries:[recovery],summary:{internalIncome:"100.00"}}}};
 lines=[{id:81,source_key:"profit_allocation:0:3:11",line_kind:"profit_allocation",agreement_id:3,member_id:11,amount:"50.00",snapshot:profit},{id:82,source_key:"loss_allocation:0:3:12",line_kind:"loss_allocation",agreement_id:3,member_id:12,amount:"20.00",snapshot:loss},{id:83,source_key:"loss_recovery:0:3:11",line_kind:"loss_recovery",agreement_id:3,member_id:11,amount:"10.00",snapshot:recovery}];
 rights=lines.map((line,i)=>({id:103-i,partnership_id:1,agreement_id:line.agreement_id,member_id:line.member_id,closing_line_id:line.id,amount:line.amount,category:["profit","loss","loss_recovery"][i],direction:i===1?"debit":"credit",event_key:`vp:closing:5:r2:${["profit","loss","loss_recovery"][i]}:${line.id}`,financial_transaction_id:91,source_snapshot:{...line.snapshot,closingId:5,revision:2,sourceDigest:"a".repeat(64),...(i===2?{lossRightId:31}:{})},status:"approved"}));
 conversions=[{id:61,right_id:51,financial_transaction_id:91,amount:"100.00",idempotency_key:"vp:closing:5:r2:convert:51",purpose:"internal_conversion",conversion_allocation_id:null,partnership_id:1,agreement_id:3,activity_id:8,right_amount:"100.00",right_status:"approved",right_category:"internal_entitlement",right_financial_id:21}];
 later=[];recoveries=[];queries=[];calls=[];failure=null;states=new Map(rights.map(right=>[right.id,{...zeroState,sourceId:right.id,totalAmount:right.amount,remainingAmount:right.amount,availableAmount:right.amount}]));
 states.set(51,{...zeroState,sourceId:51,totalAmount:"100.00",remainingAmount:"0.00",availableAmount:"0.00",nonCashSettledAmount:"100.00",conversionAmount:"100.00",pendingConversionAmount:"0.00",conversionCashPaidAmount:"0.00",conversionCashReservedAmount:"0.00"});
}
const execute=async(statement:any)=>{const q=dialect.sqlToQuery(statement);queries.push(q);const marker=/\/\* (vp_unused_[a-z_]+) \*\//.exec(q.sql)?.[1];if(marker===failure)throw Error("guard database unavailable");
 if(marker==="vp_unused_later_period")return {rows:structuredClone(later)};
 if(marker==="vp_unused_allocation_lines")return {rows:structuredClone(lines)};
 if(marker==="vp_unused_monthly_rights")return {rows:structuredClone(rights)};
 if(marker==="vp_unused_loss_recoveries")return {rows:structuredClone(recoveries)};
 if(marker==="vp_unused_conversions")return {rows:structuredClone(conversions)};
 throw Error("Unexpected unused-closing query "+q.sql);
};
const reconcilePaymentState=async(_tx:any,value:any)=>{assert.equal(value.sourceType,"vehicle_partnership_right");calls.push(value.sourceId);const state=states.get(value.sourceId);if(state instanceof Error)throw state;return state;};
const api=vm.runInNewContext(code,{sql,canonicalPartnershipJson,parseMoney,partnershipId,authorizePartnership,partnershipRows,PartnershipRepositoryError,reconcilePaymentState});
const reject=async(message:string)=>{await assert.rejects(()=>api.assertClosingUnused({execute},actor,input),(e:any)=>e.status===409,message);};

reset();await assert.rejects(()=>api.assertClosingUnused({execute},{...actor,role:"employee",permissions:["accounting"]},input),(e:any)=>e.status===403);assert.equal(queries.length,0,"admin defense runs before any query");
reset();assert.deepEqual(Array.from(await api.assertClosingUnused({execute},actor,input)),[101,102,103],"unused monthly IDs are returned sorted only after exact proof");assert.deepEqual([...calls].sort((a,b)=>a-b),[51,101,102,103],"each original and monthly right goes through canonical reconciliation");
const query=(marker:string)=>queries.find(q=>q.sql.includes(marker))!;
assert.match(query("vp_unused_later_period").sql,/partnership_id=\$\d+ AND period>\$\d+::date AND status IN \('pending','approved','distributed'\).*LIMIT 1/);assert.deepEqual(query("vp_unused_later_period").params,[1,"2025-08-01"]);
for(const marker of ["vp_unused_allocation_lines","vp_unused_monthly_rights"])assert.match(query(marker).sql,/LIMIT 501/);
assert.match(query("vp_unused_conversions").sql,/LIMIT 3001/);assert.ok(query("vp_unused_conversions").params.includes("vp:closing:5:r2:convert:%"),"current revision event identity catches stray allocations even on zero FI");
assert.match(query("vp_unused_loss_recoveries").sql,/rr\.source_snapshot->>'lossRightId' IN/);assert.ok(!query("vp_unused_loss_recoveries").sql.includes("JOIN vehicle_partnership_closings"),"missing or damaged later header cannot erase recovery usage");
assert.ok(queries.every(q=>!/(INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE)\s+(?:INTO\s+)?[a-z_]/i.test(q.sql.replace(/FOR UPDATE/g,""))),"guard never creates rights, pays cash, changes headers or writes schema");
for(const status of ["pending","approved","distributed"]){reset();later=[{id:6,status,period:"2025-09-01",partnership_id:1}];await reject("a later active monthly period blocks reopening");assert.equal(calls.length,0);}
for(const field of ["approvedPaidAmount","reservedAmount","nonCashSettledAmount","conversionAmount","pendingConversionAmount","conversionCashPaidAmount","conversionCashReservedAmount"]){reset();states.get(103)[field]="0.01";await reject("monthly right already used via "+field);}
for(const field of ["approvedPaidAmount","reservedAmount","pendingConversionAmount","conversionCashPaidAmount","conversionCashReservedAmount"]){reset();states.get(51)[field]="0.01";await reject("original conversion has cash usage or reservation via "+field);}
reset();states.get(51).conversionAmount="99.99";await reject("own conversion must match the complete source amount");
reset();states.get(51).nonCashSettledAmount="99.99";await reject("original noncash balance must match the unused conversion");
for(const field of ["conversionCashPaidAmount","conversionCashReservedAmount","pendingConversionAmount"]){reset();delete states.get(51)[field];await reject("conversion canonical cash proof must be complete: "+field);}
for(const id of [103,51]){reset();states.delete(id);await reject("missing canonical state fails closed");reset();states.get(id).approvalStatus="reversed";await reject("original right must stay approved");reset();states.get(id).totalAmount="0.01";await reject("canonical source amount is exact");}
reset();states.set(51,new Error("canonical unavailable"));await assert.rejects(()=>api.assertClosingUnused({execute},actor,input),/canonical unavailable/);
for(const mutate of [()=>rights.pop(),()=>rights.push({...rights[0],id:999}),()=>{rights[0].amount="50.01";},()=>{rights[0].partnership_id=2;},()=>{rights[0].agreement_id=4;},()=>{rights[0].member_id=12;},()=>{rights[0].category="advance";},()=>{rights[0].direction="debit";},()=>{rights[0].event_key="another";},()=>{rights[0].source_snapshot.revision=1;},()=>{rights[0].financial_transaction_id=92;},()=>{rights[0].closing_line_id=83;},()=>{rights[0].status="reversed";},()=>{rights[1].id=rights[0].id;},()=>lines.pop(),()=>{lines[0].source_key="profit_allocation:1:3:11";},()=>{lines[0].snapshot.amount="50.01";},()=>{lines[1].id=lines[0].id;},()=>{rights[2].source_snapshot.lossRightId=32;}]){reset();mutate();await reject("missing, extra or altered monthly right/line proof must fail without recreating rights");}
for(const mutate of [()=>conversions.pop(),()=>conversions.push({...conversions[0],id:62}),()=>{conversions[0].partnership_id=2;},()=>{conversions[0].purpose="distribution";},()=>{conversions[0].conversion_allocation_id=60;},()=>{conversions[0].right_status="reversed";},()=>{conversions[0].right_category="profit";},()=>{conversions[0].amount="99.99";},()=>{conversions[0].right_amount="99.99";},()=>{conversions[0].right_financial_id=22;},()=>{conversions[0].agreement_id=4;},()=>{conversions[0].activity_id=9;},()=>{conversions[0].financial_transaction_id=92;},()=>{conversions[0].idempotency_key="foreign";}]){reset();mutate();await reject("original conversion proof must match frozen source and its single own noncash allocation");}
reset();recoveries=[{id:201,partnership_id:1,category:"loss_recovery",status:"approved",loss_right_id:102}];await reject("downstream approved recovery blocks even if its monthly header is absent or corrupt");
reset();input.snapshot.sourceSnapshots.push({key:"financial:44",snapshot:{financial:{sourceType:"vehicle_expense"}}});await reject("frozen original company expense cash history requires corrections");
reset();input.financialId=null;input.row.financial_transaction_id=null;await reject("positive monthly rights cannot have a null financial source");
reset();input.snapshot.sourceSnapshots=[];input.snapshot.calculation={profitAllocations:[],lossAllocations:[],lossRecoveries:[],summary:{internalIncome:"0.00"}};input.financialId=null;input.row.financial_transaction_id=null;lines=[];rights=[];conversions=[];assert.deepEqual(Array.from(await api.assertClosingUnused({execute},actor,input)),[],"zero approved month has no synthetic right or conversion");
conversions=[{id:61}];await reject("FI-null zero month still rejects stray current-revision allocations");
for(const [marker,size] of [["vp_unused_allocation_lines",501],["vp_unused_monthly_rights",501],["vp_unused_conversions",3001]] as const){reset();if(marker.includes("allocation"))lines=Array.from({length:size},()=>({...lines[0]}));else if(marker.includes("monthly"))rights=Array.from({length:size},()=>({...rights[0]}));else conversions=Array.from({length:size},()=>({...conversions[0]}));await reject("bounded proof never accepts truncated data");}
for(const marker of ["vp_unused_later_period","vp_unused_allocation_lines","vp_unused_monthly_rights","vp_unused_conversions","vp_unused_loss_recoveries"]){reset();failure=marker;await assert.rejects(()=>api.assertClosingUnused({execute},actor,input),/guard database unavailable/);}
reset();rights.forEach(right=>right.status="reversed");assert.deepEqual(Array.from(await api.proveClosingRevisionRights({execute},input,"reversed")),[101,102,103]);assert.equal(calls.length,0,"retired-revision proof does not inspect mutable payments or later periods");assert.ok(!queries.some(q=>q.sql.includes("vp_unused_later_period")));
rights[0].source_snapshot.sourceDigest="b".repeat(64);await assert.rejects(()=>api.proveClosingRevisionRights({execute},input,"reversed"),(e:any)=>e.status===409);
console.log("PASS actual unused-closing guard: exact frozen rights/lines, canonical cash and reservation blockers, own noncash conversion, later periods, downstream loss recovery, zero source, bounded reads and no writes.");
console.log("LIMITATION: controlled SQL and canonical-state boundaries; live PostgreSQL concurrency and write smoke are covered only with a separately verified isolated TEST database.");
