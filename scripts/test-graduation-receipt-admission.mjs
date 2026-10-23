import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('api.ts',readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);let callback;
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='db.transaction'&&n.arguments[0]?.getText(ast).includes('Legacy Kosha records can legitimately lack customer_id'))callback=n.arguments[0];ts.forEachChild(n,visit);}visit(ast);assert.ok(callback);
const code=ts.transpileModule('globalThis.run='+callback.getText(ast)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const denied=()=>assert.fail('receipt wrote data before checking the original graduation source');
const tx={insert:denied,update:denied,execute:denied};let calls=0;
const context=vm.createContext({allocations:[{sourceType:'graduation_order',sourceId:42,amount:30}],allocationRows:[],receiptVouchersTable:{},lockGraduationPaymentSource:async(connection,sources)=>{assert.equal(connection,tx);assert.ok(Array.isArray(sources));assert.equal(sources[0].sourceType,'graduation_order');assert.equal(sources[0].sourceId,42);calls++;throw Error('source inactive');}});vm.runInContext(code,context);
await assert.rejects(()=>context.run(tx),/source inactive/);assert.equal(calls,1);
// A known archived-source conflict must reach the API's structured 409 path,
// not be swallowed by the receipt-specific generic database-error mapper.
let receiptCatch;
function findCatch(n){if(ts.isCatchClause(n)&&n.block.getText(ast).includes('console.error("receipt voucher save failed"'))receiptCatch=n;ts.forEachChild(n,findCatch);}findCatch(ast);assert.ok(receiptCatch);
const guardAst=ts.createSourceFile('guard.ts',readFileSync('src/server/graduation-write-guard.ts','utf8'),ts.ScriptTarget.Latest,true);
const conflict=guardAst.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='GraduationOrderWriteConflict');
const errorContext=vm.createContext({console:{error:()=>{}},accountingMutationError:()=>({message:'database error',status:500}),error:(message,status)=>({message,status})});
vm.runInContext(ts.transpileModule(conflict.getText(guardAst).replace(/^export /,'')+'\nasync function reject(err)'+receiptCatch.block.getText(ast)+'\nglobalThis.reject=reject;globalThis.cause=new GraduationOrderWriteConflict("طلب مؤرشف");',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,errorContext);
await assert.rejects(()=>errorContext.reject(errorContext.cause),cause=>cause===errorContext.cause&&cause.status===409);
console.log('PASS original generic receipt transaction rejects archived graduation allocations before any voucher, allocation or financial write (controlled I/O)');
