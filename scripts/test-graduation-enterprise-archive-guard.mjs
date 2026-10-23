import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('enterprise.ts',readFileSync('src/server/graduation-enterprise.ts','utf8'),ts.ScriptTarget.Latest,true);const callbacks=[];
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='db.transaction'&&['71968','71969','71970','71971'].some(key=>n.arguments[0]?.getText(ast).includes(key)))callbacks.push(n.arguments[0]);ts.forEachChild(n,visit);}visit(ast);assert.equal(callbacks.length,4);
for(const callback of callbacks){
  const tx={execute:async()=>({rows:[]}),select:()=>({from:()=>({where:()=>({limit:async()=>[{id:42,status:'new',archivedAt:'2026-10-23'}]})})}),insert:()=>assert.fail('enterprise mutation preceded its original-order guard'),update:()=>assert.fail('enterprise mutation preceded its original-order guard')};
  const context=vm.createContext({orderId:42,order:{id:42},expected:{id:42},component:{id:6},graduationOrdersTable:{id:'id'},graduationKitsTable:{graduationOrderId:'order'},graduationMeasurementsTable:{},sql:()=>({}),eq:()=>{},record:v=>v??{},
    lockGraduationPaymentSource:async(connection,source)=>{assert.equal(connection,tx);assert.equal(source.sourceId,42);throw Error('source inactive');}});
  vm.runInContext(ts.transpileModule('globalThis.run='+callback.getText(ast)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
  await assert.rejects(()=>context.run(tx),/source inactive/);
}
console.log('PASS actual enterprise kit/packing/completion/delivery transactions guard the original order before writing (controlled I/O)');
