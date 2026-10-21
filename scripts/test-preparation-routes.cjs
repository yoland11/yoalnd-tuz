const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const fn=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const declaration=name=>ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name)).getText(ast);
const branch=fn('handleBookingOperations').body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='resource === "preparation"');
const staff=fn('handleStaffPortal').body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='resource === "preparation"');
class PreparationAssignmentError extends Error{constructor(message,status=409){super(message);this.status=status}}
async function run(method,payload,{allowed=true,staffMode=false,failure=null}={}){
 let updates=0,completions=0,log;
 const c=vm.createContext({z:require('zod').z,db:{},body:async()=>payload,json:data=>({status:200,data}),error:(message,status,extra)=>({message,status,...extra}),validationError:()=>({status:422}),makeRequestId:()=> 'safe-prep-request',PreparationAssignmentError,
  console:{warn:(message,context)=>{log={message,context}}},getBookingPreparationSummary:async()=>({items:[]}),
  updatePreparationItems:async(connection,ref,actor,keys,patch,read,group)=>{updates++;assert.equal(connection,c.db);assert.equal(ref.source,'service');assert.equal(ref.id,12);assert.equal(actor.id,2);assert.deepEqual(Array.from(keys),['asset:44']);if(payload.action==='group'){assert.equal(group?.command,'confirm','group confirmation must reach the original guarded updater');assert.equal(group.department,'lighting');assert.equal(patch.status,'ready')}else assert.equal(patch.assigneeId,8);if(failure)throw failure;return {ok:true,updated:1}},
  completePreparationTask:async(connection,id,actor)=>{completions++;assert.equal(id,71);assert.equal(actor.id,2);assert.equal(actor.manager,false);if(failure)throw failure;return {ok:true,replayed:false}},
  logAdminActivity:async()=>{},requirePermission:async()=>allowed?{id:2,role:'employee',fullName:'موظف',username:'staff'}:{status:403},isResponse:r=>typeof r?.status==='number',
 });
 if(!staffMode){for(const name of ['PREPARATION_ITEM_STATUSES','PreparationItemUpdateSchema','PreparationBulkSchema','PreparationManualAddSchema'])vm.runInContext(compile(declaration(name)),c);}
 const script=staffMode?`async function route(req){const resource='preparation',method=req.method;${staff.getText(ast)}}`:`async function route(req){const resource='preparation',method=req.method,reference={source:'service',entityType:'service_order',id:12,operations:{},details:{}},auth={id:2,fullName:'موظف',username:'staff'},can=()=>${allowed};${branch.getText(ast)}}`;
 vm.runInContext(compile(script),c);const response=await c.route({method,headers:new Map()});return {response,updates,completions,log};
}
(async()=>{
 const item={key:'asset:44',assigneeId:8};assert.equal((await run('PATCH',item)).updates,1);
 assert.equal((await run('POST',{keys:['asset:44'],assigneeId:8})).updates,1);
 assert.equal((await run('POST',{action:'group',department:'lighting',command:'confirm',requestId:'group-route-12',confirmation:true,keys:['asset:44']})).updates,1);
 const denied=await run('PATCH',item,{allowed:false});assert.equal(denied.response.status,403);assert.equal(denied.updates,0);
 assert.equal((await run('PATCH',{key:'asset:44',assigneeId:-1})).response.status,422);
 const rejected=await run('PATCH',item,{failure:new PreparationAssignmentError('الموظف غير فعال',422)});assert.equal(rejected.response.status,422);assert.equal(rejected.response.requestId,'safe-prep-request');assert.equal(rejected.log.context.bookingId,12);
 assert.equal((await run('POST',{taskId:71},{staffMode:true})).completions,1);
 const changed=await run('POST',{taskId:71},{staffMode:true,failure:new PreparationAssignmentError('لم تعد المهمة مسندة إليك',403)});assert.equal(changed.response.status,403);assert.equal(changed.response.requestId,'safe-prep-request');
 const unauth=await run('POST',{taskId:71},{staffMode:true,allowed:false});assert.equal(unauth.response.status,403);assert.equal(unauth.completions,0);
 await assert.rejects(()=>run('PATCH',item,{failure:Error('database unavailable')}),/database unavailable/);
 console.log('PASS actual original preparation API branches: transactional updater wiring, source/ID, permission first, strict invalid assignee, assigned-only completion, structured known errors and propagated DB failure');
})().catch(e=>{console.error(e);process.exitCode=1});
