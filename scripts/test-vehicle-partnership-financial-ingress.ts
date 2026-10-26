import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {assertGenericFinancialSourceInput} from "../src/server/vehicle-partnership/financial-classification";
const source=readFileSync("src/server/master-cash-box.ts","utf8"),tree=ts.createSourceFile("master-cash-box.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let entered=0;
const context={assertGenericFinancialSourceInput,ensureMasterCashBoxTables:async()=>{entered++;throw Error("ORIGINAL_PATH");},financialTransactionInputSchema:{parse:()=>{entered++;throw Error("ORIGINAL_PATH");}}};
function actual(name:string){const node=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name);assert.ok(node,`actual original ${name} exists`);const code=ts.transpileModule(node.getText(tree).replace(/^export\s+/,""),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;return vm.runInNewContext(`${code}\n${name}`,context);}
const admin={id:7,name:"مدير",role:"admin",permissions:[]};
for(const name of ["createFinancialTransaction","createAndExecuteSourceFinancialTransaction"]){
 const fn=actual(name);const run=(input:any)=>name==="createFinancialTransaction"?fn(input,admin):fn({},input,admin);
 entered=0;await assert.rejects(()=>run({sourceType:"vehicle_partnership_activity",transactionType:"vp_internal_entitlement"}),(e:any)=>e.status===409);assert.equal(entered,0,`${name}: generic body cannot trigger feature posting or even prior setup/parse`);
 await assert.rejects(()=>run({sourceType:"vehicle_partnership_unknown",transactionType:"manual"}),(e:any)=>e.status===409);assert.equal(entered,0);
 await assert.rejects(()=>run({sourceType:null,transactionType:"vp_partner_distribution"}),(e:any)=>e.status===409);assert.equal(entered,0,"type cannot be forged through another source");
 await assert.rejects(()=>run({sourceType:"vehicle_expense",transactionType:"vehicle_expense"}),/ORIGINAL_PATH/);assert.equal(entered,1,"old source follows original path");
}
for(const name of ["updateFinancialTransaction","submitFinancialTransaction","syncSourceFinancialRequest"]){
 const node=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name)!;
 assert.match(node.getText(tree),/assertGenericFinancialSourceInput\(existing\)/,`${name} cannot edit/re-submit an existing feature request behind its source`);
}
console.log("PASS actual central request ingress functions: feature source/type forgery blocked before old IO, old source retains path, generic update/resubmit/sync protects feature-owned records.");
