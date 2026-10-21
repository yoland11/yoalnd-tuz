import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
const {runBookingBulkOperation}=await import("../src/server/booking-bulk-operations");
const dialect=new PgDialect();let updates=0,failAudit=false;const receipts=new Map<string,any>();
const documents=new Map([['kosha:12',{keep:true,bookingOperations:{loading:{id:'keep-loading'},productMeta:{'10:0':{unitPrice:5000,prep:{note:'old'}}}}}],['service:12',{bookingOperations:{productMeta:{}}}]]);
let active='';const executor={execute:async(query:any)=>{const {sql,params}=dialect.sqlToQuery(query);
 if(sql.includes('FOR UPDATE')){active=(sql.includes('FROM kosha_bookings')?'kosha':'service')+':'+params[0];return {rows:documents.has(active)?[{id:12,status:'confirmed',details:documents.get(active)}]:[]}}
 if(sql.includes('FROM entity_timeline'))return {rows:receipts.has(active)?[receipts.get(active)]:[]};
 if(sql.trimStart().startsWith('UPDATE ')){updates++;documents.set(active,{...documents.get(active),bookingOperations:{...documents.get(active)?.bookingOperations,productMeta:JSON.parse(params.find(p=>typeof p==='string'&&p.startsWith('{')) as string)}});return {rows:[{id:12}]}}
 if(sql.includes('INSERT INTO entity_timeline')){if(failAudit)throw Error('audit failed');receipts.set(active,{actor_id:1,metadata:JSON.parse(params.find(p=>typeof p==='string'&&p.startsWith('{')) as string)});return {rows:[]}}
 throw Error(sql);
}};
const database={...executor,transaction:async<T>(fn:any):Promise<T>=>{const before=structuredClone(documents),r=structuredClone(receipts),n=updates;try{return await fn(executor)}catch(e){documents.clear();for(const [k,v]of before)documents.set(k,v);receipts.clear();for(const[k,v]of r)receipts.set(k,v);updates=n;throw e}}};
let diagnostic:any;
const dependencies={preparation:async(_tx:any,ref:any)=>ref.source==='service'?{items:[]}:{items:[{key:'10:0'}]},patch:async(_tx:any,_ref:any,meta:any,patch:any)=>({...meta,[patch.key]:{...meta[patch.key],prep:{...meta[patch.key]?.prep,priority:patch.priority,note:patch.note}}}),log:(context:any)=>{diagnostic=context}};
const request={requestId:'batch-request-12',refs:[{source:'kosha',id:12},{source:'service',id:12}],patch:{priority:'urgent',note:'راجع تجهيز المجموعة'}};
const actor={id:1,name:'مدير',canManage:true};
let result=await runBookingBulkOperation(database,actor,request,dependencies);assert.equal(result.results[0].status,'success');assert.equal(result.results[1].status,'failed');assert.equal(updates,1);assert.equal(documents.get('kosha:12')?.bookingOperations.productMeta['10:0'].unitPrice,5000);assert.equal(documents.get('kosha:12')?.bookingOperations.loading.id,'keep-loading');
result=await runBookingBulkOperation(database,actor,request,dependencies);assert.equal(result.results[0].replayed,true);assert.equal(updates,1);
result=await runBookingBulkOperation(database,actor,{...request,patch:{priority:'normal'}},dependencies);assert.equal(result.results[0].status,'failed');assert.equal(result.results[0].httpStatus,409);
await assert.rejects(()=>runBookingBulkOperation(database,{...actor,canManage:false},request,dependencies),/صلاحية/);
receipts.clear();failAudit=true;result=await runBookingBulkOperation(database,actor,{...request,requestId:'batch-audit-failure'},dependencies);assert.equal(result.results[0].status,'failed');assert.equal(updates,1,'failed audit rolls back original preparation metadata');
assert.equal(result.results[0].httpStatus,503,'database failure is NOT an empty or successful booking');
assert.equal(diagnostic.errorType,'Error','consumed failure retains safe cause classification for server diagnosis');assert.equal(diagnostic.requestId,'batch-audit-failure');assert.equal(diagnostic.message,undefined,'raw SQL/credentials must not be logged');
console.log('PASS actual bulk coordinator: per-booking/source results, trusted authorization, durable replay, payload collision, preserved price/loading metadata and atomic audit rollback');
failAudit=false;receipts.clear();let assignedTx:any,assignedPatch:any;
const assignmentDeps={...dependencies,patch:async(tx:any,_ref:any,meta:any,patch:any)=>{assignedTx=tx;assignedPatch=patch;return {...meta,[patch.key]:{...meta[patch.key],prep:{...meta[patch.key]?.prep,assigneeId:patch.assigneeId,taskId:71}}}}};
result=await runBookingBulkOperation(database,actor,{...request,requestId:'batch-assignment',refs:[{source:'kosha',id:12}],patch:{assigneeId:8}},assignmentDeps);
assert.equal(result.results[0].status,'success','bulk assignment must be supported transactionally');assert.equal(assignedTx,executor);assert.equal(assignedPatch.assigneeId,8);
assert.equal(documents.get('kosha:12')?.bookingOperations.productMeta['10:0'].prep.taskId,71);
result=await runBookingBulkOperation(database,actor,{...request,requestId:'batch-assignment',refs:[{source:'kosha',id:12}],patch:{assigneeId:8}},assignmentDeps);assert.equal(result.results[0].replayed,true);
console.log('PASS bulk assignment uses the locked transaction and replays without task duplication');
receipts.clear();const untouched=structuredClone(documents.get('kosha:12'));
documents.get('kosha:12')!.bookingOperations.productMeta['old-line']={prep:{taskId:'71'}} as any;
const previousUpdates=updates;
result=await runBookingBulkOperation(database,actor,{...request,requestId:'batch-alias-task-id',refs:[{source:'kosha',id:12}],patch:{assigneeId:8}},assignmentDeps);
assert.equal(result.results[0].status,'failed','a stale/non-live line sharing numeric-equivalent task ID must prevent assignment');assert.equal(result.results[0].httpStatus,409);assert.equal(updates,previousUpdates);
documents.set('kosha:12',untouched);
