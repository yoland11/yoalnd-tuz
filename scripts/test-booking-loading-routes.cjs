const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const compile=name=>{const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,`${name} route coordinator missing`);return ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText};
const schemaCode=()=>{const n=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='BookingLoadingRequestSchema'));assert.ok(n,'strict loading request schema missing');return ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText};
async function run(user={id:1,role:'admin',permissions:[]},method='GET',payload={},fail=false){
  let reads=0,writes=0,ddl=0,actor,ref;
  const context=vm.createContext({z:require('zod').z,db:{},hasPermission:(u,p)=>u.permissions.includes(p),actor:u=>({id:u.id,name:'موظف'}),body:async()=>payload,
    requireAnyPermission:async()=>user||{status:401},getAdminUser:async()=>null,isResponse:v=>!!v&&typeof v.status==='number',int:v=>/^\d+$/.test(v)?Number(v):null,
    ensureAdminExtensionsTables:async()=>{ddl++},ensureKoshaStaffTables:async()=>{ddl++},ensureVariantTables:async()=>{ddl++},ensureMasterCashBoxTables:async()=>{ddl++},
    getLoadingView:async(_db,r,a)=>{reads++;ref=r;actor=a;if(fail)throw Error('original custody failed');return {record:null}},
    runLoadingRequest:async(_db,r,a,c)=>{writes++;ref=r;actor=a;return {record:{id:'original'},action:c.type}},
    LoadingError:class LoadingError extends Error{},
    json:data=>({status:200,data,headers:new Map()}),error:(message,status)=>({status,message}),validationError:()=>({status:422}),
  });
  vm.runInContext(schemaCode(),context);vm.runInContext(compile('bookingLoadingEndpoint'),context);vm.runInContext(compile('handleBookingOperations'),context);
  const response=await context.handleBookingOperations({method},['admin','booking-operations','service','12','loading'],'booking-operations');
  return {response,reads,writes,ddl,actor,ref};
}
(async()=>{
  const first=await run();assert.equal(first.response.status,200);assert.equal(first.ddl,0);assert.equal(first.actor.manager,true);assert.equal(first.ref.source,'service');
  assert.equal(first.response.headers.get('Cache-Control'),'private, no-store');
  const denied=await run({id:9,role:'staff',permissions:['booking_finance_view']});assert.equal(denied.response.status,403);assert.equal(denied.reads,0);
  const staff=await run({id:2,role:'staff',permissions:['booking_operations_view']});assert.equal(staff.actor.manager,false,'view permission cannot impersonate a manager');
  const mutation=await run(undefined,'POST',{type:'scan',manifestId:'manifest-1',requestId:'scan-request',lineKey:'asset:10',code:'CODE',quantity:1});assert.equal(mutation.writes,1);
  const injected=await run(undefined,'POST',{type:'scan',manifestId:'manifest-1',requestId:'scan-request',lineKey:'asset:10',code:'CODE',quantity:1,manager:true});assert.equal(injected.response.status,422);assert.equal(injected.writes,0);
  assert.equal((await run(undefined,'POST',{type:'confirm',requestId:'short'})).response.status,422);
  assert.equal((await run(undefined,'DELETE')).response.status,405);
  assert.equal((await run(null)).response.status,401);
  await assert.rejects(()=>run(undefined,'GET',{},true),/original custody failed/);
  const portal=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleStaffPortal');const branch=portal.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='resource === "loading"');assert.ok(branch);
  for(const denied of [false,true]){
    let authorized=0,read=0;
    const c=vm.createContext({isResponse:v=>typeof v?.status==='number',requirePermission:async()=>({id:2,role:'staff'}),authorizeKoshaPortalBooking:async(_actor,id,source)=>{authorized++;assert.equal(id,12);assert.equal(source,'service');return denied?{response:{status:403}}:{booking:{id:12}}},bookingLoadingEndpoint:async(_req,ref,actor)=>{read++;assert.equal(ref.source,'service');assert.equal(actor.id,2);return {status:200}},error:(message,status)=>({status,message})});
    vm.runInContext(ts.transpileModule(`async function staff(req){const resource='loading',id=12,parts=['staff','koshas','loading','12'];${branch.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,c);
    const response=await c.staff({nextUrl:{searchParams:new URLSearchParams('source=service')}});assert.equal(authorized,1);assert.equal(response.status,denied?403:200);assert.equal(read,denied?0:1,'portal assignment authorization precedes every equipment read');
  }
  console.log('PASS actual loading API: early authorized source scope, no DDL, strict payloads, server-derived capabilities, GET/no-store and propagated original-source errors');
})().catch(e=>{console.error(e);process.exitCode=1});
