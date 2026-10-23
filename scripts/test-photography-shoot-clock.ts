import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {resourceWindowCalendar} from "../src/lib/booking-resource-window";
import {BookingResourceConflictError} from "../src/server/booking-resource-availability";
const ast=ts.createSourceFile("api.ts",readFileSync("src/server/api.ts","utf8"),ts.ScriptTarget.Latest,true);let branch:ts.IfStatement|undefined;function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(ast)==='method === "PATCH" && !action'&&n.getText(ast).includes("patch.eventTime"))branch=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(branch);assert.match(branch.getText(ast),/guardPhotographyResourceWrite/,"original shoot clock cannot diverge from the guarded event period");
const code=ts.transpileModule(`async function run(req={}){const method='PATCH',action='';${branch.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const window={preparationStart:"2026-10-25T12:00:00+03:00",eventStart:"2026-10-25T20:00:00+03:00",eventEnd:"2026-10-26T01:00:00+03:00",returnEnd:"2026-10-26T12:00:00+03:00"};
for(const mode of ["notes","wrong","repair","legacy"]){let active=false,writes=0,commits=0;
 const tx:any={query:{photographyShootsTable:{findFirst:async()=>({id:5,eventId:7,eventTime:"19:00"})}},update:()=>({set:()=>({where:()=>({returning:async()=>{assert.ok(active);writes++;return[{id:5}];}})})})};
 const ctx:any={db:{transaction:async(fn:any)=>{active=true;try{const result=await fn(tx);commits++;return result;}catch(cause){writes=0;throw cause;}finally{active=false;}}},guardPhotographyResourceWrite:async(connection:any,id:number,fn:any)=>{assert.equal(connection,tx);assert.equal(id,7);return fn({resourceWindow:mode==="legacy"?null:window});},resourceWindowCalendar,BookingResourceConflictError,body:async()=>mode==="notes"?{notes:"تصحيح"}:{eventTime:mode==="wrong"?"21:00":mode==="legacy"?"19:00":"20:00"},event:{id:7},shoot:{id:5},auth:{id:4},eq:()=>({}),nullableText:(v:any)=>v??null,photographyShootsTable:{id:5},parseCoordinate:()=>null,onShootEdited:async()=>{assert.equal(active,false);},createNotification:()=>{},shootCardPayload:(_:any,value:any)=>value,json:(v:any)=>v};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 if(mode==="wrong"){await assert.rejects(()=>ctx.run(),/الفترة|الموعد/);assert.equal(commits,0);assert.equal(writes,0);}else{await ctx.run();assert.equal(commits,1);assert.equal(writes,1);}
}
console.log("PASS original shoot clock writer: source transaction, canonical period consistency, legacy unchanged clock and descriptive edits (controlled IO)");
