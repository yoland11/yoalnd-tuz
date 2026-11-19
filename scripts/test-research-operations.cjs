const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/server/research-center.ts', 'utf8');
const safeLogs=[];
let archiveState, failArchiveAudit=false, archiveTransactions=0;
const archiveTables=Object.fromEntries(['researchOrdersTable','researchStatusEventsTable','notificationsTable','entityTimelineTable','adminActivityLogsTable'].map(name=>[name,{name,id:`${name}.id`}]));
async function controlledArchiveTransaction(run) {
  if(!archiveState)throw Error('Injected read/write failure');
  archiveTransactions++;
  const working=structuredClone(archiveState);
  const tx={
    execute:async query=>{const text=query.strings.join('');if(text.includes('research safe delete:costs')){if(working.costReadError)throw Error('Injected cost read failure');return {rows:[{blocked:working.costBlocked??false}]};}assert.match(text,/pg_advisory_xact_lock/);working.locks++;return {rows:[]};},
    select:()=>{const result=()=>working.order?[structuredClone(working.order)]:[];const chain={from:table=>{assert.equal(table,archiveTables.researchOrdersTable);return chain},where:condition=>{assert.equal(condition.right,9);return chain},for:mode=>{assert.equal(mode,'update');working.rowLocks++;return chain},limit:async()=>result(),then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)};return chain},
    update:table=>{assert.equal(table,archiveTables.researchOrdersTable,'archive must not write invoices, payments or customers');return {set:values=>({where:async condition=>{assert.equal(condition.right,9);for(const [key,value] of Object.entries(values))if(value!==undefined)working.order[key]=value;working.orderUpdates++;}})}},
    insert:table=>({values:async values=>{assert.ok(table&&table!==archiveTables.researchOrdersTable,'archive must not create another order');if(failArchiveAudit&&table===archiveTables.adminActivityLogsTable)throw Error('Injected audit failure');working.inserts.push({table:table.name,values});}}),
    delete:()=>{throw Error('physical deletion forbidden')},
  };
  const result=await run(tx);archiveState=working;return result;
}
const sandbox = { exports: {}, Buffer, AbortController, process: {env:{}}, console:{...console,error:(label,context)=>safeLogs.push({label,context})}, URL, setTimeout, clearTimeout, fetch:()=>{throw Error('unexpected network')} };
sandbox.require = name => {
  if (name === 'node:crypto' || name === 'zod/v4' || name === 'next/server') return require(name);
  if (name === '@/lib/phone') return { normalizeIraqiPhone: value => value };
  if (name === '@/server/write-safety' || name === '@/server/request-body' || name === './research-payment-rules') {
    const child={exports:{}};const file=name.startsWith('./')?'src/server/'+name.slice(2):name.replace('@/','src/');vm.runInNewContext(ts.transpileModule(fs.readFileSync(file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...sandbox,...child});return child.exports;
  }
  if (name === '@/server/research-center-schema') return {ensureResearchCenterTables:async()=>{}};
  if (name === '@/server/research-analytics') return {handleResearchAnalytics:async()=>null};
  if (name === '@/server/research-finance') return {ResearchFinanceError:class extends Error{}};
  if (name === '@workspace/db') return {...archiveTables,db:{transaction:controlledArchiveTransaction}};
  if (name === 'drizzle-orm') return {eq:(left,right)=>({left,right}),sql:(strings,...values)=>({strings,values})};
  if (name === '@/server/payment-state') return {reconcilePaymentState:()=>{throw Error('archive cannot change payment state')}};
  if (name === './research-payment-state') return {readResearchCanonicalPaymentState:async(tx,id)=>{assert.equal(id,9);assert.ok(tx.select);if(archiveState.canonicalReadError)throw Error('Injected canonical read failure');return structuredClone(archiveState.canonical)},readResearchPendingAmount:async(tx,id,invoiceId)=>{assert.equal(id,9);assert.equal(invoiceId,archiveState.canonical.invoiceId);return archiveState.pending??'0.00'}};
  if (name === '@/lib/research-contract') return { RESEARCH_WORKFLOW_STAGES: [{key:'quality_review',targetStatus:'review'}] };
  return new Proxy({}, {get:()=>()=>{throw Error(`Unexpected dependency ${name}`)}});
};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nexports.__tests={searchSources,createResearchOrder,updateOrder,chapterWriteSchema,messageWriteSchema};',sandbox);
const api = sandbox.exports;
const base = { customerName:'طالب جديد', phone:'07701234567', title:'عنوان بحث علمي', researchType:'master', universityName:'جامعة بغداد', requiredPages:12 };
assert.equal(api.researchOrderSchema.safeParse({...base, paymentDueDate:'2026-02-30'}).success,false,'reject impossible due date');
assert.equal(api.researchOrderSchema.safeParse({...base, customerId:5, customerName:undefined,phone:undefined}).success,true,'selected customer does not require duplicate text fields');
assert.equal(api.researchOrderSchema.safeParse({...base, academicLevel:'invented'}).success,false,'reject unknown academic level');
assert.equal(api.researchPatchSchema.safeParse({workflowStage:'quality_review'}).success,true,'accept workflow stage');
assert.equal(api.researchPatchSchema.safeParse({discountAmount:-1}).success,false);
assert.equal(api.validResearchPrivatePath('private:research/12/report.pdf',12),true);
assert.equal(api.validResearchPrivatePath('private:research/13/report.pdf',12),false,'cross-order signer refused');
assert.equal(api.validResearchPrivatePath('private:research/12/%2e%2e/secret.pdf',12),false,'encoded path traversal refused');
const projected = api.researchNonfinancialOrder({title:'بحث',totalAmount:'100',paidAmount:'30',remainingAmount:'70',creationKey:'private',estimatedPrice:'100',discountAmount:'0',paymentStatus:'partial'});
for(const key of ['totalAmount','paidAmount','remainingAmount','estimatedPrice','discountAmount','paymentStatus','creationKey']) assert.equal(key in projected,false,`${key} is private`);
const uploaded = api.validateResearchFileData('data:application/pdf;base64,'+Buffer.from('%PDF-1.7 demo').toString('base64'),'report.pdf','application/pdf');
assert.equal(uploaded.bytes.length,13);
assert.throws(()=>api.validateResearchFileData('data:application/pdf;base64,'+Buffer.from('not pdf').toString('base64'),'report.pdf'));
assert.equal(api.researchOrderSchema.safeParse({...base,estimatedPrice:1.234}).success,false,'money rejects fractional cents');
assert.equal(api.researchOrderSchema.safeParse({...base,deposit:1.234}).success,false,'deposit rejects fractional cents');
assert.equal(api.researchOrderSchema.safeParse({...base,customerName:undefined,phone:undefined}).success,false,'new customer identity required');
assert.equal(api.__tests.chapterWriteSchema.parse({content:'updated'}).assignedWriterId,undefined,'content-only edits preserve assignment');
assert.equal(api.__tests.messageWriteSchema.safeParse({orderId:5,message:'valid',messageType:'invented'}).success,false);
assert.throws(()=>api.validateResearchFileData('data:application/pdf;base64,'+Buffer.from('%PDF-'+ 'a'.repeat(6*1024*1024)).toString('base64'),'report.pdf'));
(async()=>{
  await assert.rejects(api.__tests.searchSources('research','all'),error=>error.status===502&&error.code==='SOURCE_PROVIDERS_UNAVAILABLE','all-provider failures stay visible');
  await assert.rejects(api.__tests.searchSources('research','invented'),error=>error.status===422,'unknown provider refused');
  const publicLegacy=await api.__tests.createResearchOrder({...base,estimatedPrice:50000});
  assert.equal(publicLegacy.response.status,500,'legacy public agreed price reaches transaction');
  const failure=await publicLegacy.response.json();assert.equal(failure.success,false);assert.ok(failure.requestId,'failed transaction includes request ID');
  assert.equal((await api.__tests.createResearchOrder({...base,deposit:10,estimatedPrice:20})).response.status,403,'anonymous deposit forbidden');
  const req=new (require('next/server').NextRequest)('http://localhost/api/admin/research/orders',{method:'POST',body:JSON.stringify(base)});
  const denied=await api.handleAdminResearch(req,['admin','research','orders'],{id:1,username:'reader',fullName:'Reader',role:'employee',isActive:true,permissions:['research.view']});
  assert.equal(denied.status,403,'read grant cannot create');
  const deniedData=await denied.json();assert.equal(deniedData.code,'PERMISSION_DENIED');assert.ok(deniedData.requestId);
  const assignmentOnly=await api.__tests.updateOrder(1,{assignedWriterId:2},{id:1,username:'assigner',fullName:'Assigner',role:'employee',isActive:true,permissions:['research.assign']});
  assert.equal(assignmentOnly.response.status,500,'assignment-only grant reaches transaction despite undefined preprocessed optional fields');
  const archiveOnly=await api.__tests.updateOrder(1,{status:'archived'},{id:1,username:'archiver',fullName:'Archiver',role:'employee',isActive:true,permissions:['research.archive']});
  assert.equal(archiveOnly.response.status,500,'archive-only grant reaches transaction despite undefined preprocessed optional fields');
  const editor={id:1,username:'editor',fullName:'Editor',role:'employee',isActive:true,permissions:['research.view','research.edit']};
  assert.equal((await api.__tests.updateOrder(9,{status:'archived'},editor)).response.status,403,'edit-only grant cannot archive');
  const reader={...editor,permissions:['research.view']};
  const deniedArchive=await api.handleAdminResearch(new (require('next/server').NextRequest)('http://localhost/api/admin/research/orders/9',{method:'PATCH',body:JSON.stringify({status:'archived'})}),['admin','research','orders','9'],reader);
  assert.equal(deniedArchive.status,403,'original HTTP route enforces archive permission');
  archiveState={order:{id:9,researchNo:'RS-9',customerId:7,qrToken:'original-private-token',invoiceId:555,title:'بحث الطالب الأصلي',researchType:'master',status:'writing',progress:50,archivedAt:null,totalAmount:'500000',estimatedPrice:'500000',discountAmount:'0',paidAmount:'200000',remainingAmount:'300000',paymentStatus:'partial',creationKey:'private'},files:[{id:8,fileUrl:'private:research/9/final.pdf'}],payments:[{id:2,status:'executed',amount:200000},{id:3,status:'pending',amount:100000}],inserts:[],locks:0,rowLocks:0,orderUpdates:0};
  const original=structuredClone(archiveState),archiver={...editor,permissions:['research.archive','research.financials.view']};
  const archived=await api.__tests.updateOrder(9,{status:'archived'},archiver);
  assert.equal(archived.order.status,'archived');assert.ok(archived.order.archivedAt);assert.equal(archiveState.rowLocks,1);assert.equal(archiveState.locks,1);
  for(const key of ['id','customerId','qrToken','invoiceId','estimatedPrice','discountAmount','totalAmount','paidAmount','remainingAmount','paymentStatus'])assert.equal(archiveState.order[key],original.order[key],`${key} must remain unchanged`);
  assert.equal(archiveState.order.progress,100,'legacy status-only archive keeps its existing behavior');
  assert.deepEqual(archiveState.files,original.files);assert.deepEqual(archiveState.payments,original.payments);
  assert.equal(archiveState.inserts.filter(row=>row.table==='researchStatusEventsTable').length,1);
  assert.ok(archiveState.inserts.some(row=>row.table==='entityTimelineTable'&&row.values.actorId===1));assert.ok(archiveState.inserts.some(row=>row.table==='adminActivityLogsTable'));
  assert.equal('creationKey' in archived.order,false,'private creation identity is never returned');
  await api.__tests.updateOrder(9,{status:'archived'},archiver);
  assert.equal(archiveState.inserts.filter(row=>row.table==='researchStatusEventsTable').length,1,'retry cannot create a duplicate status transition');
  assert.equal(archiveState.inserts.filter(row=>row.table==='notificationsTable').length,1,'retry cannot duplicate a customer notification');
  const beforeFailure=structuredClone(archiveState);failArchiveAudit=true;
  const failedArchive=await api.__tests.updateOrder(9,{status:'archived'},archiver);assert.equal(failedArchive.response.status,500);assert.ok((await failedArchive.response.json()).requestId);assert.deepEqual(structuredClone(archiveState),beforeFailure,'audit failure rolls back the complete transaction');
  failArchiveAudit=false;archiveState.order=null;
  const missing=await api.__tests.updateOrder(9,{status:'archived'},archiver);assert.equal(missing.response.status,404,'missing order is a visible error');
  assert.equal(archiveTransactions,4,'denied requests must not enter a write transaction');
  const clean={...structuredClone(original),order:{...original.order,estimatedPrice:'0',totalAmount:'0',paidAmount:'0',remainingAmount:'0',progress:50,deliveredAt:null},payments:[],canonical:{invoiceId:555,totalAmount:'0.00',approvedPaidAmount:'0.00',remainingAmount:'0.00',creditAmount:'0.00'},pending:'0.00'};
  archiveState=structuredClone(clean);
  const safeDeleted=await api.__tests.updateOrder(9,{status:'archived',archiveFromActive:true},{...archiver,permissions:['research.archive']});
  assert.equal(safeDeleted.order.status,'archived');assert.ok(safeDeleted.order.archivedAt);assert.equal(archiveState.order.progress,50,'safe deletion preserves actual incomplete progress');assert.deepEqual(archiveState.files,clean.files);assert.deepEqual(archiveState.payments,clean.payments);
  const savedWrites=archiveState.orderUpdates,savedAudit=archiveState.inserts.length,savedAt=archiveState.order.updatedAt;
  archiveState.canonicalReadError=true;
  const replay=await api.__tests.updateOrder(9,{status:'archived',archiveFromActive:true},archiver);assert.equal(replay.order.status,'archived');assert.equal(archiveState.orderUpdates,savedWrites);assert.equal(archiveState.inserts.length,savedAudit);assert.equal(archiveState.order.updatedAt.getTime(),savedAt.getTime(),'successful-but-lost response retries do not write or audit twice');
  assert.equal((await api.__tests.updateOrder(9,{status:'archived',archiveFromActive:true,progress:80},archiver)).response.status,400,'safe deletion cannot carry unrelated changes');
  assert.equal((await api.__tests.updateOrder(9,{status:'writing',archiveFromActive:true},archiver)).response.status,400);
  for(const blocked of [{canonical:{totalAmount:'500000.00'}},{canonical:{approvedPaidAmount:'200000.00'}},{canonical:{remainingAmount:'300000.00'}},{canonical:{creditAmount:'50.00'}},{pending:'100000.00'},{costBlocked:true},{order:{status:'delivered'}},{order:{deliveredAt:'2026-11-18'}}]){
    archiveState={...structuredClone(clean),...blocked,order:{...clean.order,...blocked.order},canonical:{...clean.canonical,...blocked.canonical}};
    const before=structuredClone(archiveState),result=await api.__tests.updateOrder(9,{status:'archived',archiveFromActive:true},{...archiver,permissions:['research.archive']});assert.equal(result.response.status,409,JSON.stringify(blocked));const failure=await result.response.json();assert.ok(failure.requestId);assert.doesNotMatch(failure.message,/500000|200000|300000|100000/,'archive-only errors reveal no financial amounts');assert.deepEqual(structuredClone(archiveState),before,'failed preconditions leave the original data untouched');
  }
  for(const flag of ['canonicalReadError','costReadError']){archiveState={...structuredClone(clean),[flag]:true};const result=await api.__tests.updateOrder(9,{status:'archived',archiveFromActive:true},archiver);assert.equal(result.response.status,500);assert.equal(archiveState.order.status,'writing','read failures must never permit deletion');}
  assert.ok(safeLogs.length>=3);for(const log of safeLogs)assert.ok(log.context.requestId,'server failures log request IDs');
  console.log('Research operations behavior checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
