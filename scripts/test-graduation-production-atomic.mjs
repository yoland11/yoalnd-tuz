import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('tailoring.ts',readFileSync('src/server/tailoring.ts','utf8'),ts.ScriptTarget.Latest,true);let branch;
function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(ast).includes('parts[2] === "production"'))branch=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(branch);
const code=ts.transpileModule('async function run(){const method="POST", parts=["order","42","production"];'+branch.getText(ast)+'}\nglobalThis.run=run;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const mode of ['active','archived','event_failure','measurements']) {
  let active=false,locked=false,commits=0,stage='new',events=0;
  const tx={update:()=>({set:patch=>({where:async()=>{assert.ok(active&&locked);stage=patch.productionStage;}})}),execute:async()=>{assert.ok(active&&locked);events++;if(mode==='event_failure')throw Error('event unavailable');}};
  const db={transaction:async fn=>{active=true;try{const result=await fn(tx);commits++;return result;}catch(cause){stage='new';events=0;throw cause;}finally{active=false;}}};
  const context=vm.createContext({db,user:{id:3},req:{},graduationOrdersTable:{id:'id'},rec:v=>v??{},readRequestBody:async()=>({action:'set_stage',stage:'tailoring'}),
    fetchAssignedOrder:async(_id,_user,connection)=>{assert.equal(connection,tx,'production must recheck assignment/active state inside its write transaction');assert.ok(active);locked=true;return mode==='archived'?null:{id:42,productionStage:'new',customerName:'طالب'};},
    getGraduationProductionMeasurementBlock:async(_order,_stage,connection)=>{assert.equal(connection,tx);return mode==='measurements'?{measurementStatus:'partial'}:null;},
    TAILOR_PRODUCTION_STAGES:['tailoring','ready'],eq:()=>{},sql:(parts,...values)=>({parts,values}),error:(message,status)=>({status,message}),json:data=>data,notify:async()=>{},
  });vm.runInContext(code,context);
  if(mode==='event_failure'){await assert.rejects(()=>context.run(),/event unavailable/);assert.equal(commits,0);assert.equal(stage,'new');assert.equal(events,0);}
  else{const result=await context.run();if(mode==='active'){assert.equal(stage,'tailoring');assert.equal(events,1);assert.equal(result.productionStage,'tailoring');}else{assert.ok([403,409].includes(result.status));assert.equal(stage,'new');assert.equal(events,0);}}
}
console.log('PASS actual tailor production: fresh scoped transaction, archived rejection, measurement gate, stage/history rollback (controlled I/O)');
