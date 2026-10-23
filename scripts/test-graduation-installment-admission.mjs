import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('installments.ts',readFileSync('src/server/installments.ts','utf8'),ts.ScriptTarget.Latest,true);
let convert;
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='db.transaction'&&node.arguments[0]?.getText(ast).includes("nextval('installment_contracts_id_seq')"))convert=node.arguments[0];ts.forEachChild(node,visit);}visit(ast);assert.ok(convert);
for(const name of ['convert','postInstallmentPayment','reconcileInstallmentPaymentsInTransaction']){
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  const source=name==='convert'?`globalThis.run=${convert.getText(ast)};`:fn.getText(ast).replace(/^export /,'')+`\nglobalThis.run=${name};`;
  let guarded=false;const tx={execute:()=>assert.fail(`${name}: contract/invoice lock or write preceded the original order`)};
  const context=vm.createContext({db:{transaction:fn=>fn(tx)},invoice:{id:91},money:Number,ensureMasterCashBoxTables:async()=>{},
    lockGraduationPaymentSource:async(connection,source)=>{assert.equal(connection,tx);assert.equal(source.sourceType,name==='convert'?'sales_invoice':'installment_contract');assert.equal(source.sourceId,name==='convert'?91:5);guarded=true;throw Error('graduation source inactive');}});
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
  await assert.rejects(()=>name==='convert'?context.run(tx):name==='postInstallmentPayment'?context.run(5,{amount:40,idempotencyKey:'same'},{id:1}):context.run(tx,5,{id:1}),/graduation source inactive/);assert.ok(guarded);
}
console.log('PASS original installment conversion, payment and reconciliation guard graduation source before contract/invoice locks or writes (controlled I/O).');
