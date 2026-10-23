import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const ast=ts.createSourceFile("integration.ts",readFileSync("src/server/photography-booking-integration.ts","utf8"),ts.ScriptTarget.Latest,true);
const names=["syncPhotographyStageToCentralBooking","mapObject","writeSyncAudit"];
const code=ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??"")).map(n=>n.getText(ast).replace(/^export /,"")).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
for(const mode of ["clear","busy","duplicate","audit_failure"]){
 let guarded=false,locked=false,writes=0,audits=0;const fields:any=mode==="duplicate"?{photographyWorkflowStatus:"crew_assigned",photographyCustomerStatus:"فريق"}:{};
 const tx:any={execute:async()=>{locked=true;return{rows:[{id:71}]};},query:{serviceOrdersTable:{findFirst:async()=>{assert.ok(locked);return{id:71,status:mode==="duplicate"?"confirmed":"pending",customFields:fields};}}},update:()=>({set:()=>({where:async()=>{assert.ok(guarded);writes++;}})}),insert:(table:any)=>({values:async()=>{assert.ok(guarded);if(table==="audit"){if(mode==="audit_failure")throw Error("audit unavailable");audits++;}writes++;}})};
 const context:any={db:new Proxy({},{get(){throw Error("default connection used");}}),guardBookingResourceWrite:async(connection:any,ref:any,write:any)=>{assert.equal(connection,tx);assert.equal(ref.source,"service");assert.equal(ref.id,71);guarded=true;if(mode==="busy")throw Error("resource busy");return write();},sql:()=>({}),eq:()=>({}),serviceOrdersTable:{id:1,customFields:2},serviceOrderStatusHistoryTable:"history",entityTimelineTable:"timeline",adminActivityLogsTable:"audit",normalizeShootStage:(v:any)=>v,routedKoshaCustomFieldsSql:(_:any,v:any)=>v,CENTRAL_STATUS_BY_STAGE:{crew_assigned:"confirmed"},CUSTOMER_STATUS:{crew_assigned:"فريق"},SHOOT_STAGE_LABELS:{crew_assigned:"الفريق"},ensurePhotographyIntegrationTables:()=>{throw Error("setup escaped supplied transaction");}};
 vm.createContext(context);vm.runInContext(code,context);
 if(mode==="busy")await assert.rejects(()=>context.syncPhotographyStageToCentralBooking(71,"crew_assigned",{id:4},tx),/resource busy/);
 else if(mode==="audit_failure")await assert.rejects(()=>context.syncPhotographyStageToCentralBooking(71,"crew_assigned",{id:4},tx),/audit unavailable/);
 else{const result=await context.syncPhotographyStageToCentralBooking(71,"crew_assigned",{id:4},tx);assert.equal(result.updated,mode!=="duplicate");assert.equal(writes,mode==="duplicate"?0:4);assert.equal(audits,mode==="duplicate"?0:1);}
}
console.log("PASS photo stage synchronization: original service identity, supplied transaction, guarded activation, fresh locked data, duplicate suppression and audit failure propagation (controlled IO)");
