import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {assertGenericFinancialSourceInput} from './lib/vehicle-partnership-financial-guard-test.mjs';
const ast=ts.createSourceFile('finance.ts',readFileSync('src/server/master-cash-box.ts','utf8'),ts.ScriptTarget.Latest,true);
for(const name of ['cancelFinancialTransactionRequest','rejectFinancialTransaction','reverseFinancialTransaction','syncSourceFinancialRequest']) {
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  let guarded=false,locked=false,writes=0;
  const row={id:7,approvalStatus:'pending',direction:'revenue',sourceType:'receipt_voucher',sourceId:'91'};
  const tx={query:{financialTransactionsTable:{findFirst:async()=>({...row})}},select:()=>({from:()=>({where:()=>({limit:()=>{
    const result=Promise.resolve([{...row}]);result.for=async()=>{assert.ok(guarded,`${name}: original sources must lock before financial row`);locked=true;if(name==='reverseFinancialTransaction')throw Error('fresh executed row');return[{...row}];};return result;
  }})})}),update:()=>{writes++;assert.fail('a stale cancellation cannot overwrite an approved transaction');}};
  const context=vm.createContext({db:{...tx,transaction:fn=>fn(tx)},financialTransactionsTable:{id:'id'},eq:()=>{},ensureMasterCashBoxTables:async()=>{},canApproveFinancialTransactions:()=>true,financialTransactionInputSchema:{parse:value=>value},assertGenericFinancialSourceInput,
    lockGraduationPaymentSource:async(connection,source,options)=>{assert.equal(connection,tx);assert.equal(source.sourceType,'receipt_voucher');assert.equal(options.requireActive,name==='syncSourceFinancialRequest');guarded=true;row.approvalStatus='executed';},
  });
  vm.runInContext(ts.transpileModule(fn.getText(ast).replace(/^export /,'')+`\nglobalThis.run=${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
  const call=()=>name==='syncSourceFinancialRequest'?context.run(7,{direction:'revenue'},{id:1},'سبب واضح'):context.run(7,{id:1,role:'admin'},'سبب واضح');
  await assert.rejects(call,name==='reverseFinancialTransaction'?/fresh executed row/:name==='rejectFinancialTransaction'?/المعلّقة/:name==='syncSourceFinancialRequest'?/تم تنفيذ/:/منفذة/);
  assert.ok(locked);assert.equal(writes,0);
}
console.log('PASS original-source before financial locks for cancellation/rejection/reversal, including approval-wins interleaving (controlled I/O).');
