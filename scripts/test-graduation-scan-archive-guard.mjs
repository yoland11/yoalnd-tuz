import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('operations.ts',readFileSync('src/server/graduation-operations.ts','utf8'),ts.ScriptTarget.Latest,true);let branch;
function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(ast)==='resource === "scans" && method === "POST"')branch=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(branch);
const code=ts.transpileModule('async function run(){const resource="scans",method="POST";'+branch.getText(ast)+'}\nglobalThis.run=run;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['active','archived','history_failure']) {
  let active=false,locked=false,stage='new',events=0;
  const row={id:42,productionStage:'new',status:'new',archivedAt:mode==='archived'?'2026-10-23':null};
  const tx={select:()=>({from:()=>({where:()=>({limit:()=>({for:async()=>{assert.ok(active);locked=true;return[row];}})})})}),insert:()=>({values:async()=>{assert.ok(active&&locked);events++;if(mode==='history_failure')throw Error('history unavailable');}})};
  const db={query:{graduationOrdersTable:{findFirst:async()=>assert.fail('scan read escaped its atomic write transaction')}},transaction:async fn=>{active=true;try{return await fn(tx);}catch(cause){stage='new';events=0;throw cause;}finally{active=false;}}};
  const context=vm.createContext({db,req:{},user:{id:1},graduationOrdersTable:{},graduationProductionEventsTable:{},requireOperationPermission:()=>null,body:async()=>({code:'GR-42',stage:'tailoring'}),GRADUATION_STAGES:['new','tailoring'],or:()=>{},eq:()=>{},fail:(message,status)=>({message,status}),json:v=>v,formatStudent:v=>v,
    updateOrder:async(_row,patch,_user,connection)=>{assert.equal(connection,tx);assert.ok(locked);stage=patch.productionStage;return{order:{...row,productionStage:stage}};},timeline:async(...args)=>{assert.equal(args.at(-1),tx);assert.ok(active);},
  });vm.runInContext(code,context);
  if(mode==='history_failure'){await assert.rejects(()=>context.run(),/history unavailable/);assert.equal(stage,'new');assert.equal(events,0);}else{const result=await context.run();if(mode==='archived'){assert.equal(result.status,409);assert.equal(events,0);}else{assert.equal(stage,'tailoring');assert.equal(events,1);assert.equal(result.order.productionStage,'tailoring');}}
}
console.log('PASS actual graduation scan: fresh active order and atomic stage/event/timeline, no archived writes (controlled I/O)');
