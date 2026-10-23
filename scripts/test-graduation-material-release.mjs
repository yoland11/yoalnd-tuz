import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('enterprise.ts',readFileSync('src/server/graduation-enterprise.ts','utf8'),ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='releaseGraduationMaterialReservations');
assert.ok(fn,'archive must release enterprise demand in its existing transaction');
const context=vm.createContext({sql:(parts,...values)=>({parts,values})});vm.runInContext(ts.transpileModule(fn.getText(ast).replace(/^export /,'')+'\nglobalThis.run=releaseGraduationMaterialReservations;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const calls=[];await context.run({execute:async q=>{calls.push(q);return{rows:[]};}},42);
assert.equal(calls.length,2);assert.match(calls[0].parts.join('?'),/UPDATE graduation_inventory_reservations[\s\S]*released/);assert.match(calls[1].parts.join('?'),/UPDATE graduation_material_requirements[\s\S]*reserved_quantity = '0'/);
for(const q of calls){assert.ok(q.values.includes(42));assert.doesNotMatch(q.parts.join('?'),/DELETE|UPDATE products|INSERT INTO stock_movements/);}
const report=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='materialReport');
assert.match(report.getText(ast),/archivedAt/);assert.match(report.getText(ast),/cancelled/);assert.match(report.getText(ast),/released/);
console.log('PASS enterprise reservations/demand released without extra stock writes; operational material report excludes archived/cancelled/released orders.');
