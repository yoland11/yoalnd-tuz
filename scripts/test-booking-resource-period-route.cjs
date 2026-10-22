const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const code=ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleBookingOperations').getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run({method='GET',role='admin',permissions=[],source='service',fail=false}={}){
 let reads=0,writes=0,initializers=0,ref;
 const c=vm.createContext({requireAnyPermission:async()=>({id:1,role,permissions,fullName:'مدير'}),isResponse:v=>typeof v?.status==='number',hasPermission:(u,p)=>u.permissions.includes(p),int:v=>Number(v),
  ensureAdminExtensionsTables:async()=>{initializers++},ensureKoshaStaffTables:async()=>{initializers++},ensureVariantTables:async()=>{initializers++},ensureMasterCashBoxTables:async()=>{initializers++},
  readResourceBooking:async(_db,value)=>{reads++;ref=value;if(fail)throw Error('resource storage failed');return {operations:{},eventDate:'2026-10-22'}},resourceWindowView:()=>({resourceWindow:null,expectedWindow:null,eventDate:'2026-10-22'}),
  saveBookingResourceWindow:async(_db,value)=>{writes++;ref=value;return {ok:true}},body:async()=>({window:{},expectedWindow:null}),
  db:{},json:data=>({status:200,data,headers:new Map()}),error:(message,status)=>({status,message}),
 });vm.runInContext(code,c);
 const response=await c.handleBookingOperations({method},['admin','booking-operations',source,'7','resource-window'],'booking-operations');return {response,reads,writes,initializers,ref};
}
(async()=>{
 const get=await run();assert.equal(get.response.status,200,'original resource-window route must exist');assert.equal(get.initializers,0);assert.equal(get.writes,0);assert.equal(get.ref.source,'service');
 assert.equal(get.response.data.canEdit,true,'manager may edit the operational period');
 assert.equal((await run({role:'staff',permissions:['booking_operations_view']})).response.data.canEdit,false,'view permission must not show editing controls');
 assert.equal((await run({method:'PUT'})).writes,1);
 const denied=await run({method:'PUT',role:'staff',permissions:['orders']});assert.equal(denied.response.status,403);assert.equal(denied.writes,0);assert.equal(denied.reads,0);
 assert.equal((await run({role:'staff',permissions:['booking_operations_view']})).response.status,200);
 assert.equal((await run({role:'staff',permissions:['koshas']})).response.status,403);
 assert.equal((await run({method:'DELETE'})).response.status,405);
 assert.equal((await run({source:'wrong'})).response.status,400);
 await assert.rejects(()=>run({fail:true}),/resource storage failed/);
 console.log('PASS resource-window route methods, permissions, original source identity, no schema setup/read mutation and propagated database failures');
})().catch(e=>{console.error(e);process.exitCode=1});
