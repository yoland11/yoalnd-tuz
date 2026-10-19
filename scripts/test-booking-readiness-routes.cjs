const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const compile=name=>ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const evidence={status:'not_ready',percentage:25,checks:[],blockers:[],categories:{},generatedAt:'2026-10-18T12:00:00Z'};
async function detail(user={role:'admin',permissions:[]},method='GET',source='kosha',id='12',fail=false){
  let reads=0,ddl=0;let refs;
  const c=vm.createContext({requireAnyPermission:async()=>user||{status:401},getAdminUser:async()=>null,isResponse:v=>v&&typeof v.status==='number',hasPermission:(u,p)=>u.permissions.includes(p),
    int:value=>/^\d+$/.test(value)&&Number(value)>0?Number(value):null,
    ensureAdminExtensionsTables:async()=>{ddl++},ensureKoshaStaffTables:async()=>{ddl++},ensureVariantTables:async()=>{ddl++},ensureMasterCashBoxTables:async()=>{ddl++},
    loadBookingOperationsReference:async()=>null,loadBookingReadiness:async(_db,value)=>{reads++;refs=value;if(fail)throw Error('evidence failed');return new Map([['kosha:12',evidence],['service:12',{...evidence,percentage:50}]]);},db:{},
    json:data=>({status:200,data,headers:new Map()}),error:(message,status)=>({status,message}),
  });vm.runInContext(compile('handleBookingOperations'),c);
  const response=await c.handleBookingOperations({method},['admin','booking-operations',source,id,'readiness'],'booking-operations');
  return {response,reads,ddl,refs};
}
async function list(query){
  let reads=0;let refs;
  const rows=[{source:'kosha',id:12,total:800,paid:0,remaining:800},{source:'service',id:12,total:900,paid:200,remaining:700},{source:'store',id:12,total:500,paid:0,remaining:500}];
  const c=vm.createContext({requirePermission:async()=>({role:'admin'}),isResponse:()=>false,listCentralBookingCenterRows:async()=>({rows,truncated:false}),loadBookingReadiness:async(_db,value)=>{reads++;refs=value;return new Map([['kosha:12',evidence],['service:12',{...evidence,percentage:50}]]);},db:{},json:data=>({status:200,data,headers:new Map()})});
  vm.runInContext(compile('handleCentralBookingCenter'),c);
  const response=await c.handleCentralBookingCenter({method:'GET',nextUrl:{searchParams:new URLSearchParams(query)}},['admin','booking-center'],'booking-center');
  return {response,reads,refs};
}
(async()=>{
  const allowed=await detail();assert.equal(allowed.response.status,200,'exact booking readiness route is missing');
  assert.equal(allowed.response.data.percentage,25);assert.equal(allowed.ddl,0,'readiness GET must not run schema initializers');
  assert.equal((await detail(undefined,'GET','service')).response.data.percentage,50,'same numeric ID must retain source identity');
  assert.equal((await detail(null)).response.status,401);
  const denied=await detail({role:'staff',permissions:['koshas']});assert.equal(denied.response.status,403);assert.equal(denied.reads,0);assert.equal(denied.ddl,0);
  assert.equal((await detail({role:'staff',permissions:['orders']})).response.status,200);
  assert.equal((await detail(undefined,'POST')).response.status,405);
  assert.equal((await detail(undefined,'GET','wrong')).response.status,400);
  assert.equal((await detail(undefined,'GET','kosha','-1')).response.status,400);
  await assert.rejects(()=>detail(undefined,'GET','kosha','12',true),/evidence failed/);
  const original=await list('');assert.equal(original.reads,0,'old consumers retain their read contract');
  const enriched=await list('readiness=1');assert.equal(enriched.reads,1);assert.equal(enriched.refs.length,2);
  assert.equal(enriched.response.data[0].operationalReadiness.status,'not_ready');assert.equal(enriched.response.data[1].operationalReadiness.percentage,50);
  assert.ok(!('checks' in enriched.response.data[0].operationalReadiness),'the list sends a compact summary, not every checklist for every booking');
  assert.equal(enriched.response.data[2].operationalReadiness,null,'unrelated invoice systems must not be guessed');
  assert.deepEqual(JSON.parse(JSON.stringify(enriched.response.data)).map(r=>[r.total,r.paid,r.remaining]),[[800,0,800],[900,200,700],[500,0,500]],'financial values unchanged for all three original sources');
  const report=await list('scope=report&readiness=1');assert.equal(report.reads,0,'reports must not request unbounded operational evidence');
  console.log('PASS readiness route authorization/source/error/DDL boundaries and opt-in list financial compatibility');
})().catch(cause=>{console.error(cause);process.exitCode=1});
