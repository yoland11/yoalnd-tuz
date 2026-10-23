import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('operations.ts',readFileSync('src/server/graduation-operations.ts','utf8'),ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='applyBulk');
const code=ts.transpileModule(fn.getText(ast)+'\nglobalThis.run=applyBulk;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const action of ['price','color']) {
  let guarded=0;
  const db={select:()=>({from:()=>({where:async()=>[{id:42,groupId:8,paidAmount:'0',discountAmount:'0'}]})}),update:()=>assert.fail('bulk must not mutate an archived order from its stale list')};
  const context=vm.createContext({db,graduationOrdersTable:{id:'id',archivedAt:'archive'},and:(...x)=>x,eq:()=>{},sql:()=>{},amount:Number,record:v=>v??{},
    fail:(message,status)=>({message,status}),updateOrder:async(_order,patch)=>{assert.equal(patch.totalAmount,60);guarded++;return{response:{status:409}};},
  });
  if(action==='color') {
    db.update=()=>({set:()=>({where:conditions=>{assert.ok(conditions.length>1,'nonfinancial bulk update must retain an active-order predicate');return{returning:async()=>[]};}})});
  }
  vm.runInContext(code,context);const result=await context.run(8,{action,value:60},{id:1});assert.equal(result.response.status,409);if(action==='price')assert.equal(guarded,1);
}
console.log('PASS original group bulk: price uses canonical locked update, stale archived rows cannot receive nonfinancial edits (controlled I/O)');
