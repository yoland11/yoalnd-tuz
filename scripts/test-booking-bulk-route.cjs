const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='bookingBulkEndpoint');assert.ok(fn,'booking bulk endpoint missing');
const compile=n=>ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run(role,payload,method='POST'){let calls=0,patches=0,reminders=0;const c=vm.createContext({z:require('zod').z,db:{},body:async()=>payload,makeRequestId:()=> 'safe-request',console:{warn(){},error(){}},BookingBulkError:class extends Error{},
 sendBookingReminders:async(_db,actor,request)=>{reminders++;assert.equal(actor.canManage,true);assert.equal(request.action,'send_reminder');assert.equal(request.message,'راجع التجهيز');return {results:[]}},
 runBookingBulkOperation:async(_db,actor,request,deps)=>{calls++;assert.equal(actor.canManage,true);assert.equal(request.refs[0].source,'service');await deps.patch({}, {source:'service',id:12},{},{key:'10:0',...request.patch});return {results:[]}},
 getBookingPreparationSummary:async()=>({items:[]}),applyPreparationPatch:async(_ref,_meta,patch)=>{patches++;assert.equal(patch.priority,'urgent');assert.equal(patch.assigneeId,undefined)},
 json:data=>({status:200,data,headers:new Map()}),error:(message,status)=>({message,status}),validationError:()=>({status:422})});
 vm.runInContext(compile(fn),c);const response=await c.bookingBulkEndpoint({method,headers:new Map()}, {id:1,role,fullName:'مدير',username:'admin'});return {response,calls,patches,reminders};}
(async()=>{const payload={requestId:'bulk-request',confirmation:true,refs:[{source:'service',id:12}],patch:{priority:'urgent'}};
 const valid=await run('admin',payload);assert.equal(valid.response.status,200);assert.equal(valid.patches,1);
 const denied=await run('staff',payload);assert.equal(denied.response.status,403);assert.equal(denied.calls,0);
 assert.equal((await run('admin',{...payload,patch:{assigneeId:-2}})).response.status,422);assert.equal((await run('admin',{...payload,patch:{assigneeName:'fake'}})).response.status,422);assert.equal((await run('admin',{...payload,confirmation:false})).response.status,422);assert.equal((await run('admin',payload,'GET')).response.status,405);
 console.log('PASS actual bulk route: administrator-only, strict bounded patch allowlist, confirmation and canonical preparation patch reuse');
 const reminder=await run('admin',{requestId:'reminder-request',confirmation:true,refs:payload.refs,action:'send_reminder',message:'راجع التجهيز'});assert.equal(reminder.response.status,200);assert.equal(reminder.reminders,1);assert.equal(reminder.patches,0);
 assert.equal((await run('staff',{requestId:'reminder-request',confirmation:true,refs:payload.refs,action:'send_reminder',message:'راجع التجهيز'})).reminders,0);
})().catch(e=>{console.error(e);process.exitCode=1});
