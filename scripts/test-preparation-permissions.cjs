const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleBookingOperations');
const code=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run(resource,permissions){let reads=0;const user={id:8,role:'employee',permissions,fullName:'موظف',username:'staff'};
 const c=vm.createContext({requireAnyPermission:async(_req,allowed)=>allowed.some(p=>permissions.includes(p))?user:{status:403},getAdminUser:async()=>null,isResponse:v=>typeof v?.status==='number',hasPermission:(u,p)=>u.permissions.includes(p),int:Number,error:(message,status)=>({message,status}),json:data=>({status:200,data}),
 ensureAdminExtensionsTables:async()=>{},ensureKoshaStaffTables:async()=>{},ensureVariantTables:async()=>{},ensureMasterCashBoxTables:async()=>{},loadBookingOperationsReference:async()=>({source:'kosha',id:12,entityType:'kosha_booking',details:{},operations:{}}),getBookingPreparationSummary:async()=>{reads++;return {source:'kosha',id:12,items:[],rollup:{}}}});
 vm.runInContext(code,c);const response=await c.handleBookingOperations({method:'GET'},['admin','booking-operations','kosha','12',resource],'booking-operations');return {response,reads};}
(async()=>{const allowed=await run('preparation',['preparation_view']);assert.equal(allowed.response.status,200,'the explicit preparation view permission must reach its own existing route');assert.equal(allowed.reads,1);
 const unrelated=await run('overview',['preparation_view']);assert.equal(unrelated.response.status,403);assert.equal(unrelated.reads,0,'preparation capability must not broaden unrelated booking access');
 assert.equal((await run('preparation',[])).response.status,403);
 console.log('PASS actual preparation entry gate: explicit capability accepted only on preparation resource; unrelated booking entry remains denied');
})().catch(e=>{console.error(e);process.exitCode=1});
