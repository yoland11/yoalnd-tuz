import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
function originalFunction(path:string,name:string,bindings:Record<string,unknown>){
 const tree=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
 const declaration=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;
 return vm.runInNewContext(ts.transpileModule(declaration.getText(tree).replace(/^export\s+/,"")+"\n"+name,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,bindings);
}
const calls:any[]=[],tx={original:true},actor={id:7,role:"admin"};
const spy=(name:string)=>async(...args:unknown[])=>{calls.push({name,args});return {id:91,marker:name};};
const prepare=originalFunction("src/server/vehicle-partnership/accounting.ts","preparePartnershipFinancialRequest",{PartnershipValidationError,prepareAdvancePaymentFinancialRequest:spy("advance"),prepareDistributionFinancialRequest:spy("profit"),prepareDriverPaymentFinancialRequest:spy("driver")});
const command={rightId:41,amount:"40.00"};
assert.equal((await prepare(tx,{sourceType:"vehicle_partnership_settlement",sourceId:41,advancePayment:command},actor)).marker,"advance");assert.equal(calls[0].args[0],tx);assert.equal(calls[0].args[1].advancePayment,command);assert.equal(calls[0].args[2],actor);
await assert.rejects(()=>prepare(tx,{sourceType:"vehicle_partnership_settlement",sourceId:41,advancePayment:command,distribution:{}},actor),(e:any)=>e.status===422);assert.equal(calls.length,1,"mixed source request never reaches a financial producer");
assert.equal((await prepare(tx,{sourceType:"vehicle_partnership_settlement",sourceId:41,distribution:command},actor)).marker,"profit");
const reject=originalFunction("src/server/vehicle-partnership/posting.ts","rejectPartnershipFinancialTransaction",{rejectAdvancePaymentFinancialTransaction:spy("reject-advance"),rejectDistributionFinancialTransaction:spy("reject-profit"),rejectDriverPaymentFinancialTransaction:spy("reject-driver")});
const initial={id:91,sourceType:"vehicle_partnership_settlement",sourceId:"41",transactionType:"vp_partner_advance_repayment"};
assert.equal((await reject(tx,initial,actor,"سبب إلغاء صحيح","cancel")).marker,"reject-advance");assert.equal(calls.at(-1).args[1],initial);assert.equal(calls.at(-1).args[4],"cancel");
assert.equal((await reject(tx,{...initial,transactionType:"vp_partner_distribution"},actor,"سبب رفض صحيح")).marker,"reject-profit");
console.log("PASS original trusted accounting/rejection dispatch: source-owned advance commands, mixed-source refusal, unchanged profit producer and canonical cancellation boundary.");
