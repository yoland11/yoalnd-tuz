import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('tailoring.ts',readFileSync('src/server/tailoring.ts','utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['visibleCondition','groupOrdersCondition']);
const code=ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n')+'\nglobalThis.visible=visibleCondition;globalThis.group=groupOrdersCondition;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const rows=[{id:1,groupId:8,status:'new',archivedAt:null,staff:3},{id:2,groupId:8,status:'new',archivedAt:new Date(),staff:3},{id:3,groupId:8,status:'cancelled',archivedAt:null,staff:3},{id:4,groupId:8,status:'new',archivedAt:null,staff:4}];
const context=vm.createContext({graduationOrdersTable:{groupId:'groupId',archivedAt:'archivedAt',status:'status'},
  eq:(key,value)=>row=>row[key]===value,isNull:key=>row=>row[key]==null,sql:()=>row=>row.status!=='cancelled',
  and:(...checks)=>row=>checks.filter(Boolean).every(check=>check(row)),or:(...checks)=>row=>checks.some(check=>check(row)),canSeeAll:u=>u.role==='admin',assignedCondition:id=>row=>row.staff===id,pendingMeasurementsCondition:()=>()=>false,
});vm.runInContext(code,context);
assert.deepEqual(rows.filter(context.visible({role:'admin'})).map(r=>r.id),[1,4]);
assert.deepEqual(rows.filter(context.visible({role:'employee',id:3})).map(r=>r.id),[1]);
assert.deepEqual(rows.filter(context.group(8,{role:'admin'})).map(r=>r.id),[1,4]);
console.log('PASS original tailor queue predicates exclude archived/cancelled rows for managers and staff while preserving assignment scope');
