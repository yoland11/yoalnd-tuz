import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {rejectPartnershipFinancialTransaction,reversePartnershipFinancialTransaction} from "../src/server/vehicle-partnership/posting";
import {PartnershipRepositoryError} from "../src/server/vehicle-partnership/repository";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
const tree=ts.createSourceFile("finance.ts",readFileSync("src/server/master-cash-box.ts","utf8"),ts.ScriptTarget.Latest,true);
const dialect=new PgDialect();let genericLocks=0,callbacks=0;
let initial={id:91,sourceType:"vehicle_partnership_unknown",sourceId:"1",approvalStatus:"pending"};
const tx={query:{financialTransactionsTable:{findFirst:async()=>initial}},select:()=>({from:()=>({where:()=>({limit:async()=>[initial]})})}),execute:async(statement:any)=>{const query=dialect.sqlToQuery(statement);assert.ok(!query.sql.includes("master_cash_box"));return {rows:[]};}};
class FinancialApprovalError extends Error{constructor(message:string,public status=409){super(message);}}
const context={rejectPartnershipFinancialTransaction,reversePartnershipFinancialTransaction,PartnershipRepositoryError,PartnershipValidationError,FinancialApprovalError,financialTransactionsTable:{id:"id"},eq:()=>({}),sql,ensureMasterCashBoxTables:async()=>{},canApproveFinancialTransactions:(a:any)=>a.role==="admin",lockGraduationPaymentSource:async()=>{genericLocks++;throw Error("GENERIC_PATH");},db:{transaction:async(work:any)=>work(tx)},transactionNumber:(id:number)=>`FIN-${id}`};
const actor={id:7,name:"مدير",role:"admin",permissions:[]};
for(const name of ["cancelFinancialTransactionRequest","rejectFinancialTransaction","reverseFinancialTransaction"]){
 const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;
 const code=ts.transpileModule(node.getText(tree)+`\n${name}`,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
 const run=vm.runInNewContext(code,{...context,exports:{}});
 const invoke=()=>name==="cancelFinancialTransactionRequest"?run(91,actor,"تصحيح المصدر",tx):name==="reverseFinancialTransaction"?run(91,actor,"تصحيح المصدر",async()=>{callbacks++;},tx):run(91,actor,"تصحيح المصدر");
 await assert.rejects(invoke,(e:any)=>e instanceof FinancialApprovalError&&e.status===409,`${name} must reject unknown namespace before legacy writes`);
 initial={...initial,sourceType:"vehicle_partnership_activity"};
 await assert.rejects(invoke,(e:any)=>e instanceof FinancialApprovalError&&e.status===404,`${name} must resolve original source before financial/cash mutation`);
 initial={...initial,sourceType:"vehicle_partnership_unknown"};
}
assert.equal(genericLocks,0);assert.equal(callbacks,0);
console.log("PASS actual cancellation/rejection/reversal admission: source adapters run before generic locks/cash/callbacks, unknown namespace and missing source fail closed.");
