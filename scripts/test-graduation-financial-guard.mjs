import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const path='src/server/graduation-write-guard.ts';
let source='';try{source=readFileSync(path,'utf8');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='lockGraduationPaymentSource');
assert.ok(fn,'graduation financial requests and approval need a shared original-order guard');
const conflict=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='GraduationOrderWriteConflict');
const code=ts.transpileModule(conflict.getText(ast).replace(/^export /,'')+'\n'+fn.getText(ast).replace(/^export /,'')+'\nglobalThis.run=lockGraduationPaymentSource;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const render=q=>q.parts.map((part,i)=>part+(i<q.values.length?(q.values[i]?.parts?render(q.values[i]):'?'):'')).join('');
for(const mode of ['active','archived','cancelled','missing','invoice_archived','ordinary_invoice','other','receipt_archived','installment_archived','payment_archived','cleanup_archived']) {
  const calls=[];const tx={execute:async q=>{calls.push(q);return{rows:mode==='missing'||mode==='ordinary_invoice'?[]:[{id:42,status:mode==='cancelled'?'cancelled':'new',archived_at:mode.includes('archived')?'2026-10-23':null}]};}};
  const context=vm.createContext({sql:(parts,...values)=>({parts,values})});vm.runInContext(code,context);
  const input={sourceType:mode==='other'?'order':mode.includes('invoice')?'sales_invoice':mode.startsWith('receipt')?'receipt_voucher':mode.startsWith('installment')?'installment_contract':mode.startsWith('payment')?'installment_payment':'graduation_order',sourceId:42};
  if(['archived','cancelled','missing','invoice_archived','receipt_archived','installment_archived','payment_archived'].includes(mode))await assert.rejects(()=>context.run(tx,input),cause=>cause.status===409);else await context.run(tx,input,mode==='cleanup_archived'?{requireActive:false}:undefined);
  assert.equal(calls.length,mode==='other'?0:1);if(calls.length)assert.match(calls[0].parts.join('?'),/FOR UPDATE/);
  if(mode==='receipt_archived')assert.match(render(calls[0]),/receipt_voucher_allocations[\s\S]*ORDER BY[\s\S]*FOR UPDATE/);
}
console.log('PASS graduation payment admission guard: original-order lock, archived/cancelled rejection, linked invoice protection and unrelated-source compatibility (controlled I/O)');
