import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const ast=ts.createSourceFile("api.ts",readFileSync("src/server/api.ts","utf8"),ts.ScriptTarget.Latest,true);
const handler=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="handlePhotographyStaffPortal")!;
let branch:ts.IfStatement|undefined;function visit(node:ts.Node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==='resource === "events"')branch=node;ts.forEachChild(node,visit);}visit(handler);assert.ok(branch);
const compiled=ts.transpileModule(`async function run(req,auth,manager){const resource='events',method=req.method,ref='7',action='resource-window',crewEventIds=new Set();${branch.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run({method="GET",manager=true,allowed=true,fail=false,linked=false,payload={window:{},expectedWindow:null} as any}={}){
 let writes=0,reads=0,syncs=0;const ctx:any={db:{},body:async()=>payload,json:(data:any)=>({status:200,data,headers:new Map()}),error:(message:string,status:number)=>({status,message}),getPhotographyEventByRef:async()=>({id:7,assignedStaffId:2}),canAccessPhotographyEvent:()=>allowed,
  readPhotographyResource:async()=>{reads++;if(fail)throw Error("photo read unavailable");return{reference:{source:linked?"service":"photography",id:linked?71:7,eventDate:"2026-10-22",operations:{}},event:{event_start_time:null},resourceWindow:null};},savePhotographyResourceWindow:async(_db:any,id:number,_window:any,_expected:any,_actor:any,options:any)=>{assert.equal(id,7);writes++;if(fail)throw Error("photo save unavailable");if(linked)await options?.afterSave?.("photo-transaction",{source:"service",id:71});return{ok:true};},syncCentralBookingToPhotography:async(id:number,_actor:any,tx:any)=>{assert.equal(id,71,"linked event ID is not the central source ID");assert.equal(tx,"photo-transaction");syncs++;}};
 vm.createContext(ctx);vm.runInContext(compiled,ctx);const response=await ctx.run({method},{id:1,fullName:"مدير"},manager);return{response,writes,reads,syncs};
}
const get=await run();assert.equal(get.response?.status,200,"original photo portal needs its own authorized resource-window adapter");assert.equal(get.response.data.canReschedule,true);assert.equal(get.writes,0);assert.equal(get.response.headers.get("Cache-Control"),"private, no-store");
assert.equal((await run({manager:false})).response.data.canEdit,false);
assert.equal((await run({manager:false,method:"PUT"})).response.status,403);
assert.equal((await run({allowed:false})).response.status,404);
assert.equal((await run({method:"DELETE"})).response.status,405);
assert.equal((await run({method:"PUT"})).writes,1);
assert.equal((await run({method:"PUT"})).syncs,0);
assert.equal((await run({method:"PUT",linked:true})).syncs,1);
assert.equal((await run({method:"PUT",payload:{window:{},calendar:{eventDate:"bad"}}})).response.status,400);
await assert.rejects(()=>run({fail:true}),/photo read unavailable/);
await assert.rejects(()=>run({method:"PUT",fail:true}),/photo save unavailable/);
console.log("PASS original photography period adapter: ownership/crew read permission, manager-only save, explicit calendar, private response and propagated errors (controlled IO)");
