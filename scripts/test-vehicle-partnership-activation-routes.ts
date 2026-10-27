import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod/v4";
import {authorizePartnership} from "../src/server/vehicle-partnership/agreements";
import {PartnershipRepositoryError} from "../src/server/vehicle-partnership/repository";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {closingPolicySchema} from "../src/server/vehicle-partnership/closing";

const path="src/server/vehicle-partnership/routes.ts",tree=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
const body=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)).map(n=>n.getText(tree).replace(/^export\s+/,"")).join("\n");
let calls:any[]=[],reads=0,transactions=0;
const actor={id:7,name:"محاسب",role:"employee",permissions:["accounting"],isActive:true},writer=async()=>({id:91,approvalStatus:"pending"});
const db={transaction:async(work:any)=>{transactions++;return work("locked-tx");}};
const spy=(name:string)=>async(...args:any[])=>{calls.push({name,args});return {marker:name};};
const run=vm.runInNewContext(ts.transpileModule(body+"\nhandleVehiclePartnershipRequest",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{z,authorizePartnership,PartnershipRepositoryError,PartnershipValidationError,closingPolicySchema,
 readVehiclePartnership:spy("setup"),searchPartnershipParties:spy("parties"),readVehicleActivity:spy("activity-read"),saveVehicleAgreement:spy("agreement"),approveVehicleAgreement:spy("approve-agreement"),rejectVehicleAgreement:spy("reject-agreement"),
 readPartnershipWorkspace:spy("workspace"),submitPartnershipActivity:spy("activity"),submitPartnershipDriverAccrual:spy("driver-accrual"),requestPartnershipDriverPayment:spy("driver-payment"),requestPartnerAdvancePayment:spy("advance-payment"),submitPartnershipCost:spy("cost"),requestPartnerDistribution:spy("distribution"),saveClosingDraft:spy("draft"),transitionClosing:spy("transition"),previewClosing:spy("preview")});
const request=(path:string,method="POST",value:any={},user=actor,sourceWriter:any=writer)=>run(db,user,{parts:["vehicles","12","partnership",...path.split("/").filter(Boolean)],method,query:new URLSearchParams("from=2026-10-01&to=2026-10-31"),readBody:async()=>{reads++;return value;}},sourceWriter);
for(const [path,name] of [["activity","activity"],["driver-accrual","driver-accrual"],["driver-payments","driver-payment"],["distributions","distribution"],["closings/draft","draft"],["closings/transition","transition"]]){
 calls=[];const value={originalId:21,amount:"40.00",reason:"طلب من المصدر"};const result=await request(path,"POST",value);assert.equal(result.status,201);assert.equal(calls.length,1);assert.equal(calls[0].name,name);assert.equal(calls[0].args[0],db);assert.equal(calls[0].args[1],actor);assert.equal(calls[0].args[2],12);assert.equal(calls[0].args[3],value);
 if(["activity","driver-accrual","driver-payment","distribution","transition"].includes(name))assert.equal(calls[0].args[4],writer,"only original trusted writer may create financial request");
}
calls=[];const workspace=await request("workspace","GET");assert.equal(workspace.status,200);assert.equal(calls[0].name,"workspace");assert.equal(reads,6,"GET workspace never reads request body");
calls=[];const advanceBody={rightId:41,amount:"40.00",expectedVersion:3,reason:"رد سلفة أصلية"};
assert.equal((await request("advance-payments","POST",advanceBody)).status,201);assert.equal(calls[0].name,"advance-payment");assert.equal(calls[0].args[3],advanceBody);assert.equal(calls[0].args[4],writer);
await assert.rejects(()=>request("advance-payments","POST",{},actor,null),(e:any)=>e.status===503);
await assert.rejects(()=>request("advance-payments","GET"),(e:any)=>e.status===405);
await assert.rejects(()=>request("advance-payments","POST",{},{...actor,permissions:[]}),(e:any)=>e.status===403);
calls=[];const preview=await request("closings/preview","POST",{month:"2026-09"});assert.equal(preview.status,200);assert.equal(transactions,1);assert.equal(calls[0].name,"preview");assert.equal(calls[0].args[0],"locked-tx","preview root locks require a real source transaction");assert.equal(calls[0].args[2],12);
for(const payload of [{month:"bad"},{month:"2026-09",cashBypass:true},{month:"2026-09",policy:{accountingMethod:"invented"}}])await assert.rejects(()=>request("closings/preview","POST",payload),(e:any)=>e.status===422);
const before=reads;await assert.rejects(()=>request("distributions","POST",{}, {...actor,permissions:[]}),(e:any)=>e.status===403);assert.equal(reads,before,"permission before body/database");
await assert.rejects(()=>request("distributions","GET"),(e:any)=>e.status===405);
await assert.rejects(()=>request("workspace","POST"),(e:any)=>e.status===405);
await assert.rejects(()=>request("driver-payments","POST",{},actor,null),(e:any)=>e.status===503);
await assert.rejects(()=>request("approve","POST"),(e:any)=>e.status===404,"no new direct financial approval bypass");
calls=[];await assert.rejects(()=>run(db,actor,{parts:["vehicles","0","partnership","workspace"],method:"GET",query:new URLSearchParams(),readBody:async()=>({})},writer),(e:any)=>e.status===422);assert.equal(calls.length,0);
console.log("PASS actual partnership activation controller: scoped original vehicle/source commands, trusted financial writer, transaction-owned preview, strict policy input, original permissions and no new approval bypass.");

calls=[];const costBody={expenseId:21,payerMemberId:8,fundingKind:"partner_advance",costClass:"operating",expectedVersion:2,idempotencyKey:"source-cost-key",reason:"مصروف من الشريك"};
assert.equal((await request("costs","POST",costBody)).status,201);assert.equal(calls[0].name,"cost");assert.equal(calls[0].args[3],costBody);assert.equal(calls[0].args[4],writer);
await assert.rejects(()=>request("costs","GET"),(e:any)=>e.status===405);await assert.rejects(()=>request("costs","POST",{},actor,null),(e:any)=>e.status===503);
