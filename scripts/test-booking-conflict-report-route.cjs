const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const code=ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleBookingOperations').getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run({method='GET',role='admin',permissions=[],source='service',identifier='7',fail=false,anonymous=false}={}){
 let reads=0,initializers=0,ref;
 const c=vm.createContext({requireAnyPermission:async()=>anonymous?{status:401}:{id:1,role,permissions,fullName:'مدير'},getAdminUser:async()=>null,isResponse:v=>typeof v?.status==='number',hasPermission:(u,p)=>u.permissions.includes(p),int:Number,
  ensureAdminExtensionsTables:async()=>{initializers++},ensureKoshaStaffTables:async()=>{initializers++},ensureVariantTables:async()=>{initializers++},ensureMasterCashBoxTables:async()=>{initializers++},
  loadBookingConflictReport:async(_db,value)=>{reads++;ref=value;if(fail)throw Error('conflict storage failed');return {source:value.source,id:value.id,rows:[]}},
  loadBookingOperationsReference:async()=>({source,id:7,row:{},details:{}}),
  db:{},json:data=>({status:200,data,headers:new Map()}),error:(message,status)=>({status,message}),
 });vm.runInContext(code,c);
 const response=await c.handleBookingOperations({method},['admin','booking-operations',source,identifier,'conflicts'],'booking-operations');return {response,reads,initializers,ref};
}
(async()=>{
 const get=await run();assert.equal(get.response.status,200,'resource conflict report must be reachable through the original booking route');assert.equal(get.initializers,0);assert.equal(get.reads,1);assert.equal(get.ref.source,'service');assert.equal(get.ref.id,7);assert.equal(get.response.headers.get('Cache-Control'),'private, no-store');
 assert.equal((await run({source:'kosha'})).ref.source,'kosha');
 for(const permission of ['orders','booking_operations_view'])assert.equal((await run({role:'staff',permissions:[permission]})).response.status,200);
 for(const options of [{role:'staff',permissions:['koshas']},{anonymous:true}]){const result=await run(options);assert.ok([401,403].includes(result.response.status));assert.equal(result.reads,0);assert.equal(result.initializers,0)}
 for(const method of ['POST','PUT','DELETE']){const result=await run({method});assert.equal(result.response.status,405);assert.equal(result.reads,0);assert.equal(result.initializers,0)}
 for(const options of [{source:'wrong'},{identifier:'7oops'},{identifier:'0'},{identifier:'9007199254740992'}]){const result=await run(options);assert.equal(result.response.status,400);assert.equal(result.reads,0)}
 await assert.rejects(()=>run({fail:true}),/conflict storage failed/);
 console.log('PASS actual conflict report route: original source/ID, private GET, authorization before reads, no schema setup/writes and propagated database error');
})().catch(e=>{console.error(e);process.exitCode=1});
