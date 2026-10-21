const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const ast=ts.createSourceFile('api.ts',fs.readFileSync('src/server/api.ts','utf8'),ts.ScriptTarget.Latest,true);
const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='executeLockedBookingAssetAction');
const code=ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
class CustodyError extends Error{constructor(message,status){super(message);this.status=status}}
async function run(role,permissions,missing=false){
 let writes=0;
 const c=vm.createContext({productsTable:{id:'id'},eq:()=>true,quantityProfilesFor:async()=>new Map([[10,{}]]),
   executeQuantityBookingAction:async()=>{writes++;return {replayed:true}},actor:u=>({id:u.id,name:'actor'}),hasPermission:(u,p)=>u.permissions.includes(p),IndividualCustodyError:CustodyError,
   logAdminActivity:()=>{},json:data=>({status:200,data}),error:(message,status)=>({message,status}),
 });vm.runInContext(code,c);
 try{const result=await c.executeLockedBookingAssetAction({}, {id:1,role,permissions}, {id:12,source:'kosha',row:{status:'confirmed'},operations:{},details:{}},
   {mode:'return',productId:10,problem:'none',quantity:1,goodQuantity:0,damagedQuantity:missing?0:1,missingQuantity:missing?1:0,description:'وصف موثق',managerApproval:true},
   {query:{productsTable:{findFirst:async()=>({id:10})}}},false);return {result,writes}}
 catch(error){return {error,writes}}
}
async function staffReturn(){
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleStaffPortal');
 const branch=fn.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='resource === "bookings" && id && action === "assets"');assert.ok(branch);
 let input;
 const c=vm.createContext({authorizeKoshaPortalBooking:async()=>({booking:{id:12}}),loadBookingOperationsReference:async()=>({id:12,source:'kosha',details:{}}),bookingOperationAssets:async()=>[{productId:10,trackingMode:'quantity',quantity:3,outstanding:3}],bookingOperationProducts:async()=>[],optionalPositiveId:v=>Number(v)>0?Number(v):null,
  body:async()=>({mode:'return',productId:10,quantity:2,goodQuantity:1,damagedQuantity:1,missingQuantity:0,problem:'damaged',description:'تلف عند الإرجاع',estimatedCost:40,requestId:'return-id'}),
  BookingAssetActionSchema:{safeParse:v=>({success:true,data:v})},withQuantityAssetErrors:fn=>fn(),executeBookingAssetAction:async(_req,_auth,_ref,value)=>{input=value;return {ok:true}},error:(message,status)=>({message,status}),validationError:()=>({status:422}),
 });
 vm.runInContext(ts.transpileModule(`async function adapter(req){const resource='bookings',id=12,action='assets',auth={id:2},method='POST';${branch.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,c);
 await c.adapter({nextUrl:{searchParams:new URLSearchParams('source=kosha')}});
 return input;
}
(async()=>{
 const untrusted=await run('staff',[]);assert.equal(untrusted.error?.status,403,'quantity return must enforce the SAME server damage capability as individual return');assert.equal(untrusted.writes,0);
 const loss=await run('staff',['asset_damage_record'],true);assert.equal(loss.error?.status,403,'client checkbox must not grant loss approval');assert.equal(loss.writes,0);
 assert.equal((await run('admin',[],true)).writes,1);
 assert.equal((await run('staff',['asset_damage_record'])).writes,1);
 const input=await staffReturn();assert.equal(input.description,'تلف عند الإرجاع','shared return dialog description must reach the original writer');assert.equal(input.estimatedCost,40);assert.equal(input.problem,'damaged');assert.equal(input.goodQuantity,1);assert.equal(input.damagedQuantity,1);
 console.log('PASS quantity return damage/loss capabilities are derived from trusted server identity before any original movement writer');
})().catch(e=>{console.error(e);process.exitCode=1});
