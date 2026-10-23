import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('graduation.ts',readFileSync('src/server/graduation.ts','utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['applyInventory','restoreGraduationInventoryFromMovements']);
assert.ok(ast.statements.some(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='restoreGraduationInventoryFromMovements'),'restore must use original movement owners, never current shared links');
const code=ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n')+'\nglobalThis.run=restoreGraduationInventoryFromMovements;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['changed_owner','partial_return','balanced','legacy_unknown','missing_owner','unexpected_credit','snapshot_mismatch']) {
  const rows=mode==='legacy_unknown'?[]:[{product_id:5,stock_source_product_id:mode==='missing_owner'?null:10,quantity_change:'-1.125'},...(mode==='partial_return'?[{product_id:5,stock_source_product_id:10,quantity_change:'0.125'}]:mode==='balanced'?[{product_id:5,stock_source_product_id:10,quantity_change:'1.125'}]:mode==='unexpected_credit'?[{product_id:5,stock_source_product_id:10,quantity_change:'2'}]:[])];
  const movements=[],updates=[];const tx={execute:async q=>{if(q.parts.join('').includes('FROM stock_movements'))return{rows};updates.push(q);return{rows:[{id:10}]};},insert:()=>({values:async data=>movements.push(data)})};
  const context=vm.createContext({sql:(parts,...values)=>({parts,values}),stockMovementsTable:{},GraduationOrderWriteConflict:class extends Error {status=409},aggregateByStockOwner:()=>assert.fail('today\'s shared stock owner must not be used during return')});vm.runInContext(code,context);
  const order={id:42,inventoryApplied:mode!=='snapshot_mismatch',inventoryItems:[{productId:5,quantity:1.125}]};
  if(['legacy_unknown','missing_owner','unexpected_credit','snapshot_mismatch'].includes(mode)){await assert.rejects(()=>context.run(order,{id:1},tx),cause=>cause.status===409);assert.equal(movements.length,0);assert.equal(updates.length,0);}
  else {await context.run(order,{id:1},tx);assert.equal(movements.length,mode==='balanced'?0:1);if(movements.length){assert.equal(movements[0].stockSourceProductId,10);assert.equal(movements[0].quantityChange,mode==='partial_return'?'1':'1.125');assert.equal(movements[0].reason,'graduation_order_restored');}}
}
console.log('PASS original movement-owned decimal stock return, historical partial/balanced returns and fail-closed legacy inconsistencies (controlled I/O).');
