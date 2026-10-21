const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const compile=name=>{const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,`${name} missing`);return ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText};
async function run(user,method='GET',fail=false){let reads=0,ddl=0,ref;
 const c=vm.createContext({db:{},requireAnyPermission:async()=>user,getAdminUser:async()=>null,isResponse:v=>typeof v?.status==='number',int:v=>Number(v),hasPermission:(u,p)=>u.permissions.includes(p),getBookingFinancialSummary:()=>{},
  getBookingProfitability:async(_db,r)=>{reads++;ref=r;if(fail)throw Error('cost source failed');return {actualProfit:null}},BookingProfitabilityError:class extends Error{},
  ensureAdminExtensionsTables:async()=>{ddl++},ensureKoshaStaffTables:async()=>{ddl++},ensureVariantTables:async()=>{ddl++},ensureMasterCashBoxTables:async()=>{ddl++},
  json:data=>({status:200,data,headers:new Map()}),error:(message,status)=>({status,message})});
 vm.runInContext(compile('bookingProfitabilityEndpoint'),c);vm.runInContext(compile('handleBookingOperations'),c);
 const response=await c.handleBookingOperations({method},['admin','booking-operations','service','12','profitability'],'booking-operations');return {response,reads,ddl,ref};
}
(async()=>{
 const view=await run({id:1,role:'staff',permissions:['booking_finance_view']});assert.equal(view.response.status,200);assert.equal(view.ref.source,'service');assert.equal(view.ref.id,12);assert.equal(view.ddl,0);assert.equal(view.response.headers.get('Cache-Control'),'private, no-store');
 const denied=await run({id:2,role:'staff',permissions:['booking_operations_view','orders']});assert.equal(denied.response.status,403);assert.equal(denied.reads,0);
 assert.equal((await run({id:1,role:'admin',permissions:[]},'POST')).response.status,405);
 await assert.rejects(()=>run({id:1,role:'manager',permissions:[]},'GET',true),/cost source failed/);
 console.log('PASS actual profitability route: finance-only authorization, source-aware GET, no initialization/writes and errors propagated');
})().catch(e=>{console.error(e);process.exitCode=1});
