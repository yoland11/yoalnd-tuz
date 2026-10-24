import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('finance.ts',readFileSync('src/server/master-cash-box.ts','utf8'),ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='executePendingFinancialTransaction');
const code=ts.transpileModule(fn.getText(ast)+'\nglobalThis.run=executePendingFinancialTransaction;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['changed_amount','already_executed','changed_source','archived']) {
  let guarded=false,locked=false,cashReads=0,updates=0;
  const pending={id:7,approvalStatus:'pending',direction:'revenue',amount:'40',sourceType:'graduation_order',sourceId:'42',department:'graduation',transactionType:'graduation_payment'};
  const fresh={...pending,amount:'70',...(mode==='already_executed'?{approvalStatus:'executed'}:{}),...(mode==='changed_source'?{sourceId:'99'}:{})};
  const financialTransactionsTable={name:'financial',id:'id'},financialAccountsTable={name:'accounts',code:'code'};
  const tx={select:()=>({from:table=>({where:()=>({limit:()=>{const result=Promise.resolve(table===financialTransactionsTable?[{...pending}]:[{id:1}]);result.for=async kind=>{assert.equal(kind,'update');assert.ok(guarded);locked=true;return[{...fresh}];};return result;}})})}),
    execute:async()=>{cashReads++;return{rows:[{id:1,current_balance:'100'}]};},update:()=>({set:values=>{updates++;assert.ok(locked,'approval must lock and re-read the financial request after the original-order lock');assert.equal(values.balanceAfter,'170','approval must use the latest pending amount, not a pre-lock snapshot');throw Error('verified latest amount');}}),
  };
  const context=vm.createContext({financialTransactionsTable,financialAccountsTable,money:v=>Number(v),sql:()=>({}),eq:()=>{},counterAccountCode:()=> '4060',
    FinancialApprovalError:class extends Error{constructor(message,status=409){super(message);this.status=status;}},iqd:v=>`${v} د.ع`,
    lockGraduationPaymentSource:async(connection)=>{assert.equal(connection,tx);guarded=true;if(mode==='archived')throw Error('source inactive');},
  });vm.runInContext(code,context);
  if(mode==='already_executed'){assert.equal((await context.run(tx,7,{id:1})).approvalStatus,'executed');assert.equal(cashReads,0);assert.equal(updates,0);}
  else{await assert.rejects(()=>context.run(tx,7,{id:1}),mode==='archived'?/source inactive/:mode==='changed_source'?/تغيّرت/:/verified latest amount/);if(mode!=='changed_amount'){assert.equal(cashReads,0);assert.equal(updates,0);}}
}
console.log('PASS actual approval admission: source guard, fresh locked request amount, changed identity rejection and already-executed retry before cash posting (controlled I/O)');
